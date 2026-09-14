// SPDX-License-Identifier: AGPL-3.0-only
// What memory never holds (the chat, slice 6): a person's data. A memory is a
// preference, a fact about someone's work or a way they work, and it rides
// into every new conversation of theirs, so it is refused when it looks like
// a personal identity number, a DICOM UID, a long identifier such as an
// accession number, a full date, an e-mail address, a subject code, or, in a
// person's own memory, a series description. The patterns are shapes, never
// a list of values: a name written out in words is not caught.

const RULES: { test: RegExp; why: string; series?: true }[] = [
  { test: /\b(?:19|20)?\d{6}[-+]?\d{4}\b/u, why: "a personal identity number" },
  { test: /\b\d+(?:\.\d+){5,}\b/u, why: "a DICOM UID" },
  { test: /\b\d{9,}\b/u, why: "a long number, such as an accession number or an identifier" },
  { test: /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/u, why: "a full date" },
  { test: /\b(?:0?[1-9]|[12]\d|3[01])[./](?:0?[1-9]|1[0-2])[./](?:19|20)?\d{2}\b/u, why: "a full date" },
  { test: /[\w.+-]+@[\w-]+\.[\w.-]+/u, why: "an e-mail address" },
  // letters, perhaps a dash, and three to six digits that are not a year: S-0001, NMOSD-0012
  { test: /\b[A-Za-z]{1,5}[-_]?(?!(?:19|20)\d{2}\b)\d{3,6}\b/u, why: "what looks like a subject code" },
  {
    test: /\b[A-Za-z0-9]+(?:_[A-Za-z0-9]+){2,}\b/u,
    why: "what looks like a series description",
    series: true,
  },
];

/** Whether a text may be kept; the reason when it may not, naming the shape and never the value. */
export function guardMemory(
  text: string,
  o: { series?: boolean } = {},
): { ok: true } | { ok: false; why: string } {
  for (const r of RULES) {
    if (r.series && !o.series) continue;
    if (r.test.test(text))
      return { ok: false, why: `It holds ${r.why}, and memory never keeps a person's data.` };
  }
  return { ok: true };
}
