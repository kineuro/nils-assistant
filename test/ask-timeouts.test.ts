// SPDX-License-Identifier: AGPL-3.0-only
// A valid question too slow for the chat (2026-11-13). A person asked for a
// count the registry could not compute inside the chat's time limit; the
// question the chat wrote was right, and two turns gave them no answer and
// no way to one. What went wrong, each held here:
// - the one well-formed job plan met a store that could not be opened (its
//   file's place is held in test/stores.test.ts), and its plan stayed behind
//   where a confirm could queue it;
// - the registry's timeout was told to the model as "the draft did not
//   validate", so it rewrote a valid question until the turn's work was
//   spent, and a preview that timed out was told as a preview of nothing;
// - the plan tool refused its steps for their form (a list sent as text)
//   and for verbs the model had to guess;
// - registry_describe refused `fields` with nothing to go on, and a turn
//   that ended at its guards was told nothing of the question it had stored.
// The live test of the same day added one: a draft whose stage counts alone
// ran past the draft's short time was told as a slow question and sent to a
// job, though the question answers in three seconds. Only the answer's own
// timeout makes a question slow.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { init } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "ask-timeouts-"));
process.env.ASSISTANT_LEDGER = join(dir, "seam.sqlite");
process.env.ASSISTANT_LINEAGE = join(dir, "lineage.sqlite");
process.env.ASSISTANT_NOTES = join(dir, "notes.sqlite");
process.env.ASSISTANT_LADDER = join(dir, "ladder.sqlite");

const { stubEngine } = await import("./child/stub-engine.ts");
const { scriptedProvider } = await import("./child/loop-provider.ts");
const { LadderStore } = await import("../src/host/ladder-store.ts");
const { VERBS } = await import("../src/host/ladder.ts");
const { probeEngineAuth, registerStation } = await import("../src/seam/for.ts");
const { loadManifests } = await import("../src/stations/manifest.ts");
const { useLadderStore } = await import("../src/stations/operator.ts");
const { ChangeStore, theChanges, useChangeStore } = await import("../src/one/changes.ts");
const { oneAgent } = await import("../src/one/agent.ts");
const { slowComplaint } = await import("../src/one/checks.ts");
const { loadSkills } = await import("../src/one/skills.ts");
const { conversationOf, newTurn, stopNext, storedWords, turnOf } = await import("../src/one/state.ts");
const { countsCut, stepsOf, timeoutOf, TOOLS } = await import("../src/one/tools.ts");

/** The words the registry's doors answer a statement stopped at the limit with, today. */
/** What an answer says when its question's steps were not counted. */
const UNCHECKED =
  "The steps could not be counted in the time, so this is the question's own count, unchecked step by step.";
const RAN_PAST = "the statement ran past 20000 ms; POST /api/ask/jobs runs it unbounded";
const DIAGNOSIS = {
  valid: true,
  issues: [],
  cost: { sets: 6, class: "medium" },
  funnel: [{ set: "scans", grain: "stack", stage: "source", rows: 900, subjects: 40 }],
};

/** The diagnosis of a draft whose counts ran past the draft's own time, as the registry answers it with a 200. */
const CUT = {
  valid: true,
  issues: [],
  cost: { sets: 7, class: "medium" },
  funnel: [{ set: "visits", grain: "session", stage: "source", rows: 900, subjects: 40 }],
  drops: [],
  next: ["POST /api/ask/jobs with document_id 34 runs it as a job, under a job's time"],
  unavailable: {
    code: "timeout",
    parts: ["funnel", "drops", "ties", "coarse"],
    budget_ms: 5000,
    why: "the counts ran past 5000 ms and were stopped; the document is valid, and a job runs it under a job's time",
  },
};
/** The registry's 504 of a statement stopped at a door's limit, with the stored document's id. */
const stoppedAt = (document: number) => ({
  status: 504,
  body: {
    error:
      "the statement ran past 20000 ms and was stopped; POST /api/ask/jobs runs it as a job, under a job's time",
    disclosure: "safe",
    code: "timeout",
    limit_ms: 20000,
    document_id: document,
  },
});

const engine = await stubEngine((c) => {
  const p = c.path.split("?")[0];
  const body = (c.body ?? {}) as { text?: string; document_id?: number };
  const text = body.text ?? "";
  if (p === "/api/capabilities")
    return {
      body: {
        auth: "off",
        detail: "sensitive",
        policy: [
          {
            door: "POST /api/ask/jobs",
            grant: "query:work",
            writes: true,
            idempotent: true,
            cost: "job",
          },
        ],
      },
    };
  if (p === "/api/ask/catalog")
    return {
      body: {
        epoch: 1,
        pack: { name: "mri", version: "1.0.0" },
        levels: [
          { level: "subject", fields: [{ path: "code", type: "text", class: "plain" }] },
          { level: "stack", fields: [{ path: "station_name", type: "text", class: "plain" }] },
        ],
        axes: [],
        kinds: [],
        cohorts: [{ name: "cohort-a", members: 40 }],
      },
    };
  if (p === "/api/ask/guide") return { body: { grounding: [] } };
  if (p === "/api/ask/validate") return { body: { valid: true, issues: [] } };
  if (p === "/api/sources") return { body: { count: 0, sources: [] } };
  if (p === "/api/cohorts") return { body: [] };
  if (p === "/api/ask/draft") {
    // today: the draft's own counting ran past the limit, and nothing was stored
    if (text.includes("stops-the-draft")) return { status: 504, body: { error: RAN_PAST } };
    // today: the draft held, and the preview after it ran past the limit
    if (text.includes("stops-the-preview"))
      return { body: { document: 31, hash: "h", diagnosis: DIAGNOSIS, repairs: [] } };
    // a valid document whose stage counts ran past the draft's time: stored and answered 200, the counts marked
    // as cut. Its answer comes inside the door's limit for one (34) and runs past it for the other (32)
    if (text.includes("cut-and-answers"))
      return { body: { document: 34, hash: "h", diagnosis: CUT, repairs: [] } };
    if (text.includes("stored-and-slow"))
      return {
        body: { document: 32, hash: "h", diagnosis: { ...CUT, cost: { class: "large" } }, repairs: [] },
      };
    // a document that does not validate is answered 200 with no document, its issues in the diagnosis
    if (text.includes("names-a-wrong-field"))
      return {
        body: {
          document: null,
          hash: null,
          repairs: [],
          diagnosis: {
            valid: false,
            issues: [{ code: "unknown_field", path: "sets.scans.where[0]", message: "no field colour" }],
          },
        },
      };
    if (text.includes("will-not-parse"))
      return { status: 400, body: { error: "the ask will not parse: line 3 column 5: misplaced bracket" } };
    if (text.includes("attach-as-a-name"))
      return {
        status: 400,
        body: { error: 'the ask will not parse: invalid type: string "t1", expected struct Attach' },
      };
    if (text.includes("meets-a-fault")) return { status: 500, body: { error: "the pool is closed" } };
    return { body: { document: 30, hash: "h", diagnosis: DIAGNOSIS, repairs: [] } };
  }
  if (p === "/api/ask/preview") {
    if (body.document_id === 31) return { status: 504, body: { error: RAN_PAST } };
    // a machine-readable code and the document's id
    if (body.document_id === 32 || body.document_id === 33) return stoppedAt(body.document_id);
    return { body: { level: "count", columns: ["n_subjects"], rows: [[12]] } };
  }
  if (p === "/api/ask/diagnose") {
    // the diagnose door's own counts ran past its limit: said in a 200 by this registry, with a 504 by one before it
    if (body.document_id === 36) return { body: CUT };
    if (body.document_id === 37) return { status: 504, body: { error: RAN_PAST } };
    return { body: DIAGNOSIS };
  }
  if (p === "/api/ask/run") return { status: 504, body: { error: RAN_PAST, code: "timeout" } };
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
const changesFile = join(dir, "changes.sqlite");
useChangeStore(() => new ChangeStore(changesFile));
const ladder = new LadderStore(join(dir, "ladder.sqlite"));
useLadderStore(() => ladder);

const writers = {
  progress: () => {},
  approval: () => {},
  clarification: () => {},
  plan: () => {},
  memory: () => {},
  chart: () => {},
  file: () => {},
};
type Output = Record<string, unknown>;
/** One tool run as the agent runs it, in a turn of its own unless `keep` goes on with the conversation's. */
async function run(
  tool: keyof typeof TOOLS,
  args: Record<string, unknown>,
  id: string,
  keep = false,
): Promise<Output> {
  const turn = keep ? turnOf(id) : newTurn(id, "how many?");
  const r = await TOOLS[tool].run(args, {
    conversation: id,
    subject: "anna@lab",
    toolCallId: `call-${Math.random().toString(36).slice(2, 8)}`,
    turn,
    convo: conversationOf(id),
    mounted: { tools: [], skills: [], detail: "sensitive" },
    write: writers,
  } as never);
  return r.output as Output;
}
const dialled = (path: string) => engine.seen.filter((x) => x.path.split("?")[0] === path).length;

describe("a timeout is its own outcome, never a draft that did not validate", () => {
  it("reads the registry's three ways of saying it, and nothing else as one", () => {
    expect(timeoutOf({ kind: "refused", status: 504, body: { error: RAN_PAST } })).toEqual({
      document: null,
    });
    expect(
      timeoutOf({ kind: "refused", status: 504, body: { error: "x", code: "timeout", document: 7 } }),
    ).toEqual({ document: 7 });
    expect(timeoutOf({ kind: "refused", status: 408, body: { code: "timeout", document_id: 8 } })).toEqual({
      document: 8,
    });
    // a draft whose stage counts were cut is no timeout of the question: its answer is still to be asked for
    expect(timeoutOf({ kind: "ok", status: 200, body: { document: 9, diagnosis: CUT } })).toBeNull();
    expect(
      timeoutOf({
        kind: "ok",
        status: 200,
        body: { document: 9, valid: true, diagnosis: { valid: true, funnel: { unavailable: "timeout" } } },
      }),
    ).toBeNull();
    expect(countsCut(CUT)).toEqual({ parts: ["funnel", "drops", "ties", "coarse"], budget_ms: 5000 });
    expect(countsCut({ valid: true, funnel: { unavailable: "timeout" } })).toEqual({
      parts: ["funnel"],
      budget_ms: null,
    });
    expect(countsCut(DIAGNOSIS)).toBeNull();
    expect(countsCut(null)).toBeNull();
    expect(
      timeoutOf({ kind: "ok", status: 200, body: { document: 9, preview: { unavailable: "timeout" } } }),
    ).toEqual({ document: 9 });
    expect(timeoutOf({ kind: "ok", status: 200, body: { document: 9, diagnosis: DIAGNOSIS } })).toBeNull();
    expect(
      timeoutOf({ kind: "refused", status: 400, body: { error: "the document is refused" } }),
    ).toBeNull();
    expect(timeoutOf({ kind: "refused", status: 500, body: { error: "the pool is closed" } })).toBeNull();
    expect(timeoutOf({ kind: "error", reason: "the engine did not answer" })).toBeNull();
  });

  it("says a draft the registry stopped before storing it is not stored, and never to rewrite it", async () => {
    const before = dialled("/api/ask/draft");
    const out = await run("query_draft", { text: "name: stops-the-draft\n" }, "slow-old");
    expect(out).toEqual({
      refused: true,
      stored: false,
      slow: true,
      why: "checking the question ran past the chat's time limit before the registry stored it, so there is no document and no count; no fault was found in the document",
      next: "Do not send this document again, and do not rewrite it: no path or issue was named. Tell the person in plain words that the question takes too long to check in the chat, so it is not stored and no job was started; offer one narrower question (one dataset or cohort, fewer conditions) if that would still help them.",
    });
    expect(JSON.stringify(out)).not.toMatch(/did not validate|Fix exactly/u);
    // the same document sent again waits out no second limit: it is answered as before, and the registry is not asked
    const again = await run("query_draft", { text: "name: stops-the-draft\n" }, "slow-old", true);
    expect(again).toEqual(out);
    expect(dialled("/api/ask/draft")).toBe(before + 1);
    expect(turnOf("slow-old").drafted).toEqual([]);
  });

  it("keeps the document's id where the draft held and its count ran past the limit", async () => {
    const out = await run("query_draft", { text: "name: stops-the-preview\n" }, "slow-preview");
    expect(out).toEqual({
      document: 31,
      valid: true,
      slow: true,
      why: "the question is valid and stored as document 31; counting it ran past the chat's time limit, so there is no count and no row yet, and nothing is wrong with the document",
      diagnosis: DIAGNOSIS,
      repairs: [],
      preview: { unavailable: "timeout" },
      next: 'Do not draft it again, and do not try smaller questions to probe it. Raise a job plan for it now: propose_change with kind job_plan, a sentence, and steps [{"verb": "run", "args": {"document": 31}}]. Then tell the person in plain words that the question is stored as document 31, that it takes too long to count in the chat, and that it runs as a job once they approve the card.',
    });
    const turn = turnOf("slow-preview");
    expect(turn.drafted).toEqual([31]);
    expect(turn.slow).toEqual([{ document: 31, text: "name: stops-the-preview\n" }]);
  });

  it("runs a question whose stage counts alone were cut, and gives its answer with a plain note and no job", async () => {
    // the live test of 2026-11-13: the draft's funnel ran out of the draft's 5 s, the question answers in 3 s,
    // and the tool said `slow` without ever asking for the count
    const before = dialled("/api/ask/preview");
    const out = await run("query_draft", { text: "name: cut-and-answers\n" }, "cut-answers");
    expect(dialled("/api/ask/preview")).toBe(before + 1);
    // the preview is asked with no time of its own, which is the door's whole limit
    const asked = engine.seen.filter((x) => x.path === "/api/ask/preview").at(-1)?.body;
    expect(asked).toEqual({ document_id: 34, rows: 10 });
    expect(out).toEqual({
      document: 34,
      diagnosis: {
        valid: true,
        issues: [],
        cost: { sets: 7, class: "medium" },
        funnel: CUT.funnel,
        drops: [],
        // the registry's pointer to the job path is not told beside an answer that came
        next: [],
        unavailable: { code: "timeout", parts: ["funnel", "drops", "ties", "coarse"], budget_ms: 5000 },
      },
      stage_counts:
        "The stage counts are not all there: counting the question stage by stage ran past their time limit (5000 ms), so of the diagnosis these parts are cut short or left out: funnel, drops, ties, coarse. The preview is the question's whole answer, counted with the full time: answer from it, and say in the answer that the steps could not be counted in the time, so the number is the question's own count, unchecked step by step. This is no slow question: propose no job for it, and do not draft it again for the stage counts.",
      preview: { registry_data: { level: "count", columns: ["n_subjects"], rows: [[12]], truncated: false } },
      repairs: [],
    });
    expect(JSON.stringify(out)).not.toMatch(/"slow"|job_plan|api\/ask\/jobs|did not validate/u);
    const turn = turnOf("cut-answers");
    expect(turn.drafted).toEqual([34]);
    // nothing of the turn calls it slow: no check sends it back for a plan, and a stop offers no job
    expect(turn.slow).toEqual([]);
    expect(slowComplaint(turn, "There are 12 subjects (document 34).")).toBeNull();
    expect(stopNext(turn)).not.toMatch(/too long|as a job/u);
  });

  it("calls a question slow only when its own count ran past the door's limit, after the cut counts", async () => {
    const before = dialled("/api/ask/preview");
    const out = await run("query_draft", { text: "name: stored-and-slow\n" }, "slow-new");
    // the count was asked for, and that run itself timed out (504 with the code)
    expect(dialled("/api/ask/preview")).toBe(before + 1);
    expect(out).toMatchObject({
      document: 32,
      valid: true,
      slow: true,
      preview: { unavailable: "timeout" },
      diagnosis: { valid: true, cost: { class: "large" }, unavailable: { code: "timeout" } },
    });
    expect(String(out.why)).toMatch(/^the question is valid and stored as document 32;/u);
    expect(String(out.next)).toContain('steps [{"verb": "run", "args": {"document": 32}}]');
    expect(out.refused).toBeUndefined();
    expect(out.stage_counts).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/did not validate/u);
    expect(turnOf("slow-new").slow).toEqual([{ document: 32, text: "name: stored-and-slow\n" }]);
  });

  it("gives a stored question's answer when only its diagnosis ran past the limit", async () => {
    // the diagnose door says its cut counts in a 200 (36), or with a 504 on a registry before that (37)
    for (const document of [36, 37]) {
      const tried = await run("query_run_readonly", { what: "document", document }, `cut-run-${document}`);
      expect(tried.slow).toBeUndefined();
      expect(tried.preview).toEqual({
        registry_data: { level: "count", columns: ["n_subjects"], rows: [[12]], truncated: false },
      });
      expect(String(tried.stage_counts)).toMatch(/^The stage counts are not all there: /u);
      expect(String(tried.stage_counts)).toMatch(/This is no slow question: propose no job for it/u);
      expect(JSON.stringify(tried)).not.toMatch(/api\/ask\/jobs/u);
      expect(turnOf(`cut-run-${document}`).slow).toEqual([]);
    }
  });

  it("tells a stored question's run and its rows the same true thing, with the id", async () => {
    // the diagnosis held and the preview timed out: once answered `preview: null`, beside nothing that said why
    const tried = await run("query_run_readonly", { what: "document", document: 33 }, "slow-run");
    expect(tried).toMatchObject({
      document: 33,
      valid: true,
      slow: true,
      diagnosis: DIAGNOSIS,
      preview: { unavailable: "timeout" },
    });
    expect(String(tried.why)).toMatch(/stored as document 33; counting it ran past the chat's time limit/u);
    expect(String(tried.next)).toContain('[{"verb": "run", "args": {"document": 33}}]');
    const rows = await run("query_read_rows", { document: 33 }, "slow-rows");
    expect(rows).toMatchObject({ document: 33, slow: true, preview: { unavailable: "timeout" } });
    expect(JSON.stringify(rows)).not.toMatch(/Check the document's id/u);
  });

  it("still names the path and the issue of a draft that does not validate, and no fault of the registry's as one", async () => {
    const refused = await run("query_draft", { text: "name: names-a-wrong-field\n" }, "slow-invalid");
    expect(refused.why).toBe("the draft did not validate");
    expect(refused.next).toBe("Fix exactly the path and issue named, and draft the whole document again.");
    expect(JSON.stringify(refused.issues)).toMatch(/sets\.scans\.where\[0\]/u);
    const unparsed = await run("query_draft", { text: "name: will-not-parse\n" }, "slow-unparsed");
    expect(unparsed.why).toBe("the draft did not validate");
    expect(JSON.stringify(unparsed.issues)).toMatch(/line 3 column 5: misplaced bracket/u);
    // a draft that does not parse names no path: its next step points at what the sentence is about
    expect(unparsed.next).toMatch(/^The YAML itself does not read at the line and column named/u);
    const shape = await run("query_draft", { text: "name: attach-as-a-name\n" }, "slow-shape");
    expect(JSON.stringify(shape.issues)).toMatch(/expected struct Attach/u);
    expect(shape.next).toMatch(
      /^A map with the keys of an item of `attach` was expected .* takes only `as`, `set`, `optional` .*`attach: \[\{as: t1, set: t1\}, \{as: flair, set: flair\}\]`\. Draft the whole document again\.$/u,
    );
    expect(String(shape.next)).not.toMatch(/path and issue named/u);
    const fault = await run("query_draft", { text: "name: meets-a-fault\n" }, "slow-fault");
    expect(fault.refused).toBe(true);
    expect(String(fault.why)).toMatch(/the registry refused it \(500\): the pool is closed/u);
    expect(String(fault.next)).toMatch(/^Do not rewrite the document for this/u);
    expect(JSON.stringify(fault)).not.toMatch(/did not validate/u);
  });
});

describe("the job plan of a stored question", () => {
  const plan = {
    kind: "job_plan",
    sentence: "Run question 31 as a job and count its subjects.",
    instruction: "Run question 31 as a job.",
  };

  it("takes the steps as a list or as the same list in JSON text, and tells the model the plan it made", async () => {
    const asText = await run(
      "propose_change",
      { ...plan, steps: '[{"verb": "run", "args": {"document": 31}}]' },
      "plan-text",
    );
    expect(asText).toMatchObject({
      kind: "job_plan",
      pending: true,
      steps: [{ verb: "run", when: "now", words: "run question 31" }],
      acts_for_a_person: [],
      not_planned: [],
      next: "It waits for the person's approval on the card; nothing has changed yet. Tell them in one or two sentences what it will do, then stop.",
    });
    // the proposal exists in both stores: the change whose card is approved, and the plan it confirms
    const [change] = theChanges().of("plan-text");
    expect(change).toMatchObject({ kind: "job_plan", state: "open", id: asText.id });
    expect(change.payload.plan_id).toBe(asText.plan_id);
    expect(ladder.planById(String(asText.plan_id))).toMatchObject({ state: "proposed" });
    expect(ladder.steps(String(asText.plan_id)).map((s) => [s.verb, s.args])).toEqual([
      ["run", { document: 31 }],
    ]);
    const asList = await run(
      "propose_change",
      { ...plan, steps: [{ verb: "run", args: { document: 31 } }] },
      "plan-list",
    );
    expect(asList.steps).toEqual(asText.steps);
  });

  it("reads the forms a small model gives a list in, and no other text as steps", () => {
    const one = [{ verb: "run", args: { document: 31 } }];
    expect(stepsOf(one)).toEqual(one);
    expect(stepsOf('[{"verb": "run", "args": {"document": 31}}]')).toEqual(one);
    expect(stepsOf('{"steps": [{"verb": "run", "args": {"document": 31}}]}')).toEqual(one);
    expect(stepsOf('{"verb": "run", "args": {"document": 31}}')).toEqual(one);
    // a step's arguments written beside its verb, or as JSON text
    expect(stepsOf([{ verb: "run", document: 31 }])).toEqual(one);
    expect(stepsOf([{ verb: "run", args: '{"document": 31}', when: "now" }])).toEqual([
      { ...one[0], when: "now" },
    ]);
    expect(stepsOf("run question 31")).toBeNull();
    expect(stepsOf(31)).toBeNull();
  });

  it("refuses text that is no list with the shape and one example", async () => {
    const out = await run("propose_change", { ...plan, steps: "run question 31, then report" }, "plan-bad");
    expect(out.refused).toBe(true);
    expect(out.why).toBe("the steps could not be read as a list");
    expect(String(out.next)).toContain('[{"verb": "run", "args": {"document": 12}}]');
    expect(theChanges().of("plan-bad")).toEqual([]);
  });

  it("names the verbs to a step that invents one, and how a stored question runs", async () => {
    const out = await run(
      "propose_change",
      {
        ...plan,
        steps: [
          { verb: "run_question", args: { document: 31 } },
          { verb: "report", args: { what: "the count" } },
        ],
      },
      "plan-verbs",
    );
    expect(out.refused).toBe(true);
    for (const verb of Object.keys(VERBS)) expect(String(out.why)).toContain(verb);
    expect(String(out.why)).toMatch(/no verb named run_question/u);
    expect(out.next).toBe(
      'Use only the verbs listed; reading or reporting a result is no step. A stored question runs as a job with steps [{"verb": "run", "args": {"document": <its id>}}]. Correct the steps and propose once more, or say why it cannot be planned.',
    );
  });

  it("lists the verbs in the schema, with the one example in the tool's words", () => {
    const steps = (
      TOOLS.propose_change.input as unknown as {
        entries: {
          steps: {
            wrapped: {
              options: [
                { item: { entries: { verb: { options: [{ options: string[] }, unknown] } } } },
                unknown,
              ];
            };
          };
        };
      }
    ).entries.steps.wrapped.options;
    expect(steps[0].item.entries.verb.options[0].options).toEqual(Object.keys(VERBS));
    expect(TOOLS.propose_change.description).toContain(
      'runs as a job with steps [{"verb": "run", "args": {"document": 12}}]',
    );
    // the skills say when: a valid question the chat cannot count in time
    const skills = loadSkills(["./stations"], ["find-data", "plan-work"]);
    expect(skills.get("find-data")?.body).toMatch(
      /\*\*Too slow\*\* \(the answer says `slow`\): the question is right and stored/u,
    );
    expect(skills.get("find-data")?.body).toMatch(
      /`kind: job_plan`, `steps: \[\{verb: run, args: \{document: <its number>\}\}\]`/u,
    );
    expect(skills.get("plan-work")?.body).toMatch(/too slow for the chat gets its answer/u);
  });

  it("leaves no plan behind when the change cannot be kept, and says nothing was proposed", async () => {
    // the changes' store as an install once had it: a file in a folder that cannot be made
    const file = join(dir, "another-file");
    writeFileSync(file, "x");
    useChangeStore(() => new ChangeStore(join(file, "changes.sqlite")));
    const before = ladder.plans("anna@lab").length;
    try {
      const out = await run(
        "propose_change",
        { ...plan, steps: [{ verb: "run", args: { document: 31 } }] },
        "plan-no-store",
      );
      expect(out).toEqual({
        refused: true,
        why: "the proposal could not be kept, a fault of the assistant's own store and not of what you proposed; nothing was proposed and nothing was started",
        next: "Do not try again in this message. Tell the person in plain words that the proposal could not be made because of a fault in the assistant, that nothing was started, and that an administrator has to look at the assistant before it can be proposed again.",
      });
      // no plan stays where the person's inbox would list it and a confirm would queue it
      expect(ladder.plans("anna@lab").length).toBe(before);
      expect(ladder.plans("anna@lab").some((p) => p.conversation === "plan-no-store")).toBe(false);
      expect(turnOf("plan-no-store").proposed).toEqual([]);
    } finally {
      useChangeStore(() => new ChangeStore(changesFile));
    }
  });
});

describe("registry_describe answers the fields", () => {
  it("gives one level's fields, as the summary's part does, and names the levels to one it does not know", async () => {
    const summary = await run("registry_summary", { part: "fields", level: "stack" }, "fields-a");
    const described = await run("registry_describe", { what: "fields", level: "stack" }, "fields-b");
    expect(described).toEqual(summary);
    expect(JSON.stringify(described)).toMatch(/- stack: station_name \(text\)/u);
    const unknown = await run("registry_describe", { what: "fields", level: "series" }, "fields-c");
    expect(unknown.refused).toBe(true);
    expect(String(unknown.next)).toMatch(/Name one of subject, stack/u);
  });
});

describe("what a turn that must answer now says of what it stored", () => {
  it("names the stored, slow question and offers its job, and never that nothing was stored", () => {
    const t = newTurn("stop-slow", "how many?");
    expect(stopNext(t)).toBe(
      "Stop calling tools. Answer the person now, in plain words, with what you have; say what is missing.",
    );
    t.drafted.push(31);
    t.slow.push({ document: 31, text: "x" });
    expect(stopNext(t)).toBe(
      "Stop calling tools. Answer the person now, in plain words, with what you have; say what is missing. The question is stored as document 31 and is valid; it takes too long to count in the chat, so there is no count yet and no job has been started. Say so with the document's number, and offer to run it as a job: when they say yes, you raise the job plan in your next message. Never say it was not stored.",
    );
    // once its job plan waits on a card, that is what is said
    t.proposed.push({
      kind: "job_plan",
      id: "chg-1",
      details: { steps: [{ verb: "run", when: "now", words: "run question 31" }] },
    });
    expect(storedWords(t)).toBe(
      "The question is stored as document 31 and is valid; it takes too long to count in the chat, and its job plan waits for the person's approval on the card. Say so with the document's number; never say it was not stored.",
    );
  });

  it("names the last question stored, and says of one the registry never stored that it has no number", () => {
    const t = newTurn("stop-kept", "how many?");
    t.drafted.push(27);
    expect(storedWords(t)).toBe(
      "The last question stored is document 27: name it by its number with what it answered, and never say nothing was stored.",
    );
    t.slow.push({ document: null, text: "x" });
    expect(storedWords(t)).toBe(
      "A question that ran past the chat's time limit was not stored and has no number: say so, and never say it is stored or running. The last question stored is document 27: name it by its number with what it answered, and never say nothing was stored.",
    );
  });

  it("sends back a turn that left a slow question without its plan, or an answer that does not name it", () => {
    const t = newTurn("check-slow", "how many?");
    expect(slowComplaint(t, "There are 12.")).toBeNull();
    t.slow.push({ document: 31, text: "x" });
    expect(slowComplaint(t, "I have no count, and nothing was kept.")).toBe(
      'document 31 is stored and valid, and only too slow to count in the chat: raise its job plan with propose_change, kind job_plan, steps [{"verb": "run", "args": {"document": 31}}], then say it is stored as document 31 and runs as a job once they approve the card',
    );
    // a plan was tried: the answer still names the document
    t.tools.push("propose_change");
    expect(slowComplaint(t, "It is too slow for the chat.")).toBe(
      "the question is stored as document 31: name it by its number, and never say it was not stored",
    );
    expect(slowComplaint(t, "It is stored as document 31 and runs as a job once you approve.")).toBeNull();
    expect(slowComplaint(t, "It is stored as document 310.")).not.toBeNull();
  });
});

// ------------------------------------------------------------------ through the agent, with the framework's own validation

type Step = { tool: string; args: Record<string, unknown> } | { text: string };
let script: Step[] = [];
let seen: Context[] = [];
let calls = 0;
const provider = scriptedProvider("kvasir-nils", (context) => {
  seen.push(structuredClone(context));
  const next = script[Math.min(calls, script.length - 1)];
  calls += 1;
  return next;
});
function play(steps: Step[]): void {
  script = steps;
  seen = [];
  calls = 0;
}
/** What the last tool call gave, as the model read it in its next request. */
function lastResult(c: Context): string {
  const m = c.messages.filter((x) => x.role === "toolResult").at(-1) as { content?: { text?: string }[] };
  return m?.content?.[0]?.text ?? "";
}

const Nils = oneAgent({ model: "m", arm: "skill", stationDirs: ["./stations"] });
let flue: Awaited<ReturnType<typeof start>>;
beforeAll(async () => {
  flue = await start({ agents: [Nils], db: sqlite(join(dir, "flue.sqlite")), providers: [provider] });
});
afterAll(async () => {
  await flue.stop();
  engine.close();
});

describe("the one agent with a question too slow for the chat", () => {
  it("is told the document is stored and slow, raises its job plan from steps sent as text, and answers with its number", async () => {
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "query_draft", args: { text: "ast_version: 1\nname: stops-the-preview\n" } },
      {
        tool: "propose_change",
        args: {
          kind: "job_plan",
          sentence: "Run the stored question as a job and count its subjects.",
          instruction: "Run question 31 as a job.",
          // the list as JSON text: the tool's validation once refused it with "must be array"
          steps: '[{"verb": "run", "args": {"document": 31}}]',
        },
      },
      {
        text: "The question is stored as document 31. It takes too long to count in the chat, so it runs as a job once you approve the card.",
      },
    ]);
    const h = init(Nils, { id: "oc-slow" });
    const reply = await h.read(await h.dispatch("How many subjects of cohort-a have two visits?"));
    expect(reply.text).toMatch(/stored as document 31/u);
    // the draft's answer, as the model read it
    const drafted = JSON.parse(lastResult(seen[2])) as Output;
    expect(drafted).toMatchObject({ document: 31, valid: true, slow: true });
    expect(String(drafted.next)).toMatch(/^Do not draft it again/u);
    expect(lastResult(seen[2])).not.toMatch(/did not validate/u);
    // the plan's answer: no validation failure for the steps' form, and the plan it made
    expect(lastResult(seen[3])).not.toMatch(/Validation failed/u);
    const planned = JSON.parse(lastResult(seen[3])) as Output;
    expect(planned).toMatchObject({
      kind: "job_plan",
      pending: true,
      steps: [{ verb: "run", when: "now", words: "run question 31" }],
    });
    const kinds = theChanges()
      .of("oc-slow")
      .map((c) => c.kind);
    expect(kinds).toContain("job_plan");
    expect(ladder.planById(String(planned.plan_id))?.state).toBe("proposed");
    expect(calls).toBe(4);
  }, 60_000);

  it("is given the answer of a question whose stage counts alone were cut, and is not sent back for a plan", async () => {
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "query_draft", args: { text: "ast_version: 1\nname: cut-and-answers\n" } },
      { text: `There are 12 subjects (document 34). ${UNCHECKED}` },
    ]);
    const h = init(Nils, { id: "oc-cut" });
    const reply = await h.read(await h.dispatch("How many subjects of cohort-a have two visits?"));
    expect(reply.text).toBe(`There are 12 subjects (document 34). ${UNCHECKED}`);
    const drafted = JSON.parse(lastResult(seen[2])) as Output;
    expect(drafted).toMatchObject({ document: 34, preview: { registry_data: { rows: [[12]] } } });
    expect(drafted.slow).toBeUndefined();
    expect(String(drafted.stage_counts)).toMatch(/This is no slow question: propose no job for it/u);
    // no check sent the turn back; the question is offered as the one the person keeps, and no job is proposed
    expect(calls).toBe(3);
    expect(
      theChanges()
        .of("oc-cut")
        .map((c) => [c.kind, c.payload.document]),
    ).toEqual([["query_version", 34]]);
  }, 60_000);

  it("is sent back once when it gives that answer as flatly as one checked step by step", async () => {
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "query_draft", args: { text: "ast_version: 1\nname: cut-and-answers\n" } },
      { text: "There are 12 subjects (document 34)." },
      { text: `There are 12 subjects (document 34). ${UNCHECKED}` },
    ]);
    const h = init(Nils, { id: "oc-cut-flat" });
    const reply = await h.read(await h.dispatch("How many subjects of cohort-a have two visits?"));
    expect(JSON.stringify(seen[3].messages)).toMatch(
      /the steps of document 34 could not be counted in the time, so nothing checked its number step by step/u,
    );
    expect(reply.text).toMatch(/unchecked step by step\.$/u);
    // once: the answer that says it settles, and no job is proposed for a question that answered
    expect(calls).toBe(4);
    expect(
      theChanges()
        .of("oc-cut-flat")
        .map((c) => c.kind),
    ).toEqual(["query_version"]);
  }, 60_000);

  it("is sent back once when it leaves the slow question without a plan and says it was not stored", async () => {
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "query_draft", args: { text: "ast_version: 1\nname: stops-the-preview\nscheme: default\n" } },
      { text: "I have no count for that, and no question was kept." },
      {
        tool: "propose_change",
        args: {
          kind: "job_plan",
          sentence: "Run the stored question as a job.",
          // the argument beside the verb, not under args: kept by the schema and read as the step's
          steps: [{ verb: "run", document: 31 }],
        },
      },
      { text: "The question is stored as document 31 and runs as a job once you approve the card." },
    ]);
    const h = init(Nils, { id: "oc-slow-back" });
    const reply = await h.read(await h.dispatch("How many subjects of cohort-a have two visits?"));
    expect(JSON.stringify(seen[3].messages)).toMatch(
      /document 31 is stored and valid, and only too slow to count in the chat: raise its job plan/u,
    );
    expect(reply.text).toMatch(/stored as document 31 and runs as a job/u);
    const [plan] = ladder.plans("anonymous").filter((p) => p.conversation === "oc-slow-back");
    expect(ladder.steps(plan?.id ?? "").map((s) => [s.verb, s.args])).toEqual([["run", { document: 31 }]]);
  }, 60_000);

  it("passes the framework's validation with a verb it does not know, and reads fields from registry_describe", async () => {
    play([
      { tool: "registry_describe", args: { what: "fields", level: "stack" } },
      {
        tool: "propose_change",
        args: {
          kind: "job_plan",
          sentence: "Run the stored question as a job.",
          steps: [{ verb: "run_question", args: { document: 31 } }],
        },
      },
      { text: "I could not plan that." },
    ]);
    const h = init(Nils, { id: "oc-verbs" });
    await h.read(await h.dispatch("Run question 31 as a job."));
    expect(lastResult(seen[1])).not.toMatch(/Validation failed/u);
    expect(lastResult(seen[1])).toMatch(/station_name \(text\)/u);
    // the refusal is the plan's own, which names the verbs, not the schema's "must be equal to one of the allowed values"
    expect(lastResult(seen[2])).not.toMatch(/Validation failed/u);
    expect(lastResult(seen[2])).toMatch(/no verb named run_question; the verbs are digest, classify/u);
  }, 60_000);

  it("ends a turn whose work is spent with the stored document's number in the last instruction", async () => {
    play([
      { tool: "query_draft", args: { text: "ast_version: 1\nname: stops-the-preview\nlimit: 1\n" } },
      ...Array.from({ length: 40 }, (_, i) => ({
        tool: "registry_search",
        args: { words: `station name ${i}` },
      })),
    ]);
    const h = init(Nils, { id: "oc-spent" });
    await h.read(await h.dispatch("How many subjects of cohort-a have two visits?"));
    const turn = turnOf("oc-spent");
    expect(turn.stopped).toBe("this turn's work is spent");
    const said = JSON.stringify(seen.at(-1)?.messages ?? []);
    expect(said).toMatch(/The question is stored as document 31 and is valid/u);
    expect(said).toMatch(/offer to run it as a job/u);
    expect(said).toMatch(/Never say it was not stored/u);
  }, 60_000);
});
