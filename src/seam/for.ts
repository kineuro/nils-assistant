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
