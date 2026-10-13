// SPDX-License-Identifier: AGPL-3.0-only
// Lists held back whole at detail plain (record 55 K7, small lists, the ruling
// of 2026-10-13). An answer that lists the rows of 1 to 4 subjects a quasi
// identifying field chose comes back with no row, `row_count` null, `pages` 0
// and every column in `held_back`; its handle holds no rows, its rows door
// answers 404, and a set, a start or a cohort made from it is refused with
// 409, "handle N holds no rows". A small model reads an empty list as none,
// so every reader writes its rows as held back and says once what that
// means, the check before a turn settles sends back an answer that calls it
// empty or gives it a size, and the rules say the same.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "held-lists-"));
process.env.ASSISTANT_LEDGER = join(dir, "seam.sqlite");
process.env.ASSISTANT_LINEAGE = join(dir, "lineage.sqlite");
process.env.ASSISTANT_NOTES = join(dir, "notes.sqlite");
process.env.ASSISTANT_LADDER = join(dir, "ladder.sqlite");

const { stubEngine } = await import("./child/stub-engine.ts");
const { probeEngineAuth, registerStation } = await import("../src/seam/for.ts");
const { loadManifests } = await import("../src/stations/manifest.ts");
const { HELD_LIST, HELD_LIST_LINE, heldListOf, heldListRefused, withShapedLine } = await import(
  "../src/seam/shaped.ts"
);
const { compactPreview } = await import("../src/stations/ask-help.ts");
const { TOOLS } = await import("../src/one/tools.ts");
const { conversationOf, newTurn, turnOf } = await import("../src/one/state.ts");
const { complaintsOf, heldListComplaint } = await import("../src/one/checks.ts");
const { headOf } = await import("../src/one/agent.ts");

const WHY =
  "a list of fewer than 5 subjects that a quasi identifying field chose; its length is a count, so no row is shown";
const HELD = [
  { column: "code", why: WHY },
  { column: "age", why: WHY },
];
/** A preview at plain of the women over 80 of a cohort, 2 of them: no row. */
const PREVIEW = {
  level: "record",
  columns: ["code", "age"],
  rows: [],
  truncated: false,
  shaped: ["age"],
  held_back: HELD,
};
/** Its run: no row, no page, no row count. */
const RUN = {
  handle: 33,
  hash: "h",
  grain: "subject",
  row_count: null,
  pages: 0,
  truncated: false,
  columns: [
    { name: "code", type: "text", held_back: WHY },
    { name: "age", type: "integer", held_back: WHY },
  ],
  rows: [],
  shaped: ["age"],
  held_back: HELD,
};

const engine = await stubEngine((c) => {
  const p = c.path.split("?")[0];
  const body = (c.body ?? {}) as { document_id?: number };
  if (p === "/api/capabilities") return { body: { auth: "off", policy: [] } };
  if (p === "/api/ask/preview") return { body: PREVIEW };
  if (p === "/api/ask/run")
    return body.document_id === 35
      ? {
          status: 409,
          body: { error: `handle 33 holds no rows: its answer was ${WHY}, at the detail it was asked at` },
        }
      : { body: RUN };
  if (p === "/api/ask/handles/33/rows") return { status: 404, body: { error: "handle 33 has no page 1" } };
  if (p === "/api/ask/handles/33") return { body: { id: 33, ...RUN } };
  if (p === "/api/jobs/42") return { body: { id: 42, kind: "ask", state: "done", result: RUN } };
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
const ctx = (id: string, extra: Record<string, unknown> = {}) => {
  newTurn(id, "which women over 80 are in ms-a?");
  return {
    conversation: id,
    subject: "anna@lab",
    toolCallId: `call-${id}`,
    turn: turnOf(id),
    convo: conversationOf(id),
    mounted: { tools: [], skills: [], detail: "plain" as const },
    write: writers,
    ...extra,
  };
};
type Out = { output: Record<string, unknown> };
const call = async (tool: keyof typeof TOOLS, args: Record<string, unknown>, id: string, extra = {}) =>
  (await TOOLS[tool].run(args, ctx(id, extra) as never)) as Out;

/** Nothing a model reads calls the list empty or gives it a size. */
const neverEmpty = (out: unknown) => {
  const text = JSON.stringify(out);
  expect(text).not.toMatch(/"rows":\[\]|"row_count":(null|0)|are null in the rows/u);
  expect(text).toContain(HELD_LIST);
};

describe("a list held back whole, as a model reads it", () => {
  it("is an answer with no row whose columns are held back as a list, or a run or handle whose row_count is null", () => {
    expect(heldListOf(PREVIEW)).toBe(WHY);
    expect(heldListOf({ handle: 33, row_count: null, rows: [], pages: 0 })).toMatch(
      /^a list of fewer than 5/u,
    );
    // none listed is an empty answer, and a held count or mean is a value of a row that came back
    expect(heldListOf({ rows: [], row_count: 0, held_back: [] })).toBeNull();
    expect(
      heldListOf({
        rows: [[null, null]],
        held_back: [{ column: "rows", why: "fewer than 5, or held beside" }],
      }),
    ).toBeNull();
    expect(
      heldListOf({ rows: [], held_back: [{ column: "mean", why: "a group under 5 subjects" }] }),
    ).toBeNull();
    expect(heldListRefused(409, `handle 33 holds no rows: its answer was ${WHY}`)).toBe(true);
    expect(heldListRefused(409, "the answer is stale")).toBe(false);
    expect(heldListRefused(404, "handle 33 holds no rows")).toBe(false);
  });

  it("reaches the stations as held: the compact preview and a door's answer", () => {
    expect(compactPreview(PREVIEW)).toEqual({
      held_list: HELD_LIST_LINE,
      level: "record",
      columns: ["code", "age"],
      rows: HELD_LIST,
      truncated: false,
    });
    const handle = withShapedLine({ id: 33, ...RUN } as never, RUN) as Record<string, unknown>;
    expect(handle.held_list).toBe(HELD_LIST_LINE);
    expect(handle.held_back).toBeUndefined();
    neverEmpty(handle);
    expect(HELD_LIST_LINE).toMatch(/never say it has no rows, none, nothing or any number/u);
  });

  it("reaches the one chat as held: a stored question's rows, a handle with no page, a job's result", async () => {
    const doc = await call("query_read_rows", { document: 31 }, "hl-doc");
    expect(doc.output.held_list).toBe(HELD_LIST_LINE);
    expect((doc.output.registry_data as { rows: unknown }).rows).toBe(HELD_LIST);
    expect(doc.output.held_back).toBeUndefined();
    neverEmpty(doc.output);
    expect(turnOf("hl-doc").heldBack).toEqual(HELD);
    // the handle holds no page: its rows door answers 404, and the handle itself says the list is held back
    const page = await call("query_read_rows", { handle: 33, page: 1 }, "hl-page");
    expect(page.output).toMatchObject({ handle: 33, rows: HELD_LIST, held_list: HELD_LIST_LINE });
    expect(JSON.stringify(page.output)).not.toMatch(/refused|404/u);
    const job = await call("jobs_read", { job: 42 }, "hl-job");
    expect(job.output.held_list).toBe(HELD_LIST_LINE);
    neverEmpty(job.output);
  });

  it("is nothing to analyse, said as held, and a 409 on its handle is held too, never a failure", async () => {
    const sandbox = { writeFile: async () => {}, exists: async () => false, readFile: async () => "" };
    const run = await call("analysis_table", { document: 34 }, "hl-table", { sandbox });
    expect(run.output).toMatchObject({ held_list: HELD_LIST_LINE, rows: HELD_LIST });
    expect(String(run.output.next)).toMatch(/held back at this person's detail to protect a small group/u);
    expect(run.output.refused).toBeUndefined();
    const refused = await call("analysis_table", { document: 35 }, "hl-409", { sandbox });
    expect(refused.output).toMatchObject({ held_list: HELD_LIST_LINE, rows: HELD_LIST });
    expect(JSON.stringify(refused.output)).not.toMatch(/the registry refused it/u);
  });
});

describe("the check before a turn settles, over a list held back", () => {
  it("sends back an answer that calls it empty or gives it a size, and lets one that says it is held back go", async () => {
    for (const right of [
      "The list of women over 80 in ms-a is held back at your detail to protect a small group.",
      "Those subjects are not shown: the list is held back to protect a small group.",
    ])
      expect(heldListComplaint(right, HELD), right).toBeNull();
    for (const wrong of [
      "There are no women over 80 in ms-a.",
      "The question found no rows.",
      "None of the subjects are over 80.",
      "Two subjects match, but their rows are held back.",
      "The list came back empty.",
      "I could not find them.",
    ])
      expect(heldListComplaint(wrong, HELD), wrong).toMatch(
        /^the list was held back at this person's detail to protect a small group/u,
      );
    expect(
      heldListComplaint("There are no women over 80.", [{ column: "mean", why: "a group under 5 subjects" }]),
    ).toBeNull();
    const id = "chk-list";
    const turn = newTurn(id, "Which women over 80 are in ms-a?");
    turn.heldBack = HELD;
    turn.texts.push("There are no women over 80 in ms-a.");
    const check = { turn, convo: conversationOf(id), conversation: id, validate: null };
    expect((await complaintsOf(check)).join("; ")).toMatch(
      /the list was held back .* never no rows, none or a number/u,
    );
  });

  it("is in the rules: held back to protect a small group, never no rows, none or a number", () => {
    expect(headOf("skill")).toContain(`A list written "${HELD_LIST}"`);
    expect(headOf("skill")).toMatch(
      /Say the list is held back to protect a small group; never say it has no rows, none or nothing, never give a number/u,
    );
  });
});
