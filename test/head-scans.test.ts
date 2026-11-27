// SPDX-License-Identifier: AGPL-3.0-only
// A brain scan is the head. The cookbook's worked example asks it by the
// region, and is the example put before a question of brain or head scans;
// no example filters the fine part, which is for questions about coverage.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { findExamples } from "../src/one/skills.ts";
import { closest } from "../src/stations/select.ts";

describe("the cookbook's head scans", () => {
  const COOKBOOK = "stations/ask-help/cookbook";
  const strip = (raw: string): string =>
    raw
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");

  it("asks a brain scan by the region, in the cookbook's made-up names", () => {
    const raw = readFileSync(`${COOKBOOK}/head-scans-a.ask.yml`, "utf8");
    expect(raw).toMatch(/^# question: How many subjects of cohort A have a 3D FLAIR brain scan\?$/mu);
    expect(raw).toMatch(/^# synthetic: /mu);
    const doc = parse(raw) as {
      sets: Record<string, { grain: string; where?: unknown[] }>;
      out: { set: string; level: string };
    };
    expect(doc.sets.flair.grain).toBe("stack");
    expect(doc.sets.flair.where?.[0]).toEqual(["=", {}, ["axis", {}, "body_region"], "head"]);
    expect(doc.out).toEqual({ set: "answer", level: "count" });
    // the fine part is named in its comment alone
    expect(strip(raw)).not.toContain("body_part");
  });

  it("is the example closest to a question of brain or head scans, and no example filters the fine part", () => {
    const examples = findExamples(["./stations"]);
    for (const q of [
      "How many subjects have 3D FLAIR scans that are all brain?",
      "How many brain scans do we have?",
      "How many head scans are there in cohort B?",
    ])
      expect(closest(q, examples, 3)[0].file, q).toBe("head-scans-a.ask.yml");
    for (const f of readdirSync(COOKBOOK).filter((x) => x.endsWith(".ask.yml")))
      expect(strip(readFileSync(`${COOKBOOK}/${f}`, "utf8")), f).not.toContain("body_part");
  });
});
