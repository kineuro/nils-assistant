// SPDX-License-Identifier: AGPL-3.0-only
// The measure of the stations (Wave 7a §14, T10) and its fixtures, with no
// network and no engine: the endpoints stay on this machine unless said, a
// case is scored on its verdict, the table names every station; the planted
// runs reproduce, unit by unit, the counts their cases in runs.json expect;
// the seed makes the cohorts and selections analysis-plan's cases name; the
// planted tree is DICOM Part 10.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { endpoint, missesOf, type Score, STATIONS, slug, table } from "../bench/measure.ts";
import { descriptor, PLANTED, PLANTED_PEOPLE, part10, plantedCode } from "../bench/planted.ts";
import { NMOSD, SELECTIONS } from "../bench/seed.ts";
import { reasonClass } from "../src/stations/pipelines.ts";

describe("the measure's endpoints", () => {
  it("stay on this machine unless --allow-remote says otherwise", () => {
    expect(endpoint("http://127.0.0.1:7300/", false, "--assistant")).toBe("http://127.0.0.1:7300");
    expect(endpoint("http://localhost:8437", false, "--engine")).toBe("http://localhost:8437");
    expect(endpoint("http://[::1]:7300", false, "--assistant")).toBe("http://[::1]:7300");
    expect(() => endpoint("https://api.example.com/v1", false, "--assistant")).toThrow(/not this machine/u);
    expect(() => endpoint("http://10.0.0.5:7300", false, "--assistant")).toThrow(/not this machine/u);
    expect(endpoint("http://10.0.0.5:7300", true, "--assistant")).toBe("http://10.0.0.5:7300");
    expect(() => endpoint("ftp://127.0.0.1", false, "--engine")).toThrow(/not http/u);
    expect(() => endpoint("nowhere", false, "--engine")).toThrow(/not a URL/u);
  });
  it("names a result file after its model", () => {
    expect(slug("qwen38-27b-fast")).toBe("qwen38-27b-fast");
    expect(slug("The Local 27B / thinking off")).toBe("the-local-27b-thinking-off");
  });
});

describe("a case of the generic runner", () => {
  const c = {
    id: "one",
    message: "m",
    expect: { result: { "held.reading": "same_kind", proposed: "present" } },
  };
  it("passes when it settles, every check passed and the named fields hold", () => {
    const v = {
      result: { held: { reading: "same_kind" }, proposed: { id_type: "x" } },
      checks: [{ name: "a", passed: true }],
    };
    expect(missesOf(c, v, "settled")).toEqual([]);
  });
  it("names each miss: the terminal, a failed check, a field", () => {
    const v = {
      result: { held: { reading: "none" } },
      checks: [{ name: "no_identifier_value", passed: false, why: "a value" }],
    };
    expect(missesOf(c, v, "budget")).toEqual([
      "ended budget, not settled",
      "check no_identifier_value: a value",
      'held.reading is "none", not "same_kind"',
      'proposed is undefined, not "present"',
    ]);
    expect(missesOf(c, null, "failed")).toEqual(["ended failed, not settled", "no verdict"]);
  });
});

describe("the table", () => {
  it("has a line for each station measured, in the stations' order, and says why one was not", () => {
    const s = (station: Score["station"], state: Score["state"], passed: number, of: number): Score => ({
      station,
      state,
      measure: "m",
      passed,
      of,
      loop: state === "measured" ? { passed, of } : null,
      held_out: state === "measured" ? { passed: 0, of: 0 } : null,
      detail: {},
      file: null,
      why: state === "measured" ? null : "no question set",
    });
    const t = table([s("operator", "unmeasured", 0, 0), s("ask-help", "measured", 3, 4)]).split("\n");
    expect(t).toHaveLength(4);
    expect(t[2]).toBe("| ask-help | 3 of 4 | 75 % | 3/4 | 0/0 | m |");
    expect(t[3]).toBe("| operator | unmeasured |  |  |  | no question set |");
    expect(STATIONS).toHaveLength(7);
  });
});

interface RunCase {
  id: string;
  run: { summary: { units: { total: number } } };
  expect: {
    failed: number;
    reasons: Record<string, number>;
    breaches: Record<string, number>;
    campaign: boolean;
  };
}
const runs = (JSON.parse(readFileSync("stations/run-read/evals/runs.json", "utf8")) as { cases: RunCase[] })
  .cases;

/** A check as a descriptor declares it, held by a value. */
function holds(check: string, value: number): boolean {
  const m = /^(\S+) (>=|<=|>|<|=) (\S+)$/u.exec(check);
  if (!m) throw new Error(check);
  const t = Number(m[3]);
  return (
    { ">=": value >= t, "<=": value <= t, ">": value > t, "<": value < t, "=": value === t }[m[2]] ?? false
  );
}

describe("the planted runs of run-read", () => {
  it("one per case of runs.json, and the tree holds one person a unit", () => {
    expect(PLANTED.map((p) => p.case).sort()).toEqual(runs.map((c) => c.id).sort());
    expect(PLANTED_PEOPLE).toBe(PLANTED.reduce((n, p) => n + p.units.length, 0));
    expect(plantedCode(7)).toBe("PLANT007");
  });
  for (const p of PLANTED) {
    it(`${p.case}: the units planted give the counts the case expects`, () => {
      const c = runs.find((x) => x.id === p.case) as RunCase;
      expect(p.units).toHaveLength(c.run.summary.units.total);
      const reasons: Record<string, number> = {};
      for (const u of p.units)
        if (u.status !== "succeeded") {
          const r = reasonClass(u.status, u.status === "failed" ? u.error : null);
          reasons[r] = (reasons[r] ?? 0) + 1;
        }
      expect(reasons).toEqual(c.expect.reasons);
      expect(Object.values(reasons).reduce((a, b) => a + b, 0)).toBe(c.expect.failed);
      const breaches: Record<string, number> = {};
      for (const u of p.units) {
        if (u.status !== "succeeded") continue;
        for (const check of p.checks) {
          const metric = check.split(" ")[0];
          if (!holds(check, u.metrics[metric])) breaches[check] = (breaches[check] ?? 0) + 1;
        }
      }
      expect(breaches).toEqual(c.expect.breaches);
      expect(Object.keys(breaches).length > 0).toBe(c.expect.campaign);
    });
  }
  it("each descriptor names its pipeline, declares its checks and pins a placeholder image", () => {
    for (const p of PLANTED) {
      const d = parse(descriptor(p)) as {
        name: string;
        "container-image": { image: string };
        "x-nils": { qc: string[]; input: { layout: string } };
      };
      expect(d.name).toBe(p.pipeline);
      expect(d["x-nils"].qc).toEqual(p.checks);
      expect(d["x-nils"].input.layout).toBe("stacks");
      expect(d["container-image"].image).toMatch(/@sha256:0{64}$/u);
    }
  });
  it("writes DICOM Part 10: the preamble, the magic, the meta group's length, then the dataset", () => {
    const f = part10("1.2.3", [[0x0008, 0x0060, "CS", Buffer.from("MR")]]);
    expect(f.subarray(128, 132).toString("latin1")).toBe("DICM");
    expect(f.readUInt16LE(132)).toBe(0x0002);
    expect(f.readUInt16LE(134)).toBe(0x0000);
    const metaLength = f.readUInt32LE(140);
    const after = 144 + metaLength;
    expect(f.readUInt16LE(after)).toBe(0x0008);
    expect(f.readUInt16LE(after + 2)).toBe(0x0060);
    expect(f.length % 2).toBe(0);
  });
});

describe("the seed of analysis-plan", () => {
  const cases = parse(readFileSync("stations/analysis-plan/evals/cases.yml", "utf8")) as {
    cohorts: { name: string }[];
    selections: string[];
    cases: { expect: { cohorts?: string[]; selection?: string } }[];
  };
  it("makes every selection the cases name, at the version they name", () => {
    const made = new Map<string, number>();
    for (const s of SELECTIONS) made.set(s.name, (made.get(s.name) ?? 0) + 1);
    for (const s of cases.selections) {
      const [name, v] = s.split("@");
      expect(made.get(name), s).toBe(Number(v));
    }
    for (const c of cases.cases)
      if (c.expect.selection)
        expect(cases.selections).toContain(c.expect.selection.replace(/^selection:/u, ""));
  });
  it("makes the one cohort synth does not, of synthetic subjects", () => {
    const named = new Set(cases.cases.flatMap((c) => c.expect.cohorts ?? []));
    expect([...named].sort()).toEqual(["ms-cohort-a", "ms-cohort-b", "nmosd"]);
    expect(cases.cohorts.map((c) => c.name).sort()).toEqual(["ms-cohort-a", "ms-cohort-b", "nmosd"]);
    expect(NMOSD).toHaveLength(9);
    for (const code of NMOSD) expect(code).toMatch(/^SYN\d{4}$/u);
  });
});
