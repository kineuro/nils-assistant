// SPDX-License-Identifier: AGPL-3.0-only
// The steps of a dataset in the turn's facts (one chat, 2026-10-09): which
// of sorted, body part, post-contrast, main scans and pictures have run on
// it, from the engine's summary of one dataset (the Data page of Wave 7a,
// `GET /api/datasets/{name}/summary`). Since record 56 body part and
// post-contrast are steps of their own, models run over a dataset's scans,
// and the sorting fills neither: where post-contrast has not run, the sorting
// value post_contrast is empty, and a question for the scans given contrast
// finds none. Asked how many T1 scans with contrast a dataset held, the chat
// then counted the scans whose header weighting reads T1 and called them
// contrast-enhanced; nothing told it the step had not run. The steps are read
// for the datasets a turn is about, once a turn, and a tool of the same turn
// reads them from there. An engine without the door, a refusal or a slow
// answer leaves them out and says nothing of it. Written without angle
// brackets or ampersands, as the facts are.

import type { Seam } from "../seam/client.ts";
import type { TurnState } from "./state.ts";

/** The steps the facts carry, in the order a dataset's card shows them. */
export const STEPS = ["sorted", "body_part", "post_contrast", "main_scans", "pictures"] as const;
export type StepName = (typeof STEPS)[number];

/** One step as the facts carry it. */
export interface Step {
  step: StepName;
  /** As the engine says it: done, waiting, running, queued, or off where nothing serves it. */
  state: string;
  /** The scans it covers: sorted, answered by its model, or with a picture; for the main scans, those picked. */
  done: number | null;
  /** Of how many scans; null where it does not count them. */
  of: number | null;
}

/** The steps whose models answer sorting values of their own (record 56): their names and what is not known without them. */
const OPERATIONS = {
  body_part: { name: "body part", unknown: "which body part a scan shows" },
  post_contrast: { name: "post-contrast", unknown: "whether a scan was given contrast" },
} as const;
type Operation = keyof typeof OPERATIONS;

/** How long a turn's facts wait for a dataset's steps before going on without them. */
export const STEPS_WAIT_MS = 2500;
/** How long a tool waits for them: a dataset's summary counts its pictures on disk, which a share makes slow. */
export const STEPS_TOOL_WAIT_MS = 8000;
/** How many of the datasets a turn is about it reads the steps of. */
export const STEPS_READ = 3;

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const rec = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};

/** The steps of a dataset's summary, in order; null for an answer with none, as from an engine before the Data page. */
export function stepsOf(summary: unknown): Step[] | null {
  const rows = rec(summary).steps;
  if (!Array.isArray(rows)) return null;
  const out: Step[] = [];
  for (const step of STEPS) {
    const s = rows.map(rec).find((r) => r.step === step);
    if (!s) continue;
    const done =
      step === "sorted"
        ? num(s.scans)
        : step === "pictures"
          ? num(s.made)
          : step === "main_scans"
            ? num(s.picked)
            : num(s.answered);
    out.push({
      step,
      state: typeof s.state === "string" ? s.state : "unknown",
      done,
      of: step === "main_scans" ? null : num(s.of),
    });
  }
  return out.length ? out : null;
}

const open = (s: Step) => s.state === "running" || s.state === "queued";

/** One step in a few plain words. */
function said(s: Step): string {
  const part = s.done !== null && s.of !== null && s.done < s.of ? ` for ${s.done} of ${s.of} scans` : "";
  switch (s.step) {
    case "sorted":
      if (s.state === "done") return "sorted";
      if (s.state === "running") return "being sorted";
      if (s.state === "queued") return "sorting queued";
      return s.done ? `sorted ${s.done} of ${s.of ?? "its"} scans` : "not sorted yet";
    case "body_part":
    case "post_contrast": {
      const name = OPERATIONS[s.step].name;
      if (s.state === "done") return `${name} done${part}`;
      return open(s) ? `${name} ${s.state}` : `${name} not run`;
    }
    case "main_scans":
      if (s.state === "done") return "main scans picked";
      if (s.state === "off") return "main scans off";
      return open(s) ? "main scans being picked" : "main scans not picked yet";
    case "pictures":
      if (s.state === "done") return `pictures made${part}`;
      if (s.state === "off") return "pictures off";
      return open(s) ? "pictures being made" : "no pictures yet";
  }
}

/** The steps in one line: `sorted; body part not run; post-contrast not run; main scans picked; pictures made`. */
export function stepsLine(steps: readonly Step[]): string {
  return steps.map(said).join("; ");
}

/** Where body part or post-contrast has not answered on a dataset, what is not known there yet; null once both have. */
export function unknownSentence(dataset: string, steps: readonly Step[]): string | null {
  const missing = steps.filter(
    (s): s is Step & { step: Operation } => s.step in OPERATIONS && s.state !== "done",
  );
  if (missing.length === 0) return null;
  const one = missing.length === 1;
  const not = (s: Step) => (open(s) ? "not finished" : "not run");
  // body part and post-contrast have not run; or body part has not finished and post-contrast has not run
  const who = missing.every((s) => not(s) === not(missing[0]))
    ? `${missing.map((s) => OPERATIONS[s.step].name).join(" and ")} ${one ? "has" : "have"} ${not(missing[0])}`
    : missing.map((s) => `${OPERATIONS[s.step].name} has ${not(s)}`).join(" and ");
  const what = missing.map((s) => OPERATIONS[s.step].unknown).join(" and ");
  return `${who[0].toUpperCase()}${who.slice(1)} on ${dataset}: ${what} ${one ? "is" : "are"} not known there yet; never count another field in ${one ? "its" : "their"} place.`;
}

/** A dataset's steps as the facts say them: the line, and what is not known yet. */
export function stepsText(dataset: string, steps: readonly Step[]): string {
  const unknown = unknownSentence(dataset, steps);
  return `The steps of ${dataset}: ${stepsLine(steps)}.${unknown ? ` ${unknown}` : ""}`;
}

// ------------------------------------------------------------------ reading them, once a turn

const reads = new WeakMap<TurnState, Map<string, Promise<Step[] | null>>>();
const ended = new WeakMap<TurnState, Map<string, Step[] | null>>();

export interface StepsOptions {
  /** The turn the read is kept for: the next turn reads again. */
  turn: TurnState;
  dataset: string;
  /** The seam the summary door is read through: the one that reads the datasets. */
  seam: () => Seam;
  toolCallId: string;
  phase: string;
}

/** A dataset's steps, read once a turn and kept for the turn's tools; null where the engine gives none. */
export function readSteps(o: StepsOptions): Promise<Step[] | null> {
  let mine = reads.get(o.turn);
  if (!mine) {
    mine = new Map();
    reads.set(o.turn, mine);
  }
  let p = mine.get(o.dataset);
  if (!p) {
    p = Promise.resolve()
      .then(() =>
        o.seam().call({
          method: "GET",
          path: `/api/datasets/${encodeURIComponent(o.dataset)}/summary`,
          toolCallId: `${o.toolCallId}-steps`,
          phase: o.phase,
        }),
      )
      .then((a) => (a.kind === "ok" ? stepsOf(a.body) : null))
      .catch(() => null)
      .then((steps) => {
        let done = ended.get(o.turn);
        if (!done) {
          done = new Map();
          ended.set(o.turn, done);
        }
        done.set(o.dataset, steps);
        return steps;
      });
    mine.set(o.dataset, p);
  }
  return p;
}

/** The steps a turn read of a dataset, once the read has ended; undefined while it has not, or was never begun. */
export function stepsRead(turn: TurnState, dataset: string): Step[] | null | undefined {
  return ended.get(turn)?.get(dataset);
}

/** The steps, waited for at most `ms`: null when they come later, and the read goes on for the turn's tools. */
export async function stepsWithin(p: Promise<Step[] | null>, ms: number): Promise<Step[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((r) => {
    timer = setTimeout(() => r(null), ms);
  });
  const got = await Promise.race([p, late]);
  clearTimeout(timer);
  return got;
}
