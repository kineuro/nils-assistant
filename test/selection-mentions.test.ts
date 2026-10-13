// SPDX-License-Identifier: AGPL-3.0-only
// Record 55 K6: a saved selection named with @ in the chat, as a kept result
// is. The desk writes @[name](selection:name%402); the one chat is told what
// each mention of the message names and which tool reads it, and
// query_read_rows reads a selection by name@version through the selections
// doors under the person's own access: its versions, its question, its size
// as the newest answer that froze it whole says it, a size held back at the
// person's detail said as held, and with a page the rows of that answer.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "selection-mentions-"));
process.env.ASSISTANT_LEDGER = join(dir, "seam.sqlite");
process.env.ASSISTANT_LINEAGE = join(dir, "lineage.sqlite");
process.env.ASSISTANT_NOTES = join(dir, "notes.sqlite");
process.env.ASSISTANT_LADDER = join(dir, "ladder.sqlite");

const { stubEngine } = await import("./child/stub-engine.ts");
const { probeEngineAuth, registerStation } = await import("../src/seam/for.ts");
const { loadManifests } = await import("../src/stations/manifest.ts");
const { HELD_LIST } = await import("../src/seam/shaped.ts");
const { operationOf } = await import("../src/seam/grant.ts");
const { TOOLS, selectionNamed, selectionParts } = await import("../src/one/tools.ts");
const { conversationOf, newTurn, turnOf } = await import("../src/one/state.ts");
const { factsOf, TOLD_NOTHING } = await import("../src/one/facts.ts");
const { MENTION_RULE, mentionsIn, mentionsLine, plainMentions } = await import("../src/host/mentions.ts");

const ASK = { sets: { s: { from: "role:t1", where: [] } }, out: { set: "s" } };
const LIST = {
  count: 3,
  total: 3,
  matching: 3,
  next: null,
  selections: [
    {
      id: 1,
      name: "ms-baseline",
      spec: "selection:ms-baseline@2",
      versions: 2,
      grain: "stack",
      description: "first visit T1",
      note: null,
      cohort: null,
      size: {
        rows: 412,
        grain: "stack",
        version: 2,
        handle: 70,
        at: "2026-10-12T08:00:00Z",
        truncated: false,
      },
    },
    {
      id: 2,
      name: "ms-baseline-old",
      spec: "selection:ms-baseline-old@1",
      versions: 1,
      grain: "stack",
      size: null,
    },
    {
      id: 3,
      name: "ms-small",
      spec: "selection:ms-small@1",
      versions: 1,
      grain: "subject",
      size: {
        rows: null,
        grain: "subject",
        version: 1,
        handle: 71,
        at: "2026-10-12T08:00:00Z",
        truncated: false,
      },
    },
  ],
};
const ROWS = { handle: 70, page: 1, pages: 21, columns: ["stack", "subject"], rows: [[1, "S-AB12"]] };

const engine = await stubEngine((c) => {
  const p = c.path.split("?")[0];
  if (p === "/api/capabilities") return { body: { auth: "off", policy: [] } };
  if (p === "/api/ask/selections") return { body: LIST };
  if (p === "/api/ask/selections/ms-baseline%402" || p === "/api/ask/selections/ms-baseline%401")
    return { body: { name: "ms-baseline", version: Number(p.slice(-1)), current_version: 2, ask: ASK } };
  if (p.startsWith("/api/ask/selections/")) return { body: { ask: ASK } };
  if (p === "/api/ask/handles/70/rows") return { body: ROWS };
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
afterAll(() => engine.close());

const writers = {
  progress: () => {},
  approval: () => {},
  clarification: () => {},
  plan: () => {},
  memory: () => {},
  chart: () => {},
  file: () => {},
};
const ctx = (id: string, message: string) => {
  newTurn(id, message);
  return {
    conversation: id,
    subject: "anna@lab",
    toolCallId: `call-${id}`,
    turn: turnOf(id),
    convo: conversationOf(id),
    mounted: { tools: [], skills: [], detail: "plain" as const },
    write: writers,
  };
};
type Out = { output: Record<string, unknown> };
const read = async (args: Record<string, unknown>, id: string, message = "what is in it?") =>
  (await TOOLS.query_read_rows.run(args, ctx(id, message) as never)) as Out;

const WORDS = "How many scans in @[ms-baseline](selection:ms-baseline%402) and @[T1 series](result:45)?";

describe("a saved selection named with @", () => {
  it("is a mention of its own kind, read plainly and named in the rule every station is told", () => {
    expect(mentionsIn(WORDS)).toEqual([
      { kind: "selection", id: "ms-baseline@2", name: "ms-baseline" },
      { kind: "result", id: "45", name: "T1 series" },
    ]);
    expect(plainMentions(WORDS)).toBe("How many scans in ms-baseline and T1 series?");
    expect(plainMentions(WORDS, { kinds: true })).toBe(
      "How many scans in ms-baseline (selection ms-baseline@2) and T1 series (result 45)?",
    );
    expect(MENTION_RULE).toContain("@[name](selection:NAME@2)");
  });

  it("reaches the one chat's facts with the tool that reads it, only where that tool is mounted", () => {
    const line = mentionsLine(WORDS, ["query_read_rows"]) as string;
    expect(line).toContain('"ms-baseline" is the saved selection ms-baseline@2');
    expect(line).toContain("query_read_rows (selection: ms-baseline@2)");
    expect(line).toContain("query_read_rows (handle: 45)");
    expect(mentionsLine(WORDS, [])).not.toContain("query_read_rows");
    expect(mentionsLine("no mention here", ["query_read_rows"])).toBeNull();
    const facts = factsOf({
      told: TOLD_NOTHING,
      summary: null,
      grants: "may: query",
      hint: "Hint from the words: none.",
      mentioned: line,
      document: null,
    }).text;
    expect(facts.indexOf(line)).toBeGreaterThan(-1);
    expect(facts.indexOf(line)).toBeLessThan(facts.indexOf("Hint from the words"));
  });

  it("is the selection an analysis plans over, read from the mention and not from words alone", () => {
    expect(selectionNamed("scans", WORDS)).toBe("ms-baseline@2");
    expect(selectionNamed("scans", "my selection ms-a@1")).toBe("ms-a@1");
    expect(selectionParts("selection:ms-baseline@2")).toEqual({ name: "ms-baseline", version: 2 });
    expect(selectionParts("ms-baseline")).toEqual({ name: "ms-baseline", version: null });
    expect(selectionParts("ms baseline; drop")).toBeNull();
    expect(operationOf("GET", "/api/ask/selections/ms-baseline%402")).toBe("selections/{name}");
    expect(operationOf("GET", "/api/ask/selections?q=ms")).toBe("selections");
  });

  it("is read by query_read_rows: its versions, question and size, as the person's own reads", async () => {
    const before = engine.seen.length;
    const out = (await read({ selection: "ms-baseline@2" }, "sel-read", WORDS)).output;
    expect(out).toMatchObject({
      selection: "ms-baseline@2",
      current_version: 2,
      size: { rows: 412, grain: "stack", of_version: 2 },
    });
    expect(out.newer).toBeUndefined();
    expect((out.registry_data as { question: unknown }).question).toEqual(ASK);
    expect(String(out.use)).toContain("selection: ms-baseline@2");
    const paths = engine.seen.slice(before).map((c) => c.path);
    expect(paths[0]).toBe("/api/ask/selections?q=ms-baseline&limit=50");
    expect(paths).toContain("/api/ask/selections/ms-baseline%402");
    // no rows unless a page is asked for
    expect(paths.some((p) => p.includes("/handles/"))).toBe(false);
  });

  it("names the current version when an older one is asked, and the rows of the answer that froze it with a page", async () => {
    const old = (await read({ selection: "ms-baseline@1" }, "sel-old")).output;
    expect(old.newer).toBe("version 2 is the current one");
    const page = (await read({ selection: "ms-baseline@2", page: 1 }, "sel-page")).output;
    expect(page).toMatchObject({ selection: "ms-baseline@2" });
    expect((page.rows_page as { registry_data: unknown }).registry_data).toMatchObject({
      page: 1,
      pages: 21,
    });
    expect(JSON.stringify(page.rows_page)).toContain("S-AB12");
    // the selection's own question stays beside its rows
    expect((page.registry_data as { question: unknown }).question).toEqual(ASK);
  });

  it("says a size held back at the person's detail as held, and has no rows to read from it", async () => {
    const out = (await read({ selection: "ms-small", page: 1 }, "sel-held")).output;
    expect(out).toMatchObject({ selection: "ms-small@1", size: { rows: HELD_LIST }, rows: HELD_LIST });
    expect(JSON.stringify(out)).not.toMatch(/"rows":(null|0|\[\])/u);
    expect(engine.seen.some((c) => c.path.startsWith("/api/ask/handles/71"))).toBe(false);
  });

  it("says one never counted as not counted, and refuses a name or a version there is none of", async () => {
    const none = (await read({ selection: "ms-baseline-old@1" }, "sel-none")).output;
    expect(String((none.size as { rows: unknown }).rows)).toMatch(/^not counted yet/u);
    const missing = (await read({ selection: "ms-gone@1" }, "sel-missing")).output;
    expect(missing).toMatchObject({ refused: true });
    expect(String(missing.why)).toContain("no saved selection named ms-gone");
    const beyond = (await read({ selection: "ms-baseline@9" }, "sel-beyond")).output;
    expect(String(beyond.why)).toContain("has no version 9");
  });
});
