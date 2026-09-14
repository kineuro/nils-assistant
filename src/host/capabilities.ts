// SPDX-License-Identifier: AGPL-3.0-only
// GET /capabilities (Wave 4c §4.3, §7.6): what this assistant is, the
// stations with their briefs' hashes and budgets, whether a teaching session
// is open, and that telemetry content is off. The desk merges it into the
// deployment document; a deployment with no assistant has no section.

import type { Config } from "../config.ts";

export interface StationSummary {
  id: string;
  app: string;
  purpose: string;
  content: string;
  ceiling: string;
  brief: { path: string; hash: string };
  budget: Record<string, number>;
  writes: string[];
}

export function capabilities(
  c: Config,
  stations: StationSummary[],
  extra: {
    teaching_open: boolean;
    conversations: number;
    /** The chat, slice 3: each model's context window and largest answer, for the desk's meter. */
    models?: { id: string; contextWindow: number; maxTokens: number }[];
  },
): Record<string, unknown> {
  return {
    assistant: { name: "nils-assistant", version: c.version },
    runtime: { flue: "2.0.5", pi_ai: "0.83.0" },
    stations,
    teaching: { open: extra.teaching_open },
    telemetry: { content: "off", exporter: null },
    retention: { days: c.retentionDays },
    conversations: extra.conversations,
    models: extra.models ?? [],
    doors: [
      "GET /capabilities",
      "POST /conversations/{id}/token",
      "POST /stations/{id}/runs",
      "GET /runs/{id}",
      "POST /conversations/{id}/feedback",
      "POST /conversations",
      "GET /conversations/{id}",
      "PATCH /conversations/{id}",
      "DELETE /conversations/{id}",
      "POST /conversations/{id}/ratings",
      "POST /conversations/{id}/fork",
      "GET /conversations/{id}/share",
      "PUT /conversations/{id}/share",
      "DELETE /conversations/{id}/share",
      "GET /shares",
      "GET /shared",
      "GET /shares/{id}",
      "POST /shares/{id}/continue",
      "GET /memory",
      "POST /memory",
      "PATCH /memory/{id}",
      "DELETE /memory/{id}",
      "PUT /memory/pause",
      "DELETE /memory",
      "GET /instructions",
      "PUT /instructions",
      "GET /conversations/{id}/export",
      "POST /conversations/{id}/title",
      "POST /conversations/{id}/summarize",
      "GET /agents/{station}/{id}",
      "POST /agents/{station}/{id}",
      "GET /conversations",
      "GET /grants",
      "POST /grants",
      "DELETE /grants/{id}",
      "GET /plans/{id}",
      "POST /plans/{id}/confirm",
      "POST /plans/{id}/proposals/{n}/decide",
      "GET /inbox",
      "GET /teaching/corrections",
      "GET /teaching/sets",
      "POST /teaching/sets",
      "POST /teaching/sets/{id}/fine-tune",
      "GET /teaching/candidates",
      "POST /teaching/candidates/{id}/admit",
      "POST /teaching/candidates/{id}/bench",
      "POST /teaching/candidates/{id}/promote",
    ],
  };
}
