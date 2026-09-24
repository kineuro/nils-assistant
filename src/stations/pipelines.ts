// SPDX-License-Identifier: AGPL-3.0-only
// The host's half of the two analysis stations (record 49 A5 and A6): what
// the engine's pipeline doors answer, read into the few things a small
// model chooses between, and the documents built from its choices. The
// model picks an analysis, its parameters and whom to run it over, and
// explains; the host resolves the pipeline in the catalog, holds the
// parameters to the descriptor, writes the ask a cohort becomes, asks the
// engine's pre-flight and reads a run's checks. Every number a document
// carries is the engine's, never the model's. Nothing here starts a run or
// makes a campaign: those are a person's acts (record 49 R5, D47).

/** A parameter as the descriptor declares it (Boutiques' inputs). */
export interface Param {
  id: string;
  name?: string;
  type: string;
  description?: string;
  default?: unknown;
  choices?: unknown[];
  minimum?: number;
  maximum?: number;
  integer?: boolean;
}

/** A declared check: a metric held to a threshold (x-nils.qc). */
export interface QcCheck {
  metric: string;
  op: string;
  value: number;
  description?: string;
}

/** One measure a run loads, as the ask reads it. */
export interface Measure {
  field: string;
  unit?: string;
  description?: string;
}

/** One catalog entry, read for choosing. */
export interface Entry {
  id: number;
  name: string;
  version: number;
  label: string;
  description: string;
  level: string;
  layout: string;
  roles: string[];
  parameters: Param[];
  measures: Measure[];
  checks: QcCheck[];
  needs: { cores: number | null; memory_gb: number | null; gpu: string | null; unit_minutes: number | null };
  secrets: string[];
  starter: boolean;
}

const str = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** The checks a descriptor declares, from `{metric, op, value}` or the short form `snr >= 8`. */
export function checksOf(raw: unknown): QcCheck[] {
  if (!Array.isArray(raw)) return [];
  const out: QcCheck[] = [];
  for (const c of raw) {
    if (typeof c === "string") {
      const m = /^\s*([A-Za-z0-9_.-]+)\s*(>=|<=|<>|!=|>|<|=)\s*(-?[0-9.eE+-]+)\s*$/u.exec(c);
      if (m) out.push({ metric: m[1], op: m[2] === "!=" ? "<>" : m[2], value: Number(m[3]) });
      continue;
    }
    const o = c as Record<string, unknown>;
    if (typeof o?.metric === "string" && typeof o.op === "string" && typeof o.value === "number")
      out.push({
        metric: o.metric,
        op: o.op,
        value: o.value,
        ...(typeof o.description === "string" ? { description: o.description } : {}),
      });
  }
  return out;
}

/** One entry of GET /api/pipelines, as pipeline_doc answers it. */
export function entryOf(raw: Record<string, unknown>): Entry {
  const name = String(raw.name ?? "");
  const params: Param[] = [];
  for (const p of (Array.isArray(raw.parameters) ? raw.parameters : []) as Record<string, unknown>[]) {
    if (typeof p?.id !== "string") continue;
    params.push({
      id: p.id,
      ...(str(p.name) ? { name: str(p.name) } : {}),
      type: String(p.type ?? "String"),
      ...(str(p.description) ? { description: str(p.description) } : {}),
      ...("default-value" in p ? { default: p["default-value"] } : {}),
      ...(Array.isArray(p["value-choices"]) ? { choices: p["value-choices"] as unknown[] } : {}),
      ...(num(p.minimum) !== null ? { minimum: num(p.minimum) as number } : {}),
      ...(num(p.maximum) !== null ? { maximum: num(p.maximum) as number } : {}),
      ...(p.integer === true ? { integer: true } : {}),
    });
  }
  const measures: Measure[] = [];
  for (const o of (Array.isArray(raw.outputs) ? raw.outputs : []) as Record<string, unknown>[]) {
    if (o?.kind !== "table" || !Array.isArray(o.columns)) continue;
    for (const c of o.columns as Record<string, unknown>[])
      if (typeof c?.name === "string")
        measures.push({
          field: `measure.${name}.${c.name}`,
          ...(str(c.unit) ? { unit: str(c.unit) } : {}),
          ...(str(c.description) ? { description: str(c.description) } : {}),
        });
  }
  const needs = (raw.needs ?? {}) as Record<string, unknown>;
  const descriptor = (raw.descriptor ?? {}) as Record<string, unknown>;
  const x = (descriptor["x-nils"] ?? {}) as Record<string, unknown>;
  const secrets = (Array.isArray(x.secrets) ? x.secrets : []) as Record<string, unknown>[];
  return {
    id: Number(raw.id),
    name,
    version: Number(raw.version),
    label: String(raw.label ?? `${name}@${raw.version}`),
    description: String(raw.description ?? "")
      .replace(/\s+/gu, " ")
      .trim(),
    level: String(raw.level ?? ""),
    layout: String(raw.layout ?? ""),
    roles: (Array.isArray(raw.roles) ? raw.roles : []).map(String),
    parameters: params,
    measures,
    checks: checksOf(raw.checks),
    needs: {
      cores: num(needs.cores),
      memory_gb: num(needs["memory-gb"]),
      gpu: str(needs.gpu) ?? null,
      unit_minutes: num(needs["unit-minutes"]),
    },
    secrets: secrets.map((s) => String(s.id ?? "")).filter(Boolean),
    starter: raw.starter === true,
  };
}

/** The active entries of the catalog, the newest version of each name first. */
export function entriesOf(body: unknown): Entry[] {
  const rows = ((body as { pipelines?: unknown })?.pipelines ?? []) as Record<string, unknown>[];
  return rows
    .filter((r) => (r.state ?? "active") === "active")
    .map(entryOf)
    .sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version);
}

/** The newest version of each name: the one a question means unless it pins one. */
export function newest(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (seen.has(e.name)) return false;
    seen.add(e.name);
    return true;
  });
}

/** A pipeline by name, `name@version` or id; the newest version for a bare name. */
export function resolve(entries: Entry[], ref: string): Entry | null {
  const r = ref.trim();
  const at = r.lastIndexOf("@");
  if (at > 0) {
    const name = r.slice(0, at);
    const version = Number(r.slice(at + 1));
    return entries.find((e) => e.name === name && e.version === version) ?? null;
  }
  if (/^\d+$/u.test(r)) return entries.find((e) => e.id === Number(r)) ?? null;
  return entries.find((e) => e.name === r) ?? null;
}

const hoursOf = (minutes: number): string =>
  minutes < 90 ? `${Math.round(minutes)} min` : `${Math.round((minutes / 60) * 10) / 10} h`;

/** The catalog as a few lines per analysis: what it does, its level and inputs, its parameters, what it measures and checks. */
export function catalogText(entries: Entry[]): string {
  const lines = ["The analyses in the catalog (name@version):"];
  for (const e of newest(entries)) {
    lines.push(`- ${e.label}: ${e.description}`);
    lines.push(
      `  one unit per ${e.level}; inputs ${e.roles.join(" and ") || "the selection's stacks"}; about ${e.needs.unit_minutes === null ? "?" : hoursOf(e.needs.unit_minutes)} a unit on ${e.needs.cores ?? "?"} cores; GPU ${e.needs.gpu ?? "none"}${e.secrets.length ? `; needs the secret ${e.secrets.join(", ")}` : ""}`,
    );
    if (e.parameters.length)
      lines.push(
        `  parameters: ${e.parameters
          .map(
            (p) =>
              `${p.id} (${p.choices ? p.choices.map(String).join("|") : p.type === "Flag" ? "true|false" : p.type}${p.default !== undefined ? `, default ${String(p.default)}` : ""})`,
          )
          .join("; ")}`,
      );
    if (e.measures.length) {
      const cols = e.measures.map((m) => m.field.slice(`measure.${e.name}.`.length));
      lines.push(`  measures, read in the ask as measure.${e.name}.<name>: ${cols.join(", ")}`);
    }
    if (e.checks.length)
      lines.push(`  checks: ${e.checks.map((c) => `${c.metric} ${c.op} ${c.value}`).join("; ")}`);
  }
  return lines.join("\n");
}

/** The cohorts as names with their counts, for choosing whom to run over. */
export function cohortsOf(
  body: unknown,
): { name: string; subjects: number | null; sessions: number | null }[] {
  const rows = (Array.isArray(body) ? body : ((body as { cohorts?: unknown })?.cohorts ?? [])) as Record<
    string,
    unknown
  >[];
  return rows
    .filter((c) => typeof c?.name === "string" && !c.retired_at)
    .map((c) => ({ name: String(c.name), subjects: num(c.subjects), sessions: num(c.sessions) }));
}

export function cohortsText(cohorts: ReturnType<typeof cohortsOf>): string {
  if (cohorts.length === 0) return "No cohort is readable here; a run goes over a saved selection.";
  return `The cohorts: ${cohorts.map((c) => `${c.name} (${c.subjects ?? "?"} subjects, ${c.sessions ?? "?"} sessions)`).join("; ")}.`;
}

const TRUE = new Set(["true", "on", "yes", "1"]);
const FALSE = new Set(["false", "off", "no", "0"]);

/**
 * The parameters a plan runs with: every declared one, the defaults filled,
 * each given value held to its type, its choices and its range. An id the
 * descriptor does not declare is refused by name with the ones it does.
 */
export function paramsFor(
  e: Entry,
  given: Record<string, unknown> | undefined,
): { params: Record<string, unknown>; refused: string[] } {
  const refused: string[] = [];
  const params: Record<string, unknown> = {};
  for (const p of e.parameters) if (p.default !== undefined) params[p.id] = p.default;
  for (const [id, raw] of Object.entries(given ?? {})) {
    const p = e.parameters.find((q) => q.id === id);
    if (!p) {
      refused.push(
        `${e.name} declares no parameter ${id}; it declares ${e.parameters.map((q) => q.id).join(", ") || "none"}`,
      );
      continue;
    }
    let value: unknown = raw;
    if (p.type === "Flag") {
      const t = String(raw).toLowerCase();
      if (typeof raw === "boolean") value = raw;
      else if (TRUE.has(t)) value = true;
      else if (FALSE.has(t)) value = false;
      else {
        refused.push(`${id} is true or false, not ${String(raw)}`);
        continue;
      }
    } else if (p.type === "Number") {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n) || (p.integer && !Number.isInteger(n))) {
        refused.push(`${id} is ${p.integer ? "a whole number" : "a number"}, not ${String(raw)}`);
        continue;
      }
      if ((p.minimum !== undefined && n < p.minimum) || (p.maximum !== undefined && n > p.maximum)) {
        refused.push(`${id} is from ${p.minimum ?? "any"} to ${p.maximum ?? "any"}, not ${n}`);
        continue;
      }
      value = n;
    } else {
      value = typeof raw === "string" ? raw : String(raw);
    }
    if (p.choices && !p.choices.map(String).includes(String(value))) {
      refused.push(`${id} is one of ${p.choices.map(String).join(", ")}, not ${String(value)}`);
      continue;
    }
    params[id] = value;
  }
  return { params, refused };
}

export type Sessions = "all" | "first" | "latest";

/**
 * The ask a set of cohorts becomes when no saved selection names the
 * people: their sessions (all, or each subject's first or latest), and the
 * stacks of those sessions, which is what a run is frozen over. A stack's
 * id is the only column; nothing identifying is projected.
 */
export function cohortDocument(cohorts: string[], sessions: Sessions, name: string): Record<string, unknown> {
  const byName =
    cohorts.length === 1
      ? ["=", {}, ["field", {}, "name"], cohorts[0]]
      : ["in", {}, ["field", {}, "name"], cohorts];
  const visits: Record<string, unknown> = { grain: "session", of: "people" };
  if (sessions !== "all") {
    const dir = sessions === "first" ? "asc" : "desc";
    visits.pick = {
      per: "subject",
      n: 1,
      ties: "report",
      by: [
        [["field", {}, "first"], dir],
        [["field", {}, "id"], dir],
      ],
    };
  }
  return {
    ast_version: 1,
    name,
    scheme: "default",
    sets: {
      scope: { grain: "cohort", where: [byName] },
      people: { grain: "subject", of: "scope" },
      visits,
      stacks: { grain: "stack", of: "visits" },
    },
    keep: ["stacks"],
    out: { set: "stacks", level: "record", columns: [["field", {}, "id"]] },
  };
}

/** What a pre-flight says, read for a document: counts and reasons, never a unit's name, a subject or a day. */
export interface Preflight {
  handle: number | null;
  selection: string | null;
  ready: boolean;
  units: { total: number; ready: number; missing: number };
  missing_by_why: { why: string; units: number }[];
  left_out: { stacks: number; why: string | null } | null;
  estimate: { seconds: number | null; words: string; source: string | null; slots: number | null };
  gpu: { need: string | null; available: boolean | null; device: string | null };
  budget_fits: boolean | null;
  blockers: string[];
  runtime: string | null;
}

export function preflightOf(body: unknown): Preflight {
  const b = (body ?? {}) as Record<string, unknown>;
  const units = (b.units ?? {}) as Record<string, unknown>;
  const whys = new Map<string, number>();
  for (const m of (Array.isArray(b.missing) ? b.missing : []) as Record<string, unknown>[]) {
    const why = String(m?.why ?? "no reason given");
    whys.set(why, (whys.get(why) ?? 0) + 1);
  }
  const est = (b.estimate ?? {}) as Record<string, unknown>;
  const seconds = num(est.seconds);
  const left = b.left_out as Record<string, unknown> | undefined;
  const gpu = (b.gpu ?? {}) as Record<string, unknown>;
  const budget = (b.budget ?? {}) as Record<string, unknown>;
  const runtime = b.runtime as Record<string, unknown> | string | undefined;
  return {
    handle: num(b.handle),
    selection: str(b.selection) ?? null,
    ready: b.ready === true,
    units: {
      total: num(units.total) ?? 0,
      ready: num(units.ready) ?? 0,
      missing: num(units.missing) ?? 0,
    },
    missing_by_why: [...whys.entries()]
      .map(([why, n]) => ({ why, units: n }))
      .sort((a, c) => c.units - a.units),
    left_out: left ? { stacks: num(left.stacks) ?? 0, why: str(left.why) ?? null } : null,
    estimate: {
      seconds,
      words: seconds === null ? "no estimate" : `about ${hoursOf(seconds / 60)}`,
      source: str(est.source) ?? null,
      slots: num(est.slots),
    },
    gpu: {
      need: str(gpu.need) ?? null,
      available: typeof gpu.available === "boolean" ? gpu.available : null,
      device: str(gpu.device) ?? null,
    },
    budget_fits: typeof budget.fits === "boolean" ? budget.fits : null,
    blockers: (Array.isArray(b.blockers) ? b.blockers : []).map((x) =>
      typeof x === "string" ? x : JSON.stringify(x),
    ),
    runtime: typeof runtime === "string" ? runtime : (str(runtime?.name) ?? null),
  };
}

/** The job's command line, as POST /api/jobs takes it: what a person's Run sends. */
export function runCommand(
  label: string,
  over: { select: string } | { handle: number },
  params: Record<string, unknown>,
): string[] {
  const words = ["run", label];
  if ("select" in over) words.push("--select", over.select);
  else words.push("--handle", String(over.handle));
  for (const [k, v] of Object.entries(params)) words.push("--param", `${k}=${String(v)}`);
  return words;
}

/** A saved selection as the engine names it: `selection:<name>@<v>`. */
export function selectionSpec(s: string): string {
  const t = s.trim();
  return t.startsWith("selection:") ? t : `selection:${t}`;
}

// ------------------------------------------------------------------ reading a run

/** The class a failed unit's error falls in, so a person reads a few reasons, not every log line. */
export function reasonClass(status: string, error: string | null): string {
  if (status === "unreported") return "no result reported";
  if (status === "refused") return "a file the engine refused";
  const e = (error ?? "").toLowerCase();
  if (/no (flair|t1w|t2w|input)|holds no|missing|not found|no such file|without (a|an) /u.test(e))
    return "a missing input";
  if (/out of memory|oom|killed|memory|timed? ?out|time limit/u.test(e)) return "out of memory or time";
  if (/licen[cs]e|secret/u.test(e)) return "a missing licence or secret";
  if (/exit|exited|status \d|code \d/u.test(e)) return "the tool failed";
  return "another failure";
}

const INVERSE: Record<string, string> = { ">=": "<", ">": "<=", "<=": ">", "<": ">=", "=": "<>", "<>": "=" };

/** The detail a reading is disclosed at: the person's, never above the station's ceiling. */
export type Detail = "plain" | "quasi" | "sensitive";

/**
 * The smallest group whose count is shown below detail quasi: the engine's
 * k for a measure's totals (record 49 R4b, D27's federation default).
 */
export const K_MIN = 5;

/** A count as it may be shown: the number, or null with `fewer_than_five` below detail quasi. */
export interface Shown {
  count: number | null;
  fewer_than_five: boolean;
}

function shown(n: number, perScan: boolean): Shown {
  return !perScan && n > 0 && n < K_MIN
    ? { count: null, fewer_than_five: true }
    : { count: n, fewer_than_five: false };
}

/** A unit label as the engine answers it; below detail quasi the engine blanks it, and a blank is no label. */
const labelOf = (x: unknown): string | null => (typeof x === "string" && x.length > 0 ? x : null);

/**
 * What a run's checks came to, read from the run, its descriptor and its
 * pipeline:qc items. At detail quasi and above it names the units, the
 * worst value past each check and an example of each failure; below quasi
 * (record 49 R4, R4b) it holds counts by reason and by check only, a count
 * of fewer than five scans said as that and never as its number, and no
 * unit, value or error text.
 */
export interface Reading {
  run: number;
  pipeline: string;
  name: string;
  status: string;
  handle: number | null;
  detail: Detail;
  units: { total: number; succeeded: number; failed: number; skipped: number; unreported: number };
  failed: ({ reason: string; units: string[]; example: string | null } & Shown)[];
  breaches: ({
    metric: string;
    check: string;
    description: string | null;
    units: string[];
    worst: number | null;
  } & Shown)[];
  doubtful_units: Shown;
  measures: number | null;
  checks: { declared: number | null; breaches: number | null; unchecked: number | null };
  refused_files: number;
  open_items: number;
  declared: QcCheck[];
}

/** One run read: the run's own summary, the descriptor's checks, and the run's pipeline:qc items, disclosed at `detail`. */
export function readingOf(
  runBody: unknown,
  entry: Entry | null,
  itemsBody: unknown,
  detail: Detail,
): Reading {
  const perScan = detail !== "plain";
  const r = (runBody ?? {}) as Record<string, unknown>;
  const s = (r.summary ?? {}) as Record<string, unknown>;
  const u = (s.units ?? {}) as Record<string, unknown>;
  const id = Number(r.id);
  const label = String(r.pipeline ?? entry?.label ?? "");
  const name = entry?.name ?? label.replace(/@\d+$/u, "");
  const items = (
    (Array.isArray(itemsBody) ? itemsBody : ((itemsBody as { items?: unknown })?.items ?? [])) as Record<
      string,
      unknown
    >[]
  ).filter((it) => Number(((it.ref ?? it.reference ?? {}) as Record<string, unknown>).run_id) === id);
  // counted per item and per breach entry, each one unit: never by label, which the engine may blank
  const failed = new Map<string, { n: number; units: string[]; example: string | null }>();
  const seen = new Set<string>();
  let failedUnits = 0;
  let breachItems = 0;
  let open = 0;
  for (const it of items) {
    if ((it.status ?? "open") === "open") open++;
    const ref = (it.ref ?? it.reference ?? {}) as Record<string, unknown>;
    const ev = (it.evidence ?? {}) as Record<string, unknown>;
    const status = String(ev.status ?? it.status ?? "failed");
    const unit = labelOf(ref.unit);
    if (status === "breach") {
      breachItems++;
      continue;
    }
    const reason = reasonClass(status, str(ev.error) ?? null);
    const f = failed.get(reason) ?? { n: 0, units: [], example: null };
    f.n++;
    if (unit) {
      f.units.push(unit);
      seen.add(unit);
    }
    f.example ??= str(ev.error)?.slice(0, 160) ?? null;
    failed.set(reason, f);
    failedUnits++;
  }
  // a failed unit the run names that has no item (one closed, or never raised): only by a real label, so a blank never counts twice
  for (const x of (Array.isArray(r.units_run) ? r.units_run : []) as Record<string, unknown>[]) {
    const status = String(x.status ?? "");
    const unit = labelOf(x.unit);
    if ((status !== "failed" && status !== "unreported") || !unit || seen.has(unit)) continue;
    const reason = reasonClass(status, null);
    const f = failed.get(reason) ?? { n: 0, units: [], example: null };
    f.n++;
    f.units.push(unit);
    seen.add(unit);
    failed.set(reason, f);
    failedUnits++;
  }
  const declared = entry?.checks ?? [];
  const byMetric = new Map<
    string,
    {
      metric: string;
      check: string;
      description: string | null;
      n: number;
      units: string[];
      worst: number | null;
    }
  >();
  const entries = (Array.isArray(s.breaches) ? s.breaches : []) as Record<string, unknown>[];
  for (const b of entries) {
    const unit = labelOf(b.unit);
    for (const x of (Array.isArray(b.breaches) ? b.breaches : []) as Record<string, unknown>[]) {
      const metric = String(x.metric ?? "");
      const op = String(x.op ?? declared.find((c) => c.metric === metric)?.op ?? "");
      const threshold = num(x.threshold) ?? declared.find((c) => c.metric === metric)?.value ?? null;
      const key = `${metric} ${op} ${threshold}`;
      const had = byMetric.get(key) ?? {
        metric,
        check: key,
        description: str(x.description) ?? declared.find((c) => c.metric === metric)?.description ?? null,
        n: 0,
        units: [],
        worst: null,
      };
      had.n++;
      if (unit) had.units.push(unit);
      const value = num(x.value);
      if (value !== null)
        had.worst =
          had.worst === null
            ? value
            : op.startsWith(">")
              ? Math.min(had.worst, value)
              : Math.max(had.worst, value);
      byMetric.set(key, had);
    }
  }
  const numbers = (s.numbers ?? {}) as Record<string, unknown>;
  const checks = (numbers.checks ?? {}) as Record<string, unknown>;
  return {
    run: id,
    pipeline: label,
    name,
    status: String(r.status ?? ""),
    handle: num(r.handle_id),
    detail,
    units: {
      total: num(u.total) ?? 0,
      succeeded: num(u.succeeded) ?? 0,
      failed: num(u.failed) ?? 0,
      skipped: num(u.skipped) ?? 0,
      unreported: num(u.unreported) ?? 0,
    },
    failed: [...failed.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([reason, f]) => ({
        reason,
        ...shown(f.n, perScan),
        units: perScan ? f.units : [],
        example: perScan ? f.example : null,
      })),
    breaches: [...byMetric.values()]
      .sort((a, b) => b.n - a.n)
      .map((b) => ({
        metric: b.metric,
        check: b.check,
        description: b.description,
        ...shown(b.n, perScan),
        units: perScan ? b.units : [],
        worst: perScan ? b.worst : null,
      })),
    doubtful_units: shown(failedUnits + Math.max(entries.length, breachItems), perScan),
    measures: num(numbers.measures),
    checks: {
      declared: num(checks.declared) ?? declared.length,
      breaches: num(checks.breaches),
      unchecked: num(checks.unchecked),
    },
    refused_files: num(s.refused_files) ?? 0,
    open_items: open,
    declared,
  };
}

/**
 * The ask a run's breaches become: each breached check a set of the
 * sessions this run measured past its threshold, the union of them, and
 * the stacks of those sessions in the pipeline's first input role, which
 * are what a campaign asks about. The values come from this run alone
 * (`measure.<pipeline>.run`). A failed unit made no measure and is not in
 * it: it is read on the run's page, where its pipeline:qc item stands.
 */
export function breachDocument(reading: Reading, role: string | null): Record<string, unknown> | null {
  const metrics = [...new Map(reading.breaches.map((b) => [`${b.metric}|${b.check}`, b] as const)).values()];
  if (metrics.length === 0) return null;
  const sets: Record<string, unknown> = {};
  const names: string[] = [];
  metrics.forEach((b, i) => {
    const declared = reading.declared.find((c) => `${c.metric} ${c.op} ${c.value}` === b.check);
    const [, op, value] = declared
      ? [declared.metric, declared.op, declared.value]
      : (b.check.split(" ") as [string, string, string]);
    const inverse = INVERSE[op];
    if (!inverse) return;
    const set = `breach_${i + 1}`;
    names.push(set);
    sets[set] = {
      grain: "session",
      where: [
        ["=", {}, ["field", {}, `measure.${reading.name}.run`], reading.run],
        [inverse, {}, ["field", {}, `measure.${reading.name}.${b.metric}`], Number(value)],
      ],
    };
  });
  if (names.length === 0) return null;
  const doubt = names.length === 1 ? names[0] : "doubtful";
  if (names.length > 1) sets.doubtful = { grain: "session", algebra: { op: "union", sets: names } };
  sets.look = {
    grain: "stack",
    of: doubt,
    ...(role ? { where: [["=", {}, ["axis", {}, "role"], role]] } : {}),
  };
  return {
    ast_version: 1,
    name: `the sessions run ${reading.run} of ${reading.name} measured past a check`,
    scheme: "default",
    sets,
    keep: ["look"],
    out: { set: "look", level: "record", columns: [["field", {}, "id"]] },
  };
}

/**
 * The campaign a person may make over the doubtful stacks: a form asking
 * whether each result is usable, over the selection the draft is saved as
 * (a campaign freezes a saved selection, never a draft).
 */
export function campaignDocument(reading: Reading): Record<string, unknown> {
  const name = `${reading.name}-run-${reading.run}-look`;
  return {
    name,
    question: {
      kind: "form",
      schema: {
        type: "object",
        properties: {
          usable: { enum: ["yes", "no", "unsure"] },
          note: { type: "string" },
        },
        required: ["usable"],
      },
    },
    source: { selection: `${name}@1` },
    closes_into: "none",
    raters_per_item: 1,
    hold_back: 0.1,
  };
}
