// SPDX-License-Identifier: AGPL-3.0-only
// The turn's facts (one chat, 2026-10-09): what is true now and differs per
// person and per turn, appended as one message at the turn boundary so the
// instructions above them stay the same for every conversation and a
// runtime's prefix cache serves them. The registry summary, the datasets and
// the line of what the person may do are sent once per conversation, and
// again only when they change; the routing hint goes with every turn.
//
// A signal reaches the model as a user-role message (Flue renders it as a
// tag), which a server that takes a system message only at the start
// accepts. Its text is escaped as XML, so the summary is written without
// angle brackets or ampersands: a model that reads `&gt;` writes it back.

import { createHash } from "node:crypto";

/** The registry summary as the facts carry it: the prelude's text in plain words, with nothing a tag would escape. */
export function factsSummary(prelude: string): string {
  // the language's functions are the find-data skill's to teach, written as they are; a tag would escape them
  const lines: string[] = [];
  let skipping = false;
  for (const l of prelude.split("\n")) {
    if (/^Functions, by family:/u.test(l)) {
      skipping = true;
      continue;
    }
    if (skipping && /^- /u.test(l)) continue;
    skipping = false;
    lines.push(l);
  }
  return lines
    .filter((l) => !/^Session schemes:/u.test(l))
    .map((l) =>
      l
        .replace(/^## The registry \([^)]*\)/u, "## What the registry holds")
        .replace(/^## The engine's grounding/u, "## How the registry counts")
        .replace(/->/gu, "→")
        .replace(/<([a-z_ ]+)>/giu, "{$1}")
        .replace(/\s*>=\s*/gu, " at least ")
        .replace(/\s*<=\s*/gu, " at most ")
        .replace(/[<>]/gu, "")
        .replace(/&/gu, " and "),
    )
    .join("\n")
    .trim();
}

export const hashOf = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** What a conversation has been told already, kept in its durable state. */
export interface Told {
  summary: string | null;
  grants: string | null;
  /** The datasets told last; absent in a conversation from before they were. */
  datasets?: string | null;
  /** How many times the runtime had summarized the conversation's earlier turns when the facts were told; absent before 2026-10-10. */
  compactions?: number;
}

/** Nothing told: the facts are sent whole on the next turn. */
export const TOLD_NOTHING: Told = { summary: null, grants: null, datasets: null };

/**
 * What the conversation still holds of the facts it was told (2026-10-10, review of the one chat): a summary of its
 * earlier turns replaces the messages the facts came in, so after one the facts are told again, whole. A summary is
 * known from the runtime's event in this process, or from the count the registry of conversations keeps, which a
 * restart does not lose.
 */
export function toldSince(told: Told, compactions: number, summarizedHere: boolean): Told {
  return summarizedHere || (told.compactions ?? 0) !== compactions ? TOLD_NOTHING : told;
}

/** The facts of one turn, and what the conversation has been told after it. */
export function factsOf(o: {
  told: Told;
  summary: string | null;
  /** The datasets as the facts carry them (src/one/datasets.ts); null where this person's facts carry none. */
  datasets?: string | null;
  grants: string;
  hint: string;
  document: number | null;
  /** The conversation's summaries so far, kept with what it was told. */
  compactions?: number;
}): { text: string; told: Told } {
  const parts: string[] = [];
  const told: Told = { ...o.told, ...(o.compactions !== undefined ? { compactions: o.compactions } : {}) };
  if (o.summary !== null) {
    const h = hashOf(o.summary);
    if (told.summary !== h) {
      parts.push(o.summary);
      told.summary = h;
    }
  } else if (told.summary === null) {
    parts.push("The registry's summary could not be read for this person.");
    told.summary = "none";
  }
  if (o.datasets) {
    const h = hashOf(o.datasets);
    if (told.datasets !== h) {
      parts.push(o.datasets);
      told.datasets = h;
    }
  }
  const g = hashOf(o.grants);
  if (told.grants !== g) {
    parts.push(o.grants);
    told.grants = g;
  }
  if (o.document !== null) parts.push(`The question open on the person's page is document ${o.document}.`);
  parts.push(o.hint);
  return { text: parts.join("\n\n"), told };
}
