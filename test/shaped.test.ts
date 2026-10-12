// SPDX-License-Identifier: AGPL-3.0-only
// The columns an answer holds as shapes (record 55 K7, 2026-10-12). Below
// detail quasi the engine answers a column that reads a quasi identifying
// field as its shape and names those columns in `shaped`: on a run, the
// preview, a handle and its pages, and a queued job's result. Every reader
// that hands an answer's rows to a model passes the names on as one plain
// line, and the one chat's check before a turn settles sends back an answer
// that states or guesses a value of them, or does not say that the person's
// detail does not show them and who can give that access. Before, the
// assistant kept the preview's level, columns, rows and truncated alone and
// guessed shapes from the values, and a plain reader was told "ages 21 to
// 61", which the model had made up from the rows' own keys.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "shaped-"));
process.env.ASSISTANT_LEDGER = join(dir, "seam.sqlite");
process.env.ASSISTANT_LINEAGE = join(dir, "lineage.sqlite");
process.env.ASSISTANT_NOTES = join(dir, "notes.sqlite");
process.env.ASSISTANT_LADDER = join(dir, "ladder.sqlite");

const { stubEngine } = await import("./child/stub-engine.ts");
const { probeEngineAuth, registerStation } = await import("../src/seam/for.ts");
const { loadManifests } = await import("../src/stations/manifest.ts");
const { shapedLine, shapedOf, withShapedLine } = await import("../src/seam/shaped.ts");
const { askHelpTools, compactPreview } = await import("../src/stations/ask-help.ts");
const { conciergeTools } = await import("../src/stations/concierge.ts");
const { TOOLS } = await import("../src/one/tools.ts");
const { conversationOf, newTurn, turnOf } = await import("../src/one/state.ts");
const { columnWords, complaintsOf, shapedComplaint, valueGiven } = await import("../src/one/checks.ts");

/** The bench's question at detail plain: a group's youngest and oldest age at the first scan, answered as shapes. */
const AGES = {
  level: "aggregate",
  columns: ["cohort", "youngest", "oldest", "_subjects"],
  rows: [["ms-cohort-a", "99", "99", 24]],
  truncated: false,
  shaped: ["youngest", "oldest"],
};
const LINE =
  "These columns came back as shapes at your detail: youngest, oldest; their values are not known to you.";
/** A page of a handle's rows: the codes come as shapes, marked on the column and named in `shaped`. */
const PAGE = {
  handle: 31,
  page: 1,
  pages: 1,
  columns: [
    { name: "code", type: "text", shaped: true },
    { name: "n_scans", type: "integer" },
  ],
  shaped: ["code"],
  rows: [
    ["aaa9", 3],
    ["aaa9", 5],
  ],
};

const engine = await stubEngine((c) => {
  const p = c.path.split("?")[0];
  const body = (c.body ?? {}) as { document_id?: number };
  if (p === "/api/capabilities") return { body: { auth: "off", policy: [] } };
  if (p === "/api/ask/draft")
    return { body: { document: 21, hash: "h", diagnosis: [{ set: "first", rows: 24 }] } };
  if (p === "/api/ask/diagnose") return { body: { groups: [] } };
  if (p === "/api/ask/preview")
    // question 22 comes from an engine that names no shapes, as one before 2026-10-12 answers
    return body.document_id === 22
      ? { body: { level: "record", columns: ["code"], rows: [["aaa9"]], truncated: false } }
      : { body: AGES };
  if (p === "/api/ask/handles/31/rows") return { body: PAGE };
  if (p === "/api/ask/handles/31") return { body: { id: 31, grain: "subject", truncated: false, ...PAGE } };
  if (p === "/api/jobs/41")
    return {
      body: {
        id: 41,
        kind: "ask",
        state: "done",
        result: {
          handle: 31,
          hash: "h",
          grain: "subject",
          row_count: 2,
          content_hash: "c",
          truncated: false,
          columns: ["code", "n_scans"],
          shaped: ["code"],
        },
      },
    };
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
/** A one-chat tool's context in a fresh turn of its own conversation. */
const ctx = (id: string) => {
  newTurn(id, "the youngest and the oldest age");
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
const call = async (tool: keyof typeof TOOLS, args: Record<string, unknown>, id: string) =>
  (await TOOLS[tool].run(args, ctx(id))) as Out;

describe("what an answer names as shapes", () => {
  it("is its list and its columns' marks, once each, and nothing where it names neither", () => {
    expect(shapedOf(AGES)).toEqual(["youngest", "oldest"]);
    expect(shapedOf(PAGE)).toEqual(["code"]);
    expect(shapedOf({ columns: [{ name: "day", shaped: true }, { name: "n" }] })).toEqual(["day"]);
    expect(shapedOf({ columns: ["n"], shaped: [] })).toEqual([]);
    // an engine from before 2026-10-12 names none: unknown, never "none"
    expect(shapedOf({ columns: ["code"], rows: [["aaa9"]] })).toBeNull();
    expect(shapedOf(null)).toBeNull();
    expect(shapedOf([1, 2])).toBeNull();
  });

  it("reaches the model as one plain line, in place of the engine's list", () => {
    expect(shapedLine(["youngest", "oldest"])).toBe(LINE);
    expect(shapedLine([])).toBeNull();
    expect(withShapedLine({ handle: 31, shaped: ["code"] }, PAGE)).toEqual({
      handle: 31,
      shaped: "These columns came back as shapes at your detail: code; their values are not known to you.",
    });
    expect(withShapedLine({ handle: 31 }, { handle: 31, shaped: [] })).toEqual({ handle: 31 });
    expect(withShapedLine({ blocked: true }, null)).toEqual({ blocked: true });
  });
});

describe("the stations' readers", () => {
  it("the compact preview keeps the line beside its rows, and says nothing where nothing is shaped", () => {
    expect(compactPreview(AGES)).toEqual({
      level: "aggregate",
      columns: ["cohort", "youngest", "oldest"],
      rows: [["ms-cohort-a", "99", "99"]],
      truncated: false,
      shaped: LINE,
    });
    expect(compactPreview({ level: "count", columns: ["n"], rows: [[3]], shaped: [] })).toEqual({
      level: "count",
      columns: ["n"],
      rows: [[3]],
      truncated: false,
    });
  });

  it("ask-help's draft and preview say which columns came back as shapes", async () => {
    const tools = Object.fromEntries(askHelpTools().map((t) => [t.name, t]));
    const seam = {
      door: async (path: string) => ({
        kind: "ok",
        status: 200,
        body: path === "/api/ask/draft" ? { document: 21, hash: "h" } : AGES,
      }),
    };
    const station = { seam, conversation: "c", toolCallId: "t1", state: { phase: "check" } } as never;
    const drafted = await tools.nils_draft.run({ text: "ast_version: 1" }, station);
    expect((drafted.output as { preview: { shaped?: string } }).preview.shaped).toBe(LINE);
    const previewed = await tools.nils_preview.run({ document_id: 21 }, station);
    expect((previewed.output as { shaped?: unknown }).shaped).toBe(LINE);
    // the rows are the engine's, shapes and all; the line says what they are
    expect((previewed.output as { rows?: unknown }).rows).toEqual(AGES.rows);
  });

  it("the concierge's handle and its rows say which columns came back as shapes, and nothing else changes", async () => {
    const tools = Object.fromEntries(conciergeTools().map((t) => [t.name, t]));
    const seam = {
      call: async ({ path }: { path: string }) => ({
        kind: "ok",
        status: 200,
        body: path.startsWith("/api/ask/handles/31")
          ? { ...PAGE, ...(path.includes("/rows") ? {} : { id: 31 }) }
          : { doors: [] },
      }),
    };
    const station = { seam, conversation: "c", toolCallId: "t1", state: { phase: "hold" } } as never;
    const code = "These columns came back as shapes at your detail: code; their values are not known to you.";
    for (const [name, args] of [
      ["nils_handle", { handle: 31 }],
      ["nils_rows", { handle: 31, page: 1 }],
    ] as const) {
      const out = (await tools[name].run(args, station)).output as Record<string, unknown>;
      expect(out.shaped, name).toBe(code);
      expect(out.rows, name).toEqual(PAGE.rows);
    }
    expect((await tools.nils_capabilities.run({}, station)).output).toEqual({ doors: [] });
  });
});

describe("the one chat's readers", () => {
  it("query_draft and query_run_readonly put the line beside the preview's rows, outside the registry's data", async () => {
    for (const [tool, args] of [
      ["query_draft", { text: "ast_version: 1" }],
      ["query_run_readonly", { what: "document", document: 21 }],
    ] as const) {
      const r = await call(tool, args, `r-${tool}`);
      const preview = r.output.preview as {
        registry_data: { rows: unknown[][]; shaped?: unknown };
        shaped?: unknown;
      };
      expect(preview.shaped, tool).toBe(LINE);
      expect(preview.registry_data.rows, tool).toEqual([["ms-cohort-a", "99", "99"]]);
      expect(preview.registry_data.shaped, tool).toBeUndefined();
      expect(turnOf(`r-${tool}`).shaped, tool).toEqual(["youngest", "oldest"]);
    }
  });

  it("query_read_rows says it of a stored question's rows and of a page of a result", async () => {
    const doc = await call("query_read_rows", { document: 21 }, "r-doc");
    expect(doc.output.shaped).toBe(LINE);
    expect(doc.output.document).toBe(21);
    const page = await call("query_read_rows", { handle: 31, page: 1 }, "r-page");
    expect(page.output.shaped).toBe(
      "These columns came back as shapes at your detail: code; their values are not known to you.",
    );
    expect((page.output.registry_data as { rows: unknown[][] }).rows).toEqual(PAGE.rows);
    expect(turnOf("r-page").shaped).toEqual(["code"]);
  });

  it("jobs_read says it of a question run as a job, from the job's result", async () => {
    const r = await call("jobs_read", { job: 41 }, "r-job");
    expect(r.output.state).toBe("done");
    expect(r.output.shaped).toBe(
      "These columns came back as shapes at your detail: code; their values are not known to you.",
    );
    expect(turnOf("r-job").shaped).toEqual(["code"]);
  });

  it("says nothing of shapes where the engine names none, and the turn keeps what it read", async () => {
    const id = "r-old";
    const c = ctx(id);
    c.turn.shaped = ["youngest"];
    const r = (await TOOLS.query_read_rows.run({ document: 22 }, c)) as Out;
    expect(r.output.shaped).toBeUndefined();
    expect(JSON.stringify(r.output)).not.toMatch(/came back as shapes/u);
    expect(turnOf(id).shaped).toEqual(["youngest"]);
  });
});

describe("the check before a turn settles", () => {
  const AGE_COLUMNS = ["youngest", "oldest"];

  it("reads what a column holds from its name", () => {
    expect(columnWords(["age_first", "subject.birth_date", "n_subjects", "youngest", "min_age"])).toEqual([
      "age",
      "first",
      "birth",
      "date",
      "youngest",
    ]);
  });

  it("finds a value given in a sentence about a shaped column, never a count", () => {
    expect(valueGiven("The ages run from 21 to 61.", ["age_first"])).toBe("21 to 61");
    expect(valueGiven("The youngest was about 30 years old.", AGE_COLUMNS)).toBe("30 years");
    expect(valueGiven("Their first scans were in 2008.", ["first"])).toBe("2008");
    expect(valueGiven("Cohort A has 24 subjects; their ages are not shown.", ["age_first"])).toBeNull();
    expect(valueGiven("The 24 subjects are aged between 21 and 61.", ["age_first"])).toBe("21 and 61");
    expect(valueGiven("The scans run from 2008 to 2012.", ["youngest"])).toBeNull();
  });

  it("sends back an answer that states or guesses a value, or does not say the detail hides it and who gives access", () => {
    const right =
      "Your account's detail does not show ages, so I cannot give the youngest or the oldest age in ms-cohort-a; an admin can give that access.";
    expect(shapedComplaint(right, AGE_COLUMNS)).toBeNull();
    expect(shapedComplaint("Cohort A has 24 subjects.", [])).toBeNull();
    // a guess, a shape read as a value, and a refusal that names no one who can give the access
    for (const [answer, given] of [
      ["In ms-cohort-a the youngest was 21 and the oldest 61 at their first scan.", null],
      ["The youngest and the oldest were both 99.", null],
      ["Your account's detail does not show ages, so I cannot give them.", null],
      [
        "Your detail does not show exact ages, but the youngest looks about 20 to 30. An admin can give that access.",
        "20 to 30",
      ],
    ] as const) {
      const why = shapedComplaint(answer, AGE_COLUMNS);
      expect(why, answer).toMatch(
        /^the columns youngest, oldest came back as shapes at this person's detail, so no value of them is known/u,
      );
      expect(why, answer).toMatch(
        /never state or guess one; say plainly that their detail does not show them, and that an admin can give that access$/u,
      );
      if (given) expect(why, answer).toContain(`(the answer gives ${given})`);
    }
    expect(shapedComplaint("The youngest was 21.", ["youngest"])).toMatch(/^the column youngest came back/u);
  });

  it("holds the turn's answer to the columns its last answer read as shapes", async () => {
    const id = "chk";
    const turn = newTurn(id, "What are the youngest and the oldest age at the first scan in ms-cohort-a?");
    turn.shaped = AGE_COLUMNS;
    turn.texts.push("The youngest was 21 and the oldest 61.");
    const check = { turn, convo: conversationOf(id), conversation: id, validate: null };
    expect((await complaintsOf(check)).join("; ")).toMatch(
      /the columns youngest, oldest came back as shapes/u,
    );
    turn.texts.push(
      "Your account's detail does not show ages, so I cannot give the youngest or the oldest; an admin can give that access.",
    );
    expect(await complaintsOf(check)).toEqual([]);
  });
});
