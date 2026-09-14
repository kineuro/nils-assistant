// SPDX-License-Identifier: AGPL-3.0-only
// The memory a conversation holds (the chat, slice 5): a person's notes are read at the
// conversation's first turn and kept in its own state, so its instructions stay the same from
// then on. A conversation copied for someone else, as a share its reader continues, carries that
// state with it, so the snapshot names whose it is and is used only for that person.

export type HeldMemory = { owner: string; text: string };

/** The text a held snapshot gives the conversation's owner: none when it was taken for someone else, or before snapshots named their person. */
export function heldFor(held: unknown, owner: string): string | null {
  if (!held || typeof held !== "object") return null;
  const h = held as Partial<HeldMemory>;
  return h.owner === owner && typeof h.text === "string" ? h.text : null;
}
