// SPDX-License-Identifier: AGPL-3.0-only
// A station as a Flue agent (Wave 4c D3): a tool stubbed to fail forever
// terminates within the budget with the named reason; a run settles only
// through the settle tool once its checks pass; a proposal outside the
// closed set is refused. One process holds one Flue runtime, so both
// stations start together.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { init } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import * as v from "valibot";
import { afterAll, describe, expect, it } from "vitest";
import { registerStation } from "../src/seam/for.ts";
import { stationAgent } from "../src/stations/agent.ts";
import { briefHash, validate } from "../src/stations/manifest.ts";
import { scriptedProvider } from "./child/loop-provider.ts";

function manifest(
  id: string,
  budget = { turns: 6, tool_calls: 8, wall_clock_seconds: 60, input_tokens: 100000 },
) {
  const dir = mkdtempSync(join(tmpdir(), "station-"));
  mkdirSync(join(dir, "evals"));
  const brief = `---\nname: ${id}\ndescription: A test station.\n---\nDo the thing.\n`;
  writeFileSync(join(dir, "SKILL.md"), brief);
  return validate(
    {
      id,
      app: "nils-assistant",
      purpose: `assistant.${id}`,
      content: "catalog",
      ceiling: "reader",
      grant: { describe: {} },
      brief: { path: "SKILL.md", hash: briefHash(brief) },
      result: { type: "object", required: ["count"], properties: { count: { type: "integer" } } },
      checks: ["positive"],
      budget,
      writes: ["note"],
      phases: { initial: "work", transitions: [{ from: "work", to: "finish" }] },
      evals: "evals",
    },
    dir,
  );
}

const boom = manifest("boom-station");
const settleM = manifest("settle-station");
registerStation({
  id: boom.id,
  version: "1",
  grant: boom.grant,
  ceiling: boom.ceiling,
  content: boom.content,
  model: "m",
});
registerStation({
  id: settleM.id,
  version: "1",
  grant: settleM.grant,
  ceiling: settleM.ceiling,
  content: settleM.content,
  model: "m",
});
let runs = 0;
const Boom = stationAgent({
  manifest: boom,
  brief: "Do the thing.",
  model: "m",
  instructions: "Call boom until it works.",
  tools: [
    {
      name: "boom",
      description: "fails",
      input: v.object({ n: v.number() }),
      phases: ["work"],
      async run({ n }) {
        runs += 1;
        return { output: { failed: true, n } as never };
      },
    },
  ],
  checks: { positive: () => null },
  settle: { phases: ["work", "finish"] },
});
const Settle = stationAgent({
  manifest: settleM,
  brief: "Do the thing.",
  model: "m",
  instructions: "Count, then settle.",
  tools: [
    {
      name: "count",
      description: "counts",
      input: v.object({}),
      phases: ["work"],
      async run() {
        return { output: { count: 3 } as never, evidence: { handles: [7] } };
      },
    },
  ],
  checks: { positive: (verdict) => (Number(verdict.result.count) > 0 ? null : "the count is not positive") },
  settle: { phases: ["work", "finish"] },
});
const script: ({ tool: string; args: Record<string, unknown> } | { text: string })[] = [
  { tool: "count", args: {} },
  // a proposal outside the closed set is refused, then a failing check, then the settlement
  {
    tool: "settle",
    args: { result: { count: 3 }, proposals: [{ kind: "release", ref: {}, sentence: "no" }], sentence: "x" },
  },
  { tool: "settle", args: { result: { count: 0 }, proposals: [], sentence: "x" } },
  {
    tool: "settle",
    args: {
      result: { count: 3 },
      proposals: [{ kind: "note", ref: { text: "counted" }, sentence: "a note" }],
      sentence: "Counted three.",
    },
  },
  { text: "done" },
];
const dir = mkdtempSync(join(tmpdir(), "flue-"));
const flue = await start({
  agents: [Boom, Settle],
  db: sqlite(join(dir, "s.sqlite")),
  providers: [
    scriptedProvider(`kvasir-${boom.id}`, (_c, calls) => ({ tool: "boom", args: { n: calls } })),
    scriptedProvider(`kvasir-${settleM.id}`, (_c, calls) => script[Math.min(calls, script.length - 1)]),
  ],
});
afterAll(() => flue.stop());

/** Every batch the store holds for a conversation, as text: the record is the transcript (section 9.7). */
function recorded(id: string): string[] {
  const db = new DatabaseSync(join(dir, "s.sqlite"));
  const rows = db
    .prepare("SELECT data FROM flue_conversation_stream_batches WHERE path LIKE ?")
    .all(`%${id}%`) as { data: string }[];
  db.close();
  return rows.map((r) => r.data);
}

describe("a station on Flue", () => {
  it("a tool stubbed to fail forever terminates within the budget with the named reason", async () => {
    const h = init(Boom, { id: "run-boom" });
    const reply = await h
      .read(await h.dispatch("go"))
      .catch((e: Error) => ({ text: `failed: ${e.message}`, metadata: {} as Record<string, unknown> }));
    expect(runs).toBeLessThanOrEqual(boom.budget.tool_calls);
    expect(reply.metadata).toMatchObject({ terminal: "budget_tools" });
    // the record says so too: the last boom answer names the reason
    const outputs = recorded("run-boom");
    expect(outputs.some((o) => /budget_tools/u.test(o))).toBe(true);
  }, 60_000);

  it("settles only through settle, once the checks pass, with proposals from the closed set", async () => {
    const h = init(Settle, { id: "run-settle" });
    const reply = await h.read(await h.dispatch("go"));
    // the settle ends the response: no further model turn, so no text after it (the instructions no longer change with the phase, which used to buy one)
    expect(reply.metadata).toMatchObject({ terminal: "settled" });
    const outputs = recorded("run-settle");
    expect(outputs.some((o) => /not a proposal this station may make/u.test(o))).toBe(true);
    expect(outputs.some((o) => /the count is not positive/u.test(o))).toBe(true);
    expect(outputs.some((o) => /"settled":true/u.test(o))).toBe(true);
  }, 60_000);
});
