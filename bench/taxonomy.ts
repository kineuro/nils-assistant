// SPDX-License-Identifier: AGPL-3.0-only
// The taxonomy, closed (Wave 4c §9.10 part 2): the ten failure words the
// prototype's evaluator used, plus four the corpus study named, plus a
// counted `other`; and a second axis of six values, the silent decisions
// every correction in the traffic reduced to.

/** The ten words the prototype's evaluator wrote into its trajectories, verbatim. */
export const PROTOTYPE_FAILURES = [
  "inefficient_query",
  "no_schema_discovery",
  "wrong_column",
  "wrong_count_grain",
  "incomplete_answer",
  "ambiguous_age_window",
  "wrong_question",
  "ambiguous_requirement_handling",
  "incomplete_filtering",
  "ambiguous_denominator",
] as const;

/** The four the corpus study added. */
export const ADDED_FAILURES = [
  "infrastructure_failure",
  "cohort_name_misresolution",
  "default_exclusion_omission",
  "identifier_fan_out",
] as const;

export const FAILURES = [...PROTOTYPE_FAILURES, ...ADDED_FAILURES, "other"] as const;
export type Failure = (typeof FAILURES)[number];

/** The six decisions a question leaves unstated and an answer must declare. */
export const SILENT_DECISIONS = ["grain", "scope", "membership", "key", "pick", "denominator"] as const;
export type SilentDecision = (typeof SILENT_DECISIONS)[number];

export function isFailure(word: string): word is Failure {
  return (FAILURES as readonly string[]).includes(word);
}

export function isSilentDecision(word: string): word is SilentDecision {
  return (SILENT_DECISIONS as readonly string[]).includes(word);
}

/**
 * A count over the closed set: an unknown word lands in `other`, and the
 * words that landed there are kept beside the count so the enum can grow by
 * evidence and never by a free-text cluster.
 */
export function tally(words: string[]): { counts: Record<Failure, number>; other: string[] } {
  const counts = Object.fromEntries(FAILURES.map((f) => [f, 0])) as Record<Failure, number>;
  const other: string[] = [];
  for (const w of words) {
    if (isFailure(w) && w !== "other") counts[w] += 1;
    else {
      counts.other += 1;
      other.push(w);
    }
  }
  return { counts, other };
}
