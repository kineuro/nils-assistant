// SPDX-License-Identifier: AGPL-3.0-only
// The ladder's store (Wave 5 sections 9.1, 9.3, 9.4): a person's standing
// grants, per verb and revocable; the plans the operator station made and
// the person confirmed, with their steps and their proposals; the steps'
// clocks and the jobs they became. One SQLite file, like the notes, the
// ledger and the lineage.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Planned, When } from "./ladder.ts";

export interface GrantRow {
  id: number;
  subject: string;
  door: string;
  created_at: number;
  revoked_at: number | null;
}

export type PlanState = "proposed" | "confirmed" | "done";
export type StepState = "waiting" | "queued" | "running" | "done" | "failed" | "blocked";

export interface PlanRow {
  id: string;
  conversation: string;
  subject: string;
  instruction: string;
  state: PlanState;
  created_at: number;
  confirmed_at: number | null;
}

export interface StepRow {
  id: number;
  plan: string;
  n: number;
  rung: 2 | 3;
  verb: string;
  door: string;
  args: Record<string, unknown>;
  when: When | null;
  words: string;
  state: StepState;
  reason: string | null;
  job: number | null;
  grant: number | null;
  queued_at: number | null;
  finished_at: number | null;
  /** A rung-three step's proposal: waiting until a person decides on the desk. */
  decided: "accepted" | "rejected" | null;
}

export class LadderStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS grant_ (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      door TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    )`);
    this.db.exec("CREATE INDEX IF NOT EXISTS grant_subject ON grant_ (subject, door)");
    this.db.exec(`CREATE TABLE IF NOT EXISTS plan (
      id TEXT PRIMARY KEY,
      conversation TEXT NOT NULL,
      subject TEXT NOT NULL,
      instruction TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      confirmed_at INTEGER
    )`);
    this.db.exec("CREATE INDEX IF NOT EXISTS plan_subject ON plan (subject, created_at)");
    this.db.exec(`CREATE TABLE IF NOT EXISTS step (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan TEXT NOT NULL,
      n INTEGER NOT NULL,
      rung INTEGER NOT NULL,
      verb TEXT NOT NULL,
      door TEXT NOT NULL,
      args TEXT NOT NULL,
      when_ TEXT,
      words TEXT NOT NULL,
      state TEXT NOT NULL,
      reason TEXT,
      job INTEGER,
      grant_id INTEGER,
      queued_at INTEGER,
      finished_at INTEGER,
      decided TEXT
    )`);
    this.db.exec("CREATE INDEX IF NOT EXISTS step_plan ON step (plan, n)");
  }

  // grants

  grant(subject: string, door: string): GrantRow {
    const have = this.grantFor(subject, door);
    if (have) return have;
    const r = this.db
      .prepare("INSERT INTO grant_ (subject, door, created_at) VALUES (?, ?, ?)")
      .run(subject, door, Date.now());
    return this.grantById(Number(r.lastInsertRowid)) as GrantRow;
  }

  grantById(id: number): GrantRow | null {
    return (this.db.prepare("SELECT * FROM grant_ WHERE id = ?").get(id) as GrantRow | undefined) ?? null;
  }

  /** The active grant of a person for a door, or null. */
  grantFor(subject: string, door: string): GrantRow | null {
    return (
      (this.db
        .prepare(
          "SELECT * FROM grant_ WHERE subject = ? AND door = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT 1",
        )
        .get(subject, door) as GrantRow | undefined) ?? null
    );
  }

  grants(subject: string | null): GrantRow[] {
    return (subject === null
      ? this.db.prepare("SELECT * FROM grant_ ORDER BY subject, id").all()
      : this.db
          .prepare("SELECT * FROM grant_ WHERE subject = ? ORDER BY id")
          .all(subject)) as unknown as GrantRow[];
  }

  /** Revoke: the row stays, dated, so an audit row that names it still resolves. */
  revoke(id: number, subject: string | null): GrantRow | null {
    const g = this.grantById(id);
    if (!g || (subject !== null && g.subject !== subject)) return null;
    if (g.revoked_at === null)
      this.db.prepare("UPDATE grant_ SET revoked_at = ? WHERE id = ?").run(Date.now(), id);
    return this.grantById(id);
  }

  // plans

  plan(o: {
    id: string;
    conversation: string;
    subject: string;
    instruction: string;
    planned: Planned;
  }): PlanRow {
    this.db
      .prepare(
        "INSERT INTO plan (id, conversation, subject, instruction, state, created_at) VALUES (?, ?, ?, ?, 'proposed', ?)",
      )
      .run(o.id, o.conversation, o.subject, o.instruction, Date.now());
    const ins = this.db.prepare(
      "INSERT INTO step (plan, n, rung, verb, door, args, when_, words, state, decided) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const s of o.planned.steps)
      ins.run(
        o.id,
        s.n,
        2,
        s.verb,
        s.door,
        JSON.stringify(s.args),
        JSON.stringify(s.when),
        s.words,
        "waiting",
        null,
      );
    for (const p of o.planned.proposals)
      ins.run(o.id, p.n, 3, p.verb, p.door, JSON.stringify(p.args), null, p.words, "waiting", null);
    return this.planById(o.id) as PlanRow;
  }

  planById(id: string): PlanRow | null {
    return (this.db.prepare("SELECT * FROM plan WHERE id = ?").get(id) as PlanRow | undefined) ?? null;
  }

  plans(subject: string | null, state?: PlanState): PlanRow[] {
    const where = [subject !== null ? "subject = ?" : null, state ? "state = ?" : null]
      .filter(Boolean)
      .join(" AND ");
    const params = [subject, state].filter((x) => x !== null && x !== undefined) as string[];
    return this.db
      .prepare(`SELECT * FROM plan${where ? ` WHERE ${where}` : ""} ORDER BY created_at DESC`)
      .all(...params) as unknown as PlanRow[];
  }

  /** The person confirms the plan once (section 9.3); a plan confirmed by someone else's subject is refused. */
  confirm(id: string, subject: string): PlanRow | { refused: string } {
    const p = this.planById(id);
    if (!p) return { refused: `no plan ${id}` };
    if (p.subject !== subject) return { refused: "a plan is confirmed by the person it was made for" };
    if (p.state === "proposed")
      this.db
        .prepare("UPDATE plan SET state = 'confirmed', confirmed_at = ? WHERE id = ?")
        .run(Date.now(), id);
    return this.planById(id) as PlanRow;
  }

  steps(plan: string): StepRow[] {
    return (
      this.db.prepare("SELECT * FROM step WHERE plan = ? ORDER BY n").all(plan) as unknown as RawStep[]
    ).map(stepOf);
  }

  step(id: number): StepRow | null {
    const r = this.db.prepare("SELECT * FROM step WHERE id = ?").get(id) as RawStep | undefined;
    return r ? stepOf(r) : null;
  }

  /** Every step of every confirmed plan that is not over: what the scheduler walks. */
  openSteps(): StepRow[] {
    return (
      this.db
        .prepare(
          "SELECT s.* FROM step s JOIN plan p ON p.id = s.plan WHERE p.state = 'confirmed' AND s.rung = 2 AND s.state IN ('waiting', 'queued', 'running') ORDER BY p.confirmed_at, s.n",
        )
        .all() as unknown as RawStep[]
    ).map(stepOf);
  }

  setStep(
    id: number,
    patch: Partial<
      Pick<StepRow, "state" | "reason" | "job" | "grant" | "queued_at" | "finished_at" | "decided">
    >,
  ): StepRow {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${k === "grant" ? "grant_id" : k} = ?`);
      vals.push(v ?? null);
    }
    if (sets.length > 0)
      this.db.prepare(`UPDATE step SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as never[]), id);
    this.settle(this.step(id)?.plan ?? "");
    return this.step(id) as StepRow;
  }

  /** A plan is done when no rung-two step is open and every proposal is decided. */
  private settle(plan: string): void {
    if (!plan) return;
    const open = this.steps(plan).some((s) =>
      s.rung === 2 ? !["done", "failed"].includes(s.state) : s.decided === null,
    );
    if (!open)
      this.db.prepare("UPDATE plan SET state = 'done' WHERE id = ? AND state = 'confirmed'").run(plan);
  }

  /** A person decided on a rung-three proposal on the desk; the assistant only records it. */
  decide(stepId: number, verdict: "accepted" | "rejected", subject: string): StepRow | { refused: string } {
    const s = this.step(stepId);
    if (s?.rung !== 3) return { refused: `no proposal ${stepId}` };
    const p = this.planById(s.plan);
    if (!p || p.subject !== subject)
      return { refused: "a proposal is decided by the person the plan was made for" };
    return this.setStep(stepId, {
      decided: verdict,
      state: verdict === "accepted" ? "done" : "blocked",
      finished_at: Date.now(),
    });
  }

  sweep(days: number): void {
    const cut = Date.now() - days * 24 * 60 * 60 * 1000;
    this.db.prepare("DELETE FROM step WHERE plan IN (SELECT id FROM plan WHERE created_at < ?)").run(cut);
    this.db.prepare("DELETE FROM plan WHERE created_at < ?").run(cut);
  }
}

interface RawStep {
  id: number;
  plan: string;
  n: number;
  rung: number;
  verb: string;
  door: string;
  args: string;
  when_: string | null;
  words: string;
  state: StepState;
  reason: string | null;
  job: number | null;
  grant_id: number | null;
  queued_at: number | null;
  finished_at: number | null;
  decided: "accepted" | "rejected" | null;
}

function stepOf(r: RawStep): StepRow {
  return {
    id: r.id,
    plan: r.plan,
    n: r.n,
    rung: r.rung === 3 ? 3 : 2,
    verb: r.verb,
    door: r.door,
    args: JSON.parse(r.args) as Record<string, unknown>,
    when: r.when_ ? (JSON.parse(r.when_) as When) : null,
    words: r.words,
    state: r.state,
    reason: r.reason,
    job: r.job,
    grant: r.grant_id,
    queued_at: r.queued_at,
    finished_at: r.finished_at,
    decided: r.decided,
  };
}
