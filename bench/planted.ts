// SPDX-License-Identifier: AGPL-3.0-only
// The planted runs of run-read (record 49 A6), made live: a small synthetic
// DICOM tree (one T1 MPRAGE series of twelve 32 by 32 slices per made-up
// person, no real data, UIDs under the DICOM standard's example root), and
// three stand-in pipelines of the stacks layout whose command plants, unit
// by unit, the failures and the breaches the cases of
// `stations/run-read/evals/runs.json` name. The engine runs them through a
// stand-in container runtime (a short script that runs the command on the
// host), so a run here is a real run of the engine with real units, review
// items and checks, and nothing is downloaded or measured.
//
// Each planted run reproduces its case's counts exactly: the reasons of the
// failed units by class (src/stations/pipelines.ts reasonClass), the breaches
// by check, and whether a campaign is due. The test in test/bench.test.ts
// holds the plan here and the case's `expect` together.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ------------------------------------------------------------------ the tree

/** The DICOM standard's own example root, the one the engine's tests use. */
const ROOT = "1.2.826.0.1.3680043.8.498";
const EXPLICIT_LE = "1.2.840.10008.1.2.1";
const MR_IMAGE = "1.2.840.10008.5.1.4.1.1.4";
const LONG = new Set(["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "UC", "UN", "UR", "UT"]);

type Elem = [group: number, element: number, vr: string, value: Buffer];

const text = (g: number, e: number, vr: string, v: string): Elem => [g, e, vr, Buffer.from(v, "latin1")];
const us = (g: number, e: number, v: number): Elem => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return [g, e, "US", b];
};

/** One element, explicit VR little endian, padded to an even length as its VR pads. */
function encode([group, element, vr, raw]: Elem): Buffer {
  const value =
    raw.length % 2 === 0
      ? raw
      : Buffer.concat([raw, Buffer.from(vr === "UI" || vr === "OB" || vr === "OW" ? [0] : [0x20])]);
  const head = Buffer.alloc(LONG.has(vr) ? 12 : 8);
  head.writeUInt16LE(group, 0);
  head.writeUInt16LE(element, 2);
  head.write(vr, 4, "latin1");
  if (LONG.has(vr)) head.writeUInt32LE(value.length, 8);
  else head.writeUInt16LE(value.length, 6);
  return Buffer.concat([head, value]);
}

const sorted = (elems: Elem[]) => [...elems].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

/** A Part 10 file: the preamble, the meta group with its length, the dataset. */
export function part10(sop: string, dataset: Elem[]): Buffer {
  const meta = Buffer.concat(
    sorted([
      [0x0002, 0x0001, "OB", Buffer.from([0, 1])],
      text(0x0002, 0x0002, "UI", MR_IMAGE),
      text(0x0002, 0x0003, "UI", sop),
      text(0x0002, 0x0010, "UI", EXPLICIT_LE),
      text(0x0002, 0x0012, "UI", `${ROOT}.9`),
    ]).map(encode),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32LE(meta.length);
  return Buffer.concat([
    Buffer.alloc(128),
    Buffer.from("DICM", "latin1"),
    encode([0x0002, 0x0000, "UL", length]),
    meta,
    ...sorted(dataset).map(encode),
  ]);
}

/** One slice of one person's T1 MPRAGE: made-up values, a square in the middle of a gradient. */
function slice(person: number, n: number): { sop: string; bytes: Buffer } {
  const root = `${ROOT}.7${String(person).padStart(3, "0")}`;
  const study = `${root}.1`;
  const series = `${root}.1.1`;
  const sop = `${series}.${n}`;
  const pixels = Buffer.alloc(32 * 32 * 2);
  for (let i = 0; i < 32 * 32; i++) {
    const x = i % 32;
    const y = Math.floor(i / 32);
    const inside = x >= 8 && x < 24 && y >= 8 && y < 24;
    pixels.writeUInt16LE(200 + x * 7 + y * 3 + n * 11 + (inside ? 600 : 0), i * 2);
  }
  const day = `2021${String(1 + (person % 12)).padStart(2, "0")}15`;
  const dataset: Elem[] = [
    text(0x0008, 0x0008, "CS", "ORIGINAL\\PRIMARY\\M\\ND"),
    text(0x0008, 0x0016, "UI", MR_IMAGE),
    text(0x0008, 0x0018, "UI", sop),
    text(0x0008, 0x0020, "DA", day),
    text(0x0008, 0x0031, "TM", "101415"),
    text(0x0008, 0x0060, "CS", "MR"),
    text(0x0008, 0x0070, "LO", "SYNTHETIC"),
    text(0x0008, 0x103e, "LO", "t1_mprage_sag"),
    text(0x0010, 0x0020, "LO", plantedCode(person)),
    text(0x0018, 0x0023, "CS", "3D"),
    text(0x0018, 0x0050, "DS", "1.0"),
    text(0x0018, 0x1030, "LO", "MPRAGE"),
    text(0x0020, 0x000d, "UI", study),
    text(0x0020, 0x000e, "UI", series),
    text(0x0020, 0x0013, "IS", String(n)),
    text(0x0020, 0x0032, "DS", `${n}\\0\\0`),
    text(0x0020, 0x0037, "DS", "0\\1\\0\\0\\0\\-1"),
    us(0x0028, 0x0002, 1),
    text(0x0028, 0x0004, "CS", "MONOCHROME2"),
    us(0x0028, 0x0010, 32),
    us(0x0028, 0x0011, 32),
    text(0x0028, 0x0030, "DS", "1.0\\1.0"),
    us(0x0028, 0x0100, 16),
    us(0x0028, 0x0101, 12),
    us(0x0028, 0x0102, 11),
    us(0x0028, 0x0103, 0),
    text(0x0028, 0x0301, "CS", "NO"),
    [0x7fe0, 0x0010, "OW", pixels],
  ];
  return { sop, bytes: part10(sop, dataset) };
}

/** The made-up identifier a planted person's files carry, before the engine pseudonymises it. */
export const plantedCode = (person: number) => `PLANT${String(person).padStart(3, "0")}`;

/** Writes the tree: one folder per person, one series of twelve slices each. */
export function writeTree(dir: string, people: number): void {
  for (let p = 1; p <= people; p++) {
    const at = join(dir, plantedCode(p), "1");
    mkdirSync(at, { recursive: true });
    for (let n = 1; n <= 12; n++) writeFileSync(join(at, `${n}.dcm`), slice(p, n).bytes);
  }
}

// ------------------------------------------------------------------ the plans

/** What one unit of a planted run does: fail with words, say nothing, or succeed with its measures. */
export type Plant =
  | { status: "failed"; error: string }
  | { status: "unreported" }
  | { status: "succeeded"; metrics: Record<string, number> };

export interface Planted {
  /** The case of runs.json the run reproduces. */
  case: string;
  /** The stand-in pipeline's name. */
  pipeline: string;
  /** The checks it declares, as the descriptor's `x-nils.qc`. */
  checks: string[];
  /** One plant per unit, in the order of the run's stacks. */
  units: Plant[];
}

const fine = (metrics: Record<string, number>): Plant => ({ status: "succeeded", metrics });

/** The three planted runs, one per case of runs.json. */
export const PLANTED: Planted[] = [
  {
    case: "planted-synthseg",
    pipeline: "planted-synthseg",
    checks: ["qc_general_white_matter >= 0.65", "qc_general_csf >= 0.65"],
    units: [
      { status: "failed", error: "the session holds no T1w" },
      { status: "failed", error: "the session holds no T1w" },
      { status: "failed", error: "the container exited with code 1" },
      { status: "unreported" },
      fine({ qc_general_white_matter: 0.41, qc_general_csf: 0.52 }),
      fine({ qc_general_white_matter: 0.6, qc_general_csf: 0.9 }),
      fine({ qc_general_white_matter: 0.63, qc_general_csf: 0.88 }),
      ...Array.from({ length: 13 }, () => fine({ qc_general_white_matter: 0.9, qc_general_csf: 0.9 })),
    ],
  },
  {
    case: "samseg-both-sides",
    pipeline: "planted-samseg",
    checks: ["intracranial >= 900000", "intracranial <= 2300000"],
    units: [
      fine({ intracranial: 850000 }),
      fine({ intracranial: 2400000 }),
      ...Array.from({ length: 6 }, () => fine({ intracranial: 1500000 })),
    ],
  },
  {
    case: "clean-mriqc",
    pipeline: "planted-mriqc",
    checks: ["snr >= 8"],
    units: Array.from({ length: 6 }, () => fine({ snr: 20 })),
  },
];

/** The planted people in all: one stack each, so one unit each. */
export const PLANTED_PEOPLE = PLANTED.reduce((n, p) => n + p.units.length, 0);

/**
 * The descriptor of a planted run (contracts/job/v1): the stacks layout, one
 * unit a stack, and a command that reads the plan from its parameter and
 * writes results.json as the plan says. The image is a pinned placeholder:
 * the stand-in runtime never pulls it.
 */
export function descriptor(p: Planted): string {
  const plan = JSON.stringify(p.units).replace(/'/gu, "");
  const columns = Object.keys(
    p.units.find((u): u is Extract<Plant, { status: "succeeded" }> => u.status === "succeeded")?.metrics ??
      {},
  );
  return `# SPDX-License-Identifier: AGPL-3.0-only
# A planted run of the bench (bench/planted.ts): synthetic, runs on a stand-in runtime only.
name: ${p.pipeline}
schema-version: "0.5"
tool-version: "1"
container-image:
  type: docker
  image: "example.org/nils-bench-planted@sha256:${"0".repeat(64)}"
command-line: |
  python3 -c '
  import json, os, sys
  m = json.load(open(sys.argv[1])); out = sys.argv[2]
  plan = json.loads(${JSON.stringify(plan)})
  units = []
  for i, s in enumerate(m["stacks"]):
      u = s["unit"]; d = os.path.join(out, u); os.makedirs(d, exist_ok=True)
      p = plan[i] if i < len(plan) else plan[-1]
      if p["status"] == "unreported":
          continue
      if p["status"] == "failed":
          units.append({"unit_id": u, "status": "failed", "error": p["error"]})
          continue
      cols = sorted(p["metrics"])
      open(os.path.join(d, "measures.csv"), "w").write(",".join(cols) + "\\n" + ",".join(str(p["metrics"][c]) for c in cols) + "\\n")
      units.append({"unit_id": u, "status": "succeeded", "derivatives": [u + "/measures.csv"], "metrics": p["metrics"]})
  json.dump({"schema_version": "1", "units": units}, open(os.path.join(out, "results.json"), "w"))
  ' [Manifest] [OutputLocation]
x-nils:
  analysis-level: stack
  input: {layout: stacks}
  outputs:
    - id: measures
      kind: table
      path-template: "stack-{stack}/measures.csv"
      columns:
${columns.map((c) => `        - {name: ${c}}`).join("\n")}
  qc: ${JSON.stringify(p.checks)}
  needs: {unit-minutes: 1}
`;
}

/**
 * The stand-in container runtime: it answers the runtime's questions as a
 * rootless podman does and runs the command after the image on the host,
 * every container path written as the host folder mounted there. The same
 * stand-in the engine's own pipeline tests use.
 */
export const STAND_IN_RUNTIME = `#!/usr/bin/env python3
import json, os, re, subprocess, sys
a = sys.argv[1:]
if not a or a[0] == "--version":
    print("podman version 9.9.9-bench"); sys.exit(0)
if a[0] == "info":
    print("/bench/containers/storage" if "GraphRoot" in a[-1] else "true"); sys.exit(0)
if a[0] != "run":
    sys.exit(0)
mounts, env, i = {}, {}, 1
while i < len(a):
    w = a[i]
    if w == "--volume":
        host, ctr = a[i + 1].split(":")[:2]; mounts[ctr] = host; i += 2
    elif w == "--env":
        k, v = a[i + 1].split("=", 1); env[k] = v; i += 2
    elif w in ("--name", "--network", "--pull", "--userns", "--cap-drop", "--security-opt", "--device", "--user", "--gpus"):
        i += 2
    elif "@sha256:" in w:
        i += 1; break
    else:
        i += 1
keys = sorted(mounts, key=len, reverse=True)
pattern = re.compile("(" + "|".join(re.escape(k) for k in keys) + r")(?=/|$|[^A-Za-z0-9_])")
argv = [pattern.sub(lambda m: mounts[m.group(1)], w) for w in a[i:]]
env = {k: pattern.sub(lambda m: mounts[m.group(1)], v) for k, v in env.items()}
sys.exit(subprocess.call(argv, env=dict(os.environ, **env)))
`;
