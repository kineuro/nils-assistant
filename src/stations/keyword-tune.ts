// SPDX-License-Identifier: AGPL-3.0-only
// keyword-tune (Wave 4c §9.13, record 26): one word list of one axis of one
// pack tuned against the classifier's own signals. A list is a bucket the
// pack names, or the word list of one axis value (`axis.value`), which every
// site may grow since record 26. Survey the signals and the open review
// items, read the pack's own lists so a term already held is never added
// twice, hypothesise one change to one list with a falsifiable prediction
// written before anything is rehearsed, rehearse it through `try`, which
// writes nothing, read the nine-state diff between rehearsal and
// prediction, and finish with an overlay proposal a person adopts. The
// prediction's time is a fact of the run state, so the check that it came
// first reads the state, not the model's word.

import type { JsonValue } from "@flue/runtime";
import * as v from "valibot";
import type { Answer, Seam } from "../seam/client.ts";
import { toolResult } from "../seam/client.ts";
import { theLedger } from "../seam/for.ts";
import { type StationDefinition, type StationTool, stationAgent } from "./agent.ts";
import type { Manifest } from "./manifest.ts";
import type { Check, Verdict } from "./verdict.ts";

/** The falsifiable prediction: which review groups flip, which values must not regress. */
export interface Prediction {
  axis: string;
  /** The bucket the pack names, when the change is to a bucket. */
  bucket: string | null;
  /** The axis value whose word list changes, when the change is to a value's list. */
  value: string | null;
  /** The list the change touches, as the overlay names it: the bucket, or axis.value. */
  list: string;
  add: string[];
  remove: string[];
  flip: string[];
  must_not_regress: string[];
  at: number;
}

interface Seen {
  groups: Set<string>;
  axes: Set<string>;
  /** The values the signals reported by value, per axis; empty when the signals carried no by_value. */
  values: Map<string, Set<string>>;
}

const predictions = new Map<string, Prediction>();
const signalsSeen = new Map<string, Seen>();
/** The pack's own lists as read: the keywords per list name (a bucket, or axis.value), by conversation. */
const packLists = new Map<string, Map<string, string[]>>();

export function predictionOf(conversation: string): Prediction | null {
  return predictions.get(conversation) ?? null;
}
export function valuesSeen(conversation: string, axis: string): string[] {
  return [...(signalsSeen.get(conversation)?.values.get(axis) ?? [])];
}
export function packListOf(conversation: string, list: string): string[] | null {
  return packLists.get(conversation)?.get(list) ?? null;
}

/** The name of a list: the bucket the pack names, or axis.value. */
export function listName(axis: string, bucket: string | null, value: string | null): string {
  return value !== null ? `${axis}.${value}` : String(bucket);
}

/** The values a signals answer reports by value for one axis: an object keyed by value, or a list of {value}. */
export function valuesOf(byValue: unknown): string[] {
  if (Array.isArray(byValue))
    return byValue
      .map((x) => (typeof x === "string" ? x : String((x as { value?: unknown })?.value ?? "")))
      .filter(Boolean);
  if (byValue && typeof byValue === "object") return Object.keys(byValue as Record<string, unknown>);
  return [];
}

/**
 * The word lists a pack answers, by list name: each axis's values with their keywords as axis.value, and
 * the buckets the pack names. Axes and values come as lists of {axis|name|value, keywords} or as objects
 * keyed by name; keywords as a list of strings or as {keywords: [...]}.
 */
export function listsOfPack(body: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const doc = (body ?? {}) as Record<string, unknown>;
  const entries = (x: unknown, key: string): [string, Record<string, unknown>][] => {
    if (Array.isArray(x))
      return x.map((e) => {
        const o = (e ?? {}) as Record<string, unknown>;
        return [String(o[key] ?? o.name ?? ""), o];
      });
    if (x && typeof x === "object")
      return Object.entries(x as Record<string, unknown>).map(([k, e]) => [
        k,
        (e && typeof e === "object" ? e : {}) as Record<string, unknown>,
      ]);
    return [];
  };
  const words = (x: unknown): string[] | null => {
    const list = Array.isArray(x) ? x : ((x as { keywords?: unknown } | null)?.keywords ?? null);
    return Array.isArray(list) ? list.map((w) => String(w).trim().toLowerCase()).filter(Boolean) : null;
  };
  for (const [axis, ax] of entries(doc.axes, "axis")) {
    if (!axis) continue;
    for (const [value, val] of entries(ax.values, "value")) {
      const w = words(val.keywords ?? val);
      if (value && w) out.set(`${axis}.${value}`, w);
    }
  }
  for (const [bucket, b] of entries(doc.buckets, "bucket")) {
    const w = words(b.keywords ?? b.terms ?? b);
    if (bucket && w) out.set(bucket, w);
  }
  return out;
}

/** The nine-state diff of §9.13, folded to what a person acts on: keep, partial, revert. */
export function diffOf(
  p: Prediction,
  tried: {
    moves?: { axis: string; from: string; to: string; stacks: number }[];
    review_items?: { close: number; open: number };
  },
): {
  verdict: "keep" | "partial" | "revert";
  moved: number;
  on_axis: number;
  off_axis: number;
  closes: number;
  opens: number;
  why: string;
} {
  const moves = tried.moves ?? [];
  const onAxis = moves.filter((m) => m.axis === p.axis);
  const offAxis = moves.filter((m) => m.axis !== p.axis);
  const regress = moves.filter((m) => p.must_not_regress.includes(`${m.axis}=${m.from}`));
  const moved = onAxis.reduce((n, m) => n + m.stacks, 0);
  const closes = tried.review_items?.close ?? 0;
  const opens = tried.review_items?.open ?? 0;
  if (regress.length > 0)
    return {
      verdict: "revert",
      moved,
      on_axis: onAxis.length,
      off_axis: offAxis.length,
      closes,
      opens,
      why: `the rehearsal moved ${regress.map((m) => `${m.axis} from ${m.from}`).join(", ")}, which must not regress`,
    };
  if (offAxis.length > 0)
    return {
      verdict: "revert",
      moved,
      on_axis: onAxis.length,
      off_axis: offAxis.length,
      closes,
      opens,
      why: `the rehearsal moved ${offAxis.map((m) => m.axis).join(", ")}, not the axis the hypothesis named`,
    };
  if (opens > 0)
    return {
      verdict: "partial",
      moved,
      on_axis: onAxis.length,
      off_axis: 0,
      closes,
      opens,
      why: `${opens} review item${opens === 1 ? "" : "s"} would open`,
    };
  if (moved === 0)
    return {
      verdict: "partial",
      moved,
      on_axis: 0,
      off_axis: 0,
      closes,
      opens,
      why: "nothing moved on the axis",
    };
  if (p.flip.length > 0 && closes < p.flip.length)
    return {
      verdict: "partial",
      moved,
      on_axis: onAxis.length,
      off_axis: 0,
      closes,
      opens,
      why: `${closes} of the ${p.flip.length} predicted groups would close`,
    };
  return {
    verdict: "keep",
    moved,
    on_axis: onAxis.length,
    off_axis: 0,
    closes,
    opens,
    why: `${moved} stack${moved === 1 ? "" : "s"} move on ${p.axis} and nothing else`,
  };
}

export function keywordTuneTools(): StationTool[] {
  const door = (
    name: string,
    description: string,
    input: v.GenericSchema<Record<string, unknown>, unknown>,
    phases: string[],
    dial: (seam: Seam, args: Record<string, unknown>, toolCallId: string, phase: string) => Promise<Answer>,
    salient?: string[],
  ): StationTool => ({
    name,
    description,
    input,
    phases,
    salient,
    async run(args, ctx) {
      const a = await dial(ctx.seam, args, ctx.toolCallId, ctx.state.phase);
      return { output: toolResult(a).output };
    },
  });
  return [
    {
      name: "nils_signals",
      description:
        "The classifier's own signals over a scope (batch:<id>, origin:<name> or pack:<version>): per axis the tier counts and confidence spread, by value where the engine reports it, the open review items by kind, the shadowed keywords, the unused overlay terms, the terms a person's decisions overrode most, and samples of the text the axes matched against.",
      input: v.object({ scope: v.string() }),
      phases: ["survey", "hypothesise"],
      salient: ["scope"],
      async run(args, ctx) {
        const a = await ctx.seam.call({
          method: "GET",
          path: `/api/classify/signals?scope=${encodeURIComponent(String(args.scope)).replace(/%3A/giu, ":")}`,
          toolCallId: ctx.toolCallId,
          phase: ctx.state.phase,
        });
        if (a.kind === "ok") {
          const body = a.body as {
            axes?: Record<string, { open_review?: Record<string, number>; by_value?: unknown }>;
            open_review?: Record<string, number>;
            by_value?: Record<string, unknown>;
          };
          const seen = signalsSeen.get(ctx.conversation) ?? {
            groups: new Set<string>(),
            axes: new Set<string>(),
            values: new Map<string, Set<string>>(),
          };
          const noteValues = (axis: string, byValue: unknown) => {
            const vals = valuesOf(byValue);
            if (vals.length === 0) return;
            const set = seen.values.get(axis) ?? new Set<string>();
            for (const x of vals) set.add(x);
            seen.values.set(axis, set);
          };
          for (const [axis, ax] of Object.entries(body.axes ?? {})) {
            seen.axes.add(axis);
            for (const g of Object.keys(ax.open_review ?? {})) seen.groups.add(g);
            noteValues(axis, ax.by_value);
          }
          // an engine that reports by value beside the axes rather than under them
          for (const [axis, byValue] of Object.entries(body.by_value ?? {})) noteValues(axis, byValue);
          for (const g of Object.keys(body.open_review ?? {})) seen.groups.add(g);
          signalsSeen.set(ctx.conversation, seen);
        }
        return { output: toolResult(a).output };
      },
    },
    door(
      "nils_review",
      "The open review items, newest first, or one item with its members by id.",
      v.object({ id: v.optional(v.number()) }),
      ["survey", "hypothesise"],
      (s, a, id, phase) =>
        s.call({
          method: "GET",
          path: a.id === undefined ? "/api/review" : `/api/review/${Number(a.id)}`,
          toolCallId: id,
          phase,
        }),
      ["id"],
    ),
    {
      name: "nils_pack",
      description:
        "One pack's own word lists: every axis with its values and the keywords each value's list holds, and the buckets the pack names, so a term the list already holds is never added and a term to remove is one it holds. Name the axis to read that axis alone.",
      input: v.object({ name: v.optional(v.string()), axis: v.optional(v.string()) }),
      phases: ["survey", "hypothesise"],
      salient: ["name", "axis"],
      async run(args, ctx) {
        const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : "mri";
        const a = await ctx.seam.call({
          method: "GET",
          path: `/api/packs/${encodeURIComponent(name)}`,
          toolCallId: ctx.toolCallId,
          phase: ctx.state.phase,
        });
        if (a.kind !== "ok") return { output: toolResult(a).output };
        const lists = listsOfPack(a.body);
        const held = packLists.get(ctx.conversation) ?? new Map<string, string[]>();
        for (const [k, w] of lists) held.set(k, w);
        packLists.set(ctx.conversation, held);
        const axis = typeof args.axis === "string" ? args.axis.trim() : "";
        const shown = [...lists].filter(([k]) => !axis || k.startsWith(`${axis}.`) || !k.includes("."));
        return {
          output: {
            pack: name,
            lists: Object.fromEntries(shown.map(([k, w]) => [k, { holds: w.length, keywords: w }])),
            text: "a list is named by the bucket, or by axis.value; the overlay names it the same way",
          } as JsonValue,
        };
      },
    },
    {
      name: "hypothesis",
      description:
        "One change to one word list of one axis, and the falsifiable prediction that goes with it, written before any rehearsal: the list is a bucket the pack names (bucket) or the word list of one axis value (value, the list axis.value), one of the two; the review groups that should flip (their group keys as the signals name them) and the axis values that must not regress (as axis=value). A second hypothesis replaces the first.",
      input: v.object({
        axis: v.string(),
        bucket: v.optional(v.nullable(v.string())),
        value: v.optional(v.nullable(v.string())),
        add: v.optional(v.array(v.string())),
        remove: v.optional(v.array(v.string())),
        flip: v.optional(v.array(v.string())),
        must_not_regress: v.optional(v.array(v.string())),
      }),
      phases: ["hypothesise"],
      salient: ["axis", "bucket", "value"],
      async run(args, ctx) {
        const axis = String(args.axis).trim();
        const bucket = typeof args.bucket === "string" && args.bucket.trim() ? args.bucket.trim() : null;
        const value = typeof args.value === "string" && args.value.trim() ? args.value.trim() : null;
        if ((bucket === null) === (value === null))
          return {
            output: {
              refused: true,
              why: "a hypothesis names one list: a bucket the pack names, or the value whose list changes, one of the two",
            } as JsonValue,
          };
        if (value !== null) {
          const known = valuesSeen(ctx.conversation, axis);
          if (known.length > 0 && !known.includes(value))
            return {
              output: {
                refused: true,
                why: `${value} is not a value the signals report on ${axis}; they report ${known.join(", ")}`,
              } as JsonValue,
            };
        }
        const add = ((args.add as string[] | undefined) ?? [])
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        const remove = ((args.remove as string[] | undefined) ?? [])
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        if (add.length + remove.length === 0)
          return {
            output: { refused: true, why: "a hypothesis adds or removes at least one term" } as JsonValue,
          };
        const list = listName(axis, bucket, value);
        // the pack's own list, when it was read: a term it holds is never added, a term it lacks never removed
        const words = packListOf(ctx.conversation, list);
        if (words) {
          const held = add.filter((t) => words.includes(t));
          if (held.length > 0)
            return {
              output: {
                refused: true,
                why: `${list} already holds ${held.join(", ")}; a term comes from the person's words, the shadowed keywords or the overridden terms`,
              } as JsonValue,
            };
          const missing = remove.filter((t) => !words.includes(t));
          if (missing.length > 0)
            return {
              output: { refused: true, why: `${list} does not hold ${missing.join(", ")}` } as JsonValue,
            };
        }
        const p: Prediction = {
          axis,
          bucket,
          value,
          list,
          add,
          remove,
          flip: (args.flip as string[] | undefined) ?? [],
          must_not_regress: (args.must_not_regress as string[] | undefined) ?? [],
          at: Date.now(),
        };
        predictions.set(ctx.conversation, p);
        return { output: { recorded: true, prediction: p } as unknown as JsonValue };
      },
    },
    {
      name: "nils_try",
      description:
        "Rehearse the hypothesis as an overlay over a bounded sample of the scope, writing nothing: the moves per axis, the review items that would close and open, and the overlay's own case. The overlay is built from the hypothesis; you name the scope, the sample, and the case (a series description and the axis value it must get).",
      input: v.object({
        scope: v.string(),
        sample: v.optional(v.number()),
        case_text: v.string(),
        case_value: v.string(),
        overlay_scope: v.optional(v.record(v.string(), v.string())),
      }),
      phases: ["rehearse"],
      salient: ["scope"],
      async run(args, ctx) {
        const p = predictions.get(ctx.conversation);
        if (!p)
          return {
            output: {
              refused: true,
              why: "no hypothesis was written; write one first, in the hypothesise phase",
            } as JsonValue,
          };
        const overlay = overlayOf(
          p,
          (args.overlay_scope as Record<string, string> | undefined) ?? {},
          String(args.case_text),
          String(args.case_value),
        );
        const a = await ctx.seam.call({
          method: "POST",
          path: "/api/classify/try",
          body: { overlay, scope: String(args.scope), sample: Number(args.sample ?? 2000) },
          toolCallId: ctx.toolCallId,
          phase: ctx.state.phase,
        });
        if (a.kind !== "ok") return { output: toolResult(a).output };
        const tried = a.body as {
          moves?: { axis: string; from: string; to: string; stacks: number }[];
          review_items?: { close: number; open: number };
          cases?: unknown;
        };
        return { output: { overlay, tried: tried as JsonValue, diff: diffOf(p, tried) } as JsonValue };
      },
    },
    {
      name: "nils_propose",
      description:
        "Propose the rehearsed overlay as a registry object with a review item beside it, for an operator to adopt. Only after the diff read keep.",
      input: v.object({
        name: v.string(),
        scope: v.string(),
        why: v.string(),
        case_text: v.string(),
        case_value: v.string(),
        overlay_scope: v.optional(v.record(v.string(), v.string())),
      }),
      phases: ["check"],
      salient: ["name"],
      async run(args, ctx) {
        const p = predictions.get(ctx.conversation);
        if (!p) return { output: { refused: true, why: "no hypothesis was written" } as JsonValue };
        const overlay = overlayOf(
          p,
          (args.overlay_scope as Record<string, string> | undefined) ?? {},
          String(args.case_text),
          String(args.case_value),
        );
        const a = await ctx.seam.call({
          method: "POST",
          path: "/api/overlays",
          body: { name: String(args.name), overlay, scope: String(args.scope), why: String(args.why) },
          toolCallId: ctx.toolCallId,
          phase: ctx.state.phase,
        });
        return { output: toolResult(a).output };
      },
    },
  ];
}

/** The overlay document a hypothesis becomes: one list of one pack, a bucket under buckets or a value's list under lists as axis.value, with the site's own case. */
export function overlayOf(
  p: Prediction,
  scope: Record<string, string>,
  caseText: string,
  caseValue: string,
): Record<string, unknown> {
  const edit: Record<string, string[]> = {};
  if (p.add.length) edit.add = p.add;
  if (p.remove.length) edit.remove = p.remove;
  const lists = p.value !== null ? { lists: { [p.list]: edit } } : { buckets: { [p.list]: edit } };
  return {
    overlay: `tune-${p.axis}`,
    version: "1.0.0",
    pack: "mri",
    scope,
    ...lists,
    cases: [
      {
        name: `the site's ${p.list} term`,
        stack: { text_series_description: caseText },
        axes: { [p.axis]: caseValue },
      },
    ],
  };
}

/** The lists an overlay touches, of either kind: the buckets by name, the value lists as axis.value. */
export function listsTouched(overlay: unknown): string[] {
  const o = (overlay ?? {}) as { buckets?: Record<string, unknown>; lists?: Record<string, unknown> };
  return [...Object.keys(o.buckets ?? {}), ...Object.keys(o.lists ?? {})];
}

export function keywordTuneChecks(): Record<string, Check> {
  return {
    /** The patch touches one file: one list of one axis, a bucket or a value's list, as the hypothesis and the result both say. */
    one_file: (verdict: Verdict, ctx) => {
      const p = predictions.get(String(ctx.conversation ?? ""));
      if (!p) return "no hypothesis was written";
      const touched = listsTouched(verdict.result.overlay);
      if (touched.length !== 1 || touched[0] !== p.list)
        return `the overlay touches ${touched.length} list${touched.length === 1 ? "" : "s"}; a tune touches one, ${p.list}`;
      return null;
    },
    /** The prediction was written before the rehearsal: from the run state and the ledger, not the model's word. */
    prediction_before_rehearsal: (_verdict: Verdict, ctx) => {
      const conversation = String(ctx.conversation ?? "");
      const p = predictions.get(conversation);
      if (!p) return "no hypothesis was written";
      const tries = theLedger()
        .rows(conversation)
        .filter((r) => r.operation === "classify/try" && r.outcome === "ok");
      if (tries.length === 0) return "nothing was rehearsed";
      const first = Math.min(...tries.map((r) => r.at));
      return p.at <= first
        ? null
        : "the hypothesis was written after the rehearsal; a prediction comes first";
    },
    /** The rehearsal wrote nothing: the only write of the run is the proposal, after the last rehearsal. */
    rehearsal_wrote_nothing: (_verdict: Verdict, ctx) => {
      const rows = theLedger().rows(String(ctx.conversation ?? ""));
      const lastTry = Math.max(0, ...rows.filter((r) => r.operation === "classify/try").map((r) => r.at));
      const writes = rows.filter((r) => r.operation === "overlays" && r.outcome === "ok");
      const early = writes.find((r) => r.at < lastTry);
      return early
        ? "an overlay was proposed before the last rehearsal; a rehearsal writes nothing and the proposal comes last"
        : null;
    },
    /** Every named group exists: a group key the signals or the review list showed. */
    groups_exist: (_verdict: Verdict, ctx) => {
      const conversation = String(ctx.conversation ?? "");
      const p = predictions.get(conversation);
      if (!p) return "no hypothesis was written";
      const seen = signalsSeen.get(conversation);
      const unknown = p.flip.filter((g) => !seen?.groups.has(g));
      return unknown.length
        ? `the prediction names groups the signals did not show: ${unknown.join(", ")}`
        : null;
    },
  };
}

export function keywordTune(
  manifest: Manifest,
  brief: string,
  model: string,
): ReturnType<typeof stationAgent> {
  const def: StationDefinition = {
    manifest,
    brief,
    model,
    instructions:
      "You are keyword-tune. Survey the signals of the scope you are given and the open review items, and read the pack's own lists with nils_pack for the axis you settle on; the term you add comes from the person's words, the shadowed keywords or the overridden terms, never from a guess at what a long list already holds; then write one hypothesis, one change to one list of one axis (a bucket the pack names, or the word list of one axis value) with the groups that should flip and the values that must not regress; advance and rehearse it with nils_try; read the diff: keep means propose it, partial means refine the hypothesis once and rehearse again, revert means say why and settle without a proposal. Settle with the axis, the list (the bucket, or axis.value), the overlay, the prediction, the rehearsal, the diff and the proposal's ids when there is one; the proposals list carries {kind: overlay, ref: {id, review_item}, sentence} when you proposed. Never a stack id, never a row.",
    tools: keywordTuneTools(),
    checks: keywordTuneChecks(),
    briefInline: true,
    settle: { phases: ["check", "finish"] },
    complete: async (result, ctx) => {
      const p = predictions.get(ctx.conversation);
      return {
        ...result,
        list: p?.list ?? result.list ?? null,
        bucket: p ? p.bucket : (result.bucket ?? null),
        value: p ? p.value : (result.value ?? null),
        prediction: p ?? result.prediction ?? null,
        overlay: result.overlay ?? (p ? overlayOf(p, {}, "", "") : null),
      };
    },
  };
  return stationAgent(def);
}
