// SPDX-License-Identifier: AGPL-3.0-only
// A refused draft does more work (2026-11-13, a live test). A turn ended with
// "this turn's work is spent" after seven drafts, three of them the same
// mistake in a group's keys mended one key at a time, and after an answer of
// no rows that nothing explained. The turn's work is not raised; each answer
// of query_draft says more:
// - every issue the registry listed is told, each with its path, as all
//   there are, to be mended in one draft; the shapes below are the registry's
//   own answers (the validator lists every issue it finds);
// - the compiler stops at its first fault and names that one alone
//   (`not_compilable`), so the model is told to check the items beside it,
//   and what a group's key may name;
// - an answer of no rows names the step that kept none, with what reached
//   it, from the registry's `zero_rows` and its funnel, also where a long
//   funnel is cut short before the model reads it.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "draft-refusals-"));
process.env.ASSISTANT_LEDGER = join(dir, "seam.sqlite");

const { stubEngine } = await import("./child/stub-engine.ts");
const { probeEngineAuth, registerStation } = await import("../src/seam/for.ts");
const { loadManifests } = await import("../src/stations/manifest.ts");
const { conversationOf, newTurn, TURN_BUDGET } = await import("../src/one/state.ts");
const { emptiedOf, issuesNext, issuesOf, TOOLS } = await import("../src/one/tools.ts");
const { shorten } = await import("../src/seam/client.ts");

const refused = (issues: unknown[]) => ({
  repairs: [],
  diagnosis: {
    valid: false,
    issues,
    repairs: [],
    warnings: [],
    zero_rows: null,
    drops: [],
    ties: [],
    unresolved: [],
    coarse: [],
    cost: { sets: 3, near: 0, groups: 1, algebra: 0, class: "medium" },
    funnel: [],
    by: "set",
    next: issues.map((i) => (i as { next: string }).next),
  },
  document: null,
  hash: null,
});
/** Three keys of one group the set does not have: the validator lists all three in one answer. */
const KEYS = ["subject_id", "session_id", "station"].map((k, i) => ({
  code: "unknown_field",
  path: `sets.by_scanner.group.by[${i}]`,
  message: `${k} is not a field of stack, a binding, a partner or an ancestor of t1`,
  next: "GET /api/ask/options for what this set exposes",
}));
/** A key the validator passed and the compiler refused: one issue, though two keys of the list are wrong. */
const COMPILER = {
  code: "not_compilable",
  path: "sets.per.group.by[0]",
  message: "cohort.id is not projected in this layer",
  next: "change the document as the message says; validate compiles what run would",
};
const ATTACHED = {
  code: "not_functional",
  path: "sets.good.attach[0].set",
  message: "t1 may hold several rows per session; attach takes one",
  next: "give t1 a pick: {per: session, by: [...]}",
};
const stage = (set: string, grain: string, name: string, rows: number, subjects: number) => ({
  set,
  grain,
  stage: name,
  rows,
  subjects,
  on_path: grain !== "stack",
});
/** The funnel of a question that keeps 3 sessions until one condition leaves none, as the registry counts it. */
const EMPTIED = {
  valid: true,
  issues: [],
  repairs: [],
  warnings: [],
  zero_rows:
    "no session of good survives where t1.station_name = flair.station_name; everything after it is empty",
  drops: [],
  ties: [
    ["flair", 0],
    ["t1", 0],
  ],
  unresolved: [],
  coarse: [],
  cost: { sets: 7, near: 0, groups: 0, algebra: 0, class: "medium" },
  funnel: [
    stage("scope", "cohort", "source", 1, 40),
    stage("scope", "cohort", "where name = ms-cohort-a", 1, 40),
    stage("people", "subject", "source", 40, 40),
    stage("visits", "session", "source", 96, 40),
    stage("flair", "stack", "source", 1350, 40),
    stage("flair", "stack", "where base = T2w", 620, 38),
    stage("flair", "stack", "where modifier has FLAIR", 120, 31),
    stage("flair", "stack", "where acquisition_type = 3D", 110, 30),
    stage("flair", "stack", "where voxel at third slice_thickness <= 1.2", 64, 28),
    stage("flair", "stack", "pick", 52, 28),
    stage("t1", "stack", "source", 1350, 40),
    stage("t1", "stack", "where base = T1w", 560, 40),
    stage("t1", "stack", "where acquisition_type = 3D", 240, 36),
    stage("t1", "stack", "where voxel at third slice_thickness <= 1.2", 110, 33),
    stage("t1", "stack", "pick", 71, 33),
    stage("good", "session", "source", 96, 40),
    stage("good", "session", "attach t1", 71, 33),
    stage("good", "session", "attach flair", 47, 26),
    stage("good", "session", "where t1.station_name = flair.station_name", 0, 0),
    stage("answer", "subject", "source", 40, 40),
    stage("answer", "subject", "has good", 0, 0),
    stage("answer", "subject", "where alike.largest >= 2", 0, 0),
  ],
  by: "set",
  next: ["POST /api/ask/options on the set named, for a move that widens it"],
};

const engine = await stubEngine((c) => {
  const p = c.path.split("?")[0];
  const body = (c.body ?? {}) as { text?: string; document_id?: number };
  const text = body.text ?? "";
  if (p === "/api/capabilities") return { body: { auth: "off", detail: "sensitive" } };
  if (p === "/api/ask/draft") {
    if (text.includes("three-keys")) return { body: refused(KEYS) };
    if (text.includes("compiler-stops")) return { body: refused([COMPILER]) };
    if (text.includes("attach-many"))
      return {
        body: {
          ...refused([ATTACHED]),
          repairs: [{ path: "sets.good.attach", what: "wrapped a lone relation in a list" }],
        },
      };
    // the same refusal as the registry gives it at a door that answers 400: the issues beside the error
    if (text.includes("refused-with-400"))
      return {
        status: 400,
        body: { error: "the document is refused", disclosure: "safe", issues: KEYS.slice(0, 2), next: [] },
      };
    if (text.includes("keeps-none"))
      return { body: { document: 51, hash: "h", diagnosis: EMPTIED, repairs: [] } };
    return { body: { document: 50, hash: "h", diagnosis: { ...EMPTIED, zero_rows: null }, repairs: [] } };
  }
  if (p === "/api/ask/preview")
    return {
      body: {
        level: "count",
        columns: ["rows", "subjects"],
        rows: [body.document_id === 51 || body.document_id === 52 ? [0, 0] : [12, 9]],
      },
    };
  if (p === "/api/ask/diagnose")
    return { body: body.document_id === 52 ? EMPTIED : { ...EMPTIED, zero_rows: null } };
  return null;
});
afterAll(() => engine.close());
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

type Output = Record<string, unknown>;
async function run(tool: keyof typeof TOOLS, args: Record<string, unknown>, id: string): Promise<Output> {
  const r = await TOOLS[tool].run(args, {
    conversation: id,
    subject: "anna@lab",
    toolCallId: `call-${Math.random().toString(36).slice(2, 8)}`,
    turn: newTurn(id, "how many?"),
    convo: conversationOf(id),
    mounted: { tools: [], skills: [], detail: "sensitive" },
    write: {
      progress: () => {},
      approval: () => {},
      clarification: () => {},
      plan: () => {},
      memory: () => {},
      chart: () => {},
      file: () => {},
    },
  } as never);
  return r.output as Output;
}

describe("a refused draft tells every issue at once", () => {
  it("lists each issue the registry found with its path, and says to mend them all in one draft", async () => {
    const out = await run("query_draft", { text: "name: three-keys\n" }, "refusal-three");
    expect(out).toEqual({
      refused: true,
      why: "the draft did not validate: 3 issues, every one listed",
      next: "Fix all 3 issues in one draft, each at its path: the registry listed every issue it found, so one draft mends them all. 3 of them are the same mistake (unknown_field) at 3 places: correct it at each. A group's key is a field or a binding of the set the group is `of`, an attached row's as `<as>.<field>`, or a parent's field named through the parent (`subject.id`, `subject.code`, `session.id`, `session.first`); `cohort.id` is there only when that set is drawn `of` a cohort set, never `from` another set; and a group of a group names the inner group's keys and aggregates as they are written there. Draft the whole document again.",
      issues: KEYS.map(({ code, path, message }) => ({ code, path, message })),
    });
    // nothing of the registry's doors, which the model cannot call, and none of the empty diagnosis around the issues
    expect(JSON.stringify(out)).not.toMatch(/\/api\/|funnel|"cost"/u);
  });

  it("reads the issues beside the error of a refusal answered 400 too", async () => {
    const out = await run("query_draft", { text: "name: refused-with-400\n" }, "refusal-400");
    expect(out.why).toBe("the draft did not validate: 2 issues, every one listed");
    expect((out.issues as unknown[]).length).toBe(2);
    expect(String(out.next)).toMatch(/^Fix all 2 issues in one draft/u);
  });

  it("keeps one issue as it was told, with the registry's own hint and the repairs it made", async () => {
    const out = await run("query_draft", { text: "name: attach-many\n" }, "refusal-one");
    expect(out).toEqual({
      refused: true,
      why: "the draft did not validate",
      next: "Fix exactly the path and issue named, and draft the whole document again.",
      issues: [
        {
          code: "not_functional",
          path: "sets.good.attach[0].set",
          message: "t1 may hold several rows per session; attach takes one",
          fix: "give t1 a pick: {per: session, by: [...]}",
        },
      ],
      repairs: [{ path: "sets.good.attach", what: "wrapped a lone relation in a list" }],
    });
  });

  it("says of a compiler's fault that it is only the first, and what to check beside it", async () => {
    const out = await run("query_draft", { text: "name: compiler-stops\n" }, "refusal-compiler");
    expect(out.why).toBe("the draft did not validate");
    expect(out.next).toBe(
      "The registry names only the first fault of the kind not_compilable and stops there: before you draft again, check every other item of the same list (sets.per.group.by) for the same mistake and correct them together. A group's key is a field or a binding of the set the group is `of`, an attached row's as `<as>.<field>`, or a parent's field named through the parent (`subject.id`, `subject.code`, `session.id`, `session.first`); `cohort.id` is there only when that set is drawn `of` a cohort set, never `from` another set; and a group of a group names the inner group's keys and aggregates as they are written there. Draft the whole document again.",
    );
    // a compiler's fault that is no item of a list
    expect(
      issuesNext([
        { code: "not_compilable", path: "sets.visits.bind.age", message: "a bucket needs its unit" },
      ]),
    ).toBe(
      "The registry names only the first fault of the kind not_compilable and stops there: before you draft again, check the rest of the same set for the same mistake and correct them together. Draft the whole document again.",
    );
  });

  it("reads no issue from an answer that lists none, and keeps the hint for a sorting value as a column", () => {
    expect(
      issuesOf({ kind: "ok", status: 200, body: { document: 3, diagnosis: { valid: true, issues: [] } } }),
    ).toEqual([]);
    expect(issuesOf({ kind: "refused", status: 400, body: { error: "the ask will not parse: x" } })).toEqual(
      [],
    );
    expect(issuesOf({ kind: "error", reason: "the engine did not answer" })).toEqual([]);
    const axis = {
      code: "unknown_field",
      path: "out.columns[1]",
      message: "an axis is read through has or =, which compile it as a predicate, or as a group's by",
    };
    expect(issuesNext([axis])).toMatch(
      /^A sorting value \(an axis\) is never a column of a record\..* Draft the whole document again\.$/u,
    );
    expect(issuesNext([axis, KEYS[0]])).toMatch(
      /^A sorting value .* Fix all 2 issues in one draft, .* Draft the whole document again\.$/u,
    );
  });

  it("does not raise the turn's work", () => {
    expect(TURN_BUDGET).toEqual({
      turns: 12,
      tool_calls: 24,
      wall_clock_seconds: 600,
      input_tokens: 400_000,
    });
  });
});

describe("an answer of no rows names the step that kept none", () => {
  const step = {
    set: "good",
    step: "where t1.station_name = flair.station_name",
    reached_it: { rows: 47, subjects: 26 },
    passed_it: 0,
    registry:
      "no session of good survives where t1.station_name = flair.station_name; everything after it is empty",
    next: "The answer has no rows because of this one step. When the person's words ask for that condition as it is written, none is the answer: say which condition left none, and how many reached it. When they do not (a name or a value spelled otherwise, a field read on the wrong set, a value missing on both sides of an `=`, which never compares as equal), change that step and no other, and draft again.",
  };

  it("says it in the draft's answer, beside the funnel, so the step is not left to be found among 22 stages", async () => {
    const out = await run("query_draft", { text: "name: keeps-none\n" }, "emptied-draft");
    expect(out.document).toBe(51);
    expect(out.emptied).toEqual(step);
    expect(out.preview).toMatchObject({ registry_data: { level: "count", rows: [[0, 0]] } });
  });

  it("still names the step when a longer funnel is cut short for the model", () => {
    // a third kind of stack per session: the diagnosis no longer fits what the model reads of it
    const longer = {
      ...EMPTIED,
      funnel: [
        ...EMPTIED.funnel.slice(0, 15),
        stage("swi", "stack", "source", 1350, 40),
        stage("swi", "stack", "where base = SWI", 90, 30),
        stage("swi", "stack", "where acquisition_type = 3D", 80, 29),
        stage("swi", "stack", "where voxel at third slice_thickness <= 1.2", 61, 27),
        stage("swi", "stack", "pick", 50, 27),
        ...EMPTIED.funnel.slice(15),
      ],
    };
    const read = JSON.stringify(shorten(longer as never, 3000));
    expect(read).toMatch(/more items/u);
    expect(read).not.toContain('"stage":"where t1.station_name = flair.station_name"');
    expect(emptiedOf(longer)).toEqual(step);
  });

  it("says it for a stored question tried again, and nothing for an answer with rows", async () => {
    const tried = await run("query_run_readonly", { what: "document", document: 52 }, "emptied-run");
    expect(tried.emptied).toEqual(step);
    const some = await run("query_draft", { text: "name: answers\n" }, "emptied-none");
    expect(some.document).toBe(50);
    expect(some.emptied).toBeUndefined();
    expect(
      (await run("query_run_readonly", { what: "document", document: 50 }, "emptied-run-none")).emptied,
    ).toBeUndefined();
  });

  it("reads a set that was empty from its source, a count held back, and a diagnosis with no funnel", () => {
    expect(
      emptiedOf({
        zero_rows: "no stack of scans survives source; everything after it is empty",
        funnel: [stage("visits", "session", "source", 9, 7), stage("scans", "stack", "source", 0, 0)],
      }),
    ).toMatchObject({
      set: "scans",
      step: "source",
      reached_it: "nothing: the set was empty from its source",
    });
    const held = emptiedOf({
      zero_rows: "no session of good survives where age > 90; everything after it is empty",
      funnel: [
        { ...stage("good", "session", "source", 0, 0), rows: null, subjects: null },
        stage("good", "session", "where age > 90", 0, 0),
      ],
    });
    expect(JSON.stringify(held?.reached_it)).toMatch(/held back/u);
    expect(emptiedOf({ zero_rows: "answer answers with no rows", funnel: [] })).toEqual({
      registry: "answer answers with no rows",
      next: step.next,
    });
    expect(emptiedOf({ zero_rows: null, funnel: EMPTIED.funnel })).toBeNull();
    expect(emptiedOf(null)).toBeNull();
  });
});
