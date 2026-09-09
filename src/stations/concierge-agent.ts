"use agent";
// SPDX-License-Identifier: AGPL-3.0-only
// The concierge agent as Flue's build scans it (Wave 4c section 9.12).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.ts";
import { registerStation } from "../seam/for.ts";
import { concierge } from "./concierge.ts";
import { loadManifests } from "./manifest.ts";

const c = config();
const manifests = loadManifests(c.stationDirs);
const manifest = manifests.get("concierge");
if (!manifest) throw new Error(`no concierge manifest under ${c.stationDirs.join(":")}`);
const model = process.env.ASSISTANT_MODEL ?? "qwen38-27b-fast";
registerStation({
  id: manifest.id,
  version: c.version,
  grant: manifest.grant,
  ceiling: manifest.ceiling,
  content: manifest.content,
  model,
});
const inner = concierge(manifest, readFileSync(resolve(manifest.dir, manifest.brief.path), "utf8"), model);

export function Concierge(props: { id: string }): string {
  return inner(props);
}
Concierge.agentName = "concierge";
