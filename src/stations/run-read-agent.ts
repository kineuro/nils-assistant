"use agent";
// SPDX-License-Identifier: AGPL-3.0-only
// The run-read agent as Flue's build scans it (record 49).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.ts";
import { registerStation } from "../seam/for.ts";
import { loadManifests } from "./manifest.ts";
import { runRead } from "./run-read.ts";

const c = config();
const manifests = loadManifests(c.stationDirs);
const manifest = manifests.get("run-read");
if (!manifest) throw new Error(`no run-read manifest under ${c.stationDirs.join(":")}`);
const model = process.env.ASSISTANT_MODEL ?? "qwen38-27b-fast";
registerStation({
  id: manifest.id,
  version: c.version,
  grant: manifest.grant,
  ceiling: manifest.ceiling,
  content: manifest.content,
  model,
});
const inner = runRead(manifest, readFileSync(resolve(manifest.dir, manifest.brief.path), "utf8"), model);

export function RunRead(props: { id: string }): string {
  return inner(props);
}
RunRead.agentName = "run-read";
