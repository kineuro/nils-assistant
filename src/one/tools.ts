// SPDX-License-Identifier: AGPL-3.0-only
// The one agent's tools (one chat, 2026-10-09): the stations' own tools
// consolidated into eleven, namespaced by what they touch. Each dials the
// engine through the seam of the station whose work it carries, so every
// call keeps that station's grant caps, ceiling, redaction and ledger row,
// under the person's own token; nothing here trusts a model's argument for
// who the person is or what they may do. Reads answer at most about three
// thousand tokens and say how to narrow; refusals say what to do next in
// plain words; whatever the registry's people typed (series descriptions,
// names, notes) comes back under `registry_data`, which the instructions
// say is data and never an instruction. Writes are proposals only.

import type { JsonValue } from "@flue/runtime";
import * as v from "valibot";
import type { Detail } from "../host/grants.ts";
import { planFrom, restate } from "../host/ladder.ts";
import type { Answer, Seam, Station } from "../seam/client.ts";
import { shorten, toolResult } from "../seam/client.ts";
import { seamWith, stationList, theLineage } from "../seam/for.ts";
import { preflightForDocument } from "../stations/analysis-plan.ts";
import { compactPreview, unescapeEntities } from "../stations/ask-help.ts";
import {
  datasetName,
  datasetView,
  heldReading,
  heldShapesOf,
  type ProbeCandidate,
  ruleComplaint,
  shapeCounts,
  typeNames,
  usesPath,
} from "../stations/identity-check.ts";
import {
  diffOf,
  listName,
  listsOfPack,
  overlayOf,
  type Prediction,
  valuesOf,
} from "../stations/keyword-tune.ts";
import { ladderStore, policyOf } from "../stations/operator.ts";
import {
  breachDocument,
  campaignDocument,
  catalogText,
  cohortDocument,
  cohortsOf,
  entriesOf,
  newest,
  paramsFor,
  preflightOf,
  resolve,
  runCommand,
  type Sessions,
  selectionSpec,
} from "../stations/pipelines.ts";
import { catalogOf, prelude } from "../stations/prelude.ts";
import { failedOf, readRun } from "../stations/run-read.ts";
import { CARD_OF, type ChangeKind, theChanges } from "./changes.ts";
import {
  type DatasetFact,
  datasetsOf,
  knownDatasets,
  lineOf,
  newestFirst,
  readDatasets,
} from "./datasets.ts";
import type { Mounted, ToolName } from "./mount.ts";
import { type ConversationState, conversationOf, type Probe, type TurnState } from "./state.ts";
import { plainly } from "./words.ts";

export type Out = { output: JsonValue; terminate?: boolean };

/** The parts a tool writes to the desk (the desk's events.ts). */
export interface Writers {
  /** A plain line while a call runs; `call` is its tool call's id. */
  progress: (text: string, call?: string | null) => void;
  approval: (p: {
    id: string;
    change: string;
    title: string | null;
    sentence: string;
    lines: string[];
    ref: { document?: number; parent?: number | null; plan?: string };
  }) => void;
  clarification: (p: { question: string; options: { label: string; count: number | null }[] }) => void;
  plan: (items: { text: string; status: string }[]) => void;
}

export interface ToolCtx {
  conversation: string;
  subject: string;
  toolCallId: string;
  turn: TurnState;
  convo: ConversationState;
  mounted: Mounted;
  write: Writers;
}

export interface OneTool {
  name: ToolName;
  description: string;
  input: v.GenericSchema<Record<string, unknown>, unknown>;
  /** The argument keys the repeat detector reads; every key when absent. */
  salient?: string[];
  /** The line the desk shows while it runs. */
  step: string;
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<Out>;
}

/** About three thousand tokens: a result above it is shortened and says how to narrow. */
export const RESULT_CHARS = 12_000;

const PHASE = "turn";

/** The stations whose seams the tools dial, by the work they carry. */
export const SEAMS = [
  "ask-help",
  "operator",
  "analysis-plan",
  "run-read",
  "keyword-tune",
  "identity-check",
] as const;
type SeamId = (typeof SEAMS)[number];

/**
 * The one agent's seam for the work of one station: the station's own operations, ceiling and content class,
 * under the name `nils.<station>`, with each cap four times the station's (at least twelve). A station's caps
 * bound one run of one task; a turn of the one agent may carry several steps of one skill, and its own guards
 * (the turn cap, the repeat detector) bound the turn.
 */
const derived = new Map<string, Station>();
export function oneSeam(id: SeamId, conversation: string): Seam {
  let st = derived.get(id);
  if (!st) {
    const base = stationList().find((s) => s.id === id);
    if (!base) throw new Error(`the work of ${id} is not configured here`);
    const grant = Object.fromEntries(
      Object.entries(base.grant).map(([op, cap]) => [
        op,
        { ...cap, ...(cap.calls !== undefined ? { calls: Math.max(12, cap.calls * 4) } : {}) },
      ]),
    );
    st = { ...base, id: `nils.${id}`, grant, purpose: undefined };
    derived.set(id, st);
  }
  return seamWith(st, conversation);
}

function seam(ctx: ToolCtx, id: SeamId): Seam {
  return oneSeam(id, ctx.conversation);
}

/** Registry content, marked as data. */
function data(value: unknown, narrow: string): JsonValue {
  const v = (value ?? null) as JsonValue;
  const short = shorten(v, RESULT_CHARS);
  const cut = JSON.stringify(short).length < JSON.stringify(v).length;
  return cut ? { registry_data: short, shortened: true, narrow } : { registry_data: short };
}

export function refuse(why: string, next: string, extra: Record<string, JsonValue> = {}): Out {
  return { output: { refused: true, why: plainly(why), next, ...extra } };
}

/** An answer that is not ok, as a refusal in plain words with the next step. */
function notOk(a: Answer, next: string): Out {
  const o = toolResult(a).output as Record<string, unknown>;
  let why: string;
  if (a.kind === "blocked") why = a.reason;
  else if (a.kind === "error")
    why = a.reason === "token_unavailable" ? "the person's sign-in was not at hand" : a.reason;
  else if (a.kind === "refused") {
    const err = o.error;
    why = `the registry refused it (${a.status})${err ? `: ${typeof err === "string" ? err : JSON.stringify(err).slice(0, 300)}` : ""}`;
    if (a.status === 403)
      next = "Say in one sentence that this person's account cannot do that, and that an admin can give it.";
  } else why = "no answer";
  return refuse(why, next);
}

const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

const documentOf = (a: Answer): number | null =>
  a.kind === "ok" ? num((a.body as { document?: unknown } | null)?.document) : null;

// ------------------------------------------------------------------ the registry

async function summaryText(ctx: ToolCtx): Promise<string> {
  try {
    return await prelude(seam(ctx, "ask-help"), ctx.subject, {
      toolCallId: `${ctx.toolCallId}-summary`,
      phase: PHASE,
    });
  } catch {
    return "";
  }
}

const PARTS: Record<string, RegExp> = {
  cohorts: /cohort/iu,
  scores: /kind|score|disease|course/iu,
  scans: /ax[ie]s|stack|derived/iu,
  fields: /field|level|grain|- /iu,
};

const registrySummary: OneTool = {
  name: "registry_summary",
  description:
    "What the registry holds: the cohorts with their sizes, the clinical scores and event kinds, the disease courses, the kinds of scans (their sorting values), the fields of each level. The turn's facts already carry it; call this only when they say it could not be read, or to see one part again (part: cohorts, scores, scans or fields).",
  input: v.object({ part: v.optional(v.picklist(["all", "cohorts", "scores", "scans", "fields"])) }),
  step: "Looking in the registry",
  async run(args, ctx) {
    const text = await summaryText(ctx);
    if (!text)
      return refuse(
        "the registry's summary is not open to this person",
        "Say in one sentence that their account cannot look into the registry here, and that an admin can give it.",
      );
    const part = str(args.part);
    const re = part && part !== "all" ? PARTS[part] : null;
    const lines = re ? text.split("\n").filter((l) => re.test(l)) : text.split("\n");
    return { output: data(lines.join("\n"), "ask for one part: cohorts, scores, scans or fields") };
  },
};

/** The names of the registry that hold any of the words: fields, sorting values, kinds, cohorts, datasets, derived fields. */
export function searchCatalog(
  cat: ReturnType<typeof catalogOf>,
  words: string,
  datasets: readonly DatasetFact[] = [],
): string[] {
  const ws = words
    .toLowerCase()
    .split(/[^a-z0-9.+-]+/u)
    .filter((w) => w.length >= 2);
  const hit = (s: string) => ws.some((w) => s.toLowerCase().includes(w));
  const out: string[] = [];
  for (const l of cat?.levels ?? [])
    for (const f of l.fields) if (hit(f.path)) out.push(`field ${f.path} of ${l.level} (${f.type})`);
  for (const a of cat?.axes ?? [])
    for (const x of a.values)
      if (hit(x.id) || hit(x.label ?? "") || hit(a.name))
        out.push(`scan sorting ${a.name} = ${x.id}${x.label ? ` (${x.label})` : ""}`);
  for (const k of cat?.kinds ?? [])
    if (hit(k.name)) out.push(`event kind ${k.name}${k.unit ? ` in ${k.unit}` : ""}`);
  for (const c of cat?.cohorts ?? [])
    if (hit(c.name)) out.push(`cohort ${c.name} (${c.members ?? "?"} members)`);
  // a dataset is where scans came from, never a cohort: its line carries its counts
  for (const d of datasets) if (hit(d.name)) out.push(`dataset ${lineOf(d)}`);
  // a name the ask's catalog lists whose counts the facts do not hold
  for (const n of cat?.datasets ?? [])
    if (hit(n) && !datasets.some((d) => d.name === n)) out.push(`dataset ${n}`);
  for (const d of cat?.derived ?? []) if (hit(d.name)) out.push(`derived ${d.name} (${d.grain})`);
  for (const d of cat?.diseases ?? [])
    for (const c of d.courses ?? []) if (hit(c) || hit(d.name)) out.push(`course ${c} of ${d.name}`);
  return [...new Set(out)].slice(0, 40);
}

/** The datasets a person's turn read; read now when none were. */
async function datasetsFor(ctx: ToolCtx): Promise<DatasetFact[]> {
  const have = knownDatasets(ctx.subject);
  if (have) return have;
  try {
    const r = await readDatasets({
      key: ctx.subject,
      sources: () => seam(ctx, "identity-check"),
      cohorts: () => seam(ctx, "analysis-plan"),
      toolCallId: `${ctx.toolCallId}-datasets`,
      phase: PHASE,
    });
    return r.kind === "ok" ? r.list : [];
  } catch {
    return [];
  }
}

const registrySearch: OneTool = {
  name: "registry_search",
  description:
    "Find the registry's own names for the person's words: fields, sorting values of scans (base, technique, modifier and the others), event kinds, cohorts, datasets (with their counts), derived fields, disease courses. Give `words`. With `level` and `field` instead, a sample of what one field holds (at most 20 values).",
  input: v.object({
    words: v.optional(v.string()),
    level: v.optional(v.string()),
    field: v.optional(v.string()),
    limit: v.optional(v.number()),
  }),
  salient: ["words", "level", "field"],
  step: "Looking in the registry",
  async run(args, ctx) {
    const level = str(args.level);
    const field = str(args.field);
    if (level && field) {
      const name = field.replace(/^axis\./u, "");
      const axis = catalogOf(ctx.subject)?.axes?.find((a) => a.name === name);
      if (axis) return { output: data({ sorting: axis.name, values: axis.values.map((x) => x.id) }, "") };
      const limit = Math.min(20, Math.max(1, Number(args.limit ?? 20)));
      const a = await seam(ctx, "ask-help").call({
        method: "GET",
        path: `/api/ask/catalog/${encodeURIComponent(level)}/${encodeURIComponent(field)}/values?limit=${limit}`,
        toolCallId: ctx.toolCallId,
        phase: PHASE,
        rows: limit,
      });
      return a.kind === "ok"
        ? { output: data(a.body, "ask for fewer values") }
        : notOk(a, "Check the level and the field against the registry summary, and ask again.");
    }
    const words = str(args.words);
    if (!words) return refuse("nothing to look for", "Give words, or a level and a field.");
    if (!catalogOf(ctx.subject)) await summaryText(ctx);
    const found = searchCatalog(catalogOf(ctx.subject), words, await datasetsFor(ctx));
    return found.length
      ? { output: data(found, "use fewer or more exact words") }
      : refuse(
          `the registry has no name like ${words}`,
          "Say so plainly, naming the closest names the summary lists, or try other words.",
        );
  },
};

const DESCRIBE = [
  "document",
  "documents",
  "batches",
  "cohorts",
  "pipelines",
  "pipeline",
  "datasets",
  "dataset",
  "identifier_types",
  "held",
  "signals",
  "word_lists",
  "review",
] as const;

async function get(ctx: ToolCtx, id: SeamId, path: string, rows?: number): Promise<Answer> {
  return seam(ctx, id).call({ method: "GET", path, toolCallId: ctx.toolCallId, phase: PHASE, rows });
}

/** The signals of a scope read and remembered: the review groups and the values per axis, for the tune's check. */
function noteSignals(c: ConversationState, body: unknown): void {
  const b = (body ?? {}) as {
    axes?: Record<string, { open_review?: Record<string, number>; by_value?: unknown }>;
    open_review?: Record<string, number>;
    by_value?: Record<string, unknown>;
  };
  const note = (axis: string, byValue: unknown) => {
    const set = c.values.get(axis) ?? new Set<string>();
    for (const x of valuesOf(byValue)) set.add(x);
    if (set.size) c.values.set(axis, set);
  };
  for (const [axis, ax] of Object.entries(b.axes ?? {})) {
    for (const g of Object.keys(ax.open_review ?? {})) c.groups.add(g);
    note(axis, ax.by_value);
  }
  for (const [axis, byValue] of Object.entries(b.by_value ?? {})) note(axis, byValue);
  for (const g of Object.keys(b.open_review ?? {})) c.groups.add(g);
}

const registryDescribe: OneTool = {
  name: "registry_describe",
  description:
    "Read one kind of thing the registry keeps, by `what`: document (a stored question by `id`, with its parent), documents (the stored questions), batches (the newest batches), cohorts (with their subjects and sessions counted), pipelines (the analyses with their parameters, measures and checks) or pipeline (one by `name`), datasets (each with its state, its subjects, visits and scans, and the cohort it feeds) or dataset (by `name`: those counts, what arrives, its identity rule, what is held), identifier_types, held (the identifiers a dataset holds as shapes, by `name`), signals (the sorting's signals over a `scope` such as batch:12), word_lists (the sorting's word lists, `axis` to narrow), review (the open review items, or one by `id`).",
  input: v.object({
    what: v.picklist(DESCRIBE),
    id: v.optional(v.number()),
    name: v.optional(v.string()),
    scope: v.optional(v.string()),
    axis: v.optional(v.string()),
  }),
  salient: ["what", "id", "name", "scope", "axis"],
  step: "Looking in the registry",
  async run(args, ctx) {
    const what = String(args.what);
    const id = num(args.id);
    const name = str(args.name);
    const again = "Check what you asked for and ask again with one change.";
    switch (what) {
      case "document": {
        if (id === null) return refuse("a document is read by its id", "Give `id`.");
        const a = await get(ctx, "ask-help", `/api/ask/documents/${id}`);
        return a.kind === "ok"
          ? { output: { document: id, ...(data(a.body, "") as object) } }
          : notOk(a, again);
      }
      case "documents": {
        const a = await get(ctx, "operator", "/api/ask/documents");
        return a.kind === "ok" ? { output: data(a.body, "ask for one document by its id") } : notOk(a, again);
      }
      case "batches": {
        const a = await get(ctx, "operator", "/api/batches?limit=20");
        return a.kind === "ok" ? { output: data(a.body, "") } : notOk(a, again);
      }
      case "cohorts": {
        const a = await get(ctx, "analysis-plan", "/api/cohorts");
        return a.kind === "ok" ? { output: data(cohortsOf(a.body), "") } : notOk(a, again);
      }
      case "pipelines":
      case "pipeline": {
        const a = await get(ctx, "analysis-plan", "/api/pipelines");
        if (a.kind !== "ok")
          return notOk(
            a,
            "Say the analyses could not be read, and that a person who may see them can plan it.",
          );
        const entries = entriesOf(a.body);
        if (what === "pipeline") {
          const e = name ? resolve(entries, name) : null;
          if (!e)
            return refuse(
              `no analysis named ${name ?? "(none)"}`,
              `Name one of ${newest(entries)
                .map((x) => x.name)
                .join(", ")}.`,
            );
          return { output: data(catalogText([e]), "") };
        }
        return { output: data(catalogText(newest(entries)), "ask for one analysis by name") };
      }
      case "datasets":
      case "dataset": {
        const a = await get(ctx, "identity-check", "/api/sources?recent=1");
        if (a.kind !== "ok") return notOk(a, again);
        const body = a.body as { sources?: unknown } | unknown[];
        const list = (Array.isArray(body) ? body : (body?.sources ?? [])) as Record<string, unknown>[];
        const names = list.map((s) => String(s?.name ?? s?.place ?? "")).filter(Boolean);
        const facts = datasetsOf(a.body);
        if (what === "datasets" || !name)
          return {
            output: data(
              {
                datasets: newestFirst(facts).map(lineOf),
                note: "a dataset's counts in all are these; a question names a dataset with the field dataset",
              },
              "ask for one dataset by name",
            ),
          };
        const one = datasetName(name);
        const found = list.find((s) => String(s?.name ?? s?.place ?? "") === one);
        const fact = facts.find((f) => f.name === one);
        return found
          ? {
              output: data(
                {
                  ...datasetView(found),
                  ...(fact
                    ? {
                        state: fact.state,
                        counts: {
                          subjects: fact.subjects,
                          visits: fact.visits,
                          scans: fact.scans,
                          sure: fact.sure,
                          need_a_look: fact.look,
                          not_sorted_yet: fact.unsorted,
                        },
                        feeds: fact.feeds,
                      }
                    : {}),
                  note: "a question names it with the field dataset",
                },
                "",
              ),
            }
          : refuse(
              `no dataset named ${name}`,
              `Name one of ${names.join(", ") || "none"}, or say there is none.`,
            );
      }
      case "identifier_types": {
        const a = await get(ctx, "identity-check", "/api/linkage/types");
        if (a.kind !== "ok") return notOk(a, again);
        ctx.convo.types = typeNames(a.body);
        return { output: data(a.body, "") };
      }
      case "held": {
        const one = datasetName(name);
        if (!one) return refuse("held identifiers are read for one dataset, by its name", "Give `name`.");
        const a = await get(ctx, "identity-check", `/api/linkage/held?place=${encodeURIComponent(one)}`);
        if (a.kind !== "ok") return notOk(a, again);
        const held = heldShapesOf(a.body);
        ctx.convo.held.set(one, held);
        return { output: data({ dataset: one, held }, "") };
      }
      case "signals": {
        const scope = str(args.scope);
        if (!scope) return refuse("the signals are read over a scope", "Give `scope`, such as batch:12.");
        const a = await get(
          ctx,
          "keyword-tune",
          `/api/classify/signals?scope=${encodeURIComponent(scope).replace(/%3A/giu, ":")}`,
        );
        if (a.kind !== "ok") return notOk(a, again);
        noteSignals(ctx.convo, a.body);
        return { output: data(a.body, "name one axis next time you rehearse") };
      }
      case "word_lists": {
        const pack = name ?? "mri";
        const a = await get(ctx, "keyword-tune", `/api/packs/${encodeURIComponent(pack)}`);
        if (a.kind !== "ok") return notOk(a, again);
        const lists = listsOfPack(a.body);
        for (const [k, w] of lists) ctx.convo.packLists.set(k, w);
        const axis = str(args.axis);
        const shown = [...lists].filter(([k]) => !axis || k.startsWith(`${axis}.`) || !k.includes("."));
        return { output: data(Object.fromEntries(shown.map(([k, w]) => [k, w])), "name one `axis`") };
      }
      case "review": {
        const a = await get(ctx, "keyword-tune", id === null ? "/api/review" : `/api/review/${id}`);
        return a.kind === "ok" ? { output: data(a.body, "ask for one item by its id") } : notOk(a, again);
      }
    }
    return refuse(`nothing is described as ${what}`, `Use one of ${DESCRIBE.join(", ")}.`);
  },
};

// ------------------------------------------------------------------ questions of the registry

const queryDraft: OneTool = {
  name: "query_draft",
  description:
    "Store a whole question of the registry written as a YAML document (the find-data skill says how). It is repaired where it can be and stored when it validates; the answer carries the stored `document` id, its diagnosis (what each set kept) and a preview (the count, or the first rows). A refused draft names the path and the issue: fix exactly that and draft again.",
  input: v.object({ text: v.string() }),
  salient: ["text"],
  step: "Writing the query",
  async run(args, ctx) {
    const s = seam(ctx, "ask-help");
    const drafted = await s.door(
      "/api/ask/draft",
      "POST",
      { text: unescapeEntities(String(args.text)) },
      { toolCallId: ctx.toolCallId, phase: PHASE },
    );
    const document = documentOf(drafted);
    if (document === null) {
      if (drafted.kind === "ok" || drafted.kind === "refused")
        return refuse(
          "the draft did not validate",
          "Fix exactly the path and issue named, and draft the whole document again.",
          {
            issues: shorten(toolResult(drafted).output, 4000),
          },
        );
      return notOk(drafted, "Draft again.");
    }
    ctx.turn.drafted.push(document);
    ctx.convo.documents.push(document);
    ctx.write.progress("Counting the answer");
    const previewed = await s.door(
      "/api/ask/preview",
      "POST",
      { document_id: document, rows: 10 },
      { toolCallId: `${ctx.toolCallId}-preview`, phase: PHASE, rows: 10 },
    );
    const body = (drafted.kind === "ok" ? drafted.body : {}) as Record<string, unknown>;
    return {
      output: {
        document,
        diagnosis: shorten((body.diagnosis ?? null) as JsonValue, 3000),
        preview:
          previewed.kind === "ok"
            ? (data(compactPreview(previewed.body), "") as JsonValue)
            : { unavailable: previewed.kind === "blocked" ? plainly(previewed.reason) : previewed.kind },
        repairs: shorten((body.repairs ?? null) as JsonValue, 1500),
      },
    };
  },
};

const RUN_WHAT = ["document", "sorting_words", "identity_rules"] as const;

/** The overlay's own scope, from the scope rehearsed over: a batch by its id, an origin by its manufacturer. */
export function overlayScope(scope: string): Record<string, string> {
  const [kind, rest] = [scope.slice(0, scope.indexOf(":")), scope.slice(scope.indexOf(":") + 1)];
  if (kind === "batch" && rest) return { batch: rest };
  if (kind === "origin" && rest) return { manufacturer: rest };
  if (["manufacturer", "model", "station"].includes(kind) && rest) return { [kind]: rest };
  return {};
}

async function rehearseWords(args: Record<string, unknown>, ctx: ToolCtx): Promise<Out> {
  const scope = str(args.scope);
  const axis = str(args.axis);
  const bucket = str(args.bucket);
  const value = str(args.value);
  const caseText = str(args.case_text);
  const caseValue = str(args.case_value);
  if (!scope || !axis)
    return refuse("a rehearsal names the scope and the axis", "Give `scope` (such as batch:12) and `axis`.");
  if ((bucket === null) === (value === null))
    return refuse(
      "a rehearsal changes one list: a bucket the sorting names, or the list of one value",
      "Give `bucket`, or `value`, one of the two.",
    );
  if (!caseText || !caseValue)
    return refuse(
      "a rehearsal carries one case",
      "Give `case_text` (a series description with the word) and `case_value` (the value it must get).",
    );
  const add = ((args.add as string[] | undefined) ?? [])
    .map((t) => String(t).trim().toLowerCase())
    .filter(Boolean);
  const remove = ((args.remove as string[] | undefined) ?? [])
    .map((t) => String(t).trim().toLowerCase())
    .filter(Boolean);
  if (add.length + remove.length === 0)
    return refuse("a rehearsal adds or removes at least one word", "Give `add` with the word.");
  const s = seam(ctx, "keyword-tune");
  // the signals and the list itself, read once per conversation, so a word the list holds is never added
  if (ctx.convo.groups.size === 0 && ctx.convo.values.size === 0) {
    const a = await s.call({
      method: "GET",
      path: `/api/classify/signals?scope=${encodeURIComponent(scope).replace(/%3A/giu, ":")}`,
      toolCallId: `${ctx.toolCallId}-signals`,
      phase: PHASE,
    });
    if (a.kind === "ok") noteSignals(ctx.convo, a.body);
  }
  const list = listName(axis, bucket, value);
  if (!ctx.convo.packLists.has(list)) {
    const a = await s.call({
      method: "GET",
      path: "/api/packs/mri",
      toolCallId: `${ctx.toolCallId}-pack`,
      phase: PHASE,
    });
    if (a.kind === "ok") for (const [k, w] of listsOfPack(a.body)) ctx.convo.packLists.set(k, w);
  }
  if (value !== null) {
    const known = [...(ctx.convo.values.get(axis) ?? [])];
    if (known.length > 0 && !known.includes(value))
      return refuse(
        `${value} is not a value the sorting reports on ${axis}`,
        `Use one of ${known.join(", ")}.`,
      );
  }
  const words = ctx.convo.packLists.get(list);
  if (words) {
    const held = add.filter((t) => words.includes(t));
    if (held.length)
      return refuse(
        `${list} already holds ${held.join(", ")}`,
        "Add a word it does not hold: the person's own word, or one the signals show unused.",
      );
    const missing = remove.filter((t) => !words.includes(t));
    if (missing.length)
      return refuse(`${list} does not hold ${missing.join(", ")}`, "Remove only a word the list holds.");
  }
  // the prediction is written before the rehearsal: the check reads the order from this record
  const prediction: Prediction = {
    axis,
    bucket,
    value,
    list,
    add,
    remove,
    flip: ((args.flip as string[] | undefined) ?? []).map(String),
    must_not_regress: ((args.must_not_regress as string[] | undefined) ?? []).map(String),
    at: Date.now(),
  };
  const overlay = overlayOf(prediction, overlayScope(scope), caseText, caseValue);
  ctx.write.progress("Rehearsing the sorting words, writing nothing");
  const a = await s.call({
    method: "POST",
    path: "/api/classify/try",
    body: { overlay, scope, sample: Number(args.sample ?? 2000) },
    toolCallId: ctx.toolCallId,
    phase: PHASE,
  });
  if (a.kind !== "ok") return notOk(a, "Correct the one thing named and rehearse again.");
  const tried = a.body as Parameters<typeof diffOf>[1];
  const diff = diffOf(prediction, tried);
  ctx.convo.rehearsal = {
    prediction,
    scope,
    case_text: caseText,
    case_value: caseValue,
    overlay,
    diff,
    at: Date.now(),
  };
  return {
    output: {
      list,
      diff: diff as unknown as JsonValue,
      tried: data(tried, "") as JsonValue,
      next:
        diff.verdict === "keep"
          ? "It holds: propose it with propose_change, kind overlay, and say in one sentence what it changes."
          : diff.verdict === "partial"
            ? `Partly: ${diff.why}. Narrow the change and rehearse once more, or propose it saying what is left.`
            : `It does not hold: ${diff.why}. Say so and propose nothing.`,
    },
  };
}

/** The current rule of a dataset as the sources door declares it, or the default. */
function currentRule(view: Record<string, unknown> | null): Record<string, unknown> {
  const id = (view?.identity ?? null) as Record<string, unknown> | null;
  const rule =
    (id && typeof id === "object" && "rule" in id ? (id.rule as Record<string, unknown>) : id) ?? null;
  if (rule && typeof rule === "object" && Array.isArray(rule.from)) return rule;
  return { id_type: "patient-id", from: [{ field: "PatientID" }] };
}

/** A candidate rule from the person's words: a path segment, or a DICOM keyword. */
function candidateRule(
  candidate: string | null,
  current: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!candidate) return null;
  const seg = /\bpath\b|\bfolder\b|\bsegment\s*(\d+)?/iu.exec(candidate);
  if (seg)
    return { id_type: "subject-code", code: "verbatim", from: [{ path: { segment: Number(seg[1] ?? 1) } }] };
  const field = /^[A-Z][A-Za-z]+$/u.test(candidate) ? candidate : null;
  if (field && JSON.stringify(current).includes(`"${field}"`)) return null;
  return field ? { id_type: String(current.id_type ?? "patient-id"), from: [{ field }] } : null;
}

/** The pairs of subjects a conversation's dataset probes found alike, once each. */
export function alikePairs(
  c: ConversationState,
): { subjects: [string, string]; agree: string[]; visits: { shared: number; of: [number, number] } }[] {
  const out: {
    subjects: [string, string];
    agree: string[];
    visits: { shared: number; of: [number, number] };
  }[] = [];
  const seen = new Set<string>();
  for (const p of c.probes)
    for (const cand of p.candidates ?? [])
      for (const pair of cand.alike?.pairs ?? []) {
        if (!Array.isArray(pair?.subjects) || pair.subjects.length !== 2) continue;
        const key = [...pair.subjects].sort().join("\u0000");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(pair);
      }
  return out;
}

/** What a finished probe says, for the model: per rule the shapes and counts, the held reading against the first rule, the pairs alike. */
export function probeReading(c: ConversationState, p: Probe): Record<string, unknown> {
  const saw = (p.candidates ?? []).map((cand: ProbeCandidate, i) => ({
    rule: p.rules[i] ?? cand.rule ?? null,
    shapes: shapeCounts(cand),
    sources: (cand.sources ?? []).map((s) => ({ source: s.source ?? null, answered: s.answered ?? null })),
  }));
  const held = c.held.get(p.dataset) ?? null;
  const first = p.candidates?.[0];
  const reading = held === null ? null : heldReading(held, first ? shapeCounts(first) : null);
  const pairs = alikePairs(c);
  const say: string[] = [];
  if (reading?.map_needed)
    say.push(
      "identifiers of the rule's own kind are held: say a map is needed to release them, not a rule change",
    );
  if (reading?.reading === "second_kind" || reading?.reading === "mixed")
    say.push("a held shape is unlike the rule's: say a second kind of identifier is on this dataset");
  if (reading?.reading === "none") say.push("nothing is held on this dataset");
  if (pairs.length)
    say.push(
      `the probe found ${pairs.length === 1 ? "two subjects" : `${pairs.length} pairs of subjects`} alike: propose their merge with propose_change, kind identity_merge, for a person to make`,
    );
  return {
    dataset: p.dataset,
    job: p.job,
    saw,
    held:
      held === null
        ? null
        : {
            shapes: held.map((h) => ({ shape: h.shape, files: h.files })),
            reading: reading?.reading ?? null,
          },
    map_needed: reading?.map_needed ?? null,
    alike: pairs,
    say: say.join("; ") || "say which source the rule reads and the shape it saw",
  };
}

async function readJob(ctx: ToolCtx, job: number, callId: string): Promise<Answer> {
  return seam(ctx, "identity-check").call({
    method: "GET",
    path: `/api/jobs/${job}`,
    toolCallId: callId,
    phase: PHASE,
  });
}

/** Keep a finished probe's candidates; true when the job is done. */
function keepProbe(p: Probe, body: unknown): boolean {
  const b = (body ?? {}) as { state?: string; result?: { candidates?: unknown } | null };
  if (b.state === "done" && Array.isArray(b.result?.candidates)) {
    p.candidates = b.result.candidates as ProbeCandidate[];
    return true;
  }
  return false;
}

async function probeIdentity(args: Record<string, unknown>, ctx: ToolCtx): Promise<Out> {
  const dataset = datasetName(args.dataset);
  if (!dataset)
    return refuse(
      "an identity check reads one dataset, by its name",
      "Give `dataset`; registry_describe with what datasets lists them.",
    );
  const s = seam(ctx, "identity-check");
  ctx.write.progress("Reading what the dataset declares");
  const src = await s.call({
    method: "GET",
    path: "/api/sources",
    toolCallId: `${ctx.toolCallId}-sources`,
    phase: PHASE,
  });
  if (src.kind !== "ok") return notOk(src, "Say the datasets could not be read.");
  const body = src.body as { sources?: unknown } | unknown[];
  const list = (Array.isArray(body) ? body : (body?.sources ?? [])) as Record<string, unknown>[];
  const found = list.find((x) => String(x?.name ?? x?.place ?? "") === dataset);
  if (!found)
    return refuse(
      `no dataset named ${dataset}`,
      `Name one of ${
        list
          .map((x) => String(x?.name ?? x?.place ?? ""))
          .filter(Boolean)
          .join(", ") || "none"
      }, or say there is none.`,
    );
  const view = datasetView(found);
  let rules = Array.isArray(args.rules) ? (args.rules as Record<string, unknown>[]) : [];
  if (rules.length === 0) {
    const current = currentRule(view);
    const cand = candidateRule(str(args.candidate), current);
    rules = [
      current,
      cand ?? { id_type: String(current.id_type ?? "patient-id"), from: [{ field: "PatientName" }] },
    ];
  }
  for (const [i, r] of rules.entries()) {
    const bad = ruleComplaint(r);
    if (bad)
      return refuse(
        `rule ${i + 1}: ${bad}`,
        "Fix that rule, or leave `rules` out and the current rule and one candidate are probed.",
      );
  }
  if (rules.length < 2) rules.push({ id_type: "patient-id", from: [{ field: "PatientID" }] });
  if (ctx.convo.types === null) {
    const t = await s.call({
      method: "GET",
      path: "/api/linkage/types",
      toolCallId: `${ctx.toolCallId}-types`,
      phase: PHASE,
    });
    if (t.kind === "ok") ctx.convo.types = typeNames(t.body);
  }
  if (!ctx.convo.held.has(dataset)) {
    const h = await s.call({
      method: "GET",
      path: `/api/linkage/held?place=${encodeURIComponent(dataset)}`,
      toolCallId: `${ctx.toolCallId}-held`,
      phase: PHASE,
    });
    if (h.kind === "ok") ctx.convo.held.set(dataset, heldShapesOf(h.body));
  }
  ctx.write.progress("Probing a sample of the dataset, shapes only");
  const a = await s.call({
    method: "POST",
    path: "/api/ingest/probe",
    body: { dataset, sample: Number(args.sample ?? 500), rules },
    toolCallId: ctx.toolCallId,
    phase: PHASE,
  });
  if (a.kind !== "ok") return notOk(a, "Correct the one thing named and probe again.");
  const job = Number((a.body as { job?: unknown }).job);
  const p: Probe = { job, dataset, rules, candidates: null, at: Date.now() };
  ctx.convo.probes.push(p);
  // the probe is a short job: wait for it here, so the model reads one answer instead of polling
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, i < 5 ? 400 : 1500));
    const j = await readJob(ctx, job, `${ctx.toolCallId}-job-${i}`);
    if (j.kind !== "ok") break;
    if (keepProbe(p, j.body))
      return {
        output: { ...(probeReading(ctx.convo, p) as Record<string, JsonValue>), declared: data(view, "") },
      };
    const state = (j.body as { state?: string }).state;
    if (state === "failed")
      return refuse("the probe failed", "Say so, and that a person can look at the dataset's page.");
  }
  return {
    output: { job, state: "running", next: "Read it with jobs_read and the job's id until it is done." },
  };
}

const queryRunReadonly: OneTool = {
  name: "query_run_readonly",
  description:
    "Run something that reads and writes nothing, by `what`: document (a stored question's count and first rows, and why it answers as it does, by `document`), sorting_words (rehearse one change to one word list over a `scope`: `axis`, `bucket` or `value`, `add` or `remove`, `flip`, `must_not_regress`, and one case `case_text` with `case_value`), identity_rules (probe a dataset's identity rules over a sample, by `dataset`; leave `rules` out to compare the current rule with one `candidate` such as PatientName or path segment 1).",
  input: v.object({
    what: v.picklist(RUN_WHAT),
    document: v.optional(v.number()),
    scope: v.optional(v.string()),
    axis: v.optional(v.string()),
    bucket: v.optional(v.nullable(v.string())),
    value: v.optional(v.nullable(v.string())),
    add: v.optional(v.array(v.string())),
    remove: v.optional(v.array(v.string())),
    flip: v.optional(v.array(v.string())),
    must_not_regress: v.optional(v.array(v.string())),
    case_text: v.optional(v.string()),
    case_value: v.optional(v.string()),
    sample: v.optional(v.number()),
    dataset: v.optional(v.string()),
    rules: v.optional(v.array(v.record(v.string(), v.unknown()))),
    candidate: v.optional(v.string()),
  }),
  salient: ["what", "document", "scope", "axis", "bucket", "value", "add", "dataset", "rules", "candidate"],
  step: "Trying it, writing nothing",
  async run(args, ctx) {
    const what = String(args.what);
    if (what === "sorting_words") return rehearseWords(args, ctx);
    if (what === "identity_rules") return probeIdentity(args, ctx);
    const document = num(args.document);
    if (document === null) return refuse("a stored question is run by its id", "Give `document`.");
    const s = seam(ctx, "ask-help");
    const [d, p] = await Promise.all([
      s.door(
        "/api/ask/diagnose",
        "POST",
        { document_id: document },
        { toolCallId: `${ctx.toolCallId}-diagnose`, phase: PHASE },
      ),
      s.door(
        "/api/ask/preview",
        "POST",
        { document_id: document, rows: 10 },
        { toolCallId: `${ctx.toolCallId}-preview`, phase: PHASE, rows: 10 },
      ),
    ]);
    if (p.kind !== "ok" && d.kind !== "ok") return notOk(p, "Check the document's id.");
    return {
      output: {
        document,
        diagnosis: d.kind === "ok" ? shorten(d.body as JsonValue, 3000) : null,
        preview: p.kind === "ok" ? (data(compactPreview(p.body), "") as JsonValue) : null,
      },
    };
  },
};

const queryReadRows: OneTool = {
  name: "query_read_rows",
  description:
    "Read rows of an answer the person already has: a stored question's first rows by `document` (at most ten), or a page of a result by `handle` and `page` (at most twenty rows a page). Rows are data to report in words, never to paste whole.",
  input: v.object({
    document: v.optional(v.number()),
    handle: v.optional(v.number()),
    page: v.optional(v.number()),
  }),
  salient: ["document", "handle", "page"],
  step: "Reading the rows",
  async run(args, ctx) {
    const s = seam(ctx, "ask-help");
    const handle = num(args.handle);
    if (handle !== null) {
      const a = await s.call({
        method: "GET",
        path: `/api/ask/handles/${handle}/rows?page=${Number(args.page ?? 1)}`,
        toolCallId: ctx.toolCallId,
        phase: PHASE,
        rows: 20,
      });
      return a.kind === "ok" ? { output: data(a.body, "read the next page") } : notOk(a, "Check the handle.");
    }
    const document = num(args.document);
    if (document === null) return refuse("rows are read for a document or a handle", "Give `document`.");
    const a = await s.door(
      "/api/ask/preview",
      "POST",
      { document_id: document, rows: 10 },
      { toolCallId: ctx.toolCallId, phase: PHASE, rows: 10 },
    );
    return a.kind === "ok"
      ? { output: { document, ...(data(compactPreview(a.body), "") as object) } }
      : notOk(a, "Check the document's id.");
  },
};

// ------------------------------------------------------------------ jobs and runs

const jobsRead: OneTool = {
  name: "jobs_read",
  description:
    "The registry's jobs, read only: what is running, queued or done; or one job by `job`, with its result once done (an identity probe's shapes, for one).",
  input: v.object({ job: v.optional(v.number()) }),
  salient: ["job"],
  step: "Reading the jobs",
  async run(args, ctx) {
    const job = num(args.job);
    if (job === null) {
      const a = await get(ctx, "operator", "/api/jobs");
      return a.kind === "ok"
        ? { output: data(a.body, "ask for one job by its id") }
        : notOk(a, "Say the jobs could not be read.");
    }
    const a = await readJob(ctx, job, ctx.toolCallId);
    if (a.kind !== "ok") return notOk(a, "Check the job's id.");
    const p = ctx.convo.probes.find((x) => x.job === job);
    if (p && keepProbe(p, a.body)) return { output: probeReading(ctx.convo, p) as JsonValue };
    const b = a.body as { state?: string; error?: unknown };
    return {
      output: {
        job,
        state: b.state ?? null,
        ...(b.error ? { error: shorten(b.error as JsonValue, 500) } : {}),
        ...(data(a.body, "") as object),
      },
    };
  },
};

const runRead: OneTool = {
  name: "run_read",
  description:
    "How an analysis run went, by `run`: its units by outcome, the failed units by reason, the units whose measures broke a declared check and what the check means, and the campaign a person may make over them (drafted, never made). Without `run`, the newest runs.",
  input: v.object({ run: v.optional(v.number()) }),
  salient: ["run"],
  step: "Reading a run",
  async run(args, ctx) {
    const s = seam(ctx, "run-read");
    const run = num(args.run);
    if (run === null) {
      const a = await s.call({
        method: "GET",
        path: "/api/pipeline-runs?limit=10",
        toolCallId: ctx.toolCallId,
        phase: PHASE,
      });
      if (a.kind !== "ok") return notOk(a, "Say the runs could not be read.");
      const runs = (
        (Array.isArray(a.body) ? a.body : ((a.body as { runs?: unknown })?.runs ?? [])) as Record<
          string,
          unknown
        >[]
      ).map((r) => ({
        id: r.id,
        pipeline: r.pipeline,
        status: r.status,
        finished_at: r.finished_at,
      }));
      return { output: data({ runs }, "") };
    }
    const got = await readRun(s, run, ctx.toolCallId, PHASE);
    if ("refused" in got)
      return refuse(
        `run ${run} could not be read`,
        "Check the run's number; without one, the newest runs are listed.",
      );
    const { reading, role } = got;
    let document: number | null = null;
    const doc = reading.detail === "plain" ? null : breachDocument(reading, role);
    if (doc) {
      const d = await s.call({
        method: "POST",
        path: "/api/ask/draft",
        body: { text: JSON.stringify(doc) },
        toolCallId: `${ctx.toolCallId}-draft`,
        phase: PHASE,
      });
      document = documentOf(d);
    }
    const campaign = document === null ? null : campaignDocument(reading);
    const failed = failedOf(reading);
    const said = (x: { count: number | null; fewer_than_five: boolean }) =>
      x.fewer_than_five ? "fewer than five" : (x.count ?? 0);
    ctx.turn.runs.push({ run: reading.run, failed, metrics: reading.breaches.map((b) => b.metric) });
    const output = {
      run: reading.run,
      analysis: reading.name,
      status: reading.status,
      units: reading.units,
      failed_units: failed,
      failed_by_reason: reading.failed.map((f) => ({ reason: f.reason, count: said(f) })),
      checks_broken: reading.breaches.map((b) => ({
        metric: b.metric,
        check: b.check,
        means: b.description,
        count: said(b),
      })),
      campaign: campaign ? { name: String(campaign.name), over_document: document } : null,
      say: `Say run ${reading.run} of ${reading.name} ended ${reading.status} with ${reading.units.succeeded} of ${reading.units.total} units done; ${failed ? `that ${failed} units failed, by reason` : "that no unit failed"}; ${reading.breaches.length ? "each check broken, by its metric, with its count and what it means" : "that no unit broke a check"}; ${campaign ? "and that a campaign over those units is drafted for a person to make" : "and that nothing needs a campaign"}. Numbers from here only.`,
    };
    return { output: output as unknown as JsonValue };
  },
};

// ------------------------------------------------------------------ the plan panel, questions, proposals

const PLAN_STATUS = ["pending", "running", "done", "failed", "skipped"] as const;

const planUpdate: OneTool = {
  name: "plan_update",
  description:
    "Show the person your plan for work of several steps, as a list they see beside the chat: the whole list each time, each item with its status (pending, running, done, failed, skipped). Only for work of three steps or more; never for a single question.",
  input: v.object({
    items: v.array(v.object({ text: v.string(), status: v.optional(v.picklist(PLAN_STATUS)) })),
  }),
  step: "Planning",
  async run(args, ctx) {
    const items = (args.items as { text: string; status?: string }[]).map((i) => ({
      text: String(i.text).slice(0, 200),
      status: i.status ?? "pending",
    }));
    ctx.write.plan(items);
    return { output: { shown: items.length } };
  },
};

const askUser: OneTool = {
  name: "ask_user",
  description:
    "Ask the person one short question when their words leave a real choice open (which cohort, which dataset, which run), with the options to choose from and, when you know them, how many each would give. The turn ends with the question; their answer is the next message. Never ask what the registry summary already answers.",
  input: v.object({
    question: v.string(),
    options: v.array(v.object({ label: v.string(), count: v.optional(v.nullable(v.number())) })),
  }),
  step: "Asking you",
  async run(args, ctx) {
    const options = (args.options as { label: string; count?: number | null }[])
      .slice(0, 8)
      .map((o) => ({ label: String(o.label), count: typeof o.count === "number" ? o.count : null }));
    ctx.write.clarification({ question: String(args.question), options });
    ctx.turn.asked = true;
    return { output: { asked: true }, terminate: true };
  },
};

const KINDS = [
  "query_version",
  "job_plan",
  "analysis_plan",
  "overlay",
  "identity_merge",
  "identity_rule",
] as const;

function propose(
  ctx: ToolCtx,
  o: {
    kind: ChangeKind;
    sentence: string;
    title?: string | null;
    lines?: string[];
    payload: Record<string, unknown>;
    ref?: { document?: number; parent?: number | null; plan?: string };
    details: Record<string, unknown>;
  },
): Out {
  const c = theChanges().propose({
    conversation: ctx.conversation,
    subject: ctx.subject,
    kind: o.kind,
    title: o.title ?? null,
    sentence: o.sentence,
    lines: o.lines ?? [],
    payload: o.payload,
  });
  ctx.write.approval({
    id: c.id,
    change: CARD_OF[o.kind],
    title: o.title ?? null,
    sentence: o.sentence,
    lines: o.lines ?? [],
    ref: o.ref ?? {},
  });
  const details = { kind: o.kind, id: c.id, ...o.details };
  ctx.turn.proposed.push({ kind: o.kind, id: c.id, details });
  return {
    output: {
      ...(details as Record<string, JsonValue>),
      pending: true,
      next: "It waits for the person's approval on the card; nothing has changed yet. Tell them in one or two sentences what it will do, then stop.",
    },
  };
}

async function proposeJobPlan(args: Record<string, unknown>, ctx: ToolCtx, sentence: string): Promise<Out> {
  const steps = Array.isArray(args.steps) ? args.steps : [];
  if (steps.length === 0)
    return refuse("a plan has steps", "Give `steps`, each a verb with its arguments and when it runs.");
  const store = ladderStore();
  if (!store) return refuse("plans cannot be kept here", "Say so.");
  const { policy, grants } = await policyOf(seam(ctx, "operator"), `${ctx.toolCallId}-policy`, PHASE);
  if (policy.length === 0)
    return refuse("what each act needs could not be read", "Say the plan cannot be made now.");
  const planned = planFrom(steps, policy, grants);
  if (planned.refused.length > 0 && planned.steps.length + planned.proposals.length === 0)
    return refuse(
      planned.refused.map((r) => r.why).join("; "),
      "Correct the step named, or say why it cannot be planned.",
    );
  const id = `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  store.plan({
    id,
    conversation: ctx.conversation,
    subject: ctx.subject,
    instruction: String(args.instruction ?? sentence),
    planned,
  });
  const lines = restate(planned).split("\n").filter(Boolean);
  return propose(ctx, {
    kind: "job_plan",
    sentence,
    title: str(args.title),
    lines,
    payload: { plan_id: id },
    ref: { plan: id },
    details: {
      plan_id: id,
      steps: planned.steps.map((s) => ({
        verb: s.verb,
        when: s.when as unknown as JsonValue,
        words: s.words,
      })) as unknown as JsonValue,
      acts_for_a_person: planned.proposals.map((p) => ({
        verb: p.verb,
        words: p.words,
      })) as unknown as JsonValue,
      not_planned: planned.refused.map((r) => plainly(r.why)),
    },
  });
}

async function proposeAnalysis(args: Record<string, unknown>, ctx: ToolCtx, sentence: string): Promise<Out> {
  const s = seam(ctx, "analysis-plan");
  const pipelineName = str(args.pipeline);
  if (!pipelineName)
    return refuse(
      "an analysis plan names the analysis",
      "Give `pipeline`, one of the analyses registry_describe lists.",
    );
  const cat = await s.call({
    method: "GET",
    path: "/api/pipelines",
    toolCallId: `${ctx.toolCallId}-catalog`,
    phase: PHASE,
  });
  if (cat.kind !== "ok")
    return notOk(cat, "Say the analyses could not be read, and that a person who may see them can plan it.");
  const entries = entriesOf(cat.body);
  const entry = resolve(entries, pipelineName);
  if (!entry)
    return refuse(
      `no analysis named ${pipelineName}`,
      `Name one of ${newest(entries)
        .map((e) => e.name)
        .join(", ")}.`,
    );
  const { params, refused } = paramsFor(
    entry,
    (args.params as Record<string, unknown> | undefined) ?? undefined,
  );
  if (refused.length)
    return refuse(
      refused.join("; "),
      "Leave a parameter out for its default, or give one the analysis takes.",
    );
  const cohorts = ((args.cohorts as string[] | undefined) ?? []).map((c) => String(c).trim()).filter(Boolean);
  const selection = str(args.selection);
  if ((selection ? 1 : 0) + (cohorts.length ? 1 : 0) !== 1)
    return refuse(
      "an analysis runs over a saved selection or over cohorts, one of the two",
      "Give `selection`, or `cohorts` with `sessions`.",
    );
  const sessions: Sessions = args.sessions === "first" || args.sessions === "latest" ? args.sessions : "all";
  let over: { select: string } | { handle: number } | null = null;
  let proposed: { document: number; cohorts: string[]; sessions: Sessions } | null = null;
  let why: string | null = null;
  if (selection) over = { select: selectionSpec(selection) };
  else {
    const known = await s.call({
      method: "GET",
      path: "/api/cohorts",
      toolCallId: `${ctx.toolCallId}-cohorts`,
      phase: PHASE,
    });
    if (known.kind === "ok") {
      const names = cohortsOf(known.body).map((c) => c.name);
      const unknown = cohorts.filter((c) => !names.includes(c));
      if (unknown.length)
        return refuse(
          `there is no cohort named ${unknown.join(", ")}`,
          `Say plainly there is no such cohort; the cohorts are ${names.join(", ") || "none"}. Propose nothing.`,
        );
    }
    ctx.write.progress("Writing whom it runs over");
    const doc = cohortDocument(
      cohorts,
      sessions,
      `${sessions === "all" ? "every session" : `the ${sessions} session of each subject`} of ${cohorts.join(" and ")}, for ${entry.name}`,
    );
    const drafted = await s.call({
      method: "POST",
      path: "/api/ask/draft",
      body: { text: JSON.stringify(doc) },
      toolCallId: `${ctx.toolCallId}-draft`,
      phase: PHASE,
    });
    const document = documentOf(drafted);
    if (document === null) return notOk(drafted, "Say whom it would run over could not be written.");
    const ran = await s.call({
      method: "POST",
      path: "/api/ask/run",
      body: { document_id: document, keep: false, name: `analysis plan ${entry.name}` },
      toolCallId: `${ctx.toolCallId}-run`,
      phase: PHASE,
    });
    const rb = (ran.kind === "ok" ? ran.body : {}) as { handle?: unknown; truncated?: unknown };
    const handle = num(rb.handle);
    if (handle === null) why = "whom it runs over left nothing to check the run against";
    else if (rb.truncated === true)
      why =
        "it runs over more than one bounded answer; save the question as a selection and the check runs over it";
    else over = { handle };
    proposed = { document, cohorts, sessions };
  }
  let preflight: ReturnType<typeof preflightOf> | null = null;
  let engine: Record<string, unknown> | null = null;
  if (over) {
    ctx.write.progress("Checking the run before anything happens");
    const pf = await s.call({
      method: "POST",
      path: `/api/pipelines/${encodeURIComponent(entry.label)}/preflight`,
      body: { ...("select" in over ? { select: over.select } : { handle: over.handle }), params },
      toolCallId: `${ctx.toolCallId}-preflight`,
      phase: PHASE,
    });
    if (pf.kind === "ok") {
      preflight = preflightOf(pf.body);
      engine = preflightForDocument(pf.body);
    } else
      why = `the check before the run was refused: ${JSON.stringify(toolResult(pf).output).slice(0, 200)}`;
  }
  if (!preflight && !proposed && why)
    return refuse(why, "Say the selection could not be found, and ask which one they mean.");
  const command = over ? runCommand(entry.label, over, params) : null;
  const lines = preflight
    ? [
        `${entry.name}: ${preflight.units.ready} of ${preflight.units.total} units ready${preflight.units.missing ? `, ${preflight.units.missing} missing` : ""}`,
        `time: ${preflight.estimate.words}`,
        preflight.ready ? "ready to run" : `blocked: ${preflight.blockers.join("; ") || "see the check"}`,
      ]
    : [`${entry.name}: ${why ?? "no check before the run"}`];
  return propose(ctx, {
    kind: "analysis_plan",
    sentence,
    title: str(args.title) ?? `Run ${entry.name}`,
    lines,
    payload: {
      command,
      pipeline: entry.label,
      params,
      proposed,
      preflight: engine,
      question: str(args.question),
      why: str(args.why),
    },
    details: {
      pipeline: entry.name,
      version: entry.label,
      ...(selection ? { selection: selectionSpec(selection) } : { cohorts, sessions }),
      params: params as JsonValue,
      preflight: (preflight ?? null) as unknown as JsonValue,
      preflight_why: why,
      say: preflight
        ? `Name ${entry.name}, the ${preflight.units.ready} of ${preflight.units.total} units ready${preflight.units.missing ? `, the ${preflight.units.missing} missing and why` : ""}, the time (${preflight.estimate.words}), and that it runs when they approve it.`
        : `Name ${entry.name} and why no check was taken: ${why}.`,
    },
  });
}

function proposeOverlay(args: Record<string, unknown>, ctx: ToolCtx, sentence: string): Out {
  const r = ctx.convo.rehearsal;
  if (!r)
    return refuse(
      "nothing was rehearsed in this conversation",
      "Rehearse the change first with query_run_readonly, what sorting_words.",
    );
  if (r.diff.verdict === "revert")
    return refuse(`the rehearsal did not hold: ${r.diff.why}`, "Say so and propose nothing.");
  const name = str(args.name) ?? `tune-${r.prediction.list}`;
  const overlay = overlayOf(r.prediction, overlayScope(r.scope), r.case_text, r.case_value);
  return propose(ctx, {
    kind: "overlay",
    sentence,
    title: str(args.title),
    lines: [
      `${r.prediction.list}: ${r.prediction.add.length ? `add ${r.prediction.add.join(", ")}` : ""}${r.prediction.remove.length ? ` remove ${r.prediction.remove.join(", ")}` : ""}`.trim(),
      `rehearsed over ${r.scope}: ${r.diff.why}`,
    ],
    payload: { name, overlay, scope: r.scope, why: str(args.why) ?? sentence },
    details: {
      list: r.prediction.list,
      axis: r.prediction.axis,
      add: r.prediction.add,
      remove: r.prediction.remove,
      diff: r.diff.verdict,
      scope: r.scope,
    },
  });
}

function proposeMerge(args: Record<string, unknown>, ctx: ToolCtx, sentence: string): Out {
  const codes = ((args.subjects as string[] | undefined) ?? []).map((c) => String(c).trim()).filter(Boolean);
  if (codes.length !== 2 || codes[0] === codes[1])
    return refuse("a merge names two subjects", "Give `subjects`, the two codes the probe found alike.");
  const pair = alikePairs(ctx.convo).find(
    (p) => p.subjects.includes(codes[0]) && p.subjects.includes(codes[1]),
  );
  if (!pair)
    return refuse(
      alikePairs(ctx.convo).length === 0
        ? "no probe of this conversation found subjects alike"
        : "these two are not a pair the probe found alike",
      alikePairs(ctx.convo).length === 0
        ? "Probe the dataset first with query_run_readonly, what identity_rules."
        : "Propose one of the pairs the probe named.",
    );
  const canonical =
    str(args.canonical) && codes.includes(String(args.canonical).trim())
      ? String(args.canonical).trim()
      : codes[0];
  const alias = codes[0] === canonical ? codes[1] : codes[0];
  const why = str(args.why) ?? `the same ${pair.agree.join(" and ")}, ${pair.visits.shared} visits shared`;
  return propose(ctx, {
    kind: "identity_merge",
    sentence,
    title: str(args.title),
    lines: [
      `keep ${canonical}, merge ${alias} into it`,
      `agree: ${pair.agree.join(", ")}; visits shared: ${pair.visits.shared}`,
    ],
    payload: { canonical, alias, why },
    details: { subjects: [canonical, alias], canonical, alias, agree: pair.agree },
  });
}

function proposeRule(args: Record<string, unknown>, ctx: ToolCtx, sentence: string): Out {
  const rule = args.rule as Record<string, unknown> | undefined;
  if (!rule || typeof rule !== "object")
    return refuse("a rule proposal carries the rule", "Give `rule`, one of the rules the probe took.");
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const probe = ctx.convo.probes.find((p) => p.rules.some((r) => same(r, rule)));
  if (!probe)
    return refuse(
      "the rule is not one a probe of this conversation took",
      "Probe it first with query_run_readonly, what identity_rules.",
    );
  const pid = args.path_is_direct_identifier;
  if (usesPath(rule) && typeof pid !== "boolean")
    return refuse(
      "the rule reads a folder name",
      "Say whether that folder name identifies the person directly: path_is_direct_identifier true or false.",
    );
  const idType = String(rule.id_type ?? "");
  const nt = (args.new_type ?? null) as { name?: string; description?: string } | null;
  if (ctx.convo.types && !ctx.convo.types.includes(idType) && !(nt?.name === idType && nt.description))
    return refuse(
      `${idType} is not an identifier type the registry knows`,
      `Use one of ${ctx.convo.types.join(", ")}, or give new_type with a name and a description.`,
    );
  return propose(ctx, {
    kind: "identity_rule",
    sentence,
    title: str(args.title),
    lines: [`dataset ${probe.dataset}: ${JSON.stringify(rule)}`],
    payload: {
      dataset: probe.dataset,
      rule,
      path_is_direct_identifier: typeof pid === "boolean" ? pid : null,
      new_type: nt,
    },
    details: { dataset: probe.dataset, rule: rule as JsonValue },
  });
}

const proposeChange: OneTool = {
  name: "propose_change",
  description:
    "Propose a change for the person to approve on a card; it never changes anything by itself. `kind` and `sentence` (what it will do, in their words) always; then by kind: query_version (`document`, `parent`), job_plan (`instruction` and `steps`, each {verb, args, when}), analysis_plan (`pipeline`, `params`, `selection` or `cohorts` with `sessions` all, first or latest, `question`, `why`), overlay (the rehearsed sorting words; `name`, `why`), identity_merge (`subjects`, the two codes, `canonical`, `why`), identity_rule (`rule`, `path_is_direct_identifier`, `new_type`).",
  input: v.object({
    kind: v.picklist(KINDS),
    sentence: v.string(),
    title: v.optional(v.string()),
    document: v.optional(v.number()),
    parent: v.optional(v.nullable(v.number())),
    instruction: v.optional(v.string()),
    steps: v.optional(
      v.array(
        v.object({
          verb: v.string(),
          args: v.optional(v.record(v.string(), v.unknown())),
          when: v.optional(v.unknown()),
        }),
      ),
    ),
    pipeline: v.optional(v.string()),
    params: v.optional(v.record(v.string(), v.unknown())),
    selection: v.optional(v.string()),
    cohorts: v.optional(v.array(v.string())),
    sessions: v.optional(v.picklist(["all", "first", "latest"])),
    question: v.optional(v.string()),
    why: v.optional(v.string()),
    name: v.optional(v.string()),
    subjects: v.optional(v.array(v.string())),
    canonical: v.optional(v.string()),
    rule: v.optional(v.record(v.string(), v.unknown())),
    path_is_direct_identifier: v.optional(v.nullable(v.boolean())),
    new_type: v.optional(v.nullable(v.object({ name: v.string(), description: v.string() }))),
  }),
  salient: ["kind", "document", "steps", "pipeline", "cohorts", "selection", "subjects", "rule"],
  step: "Preparing a change for you",
  async run(args, ctx) {
    const kind = args.kind as ChangeKind;
    const sentence = String(args.sentence ?? "").trim();
    if (!sentence) return refuse("a proposal says what it will do", "Give `sentence`.");
    switch (kind) {
      case "query_version": {
        const document = num(args.document) ?? ctx.turn.drafted.at(-1) ?? null;
        if (document === null)
          return refuse("a query version names its document", "Draft it first, then give `document`.");
        const parent = num(args.parent);
        theLineage().proposed({ conversation: ctx.conversation, document, parent, sentence });
        return propose(ctx, {
          kind,
          sentence,
          title: str(args.title),
          payload: { document, parent },
          ref: { document, parent },
          details: { document, parent },
        });
      }
      case "job_plan":
        return proposeJobPlan(args, ctx, sentence);
      case "analysis_plan":
        return proposeAnalysis(args, ctx, sentence);
      case "overlay":
        return proposeOverlay(args, ctx, sentence);
      case "identity_merge":
        return proposeMerge(args, ctx, sentence);
      case "identity_rule":
        return proposeRule(args, ctx, sentence);
    }
    return refuse(`no change of kind ${String(kind)}`, `Use one of ${KINDS.join(", ")}.`);
  },
};

/** Every tool, by name, in the mounting order. */
export const TOOLS: Record<ToolName, OneTool> = {
  registry_summary: registrySummary,
  registry_search: registrySearch,
  registry_describe: registryDescribe,
  query_draft: queryDraft,
  query_run_readonly: queryRunReadonly,
  query_read_rows: queryReadRows,
  jobs_read: jobsRead,
  run_read: runRead,
  plan_update: planUpdate,
  ask_user: askUser,
  propose_change: proposeChange,
};

/** The tools a read-only sub-agent may use: reads and drafts of questions, nothing proposed, no card. */
export const READ_ONLY: readonly ToolName[] = [
  "registry_summary",
  "registry_search",
  "registry_describe",
  "query_draft",
  "query_run_readonly",
  "query_read_rows",
];

export type { Detail };
export { conversationOf };
