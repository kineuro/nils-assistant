// SPDX-License-Identifier: AGPL-3.0-only
// The bench's own tests, with no network: the taxonomy is closed, the
// attribution table generates both artefacts, the corpus is well formed and
// every rebased shape has a recorded gold answer, the recorded provider
// replays and a recovery path is asserted from the transition, the matrix
// and the split.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ORDER, path, prompt } from "../bench/attribution.ts";
import { type Fixture, recorded, textOf, withRecovery } from "../bench/gate/replay.ts";
import { cell, direction, judge } from "../bench/manifest/matrix.ts";
import { heldOut, report, split } from "../bench/manifest/split.ts";
import {
  FAILURES,
  isFailure,
  isSilentDecision,
  PROTOTYPE_FAILURES,
  SILENT_DECISIONS,
  tally,
} from "../bench/taxonomy.ts";

const root = join(import.meta.dirname, "..");
const shapes = (
  parse(readFileSync(join(root, "bench/corpus/shapes.yml"), "utf8")) as { shapes: Record<string, unknown>[] }
).shapes;
const chains = (
  parse(readFileSync(join(root, "bench/corpus/chains.yml"), "utf8")) as { chains: Record<string, unknown>[] }
).chains;
const expected = JSON.parse(readFileSync(join(root, "bench/gold/expect.json"), "utf8")) as Record<
  string,
  { content_hash: string | null; epoch: number; pack: string }
>;

describe("the taxonomy is closed", () => {
  it("holds the ten prototype words, the four added ones and a counted other", () => {
    expect(PROTOTYPE_FAILURES).toHaveLength(10);
    expect(FAILURES).toHaveLength(15);
    expect(SILENT_DECISIONS).toEqual(["grain", "scope", "membership", "key", "pick", "denominator"]);
    const t = tally(["wrong_column", "wrong_column", "a new word"]);
    expect(t.counts.wrong_column).toBe(2);
    expect(t.counts.other).toBe(1);
    expect(t.other).toEqual(["a new word"]);
  });
});

describe("the attribution order is one table", () => {
  it("generates the code path and the prompt from the same seven components, in order", () => {
    expect(path()).toEqual([
      "domain_knowledge",
      "tool_description",
      "prompt",
      "control_flow",
      "tool_behaviour",
      "configuration",
      "delegation",
    ]);
    const text = prompt();
    for (const [i, c] of ORDER.entries()) expect(text).toContain(`${i + 1}. ${c.id.replace("_", " ")}`);
    expect(text).toContain("Do not skip ahead");
  });
});

describe("the corpus", () => {
  it("has twenty-five shapes with closed words, and every rebased shape has a recorded gold answer", () => {
    expect(shapes).toHaveLength(25);
    for (const s of shapes) {
      for (const w of s.earned as string[]) expect(isFailure(w), `${s.id} earned ${w}`).toBe(true);
      for (const d of s.silent as string[]) expect(isSilentDecision(d), `${s.id} silent ${d}`).toBe(true);
      const r = s.rebased as { status: string; gold?: string; note?: string };
      expect(["rebased", "partial", "not_rebased"]).toContain(r.status);
      if (r.status === "not_rebased") {
        expect(r.gold).toBeUndefined();
        expect(r.note, `${s.id} needs a reason`).toBeTruthy();
      } else {
        expect(r.gold, `${s.id} names its gold document`).toBeTruthy();
        expect(existsSync(join(root, "bench/gold", r.gold as string)), `${r.gold} exists`).toBe(true);
        const e = expected[r.gold as string];
        expect(e, `${r.gold} is recorded`).toBeTruthy();
        expect(e.epoch).toBeGreaterThan(0);
        expect(e.pack).toMatch(/^mri \d/);
      }
    }
  });
  it("carries three chains whose correction counts match their turns", () => {
    expect(chains).toHaveLength(3);
    for (const c of chains) {
      const turns = c.turns as { kind: string; text: string }[];
      expect(turns[0].kind).toBe("opening");
      expect(turns.filter((t) => t.kind === "correction")).toHaveLength(c.corrections as number);
      expect(shapes.some((s) => s.id === c.shape)).toBe(true);
    }
  });
  it("holds no term from the source: no subject code, no identifier, no UID, no path", () => {
    const text =
      readFileSync(join(root, "bench/corpus/shapes.yml"), "utf8") +
      readFileSync(join(root, "bench/corpus/chains.yml"), "utf8");
    expect(text).not.toMatch(/\b[0-9a-f]{16}\b/u);
    expect(text).not.toMatch(/\b\d+(?:\.\d+){5,}\b/u);
    expect(text).not.toMatch(/\/(?:mnt|fast|srv|home)\//u);
    expect(text).not.toMatch(/\b(?:kipro|broms|stopms|iaid|nmosd|als)\b/iu);
  });
});

describe("the gate is deterministic", () => {
  it("replays a recorded provider and asserts a recovery path from the transition, never the text", async () => {
    const fixture = JSON.parse(
      readFileSync(join(root, "bench/gate/fixtures/recovery-provider-error.json"), "utf8"),
    ) as Fixture;
    const r = recorded(fixture);
    const out = await withRecovery(r.stream, 3);
    expect(out.attempts).toBe(2);
    expect(r.transitions).toEqual([
      { attempt: 1, reason: "error", terminal: "error" },
      { attempt: 2, reason: "stop", terminal: "done" },
    ]);
    expect(r.remaining()).toBe(0);
    expect(textOf(out.message)).toContain("ast_version");
    expect(() => r.stream()).toThrow(/no attempt 3/u);
  });
});

describe("the discipline", () => {
  it("judges by the nine-state matrix, the held-out split ruling", () => {
    expect(cell("improve", "improve")).toBe("keep");
    expect(cell("improve", "same")).toBe("partial");
    expect(cell("improve", "regress")).toBe("revert");
    expect(cell("same", "improve")).toBe("keep");
    expect(cell("same", "same")).toBe("keep");
    expect(cell("same", "regress")).toBe("revert");
    expect(cell("regress", "improve")).toBe("inconclusive");
    const m = {
      id: "m-0001",
      component: "prompt",
      predicted_flips: ["shape-03"],
      predicted: { loop: "improve" as const, held_out: "same" as const },
      change: "name the six decisions",
    };
    expect(
      judge(m, { loop: "improve", held_out: "same", flipped_up: ["shape-03", "shape-05"], flipped_down: [] }),
    ).toEqual({ verdict: "keep", loop: "keep", held_out: "keep", unpredicted: ["shape-05"] });
    expect(judge(m, { loop: "same", held_out: "same", flipped_up: [], flipped_down: [] }).verdict).toBe(
      "partial",
    );
    expect(
      judge(m, { loop: "improve", held_out: "same", flipped_up: ["shape-03"], flipped_down: ["shape-10"] })
        .verdict,
    ).toBe("revert");
    expect(direction(0.5, 0.5, 18)).toBe("same");
    expect(direction(0.5, 0.6, 18)).toBe("improve");
  });
  it("holds out a fixed third of the shapes by the hash of their ids, and reports both numbers", () => {
    const ids = shapes.map((s) => ({ id: s.id as string }));
    const s = split(ids);
    expect(s.loop.length + s.held_out.length).toBe(25);
    expect(s.held_out.length).toBeGreaterThan(3);
    expect(s.held_out.length).toBeLessThan(15);
    expect(heldOut("shape-01")).toBe(heldOut("shape-01"));
    const r = report((id) => id === "shape-01", ids);
    expect(r.loop.of + r.held_out.of).toBe(25);
    expect(r.loop.passed + r.held_out.passed).toBe(1);
  });
});
