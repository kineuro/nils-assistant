// SPDX-License-Identifier: AGPL-3.0-only
// Counts held back at detail plain (record 55 K7, small counts, the ruling of
// 2026-10-12). The engine answers a count of fewer than 5 subjects that a
// quasi identifying field chose or grouped as null, and one more beside it so
// that it is not found by subtraction: the count level's rows and subjects,
// the diagnosis's stages, drops, clause groups, ties and coarse rows, and the
// rows of a set on the desk's page. A small model reads a null count as none,
// so every reader writes it as held back, the same words for every held
// count (one held beside a small one is not under 5 itself, and two labels
// would say which is the small one), and says once what that means; the model
// is told never to give it as fewer than 5, 0 or a number, or work it out.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "held-counts-"));
process.env.ASSISTANT_LEDGER = join(dir, "seam.sqlite");
process.env.ASSISTANT_LINEAGE = join(dir, "lineage.sqlite");
process.env.ASSISTANT_NOTES = join(dir, "notes.sqlite");
process.env.ASSISTANT_LADDER = join(dir, "ladder.sqlite");

const { stubEngine } = await import("./child/stub-engine.ts");
const { probeEngineAuth, registerStation } = await import("../src/seam/for.ts");
const { loadManifests } = await import("../src/stations/manifest.ts");
const { HELD_COUNT, HELD_COUNTS_LINE, heldBackLine, heldCountCells, withHeldCounts, withShapedLine } =
  await import("../src/seam/shaped.ts");
const { admit, renderContext } = await import("../src/seam/context.ts");
const { askHelpTools, compactPreview } = await import("../src/stations/ask-help.ts");
const { PART } = await import("../src/stations/agent.ts");
const { TOOLS } = await import("../src/one/tools.ts");
const { conversationOf, newTurn, turnOf } = await import("../src/one/state.ts");
const { headOf } = await import("../src/one/agent.ts");
const ONE_INSTRUCTIONS = headOf("skill");

const WHY = "fewer than 5, or held beside a count of fewer than 5 so that it is not found by subtraction";

/** A count at plain of the women of a cohort, 3 of them: both counts held back. */
const COUNT = {
  level: "count",
  columns: ["rows", "subjects"],
  rows: [[null, null]],
  truncated: false,
  shaped: [],
  held_back: [
    { column: "rows", why: WHY },
    { column: "subjects", why: WHY },
  ],
};
/** Its diagnosis by clause: the cohort counted, the where on the sex held, and what it lost held with it. */
const DIAGNOSIS = {
  valid: true,
  issues: [],
  warnings: [],
  zero_rows: null,
  drops: [{ set: "women", clause: "sex = F", before: 48, after: null, nulls: 0 }],
  ties: [["women", null]],
  coarse: [],
  cost: { sets: 2, class: "small" },
  funnel: [
    { set: "women", grain: "subject", stage: "source", rows: 48, subjects: 48, on_path: true },
    {
      set: "women",
      grain: "subject",
      stage: "where",
      rows: null,
      subjects: null,
      on_path: true,
      held_back: WHY,
    },
  ],
  by: "clause",
  groups: [
    { set: "women", grain: "subject", group: "source", clauses: 1, kept: 48, subjects: 48, lost: 0 },
    { set: "women", grain: "subject", group: "where", clauses: 1, kept: null, subjects: null, lost: null },
  ],
  next: [],
};
/** A page of a result: subjects per cohort and sex, one line's count held. */
const PAGE = {
  handle: 32,
  page: 1,
  pages: 1,
  columns: [
    { name: "cohort", type: "text" },
    { name: "sex", type: "text", shaped: true },
    { name: "n", type: "integer" },
  ],
  shaped: ["sex"],
  held_back: [{ column: "n", why: WHY }],
  rows: [
    ["ms-a", "A", 41],
    ["ms-a", "A", null],
  ],
};

const engine = await stubEngine((c) => {
  const p = c.path.split("?")[0];
  if (p === "/api/capabilities") return { body: { auth: "off", policy: [] } };
  if (p === "/api/ask/draft") return { body: { document: 31, hash: "h", diagnosis: DIAGNOSIS } };
  if (p === "/api/ask/diagnose") return { body: DIAGNOSIS };
  if (p === "/api/ask/preview") return { body: COUNT };
  if (p === "/api/ask/handles/32/rows") return { body: PAGE };
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
const ctx = (id: string) => {
  newTurn(id, "how many women are in ms-a?");
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

/** No null count, and no zero where a count was held, anywhere in what the model reads. */
const noNullCount = (out: unknown) => {
  const text = JSON.stringify(out);
  expect(text).not.toMatch(/"(rows|subjects|kept|lost|after)":null/u);
  expect(text).not.toMatch(/\[null,null\]/u);
};

describe("a count held back, as a model reads it", () => {
  it("is written as held in a diagnosis, the line first, and a diagnosis with none is left as it was", () => {
    const d = withHeldCounts(DIAGNOSIS as never) as Record<string, unknown>;
    expect(Object.keys(d)[0]).toBe("held_counts");
    expect(d.held_counts).toBe(HELD_COUNTS_LINE);
    expect(d.funnel).toEqual([
      DIAGNOSIS.funnel[0],
      { ...DIAGNOSIS.funnel[1], rows: HELD_COUNT, subjects: HELD_COUNT },
    ]);
    expect(d.groups).toEqual([
      DIAGNOSIS.groups[0],
      { ...DIAGNOSIS.groups[1], kept: HELD_COUNT, subjects: HELD_COUNT, lost: HELD_COUNT },
    ]);
    expect(d.drops).toEqual([{ set: "women", clause: "sex = F", before: 48, after: HELD_COUNT, nulls: 0 }]);
    expect(d.ties).toEqual([["women", HELD_COUNT]]);
    noNullCount(d);
    const plain = { funnel: [{ set: "a", rows: 3, subjects: 3 }], drops: [], ties: [["a", 0]] };
    expect(withHeldCounts(plain as never)).toBe(plain);
    expect(withHeldCounts(null)).toBeNull();
  });

  it("is written as held in the rows where held_back names it with a count's why, and a held mean stays null", () => {
    expect(heldCountCells(["rows", "subjects"], [[null, null]], COUNT.held_back)).toEqual([
      [HELD_COUNT, HELD_COUNT],
    ]);
    expect(
      heldCountCells(
        ["dataset", "mean_age"],
        [["ds-b", null]],
        [{ column: "mean_age", why: "a group under 5 subjects" }],
      ),
    ).toEqual([["ds-b", null]]);
    expect(heldBackLine(COUNT.held_back)).toMatch(
      /^Some values of these columns were held back at your detail and are null in the rows \(a count, "held back \(fewer than 5, or hidden beside a small count so it cannot be worked out\)"\): rows \(fewer than 5, .*never say a held count as 0, none or "fewer than 5", and never work one out from a total or the counts around it; say which values were held back and why\.$/u,
    );
  });

  it("reaches the stations' preview and draft as held", async () => {
    expect(compactPreview(COUNT)).toEqual({
      level: "count",
      columns: ["rows", "subjects"],
      rows: [[HELD_COUNT, HELD_COUNT]],
      truncated: false,
      held_back: heldBackLine(COUNT.held_back),
    });
    expect((withShapedLine(COUNT as never, COUNT) as { rows: unknown }).rows).toEqual([
      [HELD_COUNT, HELD_COUNT],
    ]);
    const tools = Object.fromEntries(askHelpTools().map((t) => [t.name, t]));
    const seam = {
      door: async (path: string) => ({
        kind: "ok",
        status: 200,
        body:
          path === "/api/ask/draft"
            ? { document: 31, hash: "h", diagnosis: DIAGNOSIS }
            : path === "/api/ask/diagnose"
              ? DIAGNOSIS
              : COUNT,
      }),
    };
    const station = { seam, conversation: "c", toolCallId: "t1", state: { phase: "check" } } as never;
    for (const [name, args] of [
      ["nils_draft", { text: "ast_version: 1" }],
      ["nils_diagnose", { document_id: 31 }],
      ["nils_preview", { document_id: 31 }],
    ] as const) {
      const out = (await tools[name].run(args, station)).output;
      noNullCount(out);
      expect(JSON.stringify(out), name).toContain(HELD_COUNT);
    }
  });

  it("reaches the one chat as held: query_draft, query_run_readonly and a page of a result", async () => {
    for (const [tool, args] of [
      ["query_draft", { text: "ast_version: 1" }],
      ["query_run_readonly", { what: "document", document: 31 }],
    ] as const) {
      const r = await call(tool, args, `hc-${tool}`);
      noNullCount(r.output);
      const diagnosis = r.output.diagnosis as { held_counts?: string };
      expect(diagnosis.held_counts, tool).toBe(HELD_COUNTS_LINE);
      const preview = r.output.preview as { registry_data: { rows: unknown[][] }; held_back?: string };
      expect(preview.registry_data.rows, tool).toEqual([[HELD_COUNT, HELD_COUNT]]);
      expect(preview.held_back, tool).toBe(heldBackLine(COUNT.held_back));
      expect(turnOf(`hc-${tool}`).heldBack, tool).toEqual(COUNT.held_back);
    }
    const page = await call("query_read_rows", { handle: 32, page: 1 }, "hc-page");
    expect((page.output.registry_data as { rows: unknown[][] }).rows).toEqual([
      ["ms-a", "A", 41],
      ["ms-a", "A", HELD_COUNT],
    ]);
    expect(page.output.held_back).toBe(heldBackLine(PAGE.held_back));
  });

  it("reaches the model from the page's context as held, never dropped or as none", () => {
    const c = admit({
      page: { kind: "query", id: "31" },
      funnel: [
        { set: "cohort", rows: 48 },
        { set: "women", rows: null },
        { set: "odd", rows: "few" },
      ],
    });
    expect(c.funnel).toEqual([
      { set: "cohort", rows: 48 },
      { set: "women", rows: null },
    ]);
    const text = renderContext(c);
    expect(text).toContain(`- rows kept per set: cohort 48, women ${HELD_COUNT}`);
    expect(text).toContain(HELD_COUNTS_LINE);
    expect(
      renderContext(admit({ page: { kind: "query", id: "31" }, funnel: [{ set: "cohort", rows: 48 }] })),
    ).not.toContain("held back");
  });

  it("is a funnel part the desk may draw, and the one chat is told never to give it as 0 or work it out", () => {
    const part = { kind: "funnel", rows: [{ set: "women", stage: "where", rows: null, subjects: null }] };
    expect(v.safeParse(PART, part).success).toBe(true);
    expect(
      v.safeParse(PART, {
        kind: "funnel",
        rows: [{ set: "women", stage: "where", rows: "few", subjects: null }],
      }).success,
    ).toBe(false);
    expect(ONE_INSTRUCTIONS).toContain(`A count written "${HELD_COUNT}"`);
    expect(ONE_INSTRUCTIONS).toMatch(
      /Say its number is held back to protect a small group; never say "fewer than 5" as a fact about it, never 0 or none, never a number, and never work it out from a total less the counts shown/u,
    );
    expect(HELD_COUNT).toBe(
      "held back (fewer than 5, or hidden beside a small count so it cannot be worked out)",
    );
    expect(HELD_COUNTS_LINE).toMatch(
      /never say "fewer than 5" as a fact about that count, never 0 or none, never a number/u,
    );
  });
});
