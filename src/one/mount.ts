// SPDX-License-Identifier: AGPL-3.0-only
// What the one agent mounts for a person (one chat, 2026-10-09): its tools
// and skills, read once from the person's grants when the conversation
// starts and kept for the conversation's life, in one stable order, so the
// request's tools block stays the same turn after turn. The grants come from
// the engine with the person's own token (the host's guard), never from a
// model's arguments; the engine still authorises every call with that token.

import { type Detail, holds } from "../host/grants.ts";
import type { SkillId } from "./route.ts";

export const TOOL_ORDER = [
  "registry_summary",
  "registry_search",
  "registry_describe",
  "query_draft",
  "query_run_readonly",
  "query_read_rows",
  "jobs_read",
  "run_read",
  "plan_update",
  "ask_user",
  "propose_change",
] as const;
export type ToolName = (typeof TOOL_ORDER)[number];

export const SKILL_ORDER: readonly SkillId[] = [
  "find-data",
  "plan-work",
  "plan-analysis",
  "read-run",
  "tune-sorting-words",
  "check-identities",
];

/** What a person holds, as the host read it from the engine. */
export interface Access {
  grants: readonly string[];
  detail: Detail;
}

/** What the conversation mounts: tools and skills by name, in their fixed order. */
export interface Mounted {
  tools: ToolName[];
  skills: SkillId[];
  detail: Detail;
}

const any = (grants: readonly string[], ...need: string[]) => need.some((g) => holds(grants, g));

/** The skills a person's grants open. */
export function skillsFor(grants: readonly string[]): SkillId[] {
  const open: Record<SkillId, boolean> = {
    "find-data": any(grants, "query:see"),
    "plan-work": any(grants, "data:work", "places:work", "release:work"),
    "plan-analysis": any(grants, "pipelines:see"),
    "read-run": any(grants, "pipelines:see"),
    "tune-sorting-words": any(grants, "review:work"),
    "check-identities": any(grants, "identity:see"),
  };
  return SKILL_ORDER.filter((s) => open[s]);
}

/** The tools a person's grants open; the plan panel, the question card and proposals are everyone's. */
export function toolsFor(grants: readonly string[]): ToolName[] {
  const query = any(grants, "query:see");
  const open: Record<ToolName, boolean> = {
    registry_summary: true,
    registry_search: query,
    registry_describe:
      query || any(grants, "identity:see", "pipelines:see", "review:work", "data:work", "places:work"),
    query_draft: query,
    query_run_readonly: query || any(grants, "review:work", "identity:see"),
    query_read_rows: query,
    jobs_read: any(grants, "data:see", "identity:see", "pipelines:see", "places:work"),
    run_read: any(grants, "pipelines:see"),
    plan_update: true,
    ask_user: true,
    propose_change: true,
  };
  return TOOL_ORDER.filter((t) => open[t]);
}

export function mountFor(a: Access): Mounted {
  return { tools: toolsFor(a.grants), skills: skillsFor(a.grants), detail: a.detail };
}

const SKILL_WORDS: Record<SkillId, string> = {
  "find-data": "look up data and write questions of the registry",
  "plan-work": "plan work on the registry (digest, classify, rebuild and the like) for them to confirm",
  "plan-analysis": "plan an analysis of images for them to run",
  "read-run": "read how an analysis run went",
  "tune-sorting-words": "teach the sorting new words",
  "check-identities": "check how a dataset tells its subjects apart",
};

const DETAIL_WORDS: Record<Detail, string> = {
  plain: "counts and plain fields only (no age, sex or other quasi-identifying detail)",
  quasi: "quasi-identifying detail such as age and sex, but nothing sensitive",
  sensitive: "every detail",
};

/** One plain line of what this person may do here, for the turn's facts. */
export function grantsLine(m: Mounted): string {
  const may = m.skills.map((s) => SKILL_WORDS[s]);
  const not = SKILL_ORDER.filter((s) => !m.skills.includes(s)).map((s) => SKILL_WORDS[s]);
  return [
    may.length ? `This person may ${may.join("; ")}.` : "This person may only ask what the registry holds.",
    not.length
      ? `They may not ${not.join("; ")}: when asked, say in one sentence that their account cannot do that here and that an admin can give it.`
      : "",
    `They see ${DETAIL_WORDS[m.detail]}.`,
  ]
    .filter(Boolean)
    .join(" ");
}
