// SPDX-License-Identifier: AGPL-3.0-only
// run-read (record 49 A6): after a pipeline run, a short reading of its
// checks (the units that failed, by reason, and the units whose measures
// broke a declared threshold, by check) and a proposed campaign over the
// cases a person should look at. The host reads the run, its descriptor's
// checks and its pipeline:qc items and counts them; the model explains.
// The campaign is a document: the ask of the doubtful stacks is stored as
// a draft, and the campaign that would ask about them is written out for a
// person to make. The station closes no item, makes no campaign and starts
// no run again (R5, D47).

import type { JsonValue } from "@flue/runtime";
import * as v from "valibot";
import type { Seam } from "../seam/client.ts";
import { toolResult } from "../seam/client.ts";
import { type StationDefinition, type StationTool, stationAgent } from "./agent.ts";
import type { Manifest } from "./manifest.ts";
import {
  breachDocument,
  campaignDocument,
  type Detail,
  entryOf,
  type Reading,
  readingOf,
} from "./pipelines.ts";
import type { Check, Verdict } from "./verdict.ts";

/** What a reading leaves: the run read, and the campaign a person may make over its doubtful cases. */
export interface RunNote {
  reading: Reading;
  /** The draft ask of the doubtful stacks, stored by the engine; null when no unit broke a check. */
  ask_document: number | null;
  /** The campaign a person makes once they saved the document as a selection; null with no document. */
  campaign: Record<string, unknown> | null;
  /** The steps a person takes to make it, in order. */
  steps: string[];
}

interface Held {
  conversation: string;
  note: RunNote;
}

const readings = new Map<string, Held>();

export function readingById(id: string): Held | undefined {
  return readings.get(id);
}

/** The result with the note of the reading it names, where this conversation took it. */
export function withNote(result: Record<string, unknown>, conversation: string): Record<string, unknown> {
  const id = result.reading;
  const h = typeof id === "string" ? readings.get(id) : undefined;
  if (!h || h.conversation !== conversation) return result;
  const r = h.note.reading;
  return {
    ...result,
    note: {
      run: r.run,
      pipeline: r.pipeline,
      status: r.status,
      units: r.units,
      detail: r.detail,
      // below detail quasi the fields that would hold a unit, a value or an error's words are left out, not blanked
      failed: r.detail === "plain" ? r.failed.map(({ units: _u, example: _e, ...rest }) => rest) : r.failed,
      breaches:
        r.detail === "plain" ? r.breaches.map(({ units: _u, worst: _w, ...rest }) => rest) : r.breaches,
      doubtful_units: r.doubtful_units,
      ask_document: h.note.ask_document,
      campaign: h.note.campaign,
      steps: h.note.steps,
    },
  };
}

async function get(seam: Seam, path: string, id: string, phase: string) {
  return seam.call({ method: "GET", path, toolCallId: id, phase });
}

const RANK: Record<Detail, number> = { plain: 0, quasi: 1, sensitive: 2 };

/**
 * The detail a reading is disclosed at: the person's as the engine answers
 * it, never above the station's reviewer ceiling (quasi), and plain when it
 * cannot be read.
 */
export async function detailFor(seam: Seam, id: string, phase: string): Promise<Detail> {
  const a = await get(seam, "/api/capabilities", `${id}-detail`, phase);
  const d = a.kind === "ok" ? (a.body as { detail?: unknown }).detail : null;
  const held: Detail = d === "quasi" || d === "sensitive" ? d : "plain";
  return RANK[held] > RANK.quasi ? "quasi" : held;
}

/** One run read whole: the run, its catalog entry, its pipeline:qc items, at the person's detail. */
export async function readRun(
  seam: Seam,
  run: number,
  id: string,
  phase: string,
): Promise<{ reading: Reading; role: string | null } | { refused: string }> {
  const r = await get(seam, `/api/pipeline-runs/${run}`, `${id}-run`, phase);
  if (r.kind !== "ok") return { refused: JSON.stringify(toolResult(r).output).slice(0, 300) };
  const body = r.body as Record<string, unknown>;
  const pid = body.pipeline_id;
  const p =
    typeof pid === "number" || typeof pid === "string"
      ? await get(seam, `/api/pipelines/${pid}`, `${id}-pipeline`, phase)
      : null;
  const entry = p?.kind === "ok" ? entryOf(p.body as Record<string, unknown>) : null;
  const items = await get(seam, "/api/review?kind=pipeline:qc&limit=500", `${id}-items`, phase);
  const detail = await detailFor(seam, id, phase);
  const reading = readingOf(body, entry, items.kind === "ok" ? items.body : [], detail);
  return { reading, role: entry?.roles[0] ?? null };
}

/** A count as the model reads it: the number, or "fewer than five" below detail quasi. */
const said = (x: { count: number | null; fewer_than_five: boolean }): number | string =>
  x.fewer_than_five ? "fewer than five" : (x.count ?? 0);

/** The failed units the run's own summary counts: the engine's number, never one of labels. */
export const failedOf = (r: Reading): number => r.units.failed + r.units.unreported;

/** The reading as the model reads it: counts, reasons and checks, and the units and values only at detail quasi. */
function spoken(n: RunNote): Record<string, unknown> {
  const r = n.reading;
  const perScan = r.detail !== "plain";
  return {
    run: r.run,
    pipeline: r.pipeline,
    status: r.status,
    units: r.units,
    failed: r.failed.map((f) => ({
      reason: f.reason,
      count: said(f),
      ...(perScan ? { units: f.units.slice(0, 20) } : {}),
    })),
    breaches: r.breaches.map((b) => ({
      check: b.check,
      means: b.description,
      count: said(b),
      ...(perScan ? { worst: b.worst, units: b.units.slice(0, 20) } : {}),
    })),
    measures: r.measures,
    refused_files: r.refused_files,
    open_items: r.open_items,
    campaign: n.campaign ? { name: n.campaign.name, ask_document: n.ask_document } : null,
    ...(perScan
      ? {}
      : {
          disclosure:
            "Below detail quasi: counts by reason and by check only, a count under five said as fewer than five; never a unit, a value or an error's words.",
        }),
  };
}

export function runReadTools(): StationTool[] {
  return [
    {
      name: "nils_runs",
      description:
        "The newest pipeline runs: id, pipeline, status and units. Read it when the person did not name a run.",
      input: v.object({}),
      phases: ["read"],
      async run(_a, ctx) {
        const a = await get(ctx.seam, "/api/pipeline-runs?limit=10", ctx.toolCallId, ctx.state.phase);
        if (a.kind !== "ok") return toolResult(a);
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
          units: (r.summary as { units?: unknown } | undefined)?.units ?? null,
        }));
        return { output: { runs } as JsonValue };
      },
    },
    {
      name: "read_run",
      description:
        "Read one run's checks: its units by outcome, the failed units by reason, the units whose measures broke a declared check, and whether a campaign over them can be proposed. The host stores the draft ask of the doubtful stacks and writes the campaign document; nothing is made. Then settle with the reading id and your sentence.",
      input: v.object({ run: v.number() }),
      phases: ["read", "propose"],
      salient: ["run"],
      async run(args, ctx) {
        const run = Number(args.run);
        const got = await readRun(ctx.seam, run, ctx.toolCallId, ctx.state.phase);
        if ("refused" in got)
          return {
            output: { refused: true, why: `run ${run} could not be read: ${got.refused}` } as JsonValue,
          };
        const { reading, role } = got;
        let document: number | null = null;
        const steps: string[] = [];
        // a list of the scans a measure filter keeps is refused below detail quasi (R4), so no campaign is drafted there
        const doc = reading.detail === "plain" ? null : breachDocument(reading, role);
        const evidence: { documents: number[] } = { documents: [] };
        if (doc) {
          const drafted = await ctx.seam.call({
            method: "POST",
            path: "/api/ask/draft",
            body: { text: JSON.stringify(doc) },
            toolCallId: `${ctx.toolCallId}-draft`,
            phase: ctx.state.phase,
          });
          const d = drafted.kind === "ok" ? (drafted.body as { document?: unknown }).document : null;
          if (typeof d === "number") {
            document = d;
            evidence.documents.push(d);
          }
        }
        const campaign = document === null ? null : campaignDocument(reading);
        if (campaign) {
          const selection = String(campaign.name);
          steps.push(
            `save document ${document} as the selection ${selection}`,
            `make the campaign ${selection} over that selection (its first version, selection:${selection}@1) with the question and settings written here`,
          );
        }
        if (!doc && reading.breaches.length > 0)
          steps.push(
            "a person at detail quasi or above reads the units past a check and makes the campaign over them",
          );
        if (failedOf(reading) > 0)
          steps.push(
            `read the ${failedOf(reading)} failed units on run ${reading.run}'s page, where each stands as a pipeline:qc item; a failed unit made no measure and is run again, not rated`,
          );
        const note: RunNote = { reading, ask_document: document, campaign, steps };
        const id = `run-note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        readings.set(id, { conversation: ctx.conversation, note });
        const failedUnits = failedOf(reading);
        const breached = said(reading.doubtful_units) !== 0 && reading.breaches.length > 0;
        return {
          output: {
            reading: id,
            ...spoken(note),
            say: `Say run ${reading.run} of ${reading.name} ended ${reading.status} with ${reading.units.succeeded} of ${reading.units.total} units done; ${failedUnits ? `name the ${failedUnits} failed units by reason` : "no unit failed"}; ${breached ? `name each check broken, by its metric, with its count` : "no unit broke a check"}; ${campaign ? `and that a campaign over them is proposed for a person to make` : "and that no campaign is needed"}.`,
            text: "The reading is recorded. Settle now with the reading id and one short summary; the person makes the campaign.",
          } as JsonValue,
          evidence,
        };
      },
    },
  ];
}

export function runReadChecks(): Record<string, Check> {
  const held = (verdict: Verdict, ctx: Record<string, unknown>): Held | string => {
    const id = verdict.result.reading;
    if (typeof id !== "string") return "the verdict names no reading; call read_run first";
    const h = readings.get(id);
    if (!h) return `no reading ${id} is held; call read_run again`;
    if (h.conversation !== String(ctx.conversation ?? "")) return `reading ${id} is not this conversation's`;
    return h;
  };
  return {
    /** The verdict names a reading this conversation took. */
    read: (verdict, ctx) => {
      const h = held(verdict, ctx);
      return typeof h === "string" ? h : null;
    },
    /** The summary names every failure reason and every breached check, with the engine's counts. */
    names_the_checks: (verdict, ctx) => {
      const h = held(verdict, ctx);
      if (typeof h === "string") return null;
      const s = String(verdict.result.sentence ?? "").toLowerCase();
      const r = h.note.reading;
      const missing: string[] = [];
      const failed = failedOf(r);
      if (failed > 0 && !s.includes(String(failed))) missing.push(`the ${failed} failed units`);
      for (const b of r.breaches)
        if (!s.includes(b.metric.toLowerCase())) missing.push(`the check on ${b.metric}`);
      return missing.length === 0 ? null : `the summary does not name ${missing.join(", ")}`;
    },
    /** A reading proposes; it never closes an item, makes a campaign or runs anything again. */
    proposes_only: (verdict) => {
      const t = JSON.stringify(verdict.result).toLowerCase();
      return /"(closed|accepted|campaign_id|job)"\s*:/u.test(t)
        ? "the verdict claims an act; a reading proposes, a person acts"
        : null;
    },
  };
}

export function runRead(manifest: Manifest, brief: string, model: string): ReturnType<typeof stationAgent> {
  const def: StationDefinition = {
    manifest,
    brief,
    model,
    instructions:
      "You are run-read. After a pipeline run you call read_run once with its id (nils_runs finds the newest when the person names none), then settle with the reading id and a short summary in plain words: how the run ended, the failed units by reason, the units past each check and what the check means, and the campaign proposed over them. Numbers only from the tool, never your own. You close nothing and make nothing: a person makes the campaign and decides each item.",
    tools: runReadTools(),
    checks: runReadChecks(),
    briefInline: true,
    advance: false,
    settle: { phases: ["propose", "finish"] },
    // the note, filled from the held reading: counts, checks, the draft and the campaign document
    complete: async (result, ctx) => withNote(result, ctx.conversation),
  };
  return stationAgent(def);
}
