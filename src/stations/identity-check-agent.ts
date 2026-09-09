"use agent";
// SPDX-License-Identifier: AGPL-3.0-only
// The identity-check agent as Flue's build scans it (Wave 4c section 9.14).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.ts";
import { registerStation } from "../seam/for.ts";
import { identityCheck } from "./identity-check.ts";
import { loadManifests } from "./manifest.ts";

const c = config();
const manifests = loadManifests(c.stationDirs);
const manifest = manifests.get("identity-check");
if (!manifest) throw new Error(`no identity-check manifest under ${c.stationDirs.join(":")}`);
const model = process.env.ASSISTANT_MODEL ?? "qwen38-27b-fast";
registerStation({
  id: manifest.id,
  version: c.version,
  grant: manifest.grant,
  ceiling: manifest.ceiling,
  content: manifest.content,
  model,
});
const inner = identityCheck(
  manifest,
  readFileSync(resolve(manifest.dir, manifest.brief.path), "utf8"),
  model,
);

export function IdentityCheck(props: { id: string }): string {
  return inner(props);
}
IdentityCheck.agentName = "identity-check";
