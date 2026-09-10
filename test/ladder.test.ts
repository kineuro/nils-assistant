// SPDX-License-Identifier: AGPL-3.0-only
// The ladder (Wave 5 D2, bar 3): rungs read from the engine's own policy;
// the overnight instruction becomes a plan of three rung-two jobs and one
// rung-three proposal; under standing grants the scheduler queues the three
// when the batch lands, each queued job's actor names the grant, the
// proposal stays unapplied, and everything is in the inbox; without a grant
// for classify that step waits with its reason. C49 empties rung two.

import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ladderOf, opens, planFrom, restate, rungOf, VERBS, whenOf } from "../src/host/ladder.ts";
import { LadderStore } from "../src/host/ladder-store.ts";
import { inboxOf, Scheduler } from "../src/host/scheduler.ts";
import { Seam } from "../src/seam/client.ts";
import { GrantKeeper } from "../src/seam/grant.ts";
import { Ledger } from "../src/seam/ledger.ts";
import { loadManifests } from "../src/stations/manifest.ts";
import { operatorChecks, useLadderStore } from "../src/stations/operator.ts";
import type { Verdict } from "../src/stations/verdict.ts";

const POLICY = [
  { door: "GET /api/jobs", role: "reader", writes: false, idempotent: false, cost: "bounded" },
  { door: "POST /api/jobs", role: "operator", writes: true, idempotent: false, cost: "job" },
  { door: "POST /api/ask/jobs", role: "reader", writes: true, idempotent: true, cost: "job" },
  { door: "POST /api/ask/run", role: "reader", writes: true, idempotent: true, cost: "bounded" },
  { door: "POST /api/ask/apply", role: "reader", writes: true, idempotent: true, cost: "free" },
  { door: "POST /api/sessions/rebuild", role: "operator", writes: true, idempotent: false, cost: "job" },
  { door: "POST /api/overlays/{id}/adopt", role: "operator", writes: true, idempotent: false, cost: "job" },
  { door: "POST /api/releases", role: "operator", writes: true, idempotent: false, cost: "job" },
  { door: "POST /api/handovers", role: "operator", writes: true, idempotent: false, cost: "job" },
  {
    door: "POST /api/ask/handles/{id}/promote",
    role: "operator",
    writes: true,
    idempotent: true,
    cost: "job",
  },
  { door: "POST /api/review/{id}/accept", role: "reviewer", writes: true, idempotent: true, cost: "free" },
  { door: "POST /api/ask/draft", role: "reader", writes: true, idempotent: false, cost: "bounded" },
  { door: "PUT /api/ask/selections/{name}", role: "reviewer", writes: true, idempotent: false, cost: "free" },
];

function body(req: IncomingMessage): Promise<string> {
  return new Promise((r) => {
    let t = "";
    req.on("data", (d) => {
      t += String(d);
    });
    req.on("end", () => r(t));
  });
}

/** A stub engine: a batch that lands when told, jobs that finish when told, and the audit of every actor header. */
async function stubEngine() {
  const seen: { method: string; path: string; actor: Record<string, unknown> | null; body: unknown }[] = [];
  const state = { landed: false, nextJob: 100, jobs: new Map<number, string>() };
  const server: Server = createServer(async (req, res) => {
    const text = await body(req);
    const actor = req.headers["x-nils-actor"]
      ? (JSON.parse(String(req.headers["x-nils-actor"])) as Record<string, unknown>)
      : null;
    seen.push({ method: req.method ?? "", path: req.url ?? "", actor, body: text ? JSON.parse(text) : null });
    const json = (status: number, o: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    const url = req.url ?? "";
    if (url === "/api/capabilities")
      return json(200, {
        auth: "off",
        principal: "anna@lab",
        roles: ["reader", "reviewer", "operator"],
        policy: POLICY,
      });
    if (url.startsWith("/api/batches"))
      return json(200, {
        count: 2,
        batches: [
          {
            id: 2,
            name: "the second batch",
            state: state.landed ? "done" : "running",
            finished_at: state.landed ? new Date().toISOString() : null,
          },
          { id: 1, name: "the first", state: "done", finished_at: "2026-09-01T00:00:00Z" },
        ],
      });
    const m = /^\/api\/jobs\/(\d+)$/u.exec(url);
    if (m) return json(200, { id: Number(m[1]), state: state.jobs.get(Number(m[1])) ?? "queued" });
    if (url === "/api/jobs" && req.method === "POST") {
      const id = state.nextJob++;
      state.jobs.set(id, "queued");
      return json(200, { job: id, state: "queued" });
    }
    if (url === "/api/ask/jobs" && req.method === "POST") {
      const id = state.nextJob++;
      state.jobs.set(id, "queued");
      return json(200, {
        job: id,
        document: (JSON.parse(text) as { document_id: number }).document_id,
        state: "queued",
      });
    }
    if (url === "/api/sessions/rebuild") {
      const id = state.nextJob++;
      state.jobs.set(id, "queued");
      return json(200, { job: id, state: "queued" });
    }
    return json(404, { error: "no door" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address() as { port: number };
  return { url: `http://127.0.0.1:${a.port}`, seen, state, server };
}

const closers: (() => void)[] = [];
afterAll(() => {
  for (const c of closers) c();
});

function harness(engine: string) {
  const dir = mkdtempSync(join(tmpdir(), "ladder-"));
  const ledger = new Ledger(join(dir, "seam.sqlite"));
  const store = new LadderStore(join(dir, "ladder.sqlite"));
  const seamFor = (conversation: string) =>
    new Seam({
      engine,
      station: {
        id: "scheduler",
        version: "t",
        grant: { jobs: {}, "sessions/rebuild": {}, batches: {}, "jobs/{id}": {}, capabilities: {} },
        ceiling: "operator",
        content: "catalog",
        model: "none",
        standing: true,
      },
      conversation,
      token: () => null,
      authOff: () => true,
      ledger,
    });
  return { store, seamFor, ledger };
}

/** The overnight instruction as the operator station plans it (section 9.3). */
const OVERNIGHT = [
  { verb: "digest", args: { batch: 2 }, when: { on_event: "batch_landed" } },
  { verb: "classify", args: { batch: 2 }, when: { on_event: "job_finished" } },
  { verb: "run", args: { document: 41 }, when: { on_event: "job_finished" } },
  { verb: "release", args: { nothing: true } },
];

describe("the rungs", () => {
  it("come from the engine's policy: reads are one, undoable jobs are two, a person's acts are three", () => {
    const rungs = Object.fromEntries(ladderOf(POLICY).map((r) => [r.door, r.rung]));
    expect(rungs["GET /api/jobs"]).toBe(1);
    expect(rungs["POST /api/jobs"]).toBe(2);
    expect(rungs["POST /api/ask/jobs"]).toBe(2);
    expect(rungs["POST /api/ask/run"]).toBe(2);
    expect(rungs["POST /api/sessions/rebuild"]).toBe(2);
    expect(rungs["POST /api/ask/apply"]).toBe(2);
    expect(rungs["POST /api/overlays/{id}/adopt"]).toBe(3);
    expect(rungs["POST /api/releases"]).toBe(3);
    expect(rungs["POST /api/handovers"]).toBe(3);
    expect(rungs["POST /api/ask/handles/{id}/promote"]).toBe(3);
    expect(rungs["POST /api/review/{id}/accept"]).toBe(3);
    expect(rungs["POST /api/ask/draft"]).toBe(3);
    expect(rungs["PUT /api/ask/selections/{name}"]).toBe(3);
    expect(
      rungOf({
        door: "POST /api/models/x/promote",
        role: "admin",
        writes: true,
        idempotent: true,
        cost: "job",
      }),
    ).toBe(3);
    expect(opens(["reviewer"], "reader")).toBe(true);
    expect(opens(["reviewer"], "operator")).toBe(false);
  });

  it("a standing grant may name a session rebuild; a manifest grant may not; neither may name a decision", () => {
    expect(() => new GrantKeeper({ "sessions/rebuild": {} })).toThrow(/a person's/u);
    expect(() => new GrantKeeper({ "sessions/rebuild": {} }, true)).not.toThrow();
    expect(() => new GrantKeeper({ "review/{id}/accept": {} }, true)).toThrow(/a person's/u);
  });
});

describe("the plan", () => {
  it("turns the overnight instruction into three rung-two steps and one rung-three proposal", () => {
    const p = planFrom(OVERNIGHT, POLICY);
    expect(p.steps.map((s) => [s.n, s.rung, s.verb, s.door])).toEqual([
      [1, 2, "digest", "POST /api/jobs"],
      [2, 2, "classify", "POST /api/jobs"],
      [3, 2, "run", "POST /api/ask/jobs"],
    ]);
    expect(p.proposals.map((s) => [s.n, s.rung, s.verb, s.words, s.closure_needed])).toEqual([
      [4, 3, "release", "release nothing", true],
    ]);
    expect(p.refused).toEqual([]);
    const words = restate(p);
    expect(words).toContain("1. [rung 2, under a standing grant] digest batch 2 when the next batch lands");
    expect(words).toContain(
      "2. [rung 2, under a standing grant] classify batch 2 with the same pack when the step before it finishes",
    );
    expect(words).toContain("4. [rung 3, proposed for a person to accept] release nothing");
  });
  it("refuses an unknown verb by name and a malformed when, and reads every when", () => {
    const p = planFrom(
      [
        { verb: "shred", args: {} },
        { verb: "digest", args: {}, when: "now" },
        { verb: "digest", args: { batch: 1 }, when: { on_event: "moon" } },
      ],
      POLICY,
    );
    expect(p.refused.map((r) => r.why)).toEqual([
      expect.stringMatching(/no verb named shred/u),
      expect.stringMatching(/digest names a batch or a root/u),
      expect.stringMatching(/when is now/u),
    ]);
    expect(whenOf(undefined)).toBe("now");
    expect(whenOf({ after_job: 7 })).toEqual({ after_job: 7 });
    expect(whenOf({ at: "2026-09-11T02:00:00Z" })).toEqual({ at: "2026-09-11T02:00:00.000Z" });
    expect(Object.keys(VERBS)).toContain("rebuild");
  });
  it("the operator manifest runs nothing, holds a read-only grant and checks its plan against the policy", () => {
    const m = loadManifests(["./stations"]).get("operator");
    if (!m) throw new Error("no operator manifest");
    expect(m.writes).toEqual([]);
    expect(Object.keys(m.grant).sort()).toEqual(["batches", "capabilities", "documents", "jobs"]);
    expect(m.checks).toEqual(["no_sql", "planned", "rungs_from_policy"]);
    const concierge = loadManifests(["./stations"]).get("concierge");
    expect(concierge).toBeTruthy();
  });
});

describe("the overnight instruction runs as a plan (bar 3)", () => {
  it("queues three jobs under standing grants when the batch lands, each naming the grant, and leaves the proposal unapplied", async () => {
    const e = await stubEngine();
    closers.push(() => e.server.close());
    const { store, seamFor } = harness(e.url);
    useLadderStore(() => store);
    const subject = "anna@lab";
    const planned = planFrom(OVERNIGHT, POLICY);
    const plan = store.plan({
      id: "plan-night",
      conversation: "c-night",
      subject,
      instruction:
        "when the second batch lands tonight, digest it, classify it with the same pack, run my pinned question, and release nothing",
      planned,
    });
    expect(plan.state).toBe("proposed");
    // the checks a settle must pass name the plan
    const checks = operatorChecks();
    const verdict = { result: { plan: "plan-night", sentence: "the plan" } } as unknown as Verdict;
    expect(checks.planned(verdict, { conversation: "c-night" })).toBeNull();
    expect(checks.planned(verdict, { conversation: "someone-else" })).toMatch(/not this conversation's/u);
    expect(checks.rungs_from_policy(verdict, {})).toBeNull();
    // grants for the three verbs
    const digest = store.grant(subject, "POST /api/jobs");
    const run = store.grant(subject, "POST /api/ask/jobs");
    expect(store.grantFor(subject, "POST /api/jobs")?.id).toBe(digest.id);
    const scheduler = new Scheduler({ store, seamFor });
    // not confirmed: nothing fires
    expect(await scheduler.tick()).toEqual([]);
    const confirmed = store.confirm("plan-night", subject);
    expect("refused" in confirmed).toBe(false);
    expect(store.confirm("plan-night", "someone-else")).toEqual({
      refused: "a plan is confirmed by the person it was made for",
    });
    // the batch has not landed: the first step waits with its reason, the rest wait on it
    let fired = await scheduler.tick();
    expect(fired.map((f) => f.outcome)).toEqual(["waiting", "waiting", "waiting"]);
    expect(store.steps("plan-night")[0].reason).toBe("waiting: for a batch to land");
    // the batch lands: digest is queued under the grant, and its actor names it
    e.state.landed = true;
    fired = await scheduler.tick();
    expect(fired[0]).toMatchObject({ outcome: "queued", job: 100 });
    const queued = e.seen.filter((s) => s.method === "POST" && s.path === "/api/jobs");
    expect(queued.length).toBe(1);
    expect(queued[0].actor).toMatchObject({ kind: "agent", name: "scheduler", grant: digest.id });
    expect(queued[0].body).toEqual({ command: ["digest", "--batch", "2"] });
    // classify waits for the step before it
    expect(store.steps("plan-night")[1].state).toBe("waiting");
    e.state.jobs.set(100, "done");
    fired = await scheduler.tick();
    expect(store.steps("plan-night")[0].state).toBe("done");
    expect(store.steps("plan-night")[1]).toMatchObject({ state: "queued", job: 101, grant: digest.id });
    e.state.jobs.set(101, "done");
    await scheduler.tick();
    await scheduler.tick();
    const steps = store.steps("plan-night");
    expect(steps[2]).toMatchObject({ verb: "run", state: "queued", job: 102, grant: run.id });
    const askJob = e.seen.find((s) => s.path === "/api/ask/jobs");
    expect(askJob?.actor).toMatchObject({ grant: run.id });
    expect(askJob?.body).toEqual({ document_id: 41 });
    // the proposal is unapplied: no release was ever dialled, and it waits for a person
    expect(e.seen.some((s) => s.path === "/api/releases")).toBe(false);
    expect(steps[3]).toMatchObject({ rung: 3, verb: "release", state: "waiting", decided: null });
    // everything is in the inbox
    const inbox = inboxOf(store, subject) as {
      jobs: Record<string, unknown[]>;
      proposals: unknown[];
      plans: { id: string; steps: unknown[] }[];
      grants: unknown[];
    };
    expect(inbox.jobs.finished.length).toBe(2);
    expect(inbox.jobs.queued.length).toBe(1);
    expect(inbox.proposals.length).toBe(1);
    expect(inbox.plans[0].steps.length).toBe(4);
    expect(inbox.grants.length).toBe(2);
    // the proposal decided on the desk: only the person, only recorded
    expect(store.decide(steps[3].id, "accepted", "someone-else")).toEqual({
      refused: "a proposal is decided by the person the plan was made for",
    });
    const decided = store.decide(steps[3].id, "rejected", subject);
    expect("refused" in decided ? null : decided.decided).toBe("rejected");
    expect(e.seen.some((s) => s.path === "/api/releases")).toBe(false);
  });

  it("a step without a standing grant waits with its reason, and a revoked grant stops the next one", async () => {
    const e = await stubEngine();
    closers.push(() => e.server.close());
    const { store, seamFor } = harness(e.url);
    const subject = "anna@lab";
    store.plan({
      id: "plan-half",
      conversation: "c-half",
      subject,
      instruction: "digest then classify",
      planned: planFrom(
        [
          { verb: "digest", args: { batch: 2 }, when: "now" },
          { verb: "run", args: { document: 3 }, when: { on_event: "job_finished" } },
        ],
        POLICY,
      ),
    });
    store.confirm("plan-half", subject);
    const scheduler = new Scheduler({ store, seamFor });
    let fired = await scheduler.tick();
    expect(fired[0]).toMatchObject({
      outcome: "waiting",
      reason: "no standing grant for POST /api/jobs; grant it under Settings and the step runs",
    });
    const g = store.grant(subject, "POST /api/jobs");
    fired = await scheduler.tick();
    expect(fired[0]).toMatchObject({ outcome: "queued" });
    e.state.jobs.set(100, "done");
    await scheduler.tick();
    fired = await scheduler.tick();
    expect(fired.find((f) => f.step === store.steps("plan-half")[1].id)).toMatchObject({
      outcome: "waiting",
      reason: expect.stringMatching(/no standing grant for POST \/api\/ask\/jobs/u),
    });
    // revoke, and the door closes again
    expect(store.revoke(g.id, subject)?.revoked_at).not.toBeNull();
    expect(store.grantFor(subject, "POST /api/jobs")).toBeNull();
    expect(store.revoke(g.id, "someone-else")).toBeNull();
  });

  it("C49: with the flag on, rung two is empty for a person without assist-run", async () => {
    const e = await stubEngine();
    closers.push(() => e.server.close());
    const { store, seamFor } = harness(e.url);
    const subject = "anna@lab";
    store.grant(subject, "POST /api/jobs");
    store.plan({
      id: "plan-c49",
      conversation: "c-c49",
      subject,
      instruction: "digest",
      planned: planFrom([{ verb: "digest", args: { batch: 2 } }], POLICY),
    });
    store.confirm("plan-c49", subject);
    const scheduler = new Scheduler({ store, seamFor, mayRun: () => false });
    const fired = await scheduler.tick();
    expect(fired[0]).toMatchObject({ outcome: "waiting", reason: expect.stringMatching(/assist-run/u) });
    expect(e.seen.some((s) => s.method === "POST")).toBe(false);
  });
});
