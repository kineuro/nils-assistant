// SPDX-License-Identifier: AGPL-3.0-only
// The one agent's skills (one chat, 2026-10-09): today's stations as Flue
// skills, one catalog line each in the instructions and the body on
// activation, read from stations/nils/skills/<id>/SKILL.md beside the
// stations they came from. Finding data carries the worked examples closest
// to the turn's words, chosen as ask-help chose them (src/stations/select.ts),
// so a small model starts from the nearest example; the body is a tool's
// answer, plain text, never inside a signal's tag.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineSkill } from "@flue/runtime";
import { cookbook, renderCookbook } from "../stations/ask-help.ts";
import { closest } from "../stations/select.ts";
import type { SkillId } from "./route.ts";

export interface SkillText {
  id: SkillId;
  description: string;
  body: string;
}

/** A SKILL.md read: its name and description from the front matter, the rest as the body. */
export function parseSkill(text: string): { name: string; description: string; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(text);
  if (!m) throw new Error("a skill starts with front matter naming it");
  const field = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, "mu").exec(m[1])?.[1]?.trim() ?? "";
  return { name: field("name"), description: field("description"), body: m[2].trim() };
}

/** The directory the skills live in: under the first station directory that holds them. */
export function skillsDir(stationDirs: string[]): string | null {
  for (const d of stationDirs) {
    const dir = join(d, "nils", "skills");
    if (existsSync(dir)) return dir;
  }
  return null;
}

/** The skills on disk, by id; a missing one is left out and said once. */
export function loadSkills(stationDirs: string[], ids: readonly SkillId[]): Map<SkillId, SkillText> {
  const out = new Map<SkillId, SkillText>();
  const dir = skillsDir(stationDirs);
  if (!dir) {
    console.error(`nils-assistant: no one-chat skills under ${stationDirs.join(":")}/nils/skills`);
    return out;
  }
  for (const id of ids) {
    const file = join(dir, id, "SKILL.md");
    if (!existsSync(file)) {
      console.error(`nils-assistant: the skill ${id} is missing at ${file}`);
      continue;
    }
    const s = parseSkill(readFileSync(file, "utf8"));
    if (s.name !== id) throw new Error(`the skill at ${file} names itself ${s.name}, not ${id}`);
    out.set(id, { id, description: s.description, body: s.body });
  }
  return out;
}

/** The worked examples of finding data: the ask cookbook beside the stations. */
export function findExamples(stationDirs: string[]): ReturnType<typeof cookbook> {
  for (const d of stationDirs) {
    const items = cookbook(join(d, "ask-help", "cookbook"));
    if (items.length) return items;
  }
  return [];
}

/** A skill's body for this turn: finding data with the examples closest to the person's words. */
export function bodyFor(s: SkillText, message: string, examples: ReturnType<typeof cookbook>): string {
  if (s.id !== "find-data" || examples.length === 0) return s.body;
  const near = renderCookbook(
    closest(message, examples, 3),
    "Worked examples closest to the person's words, the closest first: start from it",
  );
  return `${s.body}\n\n${near}`;
}

/** The skill as Flue mounts it; the description stays the same on every render, so the catalog never changes. */
export function skillOf(s: SkillText, message: string, examples: ReturnType<typeof cookbook>) {
  return defineSkill({ name: s.id, description: s.description, instructions: bodyFor(s, message, examples) });
}
