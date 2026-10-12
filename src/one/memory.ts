// SPDX-License-Identifier: AGPL-3.0-only
// What the one agent remembers across conversations (2026-10-12), read from
// the store the desk's Memory page shows: the install's instructions, what
// this person asked it to keep (all of it within 3,000 characters, else what
// is closest to the conversation's first words), and a few notes their work
// left. It is read when a conversation starts and held for its life, as the
// stations hold it (a conversation already open keeps what it started
// with), and told with the turn's facts. Asked to remember Nima's name, the
// chat once said twice that it had nowhere to write a note, while the page
// beside it held one from that same night.

import { MEMORY_CHARS, type Notes } from "../host/notes.ts";

/** What a conversation remembers, for the facts, and the memories it read, which the store marks as used. */
export interface Remembered {
  text: string;
  used: number[];
}

/** Text the facts carry, with nothing a tag would escape: a model that reads `&amp;` writes it back. */
function plainText(s: string): string {
  return s.replace(/&/gu, " and ").replace(/[<>]/gu, "").trim();
}

/** What a new conversation of this person remembers, as the facts tell it. */
export function memoryFacts(notes: Notes, subject: string, first: string | null): Remembered {
  const paused = notes.paused(subject);
  const guide = notes.instructions();
  const chosen = paused ? { read: [], rest: 0 } : notes.memoriesFor(subject, first);
  const work = paused ? [] : notes.work(subject);
  const out: string[] = [
    "What you remember across this person's conversations, read when this one started (the Memory page of the Assistant shows all of it, and there they add, edit, delete or pause it):",
  ];
  if (guide)
    out.push(
      `The install's instructions, from its admin (version ${guide.version}):\n${plainText(guide.text)}`,
    );
  if (paused)
    out.push(
      "This person paused memory: nothing they kept is read into a conversation and nothing new is kept. Keep nothing and do not offer to; they resume it on the Memory page.",
    );
  else if (chosen.read.length)
    out.push(
      `What this person asked you to keep, theirs alone (forget one with forget and its number):${chosen.read.map((n) => `\n- [${n.id}] ${plainText(n.text)}`).join("")}${chosen.rest > 0 ? `\n${chosen.rest} more ${chosen.rest === 1 ? "is" : "are"} kept and not shown here: find one with recall_memory when they refer to something they asked you to keep.` : ""}`,
    );
  else
    out.push(
      `Nothing this person asked you to keep yet: when they ask you to remember something, keep it with remember (at most ${MEMORY_CHARS} characters), and their later conversations start with it.`,
    );
  if (work.length)
    out.push(
      `Notes from this person's earlier work, newest first:${work.map((l) => `\n- ${plainText(l)}`).join("")}`,
    );
  return { text: out.join("\n\n"), used: chosen.read.map((n) => n.id) };
}
