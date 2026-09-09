// SPDX-License-Identifier: AGPL-3.0-only
// The seam's call log (§9.3, §9.7): every call and its outcome, one row,
// beside Flue's record log. Station, phase, operation, argument digest,
// grant decision, outcome, handle. No argument, no row of a result, no
// token. SQLite through Node's own binding; the rows are retained for the
// days the configuration says and swept at start and daily.

import { DatabaseSync } from "node:sqlite";

export interface Row {
  at: number;
  conversation: string;
  station: string;
  phase: string;
  operation: string;
  argument_digest: string;
  granted: boolean;
  reason: string | null;
  outcome: "ok" | "refused" | "blocked" | "error";
  status: number | null;
  handle: number | null;
  ms: number;
  ceiling: string;
  idempotency_key: string | null;
}

export class Ledger {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS seam (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      conversation TEXT NOT NULL,
      station TEXT NOT NULL,
      phase TEXT NOT NULL,
      operation TEXT NOT NULL,
      argument_digest TEXT NOT NULL,
      granted INTEGER NOT NULL,
      reason TEXT,
      outcome TEXT NOT NULL,
      status INTEGER,
      handle INTEGER,
      ms INTEGER NOT NULL,
      ceiling TEXT NOT NULL,
      idempotency_key TEXT
    )`);
    this.db.exec("CREATE INDEX IF NOT EXISTS seam_conversation ON seam (conversation, at)");
  }

  record(r: Row): void {
    this.db
      .prepare(
        `INSERT INTO seam (at, conversation, station, phase, operation, argument_digest, granted, reason, outcome, status, handle, ms, ceiling, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.at,
        r.conversation,
        r.station,
        r.phase,
        r.operation,
        r.argument_digest,
        r.granted ? 1 : 0,
        r.reason,
        r.outcome,
        r.status,
        r.handle,
        r.ms,
        r.ceiling,
        r.idempotency_key,
      );
  }

  rows(conversation?: string, limit = 200): Row[] {
    const rows = conversation
      ? this.db
          .prepare("SELECT * FROM seam WHERE conversation = ? ORDER BY at DESC, id DESC LIMIT ?")
          .all(conversation, limit)
      : this.db.prepare("SELECT * FROM seam ORDER BY at DESC, id DESC LIMIT ?").all(limit);
    const raw = rows as unknown as (Omit<Row, "granted"> & { granted: number })[];
    return raw.map((r) => ({ ...r, granted: r.granted === 1 }));
  }

  /** The columns, for the test that no content column exists. */
  columns(): string[] {
    return (this.db.prepare("PRAGMA table_info(seam)").all() as { name: string }[]).map((r) => r.name);
  }

  /** Retention: rows older than `days` are removed. */
  sweep(days: number, now = Date.now()): number {
    const r = this.db.prepare("DELETE FROM seam WHERE at < ?").run(now - days * 86_400_000);
    return Number(r.changes);
  }

  /** A run's answer to "did this run hit a provider error", from the rows alone (§9.16). */
  hadOutcome(conversation: string, outcome: Row["outcome"]): boolean {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM seam WHERE conversation = ? AND outcome = ?")
      .get(conversation, outcome) as { n: number };
    return r.n > 0;
  }

  close(): void {
    this.db.close();
  }
}
