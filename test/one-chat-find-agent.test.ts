// SPDX-License-Identifier: AGPL-3.0-only
// One chat (2026-10-09), the second find arm: finding data as a read-only
// sub-agent named `find`, reached through Flue's task tool, with a brief the
// host builds (the person's words as they wrote them, the grants line) and
// only the read tools. Its draft counts as the turn's, so the question is
// still offered as the conversation's new version.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Context, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { init } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "one-find-"));
process.env.ASSISTANT_LEDGER = join(dir, "seam.sqlite");
process.env.ASSISTANT_LINEAGE = join(dir, "lineage.sqlite");
process.env.ASSISTANT_NOTES = join(dir, "notes.sqlite");

const { stubEngine } = await import("./child/stub-engine.ts");
const { scriptedProvider } = await import("./child/loop-provider.ts");
const { probeEngineAuth, registerStation } = await import("../src/seam/for.ts");
const { loadManifests } = await import("../src/stations/manifest.ts");
const { ChangeStore, theChanges, useChangeStore } = await import("../src/one/changes.ts");
const { oneAgent } = await import("../src/one/agent.ts");
const { turnOf } = await import("../src/one/state.ts");

const engine = await stubEngine((c) => {
  const p = c.path.split("?")[0];
  if (p === "/api/capabilities") return { body: { auth: "off" } };
  if (p === "/api/ask/catalog") return { body: { cohorts: [{ name: "ms-cohort-b", members: 24 }] } };
  if (p === "/api/ask/guide") return { body: { grounding: [] } };
  if (p === "/api/ask/draft") return { body: { document: 812, diagnosis: [] } };
  if (p === "/api/ask/preview") return { body: { level: "count", columns: ["n"], rows: [[24]] } };
  if (p === "/api/ask/validate") return { body: { valid: true } };
  return null;
});
process.env.NILS_URL = engine.url;
await probeEngineAuth(engine.url);
for (const m of loadManifests(["./stations"]).values())
  registerStation({
    id: m.id,
    version: "t",
    grant: m.grant,
    ceiling: m.ceiling,
    content: m.content,
    model: "m",
  });
useChangeStore(() => new ChangeStore(join(dir, "changes.sqlite")));

const child: Context[] = [];
const parent: Context[] = [];
const provider = scriptedProvider("kvasir-nils", (context) => {
  const prompt = getCurrentSystemPrompt(context.messages as never) ?? context.systemPrompt ?? "";
  if (/You find data in a neuroimaging registry/u.test(prompt)) {
    child.push(structuredClone(context));
    return child.length === 1
      ? { tool: "query_draft", args: { text: "ast_version: 1\n" } }
      : { text: "Cohort B has 24 subjects.\ndocument: 812" };
  }
  parent.push(structuredClone(context));
  return parent.length === 1
    ? { tool: "task", args: { agent: "find", prompt: "How many subjects are in cohort B?" } }
    : { text: "Cohort B has 24 subjects." };
});

const Nils = oneAgent({ model: "m", arm: "subagent", stationDirs: ["./stations"] });
let flue: Awaited<ReturnType<typeof start>>;
beforeAll(async () => {
  flue = await start({ agents: [Nils], db: sqlite(join(dir, "flue.sqlite")), providers: [provider] });
});
afterAll(async () => {
  await flue.stop();
  engine.close();
});

describe("finding data as a read-only sub-agent", () => {
  it("briefs the find agent with the person's own words and read tools only, and keeps its draft as the turn's", async () => {
    const h = init(Nils, { id: "oc-sub" });
    const reply = await h.read(await h.dispatch("How many subjects are in cohort B?"));
    expect(reply.text).toMatch(/24 subjects/u);
    // the parent has no find skill, and its head says the find agent finds data
    const head = getCurrentSystemPrompt(parent[0].messages as never) ?? "";
    expect(head).toMatch(/give it to the agent named find/u);
    expect(head).toMatch(/- \*\*find\*\*/u);
    expect(head).not.toMatch(/\*\*find-data\*\*/u);
    // the child's brief is built by the host, and its tools only read or draft
    const brief = getCurrentSystemPrompt(child[0].messages as never) ?? "";
    expect(brief).toMatch(/The person's words, as they wrote them: "How many subjects are in cohort B\?"/u);
    expect(brief).toMatch(/document: none/u);
    const tools = getCurrentTools(child[0].messages as never).map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["query_draft", "registry_search"]));
    expect(tools).not.toContain("propose_change");
    expect(tools).not.toContain("ask_user");
    // the turn counts the find agent as finding data, and its draft as the turn's
    const turn = turnOf("oc-sub");
    expect([...turn.skills]).toContain("find-data");
    expect(turn.drafted).toEqual([812]);
    expect(turn.texts.join(" ")).not.toMatch(/document: 812/u);
    expect(
      theChanges()
        .of("oc-sub")
        .map((c) => c.kind),
    ).toEqual(["query_version"]);
  }, 60_000);
});
