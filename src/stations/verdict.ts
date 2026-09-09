// SPDX-License-Identifier: AGPL-3.0-only
// The verdict and the proposal (Wave 4c §9.6): every run ends in one typed
// object produced by a single settle tool whose input schema is the
// station's result schema; a validation failure is handed back as a tool
// error and the model repairs it. Every mutating tool schema carries a
// completeness field, an item count a truncated argument stream cannot
// satisfy. A proposal is one of a closed set.

import type { Manifest, ProposalKind, TerminalReason } from "./manifest.ts";

export interface Proposal {
  kind: ProposalKind;
  /** What the proposal lands as: a document handle, a review item, an overlay id, a rule, a note. */
  ref: Record<string, unknown>;
  sentence: string;
}

export interface Verdict {
  station: string;
  terminal: TerminalReason;
  brief_hash: string;
  model: string;
  budget_consumed: { turns: number; tool_calls: number; wall_clock_seconds: number; input_tokens: number };
  evidence: { handles: number[]; documents: number[] };
  proposals: Proposal[];
  /** The station's own result, as its result schema says. */
  result: Record<string, unknown>;
  checks: { name: string; passed: boolean; why: string | null }[];
}

export type Check = (v: Verdict, ctx: Record<string, unknown>) => Promise<string | null> | string | null;

/** The named checks a verdict must pass before a run may settle: a failing one comes back as a specific complaint. */
export async function runChecks(
  v: Verdict,
  checks: Record<string, Check>,
  names: string[],
  ctx: Record<string, unknown>,
): Promise<{ passed: boolean; complaints: string[]; results: Verdict["checks"] }> {
  const results: Verdict["checks"] = [];
  for (const name of names) {
    const c = checks[name];
    if (!c) {
      results.push({ name, passed: false, why: `no check named ${name} is defined for this station` });
      continue;
    }
    const why = await c(v, ctx);
    results.push({ name, passed: why === null, why });
  }
  return {
    passed: results.every((r) => r.passed),
    complaints: results.filter((r) => !r.passed).map((r) => `${r.name}: ${r.why}`),
    results,
  };
}

/**
 * The completeness rule: a mutating tool's arguments carry `items`, the
 * count of the list they name; a truncated stream cannot satisfy it and is
 * refused before anything is applied.
 */
export function complete(
  args: Record<string, unknown>,
  listKey: string,
): { ok: true } | { ok: false; why: string } {
  const list = args[listKey];
  const n = args.items;
  if (!Array.isArray(list)) return { ok: false, why: `${listKey} is a list` };
  if (!Number.isInteger(n)) return { ok: false, why: "items, the count of the list, is required" };
  if (list.length !== n)
    return {
      ok: false,
      why: `items says ${n} but ${listKey} holds ${list.length}: the argument stream was cut short`,
    };
  return { ok: true };
}

/** A proposal kind the manifest allows. */
export function mayWrite(m: Manifest, kind: string): kind is ProposalKind {
  return (m.writes as string[]).includes(kind);
}

/** A verdict with no row of a result in it: evidence is handles and ids (§9.6). */
export function evidenceOnly(v: Verdict): string | null {
  const text = JSON.stringify(v.result);
  if (/"rows"\s*:\s*\[/u.test(text)) return "the verdict pastes rows; cite the handle";
  return null;
}
