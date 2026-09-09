// SPDX-License-Identifier: AGPL-3.0-only
// identity-check (Wave 4c D7): the manifest, the path question, and that a value never passes as a shape.

import { describe, expect, it } from "vitest";
import { carriesValue, identityCheckChecks, usesPath } from "../src/stations/identity-check.ts";
import { loadManifests } from "../src/stations/manifest.ts";
import type { Verdict } from "../src/stations/verdict.ts";

const verdict = (result: Record<string, unknown>): Verdict => ({ result }) as unknown as Verdict;

describe("identity-check", () => {
  it("holds the probe at the operator ceiling and writes a rule and a review decision", () => {
    const m = loadManifests(["./stations"]).get("identity-check");
    if (!m) throw new Error("no identity-check manifest");
    expect(m.ceiling).toBe("operator");
    expect(Object.keys(m.grant).sort()).toEqual(["capabilities", "ingest/probe", "jobs/{id}"]);
    expect(m.writes).toEqual(["identity_rule", "review_decision"]);
    expect(m.checks).toEqual([
      "rule_validated",
      "names_rule_and_saw",
      "no_identifier_value",
      "path_answered",
    ]);
  });

  it("tells a shape from a value", () => {
    expect(carriesValue("PatientID answered AAAA on 100 files; path segment 1 answered AAA999")).toBeNull();
    expect(carriesValue("the folder AAA111 held the code")).toBe("AAA111");
    expect(carriesValue("born 19840110-1234")).toBe("19840110-1234");
    expect(usesPath({ id_type: "subject-code", from: [{ path: { segment: 1 } }] })).toBe(true);
    expect(usesPath({ id_type: "patient-id", from: [{ field: "PatientID" }] })).toBe(false);
  });

  it("refuses a verdict that names no source, no shapes, or a value", () => {
    const checks = identityCheckChecks();
    expect(checks.names_rule_and_saw(verdict({ sentence: "use the folder", saw: [] }), {})).toMatch(
      /names no source|saw is the list/u,
    );
    expect(
      checks.names_rule_and_saw(
        verdict({
          sentence: "path segment 1 answered AAA999 on every file",
          saw: [{ rule: "rule 2", source: "path segment 1", shape: "AAA999", answered: 100 }],
        }),
        {},
      ),
    ).toBeNull();
    expect(checks.no_identifier_value(verdict({ sentence: "the folder was AAA111" }), {})).toMatch(
      /value, not a shape: AAA999/u,
    );
    expect(checks.rule_validated(verdict({ proposed: {} }), { conversation: "none" })).toMatch(
      /no rule was proposed/u,
    );
  });
});
