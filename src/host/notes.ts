// SPDX-License-Identifier: AGPL-3.0-only
// Memory across threads (Wave 4c §9.9, D5). Per person: typed notes, one
// row each, keyed on the subject the token names; a one-line index, at
// most five in a prompt, with a staleness caveat on anything older than a
// day. Across people: only corrections, only structural (the station, the
// decision axis, the check that would now catch it), only after a named
// person accepted one, and never a value: the row has no free text field,
// so a note names nothing a reader may not see, by construction.

import { DatabaseSync } from "node:sqlite";

export type NoteKind = "person" | "correction" | "study" | "reference";
export const NOTE_KINDS: NoteKind[] = ["person", "correction", "study", "reference"];

export interface Note {
  id: number;
  subject: string;
  kind: NoteKind;
  text: string;
  station: string;
  at: number;
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
    this.db.exec(`CREATE TABLE IF NOT EXISTS institutional_correction (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station TEXT NOT NULL,
      axis TEXT NOT NULL,
      "check" TEXT NOT NULL,
      accepted_by TEXT NOT NULL,
      at INTEGER NOT NULL
    )`);
  }

  add(n: { subject: string; kind: NoteKind; text: string; station: string; at?: number }): Note {
    if (!NOTE_KINDS.includes(n.kind)) throw new Error(`a note is one of ${NOTE_KINDS.join(", ")}`);
    const text = n.text.replace(/\s+/gu, " ").trim().slice(0, 400);
    if (!text) throw new Error("a note has text");
    const at = n.at ?? Date.now();
    const r = this.db
      .prepare("INSERT INTO note (subject, kind, text, station, at) VALUES (?, ?, ?, ?, ?)")
      .run(n.subject, n.kind, text, n.station, at);
    return { id: Number(r.lastInsertRowid), subject: n.subject, kind: n.kind, text, station: n.station, at };
  }

  list(subject: string, limit = 200): Note[] {
    return this.db
      .prepare("SELECT * FROM note WHERE subject = ? ORDER BY at DESC LIMIT ?")
      .all(subject, limit) as unknown as Note[];
  }

  delete(id: number): boolean {
    return this.db.prepare("DELETE FROM note WHERE id = ?").run(id).changes > 0;
  }

  /** Deletion on request (§10): every note of a subject. */
  deleteSubject(subject: string): number {
    return Number(this.db.prepare("DELETE FROM note WHERE subject = ?").run(subject).changes);
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
