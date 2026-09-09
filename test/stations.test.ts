// SPDX-License-Identifier: AGPL-3.0-only
// The station framework (Wave 4c D3): the manifest loader, the phase
// machine, the budget and its terminal reasons, loop detection, the settle
// checks, the completeness field. A tool stubbed to fail forever terminates
// within the budget with the named reason; a truncated argument stream is
// refused; the grant grep passes.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { callHash, initialState, LOOP_STOP, LOOP_WARN, Machine } from "../src/stations/machine.ts";
import { briefHash, loadManifests, type Manifest, phasesOf, validate } from "../src/stations/manifest.ts";
import { complete, evidenceOnly, runChecks, type Verdict } from "../src/stations/verdict.ts";

function manifestDir(over: Record<string, unknown> = {}): { dir: string; raw: Record<string, unknown> } {
  const dir = mkdtempSync(join(tmpdir(), "station-"));
  mkdirSync(join(dir, "evals"));
  const brief = "---\nname: ask-help\ndescription: Words to a document.\n---\nThe decision point.\n";
  writeFileSync(join(dir, "SKILL.md"), brief);
  const raw = {
    id: "ask-help",
    app: "nils-assistant",
    purpose: "assistant.ask-help",
    content: "rows",
    ceiling: "reviewer",
    grant: {
      catalog: {},
      "catalog/{level}": {},
      validate: {},
      describe: {},
      options: {},
      apply: { calls: 20 },
      diagnose: {},
      preview: { rows: 10 },
      draft: {},
      diff: {},
      "handles/{id}": {},
      "handles/{id}/rows": { rows: 200 },
      guide: {},
    },
    brief: { path: "SKILL.md", hash: briefHash(brief) },
    result: { type: "object", required: ["document"], properties: { document: { type: "integer" } } },
    checks: ["validate_clean", "declaration_full"],
    budget: { turns: 12, tool_calls: 40, wall_clock_seconds: 180, input_tokens: 250000 },
    writes: ["document_version"],
    phases: {
      initial: "resolve",
      transitions: [
        { from: "resolve", to: "shape" },
        { from: "shape", to: "refine" },
        { from: "refine", to: "check" },
        { from: "check", to: "refine" },
        { from: "check", to: "finish" },
      ],
    },
    evals: "evals",
    ...over,
  };
  writeFileSync(join(dir, "station.yml"), JSON.stringify(raw));
  return { dir, raw };
}

describe("the manifest", () => {
  it("loads from a directory, checks the brief's hash, and refuses a decision apply in the grant", () => {
    const { dir, raw } = manifestDir();
    const m = validate(raw, dir);
    expect(m.id).toBe("ask-help");
    expect(phasesOf(m)).toEqual(["resolve", "shape", "refine", "check", "finish"]);
    expect(() =>
      validate({ ...raw, grant: { ...(raw.grant as object), "review/{id}/apply": {} } }, dir),
    ).toThrow(/decision apply/u);
    expect(() => validate({ ...raw, brief: { path: "SKILL.md", hash: "0".repeat(64) } }, dir)).toThrow(
      /brief's hash/u,
    );
    expect(() => validate({ ...raw, writes: ["release"] }, dir)).toThrow(/writes is a subset/u);
    expect(() =>
      validate({ ...raw, phases: { initial: "a", transitions: [{ from: "a", to: "b" }] } }, dir),
    ).toThrow(/end in finish/u);
    expect(() =>
      validate({ ...raw, budget: { turns: 0, tool_calls: 1, wall_clock_seconds: 1, input_tokens: 1 } }, dir),
    ).toThrow(/budget.turns/u);
    const parent = mkdtempSync(join(tmpdir(), "stations-"));
    mkdirSync(join(parent, "ask-help"));
    writeFileSync(join(parent, "ask-help", "station.yml"), JSON.stringify(raw));
    writeFileSync(
      join(parent, "ask-help", "SKILL.md"),
      "---\nname: ask-help\ndescription: Words to a document.\n---\nThe decision point.\n",
    );
    mkdirSync(join(parent, "ask-help", "evals"));
    const all = loadManifests([parent, "/nonexistent"]);
    expect([...all.keys()]).toEqual(["ask-help"]);
  });
});

function machine(): { m: Machine; manifest: Manifest; clock: { now: number } } {
  const { dir, raw } = manifestDir();
  const manifest = validate(raw, dir);
  const clock = { now: 1_000_000 };
  const m = new Machine(manifest, initialState(manifest, clock.now), () => clock.now);
  return { m, manifest, clock };
}

describe("the phase machine", () => {
  it("mounts tools per phase with refusal text, moves only along the manifest's transitions", () => {
    const { m } = machine();
    const table = { nils_catalog: ["resolve"], nils_options: ["refine"], settle: ["check", "finish"] };
    expect(m.allowed("nils_catalog", table)).toEqual({ ok: true });
    expect(m.allowed("nils_options", table)).toMatchObject({
      ok: false,
      why: expect.stringMatching(/not open in the resolve phase; it opens in refine/u),
    });
    expect(m.allowed("nils_run", table)).toMatchObject({
      ok: false,
      why: expect.stringMatching(/not a tool of ask-help/u),
    });
    expect(m.advance("refine")).toMatchObject({
      ok: false,
      why: expect.stringMatching(/no transition from resolve to refine/u),
    });
    expect(m.advance("shape")).toEqual({ ok: true });
    expect(m.state.phase).toBe("shape");
    expect(m.state.events).toEqual([{ kind: "phase", from: "resolve", to: "shape", at: 1_000_000 }]);
  });

  it("a tool stubbed to fail forever terminates within the budget with the named reason", () => {
    const { m, manifest } = machine();
    let reason: string | null = null;
    // the model keeps calling the same failing tool with different arguments; the tool budget names the end
    for (let i = 0; i < 100; i++) {
      const r = m.call("nils_validate", { document_id: i });
      if (!r.ok) {
        reason = r.terminal;
        break;
      }
    }
    expect(reason).toBe("budget_tools");
    expect(m.state.tool_calls).toBe(manifest.budget.tool_calls + 1);
    expect(m.state.terminal).toBe("budget_tools");
    expect(m.call("anything", {})).toMatchObject({ ok: false, terminal: "budget_tools" });
  });

  it("the wall clock and the turns end a run by name", () => {
    const { m, clock } = machine();
    for (let i = 0; i < 12; i++) expect(m.turn(1000)).toBeNull();
    expect(m.turn(1000)).toBe("budget_turns");
    const other = machine();
    other.clock.now += 181_000;
    expect(other.m.turn(1)).toBe("budget_wall_clock");
    expect(clock.now).toBe(1_000_000);
  });

  it("detects a loop by an order-independent hash of the salient keys: warn at three, stop at five", () => {
    const { m } = machine();
    expect(callHash("t", { a: 1, b: 2 })).toBe(callHash("t", { b: 2, a: 1 }));
    expect(callHash("t", { a: 1, b: 2, noise: 9 }, ["a", "b"])).toBe(
      callHash("t", { a: 1, b: 2, noise: 10 }, ["a", "b"]),
    );
    const results = [];
    for (let i = 0; i < LOOP_STOP; i++)
      results.push(
        m.call("nils_options", { document_id: 7, set: "scope", noise: i }, ["document_id", "set"]),
      );
    expect(results.slice(0, LOOP_WARN - 1).every((r) => r.ok && r.warning === null)).toBe(true);
    expect(results[LOOP_WARN - 1]).toMatchObject({
      ok: true,
      warning: expect.stringMatching(/called 3 times/u),
    });
    expect(results[LOOP_STOP - 1]).toMatchObject({ ok: false, terminal: "loop_stopped" });
    expect(m.state.events.map((e) => e.kind)).toEqual(["loop_warning", "loop_warning", "loop_stopped"]);
  });
});

describe("the verdict", () => {
  it("settles only when the named checks pass, with a specific complaint otherwise", async () => {
    const v: Verdict = {
      station: "ask-help",
      terminal: "settled",
      brief_hash: "h",
      model: "m",
      budget_consumed: { turns: 1, tool_calls: 2, wall_clock_seconds: 3, input_tokens: 4 },
      evidence: { handles: [7], documents: [2] },
      proposals: [],
      result: { document: 2 },
      checks: [],
    };
    const checks = {
      validate_clean: () => null,
      declaration_full: (x: Verdict) => (x.result.document ? null : "the declaration block is empty"),
    };
    expect(await runChecks(v, checks, ["validate_clean", "declaration_full"], {})).toMatchObject({
      passed: true,
      complaints: [],
    });
    const r = await runChecks(
      { ...v, result: {} },
      checks,
      ["validate_clean", "declaration_full", "no_such"],
      {},
    );
    expect(r.passed).toBe(false);
    expect(r.complaints).toEqual([
      "declaration_full: the declaration block is empty",
      "no_such: no check named no_such is defined for this station",
    ]);
    expect(evidenceOnly({ ...v, result: { rows: [[1, 2]] } })).toMatch(/pastes rows/u);
  });
  it("refuses a truncated argument stream by the completeness field", () => {
    expect(complete({ moves: [{ move_id: 1 }, { move_id: 2 }], items: 2 }, "moves")).toEqual({ ok: true });
    expect(complete({ moves: [{ move_id: 1 }], items: 2 }, "moves")).toMatchObject({
      ok: false,
      why: expect.stringMatching(/cut short/u),
    });
    expect(complete({ moves: [{ move_id: 1 }] }, "moves")).toMatchObject({
      ok: false,
      why: expect.stringMatching(/items/u),
    });
  });
});

describe("a follow-up turn (section 7.7)", async () => {
  const { Machine, initialState } = await import("../src/stations/machine.ts");
  const { loadManifests } = await import("../src/stations/manifest.ts");
  it("starts the budget over, forgets the loop detector, re-enters the named phase and keeps the evidence", () => {
    const m = loadManifests(["./stations"]).get("ask-help");
    if (!m) throw new Error("no ask-help manifest");
    expect(m.phases.follow_up).toBe("shape");
    const mach = new Machine(m, initialState(m, 1000), () => 5000);
    mach.advance("shape");
    mach.call("nils_store", { document: 1 }, ["document"]);
    mach.state.evidence.documents.push(4);
    mach.end("budget_wall_clock");
    mach.followUp(m.phases.follow_up ?? m.phases.initial);
    expect(mach.state.phase).toBe("shape");
    expect(mach.state.terminal).toBeNull();
    expect(mach.state.tool_calls).toBe(0);
    expect(mach.state.repeats).toEqual({});
    expect(mach.state.started_at).toBe(5000);
    expect(mach.state.evidence.documents).toEqual([4]);
    expect(mach.state.events.at(-1)).toMatchObject({ kind: "follow_up", from: "shape", to: "shape" });
  });
});

describe("the result schema (section 9.5)", async () => {
  const { toValibot } = await import("../src/stations/schema.ts");
  const v = await import("valibot");
  it("keeps an object with named properties strict and an object without any open", () => {
    const strict = toValibot({
      type: "object",
      required: ["document"],
      properties: { document: { type: "integer" } },
    } as never);
    expect(v.safeParse(strict, { document: 1, extra: true }).success).toBe(false);
    const open = toValibot({ type: "object", description: "the declaration block" } as never);
    expect(v.safeParse(open, { grain: "subject", session_scheme: { name: "x" } }).success).toBe(true);
    const closed = toValibot({ type: "object", additionalProperties: false } as never);
    expect(v.safeParse(closed, { grain: "subject" }).success).toBe(false);
  });
});
