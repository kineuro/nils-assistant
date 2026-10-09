// SPDX-License-Identifier: AGPL-3.0-only
// A person's decision on a proposed change (one chat, 2026-10-09): POST
// /changes/:id/decide. The decision is a ledger row with the phase
// `approval` (or `decline`), written before anything is applied; an
// approved change is then applied here, in the host's code, under the
// person's own token: a job plan is confirmed through the plan's confirm path
// and its due steps fire; an analysis is queued as the job a person's Run
// queues; sorting words become the engine's overlay proposal for an operator
// to adopt; a merge is made at the engine's merge door. An identity rule is
// recorded as approved: changing a dataset's rule and digesting again are
// done on the dataset's page. A query version is decided where it always
// was, on the conversation's feedback door.

import type { Seam } from "../seam/client.ts";
import type { Ledger } from "../seam/ledger.ts";
import type { ChangeRow, ChangeStore } from "./changes.ts";

export interface ApplyDeps {
  changes: ChangeStore;
  ledger: Ledger;
  /** The seam a person's approval runs through, for the change's conversation. */
  seam: (conversation: string) => Seam;
  /** The plan's confirm path: confirm it for the person, and fire what is due. */
  confirmPlan: (plan: string, subject: string) => Promise<Record<string, unknown> | { refused: string }>;
}

export type Decided =
  | { ok: true; change: ChangeRow }
  | { ok: false; status: number; error: string; change?: ChangeRow };

function row(
  deps: ApplyDeps,
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
      if (!Array.isArray(p.command))
        return {
          result: {
            applied: false,
            why: "the plan has no run to queue; save the question as a selection and plan it again",
          },
          failed: true,
        };
      return call("/api/jobs", { command: p.command });
    }
    case "overlay":
      return call("/api/overlays", { name: p.name, overlay: p.overlay, scope: p.scope, why: p.why });
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

/** A person decides one change: recorded first, then applied when approved. */
export async function decide(
  deps: ApplyDeps,
  id: string,
  subject: string,
  verdict: "approved" | "declined",
): Promise<Decided> {
  const before = deps.changes.get(id);
  if (before?.kind === "query_version")
    return {
      ok: false,
      status: 409,
      error: "a query version is accepted or disregarded on the conversation's feedback",
      change: before,
    };
  const d = deps.changes.decide(id, subject, verdict);
  if ("refused" in d) return { ok: false, status: d.status, error: d.refused };
  row(deps, d, verdict === "approved" ? "approval" : "decline", `changes/${d.kind}`, verdict);
  if (verdict === "declined") return { ok: true, change: d };
  const r = await apply(deps, d);
  const after = deps.changes.applied(d.id, r.result, r.failed) ?? d;
  return r.failed
    ? { ok: false, status: 502, error: String(r.result.why ?? "it was not applied"), change: after }
    : { ok: true, change: after };
}
