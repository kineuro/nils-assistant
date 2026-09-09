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
  useModel,
  usePersistentState,
  useResponseFinish,
  useSkill,
  useTool,
} from "@flue/runtime";
import * as v from "valibot";
import { providerId } from "../providers/kvasir.ts";
import type { Seam } from "../seam/client.ts";
import { seamFor } from "../seam/for.ts";
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
          result: data.result as Record<string, unknown>,
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

    return `${def.instructions}\n\nYou are the ${m.id} station of ${m.app}, at the ${m.ceiling} ceiling, in the ${machine.state.phase} phase. The phases: ${m.phases.initial}${m.phases.transitions.map((t) => ` then ${t.to}`).join("")}. Move with advance. End with settle.`;
  };
  return Object.assign(agent, { agentName: m.id });
}
