// SPDX-License-Identifier: AGPL-3.0-only
// The gate of the typed context (Wave 5 section 9.2): the context of every
// page kind the desk declares, poisoned with rows and long text, goes
// through the host's admission and into a station's prompt; the prompt
// carries the identifiers and none of the rows. A station's tool result
// never returns raw values into the transcript either: the record of the
// run holds counts and ids only.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { init } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import * as v from "valibot";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "context-gate-"));
process.env.ASSISTANT_LINEAGE = join(dir, "lineage.sqlite");
process.env.ASSISTANT_NOTES = join(dir, "notes.sqlite");
process.env.ASSISTANT_LEDGER = join(dir, "seam.sqlite");

const { registerStation, theLineage } = await import("../src/seam/for.ts");
const { stationAgent } = await import("../src/stations/agent.ts");
const { briefHash, validate } = await import("../src/stations/manifest.ts");
const { scriptedProvider } = await import("./child/loop-provider.ts");

const sdir = mkdtempSync(join(tmpdir(), "station-"));
mkdirSync(join(sdir, "evals"));
const brief = "---\nname: gate-station\ndescription: A test station.\n---\nDo the thing.\n";
writeFileSync(join(sdir, "SKILL.md"), brief);
const manifest = validate(
  {
    id: "gate-station",
    app: "nils-assistant",
    purpose: "assistant.gate-station",
    content: "catalog",
    ceiling: "reader",
    grant: { describe: {} },
    brief: { path: "SKILL.md", hash: briefHash(brief) },
    result: { type: "object", required: ["count"], properties: { count: { type: "integer" } } },
    checks: ["positive"],
    budget: { turns: 6, tool_calls: 8, wall_clock_seconds: 60, input_tokens: 100000 },
    writes: ["note"],
    phases: { initial: "work", transitions: [{ from: "work", to: "finish" }] },
    evals: "evals",
  },
  sdir,
);
registerStation({
  id: manifest.id,
  version: "1",
  grant: manifest.grant,
  ceiling: manifest.ceiling,
  content: manifest.content,
  model: "m",
});
const Gate = stationAgent({
  manifest,
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
        // a tool answers counts and ids, never the rows it counted
        return { output: { count: 48, subjects: 48 } as never, evidence: { handles: [71] } };
      },
    },
  ],
  checks: { positive: (verdict) => (Number(verdict.result.count) > 0 ? null : "the count is not positive") },
  settle: { phases: ["work", "finish"] },
});

/** What the model was shown, gathered from every request the provider saw. */
const prompts: string[] = [];
const script = [
  { tool: "count", args: {} },
  { tool: "settle", args: { result: { count: 48 }, proposals: [], sentence: "Counted." } },
  { text: "done" },
];
const flue = await start({
  agents: [Gate],
  db: sqlite(join(dir, "s.sqlite")),
  providers: [
    scriptedProvider("kvasir-gate-station", (context, calls) => {
      prompts.push(
        [context.systemPrompt ?? "", ...context.messages.map((m) => JSON.stringify(m.content))].join("\n"),
      );
      return script[Math.min(calls, script.length - 1)];
    }),
  ],
});
afterAll(() => flue.stop());

const POISON_VALUES = ["S-0001", "S-0002", "1961-04-02", "3.5", "x".repeat(300), "the person said"];

/** The context of one page kind, with the rows a page holds beside what it declares. */
function pageContext(kind: string, id: string | null) {
  return {
    page: { kind, id },
    document_id: 12,
    content_hash: "9f3c2b1a9f3c2b1a",
    chain: [12, 9],
    epoch: 4,
    sets: [{ name: "people", grain: "subject", values: ["S-0001", "S-0002"] }],
    funnel: [{ set: "people", rows: 48 }],
    pack: { name: "mri", version: "0.1.1" },
    handle_id: 71,
    declaration: { scheme: "default", note: "x".repeat(300) },
    error_codes: ["scheme_mismatch"],
    job_ids: [7],
    rows: [["S-0001", 3.5, "1961-04-02"]],
    columns: ["subject", "edss", "birth"],
    transcript: "the person said S-0001 has EDSS 3.5",
  };
}

const PAGES: [string, string | null][] = [
  ["home", null],
  ["ask", "12"],
  ["document", "12"],
  ["handle", "71"],
  ["job", "7"],
  ["review", "3"],
  ["release", "2"],
  ["data", null],
  ["pipelines", null],
  ["settings", "parts"],
  ["assistant", null],
];

describe("the gate of the typed context", () => {
  it("every page's context reaches the prompt as identifiers and never as rows", async () => {
    for (const [kind, id] of PAGES) theLineage().contextPut(`gate-${kind}`, pageContext(kind, id));
    const h = init(Gate, { id: "gate-ask" });
    const reply = await h.read(await h.dispatch("narrow it"));
    expect(reply.metadata).toMatchObject({ terminal: "settled" });
    expect(prompts.length).toBeGreaterThan(0);
    const shown = prompts.join("\n");
    expect(shown).toContain("Where the person is");
    expect(shown).toContain("the open document: 12 (hash 9f3c2b1a9f3c)");
    expect(shown).toContain("people (subject)");
    expect(shown).toContain("people 48");
    for (const p of POISON_VALUES) expect(shown, p).not.toContain(p);
    // every other page's admitted context is row-free as well
    for (const [kind] of PAGES) {
      const kept = JSON.stringify(theLineage().contextOf(`gate-${kind}`));
      for (const p of POISON_VALUES) expect(kept, `${kind}: ${p}`).not.toContain(p);
    }
    // the record of the run: the tool's answer is counts and ids, the settle is a sentence; no row anywhere
    const db = new DatabaseSync(join(dir, "s.sqlite"));
    const rows = db
      .prepare("SELECT data FROM flue_conversation_stream_batches WHERE path LIKE ?")
      .all("%gate-ask%") as { data: string }[];
    db.close();
    const record = rows.map((r) => r.data).join("\n");
    expect(record).toContain('"count":48');
    for (const p of POISON_VALUES) expect(record, p).not.toContain(p);
  }, 60_000);
});
