// SPDX-License-Identifier: AGPL-3.0-only
// A conversation continued from one of its messages (the chat, slice 4). The
// runtime appends one line per conversation and offers no fork, so editing a
// message or asking for an answer again starts a new conversation whose
// stream is the old one's, copied up to that message: the same records under
// a new path, so the model reads exactly what it read before. The copy speaks
// to the tables the store's adapter made, on either backend, as the record
// import does, and never rewrites the conversation it copies. A cut is taken
// only where every turn before it has settled.

import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";

export class ForkRefused extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** One record of a stream, as far as a fork reads it. */
export interface Rec {
  type: string;
  messageId?: string;
  submissionId?: string;
  attemptId?: string;
  timestamp?: number | string;
  [key: string]: unknown;
}

export interface Plan {
  /** How many whole batches are copied, from the first. */
  whole: number;
  /** The records of the cut batch that come before the message, when the message is not the batch's first. */
  partial: Rec[] | null;
  /** When the message the copy stops before was written; null for a copy of the whole conversation. */
  cutAt: number | null;
  /** The sequence number of the batch holding that message. */
  cutSeq: number | null;
  /** The ids of the messages the copy carries. */
  messages: string[];
}

const MESSAGES = new Set(["user_message", "assistant_message_started", "signal"]);

function at(t: Rec["timestamp"]): number | null {
  if (typeof t === "number") return t;
  const n = typeof t === "string" ? Date.parse(t) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * What to copy: everything, or everything before one message a person sent. Refused when the message is
 * not in the conversation, when a turn before it has not settled, and when the message joined a reply
 * that was already running, since its words belong to that reply's turn.
 */
export function planFork(batches: { seq: number; records: Rec[] }[], before?: string): Plan {
  let whole = batches.length;
  let partial: Rec[] | null = null;
  let cut: Rec | null = null;
  let cutSeq: number | null = null;
  if (before !== undefined) {
    const i = batches.findIndex((b) =>
      b.records.some((r) => r.type === "user_message" && r.messageId === before),
    );
    if (i === -1) throw new ForkRefused(404, `no message ${before} a person sent in this conversation`);
    const j = batches[i].records.findIndex((r) => r.type === "user_message" && r.messageId === before);
    whole = i;
    partial = j > 0 ? batches[i].records.slice(0, j) : null;
    cut = batches[i].records[j];
    cutSeq = batches[i].seq;
  }
  const prefix = [...batches.slice(0, whole).flatMap((b) => b.records), ...(partial ?? [])];
  const started = new Set(
    prefix.flatMap((r) => (typeof r.submissionId === "string" ? [r.submissionId] : [])),
  );
  for (const r of prefix)
    if (r.type === "submission_settled" && typeof r.submissionId === "string") started.delete(r.submissionId);
  if (started.size > 0)
    throw new ForkRefused(
      409,
      before === undefined
        ? "a turn is still running; copy the conversation once it has settled"
        : "a turn before that message has not settled",
    );
  if (cut && typeof cut.submissionId === "string") {
    const all = batches.flatMap((b) => b.records);
    const settled = all.find((r) => r.type === "submission_settled" && r.submissionId === cut.submissionId);
    const host =
      typeof settled?.attemptId === "string"
        ? all.find((r) => r.type === "assistant_message_started" && r.attemptId === settled.attemptId)
            ?.submissionId
        : undefined;
    if (host !== undefined && host !== cut.submissionId)
      throw new ForkRefused(
        409,
        "that message joined a reply that was already running; edit the message before it",
      );
  }
  return {
    whole,
    partial,
    cutAt: cut ? at(cut.timestamp) : null,
    cutSeq,
    messages: prefix.flatMap((r) =>
      MESSAGES.has(r.type) && typeof r.messageId === "string" ? [r.messageId] : [],
    ),
  };
}

/** The store as SQL: a SQLite file through Node's binding, or Postgres through its driver. */
export interface Sql {
  all(q: string, ...params: unknown[]): Promise<Record<string, unknown>[]>;
  run(q: string, ...params: unknown[]): Promise<void>;
  tables(): Promise<string[]>;
  tx<T>(fn: (s: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function sqlFor(store: string): Sql {
  if (/^postgres(ql)?:\/\//u.test(store)) {
    const db = postgres(store);
    const dollars = (q: string) => {
      let n = 0;
      return q.replace(/\?/gu, () => `$${++n}`);
    };
    type Q = { unsafe: (q: string, p?: never) => Promise<unknown> };
    const over = (conn: Q): Sql => ({
      all: async (q, ...p) => (await conn.unsafe(dollars(q), p as never)) as Record<string, unknown>[],
      run: async (q, ...p) => {
        await conn.unsafe(dollars(q), p as never);
      },
      tables: async () =>
        (
          (await conn.unsafe("SELECT tablename FROM pg_tables WHERE tablename LIKE 'flue_%'")) as {
            tablename: string;
          }[]
        ).map((r) => r.tablename),
      tx: (fn) => db.begin((t) => fn(over(t as unknown as Q))) as Promise<never>,
      close: () => db.end(),
    });
    return over(db as unknown as Q);
  }
  const db = new DatabaseSync(store);
  db.exec("PRAGMA busy_timeout = 5000");
  const self: Sql = {
    all: async (q, ...p) => db.prepare(q).all(...(p as never[])) as Record<string, unknown>[],
    run: async (q, ...p) => {
      db.prepare(q).run(...(p as never[]));
    },
    tables: async () =>
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'flue_%'").all() as {
          name: string;
        }[]
      ).map((r) => r.name),
    tx: async (fn) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const out = await fn(self);
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    close: async () => db.close(),
  };
  return self;
}

async function insert(s: Sql, table: string, row: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(row);
  await s.run(
    `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
    ...keys.map((k) => row[k]),
  );
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A fresh incarnation for a new stream, in the runtime's own shape: `inc_` and a ULID. */
export function incarnation(now = Date.now()): string {
  let time = "";
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  const random = [...randomBytes(16)].map((b) => CROCKFORD[b % 32]).join("");
  return `inc_${time}${random}`;
}

/** The path of an agent instance's stream: a durable contract of the runtime. */
export const streamPath = (agentName: string, instanceId: string) => `agents/${agentName}/${instanceId}`;

async function batchesOf(s: Sql, path: string, chunked: boolean, fromSeq = 0) {
  const rows = await s.all(
    "SELECT * FROM flue_conversation_stream_batches WHERE path = ? AND seq >= ? ORDER BY seq",
    path,
    fromSeq,
  );
  const out: { seq: number; records: Rec[]; row: Record<string, unknown> }[] = [];
  for (const row of rows) {
    let data = String(row.data);
    // a batch larger than the spill threshold keeps its records in chunk rows (SQLite only)
    if (data.startsWith("{") && chunked)
      data = (
        await s.all(
          "SELECT data FROM flue_conversation_stream_batch_chunks WHERE path = ? AND seq = ? ORDER BY chunk_index",
          path,
          row.seq,
        )
      )
        .map((c) => String(c.data))
        .join("");
    out.push({ seq: Number(row.seq), records: JSON.parse(data) as Rec[], row });
  }
  return out;
}

/**
 * Copy the conversation `from` into `to`, whole or up to the message `before`, in one transaction: the
 * stream's row under the new identity with a fresh incarnation, the batches before the cut (the cut
 * batch's earlier records as a batch of their own), and the attachments. Checkpoints and submission rows
 * stay behind; the runtime folds the copy from its first batch and takes the stream over on its next turn.
 */
export async function forkStream(
  sql: Sql,
  o: {
    from: { agentName: string; instanceId: string };
    to: { agentName: string; instanceId: string };
    before?: string;
    upTo?: number;
  },
): Promise<Plan & { offset: number }> {
  const src = streamPath(o.from.agentName, o.from.instanceId);
  const dst = streamPath(o.to.agentName, o.to.instanceId);
  return sql.tx(async (s) => {
    const [stream] = await s.all("SELECT * FROM flue_conversation_streams WHERE path = ?", src);
    if (!stream) throw new ForkRefused(409, "the conversation has no turns to copy yet");
    if ((await s.all("SELECT path FROM flue_conversation_streams WHERE path = ?", dst)).length > 0)
      throw new ForkRefused(409, `a conversation ${o.to.instanceId} exists already`);
    const tables = await s.tables();
    const chunked = tables.includes("flue_conversation_stream_batch_chunks");
    const batches = (await batchesOf(s, src, chunked)).filter((b) => o.upTo === undefined || b.seq < o.upTo);
    const plan = planFork(batches, o.before);
    for (const b of batches.slice(0, plan.whole)) {
      await insert(s, "flue_conversation_stream_batches", { ...b.row, path: dst });
      if (chunked && String(b.row.data).startsWith("{"))
        for (const c of await s.all(
          "SELECT * FROM flue_conversation_stream_batch_chunks WHERE path = ? AND seq = ?",
          src,
          b.row.seq,
        ))
          await insert(s, "flue_conversation_stream_batch_chunks", { ...c, path: dst });
    }
    let offset = plan.whole;
    if (plan.partial) {
      const data = JSON.stringify(plan.partial);
      if (data.length > 1_048_576)
        throw new ForkRefused(
          409,
          "the turn before that message is too large to divide; edit an earlier message",
        );
      await insert(s, "flue_conversation_stream_batches", { ...batches[plan.whole].row, path: dst, data });
      offset += 1;
    }
    await insert(s, "flue_conversation_streams", {
      path: dst,
      identity_json: JSON.stringify({ agentName: o.to.agentName, instanceId: o.to.instanceId }),
      next_offset: offset,
      producer_id: stream.producer_id,
      producer_epoch: Number(stream.producer_epoch),
      next_producer_sequence: 0,
      incarnation: incarnation(),
    });
    if (tables.includes("flue_attachments"))
      for (const a of await s.all("SELECT * FROM flue_attachments WHERE stream_path = ?", src))
        await insert(s, "flue_attachments", { ...a, stream_path: dst });
    if (tables.includes("flue_attachment_chunks"))
      for (const c of await s.all("SELECT * FROM flue_attachment_chunks WHERE stream_path = ?", src))
        await insert(s, "flue_attachment_chunks", { ...c, stream_path: dst });
    return { ...plan, offset };
  });
}

/** The first message a person sent into a stream from one batch on: a branch's own first words. */
export async function firstUserMessage(sql: Sql, path: string, fromSeq: number): Promise<string | null> {
  const chunked = (await sql.tables()).includes("flue_conversation_stream_batch_chunks");
  for (const b of await batchesOf(sql, path, chunked, fromSeq))
    for (const r of b.records)
      if (r.type === "user_message" && typeof r.messageId === "string") return r.messageId;
  return null;
}

/** How many batches a conversation's stream holds, once every turn in it has settled: what a share's snapshot covers. */
export async function settledExtent(sql: Sql, agentName: string, instanceId: string): Promise<number> {
  const chunked = (await sql.tables()).includes("flue_conversation_stream_batch_chunks");
  const batches = await batchesOf(sql, streamPath(agentName, instanceId), chunked);
  if (batches.length === 0) throw new ForkRefused(409, "the conversation has no turns to share yet");
  try {
    return planFork(batches).whole;
  } catch (e) {
    if (e instanceof ForkRefused)
      throw new ForkRefused(409, "a turn is still running; share the conversation once it has settled");
    throw e;
  }
}
