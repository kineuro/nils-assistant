"use agent";
// SPDX-License-Identifier: AGPL-3.0-only
// The keyword-tune agent as Flue's build scans it (Wave 4c section 9.13).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.ts";
import { registerStation } from "../seam/for.ts";
import { keywordTune } from "./keyword-tune.ts";
import { loadManifests } from "./manifest.ts";

const c = config();
const manifests = loadManifests(c.stationDirs);
const manifest = manifests.get("keyword-tune");
if (!manifest) throw new Error(`no keyword-tune manifest under ${c.stationDirs.join(":")}`);
const model = process.env.ASSISTANT_MODEL ?? "qwen38-27b-fast";
registerStation({
  id: manifest.id,
  version: c.version,
  grant: manifest.grant,
  ceiling: manifest.ceiling,
  content: manifest.content,
  model,
});
const inner = keywordTune(manifest, readFileSync(resolve(manifest.dir, manifest.brief.path), "utf8"), model);

export function KeywordTune(props: { id: string }): string {
  return inner(props);
}
KeywordTune.agentName = "keyword-tune";
