// SPDX-License-Identifier: AGPL-3.0-only
// The words recall reads (the chat, slices 7 and 13). One matcher finds a
// person's earlier conversations by their titles and answers, and the memories
// closest to what they ask. Accents are dropped, filler is passed over, and
// words are met whole by their stems, so "cohorts" finds "cohort" and "men"
// never finds "women"; two letters count when they name something, as MS or T1
// do.

/** The words recall passes over: the ones that carry no subject of their own. */
const STOP = new Set(
  "about after again ago all also and any are ask asked back been before but can chat chats conversation conversations could did discussed does each earlier every find for from had has have how into just last many much not one our past per please previous remember said some talk talked tell than that the their them then there these they this title today told via was week were what when where which who why will with would yesterday you your".split(
    " ",
  ),
);

/** Text as recall reads it: accents dropped, in words. */
export function wordsOf(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "");
}

/** A word cut to its stem, so "cohorts" meets "cohort"; a cut that would leave fewer than three letters is not made. */
export function stem(word: string): string {
  const s = word
    .replace(/(?:ing|ed)$/u, "")
    .replace(/(x|ch|sh|ss)es$/u, "$1")
    .replace(/ies$/u, "y")
    .replace(/([^s])s$/u, "$1");
  return s.length >= 3 ? s : word;
}

/** The words of a question that carry meaning, by their stems: each once, at most `max`. */
export function termsOf(words: string, max = 8): string[] {
  return [
    ...new Set(
      wordsOf(words)
        .filter((w) => {
          const l = w.toLowerCase();
          if (STOP.has(l)) return false;
          return l.length > 2 || (l.length === 2 && (/\p{N}/u.test(w) || w === w.toUpperCase()));
        })
        .map((w) => stem(w.toLowerCase())),
    ),
  ].slice(0, max);
}

/** How many of the terms a text holds, each met by a whole word or by its stem. */
export function scoreOf(terms: readonly string[], text: string): number {
  const held = wordsOf(text).map((w) => w.toLowerCase());
  return terms.filter((t) => held.some((w) => w.startsWith(t) || stem(w).startsWith(t))).length;
}
