// SPDX-License-Identifier: AGPL-3.0-only
// The chat, slice 13: what a new conversation reads of a person's memory. All of
// it while it fits in 3,000 characters; beyond that, the memories closest to the
// conversation's first message, a count of the rest, and a tool that finds them.

import { describe, expect, it } from "vitest";
import { MEMORY_BUDGET, type Note, Notes } from "../src/host/notes.ts";
import { forgetFor, recallFor } from "../src/stations/memory.ts";

const GROUPS = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliet",
  "kilo",
];
const report = (group: string) =>
  `For the ${group} group, write reports as a short table with one sentence under it. ${"Keep the columns narrow, spell out every abbreviation, and leave out what was not asked. ".repeat(3)}`.slice(
    0,
    280,
  );
const size = (n: Note) => n.text.length + String(n.id).length + 6;

describe("what a new conversation reads of a person's memory", () => {
  it("is all of it while it fits", () => {
    const notes = new Notes(":memory:");
    const a = notes.remember("anna@desk", "prefers counts by cohort", "page");
    const b = notes.remember("anna@desk", "writes reports as tables", "page");
    const got = notes.memoriesFor("anna@desk", "how many sessions");
    expect(got.rest).toBe(0);
    expect(got.read.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("is what is closest to the first message beyond the budget, with the rest counted and found by their words", () => {
    const notes = new Notes(":memory:");
    for (const g of GROUPS) notes.remember("anna@desk", report(g), "page");
    const lesion = notes.remember(
      "anna@desk",
      `When I ask about lesion counts, count sessions and never stacks, and say which cohort each session belongs to. ${"Keep the answer short. ".repeat(8)}`.slice(
        0,
        280,
      ),
      "page",
    );
    const all = notes.people("anna@desk", 1000);
    expect(all.reduce((sum, n) => sum + size(n), 0)).toBeGreaterThan(MEMORY_BUDGET);
    const got = notes.memoriesFor("anna@desk", "How many lesion sessions does each cohort hold?");
    expect(got.read[0]?.id).toBe(lesion.id);
    expect(got.read.reduce((sum, n) => sum + size(n), 0)).toBeLessThanOrEqual(MEMORY_BUDGET);
    expect(got.rest).toBe(all.length - got.read.length);
    expect(got.rest).toBeGreaterThan(0);
    // with no first message, the latest come first
    expect(notes.memoriesFor("anna@desk", null).read[0]?.id).toBe(all[0]?.id);
    // what was left out is found by its words, the closest first
    const left = all.filter((n) => !got.read.some((r) => r.id === n.id));
    const group = /For the (\w+) group/u.exec(left[0]?.text ?? "")?.[1] ?? "";
    expect(group).not.toBe("");
    const found = recallFor(notes, "anna@desk", `what did I ask you to keep about the ${group} group`) as {
      memories: { id: number; text: string }[];
    };
    expect(found.memories[0]?.id).toBe(left[0]?.id);
    expect(found.memories.length).toBeLessThanOrEqual(8);
    expect(recallFor(notes, "anna@desk", "the the and")).toEqual({ memories: [] });
    notes.pause("anna@desk", true);
    expect(recallFor(notes, "anna@desk", "lesion")).toEqual({ paused: true, memories: [] });
  });

  it("forgets any of the person's memories by its number, however many they keep", () => {
    const notes = new Notes(":memory:");
    const oldest = notes.remember("anna@desk", "prefers counts by cohort", "page");
    for (let i = 0; i < 55; i++)
      notes.remember("anna@desk", `keeps a short note about the ${GROUPS[i % GROUPS.length]} group`, "page");
    expect(notes.people("anna@desk").some((n) => n.id === oldest.id)).toBe(false);
    expect(forgetFor(notes, "bo@desk", oldest.id).part).toBeNull();
    expect(forgetFor(notes, "anna@desk", oldest.id).part).toMatchObject({
      state: "forgotten",
      id: oldest.id,
    });
    expect(notes.ownMemory("anna@desk", oldest.id)).toBeNull();
  });
});
