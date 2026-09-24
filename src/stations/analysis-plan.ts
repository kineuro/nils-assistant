// SPDX-License-Identifier: AGPL-3.0-only
// analysis-plan (record 49 A5): a person's question about their images
// ("hippocampal volumes in the NMOSD cohort", "lesion load in MS patients
// over time") becomes a run document: whom to run over (a saved selection,
// or the ask a set of cohorts becomes), which analysis at which version,
// its parameters, and the engine's pre-flight of that run (units, missing
// inputs, time, GPU). The model chooses and explains; the host resolves the
// pipeline in the catalog, holds the parameters to the descriptor, writes
// the ask, asks the pre-flight and fills the document, so no number in it
// is the model's. It never starts a run: a person presses Run (R5, D47).

import type { JsonValue } from "@flue/runtime";
import * as v from "valibot";
import type { Seam } from "../seam/client.ts";
import { toolResult } from "../seam/client.ts";
import { type StationDefinition, type StationTool, stationAgent } from "./agent.ts";
import type { Manifest } from "./manifest.ts";
import {
  catalogText,
  cohortDocument,
  cohortsOf,
  cohortsText,
  type Entry,
  entriesOf,
  newest,
  type Preflight,
  paramsFor,
  preflightOf,
  resolve,
  runCommand,
  type Sessions,
  selectionSpec,
} from "./pipelines.ts";
import type { Check, Verdict } from "./verdict.ts";

/**
 * The run document a plan leaves, as the desk reads it from the verdict
 * (`result.run_document`): the pipeline as name@version, whom it runs over
 * (`select`, a saved selection, or `handle`, the stacks the cohorts' ask was
 * frozen into), the parameters with their defaults, the engine's pre-flight,
 * and the person's question with the station's reason. Beside them, what a
 * person's Run needs and nothing it does: the command the job would take,
 * the proposed ask, the measures the ask reads afterwards.
 */
export interface RunDocument {
  question: string;
  why: string;
  pipeline: string;
  select?: string;
  handle?: number;
  params: Record<string, unknown>;
  /** The engine's pre-flight answer, each missing unit said by its reason only (as the engine says it below detail quasi). */
  preflight: Record<string, unknown> | null;
  pipeline_id: number;
  /** The station's own ask, when cohorts named the people: the stored draft, the cohorts, which sessions. */
  proposed?: { document: number; cohorts: string[]; sessions: Sessions };
  /** Why no pre-flight was taken, when none was. */
  preflight_why: string | null;
  /** The job a person's Run queues at POST /api/jobs; never queued by the station. */
  command: string[] | null;
  /** What the ask reads once the run is done. */
  measures: string[];
}

/** The engine's pre-flight with each missing unit said by its reason alone: no unit, subject or day in a verdict. */
export function preflightForDocument(body: unknown): Record<string, unknown> {
  const b = { ...((body ?? {}) as Record<string, unknown>) };
  if (Array.isArray(b.missing))
    b.missing = (b.missing as Record<string, unknown>[]).map((m) => ({ why: m?.why ?? null }));
  return b;
}

interface Held {
  conversation: string;
  document: RunDocument;
  /** The pre-flight read into counts, for the sentence and its check. */
  summary: Preflight | null;
  name: string;
}

/** The plans of this process, by id: the verdict names one and the host fills the document from it. */
const plans = new Map<string, Held>();

export function planById(id: string): Held | undefined {
  return plans.get(id);
}

/** The result with the run document of the plan it names, where this conversation recorded it. */
export function withRun(result: Record<string, unknown>, conversation: string): Record<string, unknown> {
  const id = result.plan;
  const h = typeof id === "string" ? plans.get(id) : undefined;
  if (!h || h.conversation !== conversation) return result;
  return { ...result, run_document: h.document as unknown as Record<string, unknown> };
}

async function read(seam: Seam, path: string, id: string, phase: string): Promise<unknown | null> {
  const a = await seam.call({ method: "GET", path, toolCallId: id, phase });
  return a.kind === "ok" ? a.body : null;
}

/** The catalog, read once per call of the prelude or the plan: the engine's own entries, never a copy. */
/** What a conversation read of the catalog and the cohorts, kept a minute, so a corrected plan does not read them again. */
const readings = new Map<string, { at: number; entries?: Entry[]; cohorts?: unknown }>();
const KEEP_MS = 60_000;

function kept(conversation: string) {
  const k = readings.get(conversation);
  if (k && Date.now() - k.at < KEEP_MS) return k;
  const fresh: { at: number; entries?: Entry[]; cohorts?: unknown } = { at: Date.now() };
  readings.set(conversation, fresh);
  return fresh;
}

async function catalog(
  seam: Seam,
  conversation: string,
  id: string,
  phase: string,
  fresh = false,
): Promise<Entry[] | null> {
  const k = kept(conversation);
  if (k.entries && !fresh) return k.entries;
  const body = await read(seam, "/api/pipelines", id, phase);
  if (body === null) return null;
  k.entries = entriesOf(body);
  return k.entries;
}

async function cohortList(
  seam: Seam,
  conversation: string,
  id: string,
  phase: string,
): Promise<unknown | null> {
  const k = kept(conversation);
  if (k.cohorts !== undefined) return k.cohorts;
  const body = await read(seam, "/api/cohorts", id, phase);
  if (body !== null) k.cohorts = body;
  return body;
}

/** The context every render carries: the analyses with their parameters, measures and checks, and the cohorts. */
export async function analysisContext(
  seam: Seam,
  ctx: { conversation: string; toolCallId: string; phase: string },
): Promise<string> {
  const entries = await catalog(seam, ctx.conversation, ctx.toolCallId, ctx.phase);
  const known = await cohortList(seam, ctx.conversation, `${ctx.toolCallId}-c`, ctx.phase);
  const parts = [
    entries === null
      ? "The pipeline catalog could not be read: pipelines are off here, or this person may not see them."
      : entries.length === 0
        ? "The pipeline catalog is empty."
        : catalogText(entries),
    cohortsText(known === null ? [] : cohortsOf(known)),
  ];
  return parts.join("\n\n");
}

const PLAN_INPUT = v.object({
  question: v.string(),
  pipeline: v.string(),
  params: v.optional(v.record(v.string(), v.unknown())),
  selection: v.optional(v.string()),
  cohorts: v.optional(v.array(v.string())),
  sessions: v.optional(v.picklist(["all", "first", "latest"])),
  why: v.string(),
});

export function analysisPlanTools(): StationTool[] {
  return [
    {
      name: "nils_pipelines",
      description:
        "The pipeline catalog: each analysis with its level, inputs, parameters, measures and checks. Your instructions carry it already; read it again only when they say it could not be read.",
      input: v.object({}),
      phases: ["read"],
      async run(_a, ctx) {
        const entries = await catalog(ctx.seam, ctx.conversation, ctx.toolCallId, ctx.state.phase, true);
        return {
          output: (entries === null
            ? { refused: true, why: "the catalog could not be read" }
            : { text: catalogText(entries) }) as JsonValue,
        };
      },
    },
    {
      name: "nils_cohorts",
      description: "The cohorts by name, with their subjects and sessions counted.",
      input: v.object({}),
      phases: ["read"],
      async run(_a, ctx) {
        const a = await ctx.seam.call({
          method: "GET",
          path: "/api/cohorts",
          toolCallId: ctx.toolCallId,
          phase: ctx.state.phase,
        });
        if (a.kind !== "ok") return toolResult(a);
        return { output: { cohorts: cohortsOf(a.body) } as JsonValue };
      },
    },
    {
      name: "plan_run",
      description:
        "Record the run that answers the question: the pipeline by name (or name@version), its parameters by id (leave one out for its default), and whom it runs over: `selection` naming a saved selection (name@version), or `cohorts` with `sessions` all, first or latest. The host checks the parameters, writes the ask for cohorts, takes the engine's pre-flight and answers the plan id with the document; nothing runs. Then settle with the plan id and your sentence.",
      input: PLAN_INPUT,
      phases: ["read", "plan"],
      salient: ["pipeline", "selection", "cohorts", "sessions", "params"],
      async run(args, ctx) {
        const a = args as v.InferOutput<typeof PLAN_INPUT>;
        const phase = ctx.state.phase;
        const entries = await catalog(ctx.seam, ctx.conversation, `${ctx.toolCallId}-catalog`, phase);
        if (entries === null)
          return {
            output: {
              refused: true,
              why: "the pipeline catalog could not be read; say so, and that a person with pipelines:see can plan it",
            } as JsonValue,
          };
        const entry = resolve(entries, a.pipeline);
        if (!entry)
          return {
            output: {
              refused: true,
              why: `no pipeline ${a.pipeline} in the catalog; it holds ${newest(entries)
                .map((e) => e.label)
                .join(", ")}`,
            } as JsonValue,
          };
        const { params, refused } = paramsFor(entry, a.params);
        if (refused.length > 0) return { output: { refused: true, why: refused.join("; ") } as JsonValue };
        const cohorts = (a.cohorts ?? []).map((c) => c.trim()).filter(Boolean);
        if ((a.selection ? 1 : 0) + (cohorts.length > 0 ? 1 : 0) !== 1)
          return {
            output: {
              refused: true,
              why: "name whom it runs over once: a saved selection, or cohorts; not both, not neither",
            } as JsonValue,
          };
        let proposed: RunDocument["proposed"];
        let over: { select: string } | { handle: number } | null = null;
        let preflightWhy: string | null = null;
        const evidence: { handles: number[]; documents: number[] } = { handles: [], documents: [] };
        if (a.selection) {
          over = { select: selectionSpec(a.selection) };
        } else {
          const known = await cohortList(ctx.seam, ctx.conversation, `${ctx.toolCallId}-cohorts`, phase);
          if (known !== null) {
            const names = cohortsOf(known).map((c) => c.name);
            const unknown = cohorts.filter((c) => !names.includes(c));
            if (unknown.length > 0)
              return {
                output: {
                  refused: true,
                  why: `no cohort named ${unknown.join(", ")}; the cohorts are ${names.join(", ") || "none"}`,
                } as JsonValue,
              };
          }
          const sessions: Sessions = a.sessions ?? "all";
          const doc = cohortDocument(
            cohorts,
            sessions,
            `${sessions === "all" ? "every session" : `the ${sessions} session of each subject`} of ${cohorts.join(" and ")}, for ${entry.name}`,
          );
          const drafted = await ctx.seam.call({
            method: "POST",
            path: "/api/ask/draft",
            body: { text: JSON.stringify(doc) },
            toolCallId: `${ctx.toolCallId}-draft`,
            phase,
          });
          const document = (
            drafted.kind === "ok" ? (drafted.body as { document?: unknown }).document : null
          ) as number | null;
          if (typeof document !== "number")
            return {
              output: {
                refused: true,
                why: `the engine did not take the ask for ${cohorts.join(", ")}: ${JSON.stringify(toolResult(drafted).output).slice(0, 300)}`,
              } as JsonValue,
            };
          evidence.documents.push(document);
          const ran = await ctx.seam.call({
            method: "POST",
            path: "/api/ask/run",
            body: { document_id: document, keep: true, name: `analysis-plan ${entry.name}` },
            toolCallId: `${ctx.toolCallId}-run`,
            phase,
          });
          const body = (ran.kind === "ok" ? ran.body : {}) as { handle?: unknown; truncated?: unknown };
          const handle = typeof body.handle === "number" ? body.handle : null;
          if (handle !== null) evidence.handles.push(handle);
          if (handle === null) preflightWhy = "the ask for the cohorts left no handle to check the run over";
          else if (body.truncated === true)
            preflightWhy =
              "the ask for the cohorts is larger than one bounded answer; save it as a selection and the pre-flight runs over it";
          else over = { handle };
          proposed = { document, cohorts, sessions };
        }
        let preflight: Preflight | null = null;
        let engine: Record<string, unknown> | null = null;
        if (over) {
          const checked = await ctx.seam.call({
            method: "POST",
            path: `/api/pipelines/${encodeURIComponent(entry.label)}/preflight`,
            body: { ...("select" in over ? { select: over.select } : { handle: over.handle }), params },
            toolCallId: `${ctx.toolCallId}-preflight`,
            phase,
          });
          if (checked.kind === "ok") {
            preflight = preflightOf(checked.body);
            engine = preflightForDocument(checked.body);
          } else
            preflightWhy = `the pre-flight was refused: ${JSON.stringify(toolResult(checked).output).slice(0, 300)}`;
        }
        // a saved selection the engine does not know is the person's to name again, not a plan
        if (!preflight && !proposed && preflightWhy)
          return { output: { refused: true, why: preflightWhy } as JsonValue };
        const document: RunDocument = {
          question: a.question,
          why: a.why,
          pipeline: entry.label,
          ...(over && "select" in over ? { select: over.select } : {}),
          ...(over && "handle" in over ? { handle: over.handle } : {}),
          params,
          preflight: engine,
          pipeline_id: entry.id,
          ...(proposed ? { proposed } : {}),
          preflight_why: preflightWhy,
          command: over ? runCommand(entry.label, over, params) : null,
          measures: entry.measures.map((m) => m.field),
        };
        const id = `run-plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        plans.set(id, { conversation: ctx.conversation, document, summary: preflight, name: entry.name });
        const p = preflight;
        return {
          output: {
            plan: id,
            pipeline: entry.label,
            params,
            over: over ?? proposed ?? null,
            preflight: p,
            preflight_why: preflightWhy,
            say: p
              ? `Name ${entry.name} and the ${p.units.ready} of ${p.units.total} units ready in your sentence${p.units.missing ? `, the ${p.units.missing} missing and why` : ""}, the time (${p.estimate.words}), and ${p.ready ? "that it is ready for them to run" : `what blocks it: ${p.blockers.join("; ") || "see the pre-flight"}`}.`
              : `Name ${entry.name} in your sentence and say why no pre-flight was taken: ${preflightWhy}.`,
            text: "The plan is recorded; it runs only when the person presses Run. Settle now with the plan id and one sentence.",
          } as JsonValue,
          evidence,
        };
      },
    },
  ];
}

/** The numbers a sentence must carry: the pipeline's name, and the ready units when a pre-flight was taken. */
function sentenceWants(h: Held): string[] {
  const want = [h.name];
  if (h.summary) want.push(String(h.summary.units.ready));
  return want;
}

export function analysisPlanChecks(): Record<string, Check> {
  const held = (verdict: Verdict, ctx: Record<string, unknown>): Held | string => {
    const id = verdict.result.plan;
    if (typeof id !== "string") return "the verdict names no plan; call plan_run first";
    const h = plans.get(id);
    if (!h) return `no plan ${id} is held; call plan_run again`;
    if (h.conversation !== String(ctx.conversation ?? "")) return `plan ${id} is not this conversation's`;
    return h;
  };
  return {
    no_sql: (verdict: Verdict) =>
      /\bselect\b[\s\S]{0,600}?\bfrom\b|\b(?:insert\s+into|delete\s+from|update\s+\w+\s+set|create\s+table|drop\s+table)\b/iu.test(
        JSON.stringify(verdict.result),
      )
        ? "the verdict carries SQL"
        : null,
    /** The verdict names a plan this conversation recorded. */
    planned: (verdict, ctx) => {
      const h = held(verdict, ctx);
      return typeof h === "string" ? h : null;
    },
    /** The plan carries the engine's pre-flight, or says why it could not. */
    preflight_read: (verdict, ctx) => {
      const h = held(verdict, ctx);
      if (typeof h === "string") return null;
      return h.document.preflight || h.document.preflight_why ? null : "the plan carries no pre-flight";
    },
    /** The sentence names the analysis and the engine's count, never a number of its own making. */
    sentence_true: (verdict, ctx) => {
      const h = held(verdict, ctx);
      if (typeof h === "string") return null;
      const sentence = String(verdict.result.sentence ?? "");
      const missing = sentenceWants(h).filter((w) => !sentence.includes(w));
      return missing.length === 0
        ? null
        : `the sentence does not say ${missing.join(" or ")}; restate the plan with the pre-flight's own numbers`;
    },
    /** A station never starts a run: the verdict carries no job. */
    runs_nothing: (verdict) =>
      "job" in verdict.result || "run_id" in verdict.result
        ? "the verdict names a job; a plan is a document a person runs"
        : null,
  };
}

export function analysisPlan(
  manifest: Manifest,
  brief: string,
  model: string,
): ReturnType<typeof stationAgent> {
  const def: StationDefinition = {
    manifest,
    brief,
    model,
    instructions:
      "You are analysis-plan. A person asks a question about their images; you choose the analysis in the catalog that answers it, its parameters, and whom it runs over, call plan_run once, and settle with the plan id and one sentence that explains the choice in the person's words and restates the pre-flight's numbers. You run nothing: the person presses Run. Never a number the tools did not give you, never SQL, never a subject's code or date.",
    tools: analysisPlanTools(),
    checks: analysisPlanChecks(),
    briefInline: true,
    advance: false,
    settle: { phases: ["plan", "finish"] },
    context: (seam, ctx) => analysisContext(seam, ctx),
    // the run document, filled from the held plan: mechanical, never the model's words
    complete: async (result, ctx) => withRun(result, ctx.conversation),
  };
  return stationAgent(def);
}
