// SPDX-License-Identifier: AGPL-3.0-only
// The checks before a turn settles (one chat, 2026-10-09): the stations'
// own checks, keyed on the skill the turn activated (or the tool it used
// that belongs to it), and the plain-words check on the answer, run when the
// model would stop. A complaint sends the turn back once with what to fix;
// the second time the turn settles as it is, so a check can never loop.

import { VERBS } from "../host/ladder.ts";
import type { Seam } from "../seam/client.ts";
import { heldReading, shapeCounts } from "../stations/identity-check.ts";
import { ladderStore } from "../stations/operator.ts";
import { answerOf, type ConversationState, type TurnState } from "./state.ts";
import { alikePairs } from "./tools.ts";
import { unplainWords } from "./words.ts";

const SQL =
  /\bselect\b[\s\S]{0,600}?\bfrom\b|\b(?:insert\s+into|delete\s+from|update\s+\w+\s+set|create\s+table|drop\s+table)\b/iu;
const PERSONAL = /\b(?:19|20)\d{6}-?\d{4}\b|\b\d+(?:\.\d+){5,}\b/u;

export interface CheckContext {
  turn: TurnState;
  convo: ConversationState;
  conversation: string;
  /** The seam a document is validated through; null where none is open. */
  validate: ((document: number) => Promise<string | null>) | null;
}

/** The skills a turn counts as active: those it activated, and those whose tools it used. */
export function activeSkills(t: TurnState): Set<string> {
  const s = new Set(t.skills);
  if (t.drafted.length) s.add("find-data");
  for (const p of t.proposed) {
    if (p.kind === "job_plan") s.add("plan-work");
    if (p.kind === "analysis_plan") s.add("plan-analysis");
    if (p.kind === "overlay") s.add("tune-sorting-words");
    if (p.kind === "identity_merge" || p.kind === "identity_rule") s.add("check-identities");
  }
  if (t.runs.length) s.add("read-run");
  return s;
}

/** What is wrong with the turn as it would settle; empty when nothing is. */
export async function complaintsOf(c: CheckContext): Promise<string[]> {
  const out: string[] = [];
  const answer = answerOf(c.turn);
  const words = unplainWords(answer);
  if (words.length)
    out.push(
      `the answer uses words a person should not need: ${words.join(", ")}. Say it again in everyday words, without them`,
    );
  if (SQL.test(answer)) out.push("the answer carries SQL; say what was counted in words");
  if (PERSONAL.test(answer)) out.push("the answer carries an identifier value; leave it out");
  const active = activeSkills(c.turn);
  if (active.has("find-data") && c.turn.drafted.length && c.validate) {
    const last = c.turn.drafted.at(-1) as number;
    const why = await c.validate(last);
    if (why)
      out.push(
        `the last question drafted (document ${last}) does not validate: ${why}. Fix it and draft again`,
      );
  }
  if (active.has("plan-work") && !c.turn.asked) {
    const plan = c.turn.proposed.find((p) => p.kind === "job_plan");
    if (!plan)
      out.push(
        "an instruction to act becomes a plan: propose it with propose_change, kind job_plan, or say in one sentence why it cannot be planned",
      );
    else {
      const id = plan.details.plan_id;
      const store = ladderStore();
      for (const s of typeof id === "string" && store ? store.steps(id) : [])
        if (!VERBS[s.verb]) out.push(`step ${s.n} names no verb the plan knows`);
    }
  }
  if (active.has("plan-analysis")) {
    const plan = c.turn.proposed.find((p) => p.kind === "analysis_plan");
    const pf = plan?.details.preflight as { units?: { ready?: number } } | null | undefined;
    if (plan && !answer.toLowerCase().includes(String(plan.details.pipeline ?? "").toLowerCase()))
      out.push(`say which analysis it is: ${String(plan.details.pipeline)}`);
    if (plan && typeof pf?.units?.ready === "number" && !answer.includes(String(pf.units.ready)))
      out.push(`restate the check's own number: ${pf.units.ready} units ready`);
  }
  if (active.has("read-run")) {
    const r = c.turn.runs.at(-1);
    const a = answer.toLowerCase();
    if (r && r.failed > 0 && !a.includes(String(r.failed)))
      out.push(`say how many units failed: ${r.failed}, by reason`);
    for (const m of r?.metrics ?? [])
      if (!a.includes(m.toLowerCase())) out.push(`name the check on ${m} and its count`);
  }
  if (active.has("tune-sorting-words")) {
    const r = c.convo.rehearsal;
    const p = c.turn.proposed.find((x) => x.kind === "overlay");
    if (p && r) {
      const unknown = r.prediction.flip.filter((g) => !c.convo.groups.has(g));
      if (unknown.length)
        out.push(`the groups predicted to close are not ones the signals showed: ${unknown.join(", ")}`);
    }
  }
  if (active.has("check-identities")) {
    const a = answer.toLowerCase();
    const p = c.convo.probes.at(-1);
    const held = p ? c.convo.held.get(p.dataset) : undefined;
    if (p?.candidates && held?.length) {
      const reading = heldReading(held, p.candidates[0] ? shapeCounts(p.candidates[0]) : null);
      if (reading.map_needed && !/\bmap\b/u.test(a))
        out.push("identifiers of the rule's own kind are held: say a map releases them, with the word map");
      if (
        (reading.reading === "second_kind" || reading.reading === "mixed") &&
        !/second kind|another kind|other kind|unlike/u.test(a)
      )
        out.push("a held shape is unlike the rule's: say a second kind of identifier is on this dataset");
    }
    if (
      alikePairs(c.convo).length &&
      !c.turn.proposed.some((x) => x.kind === "identity_merge") &&
      p &&
      Date.now() - p.at < 600_000
    )
      out.push(
        "the probe found two subjects alike: propose their merge with propose_change, kind identity_merge",
      );
  }
  return out;
}

/** A document validated through the find seam: why it is not clean, or null. */
export function validator(seam: () => Seam): (document: number) => Promise<string | null> {
  return async (document) => {
    const a = await seam().call({
      method: "POST",
      path: "/api/ask/validate",
      body: { document_id: document, mode: "strict" },
      toolCallId: `check-${document}-${Date.now()}`,
      phase: "check",
    });
    if (a.kind !== "ok") return null;
    const b = a.body as { valid?: boolean; issues?: unknown[] };
    return b.valid === false || (b.issues?.length ?? 0) > 0
      ? JSON.stringify(b.issues ?? []).slice(0, 300)
      : null;
  };
}

/** The signal that sends a turn back: what to fix, and that the new answer replaces the old. */
export function sendBack(complaints: string[]): string {
  return `Before you finish: ${complaints.join("; ")}. Then give the person the whole answer again in plain words; it replaces the one before.`;
}
