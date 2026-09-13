// SPDX-License-Identifier: AGPL-3.0-only
// Conversations by lineage (Wave 5 section 7.4, D1): a conversation is keyed
// by the document's lineage, the root of its parent chain, not by one
// document id or a run. Opening a question a month later shows what was
// said when it was made, what was proposed, what was accepted and rejected
// and why, and the handles each version produced. The proposals name the
// base they were made against, so a proposal on a document that moved reads
// as stale and cannot be accepted. The rail's typed context is kept here
// per conversation too. One SQLite file, like the notes and the ledger.

import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { admit, type PageContext } from "../seam/context.ts";
import { bareOf } from "./people.ts";

export interface ConversationRow {
  id: string;
  station: string;
  subject: string;
  lineage: number | null;
  document: number | null;
  created_at: number;
  /** The chat, slice 1: the person's principal, null on a row written before owners were kept. */
  owner: string | null;
  title: string | null;
  title_by: "model" | "person" | null;
  updated_at: number | null;
  pinned_at: number | null;
  archived_at: number | null;
  deleted_at: number | null;
  forked_from: string | null;
  forked_at: number | null;
  /** The chat, slice 3: the tokens the context held after the latest turn, the model's window, and how often earlier turns were summarized. */
  context_tokens: number | null;
  context_window: number | null;
  compactions: number | null;
  compacted_at: number | null;
  /** The chat, slice 4: the conversation a version was first made from, the message it was sent instead of, where that message was first sent, where the copy of its stream ends, and its own first message once sent. */
  fork_root: string | null;
  fork_slot: string | null;
  fork_origin: string | null;
  fork_offset: number | null;
  branch_message: string | null;
}

/** Whether a row written under an older key is this person's: their principal, the bare `sub` their token gave, or `anonymous` while the engine serves with its authentication off. */
function claims(subject: string, principal: string, authOff: boolean): boolean {
  return subject === principal || subject === bareOf(principal) || (authOff && subject === "anonymous");
}

/** A title as people read it: one line of at most 120 characters, or none. */
function tidy(title: string | null | undefined): string | null {
  const t = (title ?? "").replace(/\s+/gu, " ").trim().slice(0, 120);
  return t === "" ? null : t;
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

/** The owner's verdict on one answer (the chat, slice 4). */
export interface RatingRow {
  conversation: string;
  message: string;
  verdict: "up" | "down";
  reason: string | null;
  at: number;
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
    // the chat, slice 4: the owner's verdict on an answer, up or down with a reason
    this.db.exec(`CREATE TABLE IF NOT EXISTS rating (
      conversation TEXT NOT NULL,
      message TEXT NOT NULL,
      verdict TEXT NOT NULL,
      reason TEXT,
      at INTEGER NOT NULL,
      PRIMARY KEY (conversation, message)
    )`);
    // the chat, slice 1: a conversation has an owner, a title and a life of its own; a file made before gains the columns
    const have = new Set(
      (this.db.prepare("PRAGMA table_info(conversation)").all() as { name: string }[]).map((c) => c.name),
    );
    for (const [name, type] of [
      ["owner", "TEXT"],
      ["title", "TEXT"],
      ["title_by", "TEXT"],
      ["updated_at", "INTEGER"],
      ["pinned_at", "INTEGER"],
      ["archived_at", "INTEGER"],
      ["deleted_at", "INTEGER"],
      ["forked_from", "TEXT"],
      ["forked_at", "INTEGER"],
      ["context_tokens", "INTEGER"],
      ["context_window", "INTEGER"],
      ["compactions", "INTEGER"],
      ["compacted_at", "INTEGER"],
      ["fork_root", "TEXT"],
      ["fork_slot", "TEXT"],
      ["fork_origin", "TEXT"],
      ["fork_offset", "INTEGER"],
      ["branch_message", "TEXT"],
    ])
      if (!have.has(name)) this.db.exec(`ALTER TABLE conversation ADD COLUMN ${name} ${type}`);
    this.db.exec("CREATE INDEX IF NOT EXISTS conversation_owner ON conversation (owner, updated_at)");
    this.db.exec("CREATE INDEX IF NOT EXISTS conversation_family ON conversation (fork_root)");
  }

  /** The first turn opens the conversation; a later turn may name the document it moved to. */
  open(o: {
    id: string;
    station: string;
    subject: string;
    /** The person who opens it, once the host knows them; the subject then is that principal too. */
    owner?: string | null;
    lineage?: number | null;
    document?: number | null;
  }): ConversationRow {
    const now = Date.now();
    const have = this.conversation(o.id);
    if (!have) {
      this.db
        .prepare(
          "INSERT INTO conversation (id, station, subject, lineage, document, created_at, owner, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          o.id,
          o.station,
          o.owner ?? o.subject,
          o.lineage ?? null,
          o.document ?? null,
          now,
          o.owner ?? null,
          now,
        );
    } else {
      this.db
        .prepare(
          "UPDATE conversation SET lineage = COALESCE(?, lineage), document = COALESCE(?, document), updated_at = ? WHERE id = ?",
        )
        .run(o.lineage ?? null, o.document ?? null, now, o.id);
    }
    const row = this.conversation(o.id) as ConversationRow;
    if (row.lineage !== null && typeof o.document === "number") this.setHead(row.lineage, o.document);
    return row;
  }

  /** A conversation the host names: an id nobody can guess, owned by the person who asked for it. */
  create(o: {
    station: string;
    owner: string;
    title?: string | null;
    lineage?: number | null;
    document?: number | null;
  }): ConversationRow {
    const id = `c-${randomBytes(16).toString("hex")}`;
    const now = Date.now();
    const title = tidy(o.title);
    this.db
      .prepare(
        "INSERT INTO conversation (id, station, subject, lineage, document, created_at, owner, title, title_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        o.station,
        o.owner,
        o.lineage ?? null,
        o.document ?? null,
        now,
        o.owner,
        title,
        title === null ? null : "person",
        now,
      );
    return this.conversation(id) as ConversationRow;
  }

  /**
   * What a person may do with a conversation: `owner`, `none`, or `unknown` when the host has never seen
   * it. A deleted conversation is nobody's. One opened before owners were kept belongs to the person its
   * subject named, and becomes theirs the first time they ask.
   */
  access(id: string, principal: string, o: { authOff: boolean }): "owner" | "none" | "unknown" {
    const row = this.conversation(id);
    if (!row) return "unknown";
    if (row.deleted_at !== null) return "none";
    if (row.owner === principal) return "owner";
    if (row.owner === null && claims(row.subject, principal, o.authOff)) {
      this.db
        .prepare("UPDATE conversation SET owner = ?, subject = ? WHERE id = ? AND owner IS NULL")
        .run(principal, principal, id);
      return "owner";
    }
    return "none";
  }

  /** Every conversation written under the person's older key becomes theirs, so their list shows it. */
  adopt(principal: string, o: { authOff: boolean }): number {
    return Number(
      this.db
        .prepare(
          "UPDATE conversation SET owner = ?, subject = ? WHERE owner IS NULL AND (subject = ? OR subject = ? OR (? = 1 AND subject = 'anonymous'))",
        )
        .run(principal, principal, principal, bareOf(principal), o.authOff ? 1 : 0).changes,
    );
  }

  /** A person's conversations: pinned first, then the latest used; the archived apart, the deleted never. */
  mine(
    owner: string,
    o: { q?: string; archived?: boolean; before?: number; limit?: number } = {},
  ): ConversationRow[] {
    const where = [
      "owner = ?",
      "deleted_at IS NULL",
      o.archived ? "archived_at IS NOT NULL" : "archived_at IS NULL",
      // one row per conversation: of its versions, the one used last, the first made when two tie
      `NOT EXISTS (SELECT 1 FROM conversation o WHERE COALESCE(o.fork_root, o.id) = COALESCE(conversation.fork_root, conversation.id)
        AND o.id != conversation.id AND o.deleted_at IS NULL
        AND (COALESCE(o.updated_at, o.created_at) > COALESCE(conversation.updated_at, conversation.created_at)
          OR (COALESCE(o.updated_at, o.created_at) = COALESCE(conversation.updated_at, conversation.created_at) AND o.created_at < conversation.created_at)))`,
    ];
    const params: (string | number)[] = [owner];
    const q = (o.q ?? "").trim();
    if (q) {
      where.push("title LIKE ? ESCAPE '\\'");
      params.push(`%${q.replace(/[\\%_]/gu, (c) => `\\${c}`)}%`);
    }
    if (o.before !== undefined) {
      // a later page: the pinned were on the first
      where.push("pinned_at IS NULL", "COALESCE(updated_at, created_at) < ?");
      params.push(o.before);
    }
    const limit = Math.min(Math.max(Math.trunc(o.limit ?? 50), 1), 200);
    return this.db
      .prepare(
        `SELECT * FROM conversation WHERE ${where.join(" AND ")} ORDER BY pinned_at IS NULL, COALESCE(updated_at, created_at) DESC, id LIMIT ?`,
      )
      .all(...params, limit) as unknown as ConversationRow[];
  }

  /** What a person changes about their conversation: its title, whether it is pinned, whether it is archived, every version of it alike; and which version it opens on. */
  patch(
    id: string,
    p: { title?: string | null; pinned?: boolean; archived?: boolean; current?: boolean },
  ): ConversationRow | null {
    const family = this.familyOf(id);
    if (family === null) return null;
    const now = Date.now();
    const where = "WHERE COALESCE(fork_root, id) = ?";
    if (p.title !== undefined) {
      const title = tidy(p.title);
      this.db
        .prepare(`UPDATE conversation SET title = ?, title_by = ? ${where}`)
        .run(title, title === null ? null : "person", family);
    }
    if (p.pinned !== undefined)
      this.db.prepare(`UPDATE conversation SET pinned_at = ? ${where}`).run(p.pinned ? now : null, family);
    if (p.archived !== undefined)
      this.db
        .prepare(`UPDATE conversation SET archived_at = ? ${where}`)
        .run(p.archived ? now : null, family);
    // the version a person switched to is the one the lists show from now on
    if (p.current) this.db.prepare("UPDATE conversation SET updated_at = ? WHERE id = ?").run(now, id);
    return this.conversation(id);
  }

  /** Deleted by its owner: every version gone from every list and every door at once; its rows go with the retention. */
  remove(id: string): boolean {
    const family = this.familyOf(id);
    if (family === null) return false;
    return (
      this.db
        .prepare(
          "UPDATE conversation SET deleted_at = ? WHERE COALESCE(fork_root, id) = ? AND deleted_at IS NULL",
        )
        .run(Date.now(), family).changes > 0
    );
  }

  /** The family a conversation's versions share: the conversation every version of it was first made from. */
  familyOf(id: string): string | null {
    const r = this.db
      .prepare("SELECT COALESCE(fork_root, id) AS family FROM conversation WHERE id = ?")
      .get(id) as { family: string } | undefined;
    return r?.family ?? null;
  }

  /** An id nobody can guess, for a conversation the host makes. */
  newId(): string {
    return `c-${randomBytes(16).toString("hex")}`;
  }

  /**
   * A conversation continued from another's stream (the chat, slice 4). One made at a message is a version
   * of the same conversation: it shares the name, the pin and the archive, and it is listed in place of the
   * others once it has been used since. A copy of the whole conversation, made at no message, is a
   * conversation of its own.
   */
  branch(o: {
    id: string;
    source: ConversationRow;
    slot: string | null;
    origin: string | null;
    offset: number;
  }): ConversationRow {
    const now = Date.now();
    const s = o.source;
    const version = o.slot !== null;
    const title = version ? s.title : tidy(s.title ? `${s.title} (continued)` : null);
    const owner = s.owner ?? s.subject;
    this.db
      .prepare(
        "INSERT INTO conversation (id, station, subject, lineage, document, created_at, owner, title, title_by, updated_at, pinned_at, archived_at, forked_from, forked_at, fork_root, fork_slot, fork_origin, fork_offset) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        o.id,
        s.station,
        owner,
        s.lineage,
        s.document,
        now,
        owner,
        title,
        title === null ? null : (s.title_by ?? "person"),
        version ? (s.updated_at ?? s.created_at) : now,
        version ? s.pinned_at : null,
        version ? s.archived_at : null,
        s.id,
        now,
        version ? (s.fork_root ?? s.id) : o.id,
        o.slot,
        o.origin,
        o.offset,
      );
    return this.conversation(o.id) as ConversationRow;
  }

  /** A version's first message, once it is known. */
  setBranchMessage(id: string, message: string): void {
    this.db
      .prepare("UPDATE conversation SET branch_message = ? WHERE id = ? AND branch_message IS NULL")
      .run(message, id);
  }

  /** The versions in a conversation's family whose first message is not known yet. */
  unsent(id: string): ConversationRow[] {
    const family = this.familyOf(id);
    if (family === null) return [];
    return this.db
      .prepare(
        "SELECT * FROM conversation WHERE COALESCE(fork_root, id) = ? AND fork_slot IS NOT NULL AND branch_message IS NULL AND deleted_at IS NULL",
      )
      .all(family) as unknown as ConversationRow[];
  }

  /** Where a message sits among its versions: a version's first message stands in the place of the message it was sent instead of; any other message is a place of its own. */
  slotOf(message: string): { slot: string; origin: string | null } {
    const r = this.db
      .prepare(
        "SELECT fork_slot, fork_origin FROM conversation WHERE branch_message = ? AND fork_slot IS NOT NULL LIMIT 1",
      )
      .get(message) as { fork_slot: string; fork_origin: string | null } | undefined;
    return r ? { slot: r.fork_slot, origin: r.fork_origin } : { slot: message, origin: null };
  }

  /** The version a message of `source` was first sent in: up through the versions whose copies carried it, by the batch it sits in. */
  originOf(source: ConversationRow, seq: number): string {
    let cur = source;
    for (let hop = 0; hop < 1000; hop++) {
      if (
        cur.forked_from === null ||
        cur.fork_slot === null ||
        cur.fork_offset === null ||
        seq >= cur.fork_offset
      )
        break;
      const up = this.conversation(cur.forked_from);
      if (!up) break;
      cur = up;
    }
    return cur.id;
  }

  /** The places in a conversation's family sent more than one way: the message first sent, then each sent instead, oldest first. */
  versions(id: string): { slot: string; versions: { conversation: string; message: string }[] }[] {
    const family = this.familyOf(id);
    if (family === null) return [];
    const rows = this.db
      .prepare(
        "SELECT id, fork_slot, fork_origin, branch_message FROM conversation WHERE COALESCE(fork_root, id) = ? AND fork_slot IS NOT NULL AND branch_message IS NOT NULL AND deleted_at IS NULL ORDER BY created_at, id",
      )
      .all(family) as { id: string; fork_slot: string; fork_origin: string | null; branch_message: string }[];
    const slots = new Map<string, { conversation: string; message: string }[]>();
    for (const r of rows) {
      const list =
        slots.get(r.fork_slot) ??
        (r.fork_origin ? [{ conversation: r.fork_origin, message: r.fork_slot }] : []);
      list.push({ conversation: r.id, message: r.branch_message });
      slots.set(r.fork_slot, list);
    }
    return [...slots.entries()].map(([slot, versions]) => ({ slot, versions }));
  }

  /** What a copy carries beside its stream: the page's context, the proposals made before the cut with their decisions, and the verdicts on the answers it carries. */
  copyState(from: string, to: string, o: { cutAt: number | null; messages: string[] }): void {
    this.db
      .prepare(
        "INSERT INTO context (conversation, json, at) SELECT ?, json, at FROM context WHERE conversation = ? ON CONFLICT(conversation) DO NOTHING",
      )
      .run(to, from);
    this.db
      .prepare(
        "INSERT INTO proposal (conversation, document, parent, base_document, base_hash, sentence, at, decided, why, decided_at) SELECT ?, document, parent, base_document, base_hash, sentence, at, decided, why, decided_at FROM proposal WHERE conversation = ? AND (? IS NULL OR at < ?) ORDER BY at, id",
      )
      .run(to, from, o.cutAt, o.cutAt);
    this.db
      .prepare(
        "INSERT INTO rating (conversation, message, verdict, reason, at) SELECT ?, message, verdict, reason, at FROM rating WHERE conversation = ? AND message IN (SELECT value FROM json_each(?))",
      )
      .run(to, from, JSON.stringify(o.messages));
  }

  /** How full the conversation's context stood after its latest turn, and its model's window when known (the chat, slice 3). */
  noteContext(id: string, tokens: number, window: number | null): void {
    this.db
      .prepare(
        "UPDATE conversation SET context_tokens = ?, context_window = COALESCE(?, context_window) WHERE id = ?",
      )
      .run(tokens, window, id);
  }

  /** The runtime summarized the conversation's earlier turns. */
  noteCompaction(id: string): void {
    this.db
      .prepare(
        "UPDATE conversation SET compactions = COALESCE(compactions, 0) + 1, compacted_at = ? WHERE id = ?",
      )
      .run(Date.now(), id);
  }

  /** The owner's verdict on one answer: up or down, with a reason of at most 500 characters when one is given; none takes it back. */
  rate(
    conversation: string,
    message: string,
    verdict: "up" | "down" | null,
    reason?: string | null,
  ): RatingRow | null {
    if (verdict === null) {
      this.db.prepare("DELETE FROM rating WHERE conversation = ? AND message = ?").run(conversation, message);
      return null;
    }
    const why = (reason ?? "").trim().slice(0, 500) || null;
    this.db
      .prepare(
        "INSERT INTO rating (conversation, message, verdict, reason, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(conversation, message) DO UPDATE SET verdict = excluded.verdict, reason = excluded.reason, at = excluded.at",
      )
      .run(conversation, message, verdict, why, Date.now());
    return (
      (this.db
        .prepare("SELECT * FROM rating WHERE conversation = ? AND message = ?")
        .get(conversation, message) as RatingRow | undefined) ?? null
    );
  }

  ratings(conversation: string): RatingRow[] {
    return this.db
      .prepare("SELECT * FROM rating WHERE conversation = ? ORDER BY at, message")
      .all(conversation) as unknown as RatingRow[];
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

  /** The conversations of one lineage, newest first, each with its proposals and decisions; only the person's own when a person is named. */
  list(
    lineage: number,
    who?: { principal: string; authOff: boolean },
  ): (ConversationRow & { proposals: ProposalRow[] })[] {
    const rows = (
      this.db
        .prepare(
          "SELECT * FROM conversation WHERE lineage = ? AND deleted_at IS NULL ORDER BY created_at DESC, id",
        )
        .all(lineage) as unknown as ConversationRow[]
    ).filter(
      (r) =>
        !who ||
        r.owner === who.principal ||
        (r.owner === null && claims(r.subject, who.principal, who.authOff)),
    );
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
    this.db.prepare("DELETE FROM rating WHERE at < ?").run(cut);
    this.db.prepare("DELETE FROM conversation WHERE COALESCE(updated_at, created_at) < ?").run(cut);
  }
}
