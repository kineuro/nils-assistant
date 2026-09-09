// SPDX-License-Identifier: AGPL-3.0-only
// The seam a station's tools use, bound to the process's configuration, the
// ledger, the tokens the desk handed, and the station's manifest. One
// module-level registry, because a Flue tool closes over the conversation
// id and nothing else.

import { config } from "../config.ts";
import { Notes, subjectOf } from "../host/notes.ts";
import type { Verdict } from "../stations/verdict.ts";
import { Seam, type Station } from "./client.ts";
import { Ledger } from "./ledger.ts";
import { Tokens } from "./tokens.ts";

let ledger: Ledger | null = null;
/** Whether the engine serves with its authentication off, read once from its capabilities; unknown counts as on. */
let engineAuthOff = false;
export async function probeEngineAuth(engine: string, dial: typeof fetch = fetch): Promise<boolean> {
  try {
    const r = await dial(`${engine.replace(/\/+$/u, "")}/api/capabilities`);
    const doc = (await r.json()) as { auth?: unknown };
    engineAuthOff = r.ok && doc.auth === "off";
  } catch {
    engineAuthOff = false;
  }
  return engineAuthOff;
}
export const tokens = new Tokens();
/** The settled verdict of a conversation, for the host to answer beside the run; the record log keeps it durably. */
export const verdicts = new Map<string, Verdict>();

/** One proposal the desk accepted or rejected (section 7.7): the document it named and the sentence it carried. */
export interface Feedback {
  document: number;
  sentence: string;
}
const feedback = new Map<string, { accepted: Feedback[]; rejected: Feedback[] }>();

/** The desk's feedback on a conversation's proposals, kept for the next turn's prompt; rows of the wrong shape are dropped. */
export function recordFeedback(
  conversation: string,
  body: { accepted?: unknown[]; rejected?: unknown[] },
): void {
  const rows = (list: unknown[] | undefined): Feedback[] =>
    (list ?? []).flatMap((r) => {
      const o = r as { document?: unknown; sentence?: unknown };
      return typeof o?.document === "number"
        ? [{ document: o.document, sentence: typeof o.sentence === "string" ? o.sentence : "" }]
        : [];
    });
  const cur = feedback.get(conversation) ?? { accepted: [], rejected: [] };
  const accepted = rows(body.accepted);
  const rejected = rows(body.rejected);
  cur.accepted.push(...accepted);
  cur.rejected.push(...rejected);
  feedback.set(conversation, cur);
  // a correction the person made, kept for their later threads (section 9.9); the id, never the rows
  const subject = subjectOfConversation(conversation);
  for (const r of rejected)
    theNotes().add({
      subject,
      kind: "correction",
      station: "desk",
      text: `rejected document ${r.document}${r.sentence ? `: ${r.sentence}` : ""}`,
    });
}

export function feedbackOf(conversation: string): { accepted: Feedback[]; rejected: Feedback[] } {
  return feedback.get(conversation) ?? { accepted: [], rejected: [] };
}
const stations = new Map<string, Station>();
const seams = new Map<string, Seam>();

export function registerStation(s: Station): void {
  stations.set(s.id, s);
}

export function stationList(): Station[] {
  return [...stations.values()];
}

let notes: Notes | null = null;
export function theNotes(): Notes {
  if (!notes) notes = new Notes(config().notes);
  return notes;
}
/** The person a conversation belongs to, from the token the desk handed. */
export function subjectOfConversation(conversation: string): string {
  return subjectOf(tokens.get(conversation));
}

export function theLedger(): Ledger {
  if (!ledger) {
    const c = config();
    ledger = new Ledger(c.ledger);
    ledger.sweep(c.retentionDays);
  }
  return ledger;
}

/** The seam of one conversation of one station; the grant's counts live for the conversation. */
export function seamFor(station: string, conversation: string): Seam {
  const key = `${station}/${conversation}`;
  let s = seams.get(key);
  if (!s) {
    const st = stations.get(station);
    if (!st) throw new Error(`no station ${station} is registered`);
    s = new Seam({
      engine: config().engine,
      station: st,
      conversation,
      token: () => tokens.get(conversation),
      authOff: () => engineAuthOff,
      ledger: theLedger(),
    });
    seams.set(key, s);
  }
  return s;
}
