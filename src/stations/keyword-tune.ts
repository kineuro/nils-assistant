// SPDX-License-Identifier: AGPL-3.0-only
// keyword-tune (Wave 4c §9.13): one axis of one pack tuned against the
// classifier's own signals. Survey the signals and the open review items,
// hypothesise one change to one bucket with a falsifiable prediction
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
  bucket: string;
  add: string[];
  remove: string[];
  flip: string[];
  must_not_regress: string[];
  at: number;
}

const predictions = new Map<string, Prediction>();
const signalsSeen = new Map<string, { groups: Set<string>; axes: Set<string> }>();

export function predictionOf(conversation: string): Prediction | null {
  return predictions.get(conversation) ?? null;
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
        "The classifier's own signals over a scope (batch:<id>, origin:<name> or pack:<version>): per axis the tier counts and confidence spread, the open review items by kind, the shadowed keywords, the unused overlay terms, the terms a person's decisions overrode most, and samples of the text the axes matched against.",
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
            axes?: Record<string, { open_review?: Record<string, number> }>;
            open_review?: Record<string, number>;
          };
          const seen = signalsSeen.get(ctx.conversation) ?? {
            groups: new Set<string>(),
            axes: new Set<string>(),
          };
          for (const [axis, ax] of Object.entries(body.axes ?? {})) {
            seen.axes.add(axis);
            for (const g of Object.keys(ax.open_review ?? {})) seen.groups.add(g);
          }
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
      name: "hypothesis",
      description:
        "One change to one bucket of one axis, and the falsifiable prediction that goes with it, written before any rehearsal: the review groups that should flip (their group keys as the signals name them) and the axis values that must not regress (as axis=value). A second hypothesis replaces the first.",
      input: v.object({
        axis: v.string(),
        bucket: v.string(),
        add: v.optional(v.array(v.string())),
        remove: v.optional(v.array(v.string())),
        flip: v.optional(v.array(v.string())),
        must_not_regress: v.optional(v.array(v.string())),
      }),
      phases: ["hypothesise"],
      salient: ["axis", "bucket"],
      async run(args, ctx) {
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
        const p: Prediction = {
          axis: String(args.axis),
          bucket: String(args.bucket),
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

/** The overlay document a hypothesis becomes: one bucket of one pack, with the site's own case. */
export function overlayOf(
  p: Prediction,
  scope: Record<string, string>,
  caseText: string,
  caseValue: string,
): Record<string, unknown> {
  const edit: Record<string, string[]> = {};
  if (p.add.length) edit.add = p.add;
  if (p.remove.length) edit.remove = p.remove;
  return {
    overlay: `tune-${p.axis}`,
    version: "1.0.0",
    pack: "mri",
    scope,
    buckets: { [p.bucket]: edit },
    cases: [
      {
        name: `the site's ${p.bucket} term`,
        stack: { text_series_description: caseText },
        axes: { [p.axis]: caseValue },
      },
    ],
  };
}

export function keywordTuneChecks(): Record<string, Check> {
  return {
    /** The patch touches one file: one bucket of one axis, as the hypothesis and the result both say. */
    one_file: (verdict: Verdict, ctx) => {
      const p = predictions.get(String(ctx.conversation ?? ""));
      if (!p) return "no hypothesis was written";
      const overlay = verdict.result.overlay as { buckets?: Record<string, unknown> } | undefined;
      const buckets = Object.keys(overlay?.buckets ?? {});
      if (buckets.length !== 1 || buckets[0] !== p.bucket)
        return `the overlay touches ${buckets.length} bucket${buckets.length === 1 ? "" : "s"}; a tune touches one, ${p.bucket}`;
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
      "You are keyword-tune. Survey the signals of the scope you are given and the open review items; the term you add comes from the person's words, the shadowed keywords or the overridden terms, never from a guess at what a long bucket already holds; then write one hypothesis, one change to one bucket of one axis with the groups that should flip and the values that must not regress; advance and rehearse it with nils_try; read the diff: keep means propose it, partial means refine the hypothesis once and rehearse again, revert means say why and settle without a proposal. Settle with the axis, the bucket, the overlay, the prediction, the rehearsal, the diff and the proposal's ids when there is one; the proposals list carries {kind: overlay, ref: {id, review_item}, sentence} when you proposed. Never a stack id, never a row.",
    tools: keywordTuneTools(),
    checks: keywordTuneChecks(),
    settle: { phases: ["check", "finish"] },
    complete: async (result, ctx) => {
      const p = predictions.get(ctx.conversation);
      return {
        ...result,
        prediction: p ?? result.prediction ?? null,
        overlay: result.overlay ?? (p ? overlayOf(p, {}, "", "") : null),
      };
    },
  };
  return stationAgent(def);
}
