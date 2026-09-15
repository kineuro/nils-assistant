// SPDX-License-Identifier: AGPL-3.0-only
// The chat, slice 6: memory. The guard refuses what looks like a person's
// data; a person's memory is kept when they ask, offered when they did not,
// edited and deleted only by them, paused apart from reset, and read by every
// new conversation beside the install's versioned instructions.

import { describe, expect, it } from "vitest";
import { doorOf } from "../src/host/access.ts";
import { guardMemory } from "../src/host/guard.ts";
import { MemoryRefused, Notes } from "../src/host/notes.ts";
import { forgetFor, rememberFor } from "../src/stations/memory.ts";

describe("the memory guard", () => {
  it("refuses a person's data by its shape, and names the shape", () => {
    for (const text of [
      "S-0001 is the index case",
      "NMOSD-0012 dropped out",
      "she was born 1961-04-02",
      "scanned on 02.04.1961",
      "personnummer 19610402-1234",
      "the study UID is 1.2.840.113619.2.55.3.604688",
      "accession 123456789",
      "write to anna@example.org",
      "the series t1_mprage_sag_p2 is the best one",
    ]) {
      const g = guardMemory(text, { series: true });
      expect(g.ok, text).toBe(false);
    }
    expect(guardMemory("S-0001", { series: true })).toEqual({
      ok: false,
      why: "It holds what looks like a subject code, and memory never keeps a person's data.",
    });
  });

  it("keeps a preference, a fact about the work and the words of the field", () => {
    for (const text of [
      "I count subjects by cohort, not by site",
      "Cohort A means the MS patients scanned from 2019 to 2021",
      "T1w and FLAIR in the same session",
      "the MS2019 study is the main one",
      "answer in one short sentence",
    ])
      expect(guardMemory(text, { series: true }), text).toEqual({ ok: true });
    // the install's instructions may name a sequence
    expect(guardMemory("T1_MPRAGE_SAG is what we mean by T1w")).toEqual({ ok: true });
  });
});

describe("a person's memory", () => {
  it("is kept, edited and deleted by its person only, within its size, and never while paused", () => {
    const notes = new Notes(":memory:");
    const kept = notes.remember("anna@desk", "  I count subjects   by cohort ", "said");
    expect(kept).toMatchObject({ kind: "person", text: "I count subjects by cohort", source: "said" });
    expect(() => notes.remember("anna@desk", "x".repeat(301), "page")).toThrow(MemoryRefused);
    expect(() => notes.remember("anna@desk", "S-0001 is the index case", "page")).toThrow(/subject code/u);
    expect(notes.edit("anna@desk", kept.id, "I count subjects by site").edited_at).not.toBeNull();
    expect(() => notes.edit("bo@desk", kept.id, "mine now")).toThrow(MemoryRefused);
    expect(notes.removeOwn("bo@desk", kept.id)).toBe(false);
    notes.add({
      subject: "anna@desk",
      kind: "study",
      station: "ask-help",
      text: "document 12: the women in cohort A",
      source: "work",
    });
    expect(notes.people("anna@desk").map((n) => n.text)).toEqual(["I count subjects by site"]);
    expect(notes.work("anna@desk")).toEqual(["study: document 12: the women in cohort A"]);
    notes.touch([kept.id]);
    expect(notes.people("anna@desk")[0]?.used_at).not.toBeNull();
    // paused: nothing is kept, and what was kept stays until it is deleted
    expect(notes.pause("anna@desk", true)).toBe(true);
    expect(notes.paused("anna@desk")).toBe(true);
    expect(() => notes.remember("anna@desk", "prefers short answers", "said")).toThrow(/paused/u);
    expect(notes.people("anna@desk")).toHaveLength(1);
    expect(notes.pause("anna@desk", false)).toBe(false);
    // the work's notes go with the retention; what the person kept does not
    notes.db.prepare("UPDATE note SET at = 0").run();
    notes.sweepWork(90);
    expect(notes.work("anna@desk")).toEqual([]);
    expect(notes.people("anna@desk")).toHaveLength(1);
    expect(notes.removeOwn("anna@desk", kept.id)).toBe(true);
    notes.remember("anna@desk", "prefers short answers", "page");
    expect(notes.deleteSubject("anna@desk")).toBe(1);
  });

  it("is kept by the assistant when the person asked, offered when they did not, and forgotten by its number", () => {
    const notes = new Notes(":memory:");
    const offered = rememberFor(notes, "anna@desk", { text: "prefers counts by cohort", asked: false });
    expect(offered.part).toEqual({
      kind: "memory",
      state: "proposed",
      text: "prefers counts by cohort",
      id: null,
    });
    expect(notes.people("anna@desk")).toEqual([]);
    const said = rememberFor(notes, "anna@desk", { text: "prefers counts by cohort", asked: true });
    expect(said.part).toMatchObject({ kind: "memory", state: "saved", text: "prefers counts by cohort" });
    const id = notes.people("anna@desk")[0]?.id as number;
    expect(rememberFor(notes, "anna@desk", { text: "NMOSD-0012 is hers", asked: true })).toMatchObject({
      part: null,
      output: { refused: true },
    });
    expect(forgetFor(notes, "bo@desk", id)).toMatchObject({ part: null, output: { refused: true } });
    expect(forgetFor(notes, "anna@desk", id).part).toEqual({
      kind: "memory",
      state: "forgotten",
      text: "prefers counts by cohort",
      id,
    });
    notes.pause("anna@desk", true);
    expect(rememberFor(notes, "anna@desk", { text: "anything", asked: true })).toMatchObject({
      part: null,
      output: { refused: true },
    });
  });
});

describe("the install's instructions", () => {
  it("are versioned, written by a named person, and refuse a person's data", () => {
    const notes = new Notes(":memory:");
    expect(notes.instructions()).toBeNull();
    notes.writeInstructions("Cohort A is the MS patients; cohort B the controls.", "di@desk");
    const second = notes.writeInstructions(
      "Cohort A is the MS patients; cohort B the controls. T1_MPRAGE_SAG is T1w.",
      "di@desk",
    );
    expect(second).toMatchObject({ version: 2, author: "di@desk" });
    expect(notes.instructions()?.version).toBe(2);
    expect(notes.instructionHistory().map((h) => h.version)).toEqual([2, 1]);
    expect(() => notes.writeInstructions("x".repeat(4001), "di@desk")).toThrow(MemoryRefused);
    expect(() => notes.writeInstructions("S-0001 is our first subject", "di@desk")).toThrow(/subject code/u);
  });

  it("and a person's memory are reached through the person's own doors", () => {
    expect(doorOf("GET", "/memory")).toEqual({ kind: "person" });
    expect(doorOf("POST", "/memory")).toEqual({ kind: "person" });
    expect(doorOf("PATCH", "/memory/12")).toEqual({ kind: "person" });
    expect(doorOf("PUT", "/memory/pause")).toEqual({ kind: "person" });
    expect(doorOf("GET", "/instructions")).toEqual({ kind: "person" });
    expect(doorOf("PUT", "/instructions")).toEqual({ kind: "person", needs: "assistant-settings:work" });
  });
});
