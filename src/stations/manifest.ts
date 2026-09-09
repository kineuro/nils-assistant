// SPDX-License-Identifier: AGPL-3.0-only
// The station manifest (Wave 4c §9.4), one decision point, fixed in
// contracts/suite/v1/station.schema.json (vendored beside this file).
// Manifests are loaded from the directories the configuration lists, so an
// app contributes stations without a code change; each is validated against
// the schema's shape here, its brief's hash checked against the file, and a
// decision-apply verb in its grant refused by name.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";
import { FORBIDDEN, type Grant } from "../seam/grant.ts";
import type { Ceiling } from "../seam/headers.ts";
import type { ContentClass } from "../seam/redactor.ts";

export const PROPOSAL_KINDS = [
  "document_version",
  "review_decision",
  "overlay",
  "identity_rule",
  "note",
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const TERMINAL_REASONS = [
  "settled",
  "budget_turns",
  "budget_tools",
  "budget_wall_clock",
  "budget_tokens",
  "token_unavailable",
  "provider_error",
  "provider_refused",
  "loop_stopped",
  "aborted",
] as const;
export type TerminalReason = (typeof TERMINAL_REASONS)[number];

export interface Budget {
  turns: number;
  tool_calls: number;
  wall_clock_seconds: number;
  input_tokens: number;
}

export interface Transition {
  from: string;
  to: string;
  when?: string;
}

export interface Manifest {
  id: string;
  app: string;
  purpose: string;
  content: ContentClass;
  ceiling: Ceiling;
  grant: Grant;
  brief: { path: string; hash: string };
  result: Record<string, unknown>;
  checks: string[];
  budget: Budget;
  writes: ProposalKind[];
  phases: { initial: string; transitions: Transition[]; follow_up?: string };
  evals: string;
  /** Where it was loaded from; the brief and the evals resolve against it. */
  dir: string;
}

export class ManifestError extends Error {}

const CEILINGS = ["reader", "reviewer", "operator", "admin"];
const CLASSES = ["catalog", "rows", "identifiers"];

/** The hash a brief carries: sha256 of the file, hex. */
export function briefHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function fail(id: string, why: string): never {
  throw new ManifestError(`station ${id}: ${why}`);
}

/** One manifest from its text and directory: every rule of the schema, then the two the schema cannot say. */
export function validate(
  raw: unknown,
  dir: string,
  read: (path: string) => string | null = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
): Manifest {
  const m = raw as Record<string, unknown>;
  const id = typeof m?.id === "string" ? m.id : "?";
  for (const k of [
    "id",
    "app",
    "purpose",
    "content",
    "ceiling",
    "grant",
    "brief",
    "result",
    "checks",
    "budget",
    "writes",
    "phases",
    "evals",
  ]) {
    if (!(k in (m ?? {}))) fail(id, `${k} is required`);
  }
  if (!/^[a-z][a-z0-9-]*$/u.test(id)) fail(id, "id is lowercase letters, digits and hyphens");
  if (!CLASSES.includes(String(m.content))) fail(id, `content is one of ${CLASSES.join(", ")}`);
  if (!CEILINGS.includes(String(m.ceiling))) fail(id, `ceiling is one of ${CEILINGS.join(", ")}`);
  if (!/^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/u.test(String(m.purpose))) fail(id, "purpose is app.purpose");
  const grant = m.grant as Record<string, { calls?: unknown; rows?: unknown }>;
  if (typeof grant !== "object" || grant === null) fail(id, "grant is an object of operations");
  for (const [op, cap] of Object.entries(grant)) {
    if ((FORBIDDEN as readonly string[]).includes(op))
      fail(id, `the grant holds ${op}, a decision apply, which no station may hold (section 9.6)`);
    for (const k of ["calls", "rows"] as const) {
      if (cap?.[k] !== undefined && (!Number.isInteger(cap[k]) || (cap[k] as number) < 0))
        fail(id, `grant.${op}.${k} is a whole number`);
    }
  }
  const brief = m.brief as { path?: unknown; hash?: unknown };
  if (
    typeof brief?.path !== "string" ||
    typeof brief?.hash !== "string" ||
    !/^[0-9a-f]{16,128}$/u.test(brief.hash)
  )
    fail(id, "brief carries a path and a hex hash");
  const text = read(resolve(dir, brief.path));
  if (text === null) fail(id, `the brief ${brief.path} is not beside the manifest`);
  if (briefHash(text) !== brief.hash)
    fail(
      id,
      `the brief's hash is ${briefHash(text).slice(0, 12)}…, the manifest says ${brief.hash.slice(0, 12)}…: a brief edit is a manifest edit`,
    );
  if (typeof m.result !== "object" || m.result === null) fail(id, "result is the verdict's JSON schema");
  if (!Array.isArray(m.checks) || m.checks.some((c) => typeof c !== "string"))
    fail(id, "checks is a list of names");
  const b = m.budget as Record<string, unknown>;
  for (const k of ["turns", "tool_calls", "wall_clock_seconds", "input_tokens"]) {
    if (!Number.isInteger(b?.[k]) || (b[k] as number) < (k === "tool_calls" ? 0 : 1))
      fail(id, `budget.${k} is a whole number`);
  }
  if (
    !Array.isArray(m.writes) ||
    m.writes.some((w) => !(PROPOSAL_KINDS as readonly string[]).includes(String(w)))
  )
    fail(id, `writes is a subset of ${PROPOSAL_KINDS.join(", ")}`);
  if (new Set(m.writes as string[]).size !== (m.writes as string[]).length)
    fail(id, "writes lists a kind once");
  const phases = m.phases as { initial?: unknown; transitions?: unknown; follow_up?: unknown };
  if (typeof phases?.initial !== "string" || !Array.isArray(phases.transitions))
    fail(id, "phases carries initial and transitions");
  for (const t of phases.transitions as Transition[]) {
    if (typeof t?.from !== "string" || typeof t?.to !== "string") fail(id, "a transition is from and to");
  }
  const named = new Set([
    phases.initial,
    ...(phases.transitions as Transition[]).flatMap((t) => [t.from, t.to]),
  ]);
  if (!named.has("finish")) fail(id, "the phases end in finish");
  if (typeof phases.follow_up === "string" && !named.has(phases.follow_up))
    fail(id, "phases.follow_up names a phase");
  if (typeof m.evals !== "string") fail(id, "evals names the fixture directory");
  const evals = resolve(dir, m.evals);
  if (!existsSync(evals) || !statSync(evals).isDirectory())
    fail(id, `the evals directory ${m.evals} is not beside the manifest`);
  return {
    id,
    app: String(m.app),
    purpose: String(m.purpose),
    content: m.content as ContentClass,
    ceiling: m.ceiling as Ceiling,
    grant: grant as Grant,
    brief: { path: brief.path, hash: brief.hash },
    result: m.result as Record<string, unknown>,
    checks: m.checks as string[],
    budget: b as unknown as Budget,
    writes: m.writes as ProposalKind[],
    phases: {
      initial: phases.initial,
      transitions: phases.transitions as Transition[],
      ...(typeof phases.follow_up === "string" ? { follow_up: phases.follow_up } : {}),
    },
    evals: m.evals,
    dir,
  };
}

/** Every manifest under the directories, by id; a duplicate id or an invalid manifest stops the load by name. */
export function loadManifests(dirs: string[]): Map<string, Manifest> {
  const out = new Map<string, Manifest>();
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d)) {
      const file = join(d, name, "station.yml");
      if (!existsSync(file)) continue;
      const m = validate(parse(readFileSync(file, "utf8")), dirname(file));
      if (out.has(m.id)) fail(m.id, `is defined twice, under ${out.get(m.id)?.dir} and ${m.dir}`);
      out.set(m.id, m);
    }
  }
  return out;
}

/** The phases a manifest names, in first-seen order, with the tools each may mount from the station's own table. */
export function phasesOf(m: Manifest): string[] {
  const seen: string[] = [m.phases.initial];
  for (const t of m.phases.transitions) for (const p of [t.from, t.to]) if (!seen.includes(p)) seen.push(p);
  return seen;
}
