// SPDX-License-Identifier: AGPL-3.0-only
// The scheduler (Wave 5 section 9.3, D70): a confirmed plan's rung-two
// steps fire on an engine event or at a time, each under the person's
// standing grant for that verb, each a job the person finds in the inbox
// and in the engine's audit, whose row names the person and the grant. A
// step without a grant waits with its reason. Rung-three steps are never
// run: they are proposals until a person accepts them on the desk. The
// engine is reached through the seam like every other call, with the
// person's own token, so the engine's roles bound what runs, never the
// assistant's.

import type { Answer, Seam } from "../seam/client.ts";
import { VERBS, type When } from "./ladder.ts";
import type { LadderStore, StepRow } from "./ladder-store.ts";

export interface SchedulerOptions {
  store: LadderStore;
  /** The seam for a plan's conversation, carrying the person's token; null when the desk handed none. */
  seamFor: (conversation: string) => Seam | null;
  /** C49: whether rung two is open to this person at all. */
  mayRun?: (subject: string) => boolean;
  now?: () => number;
}

export interface Fired {
  step: number;
  outcome: "queued" | "waiting" | "failed" | "done" | "running";
  reason: string | null;
  job: number | null;
}

/** The engine's view of a job, read through the seam. */
async function jobState(
  seam: Seam,
  id: number,
  toolCallId: string,
): Promise<{ state: string; finished: boolean } | null> {
  const a = await seam.call({ method: "GET", path: `/api/jobs/${id}`, toolCallId, phase: "schedule" });
  if (a.kind !== "ok") return null;
  const b = a.body as { state?: string };
  const state = String(b.state ?? "unknown");
  return { state, finished: ["done", "failed", "cancelled"].includes(state) };
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  constructor(private readonly o: SchedulerOptions) {
    this.now = o.now ?? Date.now;
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((e: unknown) => {
        console.error(
          `nils-assistant: the scheduler tick failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over every open step of every confirmed plan: fire what is due, follow what was queued. */
  async tick(): Promise<Fired[]> {
    const out: Fired[] = [];
    for (const step of this.o.store.openSteps()) {
      const plan = this.o.store.planById(step.plan);
      if (!plan) continue;
      const seam = this.o.seamFor(plan.conversation);
      if (!seam) {
        // no token to act as the person: the step waits, and says so
        if (step.state === "waiting")
          this.o.store.setStep(step.id, {
            reason: "the person's token is not held; open the desk and the step runs",
          });
        out.push({ step: step.id, outcome: "waiting", reason: "token_unavailable", job: step.job });
        continue;
      }
      if (step.state === "queued" || step.state === "running") {
        out.push(await this.follow(seam, step));
        continue;
      }
      const due = await this.due(seam, plan.subject, step);
      if (!due.ok) {
        if (due.reason !== step.reason) this.o.store.setStep(step.id, { reason: due.reason });
        out.push({ step: step.id, outcome: "waiting", reason: due.reason, job: null });
        continue;
      }
      out.push(await this.fire(seam, plan.subject, step));
    }
    return out;
  }

  /** Whether a step's condition holds and its grant stands; the reason when not. */
  private async due(
    seam: Seam,
    subject: string,
    step: StepRow,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (this.o.mayRun && !this.o.mayRun(subject))
      return {
        ok: false,
        reason: "rung two is closed to this person: the assist-run entitlement is required here (C49)",
      };
    const grant = this.o.store.grantFor(subject, step.door);
    if (!grant)
      return {
        ok: false,
        reason: `no standing grant for ${step.door}; grant it under Settings and the step runs`,
      };
    const w = step.when ?? "now";
    const holds = await this.holds(seam, step, w);
    return holds ? { ok: true } : { ok: false, reason: `waiting: ${describe(w)}` };
  }

  private async holds(seam: Seam, step: StepRow, w: When): Promise<boolean> {
    if (w === "now") return true;
    const id = `schedule-${step.id}-${this.now()}`;
    if ("at" in w) return this.now() >= Date.parse(w.at);
    if ("after_job" in w) return (await jobState(seam, w.after_job, id))?.finished === true;
    if (w.on_event === "job_finished") {
      // the step before it in the plan
      const before = this.o.store
        .steps(step.plan)
        .filter((s) => s.rung === 2 && s.n < step.n)
        .at(-1);
      if (!before) return true;
      return before.state === "done";
    }
    // batch_landed: a batch finished since the plan was confirmed, or the batch the step names
    const plan = this.o.store.planById(step.plan);
    const a = await seam.call({
      method: "GET",
      path: "/api/batches?limit=20",
      toolCallId: id,
      phase: "schedule",
    });
    if (a.kind !== "ok") return false;
    const batches = (
      (a.body as { batches?: { id: number; state: string; finished_at: string | null }[] }).batches ?? []
    ).filter((b) => b.state === "done" && b.finished_at);
    const named = typeof step.args.batch === "number" ? step.args.batch : null;
    if (named !== null) return batches.some((b) => b.id === named);
    const since = plan?.confirmed_at ?? 0;
    return batches.some((b) => Date.parse(String(b.finished_at)) >= since);
  }

  /** Queue the step's job under the grant; the actor header names the person's grant. */
  private async fire(seam: Seam, subject: string, step: StepRow): Promise<Fired> {
    const grant = this.o.store.grantFor(subject, step.door) as { id: number };
    const spec = VERBS[step.verb];
    const call = spec.call(step.args);
    if ("refused" in call) {
      this.o.store.setStep(step.id, { state: "failed", reason: call.refused, finished_at: this.now() });
      return { step: step.id, outcome: "failed", reason: call.refused, job: null };
    }
    const a: Answer = await seam.call({
      method: "POST",
      path: call.path,
      body: call.body,
      toolCallId: `plan-${step.plan}-step-${step.n}`,
      phase: "schedule",
      grant: grant.id,
    });
    if (a.kind !== "ok") {
      const reason =
        a.kind === "refused"
          ? `the engine refused: ${String((a.body as { error?: unknown })?.error ?? a.status)}`
          : a.kind === "blocked"
            ? a.reason
            : a.reason;
      this.o.store.setStep(step.id, { state: "failed", reason, grant: grant.id, finished_at: this.now() });
      return { step: step.id, outcome: "failed", reason, job: null };
    }
    const job = (a.body as { job?: number }).job ?? null;
    this.o.store.setStep(step.id, {
      state: "queued",
      reason: null,
      job,
      grant: grant.id,
      queued_at: this.now(),
    });
    return { step: step.id, outcome: "queued", reason: null, job };
  }

  /** Follow a queued job to its end. */
  private async follow(seam: Seam, step: StepRow): Promise<Fired> {
    if (step.job === null) {
      this.o.store.setStep(step.id, { state: "done", finished_at: this.now() });
      return { step: step.id, outcome: "done", reason: null, job: null };
    }
    const j = await jobState(seam, step.job, `follow-${step.id}-${this.now()}`);
    if (!j)
      return {
        step: step.id,
        outcome: step.state === "running" ? "running" : "queued",
        reason: null,
        job: step.job,
      };
    if (j.finished) {
      const state = j.state === "done" ? "done" : "failed";
      this.o.store.setStep(step.id, {
        state,
        reason: state === "failed" ? `the job ended ${j.state}` : null,
        finished_at: this.now(),
      });
      return { step: step.id, outcome: state, reason: null, job: step.job };
    }
    if (j.state === "running" && step.state !== "running")
      this.o.store.setStep(step.id, { state: "running" });
    return { step: step.id, outcome: "running", reason: null, job: step.job };
  }
}

function describe(w: When): string {
  if (w === "now") return "now";
  if ("at" in w) return `until ${w.at}`;
  if ("after_job" in w) return `for job ${w.after_job} to finish`;
  return w.on_event === "batch_landed" ? "for a batch to land" : "for the step before it to finish";
}

/** The inbox (section 9.4): what the assistant and the engine did for one person. */
export function inboxOf(store: LadderStore, subject: string): Record<string, unknown> {
  const plans = store.plans(subject).map((p) => {
    const steps = store.steps(p.id);
    return {
      id: p.id,
      conversation: p.conversation,
      instruction: p.instruction,
      state: p.state,
      created_at: new Date(p.created_at).toISOString(),
      confirmed_at: p.confirmed_at === null ? null : new Date(p.confirmed_at).toISOString(),
      steps: steps.map((s) => ({
        id: s.id,
        n: s.n,
        rung: s.rung,
        verb: s.verb,
        door: s.door,
        words: s.words,
        state: s.state,
        reason: s.reason,
        job: s.job,
        grant: s.grant,
        queued_at: s.queued_at === null ? null : new Date(s.queued_at).toISOString(),
        finished_at: s.finished_at === null ? null : new Date(s.finished_at).toISOString(),
        decided: s.decided,
      })),
    };
  });
  const jobs = plans.flatMap((p) =>
    p.steps.filter((s) => s.rung === 2 && s.job !== null).map((s) => ({ ...s, plan: p.id })),
  );
  const proposals = plans.flatMap((p) =>
    p.steps.filter((s) => s.rung === 3 && s.decided === null).map((s) => ({ ...s, plan: p.id })),
  );
  return {
    subject,
    jobs: {
      queued: jobs.filter((j) => j.state === "queued"),
      running: jobs.filter((j) => j.state === "running"),
      finished: jobs.filter((j) => j.state === "done"),
      failed: jobs.filter((j) => j.state === "failed"),
    },
    waiting: plans.flatMap((p) =>
      p.steps
        .filter((s) => s.rung === 2 && s.state === "waiting" && s.reason)
        .map((s) => ({ ...s, plan: p.id })),
    ),
    plans,
    proposals,
    grants: store
      .grants(subject)
      .filter((g) => g.revoked_at === null)
      .map((g) => ({ id: g.id, door: g.door, created_at: new Date(g.created_at).toISOString() })),
  };
}
