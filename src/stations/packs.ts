// SPDX-License-Identifier: AGPL-3.0-only
// What the engine's catalog says of its analyses beside the descriptor
// (record 57 P9, Wave 7b section 9): each pipeline's pack (the needs, the
// knobs and who sets them, the goals and switches, the rules, the checks,
// each in the pack's own words and with its source), the families whose
// rules pick a member per session, and the workflows that chain steps. The
// assistant reads them from GET /api/pipelines (`pack` on each entry,
// `families` beside them), GET /api/pipelines/{id}/pack and GET
// /api/workflows, never from a table of its own, and renders them for the
// model in the pack's words. The pre-flight's judgement of the units and a
// workflow's plan are read here into counts and reasons: no unit, subject
// or day ever leaves this file.

import type { Entry } from "./pipelines.ts";
import { newest } from "./pipelines.ts";

type Rec = Record<string, unknown>;
const str = (x: unknown): string | undefined => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const recs = (x: unknown): Rec[] =>
  Array.isArray(x) ? (x.filter((r) => r && typeof r === "object") as Rec[]) : [];

/** One need of a role, as the pack words it. */
export interface Need {
  role: string;
  hard: boolean;
  /** Where the need is hard only under a goal or switch: the pack's `hard_if`. */
  hardIf: string | null;
  words: string;
  source: string | null;
}

export interface Knob {
  id: string;
  what: string | null;
  default: unknown;
  cost: string | null;
  comparability: string | null;
  setBy: string;
}

export interface PackRule {
  id: string;
  why: string | null;
  source: string | null;
  route: string | null;
  set: Rec | null;
}

export interface PackCheck {
  words: string;
  action: string | null;
  source: string | null;
}

/** A pipeline's pack, read for choosing and explaining. */
export interface Pack {
  goals: Record<string, string[]>;
  needs: Need[];
  knobs: Knob[];
  rules: PackRule[];
  checks: PackCheck[];
  licence: string | null;
  resources: string | null;
}

/** The pack an entry of GET /api/pipelines carries, or null where it has none (`none`, or one this engine cannot read). */
export function packOf(raw: unknown): Pack | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Rec;
  if ("error" in p) return null;
  const goals: Record<string, string[]> = {};
  for (const [k, v] of Object.entries((p.goals ?? {}) as Rec)) if (Array.isArray(v)) goals[k] = v.map(String);
  const needs: Need[] = [];
  for (const [role, n] of Object.entries((p.needs ?? {}) as Rec)) {
    const o = (n ?? {}) as Rec;
    const hardIf = str(o.hard_if) ?? null;
    for (const [list, hard] of [
      ["hard", true],
      ["soft", false],
    ] as const)
      for (const x of recs(o[list])) {
        const words = str(x.words);
        if (words)
          needs.push({ role, hard, hardIf: hard ? hardIf : null, words, source: str(x.source) ?? null });
      }
  }
  const knobs: Knob[] = Object.entries((p.knobs ?? {}) as Rec).map(([id, k]) => {
    const o = (k ?? {}) as Rec;
    return {
      id,
      what: str(o.what) ?? null,
      default: o.default,
      cost: str(o.cost) ?? null,
      comparability: str(o.comparability) ?? null,
      setBy: str(o.set_by) ?? "person",
    };
  });
  const rules: PackRule[] = recs(p.rules).map((r) => ({
    id: String(r.id ?? ""),
    why: str(r.why) ?? null,
    source: str(r.source) ?? null,
    route: str(r.route) ?? null,
    set: r.set && typeof r.set === "object" ? (r.set as Rec) : null,
  }));
  const checks: PackCheck[] = recs(p.checks).map((c) => ({
    words:
      str(c.words) ??
      (c.cohort === true
        ? `${String(c.metric)} against its cohort (from ${num(c.min_sessions) ?? 30} sessions)`
        : `${String(c.metric)} ${String(c.op ?? "")} ${String(c.value ?? "")}`.trim()),
    action: str(c.action) ?? null,
    source: str(c.source) ?? null,
  }));
  const lic = (p.licence ?? null) as Rec | null;
  const licence = lic
    ? [
        str(lic.spdx),
        lic.redistributable === false ? "not redistributable" : null,
        lic.accept === true ? "an administrator accepts its terms first" : null,
      ]
        .filter(Boolean)
        .join(", ") || null
    : null;
  const res = (p.resources ?? null) as Rec | null;
  const resources = res
    ? [
        num(res.memory_gb) !== null ? `${num(res.memory_gb)} GB` : null,
        num(res.minutes) !== null ? `about ${num(res.minutes)} min a unit` : null,
        str(res.gpu) && res.gpu !== "none" ? `GPU ${String(res.gpu)}` : null,
      ]
        .filter(Boolean)
        .join(", ") || null
    : null;
  return { goals, needs, knobs, rules, checks, licence, resources };
}

/** A family: one entry whose rules choose the member pipeline per unit. */
export interface Family {
  name: string;
  words: string;
  goals: Record<string, string[]>;
  tasks: { name: string; words: string; members: string[] }[];
  members: { member: string; pipeline: string; words: string }[];
  rules: PackRule[];
}

export function familiesOf(body: unknown): Family[] {
  return recs((body as Rec | null)?.families).map((f) => {
    const g = (f.goals ?? {}) as Rec;
    const goals: Record<string, string[]> = {};
    if (Array.isArray(g.goal)) goals.goal = g.goal.map(String);
    for (const [k, v] of Object.entries((g.switches ?? {}) as Rec))
      if (Array.isArray(v)) goals[k] = v.map(String);
    return {
      name: String(f.name ?? ""),
      words: str(f.words) ?? "",
      goals,
      tasks: Object.entries((f.tasks ?? {}) as Rec).map(([name, t]) => ({
        name,
        words: str((t as Rec)?.words) ?? "",
        members: Array.isArray((t as Rec)?.members) ? ((t as Rec).members as unknown[]).map(String) : [],
      })),
      members: recs(f.members).map((m) => ({
        member: String(m.member ?? ""),
        pipeline: String(m.pipeline ?? ""),
        words: str(m.words) ?? "",
      })),
      rules: recs(f.rules).map((r) => ({
        id: String(r.id ?? ""),
        why: str(r.why) ?? null,
        source: str(r.source) ?? null,
        route: str(r.route) ?? null,
        set: null,
      })),
    };
  });
}

/** A workflow document as the catalog keeps it. */
export interface Workflow {
  id: number;
  name: string;
  label: string;
  title: string;
  what: string;
  steps: { id: string; of: string; name: string; goal: string | null; switches: Rec; knobs: string[] }[];
  links: { from: string; to: string }[];
}

export function workflowsOf(body: unknown): Workflow[] {
  const rows = recs((body as Rec | null)?.workflows).filter((w) => (w.state ?? "active") === "active");
  const out = rows.map((w) => {
    const doc = (w.workflow ?? {}) as Rec;
    return {
      id: Number(w.id),
      name: String(w.name ?? doc.name ?? ""),
      version: Number(w.version ?? 0),
      label: String(w.label ?? `${w.name}@${w.version}`),
      title: str(doc.title) ?? String(w.name ?? ""),
      what: str(doc.what) ?? "",
      steps: recs(doc.steps).map((s) => ({
        id: String(s.id ?? ""),
        of: String(s.of ?? "pipeline"),
        name: String(s.name ?? ""),
        goal: str(s.goal) ?? null,
        switches: (s.switches ?? {}) as Rec,
        knobs: Array.isArray(s.knobs) ? s.knobs.map(String) : [],
      })),
      links: recs(doc.links).map((l) => ({ from: String(l.from ?? ""), to: String(l.to ?? "") })),
    };
  });
  // the newest version of each name
  out.sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version);
  const seen = new Set<string>();
  const first = out.filter((w) => {
    if (seen.has(w.name)) return false;
    seen.add(w.name);
    return true;
  });
  return first.map(({ version: _v, ...w }) => w);
}

/** The packs of the catalog's entries, by entry id. */
export function packsOf(body: unknown): Map<number, Pack> {
  const out = new Map<number, Pack>();
  for (const r of recs((body as Rec | null)?.pipelines)) {
    const p = packOf(r.pack);
    if (p) out.set(Number(r.id), p);
  }
  return out;
}

/** The members' names, so the overview lists a member under its family and not alone. */
function memberNames(families: Family[]): Set<string> {
  return new Set(families.flatMap((f) => f.members.map((m) => m.pipeline)));
}

const choicesText = (goals: Record<string, string[]>): string =>
  Object.entries(goals)
    .map(([k, vs]) => `${k} ${vs.join("|")}${k === "goal" ? " (standard unless the person says)" : ""}`)
    .join("; ");

const sourced = (words: string, source: string | null) => (source ? `${words} [${source}]` : words);

/**
 * The catalog for choosing, in the packs' words: each analysis with what it measures, its choices, the knobs a
 * person may set and the needs that skip a session; the families and the workflows after it. One line or a few an
 * analysis, so a small model reads it whole; `what: pipeline` gives one in full.
 */
export function overviewText(
  entries: Entry[],
  packs: Map<number, Pack>,
  families: Family[],
  workflows: Workflow[],
): string {
  const members = memberNames(families);
  const lines = ["The analyses (name@version), each in its own words:"];
  for (const e of newest(entries)) {
    if (members.has(e.name)) continue;
    const p = packs.get(e.id);
    lines.push(`- ${e.label}: ${e.description}`);
    lines.push(`  one unit per ${e.level}; inputs ${e.roles.join(" and ") || "the selection's stacks"}`);
    if (!p) {
      if (e.parameters.length)
        lines.push(`  parameters: ${e.parameters.map((x) => x.id).join(", ")} (no rules beside them)`);
      continue;
    }
    if (Object.keys(p.goals).length) lines.push(`  choices: ${choicesText(p.goals)}`);
    const own = p.knobs.filter((k) => k.setBy === "person");
    if (own.length)
      lines.push(
        `  a person may set: ${own.map((k) => `${k.id}${k.what ? ` (${k.what})` : ""}`).join("; ")}`,
      );
    const byRule = p.knobs.filter((k) => k.setBy === "rule").map((k) => k.id);
    if (byRule.length) lines.push(`  set by its rules per session, never by hand: ${byRule.join(", ")}`);
    const hard = p.needs.filter((n) => n.hard);
    if (hard.length)
      lines.push(
        `  skips a session where: ${hard.map((n) => `${n.words}${n.hardIf ? ` (only when ${n.hardIf})` : ""}`).join("; ")}`,
      );
  }
  if (families.length) {
    lines.push("", "The families (one analysis; its rules pick the method for each session):");
    for (const f of families) {
      lines.push(`- ${f.name}: ${f.words}`);
      if (f.tasks.length)
        lines.push(
          `  tasks: ${f.tasks.map((t) => `${t.name} (${t.words}; ${t.members.join(" or ")})`).join("; ")}`,
        );
      lines.push(`  methods: ${f.members.map((m) => `${m.member} (${m.words})`).join("; ")}`);
      lines.push(`  it is run as a step of a workflow`);
    }
  }
  if (workflows.length) {
    lines.push("", "The workflows (steps chained, each session going on when its step before is done):");
    for (const w of workflows) {
      lines.push(`- ${w.label}: ${w.title}. ${w.what}`);
      lines.push(
        `  steps: ${w.steps
          .map((s) => {
            const sw = Object.entries(s.switches).map(([k, v]) => `${k} ${String(v)}`);
            return `${s.id} (${s.of === "family" ? `the family ${s.name}` : s.name}${sw.length ? `, ${sw.join(", ")}` : ""})`;
          })
          .join(" then ")}`,
      );
      const knobs = w.steps.flatMap((s) => s.knobs.map((k) => `${s.id}.${k}`));
      if (knobs.length) lines.push(`  a person may set: ${knobs.join(", ")}`);
    }
  }
  return lines.join("\n");
}

/** One analysis in full, in its pack's words with each source: what `what: pipeline` answers. */
export function packText(e: Entry, p: Pack | null): string {
  const lines = [
    `${e.label}: ${e.description}`,
    `one unit per ${e.level}; inputs ${e.roles.join(" and ") || "stacks"}`,
  ];
  if (!p) {
    lines.push("It carries no rules beside its parameters.");
    return lines.join("\n");
  }
  if (Object.keys(p.goals).length) lines.push(`choices: ${choicesText(p.goals)}`);
  const hard = p.needs.filter((n) => n.hard);
  const soft = p.needs.filter((n) => !n.hard);
  if (hard.length)
    lines.push(
      "skips a session where:",
      ...hard.map((n) => `- ${sourced(`${n.words}${n.hardIf ? ` (only when ${n.hardIf})` : ""}`, n.source)}`),
    );
  if (soft.length)
    lines.push("runs with a caveat where:", ...soft.map((n) => `- ${sourced(n.words, n.source)}`));
  if (p.knobs.length)
    lines.push(
      "settings:",
      ...p.knobs
        .filter((k) => k.setBy !== "fixed")
        .map(
          (k) =>
            `- ${k.id}: ${k.what ?? ""}${k.default !== undefined ? `; default ${JSON.stringify(k.default)}` : ""}${k.cost ? `; ${k.cost}` : ""}${k.comparability === "breaks" ? "; results with another value are not comparable" : ""}; ${k.setBy === "person" ? "a person may set it" : "its rules set it per session"}`,
        ),
    );
  if (p.rules.length)
    lines.push(
      "its rules, in order:",
      ...p.rules.map((r) => `- ${r.id}: ${sourced(r.why ?? (r.route ? `to ${r.route}` : ""), r.source)}`),
    );
  if (p.checks.length)
    lines.push(
      "its checks after the run:",
      ...p.checks.map((c) => `- ${sourced(`${c.words}${c.action ? ` (${c.action})` : ""}`, c.source)}`),
    );
  if (p.resources) lines.push(`resources: ${p.resources}`);
  if (p.licence) lines.push(`licence: ${p.licence}`);
  return lines.join("\n");
}

/** A family in full: its tasks, its methods and the rules that pick one per session, with their sources. */
export function familyText(f: Family): string {
  return [
    `${f.name} (a family): ${f.words}`,
    `choices: ${choicesText(f.goals)}`,
    "tasks:",
    ...f.tasks.map((t) => `- ${t.name}: ${t.words} (${t.members.join(" or ")})`),
    "methods:",
    ...f.members.map((m) => `- ${m.member} (${m.pipeline}): ${m.words}`),
    "its rules pick the method, the first that holds:",
    ...f.rules.map((r) => `- ${r.id}, to ${r.route ?? "?"}: ${sourced(r.why ?? "", r.source)}`),
    "It is run as a step of a workflow.",
  ].join("\n");
}

export function workflowText(w: Workflow): string {
  return [
    `${w.label} (a workflow): ${w.title}. ${w.what}`,
    "steps:",
    ...w.steps.map((s) => {
      const sw = Object.entries(s.switches).map(([k, v]) => `${k} ${String(v)}`);
      return `- ${s.id}: ${s.of === "family" ? `the family ${s.name}` : s.name}${s.goal ? `, goal ${s.goal}` : ""}${sw.length ? `, ${sw.join(", ")}` : ""}${s.knobs.length ? `; a person may set ${s.knobs.join(", ")}` : ""}`;
    }),
    ...(w.links.length ? ["links:", ...w.links.map((l) => `- ${l.from} into ${l.to}`)] : []),
  ].join("\n");
}

// ------------------------------------------------------------------ the pre-flight's judgement, as counts

export interface Judged {
  ready: number;
  skipped: number;
  routed: number;
  cannot_tell: number;
  with_caveats: number;
  /** The units a hard need skipped, by the pack's words. */
  skipped_by_why: { why: string; units: number }[];
  /** The units skipped because the registry cannot tell a fact, by the fact. */
  cannot_tell_by: { why: string; units: number }[];
  /** The units a rule routed to a member, by the member and the rule's why. */
  routed_by: { to: string; why: string; units: number }[];
  /** The soft needs a unit runs with, by their words. */
  caveats_by: { why: string; units: number }[];
}

const tally = (xs: string[]): { why: string; units: number }[] => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].map(([why, units]) => ({ why, units })).sort((a, b) => b.units - a.units);
};

/** The pack's judgement of a pre-flight's units (`units_judged`), or of a family step (`units` with `counts`), as counts. */
export function judgedOf(body: unknown): Judged | null {
  const b = (body ?? {}) as Rec;
  const uj = (b.units_judged ?? null) as Rec | null;
  const family = Array.isArray(b.units) && b.counts ? b : null;
  const src = uj ?? family;
  if (!src) return null;
  const units = recs(uj ? uj.units : family?.units);
  const counts = (family?.counts ?? {}) as Rec;
  const skippedByWhy = uj
    ? recs(uj.skipped_by_why).map((s) => ({ why: String(s.why ?? ""), units: num(s.units) ?? 0 }))
    : recs(counts.skipped_by_words)
        .filter((s) => !String(s.words ?? "").startsWith("cannot tell"))
        .map((s) => ({ why: String(s.words ?? ""), units: num(s.units) ?? 0 }));
  const cannotTell = tally(
    units
      .filter((u) => u.cannot_tell || String(u.words ?? "").startsWith("cannot tell"))
      .map(
        (u) =>
          `${(str(u.words) ?? `cannot tell: ${String(u.cannot_tell)}`).replace(/^cannot tell:\s*/u, "the registry cannot tell ")} (a person may let it run)`,
      ),
  );
  const routedBy = tally(
    units
      .filter((u) => u.status === "routed")
      .map((u) => {
        const v = (u.variant ?? u) as Rec;
        return `${String(v.member ?? v.variant ?? "")}\u0000${String(v.why ?? "")}`;
      }),
  ).map(({ why, units: n }) => {
    const [to, w] = why.split("\u0000");
    return { to, why: w, units: n };
  });
  const caveats = tally(units.flatMap((u) => (Array.isArray(u.caveats) ? u.caveats.map(String) : [])));
  const pick = (k: string) => num((uj ?? counts)[k]) ?? 0;
  return {
    ready: uj ? pick("ready") : 0,
    skipped: pick("skipped"),
    routed: pick("routed"),
    cannot_tell: pick("cannot_tell"),
    with_caveats: pick("with_caveats"),
    skipped_by_why: skippedByWhy,
    cannot_tell_by: cannotTell,
    routed_by: routedBy,
    caveats_by: caveats,
  };
}

/** The scope's sessions left out before any unit is judged: the visits with no main scan of a role, by why. */
export interface LeftOut {
  visits: number;
  main_visits: number;
  without: number;
  why: { role: string | null; why: string; visits: number }[];
}

export function leftOutOf(body: unknown): LeftOut | null {
  const m = ((body ?? {}) as Rec).main as Rec | null | undefined;
  if (!m) return null;
  const w = (m.without ?? {}) as Rec;
  return {
    visits: num(m.visits) ?? 0,
    main_visits: num(m.main_visits) ?? 0,
    without: num(w.visits) ?? 0,
    why: recs(w.why).map((x) => ({
      role: str(x.role) ?? null,
      why: String(x.why ?? ""),
      visits: num(x.visits) ?? 0,
    })),
  };
}

/** The lines a card and the model read of who is skipped, routed or left out, and why: counts only. */
export function skipLines(o: {
  unit: string;
  judged: Judged | null;
  leftOut: LeftOut | null;
  cannot: { why: string; units: number }[];
}): string[] {
  const u = (n: number) => `${n} ${o.unit}${n === 1 ? "" : "s"}`;
  const out: string[] = [];
  if (o.leftOut && o.leftOut.without > 0)
    out.push(
      `left out before the run: ${u(o.leftOut.without)} of ${o.leftOut.visits} (${o.leftOut.why
        .map((w) => `${w.visits}: ${w.why}`)
        .join("; ")})`,
    );
  for (const c of o.cannot) out.push(`cannot run: ${u(c.units)}: ${c.why}`);
  for (const s of o.judged?.skipped_by_why ?? []) out.push(`skipped: ${u(s.units)}: ${s.why}`);
  for (const s of o.judged?.cannot_tell_by ?? []) out.push(`skipped: ${u(s.units)}: ${s.why}`);
  for (const r of o.judged?.routed_by ?? []) out.push(`routed to ${r.to}: ${u(r.units)}: ${r.why}`);
  return out;
}

/** The soft needs the units run with, as a card's lines: they travel with the results and skip no one. */
export function caveatLines(unit: string, judged: Judged | null): string[] {
  return (judged?.caveats_by ?? []).map(
    (c) => `runs with a caveat, ${c.units} ${unit}${c.units === 1 ? "" : "s"}: ${c.why}`,
  );
}

// ------------------------------------------------------------------ a workflow's plan, as counts

export interface PlanStep {
  step: string;
  pipeline: string;
  refused: string | null;
  units: { total: number; ready: number } | null;
  lines: string[];
  blockers: string[];
}

export interface PlanRead {
  runnable: boolean;
  words: string;
  verdicts: Record<string, number>;
  /** The links that are not simply fed: missing, redundant, refused or satisfied, with the plan's words. */
  links: { verdict: string; words: string }[];
  steps: PlanStep[];
}

/** POST /api/workflows/{id}/plan read into counts and the plan's own words: no unit is named. */
export function planOf(body: unknown): PlanRead {
  const b = (body ?? {}) as Rec;
  const steps: PlanStep[] = recs(b.steps).map((s) => {
    const pf = (s.preflight ?? {}) as Rec;
    const family = Array.isArray(pf.units);
    const units = family
      ? (() => {
          const c = (pf.counts ?? {}) as Rec;
          const total = num(c.units) ?? 0;
          return { total, ready: total - (num(c.skipped) ?? 0) };
        })()
      : pf.units
        ? { total: num((pf.units as Rec).total) ?? 0, ready: num((pf.units as Rec).ready) ?? 0 }
        : null;
    const cannot = recs(pf.cannot).map((c) => ({ why: String(c.why ?? ""), units: num(c.units) ?? 0 }));
    return {
      step: String(s.step ?? ""),
      pipeline: String(s.pipeline ?? s.name ?? ""),
      refused: str(s.refused) ?? null,
      units,
      lines: skipLines({ unit: String(pf.unit ?? "session"), judged: judgedOf(pf), leftOut: null, cannot }),
      blockers: (Array.isArray(pf.blockers) ? pf.blockers : []).map(String),
    };
  });
  const verdicts: Record<string, number> = {};
  for (const [k, v] of Object.entries((b.verdicts ?? {}) as Rec))
    if (num(v) !== null) verdicts[k] = num(v) as number;
  return {
    runnable: b.runnable === true,
    words: str(b.words) ?? "",
    verdicts,
    links: recs(b.links)
      .filter((l) => l.verdict !== "fed")
      .map((l) => ({ verdict: String(l.verdict ?? ""), words: String(l.words ?? "") })),
    steps,
  };
}

/** A plan or a pre-flight kept on a card: every unit's name, subject and day taken out, the counts kept. */
export function withoutUnits(body: unknown): Rec {
  const strip = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(strip);
    if (!x || typeof x !== "object") return x;
    const out: Rec = {};
    for (const [k, v] of Object.entries(x as Rec)) {
      if (k === "named" || k === "subject_id" || k === "session_day" || k === "subject") continue;
      if (k === "units" && Array.isArray(v)) continue;
      if (k === "missing" && Array.isArray(v)) {
        out[k] = v.map((m) => ({ why: (m as Rec)?.why ?? null }));
        continue;
      }
      out[k] = strip(v);
    }
    return out;
  };
  return strip(body) as Rec;
}
