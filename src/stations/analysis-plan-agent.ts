"use agent";
// SPDX-License-Identifier: AGPL-3.0-only
// The analysis-plan agent as Flue's build scans it (record 49).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.ts";
import { registerStation } from "../seam/for.ts";
import { analysisPlan } from "./analysis-plan.ts";
import { loadManifests } from "./manifest.ts";

const c = config();
const manifests = loadManifests(c.stationDirs);
const manifest = manifests.get("analysis-plan");
if (!manifest) throw new Error(`no analysis-plan manifest under ${c.stationDirs.join(":")}`);
const model = process.env.ASSISTANT_MODEL ?? "qwen38-27b-fast";
registerStation({
  id: manifest.id,
  version: c.version,
  grant: manifest.grant,
  ceiling: manifest.ceiling,
  content: manifest.content,
  model,
});
const inner = analysisPlan(manifest, readFileSync(resolve(manifest.dir, manifest.brief.path), "utf8"), model);

export function AnalysisPlan(props: { id: string }): string {
  return inner(props);
}
AnalysisPlan.agentName = "analysis-plan";
