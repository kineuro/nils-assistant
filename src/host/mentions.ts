// SPDX-License-Identifier: AGPL-3.0-only
// A card, a cohort, a result or a saved selection named in a person's words
// (the chat, slice 12; record 55 K6). The desk writes a mention into the
// message as @[its name](card:12), @[its name](cohort:MS),
// @[its name](result:45) or @[its name](selection:ms-baseline%402) and draws it
// as a chip. A station reads the words as they are and is told what a mention
// names; the one chat is told, each turn, what the mentions of the message name
// and which of its tools reads each; an export and the model's title read the
// names plainly. A mention grants nothing: what is named is read with the
// assistant's own tools, under the person's own token and roles.

/** A mention in the words: @[name](kind:id), the name's brackets escaped and the id encoded. */
const MENTION = /@\[((?:\\.|[^\]\\])+)\]\((card|cohort|result|selection):([^)\s]+)\)/gu;

const decoded = (id: string): string => {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
};

/** What every station is told about mentions, the same on every turn. */
export const MENTION_RULE =
  "A person may name a query card, a cohort, a result or a saved selection in their words as @[name](card:12), @[name](cohort:NAME), @[name](result:45) or @[name](selection:NAME@2): card:12 is document 12, result:45 is handle 45, selection:NAME@2 is version 2 of the saved selection NAME (written with %40 for the @ in the words), and a cohort goes by its name. Read what is named with your own tools before you answer about it. A mention grants nothing beyond your own roles.";

export type MentionKind = "card" | "cohort" | "result" | "selection";

/** One mention of a message: what kind of thing it names, its id decoded, and the name the person saw. */
export interface Mention {
  kind: MentionKind;
  id: string;
  name: string;
}

/** The mentions of a message, in order, each once. */
export function mentionsIn(text: string): Mention[] {
  const out: Mention[] = [];
  for (const m of text.matchAll(MENTION)) {
    const mention: Mention = {
      kind: m[2] as MentionKind,
      id: decoded(m[3] as string),
      name: (m[1] as string).replace(/\\(.)/gu, "$1"),
    };
    if (!out.some((o) => o.kind === mention.kind && o.id === mention.id)) out.push(mention);
  }
  return out;
}

/** The most mentions one turn's facts explain; a message naming more has the rest read by their ids alone. */
export const MENTIONS_TOLD = 8;

/**
 * What the mentions of a message name, for the one chat's facts of the turn: each one in plain words and the tool
 * that reads it, where that tool is mounted for this person. Null where the message names nothing.
 */
export function mentionsLine(text: string, tools: readonly string[]): string | null {
  const all = mentionsIn(text);
  if (all.length === 0) return null;
  const has = (t: string) => tools.includes(t);
  const lines = all.slice(0, MENTIONS_TOLD).map((m) => {
    switch (m.kind) {
      case "card":
        return `- "${m.name}" is the person's question, document ${m.id}${has("query_run_readonly") ? `: run it with query_run_readonly (what: document, document: ${m.id}) for its count and first rows` : ""}.`;
      case "result":
        return `- "${m.name}" is a kept answer, handle ${m.id}${has("query_read_rows") ? `: read its rows with query_read_rows (handle: ${m.id})` : ""}.`;
      case "cohort":
        return `- "${m.name}" is the cohort ${m.id}: a question over it names the cohort.`;
      default:
        return `- "${m.name}" is the saved selection ${m.id}, the scans an analysis runs over${has("query_read_rows") ? `: read what it holds and how many with query_read_rows (selection: ${m.id})` : ""}; an analysis over it is planned with \`selection: ${m.id}\`.`;
    }
  });
  return `The person's message names (read what you need with your tools before you answer about it; a mention grants nothing beyond this person's own access):\n${lines.join("\n")}`;
}

/**
 * The words with each mention read plainly: its name, and with `kinds` what it names, as
 * "Women in cohort A (card 12)", "MS (cohort)" or "T1 series (result 45)".
 */
export function plainMentions(text: string, o: { kinds?: boolean } = {}): string {
  return text.replace(MENTION, (_all, name: string, kind: string, id: string) => {
    const said = name.replace(/\\(.)/gu, "$1");
    if (!o.kinds) return said;
    return kind === "cohort" ? `${said} (cohort)` : `${said} (${kind} ${decoded(id)})`;
  });
}
