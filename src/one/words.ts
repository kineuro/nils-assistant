// SPDX-License-Identifier: AGPL-3.0-only
// Plain words (one chat, 2026-10-09): what a person never reads in an
// answer. The door phrases are what a person heard when the chat said it
// could not reach something or handed the work on; the engine words are the
// engine's and the harness's vocabulary. The lists mirror the one-chat
// bench's lexicon (bench/corpus/one-chat-lexicon.yml), so the check before a
// turn settles and the bench count the same words.

export const DOOR_PHRASES: readonly string[] = [
  "\\bdoor\\b[^.]{0,40}\\bclosed\\b",
  "\\bclosed to me\\b",
  "cannot see the catalog",
  "can't see the catalog",
  "\\b(see|reach|read|open|get at)\\b[^.]{0,30}\\bfrom here\\b",
  "outside (my|the|this station's) grant",
  "not in (my|this station's) grant",
  "\\bit is working\\b",
  "\\bis working on it\\b",
  "\\bhanded (it|the question|the task|this) (on|over|to)\\b",
  "\\banother station\\b",
  "\\bdelegat(e|ed|ing|ion)\\b",
  "\\btalking to\\b",
];

export const ENGINE_WORDS: readonly string[] = [
  "\\bdoors?\\b",
  "\\bstations?\\b",
  "\\bphases?\\b",
  "\\bgrants?\\b",
  "\\bepochs?\\b",
  "\\bceilings?\\b",
  "\\bhandles? (id|#?\\d+)\\b",
  "\\bcatalog\\b",
  "\\benforced places?\\b",
  "\\bcapabilities\\b",
  "\\brungs?\\b",
  "\\bseam\\b",
  "\\bledger\\b",
  "\\bmanifest\\b",
  "\\bast_version\\b",
  "\\bpacks?\\b",
  "\\bsession scheme\\b",
  "\\bactivate_skill\\b",
  "\\bregistry_(summary|search|describe)\\b",
  "\\bquery_(draft|run_readonly|read_rows)\\b",
  "\\bpropose_change\\b",
];

/** The words of a text a person should not read, each once, as they were written. */
export function unplainWords(text: string): string[] {
  const out = new Set<string>();
  for (const p of [...DOOR_PHRASES, ...ENGINE_WORDS])
    for (const m of text.matchAll(new RegExp(p, "giu"))) out.add(m[0].toLowerCase());
  return [...out];
}

/**
 * A text the engine or a tool wrote, with the engine's vocabulary put in plain words before the model reads
 * it: a model repeats the words it is given, so a reason that says "not in this station's grant" comes back in
 * the answer. Only whole words change; names and values stay.
 */
export function plainly(text: string): string {
  return text
    .replace(/\bis not in this station's grant; the grant holds [^.;]*/giu, "is not open to this chat")
    .replace(/\bthis station's grant\b/giu, "what this chat may do")
    .replace(/\bthe station's\b/giu, "this chat's")
    .replace(/\bstations?\b/giu, "chat")
    .replace(/\bgrants?\b/giu, "access")
    .replace(/\bdoors?\b/giu, "service")
    .replace(/\bcatalog\b/giu, "registry")
    .replace(/\bepochs?\b/giu, "version")
    .replace(/\bceilings?\b/giu, "limit")
    .replace(/\bphases?\b/giu, "step")
    .replace(/\brungs?\b/giu, "level");
}
