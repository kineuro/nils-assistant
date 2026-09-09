// SPDX-License-Identifier: AGPL-3.0-only
// ask-help (Wave 4c §9.11): its manifest holds, its tools open by phase as
// the brief says, its grant contains no decision apply, and its checks
// refuse what the spec names: SQL, an identifier value, a missing
// declaration, a truncated handle, a hash that is not the document's.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { Seam } from "../src/seam/client.ts";
import { askHelpChecks, askHelpTools } from "../src/stations/ask-help.ts";
import { validate } from "../src/stations/manifest.ts";
import type { Verdict } from "../src/stations/verdict.ts";

const dir = join(import.meta.dirname, "..", "stations", "ask-help");
const manifest = validate(parse(readFileSync(join(dir, "station.yml"), "utf8")), dir);

function verdict(over: Partial<Verdict["result"]> = {}): Verdict {
  return {
    station: "ask-help",
    terminal: "settled",
    brief_hash: manifest.brief.hash,
    model: "m",
    budget_consumed: { turns: 1, tool_calls: 1, wall_clock_seconds: 1, input_tokens: 1 },
    evidence: { handles: [], documents: [2] },
    proposals: [],
    result: {
      document: 2,
      hash: "abc",
      sentence: "s",
      declaration: {
        grain: "session",
        session_scheme: { name: "default" },
        membership: "m",
        key_namespace: "k",
        pick_rule: "p",
        denominator: "d",
        disclosure: "local",
      },
      ...over,
    },
    checks: [],
  };
}

function fakeSeam(answers: Record<string, unknown>): Seam {
  return {
    call: async ({ path }: { path: string }) => ({
      kind: "ok",
      status: 200,
      body: answers[path.replace(/\?.*$/u, "")] ?? {},
    }),
  } as unknown as Seam;
}

describe("ask-help", () => {
  it("has the manifest of section 9.11: the grant, the budget, the phases, the only write", () => {
    expect(manifest.ceiling).toBe("reviewer");
    expect(manifest.content).toBe("rows");
    expect(manifest.budget).toEqual({
      turns: 12,
      tool_calls: 40,
      wall_clock_seconds: 180,
      input_tokens: 250000,
    });
    expect(manifest.writes).toEqual(["document_version"]);
    expect(Object.keys(manifest.grant)).toEqual(
      expect.arrayContaining([
        "catalog",
        "catalog/{level}",
        "validate",
        "describe",
        "options",
        "apply",
        "diagnose",
        "preview",
        "draft",
        "diff",
        "handles/{id}",
        "handles/{id}/rows",
        "guide",
      ]),
    );
    expect(manifest.phases.initial).toBe("resolve");
    const brief = readFileSync(join(dir, "SKILL.md"), "utf8");
    // a brief may not contain an exception clause naming another station (section 9.5)
    expect(brief).not.toMatch(/keyword-tune|identity-check|concierge/u);
  });
  it("opens its tools by phase as the brief says, with the completeness field on apply", () => {
    const tools = askHelpTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(by.nils_options.phases).toEqual(["refine"]);
    expect(by.nils_apply.completes).toBe("moves");
    expect(by.nils_preview.phases).toEqual(["check"]);
    expect(by.nils_catalog.phases).toContain("resolve");
    expect(tools.every((t) => t.name.startsWith("nils_"))).toBe(true);
  });
  it("its checks refuse SQL, an identifier value, a thin declaration, a truncated handle and a foreign hash", async () => {
    const checks = askHelpChecks();
    expect(checks.no_sql(verdict({ sentence: "select x from y where z" }), {})).toMatch(/SQL/u);
    expect(checks.no_sql(verdict(), {})).toBeNull();
    expect(checks.no_identifier_value(verdict({ sentence: "born 19850101-1234" }), {})).toMatch(
      /identifier/u,
    );
    expect(checks.declaration_full(verdict({ declaration: { grain: "session" } }), {})).toMatch(/lacks/u);
    expect(checks.declaration_full(verdict(), {})).toBeNull();
    const seam = fakeSeam({
      "/api/ask/validate": { valid: true, hash: "abc", issues: [] },
      "/api/ask/handles/9": { id: 9, truncated: true },
    });
    expect(await checks.validate_clean(verdict(), { seam })).toBeNull();
    expect(await checks.validate_clean(verdict({ hash: "zzz" }), { seam })).toMatch(/not the document's/u);
    const v9 = verdict();
    v9.evidence.handles = [9];
    expect(await checks.no_truncated_handle(v9, { seam })).toMatch(/truncated/u);
  });
});
