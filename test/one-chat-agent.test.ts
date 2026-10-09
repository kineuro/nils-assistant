// SPDX-License-Identifier: AGPL-3.0-only
// One chat (2026-10-09): the one agent on Flue, a scripted model and a stub
// engine. A find turn activates its skill, drafts a question and leaves it
// offered as a new version; the turn's facts arrive as one message; the
// tools follow the person's grants; the repeat detector warns and stops; an
// answer in engine words is sent back once; a question card ends the turn;
// an analysis is proposed, never run; a dataset the words name is answered
// from its own counts, never said not to be there, and a follow-up keeps it.

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
const { probeEngineAuth, registerStation, theLedger } = await import("../src/seam/for.ts");
const { loadManifests } = await import("../src/stations/manifest.ts");
const { ChangeStore, theChanges, useChangeStore } = await import("../src/one/changes.ts");
const { oneAgent, notePerson } = await import("../src/one/agent.ts");
const { turnOf } = await import("../src/one/state.ts");

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

const engine = await stubEngine((c) => {
  const p = c.path.split("?")[0];
  if (p === "/api/capabilities") return { body: { auth: "off", policy: [] } };
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
        count: 1,
        sources: [
          {
            name: "study-big",
            dataset: { kind: "dataset", state: "identified", cohort: null },
            digests: { count: 1, last: { name: "today", finished_at: "2026-10-09 09:00:00" } },
            totals: { subjects: 120, sessions: 340, stacks: 5210, to_sort: 310, sure: 4900, unsorted: 0 },
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
