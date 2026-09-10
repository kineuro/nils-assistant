"use agent";
// SPDX-License-Identifier: AGPL-3.0-only
// The operator agent as Flue's build scans it (Wave 5 section 9.3).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.ts";
import { registerStation } from "../seam/for.ts";
import { loadManifests } from "./manifest.ts";
import { operator } from "./operator.ts";

const c = config();
const manifests = loadManifests(c.stationDirs);
const manifest = manifests.get("operator");
if (!manifest) throw new Error(`no operator manifest under ${c.stationDirs.join(":")}`);
const model = process.env.ASSISTANT_MODEL ?? "qwen38-27b-fast";
registerStation({
  id: manifest.id,
  version: c.version,
  grant: manifest.grant,
  ceiling: manifest.ceiling,
  content: manifest.content,
  model,
});
const inner = operator(manifest, readFileSync(resolve(manifest.dir, manifest.brief.path), "utf8"), model);

export function Operator(props: { id: string }): string {
  return inner(props);
}
Operator.agentName = "operator";
