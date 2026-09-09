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

describe("the cookbook and the implicit phase moves (the rework for the local model)", async () => {
  const { createHash } = await import("node:crypto");
  const { readFileSync, readdirSync } = await import("node:fs");
  const { cookbook, renderCookbook } = await import("../src/stations/ask-help.ts");
  const { split } = await import("../bench/manifest/split.ts");
  const { parse } = await import("yaml");
  const { Machine, initialState } = await import("../src/stations/machine.ts");
  const { loadManifests } = await import("../src/stations/manifest.ts");

  it("holds only golds of the loop split, never one of the held-out split", () => {
    const shapes = (
      parse(readFileSync("bench/corpus/shapes.yml", "utf8")) as {
        shapes: { id: string; rebased: { gold?: string } }[];
      }
    ).shapes;
    const { loop, held_out } = split(shapes);
    const body = (text: string) =>
      createHash("sha256")
        .update(
          text
            .split("\n")
            .filter((l) => !l.startsWith("#"))
            .join("\n")
            .trim(),
        )
        .digest("hex");
    const goldOf = (id: string) => shapes.find((s) => s.id === id)?.rebased.gold;
    const loopHashes = new Set(
      loop.flatMap((s) => (goldOf(s.id) ? [body(readFileSync(`bench/gold/${goldOf(s.id)}`, "utf8"))] : [])),
    );
    const heldHashes = new Set(
      held_out.flatMap((s) =>
        goldOf(s.id) ? [body(readFileSync(`bench/gold/${goldOf(s.id)}`, "utf8"))] : [],
      ),
    );
    const files = readdirSync("stations/ask-help/cookbook").filter((f) => f.endsWith(".ask.yml"));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const h = body(readFileSync(`stations/ask-help/cookbook/${f}`, "utf8"));
      expect(heldHashes.has(h), `${f} is a held-out gold`).toBe(false);
      expect(loopHashes.has(h), `${f} is not a loop gold`).toBe(true);
    }
    const items = cookbook("stations/ask-help/cookbook");
    expect(items.every((c) => c.question.length > 10 && c.text.includes("ast_version"))).toBe(true);
    expect(renderCookbook(items)).toContain("### Example 1:");
  });

  it("moves the run to a tool's phase by one transition, and refuses a tool two phases away", () => {
    const m = loadManifests(["./stations"]).get("ask-help");
    if (!m) throw new Error("no ask-help manifest");
    const table: Record<string, string[]> = {
      nils_draft: ["shape", "refine"],
      nils_diagnose: ["check"],
      settle: ["check", "finish"],
    };
    const mach = new Machine(m, initialState(m, 0), () => 1000);
    expect(mach.state.phase).toBe("resolve");
    expect(mach.reach("nils_draft", table)).toEqual({ ok: true, moved: "shape" });
    expect(mach.state.phase).toBe("shape");
    expect(mach.reach("nils_draft", table)).toEqual({ ok: true, moved: null });
    expect(mach.reach("nils_diagnose", table)).toEqual({ ok: true, moved: "check" });
    expect(mach.reach("settle", table)).toEqual({ ok: true, moved: null });
    const fresh = new Machine(m, initialState(m, 0), () => 1000);
    const r = fresh.reach("nils_diagnose", table);
    expect(r.ok).toBe(false);
    expect(fresh.state.phase).toBe("resolve");
  });
});
