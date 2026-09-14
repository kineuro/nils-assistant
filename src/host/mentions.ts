// SPDX-License-Identifier: AGPL-3.0-only
// A card, a cohort or a result named in a person's words (the chat, slice 12).
// The desk writes a mention into the message as @[its name](card:12),
// @[its name](cohort:MS) or @[its name](result:45) and draws it as a chip. A
// station reads the words as they are and is told what a mention names; an
// export and the model's title read the names plainly. A mention grants nothing:
// the station reads what is named with its own tools, under its own roles.

/** A mention in the words: @[name](kind:id), the name's brackets escaped and the id encoded. */
const MENTION = /@\[((?:\\.|[^\]\\])+)\]\((card|cohort|result):([^)\s]+)\)/gu;

const decoded = (id: string): string => {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
};

/** What every station is told about mentions, the same on every turn. */
export const MENTION_RULE =
  "A person may name a query card, a cohort or a result in their words as @[name](card:12), @[name](cohort:NAME) or @[name](result:45): card:12 is document 12, result:45 is handle 45, and a cohort goes by its name. Read what is named with your own tools before you answer about it. A mention grants nothing beyond your own roles.";

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
