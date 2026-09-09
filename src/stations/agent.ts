// SPDX-License-Identifier: AGPL-3.0-only
// A station as a Flue agent (Wave 4c §9.4 to §9.6): the manifest names the
// phases, the grant, the budget, the checks and the result schema; the
// station's own code names its tools, which phase each opens in, and the
// checks by name. The framework mounts the tools through the machine's
// gate, keeps the run state durable, counts the budget, detects loops,
// refuses to settle until the checks pass, and ends every run with one
// terminal reason. The brief is a skill, its hash the manifest's.

import {
  defineSkill,
  type JsonValue,
  useAgentFinish,
  useAgentStart,
  useDataWriter,
  useModel,
  usePersistentState,
  useResponseFinish,
  useSkill,
  useTool,
} from "@flue/runtime";
import * as v from "valibot";
import { providerId } from "../providers/kvasir.ts";
import type { Seam } from "../seam/client.ts";
import { feedbackOf, seamFor, subjectOfConversation, theNotes, verdicts } from "../seam/for.ts";
import { initialState, Machine, type RunState } from "./machine.ts";
import type { Manifest, TerminalReason } from "./manifest.ts";
import { toValibot } from "./schema.ts";
import {
  type Check,
  complete,
  evidenceOnly,
  mayWrite,
  type Proposal,
  runChecks,
  type Verdict,
} from "./verdict.ts";

/** The closed union of section 9.8: what a station may put in front of the desk; anything else the desk drops. */
export const PART = v.variant("kind", [
  v.object({
    kind: v.literal("move_proposal"),
    document: v.number(),
    parent: v.nullable(v.number()),
    sentence: v.string(),
  }),
  v.object({
    kind: v.literal("choice"),
    question: v.string(),
    options: v.array(v.object({ label: v.string(), count: v.nullable(v.number()) })),
  }),
  v.object({ kind: v.literal("note"), text: v.string() }),
  v.object({ kind: v.literal("todo"), text: v.string() }),
  v.object({ kind: v.literal("lookup"), level: v.string(), field: v.string(), values: v.array(v.string()) }),
  v.object({ kind: v.literal("handle_ref"), handle: v.number() }),
  v.object({
    kind: v.literal("funnel"),
    rows: v.array(v.object({ set: v.string(), stage: v.string(), rows: v.number(), subjects: v.number() })),
  }),
  v.object({ kind: v.literal("status"), phase: v.string(), text: v.string() }),
]);
export type Part = v.InferOutput<typeof PART>;
export type PartKind = Part["kind"];
export const PART_KINDS: PartKind[] = [
  "move_proposal",
  "choice",
  "note",
  "todo",
  "lookup",
  "handle_ref",
  "funnel",
  "status",
];

export interface StationTool {
  name: string;
  description: string;
  input: v.GenericSchema<Record<string, unknown>, unknown>;
  /** The phases it is open in. */
  phases: string[];
  /** The argument keys the loop detector reads; every key when absent. */
  salient?: string[];
  /** The list a completeness field counts, for a mutating tool. */
  completes?: string;
  run: (
    args: Record<string, unknown>,
    ctx: { seam: Seam; conversation: string; toolCallId: string; state: RunState; machine: Machine },
  ) => Promise<{ output: JsonValue; evidence?: { handles?: number[]; documents?: number[] } }>;
}

export interface StationDefinition {
  manifest: Manifest;
  brief: string;
  model: string;
  instructions: string;
  tools: StationTool[];
  checks: Record<string, Check>;
  /** The phase the settle tool moves to, and the phases it is open in. */
  settle: { phases: string[] };
  /** What the station fills into the result mechanically before the checks run: a hash, a declaration, never a judgement. */
  complete?: (
    result: Record<string, unknown>,
    ctx: { seam: Seam; conversation: string; state: RunState },
  ) => Promise<Record<string, unknown>>;
}

export interface Settled {
  verdict: Verdict;
}

/** The agent function of one station; Flue keys its conversations by the function's name, set here to the station's id. */
export function stationAgent(
  def: StationDefinition,
): ((props: { id: string }) => string) & { agentName: string } {
  const m = def.manifest;
  const resultSchema = toValibot(m.result as never);
  const skill = defineSkill({
    name: m.id,
    description: `The brief of ${m.id}: what the decision point is, what the words mean, the refusals.`,
    instructions: def.brief,
  });
  const table: Record<string, string[]> = Object.fromEntries(def.tools.map((t) => [t.name, t.phases]));
  table.settle = def.settle.phases;

  const agent = ({ id }: { id: string }) => {
    useModel(`${providerId(m.id)}/${def.model}`);
    useSkill(skill);
    const [state, setState] = usePersistentState<RunState>("run", initialState(m));
    const [settled, setSettled] = usePersistentState<Settled | null>("settled", null);
    const machine = new Machine(m, structuredClone(state));
    const commit = () => setState(structuredClone(machine.state));
    const seam = seamFor(m.id, id);
    // the desk seam (section 9.8): the closed union of typed parts, one data part named `part`, never a desk call
    // one named data part per kind, so a conversation's history keeps the last of each and the live stream sees every write
    const writers = Object.fromEntries(
      PART_KINDS.map((k) => [k, useDataWriter(k, { schema: PART })]),
    ) as Record<PartKind, (p: Part) => void>;
    const emit = (p: Part) => {
      try {
        writers[p.kind](p);
      } catch {
        // a bare render has no writer; the record still holds the verdict
      }
    };

    // a follow-up turn (section 7.7): the person spoke again after settle; the run starts over on the settled document
    useAgentStart((ctx) => {
      // a run that settled, or one that ended by budget or loop, is over: the next message starts a follow-up
      if (!settled && !machine.state.terminal) return;
      const to = m.phases.follow_up ?? m.phases.initial;
      const ended = machine.state.terminal;
      machine.followUp(to);
      const base = settled
        ? (settled.verdict as { result?: { document?: unknown } }).result?.document
        : undefined;
      const last = machine.state.evidence.documents.at(-1);
      setSettled(null);
      commit();
      ctx.append({
        kind: "signal",
        type: "station",
        body: `A follow-up turn. The previous run ${settled ? "settled" : `ended by ${ended}`}${typeof base === "number" ? ` on document ${base}, which is the base now: refine it, do not start over` : typeof last === "number" ? `; the last document it stored was ${last}, start from it` : ""}. The phase is ${to} again and the budget starts over. End with settle.`,
      });
    });

    for (const t of def.tools) {
      useTool({
        name: t.name,
        description: t.description,
        input: t.input,
        async run({ data, toolCallId }): Promise<{ output?: JsonValue; terminate?: boolean }> {
          const open = machine.allowed(t.name, table);
          if (!open.ok) {
            machine.refuse(t.name, open.why);
            commit();
            return { output: { refused: true, why: open.why } };
          }
          if (t.completes) {
            const c = complete(data as Record<string, unknown>, t.completes);
            if (!c.ok) {
              machine.refuse(t.name, c.why);
              commit();
              return { output: { refused: true, why: c.why } };
            }
          }
          const gate = machine.call(t.name, data as Record<string, unknown>, t.salient);
          if (!gate.ok) {
            commit();
            return {
              output: { refused: true, why: gate.why, terminal: gate.terminal },
              terminate: gate.terminal !== null,
            };
          }
          const out = await t.run(data as Record<string, unknown>, {
            seam,
            conversation: id,
            toolCallId,
            state: machine.state,
            machine,
          });
          for (const h of out.evidence?.handles ?? [])
            if (!machine.state.evidence.handles.includes(h)) machine.state.evidence.handles.push(h);
          for (const d of out.evidence?.documents ?? [])
            if (!machine.state.evidence.documents.includes(d)) machine.state.evidence.documents.push(d);
          commit();
          return {
            output: gate.warning
              ? ({ ...(out.output as object), warning: gate.warning } as JsonValue)
              : out.output,
          };
        },
      });
    }

    useTool({
      name: "advance",
      description: `Move to the next phase. The phases of ${m.id}, in order: ${m.phases.initial}${m.phases.transitions.map((t) => ` then ${t.to}`).join("")}.`,
      input: v.object({ to: v.string() }),
      async run({ data }): Promise<{ output?: JsonValue; terminate?: boolean }> {
        const r = machine.advance(data.to);
        commit();
        return {
          output: (r.ok ? { phase: machine.state.phase } : { refused: true, why: r.why }) as JsonValue,
        };
      },
    });

    useTool({
      name: "settle",
      description:
        "End the run with the verdict: the result the station's schema names, the proposals, and one sentence. Refused until every check passes.",
      input: v.object({
        result: resultSchema as never,
        proposals: v.array(
          v.object({ kind: v.string(), ref: v.record(v.string(), v.unknown()), sentence: v.string() }),
        ),
        sentence: v.string(),
      }),
      async run({ data }): Promise<{ output?: JsonValue; terminate?: boolean }> {
        const open = machine.allowed("settle", table);
        if (!open.ok) {
          machine.refuse("settle", open.why);
          commit();
          return { output: { refused: true, why: open.why } };
        }
        // settle counts against the budget and the loop detector like any call: a model cannot retry it forever
        const gate = machine.call("settle", { document: (data.result as Record<string, unknown>).document }, [
          "document",
        ]);
        if (!gate.ok) {
          commit();
          return {
            output: { refused: true, why: gate.why, terminal: gate.terminal } as JsonValue,
            terminate: gate.terminal !== null,
          };
        }
        const proposals: Proposal[] = [];
        for (const p of data.proposals as {
          kind: string;
          ref: Record<string, unknown>;
          sentence: string;
        }[]) {
          if (!mayWrite(m, p.kind)) {
            machine.refuse(
              "settle",
              `${p.kind} is not a proposal ${m.id} may make; it may make ${m.writes.join(", ") || "none"}`,
            );
            commit();
            return { output: { refused: true, why: `${p.kind} is not a proposal this station may make` } };
          }
          proposals.push({ kind: p.kind as Proposal["kind"], ref: p.ref, sentence: p.sentence });
        }
        let result = data.result as Record<string, unknown>;
        if (def.complete) {
          try {
            result = await def.complete(result, { seam, conversation: id, state: machine.state });
          } catch (e) {
            return {
              output: {
                refused: true,
                why: `the result could not be completed: ${e instanceof Error ? e.message : String(e)}`,
              } as JsonValue,
            };
          }
        }
        const verdict: Verdict = {
          station: m.id,
          terminal: "settled",
          brief_hash: m.brief.hash,
          model: def.model,
          budget_consumed: {
            turns: machine.state.turns,
            tool_calls: machine.state.tool_calls,
            wall_clock_seconds: Math.round((Date.now() - machine.state.started_at) / 1000),
            input_tokens: machine.state.input_tokens,
          },
          evidence: machine.state.evidence,
          proposals,
          result,
          checks: [],
        };
        const rows = evidenceOnly(verdict);
        if (rows) return { output: { refused: true, why: rows } };
        const checked = await runChecks(verdict, def.checks, m.checks, { seam, conversation: id });
        verdict.checks = checked.results;
        if (!checked.passed) {
          machine.refuse("settle", checked.complaints.join("; "));
          commit();
          return {
            output: { refused: true, why: "the checks did not pass", complaints: checked.complaints },
          };
        }
        if (machine.state.phase !== "finish") machine.advance("finish");
        machine.end("settled");
        commit();
        setSettled({ verdict });
        verdicts.set(id, verdict);
        // a study note for the person's later threads: the document and the sentence, never a row
        if (typeof result.document === "number")
          theNotes().add({
            subject,
            kind: "study",
            station: m.id,
            text: `document ${result.document}: ${data.sentence}`,
          });
        // what the desk renders: a document version as a move proposal on a scratch handle, the choices, the handles read, the status
        for (const p of proposals) {
          if (p.kind === "document_version")
            emit({
              kind: "move_proposal",
              document: Number(p.ref.document ?? result.document),
              parent: p.ref.parent === undefined ? null : Number(p.ref.parent),
              sentence: p.sentence,
            });
        }
        if (proposals.length === 0 && typeof result.document === "number")
          emit({ kind: "move_proposal", document: result.document, parent: null, sentence: data.sentence });
        for (const c of (Array.isArray(result.choices) ? result.choices : []) as Record<string, unknown>[])
          emit({
            kind: "choice",
            question: String(c.question ?? c.text ?? ""),
            options: Array.isArray(c.options)
              ? (c.options as { label: string; count?: number | null }[]).map((o) => ({
                  label: String(o.label ?? o),
                  count: typeof o.count === "number" ? o.count : null,
                }))
              : [],
          });
        for (const h of machine.state.evidence.handles) emit({ kind: "handle_ref", handle: h });
        emit({ kind: "status", phase: "finish", text: data.sentence });
        return { output: { settled: true, sentence: data.sentence }, terminate: true };
      },
    });

    // the budget's turns and tokens: one response is one turn, and its usage is the input
    useResponseFinish((ctx) => {
      const usage = (ctx as { response?: { usage?: { input?: number } } }).response?.usage;
      const reason = machine.turn(usage?.input ?? 0);
      commit();
      return reason ? { terminal: reason } : undefined;
    });

    // the finish hook refuses to settle until the checks passed: a run that ends without settle is sent back once, then ends by budget
    useAgentFinish(async (ctx) => {
      if (settled || machine.state.terminal) return;
      const reason: TerminalReason | null = machine.budget();
      if (reason) {
        commit();
        return;
      }
      ctx.append({
        kind: "signal",
        type: "station",
        body: `The run has not settled. Call settle with the result ${JSON.stringify(m.result)} once the checks can pass, or advance to the phase that allows it. Current phase: ${machine.state.phase}.`,
      });
    });

    // the desk's feedback (section 7.7): a rejected proposal is named so it is not repeated; an accepted one is the new base
    const fb = feedbackOf(id);
    const feedbackText =
      fb.rejected.length + fb.accepted.length === 0
        ? ""
        : `\n\nThe person's feedback on earlier proposals:${fb.accepted.map((f) => `\n- accepted document ${f.document}${f.sentence ? ` (${f.sentence})` : ""}: it is the base now`).join("")}${fb.rejected.map((f) => `\n- rejected document ${f.document}${f.sentence ? ` (${f.sentence})` : ""}: do not propose it or the same change again`).join("")}`;
    // memory across threads (section 9.9): the person's own index, five lines at most, and the group's structural corrections
    const subject = subjectOfConversation(id);
    const index = theNotes().index(subject);
    const corrections = theNotes().institutional(m.id);
    const memoryText =
      (index.length
        ? `\n\nWhat you know of this person's earlier threads (their own notes, newest first):${index.map((l) => `\n- ${l}`).join("")}`
        : "") +
      (corrections.length
        ? `\n\nCorrections the group accepted for this station: ${corrections.map((c) => `on ${c.axis}, the check ${c.check} would now catch it`).join("; ")}.`
        : "");
    return `${def.instructions}${feedbackText}${memoryText}\n\nYou are the ${m.id} station of ${m.app}, at the ${m.ceiling} ceiling, in the ${machine.state.phase} phase. The phases: ${m.phases.initial}${m.phases.transitions.map((t) => ` then ${t.to}`).join("")}. Move with advance. End with settle.`;
  };
  return Object.assign(agent, { agentName: m.id });
}
