// SPDX-License-Identifier: AGPL-3.0-only
// The seam a station's tools use, bound to the process's configuration, the
// ledger, the tokens the desk handed, and the station's manifest. One
// module-level registry, because a Flue tool closes over the conversation
// id and nothing else.

import { config } from "../config.ts";
import type { Verdict } from "../stations/verdict.ts";
import { Seam, type Station } from "./client.ts";
import { Ledger } from "./ledger.ts";
import { Tokens } from "./tokens.ts";

let ledger: Ledger | null = null;
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
  cur.accepted.push(...rows(body.accepted));
  cur.rejected.push(...rows(body.rejected));
  feedback.set(conversation, cur);
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
      ledger: theLedger(),
    });
    seams.set(key, s);
  }
  return s;
}
