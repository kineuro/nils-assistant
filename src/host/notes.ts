// SPDX-License-Identifier: AGPL-3.0-only
// Memory across threads (Wave 4c §9.9, D5). Per person: typed notes, one
// row each, keyed on the subject the token names; a one-line index, at
// most five in a prompt, with a staleness caveat on anything older than a
// day. Across people: only corrections, only structural (the station, the
// decision axis, the check that would now catch it), only after a named
// person accepted one, and never a value: the row has no free text field,
// so a note names nothing a reader may not see, by construction.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { guardMemory } from "./guard.ts";
import { scoreOf, termsOf } from "./words.ts";

export type NoteKind = "person" | "correction" | "study" | "reference";
export const NOTE_KINDS: NoteKind[] = ["person", "correction", "study", "reference"];

/** How a note came to be kept (the chat, slice 6): said in a conversation, accepted from an offer, added on the Memory page, or left by the person's work. */
export type NoteSource = "said" | "accepted" | "page" | "work";

export interface Note {
  id: number;
  subject: string;
  kind: NoteKind;
  text: string;
  station: string;
  at: number;
  source: NoteSource | null;
  used_at: number | null;
  edited_at: number | null;
}

/** The install's instructions: one version of the page an admin keeps. */
export interface Instructions {
  version: number;
  text: string;
  author: string;
  at: number;
}

/** The most one memory of a person's holds, and the most the install's instructions hold. */
export const MEMORY_CHARS = 300;
export const INSTRUCTION_CHARS = 4000;

/** The most of what a person asked to keep a new conversation reads, in characters; beyond it, what is closest to its first message (the chat, slice 13). */
export const MEMORY_BUDGET = 3_000;

/** A memory or an instruction the store will not keep, with the status a door answers. */
export class MemoryRefused extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

export interface InstitutionalCorrection {
  id: number;
  station: string;
  axis: string;
  check: string;
  accepted_by: string;
  at: number;
}

const DAY = 24 * 60 * 60 * 1000;
const ID = /^[a-z][a-z0-9_.-]{0,63}$/u;

export class Notes {
  readonly db: DatabaseSync;
  constructor(path: string) {
    // the store's directory is made on first use, as the ledger's is
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS note (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      station TEXT NOT NULL,
      at INTEGER NOT NULL
    )`);
    this.db.exec("CREATE INDEX IF NOT EXISTS note_subject ON note (subject, at)");
    // the chat, slice 6: how a note was kept, when a conversation last read it, when it was edited; a pause per person; the install's instructions, by version
    const have = new Set(
      (this.db.prepare("PRAGMA table_info(note)").all() as { name: string }[]).map((c) => c.name),
    );
    for (const [name, type] of [
      ["source", "TEXT"],
      ["used_at", "INTEGER"],
      ["edited_at", "INTEGER"],
    ])
      if (!have.has(name)) this.db.exec(`ALTER TABLE note ADD COLUMN ${name} ${type}`);
    this.db.exec("CREATE TABLE IF NOT EXISTS memory_pause (subject TEXT PRIMARY KEY, at INTEGER NOT NULL)");
    this.db.exec(`CREATE TABLE IF NOT EXISTS instruction (
      version INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      author TEXT NOT NULL,
      at INTEGER NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS institutional_correction (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station TEXT NOT NULL,
      axis TEXT NOT NULL,
      "check" TEXT NOT NULL,
      accepted_by TEXT NOT NULL,
      at INTEGER NOT NULL
    )`);
  }

  add(n: {
    subject: string;
    kind: NoteKind;
    text: string;
    station: string;
    at?: number;
    source?: NoteSource;
  }): Note {
    if (!NOTE_KINDS.includes(n.kind)) throw new Error(`a note is one of ${NOTE_KINDS.join(", ")}`);
    const text = n.text.replace(/\s+/gu, " ").trim().slice(0, 400);
    if (!text) throw new Error("a note has text");
    const at = n.at ?? Date.now();
    const source = n.source ?? (n.kind === "person" ? null : "work");
    const r = this.db
      .prepare("INSERT INTO note (subject, kind, text, station, at, source) VALUES (?, ?, ?, ?, ?, ?)")
      .run(n.subject, n.kind, text, n.station, at, source);
    return {
      id: Number(r.lastInsertRowid),
      subject: n.subject,
      kind: n.kind,
      text,
      station: n.station,
      at,
      source,
      used_at: null,
      edited_at: null,
    };
  }

  list(subject: string, limit = 200): Note[] {
    return this.db
      .prepare("SELECT * FROM note WHERE subject = ? ORDER BY at DESC LIMIT ?")
      .all(subject, limit) as unknown as Note[];
  }

  delete(id: number): boolean {
    return this.db.prepare("DELETE FROM note WHERE id = ?").run(id).changes > 0;
  }

  /** A person keeps something (the chat, slice 6): refused while their memory is paused, past its size, or when it looks like a person's data. */
  remember(subject: string, raw: string, source: NoteSource): Note {
    if (this.paused(subject)) throw new MemoryRefused(409, "memory is paused; resume it to keep something");
    const text = checked(raw, MEMORY_CHARS, true);
    return this.add({ subject, kind: "person", text, station: "desk", source });
  }

  /** A person edits what they asked to keep; another person's memory is not theirs to edit. */
  edit(subject: string, id: number, raw: string): Note {
    const text = checked(raw, MEMORY_CHARS, true);
    const now = Date.now();
    const r = this.db
      .prepare("UPDATE note SET text = ?, edited_at = ? WHERE id = ? AND subject = ? AND kind = 'person'")
      .run(text, now, id, subject);
    if (r.changes === 0) throw new MemoryRefused(404, `no memory ${id} of yours`);
    return this.db.prepare("SELECT * FROM note WHERE id = ?").get(id) as unknown as Note;
  }

  /** A person deletes one of their notes. */
  removeOwn(subject: string, id: number): boolean {
    return this.db.prepare("DELETE FROM note WHERE id = ? AND subject = ?").run(id, subject).changes > 0;
  }

  /** What a person asked to keep, the latest first. */
  people(subject: string, limit = 50): Note[] {
    return this.db
      .prepare(
        "SELECT * FROM note WHERE subject = ? AND kind = 'person' ORDER BY COALESCE(edited_at, at) DESC, id DESC LIMIT ?",
      )
      .all(subject, limit) as unknown as Note[];
  }

  /** One of a person's own memories by its number, however many they keep (the chat, slice 13). */
  ownMemory(subject: string, id: number): Note | null {
    return (
      (this.db
        .prepare("SELECT * FROM note WHERE id = ? AND subject = ? AND kind = 'person'")
        .get(id, subject) as unknown as Note | undefined) ?? null
    );
  }

  /**
   * What a new conversation reads of what a person asked to keep (the chat, slice 13): all of it while it fits in
   * the budget, the latest first; beyond it, the memories closest to the conversation's first message, then the
   * latest, as many as fit, and how many more are kept. A memory counts as the line the instructions give it.
   */
  memoriesFor(subject: string, first: string | null, budget = MEMORY_BUDGET): { read: Note[]; rest: number } {
    const all = this.people(subject, 1000);
    const size = (n: Note) => n.text.length + String(n.id).length + 6;
    if (all.reduce((sum, n) => sum + size(n), 0) <= budget) return { read: all, rest: 0 };
    const terms = first ? termsOf(first) : [];
    const ranked = all
      .map((n, i) => ({ n, i, score: terms.length > 0 ? scoreOf(terms, n.text) : 0 }))
      .sort((a, b) => b.score - a.score || a.i - b.i);
    const read: Note[] = [];
    let used = 0;
    for (const { n } of ranked) {
      if (used + size(n) > budget) continue;
      read.push(n);
      used += size(n);
    }
    return { read, rest: all.length - read.length };
  }

  /** A person's memories holding the most of the words, the latest first among equals, at most eight (the chat, slice 13). */
  recallMemory(subject: string, words: string, limit = 8): Note[] {
    const terms = termsOf(words);
    if (terms.length === 0) return [];
    return this.people(subject, 1000)
      .map((n, i) => ({ n, i, score: scoreOf(terms, n.text) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, limit)
      .map((m) => m.n);
  }

  /** The notes a person's work left, one line each, the newest first, a staleness caveat on anything older than a day. */
  work(subject: string, now = Date.now(), cap = 5): string[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM note WHERE subject = ? AND kind != 'person' ORDER BY at DESC, id DESC LIMIT ?",
        )
        .all(subject, cap) as unknown as Note[]
    ).map(
      (n) =>
        `${n.kind}: ${n.text}${now - n.at >= DAY ? ` (from ${new Date(n.at).toISOString().slice(0, 10)}, may be stale)` : ""}`,
    );
  }

  /** When conversations last read these notes. */
  touch(ids: number[], at = Date.now()): void {
    for (const id of ids) this.db.prepare("UPDATE note SET used_at = ? WHERE id = ?").run(at, id);
  }

  paused(subject: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM memory_pause WHERE subject = ?").get(subject));
  }

  /** Pause a person's memory, or resume it: while paused nothing is read into a new conversation and nothing is kept. */
  pause(subject: string, on: boolean): boolean {
    if (on)
      this.db
        .prepare("INSERT INTO memory_pause (subject, at) VALUES (?, ?) ON CONFLICT(subject) DO NOTHING")
        .run(subject, Date.now());
    else this.db.prepare("DELETE FROM memory_pause WHERE subject = ?").run(subject);
    return this.paused(subject);
  }

  /** The notes a person's work left go with the retention; what a person asked to keep stays until they delete it. */
  sweepWork(days: number): void {
    const cut = Date.now() - days * DAY;
    this.db.prepare("DELETE FROM note WHERE kind != 'person' AND at < ?").run(cut);
  }

  /** The install's instructions now: the latest version. */
  instructions(): Instructions | null {
    return (
      (this.db.prepare("SELECT * FROM instruction ORDER BY version DESC LIMIT 1").get() as
        | Instructions
        | undefined) ?? null
    );
  }

  instructionHistory(limit = 20): { version: number; author: string; at: number; chars: number }[] {
    return this.db
      .prepare(
        "SELECT version, author, at, length(text) AS chars FROM instruction ORDER BY version DESC LIMIT ?",
      )
      .all(limit) as unknown as { version: number; author: string; at: number; chars: number }[];
  }

  /** The next version of the install's instructions, by a named person; refused past its size or when it looks like a person's data. */
  writeInstructions(raw: string, author: string): Instructions {
    const text = raw.trim();
    if (!text) throw new MemoryRefused(422, "the instructions are empty");
    if (text.length > INSTRUCTION_CHARS)
      throw new MemoryRefused(422, `the instructions hold at most ${INSTRUCTION_CHARS} characters`);
    const g = guardMemory(text);
    if (!g.ok) throw new MemoryRefused(422, g.why);
    const r = this.db
      .prepare("INSERT INTO instruction (text, author, at) VALUES (?, ?, ?)")
      .run(text, author, Date.now());
    return this.db
      .prepare("SELECT * FROM instruction WHERE version = ?")
      .get(Number(r.lastInsertRowid)) as unknown as Instructions;
  }

  /** Deletion on request (§10): every note of a subject. */
  deleteSubject(subject: string): number {
    return Number(this.db.prepare("DELETE FROM note WHERE subject = ?").run(subject).changes);
  }

  /** Notes written under a person's older key become their principal's (the chat, slice 1): the bare `sub` a token gave, or `anonymous` while the engine serves with its authentication off. */
  adopt(principal: string, o: { bare: string; authOff: boolean }): number {
    let n = 0;
    if (o.bare && o.bare !== principal)
      n += Number(
        this.db.prepare("UPDATE note SET subject = ? WHERE subject = ?").run(principal, o.bare).changes,
      );
    if (o.authOff)
      n += Number(
        this.db.prepare("UPDATE note SET subject = ? WHERE subject = 'anonymous'").run(principal).changes,
      );
    return n;
  }

  /**
   * The one-line index a prompt carries: the newest five of a subject, one
   * line each, a staleness caveat on anything older than a day. The selector
   * of §9.9 is a small model over this index; here it is recency, which a
   * later slice may replace without touching the callers.
   */
  index(subject: string, now = Date.now(), cap = 5): string[] {
    return this.list(subject, cap).map(
      (n) =>
        `${n.kind}: ${n.text}${now - n.at >= DAY ? ` (from ${new Date(n.at).toISOString().slice(0, 10)}, may be stale)` : ""}`,
    );
  }

  /** An institutional correction: structural only, accepted by a named person. Every field is an identifier; no value fits. */
  accept(c: {
    station: string;
    axis: string;
    check: string;
    accepted_by: string;
    at?: number;
  }): InstitutionalCorrection {
    for (const [k, v] of Object.entries({ station: c.station, axis: c.axis, check: c.check })) {
      if (!ID.test(v))
        throw new Error(
          `${k} is an identifier (a station, a decision axis, a check), not a value: ${JSON.stringify(v).slice(0, 40)}`,
        );
    }
    if (!c.accepted_by.trim()) throw new Error("a correction is accepted by a named person");
    const at = c.at ?? Date.now();
    const r = this.db
      .prepare(
        'INSERT INTO institutional_correction (station, axis, "check", accepted_by, at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(c.station, c.axis, c.check, c.accepted_by, at);
    return { id: Number(r.lastInsertRowid), ...c, at };
  }

  institutional(station?: string): InstitutionalCorrection[] {
    return (station
      ? this.db
          .prepare("SELECT * FROM institutional_correction WHERE station = ? ORDER BY at DESC")
          .all(station)
      : this.db
          .prepare("SELECT * FROM institutional_correction ORDER BY at DESC")
          .all()) as unknown as InstitutionalCorrection[];
  }

  close(): void {
    this.db.close();
  }
}

/** A person's memory as it would be kept, or refused: one line, within its size, and nothing that looks like a person's data. */
export function checkMemory(raw: string): string {
  return checked(raw, MEMORY_CHARS, true);
}

/** One memory's text as the store keeps it: one line, within its size, and nothing that looks like a person's data. */
function checked(raw: string, max: number, series: boolean): string {
  const text = raw.replace(/\s+/gu, " ").trim();
  if (!text) throw new MemoryRefused(422, "there is nothing to keep");
  if (text.length > max) throw new MemoryRefused(422, `a memory holds at most ${max} characters`);
  const g = guardMemory(text, { series });
  if (!g.ok) throw new MemoryRefused(422, g.why);
  return text;
}

/** The subject a token names: a JWT's `sub`, else the desk's anonymous person in off mode. */
export function subjectOf(token: string | null): string {
  if (!token) return "anonymous";
  const parts = token.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1].replace(/-/gu, "+").replace(/_/gu, "/"), "base64").toString("utf8"),
      ) as { sub?: unknown };
      if (typeof payload.sub === "string" && payload.sub) return payload.sub;
    } catch {
      // not a JWT: an opaque token names no one
    }
  }
  return "anonymous";
}

/** The command line: `notes list --subject S`, `notes delete --subject S` (every note of S, §10), `notes delete --id N`. */
if (process.argv[1]?.endsWith("notes.js")) {
  const args = process.argv.slice(2);
  const verb = args[0];
  const opt = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const path = process.env.ASSISTANT_NOTES ?? "./data/notes.sqlite";
  const notes = new Notes(path);
  const subject = opt("subject");
  if (verb === "list" && subject) {
    for (const n of notes.list(subject))
      console.log(`${n.id}\t${new Date(n.at).toISOString()}\t${n.kind}\t${n.station}\t${n.text}`);
  } else if (verb === "list" && args.includes("--institutional")) {
    for (const c of notes.institutional())
      console.log(
        `${c.id}\t${new Date(c.at).toISOString()}\t${c.station}\t${c.axis}\t${c.check}\taccepted by ${c.accepted_by}`,
      );
  } else if (verb === "delete" && subject) {
    console.log(`${notes.deleteSubject(subject)} notes of ${subject} deleted`);
  } else if (verb === "delete" && opt("id")) {
    console.log(notes.delete(Number(opt("id"))) ? "deleted" : "no such note");
  } else {
    console.error(
      "notes list --subject S | notes list --institutional | notes delete --subject S | notes delete --id N",
    );
    process.exit(2);
  }
  notes.close();
}
