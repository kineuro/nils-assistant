// SPDX-License-Identifier: AGPL-3.0-only
// One chat (2026-10-09): the one agent on Flue, a scripted model and a stub
// engine. A find turn activates its skill, drafts a question and leaves it
// offered as a new version; the turn's facts arrive as one message; the
// tools follow the person's grants; the repeat detector warns and stops; an
// answer in engine words is sent back once; a question card ends the turn;
// an analysis is proposed, never run; a dataset the words name is answered
// from its own counts, never said not to be there, and a follow-up keeps it.
// What is true now (2026-10-09): the jobs are read in every state, newest
// first, the queue's own rows left out, and a question about them is no
// question of the data; a dataset the words name comes with which of its
// steps have run, read once a turn, and nothing where the engine has none.
// And (2026-10-10): until body part or post-contrast has run, the facts say
// what the headers answer of it and what is not known yet, never that
// nothing is known.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Context, getCurrentTools } from "@earendil-works/pi-ai";
import { init } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "one-agent-"));
process.env.ASSISTANT_LEDGER = join(dir, "seam.sqlite");
process.env.ASSISTANT_LINEAGE = join(dir, "lineage.sqlite");
process.env.ASSISTANT_NOTES = join(dir, "notes.sqlite");
process.env.ASSISTANT_LADDER = join(dir, "ladder.sqlite");

const { stubEngine } = await import("./child/stub-engine.ts");
const { scriptedProvider } = await import("./child/loop-provider.ts");
const { probeEngineAuth, registerStation, theLedger, theLineage } = await import("../src/seam/for.ts");
const { loadManifests } = await import("../src/stations/manifest.ts");
const { ChangeStore, theChanges, useChangeStore } = await import("../src/one/changes.ts");
const { oneAgent, notePerson } = await import("../src/one/agent.ts");
const { TURN_BUDGET, turnOf } = await import("../src/one/state.ts");

const CATALOG = {
  epoch: 3,
  pack: { name: "mri", version: "1.0.0" },
  levels: [{ level: "subject", fields: [{ path: "code", type: "text", class: "plain" }] }],
  axes: [{ name: "technique", values: [{ id: "MPRAGE" }] }],
  kinds: [{ name: "EDSS", value_type: "number" }],
  cohorts: [
    { name: "ms-cohort-a", members: 24 },
    { name: "ms-cohort-b", members: 24 },
  ],
};

/**
 * The job table as the engine keeps it: one old analysis run still going, a run of jobs after it (one failed), and
 * the queue's own rows, one per lane, newest of all. The jobs door lists the open jobs without the queue's rows,
 * and with `all` the newest of every state, the queue's rows among them.
 */
const KINDS = ["pseudonymize", "digest", "fingerprint", "classify"];
const JOBS = [
  {
    id: 57,
    kind: "pipeline",
    name: "synthseg over nmosd",
    state: "running",
    started_at: "2026-10-08 22:00:00",
  },
  ...Array.from({ length: 44 }, (_, i) => ({
    id: 60 + i,
    kind: 60 + i === 102 ? "digest" : KINDS[i % 4],
    name: `study-a-2026-10-${String(1 + (i % 9)).padStart(2, "0")}`,
    state: 60 + i === 102 ? "failed" : "done",
    started_at: `2026-10-09 ${String(8 + Math.floor(i / 6)).padStart(2, "0")}:0${i % 6}:00`,
    finished_at: `2026-10-09 ${String(8 + Math.floor(i / 6)).padStart(2, "0")}:0${i % 6}:40`,
    ...(60 + i === 102
      ? { error: `the folder study-a/derivatives/dcm-anon is gone; ${"x".repeat(900)}` }
      : {}),
  })),
  {
    id: 110,
    kind: "pipeline-worker",
    name: "pipelines",
    state: "running",
    started_at: "2026-10-09 19:00:00",
  },
  { id: 111, kind: "picture-worker", name: "queue", state: "running", started_at: "2026-10-09 19:00:00" },
  { id: 112, kind: "worker", name: "queue", state: "running", started_at: "2026-10-09 19:00:00" },
].map((j) => ({
  pid: 4242,
  host: "lab",
  heartbeat_at: "2026-10-09 19:20:00",
  finished_at: null,
  progress: null,
  error: null,
  args: { queued: [j.kind, "--pack", "mri"], principal: "anna@n" },
  result: j.kind === "classify" ? { judged: 1003, previews: 1003 } : null,
  chain: { before: null, after: null },
  ...j,
}));
const OPEN = ["queued", "running", "cancelling"];

/** A dataset's summary as the Data page's door answers it: sorted but for twelve scans, body part served and not run, no model for post-contrast. */
const SUMMARY = {
  dataset: "study-a",
  dataset_id: 4,
  detail: "sensitive",
  state: "anonymised",
  subjects: 63,
  sessions: 63,
  studies: 63,
  scans: 1003,
  sure: 990,
  need_a_look: 1,
  unsorted: 12,
  kinds: [
    { kind: "T2w", scans: 400 },
    { kind: "T1w", scans: 271 },
  ],
  body_regions: [],
  steps: [
    { step: "found", state: "done", job: null, files: 9000, tree: "anon" },
    { step: "read", state: "done", job: 101, files: 9000, refused: 0, reads: 1 },
    { step: "sorted", state: "waiting", job: 103, scans: 991, of: 1003, look: 1, passes: 0, unsorted: 12 },
    {
      step: "body_part",
      state: "waiting",
      job: null,
      run: null,
      served: true,
      answered: 0,
      look: 0,
      of: 1003,
    },
    {
      step: "post_contrast",
      state: "off",
      job: null,
      run: null,
      served: false,
      answered: 0,
      look: 0,
      of: 1003,
    },
    { step: "main_scans", state: "done", job: 103, picked: 120, borders: 3 },
    { step: "pictures", state: "done", job: 103, made: 1003, of: 1003, in_sort: true },
    { step: "views", state: "waiting", job: null, made: 0, of: 1003 },
  ],
};

const engine = await stubEngine((c) => {
  const p = c.path.split("?")[0];
  if (p === "/api/capabilities") return { body: { auth: "off", policy: [] } };
  if (p === "/api/jobs") {
    const q = new URL(c.path, "http://stub").searchParams;
    const all = q.get("all") === "1";
    const rows = [...JOBS]
      .sort((a, b) => b.id - a.id)
      .filter((j) => all || (OPEN.includes(j.state) && !j.kind.endsWith("worker")))
      .slice(0, Number(q.get("limit") ?? 50));
    return { body: { count: rows.length, jobs: rows } };
  }
  if (/^\/api\/jobs\/\d+$/u.test(p)) {
    const j = JOBS.find((x) => `/api/jobs/${x.id}` === p);
    return j ? { body: j } : { status: 404, body: { error: "no such job" } };
  }
  // the summary door answers for study-a; for study-b it is missing, as on an engine before the Data page
  if (p === "/api/datasets/study-a/summary") return { body: SUMMARY };
  if (p === "/api/ask/catalog") return { body: CATALOG };
  if (p === "/api/ask/guide") return { body: { grounding: ["a session is one subject on one day"] } };
  if (p === "/api/ask/draft")
    return { body: { document: 812, hash: "h", diagnosis: [{ set: "people", rows: 24 }] } };
  if (p === "/api/ask/preview") return { body: { level: "count", columns: ["n_subjects"], rows: [[24]] } };
  if (p === "/api/ask/validate") return { body: { valid: true, issues: [] } };
  if (p === "/api/pipelines")
    return {
      body: {
        pipelines: [
          {
            id: 3,
            name: "synthseg",
            version: 2,
            level: "session",
            parameters: [{ id: "robust", type: "Flag", "default-value": false }],
            outputs: [{ kind: "table", columns: [{ name: "left_hippocampus" }] }],
          },
        ],
      },
    };
  if (p === "/api/cohorts") return { body: [{ name: "nmosd", subjects: 9, sessions: 20 }] };
  if (p === "/api/sources")
    return {
      body: {
        count: 3,
        sources: [
          {
            name: "study-big",
            dataset: { kind: "dataset", state: "identified", cohort: null },
            digests: { count: 1, last: { name: "today", finished_at: "2026-10-09 09:00:00" } },
            totals: { subjects: 120, sessions: 340, stacks: 5210, to_sort: 310, sure: 4900, unsorted: 0 },
          },
          {
            name: "study-a",
            dataset: { kind: "dataset", state: "anonymised", cohort: null },
            digests: { count: 1, last: { name: "study-a-2026-10-09", finished_at: "2026-10-09 08:00:00" } },
            totals: { subjects: 63, sessions: 63, stacks: 1003, to_sort: 1, sure: 990, unsorted: 12 },
          },
          {
            name: "study-b",
            dataset: { kind: "dataset", state: "identified", cohort: null },
            digests: { count: 1, last: { name: "study-b-2026-10-01", finished_at: "2026-10-01 08:00:00" } },
            totals: { subjects: 4, sessions: 8, stacks: 40, to_sort: 0, sure: 40, unsorted: 0 },
          },
        ],
      },
    };
  if (p === "/api/ask/run") return { body: { handle: 55, truncated: false } };
  if (p.startsWith("/api/pipelines/") && p.endsWith("/preflight"))
    return {
      body: {
        ready: true,
        units: { total: 20, ready: 18, missing: 2 },
        missing: [{ why: "no T1w" }, { why: "no T1w" }],
        estimate: { seconds: 3600 },
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
useChangeStore(() => new ChangeStore(join(dir, "changes.sqlite")));

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

const Nils = oneAgent({ model: "m", arm: "skill", stationDirs: ["./stations"] });
let flue: Awaited<ReturnType<typeof start>>;
beforeAll(async () => {
  flue = await start({ agents: [Nils], db: sqlite(join(dir, "flue.sqlite")), providers: [provider] });
});
afterAll(async () => {
  await flue.stop();
  engine.close();
});

/** Every batch the store holds for a conversation, as text. */
function recorded(id: string): string {
  const db = new DatabaseSync(join(dir, "flue.sqlite"));
  const rows = db
    .prepare("SELECT data FROM flue_conversation_stream_batches WHERE path LIKE ?")
    .all(`%${id}%`) as { data: string }[];
  db.close();
  return rows.map((r) => r.data).join("\n");
}

const text = (c: Context): string => JSON.stringify(c.messages);
/** The tools the request carried: pi puts them on the transcript's system message, an older context on `tools`. */
const toolNames = (c: Context): string[] =>
  (getCurrentTools(c.messages as never).length ? getCurrentTools(c.messages as never) : (c.tools ?? [])).map(
    (t) => t.name,
  );
/** The messages after the head: what the turn appended. */
const appended = (c: Context): string =>
  JSON.stringify(c.messages.filter((m) => (m.role as string) !== "system"));

describe("the one agent", () => {
  it("finds data through its skill: the facts first, the examples on activation, the question offered as a version", async () => {
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "query_draft", args: { text: "ast_version: 1\nname: cohort b\n" } },
      { text: "Cohort B has 24 subjects." },
    ]);
    const h = init(Nils, { id: "oc-find" });
    const reply = await h.read(await h.dispatch("How many subjects are in cohort B?"));
    expect(reply.text).toMatch(/24 subjects/u);
    // the facts: the summary in plain words, what the person may do, the hint, in one message before the first call
    const first = appended(seen[0]);
    expect(first).toMatch(/What the registry holds/u);
    expect(first).toMatch(/ms-cohort-b \(24 members\)/u);
    expect(first).toMatch(/This person may look up data/u);
    expect(first).toMatch(/this looks like the find-data skill/u);
    expect(first).not.toMatch(/epoch/u);
    // the tools in their fixed order, the head the same
    expect(toolNames(seen[0])).toEqual(
      expect.arrayContaining(["registry_summary", "query_draft", "propose_change", "activate_skill"]),
    );
    expect(toolNames(seen[0]).filter((n) => !["task", "activate_skill"].includes(n))).toEqual([
      "registry_summary",
      "registry_search",
      "registry_describe",
      "query_draft",
      "query_run_readonly",
      "query_read_rows",
      "jobs_read",
      "run_read",
      "plan_update",
      "ask_user",
      "propose_change",
    ]);
    expect(text(seen[0])).toMatch(/You are NILS/u);
    // the skill's body, with the worked examples closest to the words
    expect(text(seen[1])).toMatch(/Worked examples closest/u);
    // the draft's answer carries the document, and the turn records the skill and the document
    expect(text(seen[2])).toMatch(/"document":812/u);
    const turn = turnOf("oc-find");
    expect([...turn.skills]).toContain("find-data");
    expect(turn.drafted).toEqual([812]);
    // the question is offered as the conversation's new version, as a card the desk decides on its feedback door
    const changes = theChanges().of("oc-find");
    expect(changes.map((c) => c.kind)).toEqual(["query_version"]);
    const log = recorded("oc-find");
    expect(log).toMatch(/"kind":"approval"/u);
    expect(log).toMatch(/"change":"query_version"/u);
    expect(log).toMatch(/"kind":"progress","call":"call_2","text":"Writing the query"/u);
    // the engine was read through the find seam under this conversation
    expect(
      theLedger()
        .rows("oc-find")
        .map((r) => r.operation),
    ).toEqual(expect.arrayContaining(["draft", "preview", "validate"]));
  }, 60_000);

  it("answers how much a dataset holds from its own counts, and sends back an answer that says it is not there", async () => {
    play([
      { text: "There's no cohort or dataset called study-big in the registry." },
      { text: "study-big holds 5210 scans from 120 subjects over 340 visits." },
    ]);
    const h = init(Nils, { id: "oc-dataset" });
    const reply = await h.read(await h.dispatch("How many T1 scans with contrast are in study-big?"));
    // the facts carry the datasets with their counts, and the hint names the dataset in place of drafting
    const first = appended(seen[0]);
    expect(first).toMatch(/## The datasets \(where the scans came from\)/u);
    expect(first).toMatch(
      /- study-big \(identified\): 120 subjects, 340 visits, 5210 scans \(4900 sure, 310 need a look\); feeds no cohort/u,
    );
    expect(first).toMatch(/they name the dataset study-big/u);
    expect(first).toMatch(
      /Anything narrower [^.]* is a question that names the dataset: activate the find-data skill/u,
    );
    expect(first).not.toMatch(/this looks like the find-data skill/u);
    expect(turnOf("oc-dataset").datasets).toEqual(["study-big"]);
    // the answer that said there was no such dataset went back once, and the count stands
    expect(calls).toBe(2);
    expect(text(seen[1])).toMatch(/the words name the dataset study-big, which the registry holds/u);
    expect(reply.text).toMatch(/5210 scans/u);
    expect(
      theLedger()
        .rows("oc-dataset")
        .map((r) => r.operation),
    ).toEqual(expect.arrayContaining(["sources", "cohorts"]));
  }, 60_000);

  it("keeps the dataset named before in a follow-up, which drafts a question that names it", async () => {
    play([
      { text: "study-big holds 5210 scans from 120 subjects over 340 visits." },
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "query_draft", args: { text: "ast_version: 1\nname: 3D scans in study-big\n" } },
      { text: "24 of them are 3D." },
    ]);
    const h = init(Nils, { id: "oc-dataset-follow" });
    await h.read(await h.dispatch("How many scans are in study-big?"));
    // the count in all is the facts': no question drafted, nothing sent back
    expect(calls).toBe(1);
    expect(turnOf("oc-dataset-follow").drafted).toEqual([]);
    const reply = await h.read(await h.dispatch("How many of them are 3D?"));
    expect(reply.text).toMatch(/24 of them are 3D/u);
    const second = appended(seen[1]);
    expect(second).toMatch(
      /earlier in this conversation the person named the dataset study-big \(identified\)/u,
    );
    expect(second).toMatch(
      /keep it: activate the find-data skill and draft the question with the dataset named/u,
    );
    // the datasets were told on the first turn and have not changed since
    expect(second.match(/## The datasets/gu)).toHaveLength(1);
    expect(turnOf("oc-dataset-follow").datasets).toEqual(["study-big"]);
    expect(turnOf("oc-dataset-follow").drafted).toEqual([812]);
    // words that turn to a cohort leave the dataset
    play([{ text: "Cohort B has 24 subjects." }]);
    await h.read(await h.dispatch("How many subjects are in cohort B?"));
    expect(turnOf("oc-dataset-follow").datasets).toEqual([]);
    expect(appended(seen[0])).toMatch(/this looks like the find-data skill/u);
  }, 60_000);

  it("mounts from the person's grants: no data tools for a person without query:see", async () => {
    notePerson("oc-refuse", { grants: ["assistant:use"], detail: "plain" });
    play([{ text: "Your account cannot look up data here; an admin can give it." }]);
    const h = init(Nils, { id: "oc-refuse" });
    await h.read(await h.dispatch("How many subjects are in cohort B?"));
    expect(toolNames(seen[0]).filter((n) => n !== "task")).toEqual([
      "registry_summary",
      "plan_update",
      "ask_user",
      "propose_change",
    ]);
    expect(appended(seen[0])).toMatch(/may only ask what the registry holds/u);
    expect(appended(seen[0])).toMatch(/this person may not do that here/u);
  }, 60_000);

  it("warns at the third same call, stops at the fifth, and ends the turn at the sixth", async () => {
    play([
      { tool: "registry_search", args: { words: "mprage" } },
      { tool: "registry_search", args: { words: "mprage" } },
      { tool: "registry_search", args: { words: "mprage" } },
      { tool: "registry_search", args: { words: "mprage" } },
      { tool: "registry_search", args: { words: "mprage" } },
      { tool: "registry_search", args: { words: "mprage" } },
      { text: "never reached" },
    ]);
    const h = init(Nils, { id: "oc-loop" });
    const reply = await h.read(await h.dispatch("Which scans are MPRAGE?"));
    const log = recorded("oc-loop");
    expect(log).toMatch(/called 3 times with the same salient arguments/u);
    expect(log).toMatch(/the same call came five times/u);
    expect(log).toMatch(/Answer the person now/u);
    expect(calls).toBe(6);
    expect(reply.text).not.toMatch(/never reached/u);
  }, 60_000);

  it("holds the framework's own tools to the same guards: a skill activated five times stops the turn", async () => {
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "activate_skill", args: { name: "find-data" } },
      { text: "Nothing more." },
    ]);
    const h = init(Nils, { id: "oc-loop-framework" });
    await h.read(await h.dispatch("Which scans are MPRAGE?"));
    const log = recorded("oc-loop-framework");
    expect(log).toMatch(/the same call came five times/u);
    expect(turnOf("oc-loop-framework").stopped).toBe("the same call came five times");
    // the sixth is refused before it runs, and the turn still ends
    expect(calls).toBeLessThanOrEqual(8);
  }, 60_000);

  it("ends a turn whose model never answers at the turn's guards, not at the submission's hour (2026-10-10)", async () => {
    // a model that never writes a word: it keeps activating skills and reading skill files with ever new arguments.
    // A guard stops it, it gets one call to answer, and the framework tool it calls instead ends the turn.
    const skills = [
      "find-data",
      "plan-work",
      "plan-analysis",
      "read-run",
      "tune-sorting-words",
      "check-identities",
    ];
    play(
      Array.from({ length: 400 }, (_, i) =>
        i % 2 === 0
          ? { tool: "activate_skill", args: { name: skills[(i / 2) % skills.length] } }
          : { tool: "read_skill_resource", args: { name: "find-data", path: `notes-${i}.md` } },
      ),
    );
    const h = init(Nils, { id: "oc-never-answers" });
    const started = Date.now();
    await h.read(await h.dispatch("Which scans are MPRAGE?"));
    expect(turnOf("oc-never-answers").stopped).not.toBeNull();
    expect(calls).toBeLessThanOrEqual(TURN_BUDGET.turns + 2);
    expect(recorded("oc-never-answers")).toMatch(/the turn ends here/u);
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);

  it("tells the facts again, whole, once a summary of the earlier turns took them (2026-10-10)", async () => {
    // the facts the turn was told: the last message of its context that carries the hint
    const lastFacts = (c: Context): string =>
      JSON.stringify(
        [...c.messages].reverse().find((m) => JSON.stringify(m).includes("Hint from the words")) ?? null,
      );
    theLineage().open({ id: "oc-summarized", station: "nils", subject: "anonymous" });
    play([{ text: "There are two cohorts, ms-cohort-a and ms-cohort-b." }]);
    const h = init(Nils, { id: "oc-summarized" });
    await h.read(await h.dispatch("Which cohorts are there?"));
    expect(lastFacts(seen[0])).toMatch(/What the registry holds/u);
    // an ordinary next turn: the summary was told and has not changed
    play([{ text: "Both have 24 members." }]);
    await h.read(await h.dispatch("And how big are they?"));
    expect(lastFacts(seen[0])).not.toMatch(/What the registry holds/u);
    // the runtime summarized the earlier turns, the facts' messages among them: the next turn tells them again
    theLineage().noteCompaction("oc-summarized");
    play([{ text: "Cohort A has 24 members." }]);
    await h.read(await h.dispatch("And cohort A alone?"));
    expect(lastFacts(seen[0])).toMatch(/What the registry holds/u);
    expect(lastFacts(seen[0])).toMatch(/This person may look up data/u);
    // and only once: the turn after it is ordinary again
    play([{ text: "Yes." }]);
    await h.read(await h.dispatch("Is that all?"));
    expect(lastFacts(seen[0])).not.toMatch(/What the registry holds/u);
  }, 60_000);

  it("sends an answer in engine words back once, and the new answer stands", async () => {
    play([{ text: "The ask-help station counted 24 subjects." }, { text: "Cohort B has 24 subjects." }]);
    const h = init(Nils, { id: "oc-plain" });
    const reply = await h.read(await h.dispatch("Which cohorts are there?"));
    expect(calls).toBe(2);
    expect(text(seen[1])).toMatch(
      /Before you finish: the answer uses words a person should not need: station/u,
    );
    expect(reply.text).toMatch(/Cohort B has 24 subjects/u);
  }, 60_000);

  it("ends the turn with a question card", async () => {
    play([
      {
        tool: "ask_user",
        args: {
          question: "Which cohort?",
          options: [{ label: "ms-cohort-a", count: 24 }, { label: "ms-cohort-b" }],
        },
      },
      { text: "never reached" },
    ]);
    const h = init(Nils, { id: "oc-ask" });
    await h.read(await h.dispatch("How many in the cohort?"));
    expect(calls).toBe(1);
    expect(recorded("oc-ask")).toMatch(/"kind":"clarification","question":"Which cohort\?"/u);
  }, 60_000);

  it("proposes an analysis with the engine's own check, and runs nothing", async () => {
    play([
      { tool: "activate_skill", args: { name: "plan-analysis" } },
      {
        tool: "propose_change",
        args: {
          kind: "analysis_plan",
          pipeline: "synthseg",
          params: { robust: true },
          cohorts: ["nmosd"],
          sessions: "all",
          question: "hippocampal volumes",
          why: "volumes",
          sentence: "Measure the hippocampus with synthseg.",
        },
      },
      {
        text: "I propose synthseg over the nmosd cohort: 18 of 20 units are ready; it runs when you approve it.",
      },
    ]);
    const h = init(Nils, { id: "oc-analysis" });
    await h.read(await h.dispatch("What are the hippocampal volumes in the NMOSD cohort?"));
    const out = JSON.stringify(seen[2].messages.filter((m) => m.role === "toolResult"));
    expect(out).toMatch(/"kind":"analysis_plan"/u);
    expect(out).toMatch(/"pipeline":"synthseg"/u);
    expect(out).toMatch(/"cohorts":\["nmosd"\]/u);
    expect(out).toMatch(/"sessions":"all"/u);
    const [c] = theChanges().of("oc-analysis");
    expect(c.kind).toBe("analysis_plan");
    expect(c.state).toBe("open");
    expect(c.payload.command).toEqual(["run", "synthseg@2", "--handle", "55", "--param", "robust=true"]);
    expect(engine.seen.some((x) => x.method === "POST" && x.path === "/api/jobs")).toBe(false);
    expect(recorded("oc-analysis")).toMatch(/"change":"job_plan"/u);
  }, 60_000);
});

/** The results of the tools the turn called so far, as the model read them. */
const toolResults = (c: Context): string => JSON.stringify(c.messages.filter((m) => m.role === "toolResult"));
/** What the last tool call gave, as the model read it in its next request. */
function lastResult(c: Context): Record<string, unknown> {
  const m = c.messages.filter((x) => x.role === "toolResult").at(-1) as { content?: { text?: string }[] };
  return JSON.parse(m?.content?.[0]?.text ?? "{}") as Record<string, unknown>;
}
/** The jobs one jobs_read call gave. */
const jobsGiven = (c: Context): Record<string, unknown>[] =>
  (lastResult(c).registry_data as { jobs?: Record<string, unknown>[] } | undefined)?.jobs ?? [];

describe("the one agent tells what is true now (2026-10-09)", () => {
  it("reads the newest jobs of every state, the queue's own rows left out, and answers what the last job did", async () => {
    // asked what the last job was, the chat read the open jobs alone and said there were none
    play([
      { tool: "jobs_read", args: {} },
      { text: "The last job was job 103, a classify of study-a; it finished done at 15:01." },
    ]);
    const h = init(Nils, { id: "oc-jobs" });
    const reply = await h.read(await h.dispatch("What is the last job and how did it go?"));
    // the door is asked for every state, and for the open ones
    const asked = engine.seen.filter((x) => x.path.startsWith("/api/jobs?")).map((x) => x.path);
    expect(asked).toEqual(expect.arrayContaining(["/api/jobs?all=1&limit=40", "/api/jobs?limit=40"]));
    // the newest ten, newest first, and the old run still going; no row of the queue's own
    const jobs = jobsGiven(seen[1]);
    expect(jobs.map((j) => j.id)).toEqual([103, 102, 101, 100, 99, 98, 97, 96, 95, 94, 57]);
    expect(jobs.every((j) => !String(j.kind).endsWith("worker"))).toBe(true);
    expect(jobs[0]).toEqual({
      id: 103,
      kind: "classify",
      name: "study-a-2026-10-08",
      state: "done",
      started_at: "2026-10-09 15:01:00",
      finished_at: "2026-10-09 15:01:40",
    });
    // a failed job says why, shortly; one still going has no end yet
    expect(jobs[1]).toMatchObject({ id: 102, state: "failed" });
    expect(String(jobs[1].error)).toMatch(/^the folder study-a\/derivatives\/dcm-anon is gone/u);
    expect(String(jobs[1].error).length).toBeLessThanOrEqual(201);
    expect(jobs[10]).toEqual({
      id: 57,
      kind: "pipeline",
      name: "synthseg over nmosd",
      state: "running",
      started_at: "2026-10-08 22:00:00",
    });
    // small: no command lines, results or progress, about five hundred tokens in all
    const given = JSON.stringify(lastResult(seen[1]));
    expect(given).not.toMatch(/"args"|"result"|"progress"|"pid"|"host"/u);
    expect(given.length).toBeLessThan(2000);
    // the words are about the jobs, not a question of the data: the answer stands, never sent back to draft one
    const first = appended(seen[0]);
    expect(first).not.toMatch(/find-data skill/u);
    expect(first).toMatch(/the registry's jobs are asked about[^"]*jobs_read/u);
    expect(calls).toBe(2);
    expect(reply.text).toMatch(/job 103/u);
  }, 60_000);

  it("still reads one job whole by its id", async () => {
    play([{ tool: "jobs_read", args: { job: 102 } }, { text: "Job 102 failed: the folder was gone." }]);
    const h = init(Nils, { id: "oc-job-one" });
    await h.read(await h.dispatch("Why did job 102 fail?"));
    expect(engine.seen.some((x) => x.path === "/api/jobs/102")).toBe(true);
    const out = lastResult(seen[1]);
    expect(out).toMatchObject({ job: 102, state: "failed" });
    expect(String(out.error)).toMatch(/^the folder study-a\/derivatives\/dcm-anon is gone/u);
    // the whole job, as the door gave it
    expect(out.registry_data).toMatchObject({
      id: 102,
      kind: "digest",
      args: { queued: ["digest", "--pack", "mri"] },
    });
  }, 60_000);

  it("says which steps have run on a dataset the words name, and what the headers answer until they have", async () => {
    // asked for the T1 scans with contrast, the chat counted the scans whose header weighting reads T1 and called
    // them contrast-enhanced; then the facts said nothing was known of contrast until post-contrast ran, which was
    // false: the sorting marks the scans whose headers say contrast was given
    play([
      {
        text: "12 T1 scans in study-a are marked in their headers as given contrast; there may be more, since post-contrast has not run on it yet.",
      },
    ]);
    const h = init(Nils, { id: "oc-steps" });
    await h.read(await h.dispatch("How many T1 scans with contrast are in study-a?"));
    const first = appended(seen[0]);
    expect(first).toMatch(/they name the dataset study-a \(anonymised\): 63 subjects/u);
    expect(first).toMatch(
      /The steps of study-a: sorted 991 of 1003 scans; body part not run \(from the headers only\); post-contrast not run \(from the headers only\); main scans picked; pictures made\./u,
    );
    expect(first).toMatch(
      /Body part and post-contrast have not run on study-a: a scan's body part is known where the headers name it, not yet elsewhere\. The scans the headers mark as given contrast or as not given are counted, and there may be more of either; whether an unmarked scan was given contrast is not known yet\. Never count another field in their place\./u,
    );
    expect(first).not.toMatch(/whether a scan was given contrast are not known|has no answer for it yet/u);
    // read once, through the seam that reads the datasets
    expect(engine.seen.filter((x) => x.path === "/api/datasets/study-a/summary")).toHaveLength(1);
    expect(
      theLedger()
        .rows("oc-steps")
        .map((r) => r.operation),
    ).toContain("datasets/{name}/summary");
  }, 60_000);

  it("leaves the steps out, and says nothing of it, where the engine has no summary of the dataset", async () => {
    play([{ text: "study-b holds 40 scans from 4 subjects over 8 visits." }]);
    const h = init(Nils, { id: "oc-steps-none" });
    await h.read(await h.dispatch("How many scans are in study-b?"));
    const first = appended(seen[0]);
    expect(engine.seen.some((x) => x.path === "/api/datasets/study-b/summary")).toBe(true);
    expect(first).toMatch(/they name the dataset study-b \(identified\): 4 subjects, 8 visits, 40 scans/u);
    expect(first).not.toMatch(/steps of study-b|run on study-b|summary|no door|404/u);
    expect(calls).toBe(1);
  }, 60_000);

  it("reads a dataset's steps once a turn: its description in the same turn has them from there", async () => {
    play([
      { tool: "registry_describe", args: { what: "dataset", name: "study-a" } },
      {
        text: "study-a is sorted but for twelve scans; body part and post-contrast have not run on it, so only what the headers say of them is known.",
      },
    ]);
    const before = engine.seen.filter((x) => x.path === "/api/datasets/study-a/summary").length;
    const h = init(Nils, { id: "oc-steps-describe" });
    await h.read(await h.dispatch("What has been done to study-a so far?"));
    const out = toolResults(seen[1]);
    expect(out).toMatch(
      /\\"steps\\":\\"sorted 991 of 1003 scans; body part not run \(from the headers only\); post-contrast not run \(from the headers only\); main scans picked; pictures made\\"/u,
    );
    expect(out).toMatch(
      /\\"known_so_far\\":\\"Body part and post-contrast have not run on study-a: a scan's body part is known where the headers name it, not yet elsewhere\. The scans the headers mark as given contrast or as not given are counted, and there may be more of either; whether an unmarked scan was given contrast is not known yet\./u,
    );
    expect(out).not.toMatch(/not_known|whether a scan was given contrast are not known/u);
    expect(engine.seen.filter((x) => x.path === "/api/datasets/study-a/summary").length).toBe(before + 1);
  }, 60_000);
});
