// SPDX-License-Identifier: AGPL-3.0-only
// The numbers a turn was given and the counts its answer states. A chat
// asked for subjects once added a count of sessions that no result held: the
// subject count said again under another name. So what the turn reads is
// kept as a set of numbers (its tools' results, the facts, the person's
// words), and before the turn settles each count the answer states is looked
// up in it. Kept loose on purpose, so a right answer is never sent back:
// only whole numbers of three or more digits said of things counted, and a
// number that is the sum or the difference of two such numbers given passes.

/** A number as text carries one: grouped in thousands, or a run of digits. */
const NUMBER = /\d{1,3}(?:[,\u00a0\u2009\u202f]\d{3})+(?!\d)|\d+/gu;

/**
 * Add the numbers something holds to a set: a number as it is, a text's numbers (one grouped in thousands as the
 * whole and as its parts, since `12,345` in a row of values is two), a list's and a map's values, and a text that
 * is itself JSON as what it holds.
 */
export function noteNumbers(into: Set<number>, value: unknown, depth = 0): void {
  if (value === null || value === undefined || depth > 12) return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) into.add(Math.abs(Math.trunc(value)));
    return;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (/^[[{]/u.test(text))
      try {
        noteNumbers(into, JSON.parse(text), depth + 1);
        return;
      } catch {
        // not JSON after all: read as words
      }
    for (const m of text.matchAll(NUMBER)) {
      const digits = m[0].replace(/\D/gu, "");
      if (digits.length <= 15) into.add(Number(digits));
      if (digits.length !== m[0].length)
        for (const part of m[0].split(/\D/u)) if (part) into.add(Number(part));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const x of value) noteNumbers(into, x, depth + 1);
    return;
  }
  if (typeof value === "object") for (const x of Object.values(value)) noteNumbers(into, x, depth + 1);
}

/** The things a registry counts, as an answer names them. */
const THINGS = "subjects|people|participants|members|sessions|visits|scans|stacks|groups|pairs";
/** A whole number of three or more digits, grouped in thousands or not. */
const WHOLE = String.raw`\d{1,3}(?:[,\u00a0\u2009\u202f]\d{3})+|\d{3,}`;
/** A word between a number and what it counts: it holds a letter (such, 3D, T1-weighted, subject-and-scanner). */
const WORD = String.raw`(?=[^\s]*\p{L})[\p{L}\p{N}'\u2019/+-]+`;
/** A count as an answer states one: a number and, within three words, a thing counted; or a number of those. */
const STATED = new RegExp(
  String.raw`(?<![\p{L}\p{N}_#/.,:-])(?<!\d\s)(${WHOLE})(?![\p{L}\p{N}]|[.,:/-]\d)(?:((?:\s+${WORD}){0,3}?)\s+(${THINGS})\b|\s+of\s+(?:the|those|these|them|which|whom)\b)`,
  "giu",
);

/** Words before a number that make it no count: a document's number, a rounded figure, a threshold. */
const NO_COUNT_BEFORE =
  /(?:\b(?:documents?|questions?|versions?|numbers?|no\.?|ids?|runs?|jobs?)\s*#?|[#~\u2248<>\u2264\u2265=]|\b(?:about|around|roughly|approximately|approx\.?|nearly|almost|some|circa|close to|at least|at most|more than|fewer than|less than|greater than|over|under|above|below|up to|minimum of|maximum of))\s*$/iu;
/** Words after a number that make it no count: a share, a threshold. */
const NO_COUNT_AFTER = /^\s*(?:%|percent\b|per cent\b|or (?:more|fewer|less)\b|\+)/iu;

export interface StatedCount {
  /** The number. */
  n: number;
  /** As the answer wrote it, with what it counts. */
  text: string;
}

/**
 * The counts an answer states: whole numbers of three or more digits said of things counted (subjects, sessions,
 * visits, scans, stacks, groups, pairs), or of some of them ("282 of those"). A document's number, a year, a
 * threshold, a rounded figure and a percentage are no counts.
 */
export function countsStated(answer: string): StatedCount[] {
  // emphasis marks sit between a number and its words
  const text = answer.replace(/[*_`]/gu, "");
  const out: StatedCount[] = [];
  for (const m of text.matchAll(STATED)) {
    const written = m[1];
    const n = Number(written.replace(/\D/gu, ""));
    // a year, written as one: four digits, ungrouped
    if (/^\d{4}$/u.test(written) && n >= 1900 && n <= 2100) continue;
    const at = m.index ?? 0;
    if (NO_COUNT_BEFORE.test(text.slice(Math.max(0, at - 24), at))) continue;
    if (NO_COUNT_AFTER.test(text.slice(at + written.length, at + written.length + 12))) continue;
    out.push({ n, text: m[0].replace(/\s+/gu, " ") });
  }
  return out;
}

/**
 * Whether a number was given: itself, or the sum or the difference of two that were ("the other 282"), each of
 * three digits or more: beside the small numbers every result holds, any number would be a sum of two.
 */
export function given(n: number, known: ReadonlySet<number>): boolean {
  if (known.has(n)) return true;
  for (const a of known) {
    if (a < 100) continue;
    if ((n - a >= 100 && known.has(n - a)) || known.has(n + a)) return true;
  }
  return false;
}

/** The counts an answer states that nothing the turn was given holds, each once. */
export function countsNotGiven(answer: string, known: ReadonlySet<number>): StatedCount[] {
  const seen = new Set<number>();
  return countsStated(answer).filter((c) => {
    if (seen.has(c.n) || given(c.n, known)) return false;
    seen.add(c.n);
    return true;
  });
}
