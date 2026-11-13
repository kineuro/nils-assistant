// SPDX-License-Identifier: AGPL-3.0-only
// A job plan's two cards (2026-11-13, a live test). `propose_change` with kind
// job_plan keeps a change (its card says "waits for you", and is decided at
// the changes' decide door) and a plan (its own card, confirmed at the plan's
// confirm door). A person confirmed the plan's card, and two things went
// wrong, each held here:
// - the confirm door did not keep the person's token for the plan's
//   conversation, as the decide door does, so the step that was due now
//   stayed "waiting, the person's token is not held" until the desk's next
//   token push;
// - the change stayed open beside a plan that ran, so its card went on saying
//   that it waited.
// A plan answered through either door settles the other, and both are told
// as one outcome: by the change's view, the confirm door's answer and the
// inbox's plans.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { planFrom } from "../src/host/ladder.ts";
import { LadderStore } from "../src/host/ladder-store.ts";
import { inboxOf, Scheduler } from "../src/host/scheduler.ts";
import { confirmAs, decideAs, plansWithChanges, settled } from "../src/one/apply.ts";
import { ChangeStore, changeView } from "../src/one/changes.ts";
import { Seam } from "../src/seam/client.ts";
import { Ledger } from "../src/seam/ledger.ts";
import { Tokens } from "../src/seam/tokens.ts";
import { stubEngine } from "./child/stub-engine.ts";

const POLICY = [
  { door: "POST /api/ask/jobs", grant: "query:work", writes: true, idempotent: true, cost: "job" },
];

const dir = mkdtempSync(join(tmpdir(), "plan-cards-"));
let nextJob = 100;
const engine = await stubEngine((c) => {
  if (c.method === "POST" && c.path === "/api/ask/jobs") {
    nextJob += 1;
    return { status: 202, body: { job: nextJob, state: "queued" } };
  }
  if (c.method === "GET" && c.path.startsWith("/api/jobs/")) return { body: { state: "running" } };
  return null;
});
afterAll(() => engine.close());

const ledger = new Ledger(join(dir, "seam.sqlite"));
const ladder = new LadderStore(join(dir, "ladder.sqlite"));
const changes = new ChangeStore(join(dir, "changes.sqlite"));
// the host's own wiring: the scheduler acts for a plan's person only while their token is held for its conversation
const tokens = new Tokens();
const seamFor = (conversation: string) =>
  tokens.get(conversation)
    ? new Seam({
        engine: engine.url,
        station: {
          id: "scheduler",
          version: "t",
          grant: { jobs: {}, "jobs/{id}": {}, capabilities: {} },
          ceiling: "operator",
          content: "catalog",
          model: "none",
          standing: true,
        },
        conversation,
        token: () => tokens.get(conversation),
        ledger,
      })
    : null;
const scheduler = new Scheduler({
  store: ladder,
  seamFor,
  // the person is an admin, whose steps need no standing grant (record 55, ruling 24)
  personOf: async () => ({ admin: true, policy: POLICY }),
});
/** The plan's confirm path as the host has it: confirm, then fire what is due at once. */
async function confirmPlan(plan: string, subject: string) {
  const confirmed = ladder.confirm(plan, subject);
  if ("refused" in confirmed) return confirmed;
  const fired = await scheduler.tick();
  return {
    ...confirmed,
    steps: ladder.steps(plan),
    fired: fired.filter((f) => ladder.step(f.step)?.plan === plan),
  };
}
const deps = {
  changes,
  ledger,
  seam: () => {
    throw new Error("a job plan is applied through its plan, never through the engine's doors");
  },
  confirmPlan,
  plans: ladder,
};

/** A job plan as `propose_change` keeps it: the plan's rows, then the change whose payload names the plan. */
function proposed(conversation: string, subject = "anna@lab", document = 31) {
  const plan = `plan-${conversation}`;
  ladder.plan({
    id: plan,
    conversation,
    subject,
    instruction: `Run question ${document} as a job.`,
    planned: planFrom([{ verb: "run", args: { document } }], POLICY, ["query:work"]),
  });
  const change = changes.propose({
    conversation,
    subject,
    kind: "job_plan",
    sentence: `Run question ${document} as a job.`,
    lines: [`1. run question ${document}`],
    payload: { plan_id: plan },
  });
  return { plan, change: change.id };
}
const keep = (token: string) => (conversation: string) => {
  tokens.put(conversation, token);
};
const queuedBy = (token: string) =>
  engine.seen.filter(
    (x) =>
      x.method === "POST" && x.path === "/api/ask/jobs" && x.headers?.authorization === `Bearer ${token}`,
  );

describe("the plan's confirm door", () => {
  it("left a step that was due now waiting while no token was kept for the plan's conversation", async () => {
    // what the door did before: the plan confirmed and the scheduler ticked, with nobody's token to act with
    const { plan } = proposed("c-no-token");
    const r = await confirmPlan(plan, "anna@lab");
    expect(r).toMatchObject({
      state: "confirmed",
      fired: [{ outcome: "waiting", reason: "token_unavailable" }],
    });
    expect(ladder.steps(plan)[0]).toMatchObject({
      state: "waiting",
      reason: "the person's token is not held; open the desk and the step runs",
    });
  });

  it("keeps the person's token as the decide door does, so the step fires at once", async () => {
    const { plan, change } = proposed("c-confirm");
    const r = await confirmAs(deps, plan, "anna@lab", keep("t-anna-1"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(tokens.get("c-confirm")).toBe("t-anna-1");
    // the step due now was queued in the same call, under the person's own token
    expect(r.plan).toMatchObject({ id: plan, state: "confirmed" });
    const [fired] = r.plan.fired as { outcome: string; job: number; reason: string | null }[];
    expect(fired).toMatchObject({ outcome: "queued", reason: null });
    expect(ladder.steps(plan)[0]).toMatchObject({ state: "queued", reason: null, job: fired.job });
    expect(queuedBy("t-anna-1").map((x) => x.body)).toEqual([{ document_id: 31 }]);
    // and the change whose card proposed the plan is settled with it
    expect(r.change).toMatchObject({ id: change, state: "approved" });
  });

  it("keeps no token for a plan that is not the caller's, and tells a stranger what it told before", async () => {
    const { plan } = proposed("c-stranger");
    const kept: string[] = [];
    const r = await confirmAs(deps, plan, "ben@lab", (c) => kept.push(c));
    expect(r).toEqual({ ok: false, status: 409, error: "a plan is confirmed by the person it was made for" });
    expect(kept).toEqual([]);
    expect(await confirmAs(deps, "plan-none", "ben@lab", (c) => kept.push(c))).toEqual({
      ok: false,
      status: 409,
      error: "no plan plan-none",
    });
    expect(kept).toEqual([]);
    expect(ladder.planById(plan)?.state).toBe("proposed");
    expect(changes.of("c-stranger")[0].state).toBe("open");
  });
});

describe("a plan answered through either door settles the other", () => {
  it("settles the change when the plan's own card is confirmed, and says how", async () => {
    const { plan, change } = proposed("c-plan-card");
    expect(changeView(changes.get(change) as never)).toMatchObject({
      state: "open",
      decided: null,
      outcome: null,
    });
    await confirmAs(deps, plan, "anna@lab", keep("t-anna-2"));
    const after = changes.get(change);
    expect(after).toMatchObject({
      state: "approved",
      result: { applied: true, through: "plan", plan: { id: plan, state: "confirmed" } },
    });
    expect(after?.decided_at).not.toBeNull();
    expect(changeView(after as never)).toMatchObject({
      state: "approved",
      decided: "approved",
      outcome: "approved on the plan's own card; the plan is confirmed",
    });
    // the approval is in the ledger, as one given on the change's own card is
    const rows = ledger.rows("c-plan-card");
    expect(rows.filter((x) => x.phase === "approval" && x.operation === "changes/job_plan").length).toBe(1);
  });

  it("answers Approve on the change's card after that with the same outcome, and queues nothing twice", async () => {
    const { plan, change } = proposed("c-both");
    await confirmAs(deps, plan, "anna@lab", keep("t-anna-3"));
    const jobs = queuedBy("t-anna-3").length;
    expect(jobs).toBe(1);
    // the card that had not heard yet: its Approve is the same outcome, never "the change was approved already"
    const again = await decideAs(deps, change, "anna@lab", "approved", keep("t-anna-3"));
    expect(again).toMatchObject({ ok: true, change: { id: change, state: "approved" } });
    expect(queuedBy("t-anna-3").length).toBe(jobs);
    expect(ledger.rows("c-both").filter((x) => x.phase === "approval").length).toBe(1);
    // its Not now cannot take back a plan that is running, and says why
    const declined = await decideAs(deps, change, "anna@lab", "declined", keep("t-anna-3"));
    expect(declined).toMatchObject({
      ok: false,
      status: 409,
      error: "the plan was approved on its own card already, so it cannot be declined here",
      change: { state: "approved" },
    });
    expect(ladder.planById(plan)?.state).toBe("confirmed");
  });

  it("confirms the plan as now when the change's card is approved, and the plan's card then agrees", async () => {
    const { plan, change } = proposed("c-change-card");
    const r = await decideAs(deps, change, "anna@lab", "approved", keep("t-anna-4"));
    expect(r).toMatchObject({ ok: true, change: { state: "approved", result: { applied: true } } });
    expect(ladder.planById(plan)?.state).toBe("confirmed");
    expect(ladder.steps(plan)[0].state).toBe("queued");
    expect(queuedBy("t-anna-4").length).toBe(1);
    if (r.ok) expect(changeView(r.change).outcome).toBe("approved; the plan is confirmed");
    // the plan's own card pressed after it: confirmed already, nothing queued twice, the change as it was
    const pressed = await confirmAs(deps, plan, "anna@lab", keep("t-anna-4"));
    expect(pressed).toMatchObject({ ok: true, plan: { state: "confirmed" }, change: { state: "approved" } });
    expect(queuedBy("t-anna-4").length).toBe(1);
    expect(ledger.rows("c-change-card").filter((x) => x.phase === "approval").length).toBe(1);
  });

  it("takes the plan back when the change is declined, so no plan card is left to confirm", async () => {
    const { plan, change } = proposed("c-declined");
    expect((inboxOf(ladder, "anna@lab").plans as { id: string }[]).some((p) => p.id === plan)).toBe(true);
    const r = await decideAs(deps, change, "anna@lab", "declined", keep("t-anna-5"));
    expect(r).toMatchObject({
      ok: true,
      change: { state: "declined", result: { applied: false, plan_taken_back: true } },
    });
    if (r.ok)
      expect(changeView(r.change)).toMatchObject({
        decided: "declined",
        outcome: "declined; the plan was taken back",
      });
    expect(ladder.planById(plan)).toBeNull();
    expect((inboxOf(ladder, "anna@lab").plans as { id: string }[]).some((p) => p.id === plan)).toBe(false);
    expect(await confirmAs(deps, plan, "anna@lab", keep("t-anna-5"))).toEqual({
      ok: false,
      status: 409,
      error: `no plan ${plan}`,
    });
    expect(queuedBy("t-anna-5")).toEqual([]);
  });

  it("reads a change whose plan is no longer kept as expired, never as waiting", async () => {
    const { plan, change } = proposed("c-expired");
    // the plan's rows are swept after the retention days; the change is kept
    expect(ladder.drop(plan)).toBe(true);
    const read = settled(deps, changes.get(change) as never);
    expect(changeView(read)).toMatchObject({
      state: "expired",
      decided: null,
      outcome: "the plan is no longer kept, so there is nothing left to approve",
    });
    expect(await decideAs(deps, change, "anna@lab", "approved", keep("t-anna-6"))).toMatchObject({
      ok: false,
      status: 409,
      error: "the plan is no longer kept, so there is nothing left to approve",
      change: { state: "expired" },
    });
  });

  it("leaves a change whose plan still waits, and any other kind of change, as they are", () => {
    const { change } = proposed("c-waits");
    expect(settled(deps, changes.get(change) as never).state).toBe("open");
    const merge = changes.propose({
      conversation: "c-waits",
      subject: "anna@lab",
      kind: "identity_merge",
      sentence: "Treat two identities as one person.",
      payload: { canonical: "SYN0001", alias: "SYN0002" },
    });
    expect(settled(deps, merge)).toEqual(merge);
    // without the plans, a change is read by itself, as before
    expect(settled({ changes, ledger }, changes.get(change) as never).state).toBe("open");
  });
});

describe("the inbox's plans", () => {
  it("carry the change whose card proposed each, and settle one left open beside a confirmed plan", async () => {
    const subject = "cy@lab";
    const waits = proposed("c-inbox-waits", subject, 41);
    const ran = proposed("c-inbox-ran", subject, 42);
    // a plan confirmed before the confirm door settled its change: the change is still open in the store
    ladder.confirm(ran.plan, subject);
    expect(changes.get(ran.change)?.state).toBe("open");
    // and a plan no change proposed (the operator station's)
    ladder.plan({
      id: "plan-inbox-alone",
      conversation: "c-inbox-alone",
      subject,
      instruction: "Run question 43 as a job.",
      planned: planFrom([{ verb: "run", args: { document: 43 } }], POLICY, ["query:work"]),
    });
    const plans = plansWithChanges(
      deps,
      subject,
      inboxOf(ladder, subject).plans as { id: string; state: string }[],
    );
    const byId = Object.fromEntries(plans.map((p) => [p.id, p]));
    expect(byId[waits.plan]).toMatchObject({
      state: "proposed",
      change: { id: waits.change, state: "open", outcome: null },
    });
    expect(byId[ran.plan]).toMatchObject({
      state: "confirmed",
      change: {
        id: ran.change,
        state: "approved",
        outcome: "approved on the plan's own card; the plan is confirmed",
      },
    });
    expect(byId["plan-inbox-alone"].change).toBeNull();
    expect(changes.get(ran.change)?.state).toBe("approved");
  });
});
