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
import { askHelpChecks, askHelpTools, compactPreview, completeResult } from "../src/stations/ask-help.ts";
import { validate } from "../src/stations/manifest.ts";
import { closest, idiomsOfQuestion } from "../src/stations/select.ts";
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
      turns: 16,
      tool_calls: 40,
      wall_clock_seconds: 300,
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
  it("has five tools, opened by phase as the brief says: the draft that also previews, the sampler, the document, and the two doors a follow-up may want", () => {
    const tools = askHelpTools();
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(tools.map((t) => t.name)).toEqual([
      "nils_draft",
      "nils_values",
      "nils_document",
      "nils_diagnose",
      "nils_preview",
    ]);
    expect(by.nils_draft.phases).toEqual(["shape", "refine"]);
    expect(by.nils_preview.phases).toEqual(["check"]);
    expect(by.nils_values.phases).toContain("resolve");
    expect(tools.every((t) => t.name.startsWith("nils_"))).toBe(true);
  });
  it("the draft answers the handle, the diagnosis and a compact preview in one call, and a refused draft alone", async () => {
    const tools = askHelpTools();
    const draft = tools.find((t) => t.name === "nils_draft");
    if (!draft) throw new Error("no draft tool");
    const calls: string[] = [];
    const seam = {
      door: async (path: string, _m: string, body: Record<string, unknown>) => {
        calls.push(path);
        if (path === "/api/ask/draft")
          return typeof body.text === "string" && body.text.includes("refuse me")
            ? {
                kind: "ok",
                status: 200,
                body: { document: null, diagnosis: { valid: false, issues: [{ code: "unknown_set" }] } },
              }
            : {
                kind: "ok",
                status: 200,
                body: { document: 7, hash: "h", diagnosis: { valid: true, issues: [] } },
              };
        return {
          kind: "ok",
          status: 200,
          body: {
            level: "record",
            columns: ["_key", "_subject", { name: "code" }, "first"],
            rows: [[1, 1, "SYN0001", "2002-02-11"]],
            truncated: false,
            declaration: { grain: "session" },
          },
        };
      },
    } as unknown as Seam;
    const ctx = { seam, conversation: "c", toolCallId: "t1", state: { phase: "shape" } } as never;
    const ok = await draft.run({ text: "ast_version: 1" }, ctx);
    expect(calls).toEqual(["/api/ask/draft", "/api/ask/preview"]);
    expect(ok.evidence?.documents).toEqual([7]);
    expect((ok.output as { preview: { columns: string[]; rows: unknown[][] } }).preview).toEqual({
      level: "record",
      columns: ["code", "first"],
      rows: [["SYN0001", "2002-02-11"]],
      truncated: false,
    });
    expect(JSON.stringify(ok.output)).not.toContain("declaration");
    calls.length = 0;
    const refused = await draft.run({ text: "refuse me" }, ctx);
    expect(calls).toEqual(["/api/ask/draft"]);
    expect(refused.evidence?.documents).toEqual([]);
    expect((refused.output as { preview?: unknown }).preview).toBeUndefined();
    expect(compactPreview({ level: "count", columns: ["rows", "subjects"], rows: [[12, 12]] })).toEqual({
      level: "count",
      columns: ["rows", "subjects"],
      rows: [[12, 12]],
      truncated: false,
    });
  });
  it("completes a refusal without a document only when it names the choices", async () => {
    const seam = fakeSeam({});
    await expect(completeResult({ sentence: "no such name" }, { seam, conversation: "c" })).rejects.toThrow(
      /choices/u,
    );
    const done = await completeResult(
      { sentence: "no such name", choices: [{ question: "which kind?", options: [{ label: "EDSS" }] }] },
      { seam, conversation: "c" },
    );
    expect(done).toMatchObject({ document: null, hash: null, declaration: null });
  });
  it("the selector puts the example of the question's idiom first, and reads nothing but the words", () => {
    const items = [
      {
        file: "count.ask.yml",
        question: "How many subjects are in cohort A?",
        text: "sets:\n  people: {grain: subject}\nout: {set: people, level: count}",
      },
      {
        file: "per.ask.yml",
        question: "For each subject in cohort B, how many sessions do they have?",
        text: "sets:\n  per_subject:\n    grain: group\nout: {level: aggregate}",
      },
      {
        file: "first.ask.yml",
        question: "How old was each subject at their first session?",
        text: 'bind: {nth: ["ordinal", {}], age: ["age_at", {}]}\nout: {level: record}',
      },
      {
        file: "near.ask.yml",
        question: "Which sessions have an EDSS within six months?",
        text: "near: [{as: score, set: edss}]\nout: {level: record}",
      },
    ];
    expect(closest("How many subjects are in cohort B?", items, 2)[0].file).toBe("count.ask.yml");
    expect(closest("Per subject of cohort A, the number of sessions", items, 2)[0].file).toBe("per.ask.yml");
    expect(closest("Which subjects had an SDMT within a year of a session?", items, 2)[0].file).toBe(
      "near.ask.yml",
    );
    expect(closest("How old was each subject of cohort B at their first session?", items, 1)[0].file).toBe(
      "first.ask.yml",
    );
    expect([...idiomsOfQuestion("How many sessions per year, within six months of the first EDSS?")]).toEqual(
      expect.arrayContaining(["count", "group", "ordinal", "near", "clinical", "time"]),
    );
    expect(closest("anything", items, 10)).toHaveLength(4);
    // a rare word shared outweighs common ones: the converters example for a terse converters question, though its idioms differ
    const wide = [
      ...items,
      {
        file: "converters.ask.yml",
        question:
          "Split cohort A into converters and non-converters. A converter has a baseline session with a FLAIR at two millimetres or thinner, a score within a year of it, a course transition four to six years after it, and a relapsing course at baseline.",
        text: 'name: converters and non-converters\nsets:\n  split:\n    grain: group\n    near: [{as: score}]\n    has: [{set: flair}]\n    bind: {n: ["count", {}], transition: ["change", {}]}\nout: {level: aggregate}',
      },
    ];
    expect(
      closest(
        "Split cohort A into converters and non-converters under the baseline and follow-up criteria, as one table.",
        wide,
        1,
      )[0].file,
    ).toBe("converters.ask.yml");
  });
  it("its checks refuse SQL, an identifier value, a thin declaration, a truncated handle and a foreign hash", async () => {
    const checks = askHelpChecks();
    expect(checks.no_sql(verdict({ sentence: "select x from y where z" }), {})).toMatch(/SQL/u);
    expect(checks.no_sql(verdict(), {})).toBeNull();
    // the word "from" in a sentence is not SQL (a settle was refused five times over "converted from RRMS ... from")
    expect(
      checks.no_sql(
        verdict({
          sentence:
            "Eight subjects converted from RRMS to SPMS, listed from the cohort where they are members",
        }),
        {},
      ),
    ).toBeNull();
    // a refusal carries no document: the document checks pass and the sentence checks still apply
    const refusal = verdict({ document: null as never, hash: null as never, declaration: null as never });
    expect(await checks.validate_clean(refusal, { seam: fakeSeam({}) })).toBeNull();
    expect(checks.declaration_full(refusal, {})).toBeNull();
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

  it("holds only golds of the loop split of either corpus, never one of the held-out split", () => {
    const paraphrased = (
      parse(readFileSync("bench/corpus/shapes.yml", "utf8")) as {
        shapes: { id: string; rebased: { gold?: string } }[];
      }
    ).shapes.map((s) => ({ id: s.id, gold: s.rebased.gold }));
    const authored = (
      parse(readFileSync("bench/corpus/authored.yml", "utf8")) as { shapes: { id: string; gold: string }[] }
    ).shapes.map((s) => ({ id: s.id, gold: s.gold }));
    const shapes = [...paraphrased, ...authored];
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
    const goldOf = (id: string) => shapes.find((s) => s.id === id)?.gold;
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
    let golds = 0;
    for (const f of files) {
      const raw = readFileSync(`stations/ask-help/cookbook/${f}`, "utf8");
      const h = body(raw);
      expect(heldHashes.has(h), `${f} is a held-out gold`).toBe(false);
      // an example is a loop gold, or one written for the cookbook and marked so
      if (loopHashes.has(h)) golds++;
      else
        expect(raw.includes("# synthetic:"), `${f} is neither a loop gold nor marked synthetic`).toBe(true);
    }
    expect(golds).toBeGreaterThan(30);
    // every held-out shape of the authored corpus is absent by file name too
    for (const s of held_out) if (s.gold) expect(files).not.toContain(s.gold);
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
