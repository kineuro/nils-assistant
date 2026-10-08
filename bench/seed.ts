// SPDX-License-Identifier: AGPL-3.0-only
// The registry the two analysis stations are measured on (record 49 A5 and
// A6), built from nothing and synthetic throughout: the bench's synthetic
// registry (`nils synth --seed 11 --subjects 48`), then what the fixtures of
// analysis-plan and run-read ask of it.
//
// - analysis-plan (stations/analysis-plan/evals/cases.yml): the cohorts
//   `ms-cohort-a` and `ms-cohort-b` (synth makes them), `nmosd` (made here,
//   nine synthetic subjects), the saved selections `ms-baseline@1` and
//   `every-t1@2`, and the starter catalog seeded.
// - run-read (stations/run-read/evals/runs.json): the three planted runs of
//   bench/planted.ts over a small synthetic DICOM tree, run by the engine
//   through a stand-in container runtime, and their run ids written as the
//   `RUNS` the measure takes.
// - keyword-tune, identity-check and the operator (stations/<id>/evals/
//   cases.yml, bench/fixtures.ts): the batch `keyword-bench` with two site
//   words, classified; five datasets that arrive identified, each with its
//   map filed and pseudonymised once so the held door answers; the
//   registered location `inbox`; one stored question. Classifying the
//   keyword batch judges every stack again, synth's too: the counts of the
//   analysis-plan pre-flight move with it, which its cases do not score.
//
// It is a registry of its own, never the one ask-help's golds were derived
// on: a third cohort changes the answers of the cohort inventory and the
// per-cohort counts. It builds only in an empty directory, and every command
// it runs has its HOME, configuration and scratch inside that directory, so
// nothing of an install on the same machine is read or written.
//
//   node dist/bench/seed.js --home <empty dir> --pack-dir <packs> [--nils <binary>]
//
// Then serve it on a port of its own with the command `seeded.json` holds
// under `serve` (it registers the location `inbox`), point an assistant host
// at it, and give the measure `--seeded <home>/seeded.json`.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  DATASETS,
  datasetSeries,
  INBOX,
  inboxSeries,
  KEYWORD_BATCH,
  keywordSeries,
  QUESTION,
} from "./fixtures.ts";
import { descriptor, PLANTED, PLANTED_PEOPLE, STAND_IN_RUNTIME, writeSeries, writeTree } from "./planted.ts";

/** The batch name the planted tree is digested under; with synth's own, the only batches a seeded home holds. */
export const PLANTED_BATCH = "planted-bench";
/** The key phrase of the seeded registry: made up, and only ever this registry's. */
const KEY_PHRASE = "the nils bench synthetic registry\n";

/** The nine synthetic subjects of the made-up `nmosd` cohort: the last nine synth makes. */
export const NMOSD = Array.from({ length: 9 }, (_, i) => `SYN${String(40 + i).padStart(4, "0")}`);

const t1 = (where: unknown[] = []) => [
  ["=", {}, ["axis", {}, "technique"], "MPRAGE"],
  ["=", {}, ["axis", {}, "disposition"], "acquisition"],
  ...where,
];

/** The saved selections of cases.yml, each version as its document. */
export const SELECTIONS: { name: string; doc: Record<string, unknown> }[] = [
  {
    name: "ms-baseline",
    doc: {
      ast_version: 1,
      name: "cohort A's T1 at the first session",
      scheme: "default",
      sets: {
        scope: { grain: "cohort", where: [["=", {}, ["field", {}, "name"], "ms-cohort-a"]] },
        people: { grain: "subject", of: "scope" },
        visits: { grain: "session", of: "people", bind: { n: ["ordinal", {}] } },
        first: { grain: "session", from: "visits", where: [["=", {}, ["field", {}, "n"], 1]] },
        stacks: { grain: "stack", of: "first", where: t1() },
      },
      keep: ["stacks"],
      out: { set: "stacks", level: "record" },
    },
  },
  {
    name: "every-t1",
    doc: {
      ast_version: 1,
      name: "every one-millimetre T1",
      scheme: "default",
      sets: {
        stacks: {
          grain: "stack",
          where: t1([["~=", { tol: 0.05 }, ["field", {}, "slice_thickness"], 1.0]]),
        },
      },
      keep: ["stacks"],
      out: { set: "stacks", level: "record" },
    },
  },
  {
    name: "every-t1",
    doc: {
      ast_version: 1,
      name: "every T1",
      scheme: "default",
      sets: { stacks: { grain: "stack", where: t1() } },
      keep: ["stacks"],
      out: { set: "stacks", level: "record" },
    },
  },
];

interface Options {
  home: string;
  nils: string;
  packDir: string;
}

function options(): Options {
  const { values } = parseArgs({
    options: {
      home: { type: "string" },
      nils: { type: "string" },
      "pack-dir": { type: "string" },
    },
  });
  if (!values.home) throw new Error("--home names an empty directory the seeded registry is built in");
  const packDir = values["pack-dir"] ?? process.env.NILS_PACK_DIR;
  // the seed's HOME is its own, so the packs an install keeps under a HOME are not found: name them
  if (!packDir) throw new Error("--pack-dir names the packs (or NILS_PACK_DIR)");
  return {
    home: resolve(values.home),
    nils: values.nils ?? process.env.NILS_BIN ?? "nils",
    packDir: resolve(packDir),
  };
}

export async function seed(o: Options): Promise<Record<string, unknown>> {
  if (existsSync(o.home) && readdirSync(o.home).length > 0)
    throw new Error(
      `${o.home} is not empty: the seed builds its registry from nothing, in a directory of its own`,
    );
  const registry = join(o.home, "registry");
  const tree = join(o.home, "tree");
  const work = join(o.home, "work");
  const bin = join(o.home, "bin");
  const scratch = join(o.home, "tmp");
  for (const d of [registry, tree, work, bin, scratch]) mkdirSync(d, { recursive: true });
  writeFileSync(join(bin, "podman"), STAND_IN_RUNTIME);
  // no card in the bench, whatever the machine has
  writeFileSync(join(bin, "nvidia-smi"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(bin, "podman"), 0o755);
  chmodSync(join(bin, "nvidia-smi"), 0o755);

  const own = join(o.home, "home");
  mkdirSync(own, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: own,
    XDG_CONFIG_HOME: join(own, ".config"),
    XDG_DATA_HOME: join(own, ".local", "share"),
    XDG_STATE_HOME: join(own, ".local", "state"),
    XDG_CACHE_HOME: join(own, ".cache"),
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    TMPDIR: scratch,
    NILS_REGISTRY: registry,
    NILS_PACK_DIR: o.packDir,
  };
  delete env.NILS_DSN;
  delete env.NILS_TOKEN;
  delete env.NILS_JOB_ID;
  const packs = ["--pack-dir", o.packDir];
  const nils = (args: string[], input?: string): string =>
    execFileSync(o.nils, ["--registry", registry, ...args], {
      env,
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  const json = (args: string[]) => JSON.parse(nils([...args, "--json"])) as Record<string, unknown>;
  const file = (name: string, doc: unknown) => {
    const at = join(scratch, name);
    writeFileSync(at, JSON.stringify(doc));
    return at;
  };
  /** The ids of every stack, ascending. */
  const stackIds = (): number[] => {
    const ran = json([
      "ask",
      "run",
      ...packs,
      "--file",
      file("stacks.json", {
        ast_version: 1,
        name: "every stack",
        scheme: "default",
        sets: { s: { grain: "stack" } },
        keep: ["s"],
        out: {
          set: "s",
          level: "record",
          columns: [["field", {}, "id"]],
          order: [[["field", {}, "id"], "asc"]],
        },
      }),
    ]);
    const csv = join(scratch, "stacks.csv");
    nils(["ask", "handles", "export", "--handle", String(ran.handle), "--out", csv]);
    const [header, ...rows] = readFileSync(csv, "utf8").trim().split("\n");
    const k = header.split(",").findIndex((c) => c.replace(/"/gu, "") === "id");
    return rows.map((r) => Number(r.split(",")[k].replace(/"/gu, ""))).sort((a, b) => a - b);
  };

  // the registry, from nothing, under a key of its own
  nils(["key", "add", "bench"], KEY_PHRASE);
  nils(["init", "--key", "bench"]);
  nils(["synth", "--seed", "11", "--subjects", "48", "--manifest", join(o.home, "synth-manifest.json")]);
  nils(["place", "add", "scratch", work, "--role", "working", "--fast"]);
  nils(["pipeline", "starter", "--seed"]);

  // analysis-plan: the third cohort and the saved selections
  nils([
    "clinical",
    "cohort",
    "make",
    "nmosd",
    "--description",
    "a made-up cohort of the bench: nine synthetic subjects",
  ]);
  nils(["clinical", "cohort", "add", "nmosd", ...NMOSD, "--why", "the bench's synthetic cohort"]);
  const selections: string[] = [];
  for (const [i, s] of SELECTIONS.entries()) {
    const out = nils([
      "ask",
      "selections",
      "save",
      "--name",
      s.name,
      "--file",
      file(`selection-${i}.json`, s.doc),
      ...packs,
    ]);
    const at = /at version (\d+)/u.exec(out)?.[1];
    selections.push(`${s.name}@${at ?? "?"}`);
  }

  // run-read: the planted tree, digested on its own batch, and the three planted runs over it
  const before = new Set(stackIds());
  writeTree(tree, PLANTED_PEOPLE);
  nils(["digest", "--name", PLANTED_BATCH, "--no-private", ...packs, tree]);
  // the fingerprint makes the new stacks answer an ask; no classify, which would judge synth's stacks again
  nils(["fingerprint"]);
  const planted = stackIds().filter((id) => !before.has(id));
  if (planted.length !== PLANTED_PEOPLE)
    throw new Error(`the planted tree made ${planted.length} stacks, not ${PLANTED_PEOPLE}`);
  const runs: { case: string; run: number; pipeline: string; selection: string; status: unknown }[] = [];
  let from = 0;
  for (const p of PLANTED) {
    const ids = planted.slice(from, from + p.units.length);
    from += p.units.length;
    const name = `${p.pipeline}-units`;
    nils([
      "ask",
      "selections",
      "save",
      "--name",
      name,
      ...packs,
      "--file",
      file(`${name}.json`, {
        ast_version: 1,
        name: `the stacks of ${p.case}`,
        scheme: "default",
        sets: {
          s: {
            grain: "stack",
            where: [
              [">=", {}, ["field", {}, "id"], ids[0]],
              ["<=", {}, ["field", {}, "id"], ids[ids.length - 1]],
            ],
          },
        },
        keep: ["s"],
        out: { set: "s", level: "record" },
      }),
    ]);
    const d = join(scratch, `${p.pipeline}.yml`);
    writeFileSync(d, descriptor(p));
    nils(["pipeline", "add", d]);
    // a planted run that fails units exits non-zero by design; its document is still printed
    let out: string;
    try {
      out = nils(["run", p.pipeline, "--select", `selection:${name}@1`, ...packs, "--json"]);
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? "");
    }
    const run = JSON.parse(out) as { id: number; status: unknown };
    runs.push({
      case: p.case,
      run: run.id,
      pipeline: p.pipeline,
      selection: `${name}@1`,
      status: run.status,
    });
  }

  // keyword-tune: the site words on a batch of their own, fingerprinted and classified
  const keywords = join(o.home, "keywords");
  for (const k of keywordSeries()) writeSeries(join(keywords, k.folder), k.series);
  nils(["digest", "--name", KEYWORD_BATCH, "--no-private", ...packs, keywords]);
  nils(["fingerprint"]);
  nils(["classify", ...packs]);

  // identity-check and the operator: the datasets, each with its map filed, pseudonymised once
  const datasets: { name: string; held: string }[] = [];
  for (const [i, d] of DATASETS.entries()) {
    // how a dataset's files arrive is read from its folder (Wave 7a §5): derivatives/dcm-original is identified data
    const at = join(o.home, "datasets", d.name);
    const originals = join(at, "derivatives", "dcm-original");
    for (const f of datasetSeries(d, 10000 + i * 100)) writeSeries(join(originals, f.folder), f.series);
    nils(["place", "add", d.name, at, "--role", "source", "--unmapped", "hold"]);
    const mapped = d.people.filter((p) => p.code);
    if (mapped.length > 0) {
      const map = join(scratch, `${d.name}-map.csv`);
      writeFileSync(map, `identifier,code\n${mapped.map((p) => `${p.patientId},${p.code}`).join("\n")}\n`);
      nils(["linkage", "import", map, "--id-type", "patient-id", "--place", d.name]);
    }
    const out = nils(["pseudonymize", `@${d.name}`, ...packs]);
    datasets.push({ name: d.name, held: /held by shape\s+(.*)/u.exec(out)?.[1]?.trim() ?? "none" });
  }

  // the registered location, served with --ingest-root
  const inbox = join(o.home, INBOX);
  for (const f of inboxSeries()) writeSeries(join(inbox, f.folder), f.series);

  // the operator: one stored question to run
  const drafted = JSON.parse(
    nils(["ask", "draft", "--file", file("question.json", QUESTION.doc), ...packs, "--json"]),
  ) as { document?: number };

  const seeded = {
    at: new Date().toISOString(),
    registry,
    cohorts: ["ms-cohort-a", "ms-cohort-b", "nmosd"],
    selections,
    runs,
    RUNS: runs.map((r) => `${r.run}:${r.case}`).join(","),
    keyword_batch: KEYWORD_BATCH,
    datasets,
    ingest_roots: { [INBOX]: inbox },
    question: { name: QUESTION.name, document: drafted.document ?? null },
    serve: [
      o.nils,
      "serve",
      "--registry",
      registry,
      "--pack-dir",
      o.packDir,
      "--ingest-root",
      `${INBOX}=${inbox}`,
      "--worker",
      "--bind",
      "127.0.0.1:<port>",
    ],
  };
  writeFileSync(join(o.home, "seeded.json"), `${JSON.stringify(seeded, null, 2)}\n`);
  return seeded;
}

if (process.argv[1] && resolve(process.argv[1]).endsWith(join("bench", "seed.js"))) {
  const s = await seed(options());
  console.log(`seeded ${s.registry}`);
  console.log(`selections: ${(s.selections as string[]).join(", ")}`);
  console.log(`RUNS=${s.RUNS as string}`);
  console.log(
    `datasets: ${(s.datasets as { name: string; held: string }[]).map((d) => `${d.name} (held ${d.held})`).join(", ")}`,
  );
  console.log(`serve: ${(s.serve as string[]).join(" ")}`);
}
