// SPDX-License-Identifier: AGPL-3.0-only
// One chat, a thread of 2026-10-12: what it showed, held. The registry's
// fields are every page of them, so a stack's do not stop at `kvp`; a list of
// one level's fields is asked for by its name. A run that failed before any
// unit ran says why and what to do, never that no unit failed.

import { describe, expect, it } from "vitest";
import { Notes } from "../src/host/notes.ts";
import { memoryFacts } from "../src/one/memory.ts";
import { hintLine, routeOf } from "../src/one/route.ts";
import { fieldLines, runFailureView, runSay, searchCatalog } from "../src/one/tools.ts";
import type { Seam } from "../src/seam/client.ts";
import { readingOf } from "../src/stations/pipelines.ts";
import { catalogOf, prelude } from "../src/stations/prelude.ts";

/** A seam that answers the paths it knows, query and all, and refuses the rest. */
function pagedSeam(answers: Record<string, unknown>, asked: string[] = []): Seam {
  return {
    call: async ({ path }: { path: string }) => {
      asked.push(path);
      return path in answers
        ? { kind: "ok", status: 200, body: answers[path] }
        : { kind: "refused", status: 403, body: { error: "not here" } };
    },
  } as unknown as Seam;
}

const field = (path: string, type = "number") => ({ path, type, class: "plain" });

/** The catalog as the engine pages it: a stack's first page ends at kvp, the rest behind the level's own door. */
const PAGED = {
  "/api/ask/catalog": {
    epoch: 4,
    pack: { name: "mri", version: "1.1.0" },
    levels: [
      { level: "subject", fields: [field("code", "text")], next: null, total: 1 },
      {
        level: "stack",
        fields: [field("echo_time"), field("field_strength_tesla"), field("kvp")],
        next: "kvp",
        total: 7,
      },
    ],
    axes: [{ name: "technique", values: [{ id: "MPRAGE" }] }],
  },
  "/api/ask/guide": { grounding: ["a session is one subject on one day"] },
  "/api/ask/catalog/stack?after=kvp": {
    level: "stack",
    fields: [field("manufacturer", "text"), field("repetition_time")],
    next: "repetition_time",
    total: 7,
  },
  "/api/ask/catalog/stack?after=repetition_time": {
    level: "stack",
    fields: [field("slice_thickness"), field("text_series_description", "text")],
    next: null,
    total: 7,
  },
};

describe("the registry's fields, every page of them (2026-10-12)", () => {
  it("reads each level's further pages, so the summary and the search hold the fields past kvp", async () => {
    const asked: string[] = [];
    const text = await prelude(pagedSeam(PAGED, asked), "fields-whole", { toolCallId: "t", phase: "turn" });
    expect(asked).toEqual(
      expect.arrayContaining([
        "/api/ask/catalog/stack?after=kvp",
        "/api/ask/catalog/stack?after=repetition_time",
      ]),
    );
    // a level the engine gave whole is read once
    expect(asked.filter((p) => p.startsWith("/api/ask/catalog/subject"))).toEqual([]);
    const stack = fieldLines(text, "stack");
    expect(stack).toHaveLength(1);
    for (const f of ["echo_time", "kvp", "manufacturer", "repetition_time", "slice_thickness"])
      expect(stack[0]).toMatch(new RegExp(`\\b${f} \\(`, "u"));
    expect(stack[0]).toMatch(/text_series_description \(text\)/u);
    expect(text).not.toMatch(/not listed here/u);
    // the search finds a field the first page left out
    expect(searchCatalog(catalogOf("fields-whole"), "slice thickness")).toContain(
      "field slice_thickness of stack (number)",
    );
    expect(searchCatalog(catalogOf("fields-whole"), "series description")).toContain(
      "field text_series_description of stack (text)",
    );
  });

  it("says how many fields a page it could not read left out, and lists the rest", async () => {
    const { "/api/ask/catalog/stack?after=repetition_time": _, ...missing } = PAGED;
    const text = await prelude(pagedSeam(missing), "fields-short", { toolCallId: "t", phase: "turn" });
    const stack = fieldLines(text, "stack")[0];
    expect(stack).toMatch(/repetition_time \(number\)/u);
    expect(stack).toMatch(/and 2 more not listed here, found by their names$/u);
  });

  it("lists the fields per level and nothing else as the summary's fields", () => {
    const text = [
      "## The registry (pack mri 1.1.0, epoch 4)",
      "Grains and how a set draws from another (`of`):",
      "- cohort -> subject",
      'Fields per level (`["field", {}, "<path>"]`):',
      "- subject: code (text)",
      "- stack: echo_time (number), slice_thickness (number)",
      'Axes of a stack (`["axis", {}, "<name>"]`):',
      "- technique: MPRAGE",
    ].join("\n");
    expect(fieldLines(text)).toEqual([
      'Fields per level (`["field", {}, "<path>"]`):',
      "- subject: code (text)",
      "- stack: echo_time (number), slice_thickness (number)",
    ]);
    expect(fieldLines(text, "stack")).toEqual(["- stack: echo_time (number), slice_thickness (number)"]);
    expect(fieldLines(text, "visit")).toEqual([]);
  });
});

/** A run that failed as the two runs of the thread did: its input could not be released, so no unit ran. */
const STOPPED = {
  id: 2,
  pipeline_id: 5,
  pipeline: "n4-bias-correction@1",
  status: "failed",
  error:
    "run 2 the release of the input failed: dcm2niix is not runnable (No such file or directory (os error 2)). dcm2niix is a prerequisite of a deployment: install a current build from rordenlab/dcm2niix, which a distribution's package lags, and pass --dcm2niix if it is not on the path.",
  summary: { units: { total: 0, succeeded: 0, failed: 0, skipped: 0, unreported: 0 } },
};

describe("a run that failed before any unit ran (2026-10-12)", () => {
  it("says why from the run's own error, and what to do, never that no unit failed", () => {
    const r = readingOf(STOPPED, null, { items: [] }, "quasi");
    expect(r.failure).toMatchObject({
      error: expect.stringMatching(/dcm2niix is not runnable/u),
      withheld: false,
    });
    const say = runSay(r, 0, false);
    expect(say).toMatch(/failed before any unit ran/u);
    expect(say).toMatch(/why it failed, in plain words, from its error/u);
    expect(say).toMatch(/what to do about it, as its error says/u);
    expect(say).not.toMatch(/that no unit failed/u);
    expect(runFailureView(r.failure as never)).toEqual({
      error: expect.stringMatching(/rordenlab\/dcm2niix/u),
    });
  });

  it("reads the engine's failure where the run's answer gives one: its kind, cause, what to do and the command", () => {
    const run = {
      ...STOPPED,
      failure: {
        kind: "dependency",
        cause: "dcm2niix",
        advice: "Install dcm2niix on the machine that runs analyses, then run it again.",
        fix: { command: "nils tools install dcm2niix" },
      },
    };
    const r = readingOf(run, null, { items: [] }, "quasi");
    expect(r.failure).toMatchObject({
      kind: "dependency",
      cause: "dcm2niix",
      advice: expect.stringMatching(/^Install dcm2niix/u),
      command: "nils tools install dcm2niix",
    });
    expect(runSay(r, 0, false)).toMatch(
      /what to do about it: Install dcm2niix on the machine that runs analyses, then run it again\. \(nils tools install dcm2niix\)/u,
    );
  });

  it("keeps the error's words from a person below detail quasi, and still says the engine's kind and advice", () => {
    const bare = readingOf(STOPPED, null, { items: [] }, "plain");
    expect(bare.failure).toMatchObject({ error: null, withheld: true });
    expect(JSON.stringify(runFailureView(bare.failure as never))).not.toMatch(/dcm2niix/u);
    expect(runSay(bare, 0, false)).toMatch(/why is shown to a person who may see more detail/u);
    const told = readingOf(
      { ...STOPPED, failure: { kind: "dependency", cause: "dcm2niix", advice: "Install dcm2niix." } },
      null,
      { items: [] },
      "plain",
    );
    expect(told.failure).toMatchObject({ cause: "dcm2niix", advice: "Install dcm2niix.", error: null });
    expect(runSay(told, 0, false)).toMatch(
      /why it failed: dependency, dcm2niix, and what to do about it: Install dcm2niix\./u,
    );
  });

  it("leaves a run that names no failure as it was read", () => {
    const run = {
      id: 3,
      pipeline: "synthseg@2",
      status: "partial",
      summary: { units: { total: 4, succeeded: 2, failed: 2, skipped: 0, unreported: 0 } },
    };
    const r = readingOf(run, null, { items: [] }, "quasi");
    expect(r.failure).toBeNull();
    expect(runSay(r, 2, false)).toMatch(
      /with 2 of 4 units done; that 2 units failed, by reason; that no unit broke a check/u,
    );
  });
});

describe("a file asked of the chat (2026-10-12)", () => {
  it("is read from a kind of file and something done with it, and answered in words before any question", () => {
    const r = routeOf("can you make a csv and upload it here?");
    expect(r).toMatchObject({ file: true, skill: null });
    const hint = hintLine(r, ["find-data"], ["query_draft"]);
    expect(hint).toMatch(/cannot make, attach or send a file in this chat yet/u);
    expect(hint).toMatch(/analysis sandbox, which is coming/u);
    expect(hint).toMatch(/without asking first/u);
    expect(hint).toMatch(/nils ask handles export/u);
    // a person who may not look up data is not offered a question
    expect(hintLine(r, [], [])).not.toMatch(/Query page/u);
    for (const words of [
      "Export the scans of cohort B as a spreadsheet",
      "Can I download that as an Excel file?",
    ])
      expect(routeOf(words).file, words).toBe(true);
    // words about files the registry holds ask for no file
    for (const words of ["Which files did the digest refuse?", "How many subjects are in cohort B?"])
      expect(routeOf(words).file, words).toBeFalsy();
  });
});

describe("what a new conversation remembers (2026-10-12)", () => {
  it("says there is a memory even when nothing is kept yet, and how to add to it", () => {
    const notes = new Notes(":memory:");
    const m = memoryFacts(notes, "bo@n", "hello");
    expect(m.used).toEqual([]);
    expect(m.text).toMatch(/Memory page of the Assistant/u);
    expect(m.text).toMatch(
      /Nothing this person asked you to keep yet: when they ask you to remember something, keep it with remember/u,
    );
  });

  it("reads what fits in 3,000 characters, the closest to the first words first, and counts the rest", () => {
    const notes = new Notes(":memory:");
    for (let i = 0; i < 14; i++)
      notes.remember(
        "bo@n",
        `note ${i} ${"about the cohorts and their scans ".repeat(7)}`.slice(0, 290),
        "page",
      );
    const kept = notes.remember("bo@n", "Call me Bo & answer in short sentences <please>", "said");
    const m = memoryFacts(notes, "bo@n", "answer me in short sentences");
    expect(m.used[0]).toBe(kept.id);
    expect(m.text).toMatch(
      new RegExp(`\\[${kept.id}\\] Call me Bo  and  answer in short sentences please`, "u"),
    );
    expect(m.text).not.toMatch(/[<>&]/u);
    expect(m.text).toMatch(/\d+ more are kept and not shown here: find one with recall_memory/u);
  });
});
