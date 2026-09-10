// SPDX-License-Identifier: AGPL-3.0-only
// Conversations by lineage (Wave 5 section 7.4, D1): a conversation is keyed
// by the document's lineage, the root of its parent chain, not by one
// document id or a run. Opening a question a month later shows what was
// said when it was made, what was proposed, what was accepted and rejected
// and why, and the handles each version produced. The proposals name the
// base they were made against, so a proposal on a document that moved reads
// as stale and cannot be accepted. The rail's typed context is kept here
// per conversation too. One SQLite file, like the notes and the ledger.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { admit, type PageContext } from "../seam/context.ts";

export interface ConversationRow {
  id: string;
  station: string;
  subject: string;
  lineage: number | null;
  document: number | null;
  created_at: number;
}

export interface ProposalRow {
  id: number;
  conversation: string;
  document: number;
  parent: number | null;
  /** The document the proposal was made against, and its content hash when the desk had told it. */
  base_document: number | null;
  base_hash: string | null;
  sentence: string;
  at: number;
  decided: "accepted" | "rejected" | null;
  why: string | null;
  decided_at: number | null;
}

export interface Decision {
  document: number;
  sentence?: string;
  why?: string;
  /** The document the desk is on when it decides; a base that is not it is stale. */
  current?: number;
}

export type Verdict =
  | { ok: true; document: number; head: number | null }
  | { ok: false; stale: true; document: number; base: number | null; moved_to: number | null };

export class Lineage {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS conversation (
      id TEXT PRIMARY KEY,
      station TEXT NOT NULL,
      subject TEXT NOT NULL,
      lineage INTEGER,
      document INTEGER,
      created_at INTEGER NOT NULL
    )`);
    this.db.exec("CREATE INDEX IF NOT EXISTS conversation_lineage ON conversation (lineage, created_at)");
    this.db.exec(`CREATE TABLE IF NOT EXISTS proposal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation TEXT NOT NULL,
      document INTEGER NOT NULL,
      parent INTEGER,
      base_document INTEGER,
      base_hash TEXT,
      sentence TEXT NOT NULL,
      at INTEGER NOT NULL,
      decided TEXT,
      why TEXT,
      decided_at INTEGER
    )`);
    this.db.exec("CREATE INDEX IF NOT EXISTS proposal_conversation ON proposal (conversation, at)");
    this.db.exec(`CREATE TABLE IF NOT EXISTS head (
      lineage INTEGER PRIMARY KEY,
      document INTEGER NOT NULL,
      at INTEGER NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS context (
      conversation TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      at INTEGER NOT NULL
    )`);
  }

  /** The first turn opens the conversation; a later turn may name the document it moved to. */
  open(o: {
    id: string;
    station: string;
    subject: string;
    lineage?: number | null;
    document?: number | null;
  }): ConversationRow {
    const now = Date.now();
    const have = this.conversation(o.id);
    if (!have) {
      this.db
        .prepare(
          "INSERT INTO conversation (id, station, subject, lineage, document, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(o.id, o.station, o.subject, o.lineage ?? null, o.document ?? null, now);
    } else {
      this.db
        .prepare(
          "UPDATE conversation SET lineage = COALESCE(?, lineage), document = COALESCE(?, document) WHERE id = ?",
        )
        .run(o.lineage ?? null, o.document ?? null, o.id);
    }
    const row = this.conversation(o.id) as ConversationRow;
    if (row.lineage !== null && typeof o.document === "number") this.setHead(row.lineage, o.document);
    return row;
  }

  conversation(id: string): ConversationRow | null {
    return (
      (this.db.prepare("SELECT * FROM conversation WHERE id = ?").get(id) as ConversationRow | undefined) ??
      null
    );
  }

  /** The document a conversation is on, as the desk last said. */
  documentOf(id: string): number | null {
    return this.conversation(id)?.document ?? null;
  }

  headOf(lineage: number): number | null {
    const r = this.db.prepare("SELECT document FROM head WHERE lineage = ?").get(lineage) as
      | { document: number }
      | undefined;
    return r?.document ?? null;
  }
  setHead(lineage: number, document: number): void {
    this.db
      .prepare(
        "INSERT INTO head (lineage, document, at) VALUES (?, ?, ?) ON CONFLICT(lineage) DO UPDATE SET document = excluded.document, at = excluded.at",
      )
      .run(lineage, document, Date.now());
  }

  /** A station proposed a document version; the base it was made against is the conversation's document, and the hash the desk's context carried for it. */
  proposed(p: {
    conversation: string;
    document: number;
    parent: number | null;
    sentence: string;
  }): ProposalRow {
    const base = p.parent ?? this.documentOf(p.conversation);
    const ctx = this.contextOf(p.conversation);
    const hash = ctx && ctx.document_id === base ? (ctx.content_hash ?? null) : null;
    this.db
      .prepare(
        "INSERT INTO proposal (conversation, document, parent, base_document, base_hash, sentence, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(p.conversation, p.document, p.parent, base, hash, p.sentence, Date.now());
    return this.proposal(p.conversation, p.document) as ProposalRow;
  }

  proposal(conversation: string, document: number): ProposalRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM proposal WHERE conversation = ? AND document = ? ORDER BY at DESC LIMIT 1")
        .get(conversation, document) as ProposalRow | undefined) ?? null
    );
  }

  proposals(conversation: string): ProposalRow[] {
    return this.db
      .prepare("SELECT * FROM proposal WHERE conversation = ? ORDER BY at, id")
      .all(conversation) as unknown as ProposalRow[];
  }

  /** Whether a proposal's base is still where the desk is: the base must be the current document the desk names, and the lineage's head. */
  stale(conversation: string, d: Decision): Verdict {
    const p = this.proposal(conversation, d.document);
    if (!p || p.base_document === null) return { ok: true, document: d.document, head: null };
    const c = this.conversation(conversation);
    const head = c?.lineage !== null && c?.lineage !== undefined ? this.headOf(c.lineage) : null;
    if (typeof d.current === "number" && d.current !== p.base_document && d.current !== p.document)
      return { ok: false, stale: true, document: d.document, base: p.base_document, moved_to: d.current };
    if (head !== null && head !== p.base_document && head !== p.document)
      return { ok: false, stale: true, document: d.document, base: p.base_document, moved_to: head };
    return { ok: true, document: d.document, head };
  }

  /** Accept or reject a proposal; an accepted one becomes the lineage's head. A stale one is refused untouched. */
  decide(conversation: string, verdict: "accepted" | "rejected", d: Decision): Verdict {
    const check = this.stale(conversation, d);
    if (verdict === "accepted" && !check.ok) return check;
    const p = this.proposal(conversation, d.document);
    if (p) {
      this.db
        .prepare("UPDATE proposal SET decided = ?, why = ?, decided_at = ? WHERE id = ?")
        .run(verdict, d.why ?? null, Date.now(), p.id);
    } else {
      // a decision on a proposal this store never saw (an older desk): kept so the listing is complete
      this.db
        .prepare(
          "INSERT INTO proposal (conversation, document, parent, base_document, base_hash, sentence, at, decided, why, decided_at) VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)",
        )
        .run(conversation, d.document, d.sentence ?? "", Date.now(), verdict, d.why ?? null, Date.now());
    }
    const c = this.conversation(conversation);
    if (verdict === "accepted") {
      if (c?.lineage !== null && c?.lineage !== undefined) this.setHead(c.lineage, d.document);
      this.db.prepare("UPDATE conversation SET document = ? WHERE id = ?").run(d.document, conversation);
    }
    return {
      ok: true,
      document: d.document,
      head: c?.lineage !== null && c?.lineage !== undefined ? this.headOf(c.lineage) : null,
    };
  }

  /** The conversations of one lineage, newest first, each with its proposals and decisions. */
  list(lineage: number): (ConversationRow & { proposals: ProposalRow[] })[] {
    const rows = this.db
      .prepare("SELECT * FROM conversation WHERE lineage = ? ORDER BY created_at DESC, id")
      .all(lineage) as unknown as ConversationRow[];
    return rows.map((r) => ({ ...r, proposals: this.proposals(r.id) }));
  }

  /** The rail's typed context for a conversation, admitted again on the way in. */
  contextPut(conversation: string, input: unknown): PageContext {
    const c = admit(input);
    this.db
      .prepare(
        "INSERT INTO context (conversation, json, at) VALUES (?, ?, ?) ON CONFLICT(conversation) DO UPDATE SET json = excluded.json, at = excluded.at",
      )
      .run(conversation, JSON.stringify(c), Date.now());
    return c;
  }
  contextOf(conversation: string): PageContext | null {
    const r = this.db.prepare("SELECT json FROM context WHERE conversation = ?").get(conversation) as
      | { json: string }
      | undefined;
    return r ? (JSON.parse(r.json) as PageContext) : null;
  }

  /** Rows older than the retention go, as the ledger's do (C24). */
  sweep(days: number): void {
    const cut = Date.now() - days * 24 * 60 * 60 * 1000;
    this.db.prepare("DELETE FROM proposal WHERE at < ?").run(cut);
    this.db.prepare("DELETE FROM context WHERE at < ?").run(cut);
    this.db.prepare("DELETE FROM conversation WHERE created_at < ?").run(cut);
  }
}
