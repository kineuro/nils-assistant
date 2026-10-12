// SPDX-License-Identifier: AGPL-3.0-only
// One chat, a thread of 2026-10-12: what it showed, held. The registry's
// fields are every page of them, so a stack's do not stop at `kvp`; a list of
// one level's fields is asked for by its name.

import { describe, expect, it } from "vitest";
import { fieldLines, searchCatalog } from "../src/one/tools.ts";
import type { Seam } from "../src/seam/client.ts";
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
