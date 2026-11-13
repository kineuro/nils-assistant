// SPDX-License-Identifier: AGPL-3.0-only
// A person's decision on a proposed change (one chat, 2026-10-09): POST
// /changes/:id/decide. The decision is a ledger row with the phase
// `approval` (or `decline`), written before anything is applied; an
// approved change is then applied here, in the host's code, under the
// person's own token: a job plan is confirmed through the plan's confirm path
// and its due steps fire; an analysis is queued as the job a person's Run
// queues; sorting words become the engine's proposed rule change (record 56:
// typed operations kept with their effect report) for an operator to adopt on
// the Rules page; a merge is made at the engine's merge door. An identity rule is
// recorded as approved: changing a dataset's rule and digesting again are
// done on the dataset's page. A query version is decided where it always
// was, on the conversation's feedback door.

import type { Seam } from "../seam/client.ts";
import type { Ledger } from "../seam/ledger.ts";
import { type ChangeRow, type ChangeState, type ChangeStore, outcomeOf, PLAN_GONE } from "./changes.ts";
import { PURPOSE } from "./purpose.ts";

/** The plans a job plan's change is settled against: the ladder's store, as much of it as that takes. */
export interface Plans {
  planById(id: string): { id: string; conversation: string; subject: string; state: string } | null;
  /** Take back a plan still proposed; true when it was. */
  drop(id: string): boolean;
}

export interface ApplyDeps {
  changes: ChangeStore;
  ledger: Ledger;
  /** The seam a person's approval runs through, for the change's conversation. */
  seam: (conversation: string) => Seam;
  /** The plan's confirm path: confirm it for the person, and fire what is due. */
  confirmPlan: (plan: string, subject: string) => Promise<Record<string, unknown> | { refused: string }>;
  /** The plans, so a job plan's change and its plan tell one outcome; without them a change is read by itself. */
  plans?: Plans;
}

export type Decided =
  | { ok: true; change: ChangeRow }
  | { ok: false; status: number; error: string; change?: ChangeRow };

function row(
  deps: Pick<ApplyDeps, "ledger">,
  c: ChangeRow,
  phase: string,
  operation: string,
  digest: string,
  ok = true,
): void {
  deps.ledger.record({
    at: Date.now(),
    conversation: c.conversation,
    station: "desk",
    phase,
    operation,
    argument_digest: digest,
    granted: true,
    reason: null,
    outcome: ok ? "ok" : "refused",
    status: ok ? 200 : 409,
    handle: null,
    ms: 0,
    ceiling: "reader",
    idempotency_key: null,
    method: "POST",
  });
}

/** Apply an approved change; what the engine or the ladder answered, or why it failed. */
async function apply(
  deps: ApplyDeps,
  c: ChangeRow,
): Promise<{ result: Record<string, unknown>; failed: boolean }> {
  const p = c.payload;
  const call = async (path: string, body: unknown) => {
    const a = await deps
      .seam(c.conversation)
      .call({ method: "POST", path, body, toolCallId: `decide-${c.id}`, phase: "apply" });
    return a.kind === "ok"
      ? { result: { applied: true, answer: a.body as Record<string, unknown> }, failed: false }
      : {
          result: {
            applied: false,
            why: a.kind === "blocked" || a.kind === "error" ? a.reason : `the engine answered ${a.status}`,
          },
          failed: true,
        };
  };
  switch (c.kind) {
    case "job_plan": {
      const r = await deps.confirmPlan(String(p.plan_id), c.subject);
      return "refused" in r
        ? { result: { applied: false, why: r.refused }, failed: true }
        : { result: { applied: true, plan: r }, failed: false };
    }
    case "analysis_plan": {
      // record 57 P7: a workflow the engine planned runs at its own door, over the same scope and choices
      // and the engine is told the run came from this proposal (record 57 P9), beside what it runs
      const proposed_by = { agent: PURPOSE, proposal: c.id };
      const wf = p.workflow as { label?: unknown; body?: unknown } | null | undefined;
      if (wf && typeof wf.label === "string")
        return call(`/api/workflows/${encodeURIComponent(wf.label)}/run`, {
          ...((wf.body as Record<string, unknown> | null | undefined) ?? {}),
          proposed_by,
        });
      if (!Array.isArray(p.command))
        return {
          result: {
            applied: false,
            why: "the plan has no run to queue; save the question as a selection and plan it again",
          },
          failed: true,
        };
      return call("/api/jobs", { command: p.command, proposed_by });
    }
    case "overlay": {
      // record 56: the rehearsed typed operations, proposed to the pack; a change kept before them carries the
      // overlay document, which the engine reads as the word edits it is
      const pack = typeof p.pack === "string" && p.pack ? p.pack : "mri";
      const body = Array.isArray(p.operations)
        ? {
            title: p.title ?? p.name,
            operations: p.operations,
            cases: p.cases,
            reason: p.reason,
            evidence: p.evidence,
          }
        : { title: p.name, overlay: p.overlay, reason: p.why, evidence: { overlay: p.name } };
      return call(`/api/packs/${encodeURIComponent(pack)}/proposals`, body);
    }
    case "identity_merge":
      return call("/api/linkage/merge", { canonical: p.canonical, alias: p.alias, why: p.why });
    case "identity_rule":
      return {
        result: {
          applied: false,
          recorded: true,
          next: "change the dataset's identity rule on its page, then digest it again",
        },
        failed: false,
      };
    case "query_version":
      return {
        result: { applied: false, why: "a query version is decided on the conversation's feedback" },
        failed: true,
      };
  }
}

/**
 * A job plan's change read with its plan (2026-11-13). A job plan shows as two cards, the change's ("waits for
 * you", decided here) and the plan's own (confirmed at the plan's door), and a person answers either. In a live
 * test the plan's card was confirmed, the plan ran, and the change stayed open, so its card went on saying that it
 * waited. An open change whose plan is confirmed or done is settled as approved, with a ledger row for the
 * approval and a result that says it came through the plan's card; one whose plan is no longer kept is expired.
 * A change whose plan still waits, or any other change, is returned as it is.
 */
export function settled(deps: Pick<ApplyDeps, "changes" | "ledger" | "plans">, c: ChangeRow): ChangeRow {
  if (c.kind !== "job_plan" || c.state !== "open" || !deps.plans) return c;
  const plan = deps.plans.planById(String(c.payload.plan_id ?? ""));
  if (plan?.state === "proposed") return c;
  if (!plan) return deps.changes.settle(c.id, "expired", { applied: false, why: PLAN_GONE }) ?? c;
  const after = deps.changes.settle(c.id, "approved", {
    applied: true,
    through: "plan",
    plan: { id: plan.id, state: plan.state },
  });
  if (!after) return deps.changes.get(c.id) ?? c;
  row(deps, after, "approval", `changes/${after.kind}`, "approved");
  return after;
}

/** The change whose card proposed a plan, or null: the plan's conversation holds it, and its payload names the plan. */
export function changeOfPlan(
  changes: Pick<ChangeStore, "of">,
  plan: { id: string; conversation: string },
): ChangeRow | null {
  return (
    changes.of(plan.conversation).find((c) => c.kind === "job_plan" && c.payload.plan_id === plan.id) ?? null
  );
}

/**
 * The inbox's plans, each with the change whose card proposed it (`change`: its id, where it stands and what
 * happened), settled first, so the plan's card and the change's card are one thing to whoever draws them; null
 * for a plan no change proposed (the operator station's).
 */
export function plansWithChanges<P extends { id: string }>(
  deps: Pick<ApplyDeps, "changes" | "ledger" | "plans">,
  subject: string,
  plans: P[],
): (P & { change: { id: string; state: ChangeState; outcome: string | null } | null })[] {
  const byPlan = new Map(deps.changes.jobPlans(subject).map((c) => [String(c.payload.plan_id ?? ""), c]));
  return plans.map((p) => {
    const found = byPlan.get(p.id);
    const c = found ? settled(deps, found) : null;
    return { ...p, change: c ? { id: c.id, state: c.state, outcome: outcomeOf(c) } : null };
  });
}

/** The change a person may decide: their own, or none, so a stranger's id tells them nothing. */
export function ownChange(changes: Pick<ChangeStore, "get">, id: string, subject: string): ChangeRow | null {
  const c = changes.get(id);
  return c && c.subject === subject ? c : null;
}

const NOT_YOURS: Decided = { ok: false, status: 404, error: "no such change of yours" };

/** A person decides one change: recorded first, then applied when approved. */
export async function decide(
  deps: ApplyDeps,
  id: string,
  subject: string,
  verdict: "approved" | "declined",
): Promise<Decided> {
  // whose the change is comes first: a stranger learns nothing of it, not even its kind
  const own = ownChange(deps.changes, id, subject);
  if (!own) return NOT_YOURS;
  if (own.kind === "query_version")
    return {
      ok: false,
      status: 409,
      error: "a query version is accepted or disregarded on the conversation's feedback",
      change: own,
    };
  // a job plan answered on the plan's own card is settled already: approving it here is the same outcome, never
  // a second confirm and never an error on a card that only had not heard yet
  const before = settled(deps, own);
  if (before.kind === "job_plan" && before.state === "expired")
    return { ok: false, status: 409, error: outcomeOf(before) ?? PLAN_GONE, change: before };
  if (before.kind === "job_plan" && before.state === "approved" && before.result?.through === "plan")
    return verdict === "approved"
      ? { ok: true, change: before }
      : {
          ok: false,
          status: 409,
          error: "the plan was approved on its own card already, so it cannot be declined here",
          change: before,
        };
  const d = deps.changes.decide(id, subject, verdict);
  if ("refused" in d) return { ok: false, status: d.status, error: d.refused };
  row(deps, d, verdict === "approved" ? "approval" : "decline", `changes/${d.kind}`, verdict);
  if (verdict === "declined") {
    // a declined job plan leaves no plan waiting on a card of its own: the plan, still proposed, is taken back
    if (d.kind !== "job_plan" || !deps.plans) return { ok: true, change: d };
    const taken = deps.plans.drop(String(d.payload.plan_id ?? ""));
    return { ok: true, change: deps.changes.applied(d.id, { applied: false, plan_taken_back: taken }) ?? d };
  }
  const r = await apply(deps, d);
  const after = deps.changes.applied(d.id, r.result, r.failed) ?? d;
  return r.failed
    ? { ok: false, status: 502, error: String(r.result.why ?? "it was not applied"), change: after }
    : { ok: true, change: after };
}

/**
 * The decide door's work (2026-10-10, review of the one chat): the change must be the caller's before anything of
 * theirs is kept, so a stranger holding a change's id cannot leave their token on its conversation, where its tools
 * and the plan's later steps would run under it. Then the token is kept for the change's conversation, and the
 * person decides.
 */
export async function decideAs(
  deps: ApplyDeps,
  id: string,
  subject: string,
  verdict: "approved" | "declined",
  keepToken: (conversation: string) => void,
): Promise<Decided> {
  const mine = ownChange(deps.changes, id, subject);
  if (!mine) return NOT_YOURS;
  keepToken(mine.conversation);
  return decide(deps, id, subject, verdict);
}

export type Confirmed =
  | { ok: true; plan: Record<string, unknown>; change: ChangeRow | null }
  | { ok: false; status: number; error: string };

/**
 * The plan's confirm door's work (2026-11-13). The person's token is kept for the plan's conversation, as the
 * decide door keeps it for a change's, once the plan is the caller's: without it the scheduler had no token to act
 * with, and a step due now stayed "waiting, the person's token is not held" until the desk's next token push, a
 * minute later. Then the plan is confirmed and what is due fires, and the change whose card proposed the plan is
 * settled as approved, so its card no longer waits beside a plan that ran.
 */
export async function confirmAs(
  deps: ApplyDeps & { plans: Plans },
  id: string,
  subject: string,
  keepToken: (conversation: string) => void,
): Promise<Confirmed> {
  const mine = deps.plans.planById(id);
  // a stranger holding a plan's id leaves no token on its conversation: the plan must be the caller's first
  if (mine && mine.subject === subject) keepToken(mine.conversation);
  const r = await deps.confirmPlan(id, subject);
  if ("refused" in r) return { ok: false, status: 409, error: String(r.refused) };
  const sibling = mine ? changeOfPlan(deps.changes, mine) : null;
  return { ok: true, plan: r, change: sibling ? settled(deps, sibling) : null };
}
