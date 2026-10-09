"use agent";
// SPDX-License-Identifier: AGPL-3.0-only
// The one agent as Flue's build scans it (one chat, 2026-10-09): one
// exported function whose identity is `nils`. Its model calls are filed
// under the concierge's Kvasir purpose, so Kvasir and setup need no change.

import { config } from "../config.ts";
import { registerStation } from "../seam/for.ts";
import { AGENT, findArm, oneAgent, PURPOSE } from "./agent.ts";

const c = config();
const model = process.env.ASSISTANT_MODEL ?? "qwen38-27b-fast";
// listed beside the stations, so the desk sees it served; its model calls carry the concierge's purpose
registerStation({
  id: AGENT,
  version: c.version,
  grant: { capabilities: { calls: 2 } },
  ceiling: "reader",
  content: "rows",
  model,
  purpose: PURPOSE,
});
const inner = oneAgent({ model, arm: findArm(), stationDirs: c.stationDirs });

export function Nils(props: { id: string }): string {
  return inner(props);
}
Nils.agentName = "nils";
