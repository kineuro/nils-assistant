// SPDX-License-Identifier: AGPL-3.0-only
// The assistant's configuration, from the environment the process starts
// with (Wave 4c §9.2): the engine, Kvasir and the app's minted key from a
// file, the store, the retention, the station directories. No credential
// of its own beyond the machine key of §8.4; telemetry off.

import { readFileSync } from "node:fs";

export interface Config {
  /** The engine's URL, the one the seam dials. */
  engine: string;
  /** Kvasir's URL, and the app's minted key read from a file at start. */
  kvasir: string;
  kvasirKey: string;
  /** The store: a SQLite path, or a Postgres URL. */
  store: string;
  /** The seam's own SQLite file. */
  ledger: string;
  /** Days the seam's rows and the assistant's transcripts are kept (C24: 90 by default). */
  retentionDays: number;
  /** The directories station manifests are loaded from (§4.4). */
  stationDirs: string[];
  /** The one origin that may call this host: the desk. */
  origin: string;
  version: string;
}

export const VERSION = "1.0.0-alpha.0";

export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const keyFile = env.KVASIR_KEY_FILE;
  const kvasirKey = keyFile ? readFileSync(keyFile, "utf8").trim() : (env.KVASIR_KEY ?? "");
  return {
    engine: (env.NILS_URL ?? "http://127.0.0.1:8437").replace(/\/+$/u, ""),
    kvasir: (env.KVASIR_URL ?? "http://127.0.0.1:7199").replace(/\/+$/u, ""),
    kvasirKey,
    store: env.ASSISTANT_STORE ?? "./data/assistant.sqlite",
    ledger: env.ASSISTANT_LEDGER ?? "./data/seam.sqlite",
    retentionDays: Number(env.ASSISTANT_RETENTION_DAYS ?? 90),
    stationDirs: (env.ASSISTANT_STATIONS ?? "./stations").split(":").filter(Boolean),
    origin: (env.DESK_ORIGIN ?? "http://127.0.0.1:7200").replace(/\/+$/u, ""),
    version: VERSION,
  };
}
