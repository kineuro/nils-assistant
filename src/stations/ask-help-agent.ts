"use agent";
// SPDX-License-Identifier: AGPL-3.0-only
// The ask-help agent as Flue's build scans it: one exported function whose
// identity is the station's id. The station itself is built from its
// manifest and brief at module load (Wave 4c section 9.11); the agent
// function only renders it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.ts";
import { registerStation } from "../seam/for.ts";
import { askHelp } from "./ask-help.ts";
import { loadManifests } from "./manifest.ts";

const c = config();
const manifests = loadManifests(c.stationDirs);
const manifest = manifests.get("ask-help");
if (!manifest) throw new Error(`no ask-help manifest under ${c.stationDirs.join(":")}`);
const model = process.env.ASSISTANT_MODEL ?? "qwen38-27b-fast";
registerStation({
  id: manifest.id,
  version: c.version,
  grant: manifest.grant,
  ceiling: manifest.ceiling,
  content: manifest.content,
  model,
});
const inner = askHelp(manifest, readFileSync(resolve(manifest.dir, manifest.brief.path), "utf8"), model);

export function AskHelp(props: { id: string }): string {
  return inner(props);
}
AskHelp.agentName = "ask-help";
