// SPDX-License-Identifier: AGPL-3.0-only
// The memory a conversation holds (the chat, slice 5): a person's notes are read at the
// conversation's first turn and kept in its own state, so its instructions stay the same from
// then on. A conversation copied for someone else, as a share its reader continues, carries that
// state with it, so the snapshot names whose it is and is used only for that person. A station
// keeps a memory when the person asked it to, offers one when they did not, and forgets one by
// its number (the chat, slice 6).

import type { JsonValue } from "@flue/runtime";
import { checkMemory, MemoryRefused, type Notes } from "../host/notes.ts";

/** A memory as the thread shows it: offered, kept, or forgotten. */
export type MemoryPart = {
  kind: "memory";
  state: "proposed" | "saved" | "forgotten";
  text: string;
  id: number | null;
};

export type HeldMemory = { owner: string; text: string };

/** The text a held snapshot gives the conversation's owner: none when it was taken for someone else, or before snapshots named their person. */
export function heldFor(held: unknown, owner: string): string | null {
  if (!held || typeof held !== "object") return null;
  const h = held as Partial<HeldMemory>;
  return h.owner === owner && typeof h.text === "string" ? h.text : null;
}

/** The remember tool: kept when the person asked, offered to them when they did not, refused while paused or when it looks like a person's data. */
export function rememberFor(
  notes: Notes,
  subject: string,
  a: { text: string; asked: boolean },
): { output: JsonValue; part: MemoryPart | null } {
  try {
    if (!a.asked) {
      if (notes.paused(subject))
        throw new MemoryRefused(409, "the person paused memory; keep nothing and do not offer to");
      // checked as a memory would be, without keeping it
      const text = checkMemory(a.text);
      return {
        output: { offered: true, note: "The person is asked whether to keep it; do not offer it again." },
        part: { kind: "memory", state: "proposed", text, id: null },
      };
    }
    const n = notes.remember(subject, a.text, "said");
    return {
      output: { kept: true, id: n.id },
      part: { kind: "memory", state: "saved", text: n.text, id: n.id },
    };
  } catch (e) {
    if (e instanceof MemoryRefused) return { output: { refused: true, why: e.message }, part: null };
    throw e;
  }
}

/** The forget tool: one of the person's own memories, by its number. */
export function forgetFor(
  notes: Notes,
  subject: string,
  id: number,
): { output: JsonValue; part: MemoryPart | null } {
  const n = notes.people(subject).find((x) => x.id === id);
  if (!n || !notes.removeOwn(subject, id))
    return { output: { refused: true, why: `no memory ${id} of this person's` }, part: null };
  return { output: { forgotten: true, id }, part: { kind: "memory", state: "forgotten", text: n.text, id } };
}
