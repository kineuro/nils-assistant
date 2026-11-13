// SPDX-License-Identifier: AGPL-3.0-only
// Proposed changes (one chat, 2026-10-09): `propose_change` writes a pending
// record here and the desk shows it as an approval card; the model never
// applies anything. A person's approval reaches POST /changes/:id/decide,
// and the host applies the change in its own code under that person's token
// (a job plan through the plan's confirm path, an analysis as the job a
// person's Run queues, sorting words as the engine's overlay proposal, a
// merge at the engine's merge door). Each decision is a ledger row with the
// phase `approval`, before the rows its application writes.

import type { DatabaseSync } from "node:sqlite";
import { openSqlite } from "../host/stores.ts";

/** What a proposal is, in the bench's words. */
export type ChangeKind =
  | "query_version"
  | "job_plan"
  | "analysis_plan"
  | "overlay"
  | "identity_merge"
  | "identity_rule";

/** What the desk's approval card calls it (the desk's `ChangeKind`). */
export type CardKind = "query_version" | "job_plan" | "sorting_words" | "identity_merge" | "identity_rule";

export const CARD_OF: Record<ChangeKind, CardKind> = {
  query_version: "query_version",
  job_plan: "job_plan",
  analysis_plan: "job_plan",
  overlay: "sorting_words",
  identity_merge: "identity_merge",
  identity_rule: "identity_rule",
};

/**
 * Where a change stands. `expired` is a job plan's change whose plan is no longer kept (plans are swept after the
 * retention days), so there is nothing left to approve.
 */
export type ChangeState = "open" | "approved" | "declined" | "failed" | "expired";

export interface ChangeRow {
  id: string;
  conversation: string;
  subject: string;
  kind: ChangeKind;
  title: string | null;
  sentence: string;
  lines: string[];
  /** What applying it needs, written by the host, never the model's own words alone. */
  payload: Record<string, unknown>;
  state: ChangeState;
  created_at: number;
  decided_at: number | null;
  /** What the application answered, or why it failed. */
  result: Record<string, unknown> | null;
}

export class ChangeStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = openSqlite(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS changes (
      id TEXT PRIMARY KEY,
      conversation TEXT NOT NULL,
      subject TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT,
      sentence TEXT NOT NULL,
      lines TEXT NOT NULL,
      payload TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      decided_at INTEGER,
      result TEXT
    )`);
    this.db.exec("CREATE INDEX IF NOT EXISTS changes_conversation ON changes (conversation, created_at)");
  }

  propose(o: {
    conversation: string;
    subject: string;
    kind: ChangeKind;
    title?: string | null;
    sentence: string;
    lines?: string[];
    payload: Record<string, unknown>;
    now?: number;
  }): ChangeRow {
    const id = `chg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.db
      .prepare(
        "INSERT INTO changes (id, conversation, subject, kind, title, sentence, lines, payload, state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)",
      )
      .run(
        id,
        o.conversation,
        o.subject,
        o.kind,
        o.title ?? null,
        o.sentence,
        JSON.stringify(o.lines ?? []),
        JSON.stringify(o.payload),
        o.now ?? Date.now(),
      );
    return this.get(id) as ChangeRow;
  }

  get(id: string): ChangeRow | null {
    const r = this.db.prepare("SELECT * FROM changes WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? rowOf(r) : null;
  }

  of(conversation: string): ChangeRow[] {
    return (
      this.db
        .prepare("SELECT * FROM changes WHERE conversation = ? ORDER BY created_at, id")
        .all(conversation) as Record<string, unknown>[]
    ).map(rowOf);
  }

  /** The decision, once: an open change becomes approved or declined; anything else is refused. */
  decide(
    id: string,
    subject: string,
    verdict: "approved" | "declined",
    now = Date.now(),
  ): ChangeRow | { refused: string; status: number } {
    const c = this.get(id);
    if (!c || c.subject !== subject) return { refused: "no such change of yours", status: 404 };
    if (c.state !== "open") return { refused: `the change was ${c.state} already`, status: 409 };
    this.db.prepare("UPDATE changes SET state = ?, decided_at = ? WHERE id = ?").run(verdict, now, id);
    return this.get(id) as ChangeRow;
  }

  /** The job plans' changes of a person: each names its plan in `payload.plan_id`. */
  jobPlans(subject: string): ChangeRow[] {
    return (
      this.db
        .prepare("SELECT * FROM changes WHERE subject = ? AND kind = 'job_plan' ORDER BY created_at, id")
        .all(subject) as Record<string, unknown>[]
    ).map(rowOf);
  }

  /**
   * An open change settled by what happened elsewhere (2026-11-13): a job plan confirmed on the plan's own card is
   * approved, and one whose plan is gone is expired, each with what happened as its result. Only an open change
   * is settled; null when it was not open.
   */
  settle(
    id: string,
    state: "approved" | "expired",
    result: Record<string, unknown>,
    now = Date.now(),
  ): ChangeRow | null {
    const r = this.db
      .prepare("UPDATE changes SET state = ?, decided_at = ?, result = ? WHERE id = ? AND state = 'open'")
      .run(state, now, JSON.stringify(result), id);
    return Number(r.changes) > 0 ? this.get(id) : null;
  }

  /** What applying an approved change answered; a failure leaves the approval recorded and says why. */
  applied(id: string, result: Record<string, unknown>, failed = false): ChangeRow | null {
    this.db
      .prepare("UPDATE changes SET result = ?, state = CASE WHEN ? THEN 'failed' ELSE state END WHERE id = ?")
      .run(JSON.stringify(result), failed ? 1 : 0, id);
    return this.get(id);
  }

  close(): void {
    this.db.close();
  }
}

function rowOf(r: Record<string, unknown>): ChangeRow {
  return {
    id: String(r.id),
    conversation: String(r.conversation),
    subject: String(r.subject),
    kind: r.kind as ChangeKind,
    title: (r.title as string | null) ?? null,
    sentence: String(r.sentence),
    lines: JSON.parse(String(r.lines)) as string[],
    payload: JSON.parse(String(r.payload)) as Record<string, unknown>,
    state: r.state as ChangeState,
    created_at: Number(r.created_at),
    decided_at: r.decided_at === null ? null : Number(r.decided_at),
    result:
      r.result === null || r.result === undefined
        ? null
        : (JSON.parse(String(r.result)) as Record<string, unknown>),
  };
}

/** The words of a plan that is no longer kept, where its change says what happened. */
export const PLAN_GONE = "the plan is no longer kept, so there is nothing left to approve";

/**
 * What happened to a change, in one sentence; null while it waits for the person. A job plan has two cards, its
 * change's and the plan's own, and the sentence says which one answered it, so both tell one outcome.
 */
export function outcomeOf(c: ChangeRow): string | null {
  const r = c.result ?? {};
  switch (c.state) {
    case "open":
      return null;
    case "approved":
      if (c.kind !== "job_plan") return "approved";
      return r.through === "plan"
        ? "approved on the plan's own card; the plan is confirmed"
        : "approved; the plan is confirmed";
    case "declined":
      return c.kind === "job_plan" && r.plan_taken_back === true
        ? "declined; the plan was taken back"
        : "declined";
    case "failed":
      return `approved, and not applied: ${typeof r.why === "string" ? r.why : "it could not be applied"}`;
    case "expired":
      return typeof r.why === "string" ? r.why : PLAN_GONE;
  }
}

/**
 * A change as the desk and the bench read it. `state` is where it stands and `outcome` what happened, in words;
 * `decided` is the person's own verdict. A change is waiting for the person only while `state` is `open`.
 */
export function changeView(c: ChangeRow): Record<string, unknown> {
  return {
    id: c.id,
    kind: c.kind,
    change: CARD_OF[c.kind],
    title: c.title,
    sentence: c.sentence,
    lines: c.lines,
    state: c.state,
    decided: c.state === "approved" || c.state === "declined" ? c.state : null,
    outcome: outcomeOf(c),
    created_at: new Date(c.created_at).toISOString(),
    decided_at: c.decided_at === null ? null : new Date(c.decided_at).toISOString(),
    result: c.result,
  };
}

let store: ChangeStore | null = null;
let opener: (() => ChangeStore) | null = null;
/** The host names where the store lives; a test may hand its own. */
export function useChangeStore(open: () => ChangeStore): void {
  opener = open;
  store = null;
}
export function theChanges(): ChangeStore {
  if (!store) {
    if (!opener) throw new Error("no change store is configured");
    store = opener();
  }
  return store;
}
