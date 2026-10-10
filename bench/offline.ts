// SPDX-License-Identifier: AGPL-3.0-only
// The offline bench: a station's question set (stations/<id>/evals/cases.yml)
// run through the station's own code against a running engine, with the stub
// model of bench/stub-model.ts in place of a model, scored as bench/measure.ts
// scores a live run (bench/cases.ts). No assistant host, no model gateway, no
// network beyond the engine on this machine. It says whether the engine's
// doors, the station's tools and checks and the cases agree; a station's
// number is the live measure's.
//
//   npm run bench:seed -- --home <empty dir> --nils <nils binary> --pack-dir <packs>
//   <the serve command of <empty dir>/seeded.json, with a port>
//   npm run bench:offline -- --engine http://127.0.0.1:<engine port> [--stations identity-check] [--out <file>]
//
// The station's ledger, store and notes go to a directory of their own under
// TMPDIR, made for the run.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import { type Case, type LedgerRow, missesOf } from "./cases.ts";
import { endpoint } from "./measure.ts";

/** The stations the stub model has a policy for. */
export const OFFLINE = ["identity-check"] as const;

export interface OfflineCase {
  id: string;
  gap: string | null;
  terminal: string;
  misses: string[];
}

export async function offline(o: { engine: string; station: string }): Promise<OfflineCase[]> {
  if (!(OFFLINE as readonly string[]).includes(o.station))
    throw new Error(`the stub model has no policy for ${o.station}; it has ${OFFLINE.join(", ")}`);
  const scratch = mkdtempSync(join(tmpdir(), "bench-offline-"));
  process.env.NILS_URL = o.engine;
  process.env.KVASIR_URL = "http://127.0.0.1:9";
  process.env.ASSISTANT_STORE = join(scratch, "assistant.sqlite");
  process.env.ASSISTANT_LEDGER = join(scratch, "seam.sqlite");
  process.env.ASSISTANT_NOTES = join(scratch, "notes.sqlite");
  process.env.ASSISTANT_LINEAGE = join(scratch, "lineage.sqlite");
  process.env.ASSISTANT_LADDER = join(scratch, "ladder.sqlite");
  process.env.ASSISTANT_TEACHING = join(scratch, "teaching.sqlite");
  process.env.ASSISTANT_TEACHING_DIR = join(scratch, "teaching");
  // the modules read the configuration when they are first used, so they load after it is set
  const { init } = await import("@flue/runtime");
  const { sqlite, start } = await import("@flue/runtime/node");
  const { probeEngineAuth, registerStation, theLedger, verdicts } = await import("../src/seam/for.ts");
  const { loadManifests } = await import("../src/stations/manifest.ts");
  const { identityCheck } = await import("../src/stations/identity-check.ts");
  const { identityCheckPolicy, stubProvider } = await import("./stub-model.ts");

  const m = loadManifests([resolve("stations")]).get(o.station);
  if (!m) throw new Error(`no manifest for ${o.station} under stations/`);
  await probeEngineAuth(o.engine);
  registerStation({
    id: m.id,
    version: "offline",
    grant: m.grant,
    ceiling: m.ceiling,
    content: m.content,
    model: "stub",
  });
  const agent = identityCheck(m, readFileSync(resolve(m.dir, m.brief.path), "utf8"), "stub");
  const flue = await start({
    agents: [agent],
    db: sqlite(join(scratch, "flue.sqlite")),
    providers: [stubProvider(`kvasir-${m.id}`, identityCheckPolicy)],
  });
  const cases = (
    parse(readFileSync(join("stations", o.station, "evals", "cases.yml"), "utf8")) as { cases: Case[] }
  ).cases;
  const out: OfflineCase[] = [];
  try {
    for (const c of cases) {
      const id = `offline-${o.station}-${c.id}-${Date.now()}`;
      const h = init(agent, { id });
      const reply = await h
        .read(await h.dispatch(c.message))
        .catch((e: Error) => ({ text: `failed: ${e.message}`, metadata: { terminal: "error" } }));
      const verdict = verdicts.get(id) ?? null;
      const terminal = String(
        (reply.metadata as { terminal?: unknown } | undefined)?.terminal ??
          (verdict ? "settled" : "not_settled"),
      );
      const ledger = theLedger().rows(id) as unknown as LedgerRow[];
      const misses = missesOf(c, {
        terminal,
        verdict: verdict ? { result: verdict.result, checks: verdict.checks } : null,
        plan: null,
        ledger,
      });
      out.push({ id: c.id, gap: c.gap ?? null, terminal, misses });
    }
  } finally {
    await flue.stop();
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]).endsWith(join("bench", "offline.js"))) {
  const { values } = parseArgs({
    options: {
      engine: { type: "string", default: "http://127.0.0.1:8437" },
      stations: { type: "string", default: OFFLINE.join(",") },
      out: { type: "string" },
      "allow-remote": { type: "boolean", default: false },
    },
  });
  const engine = endpoint(String(values.engine), Boolean(values["allow-remote"]), "--engine");
  const all: Record<string, OfflineCase[]> = {};
  let failed = 0;
  for (const station of String(values.stations).split(",").filter(Boolean)) {
    const rows = await offline({ engine, station });
    all[station] = rows;
    for (const r of rows) {
      if (r.misses.length > 0) failed += 1;
      console.log(
        `${station} ${r.id}: ${r.misses.length === 0 ? "pass" : `FAIL (${r.misses.join("; ")})`} [${r.terminal}]${r.gap ? " (a known gap)" : ""}`,
      );
    }
    const passed = rows.filter((r) => r.misses.length === 0).length;
    console.log(`${station}: ${passed} of ${rows.length} with the stub model`);
  }
  if (values.out)
    writeFileSync(
      String(values.out),
      `${JSON.stringify({ engine, model: "stub", stations: all }, null, 2)}\n`,
    );
  process.exit(failed === 0 ? 0 : 1);
}
