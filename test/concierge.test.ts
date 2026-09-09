// SPDX-License-Identifier: AGPL-3.0-only
// The concierge (Wave 4c D5): a weak grant, a delegation that names a
// loaded station or is refused, a verdict rendered from the store, and a
// document it settles with that a delegate found.

import { describe, expect, it } from "vitest";
import { agentIds, delegate, delegationsOf, delegationView, registerAgent } from "../src/seam/delegations.ts";
import { conciergeChecks } from "../src/stations/concierge.ts";
import { loadManifests } from "../src/stations/manifest.ts";
import type { Verdict } from "../src/stations/verdict.ts";

const verdict = (result: Record<string, unknown>): Verdict =>
  ({
    station: "concierge",
    terminal: "settled",
    brief_hash: "",
    model: "m",
    budget_consumed: { turns: 1, tool_calls: 1, wall_clock_seconds: 1, input_tokens: 1 },
    evidence: { handles: [], documents: [] },
    proposals: [],
    result,
    checks: [],
  }) as unknown as Verdict;

describe("the concierge", () => {
  it("has the weak grant of section 9.12 and writes nothing", () => {
    const m = loadManifests(["./stations"]).get("concierge");
    if (!m) throw new Error("no concierge manifest");
    expect(Object.keys(m.grant).sort()).toEqual([
      "capabilities",
      "describe",
      "handles/{id}",
      "handles/{id}/rows",
      "jobs",
    ]);
    expect(m.writes).toEqual([]);
    expect(m.ceiling).toBe("reader");
    expect(m.phases.follow_up).toBe("hold");
    expect(m.checks).toContain("from_a_delegate");
  });

  it("refuses a delegation to a station that is not loaded", () => {
    expect(() =>
      delegate({ parent: "c1", parentStation: "concierge", station: "keyword-tune", brief: "x" }),
    ).toThrow(/no station named keyword-tune/u);
    registerAgent(
      "echo",
      Object.assign(() => "", { agentName: "echo" }),
    );
    expect(agentIds()).toContain("echo");
    expect(delegationsOf("c1")).toEqual([]);
  });

  it("settles only with a document a settled delegate found", () => {
    const checks = conciergeChecks();
    expect(checks.from_a_delegate(verdict({ sentence: "working" }), { conversation: "c2" })).toBeNull();
    expect(
      checks.from_a_delegate(verdict({ sentence: "done", document: 9 }), { conversation: "c2" }),
    ).toMatch(/document 9 is not what any settled delegate found/u);
    expect(
      checks.clarification_axis(
        verdict({ sentence: "which", choices: [{ question: "which cohort", axis: "scope", options: [] }] }),
        {},
      ),
    ).toBeNull();
    expect(
      checks.clarification_axis(
        verdict({ sentence: "which", choices: [{ question: "what colour", axis: "style", options: [] }] }),
        {},
      ),
    ).toMatch(/pick, a scope or a grain/u);
    expect(checks.no_sql(verdict({ sentence: "select * from subjects" }), {})).toMatch(/SQL/u);
    expect(checks.no_identifier_value(verdict({ sentence: "19800101-1234" }), {})).toMatch(/identifier/u);
  });

  it("shows a model a task's state and its verdict's result, never a row", () => {
    const d = {
      task: "task-1",
      parent: "c3",
      station: "ask-help",
      child: "c3-ask-help-1",
      brief: "count them",
      state: "settled" as const,
      started_at: "t0",
      settled_at: "t1",
      verdict: verdict({ document: 4, hash: "h", sentence: "the count", rows: [[1, 2]] }),
      error: null,
    };
    const view = delegationView(d);
    expect(view.result).toEqual({
      document: 4,
      hash: "h",
      sentence: "the count",
      choices: [],
      declaration: null,
    });
    expect(JSON.stringify(view)).not.toContain("rows");
    expect(view.state).toBe("settled");
  });
});
