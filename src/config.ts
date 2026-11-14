// SPDX-License-Identifier: AGPL-3.0-only
// The assistant's configuration, from the environment the process starts
// with (Wave 4c §9.2): the engine, Kvasir and the app's minted key from a
// file, the store, the retention, the station directories. No credential
// of its own beyond the machine key of §8.4; telemetry off.

import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Config {
  /** The engine's URL, the one the seam dials. */
  engine: string;
  /** Kvasir's URL, and the app's minted key read from a file at start. */
  kvasir: string;
  kvasirKey: string;
  /** The store: a SQLite path, or a Postgres URL. */
  store: string;
  /** The seam's own SQLite file. This and every store below is, unless its own variable names it, a file beside the store (`ownFile`). */
  ledger: string;
  /** The notes of section 9.9, their own SQLite file. */
  notes: string;
  /** The conversations by lineage, the proposals and the rail's context (Wave 5 D1), their own SQLite file. */
  lineage: string;
  /** The ladder (Wave 5 section 9.1 to 9.4): standing grants, plans and their steps, their own SQLite file. */
  ladder: string;
  /** One chat (2026-10-09): the changes the one agent proposed, pending a person's approval, their own SQLite file. */
  changes: string;
  /** C49, off by default: when on, a person without the `assist-run` entitlement has an empty rung two whatever they tick. */
  requireAssistRun: boolean;
  /** Teaching (Wave 5 section 9.5): its own SQLite file and the directory of curated sets and adapters. */
  teaching: string;
  teachingDir: string;
  /** The share of the bench a candidate must pass before promotion is offered; 1 = every question. */
  benchThreshold: number;
  /** The backend a fine-tuned candidate is registered on in Kvasir. */
  teachingBackend: string;
  /** Days the seam's rows and the assistant's transcripts are kept (C24: 90 by default). */
  retentionDays: number;
  /** The directories station manifests are loaded from (§4.4). */
  stationDirs: string[];
  /** The one origin that may call this host: the desk. */
  origin: string;
  version: string;
}

export const VERSION = "1.0.0-alpha.35";

/** The store when ASSISTANT_STORE names none. */
export const DEFAULT_STORE = "./data/assistant.sqlite";

/**
 * The folder the assistant's own files live in (2026-11-13): the folder of the store, so an install that names the
 * store alone has every other file beside it. Each store once defaulted to `./data` by itself, and an install that
 * named six of the seven files in its state folder left the seventh in a folder that did not exist. A store that
 * is a Postgres URL names no folder, and the files stay under `./data`.
 */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  const store = env.ASSISTANT_STORE;
  if (!store || store === ":memory:" || /^postgres(ql)?:\/\//u.test(store)) return "./data";
  return dirname(store);
}

/**
 * One of the assistant's own files: the one its variable names, else `name` beside the store. A file an install
 * already keeps under `./data` from before stays in use while there is none beside the store, so no pending
 * proposal, standing grant or note is left behind by the new default.
 */
export function ownFile(
  env: NodeJS.ProcessEnv,
  variable: string,
  name: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const named = env[variable];
  if (named) return named;
  const dir = stateDir(env);
  const beside = `${dir}/${name}`;
  const before = `./data/${name}`;
  return dir !== "./data" && !exists(beside) && exists(before) ? before : beside;
}

/** The variables that name the assistant's own SQLite files, with the configuration's key for each. */
export const STORE_VARIABLES = {
  ledger: "ASSISTANT_LEDGER",
  notes: "ASSISTANT_NOTES",
  lineage: "ASSISTANT_LINEAGE",
  ladder: "ASSISTANT_LADDER",
  changes: "ASSISTANT_CHANGES",
  teaching: "ASSISTANT_TEACHING",
} as const;

export function config(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): Config {
  const keyFile = env.KVASIR_KEY_FILE;
  const kvasirKey = keyFile ? readFileSync(keyFile, "utf8").trim() : (env.KVASIR_KEY ?? "");
  const own = (variable: string, name: string) => ownFile(env, variable, name, exists);
  return {
    engine: (env.NILS_URL ?? "http://127.0.0.1:8437").replace(/\/+$/u, ""),
    kvasir: (env.KVASIR_URL ?? "http://127.0.0.1:7199").replace(/\/+$/u, ""),
    kvasirKey,
    store: env.ASSISTANT_STORE ?? DEFAULT_STORE,
    ledger: own(STORE_VARIABLES.ledger, "seam.sqlite"),
    notes: own(STORE_VARIABLES.notes, "notes.sqlite"),
    lineage: own(STORE_VARIABLES.lineage, "lineage.sqlite"),
    ladder: own(STORE_VARIABLES.ladder, "ladder.sqlite"),
    changes: own(STORE_VARIABLES.changes, "changes.sqlite"),
    requireAssistRun: env.ASSISTANT_REQUIRE_ASSIST_RUN === "1",
    teaching: own(STORE_VARIABLES.teaching, "teaching.sqlite"),
    teachingDir: own("ASSISTANT_TEACHING_DIR", "teaching"),
    benchThreshold: Math.min(1, Math.max(0, Number(env.ASSISTANT_BENCH_THRESHOLD ?? 1))),
    teachingBackend: env.ASSISTANT_TEACHING_BACKEND ?? "card0",
    retentionDays: Number(env.ASSISTANT_RETENTION_DAYS ?? 90),
    stationDirs: (env.ASSISTANT_STATIONS ?? "./stations").split(":").filter(Boolean),
    origin: (env.DESK_ORIGIN ?? "http://127.0.0.1:7200").replace(/\/+$/u, ""),
    version: VERSION,
  };
}
