// SPDX-License-Identifier: AGPL-3.0-only
// The discipline (Wave 4c §9.10 part 5): every edit to a prompt, a brief, a
// tool description or a check is a change manifest with a prediction, judged
// by the nine-state transition matrix: what was predicted against what was
// observed, on the held-out split and the loop split both.

export type Direction = "improve" | "same" | "regress";
export type Verdict = "keep" | "partial" | "revert" | "inconclusive";

export interface Manifest {
  id: string;
  /** What is edited: one component of the attribution order. */
  component: string;
  /** The named tasks predicted to flip from fail to pass. */
  predicted_flips: string[];
  /** The prediction on the loop split and on the held-out split. */
  predicted: { loop: Direction; held_out: Direction };
  /** The one edit, in prose. */
  change: string;
}

export interface Observation {
  loop: Direction;
  held_out: Direction;
  /** The tasks that flipped fail to pass, and pass to fail. */
  flipped_up: string[];
  flipped_down: string[];
}

/**
 * The nine states, predicted by observed, on one split:
 *   improve/improve keep, improve/same partial, improve/regress revert,
 *   same/improve keep, same/same keep, same/regress revert,
 *   regress/* inconclusive (a change predicted to regress is not a change to make).
 */
export function cell(predicted: Direction, observed: Direction): Verdict {
  if (predicted === "regress") return "inconclusive";
  if (observed === "regress") return "revert";
  if (predicted === "improve" && observed === "same") return "partial";
  return "keep";
}

/** The verdict over both splits: the held-out split rules; a regression anywhere reverts; partial on either is partial. */
export function judge(
  m: Manifest,
  o: Observation,
): { verdict: Verdict; loop: Verdict; held_out: Verdict; unpredicted: string[] } {
  const loop = cell(m.predicted.loop, o.loop);
  const held = cell(m.predicted.held_out, o.held_out);
  const unpredicted = o.flipped_up.filter((t) => !m.predicted_flips.includes(t));
  let verdict: Verdict;
  if (loop === "revert" || held === "revert" || o.flipped_down.length > 0) verdict = "revert";
  else if (loop === "inconclusive" || held === "inconclusive") verdict = "inconclusive";
  else if (loop === "partial" || held === "partial") verdict = "partial";
  else verdict = "keep";
  return { verdict, loop, held_out: held, unpredicted };
}

/** The direction of a change in a pass fraction, with a dead band of one task. */
export function direction(before: number, after: number, tasks: number): Direction {
  const step = tasks > 0 ? 1 / tasks : 0;
  if (after > before + step / 2) return "improve";
  if (after < before - step / 2) return "regress";
  return "same";
}
