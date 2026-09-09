// SPDX-License-Identifier: AGPL-3.0-only
// The gold answers, re-derived (Wave 4c §9.10 part 1): every document under
// gold/ is validated strictly and run against the registry at NILS_URL, and
// gold/expect.json records the content hash, the row count, the columns,
// the registry epoch and the pack version beside each. A gold answer whose
// epoch or pack moved goes stale, never red; a document the engine refuses
// fails this script by name.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const url = (process.env.NILS_URL ?? "http://127.0.0.1:8437").replace(/\/+$/u, "");
const token = process.env.NILS_TOKEN;
const dir = join(process.cwd(), "bench", "gold");

async function door(path: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}

interface Expect {
  hash: string;
  content_hash: string | null;
  row_count: number;
  truncated: boolean;
  columns: string[];
  epoch: number;
  pack: string;
  declaration: unknown;
}

const caps = (await (
  await fetch(`${url}/api/capabilities`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
).json()) as {
  registry: { epoch: number };
  packs: { name: string; version: string }[];
};
const pack = caps.packs.map((p) => `${p.name} ${p.version}`).join(", ");
const out: Record<string, Expect> = {};
let failed = 0;
for (const f of readdirSync(dir)
  .filter((x) => x.endsWith(".ask.yml"))
  .sort()) {
  const document = parse(readFileSync(join(dir, f), "utf8"));
  try {
    const v = await door("/api/ask/validate", { document, mode: "strict" });
    if (v.valid === false) throw new Error(`refused: ${JSON.stringify(v.issues).slice(0, 400)}`);
    // unnamed: a named handle is unique in the registry and this script runs again and again
    const run = (await door("/api/ask/run", { document })) as Record<string, unknown>;
    out[f] = {
      hash: String(run.hash),
      content_hash: (run.content_hash as string | null) ?? null,
      row_count: Number(run.row_count),
      truncated: Boolean(run.truncated),
      columns: ((run.columns as { name: string }[] | string[]) ?? []).map((c) =>
        typeof c === "string" ? c : c.name,
      ),
      epoch: caps.registry.epoch,
      pack,
      declaration: run.declaration,
    };
    console.log(
      `${f}: ${out[f].row_count} rows${out[f].truncated ? " (truncated)" : ""}, ${out[f].content_hash?.slice(0, 12) ?? "no hash"}`,
    );
  } catch (e) {
    failed += 1;
    console.error(`${f}: ${e instanceof Error ? e.message : e}`);
  }
}
writeFileSync(join(dir, "expect.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `${Object.keys(out).length} gold answers recorded at epoch ${caps.registry.epoch}, ${pack}; ${failed} failed`,
);
process.exit(failed > 0 ? 1 : 0);
