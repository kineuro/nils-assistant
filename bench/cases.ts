// SPDX-License-Identifier: AGPL-3.0-only
// The question sets of the stations measured by the generic runner of
// bench/measure.ts (keyword-tune, identity-check, the operator): one
// `stations/<id>/evals/cases.yml` each, a message per case and what the run
// must leave, read from four places the host and the engine answer:
//
//   terminal  how the run ended: settled (the default), not_settled (a
//             refusal the station cannot settle), or any
//   result    the verdict's result, field by dotted path; `a[].b` maps a list
//   plan      the operator's plan as the host keeps it (GET /plans/{id}):
//             `steps` are its rung-two steps, `proposals` its rung-three acts;
//             no plan reads as neither
//   calls     the conversation's ledger (GET /ledger/{conversation}): the
//             operations that must have answered ok, those that must never
//             have, and how many calls the grant refused
//
// A settled run passes only with every check of its station passed. A case
// may carry `gap`: what the station cannot do yet that the case expects; it
// is scored like any other and reported beside the score.
//
// A message may name what the seed made by name, resolved through the engine
// before it is sent: `{batch:<name>}` and `{document:<name>}`.

export type Matcher =
  | string
  | number
  | boolean
  | null
  | unknown[]
  | { has: unknown[] }
  | { match: string }
  | { length: number }
  | { in: unknown[] }
  | { not: Matcher };

export interface Case {
  id: string;
  message: string;
  gap?: string;
  expect?: {
    terminal?: "settled" | "not_settled" | "any";
    result?: Record<string, Matcher>;
    plan?: Record<string, Matcher>;
    calls?: { ok?: string[]; none?: string[]; ungranted?: number };
  };
}

export interface LedgerRow {
  operation: string;
  granted: boolean;
  outcome: string;
}

/** What a run left, as the runner read it back. */
export interface Observed {
  terminal: string;
  verdict: {
    result?: Record<string, unknown>;
    checks?: { name: string; passed: boolean; why?: string | null }[];
  } | null;
  /** The plan the verdict names, as {steps, proposals}; null when it names none. */
  plan: { steps: unknown[]; proposals: unknown[] } | null;
  ledger: LedgerRow[];
}

/** A dotted path of a value; `[]` after a key maps the list under it, flattening. */
export function at(value: unknown, path: string): unknown {
  let here: unknown[] = [value];
  let mapped = false;
  for (const raw of path.split(".")) {
    const key = raw.endsWith("[]") ? raw.slice(0, -2) : raw;
    here = here.map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined));
    if (raw.endsWith("[]")) {
      mapped = true;
      here = here.flatMap((v) => (Array.isArray(v) ? v : []));
    }
  }
  return mapped ? here : here[0];
}

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether a value holds a matcher. */
export function holds(got: unknown, m: Matcher): boolean {
  if (m === "present") return got !== undefined && got !== null;
  if (m === "absent") return got === undefined || got === null;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    if ("has" in m) return Array.isArray(got) && m.has.every((x) => got.some((g) => equal(g, x)));
    if ("match" in m) return typeof got === "string" && new RegExp(m.match, "iu").test(got);
    if ("length" in m) return Array.isArray(got) && got.length === m.length;
    if ("in" in m) return m.in.some((x) => equal(got, x));
    if ("not" in m) return !holds(got, m.not);
  }
  return equal(got, m);
}

/** Why a run misses its case: nothing when it passes. */
export function missesOf(c: Case, o: Observed): string[] {
  const misses: string[] = [];
  const want = c.expect?.terminal ?? "settled";
  const settled = o.terminal === "settled";
  if (want === "settled" && !settled) misses.push(`ended ${o.terminal}, not settled`);
  if (want === "not_settled" && settled) misses.push("settled where the station should refuse");
  if (settled) {
    if (!o.verdict?.result) misses.push("no verdict");
    for (const k of o.verdict?.checks ?? [])
      if (!k.passed) misses.push(`check ${k.name}: ${k.why ?? "failed"}`);
  }
  const fields = (where: string, doc: unknown, want: Record<string, Matcher> | undefined) => {
    for (const [path, m] of Object.entries(want ?? {})) {
      const got = at(doc, path);
      if (!holds(got, m)) misses.push(`${where}${path} is ${JSON.stringify(got)}, not ${JSON.stringify(m)}`);
    }
  };
  if (c.expect?.result) fields("", o.verdict?.result ?? {}, c.expect.result);
  if (c.expect?.plan) fields("plan ", o.plan ?? { steps: [], proposals: [] }, c.expect.plan);
  const calls = c.expect?.calls;
  if (calls) {
    const ok = (op: string) => o.ledger.some((r) => r.operation === op && r.outcome === "ok");
    for (const op of calls.ok ?? []) if (!ok(op)) misses.push(`no ${op} call answered`);
    for (const op of calls.none ?? []) if (ok(op)) misses.push(`${op} was called and answered`);
    const ungranted = o.ledger.filter((r) => !r.granted).length;
    if (calls.ungranted !== undefined && ungranted > calls.ungranted)
      misses.push(`${ungranted} calls outside the grant`);
  }
  return misses;
}

/** The plan a host keeps, as the cases read it: rung two as steps, rung three as proposals. */
export function planView(body: unknown): { steps: unknown[]; proposals: unknown[] } | null {
  const steps = (body as { steps?: { rung?: number }[] } | null)?.steps;
  if (!Array.isArray(steps)) return null;
  return { steps: steps.filter((s) => s.rung === 2), proposals: steps.filter((s) => s.rung === 3) };
}

/** A message with what the seed made named by name, as the engine numbers it. */
export async function resolve(
  message: string,
  lookup: (kind: "batch" | "document", name: string) => Promise<number | null>,
): Promise<string> {
  let out = message;
  for (const m of message.matchAll(/\{(batch|document):([^}]+)\}/gu)) {
    const id = await lookup(m[1] as "batch" | "document", m[2]);
    if (id === null) throw new Error(`the engine has no ${m[1]} named ${m[2]}; was the registry seeded?`);
    out = out.replace(m[0], String(id));
  }
  return out;
}
