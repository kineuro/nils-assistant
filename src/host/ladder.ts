// SPDX-License-Identifier: AGPL-3.0-only
// The ladder (Wave 5 section 9.1, D68): three rungs in the language of the
// engine's own doors, each of which declares whether it writes and whether
// it is idempotent (4c section 6.5). Rung one reads. Rung two runs what can
// be undone: verbs that are jobs, resumable and cancellable, whose result is
// a new object beside the old; the assistant may queue these under a
// standing grant the person gave for that verb. Rung three proposes what
// cannot: adopt, release, hand over, erase, change an identity rule,
// promote a model; always a proposal a person accepts. The verbs a plan
// names map to doors here, so the operator station never has to know a
// rung: the host reads it from the policy.

export interface PolicyRow {
  door: string;
  role: string;
  writes: boolean;
  idempotent: boolean;
  cost: "free" | "bounded" | "job" | "stream" | string;
}

export type Rung = 1 | 2 | 3;

/** The doors that are a person's whatever the policy says of them: irreversible, or a decision. */
const IRREVERSIBLE = [
  /\/overlays\/\{id\}\/adopt$/u,
  /\/releases$/u,
  /\/handovers$/u,
  /\/handles\/\{id\}\/promote$/u,
  /\/review\/\{id\}\/(apply|accept)$/u,
  /\/decisions\/\{id\}\/(commit|withdraw)$/u,
  /erase/u,
  /identity/u,
  /\/models\/.*promote/u,
];

/** The rung of a door, from its policy row. */
export function rungOf(row: PolicyRow): Rung {
  if (!row.writes) return 1;
  if (IRREVERSIBLE.some((re) => re.test(row.door))) return 3;
  // a job, or an idempotent write whose result stands beside the old: undoable
  if (row.cost === "job" || row.idempotent) return 2;
  return 3;
}

/** Every door of a policy with its rung. */
export function ladderOf(policy: PolicyRow[]): { door: string; rung: Rung; role: string }[] {
  return policy.map((r) => ({ door: r.door, rung: rungOf(r), role: r.role }));
}

export const LADDER: readonly string[] = ["reader", "reviewer", "operator", "admin"];

/** Whether a person's roles open a door's role: the ladder implies the ones below. */
export function opens(roles: string[], role: string): boolean {
  const need = LADDER.indexOf(role);
  return roles.some((r) => LADDER.indexOf(r) >= need);
}

/** The verbs a plan may name (section 9.3), each mapped to the engine door it calls; the rung comes from the policy, never from here. */
export interface VerbSpec {
  door: string;
  method: "POST";
  /** The path and body of the call, from the step's arguments. */
  call: (args: Record<string, unknown>) => { path: string; body: unknown } | { refused: string };
  /** What the step does, in words, for the plan's restatement. */
  words: (args: Record<string, unknown>) => string;
}

const int = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v)
    ? v
    : typeof v === "string" && /^\d+$/u.test(v)
      ? Number(v)
      : null;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export const VERBS: Record<string, VerbSpec> = {
  digest: {
    door: "POST /api/jobs",
    method: "POST",
    call: (a) => {
      const batch = int(a.batch);
      const root = text(a.root);
      if (batch === null && root === null) return { refused: "digest names a batch or a root" };
      return {
        path: "/api/jobs",
        body: { command: batch !== null ? ["digest", "--batch", String(batch)] : ["digest", "--root", root] },
      };
    },
    words: (a) =>
      int(a.batch) !== null ? `digest batch ${int(a.batch)}` : `digest ${text(a.root) ?? "the root"}`,
  },
  classify: {
    door: "POST /api/jobs",
    method: "POST",
    call: (a) => {
      const batch = int(a.batch);
      const pack = text(a.pack);
      if (batch === null) return { refused: "classify names a batch" };
      return {
        path: "/api/jobs",
        body: { command: ["classify", "--batch", String(batch), ...(pack ? ["--pack", pack] : [])] },
      };
    },
    words: (a) =>
      `classify batch ${int(a.batch)}${text(a.pack) ? ` with pack ${text(a.pack)}` : " with the same pack"}`,
  },
  fingerprint: {
    door: "POST /api/jobs",
    method: "POST",
    call: (a) => {
      const batch = int(a.batch);
      if (batch === null) return { refused: "fingerprint names a batch" };
      return { path: "/api/jobs", body: { command: ["fingerprint", "--batch", String(batch)] } };
    },
    words: (a) => `fingerprint batch ${int(a.batch)}`,
  },
  rebuild: {
    door: "POST /api/sessions/rebuild",
    method: "POST",
    call: () => ({ path: "/api/sessions/rebuild", body: {} }),
    words: () => "rebuild the sessions",
  },
  run: {
    door: "POST /api/ask/jobs",
    method: "POST",
    call: (a) => {
      const document = int(a.document);
      if (document === null) return { refused: "run names a document" };
      return { path: "/api/ask/jobs", body: { document_id: document } };
    },
    words: (a) => `run question ${int(a.document)}`,
  },
  adopt: {
    door: "POST /api/overlays/{id}/adopt",
    method: "POST",
    call: (a) => {
      const overlay = int(a.overlay);
      if (overlay === null) return { refused: "adopt names an overlay" };
      return { path: `/api/overlays/${overlay}/adopt`, body: {} };
    },
    words: (a) => `adopt overlay ${int(a.overlay)}`,
  },
  release: {
    door: "POST /api/releases",
    method: "POST",
    call: (a) => ({ path: "/api/releases", body: a }),
    words: (a) =>
      a.nothing === true || a.nothing === "true"
        ? "release nothing"
        : `release ${text(a.name) ?? "a selection"}`,
  },
  handover: {
    door: "POST /api/handovers",
    method: "POST",
    call: (a) => ({ path: "/api/handovers", body: a }),
    words: (a) => `hand over ${text(a.release) ?? "a release"}`,
  },
  promote: {
    door: "POST /api/ask/handles/{id}/promote",
    method: "POST",
    call: (a) => {
      const handle = int(a.handle);
      if (handle === null) return { refused: "promote names a handle" };
      return { path: `/api/ask/handles/${handle}/promote`, body: { cohort: text(a.cohort) } };
    },
    words: (a) => `promote result ${int(a.handle)} into ${text(a.cohort) ?? "a cohort"}`,
  },
  erase: {
    door: "POST /api/erase",
    method: "POST",
    call: () => ({ refused: "an erasure is never run by the assistant" }),
    words: (a) => `erase ${text(a.what) ?? "what was named"}`,
  },
  rule: {
    door: "POST /api/identity/rules",
    method: "POST",
    call: () => ({ refused: "an identity rule is never changed by the assistant" }),
    words: (a) => `change the identity rule ${text(a.rule) ?? ""}`.trim(),
  },
};

export type When =
  | "now"
  | { after_job: number }
  | { on_event: "batch_landed" | "job_finished" }
  | { at: string };

export interface StepSpec {
  n: number;
  verb: string;
  args: Record<string, unknown>;
  when: When;
}

export interface Planned {
  steps: {
    n: number;
    rung: 2;
    verb: string;
    door: string;
    args: Record<string, unknown>;
    when: When;
    words: string;
  }[];
  proposals: {
    n: number;
    rung: 3;
    verb: string;
    door: string;
    args: Record<string, unknown>;
    words: string;
    closure_needed: true;
  }[];
  refused: { n: number; verb: string; why: string }[];
}

/** The `when` a step names, admitted. */
export function whenOf(v: unknown): When | null {
  if (v === undefined || v === null || v === "now") return "now";
  if (typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.after_job === "number") return { after_job: o.after_job };
  if (o.on_event === "batch_landed" || o.on_event === "job_finished") return { on_event: o.on_event };
  if (typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)))
    return { at: new Date(o.at).toISOString() };
  return null;
}

/** A plan from the verbs the station named and the engine's policy: rung-two verbs are steps, rung-three verbs are proposals, unknown verbs are refused by name. */
export function planFrom(steps: unknown, policy: PolicyRow[]): Planned {
  const out: Planned = { steps: [], proposals: [], refused: [] };
  const rows = new Map(policy.map((r) => [r.door, r]));
  let n = 0;
  for (const raw of Array.isArray(steps) ? steps : []) {
    n += 1;
    const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const verb = String(s.verb ?? "").toLowerCase();
    const args = (s.args && typeof s.args === "object" && !Array.isArray(s.args) ? s.args : {}) as Record<
      string,
      unknown
    >;
    const spec = VERBS[verb];
    if (!spec) {
      out.refused.push({
        n,
        verb,
        why: `no verb named ${verb || "(none)"}; the verbs are ${Object.keys(VERBS).join(", ")}`,
      });
      continue;
    }
    const row = rows.get(spec.door);
    // a door the engine does not serve, or one it calls a person's: a proposal, never a run
    const rung: Rung = row ? rungOf(row) : 3;
    if (rung === 3 || !row) {
      out.proposals.push({
        n,
        rung: 3,
        verb,
        door: spec.door,
        args,
        words: spec.words(args),
        closure_needed: true,
      });
      continue;
    }
    const when = whenOf(s.when);
    if (!when) {
      out.refused.push({
        n,
        verb,
        why: `step ${n}: when is now, {after_job}, {on_event: batch_landed or job_finished} or {at}`,
      });
      continue;
    }
    const call = spec.call(args);
    if ("refused" in call) {
      out.refused.push({ n, verb, why: `step ${n}: ${call.refused}` });
      continue;
    }
    out.steps.push({ n, rung: 2, verb, door: spec.door, args, when, words: spec.words(args) });
  }
  return out;
}

/** The plan restated, one line per step, the rung named (section 9.3). */
export function restate(p: Planned): string {
  const lines = [
    ...p.steps.map((s) => `${s.n}. [rung 2, under a standing grant] ${s.words}${whenWords(s.when)}`),
    ...p.proposals.map((s) => `${s.n}. [rung 3, proposed for a person to accept] ${s.words}`),
    ...p.refused.map((r) => `${r.n}. [refused] ${r.why}`),
  ];
  return lines.join("\n");
}

export function whenWords(w: When): string {
  if (w === "now") return "";
  if ("after_job" in w) return ` after job ${w.after_job} finishes`;
  if ("on_event" in w)
    return w.on_event === "batch_landed" ? " when the next batch lands" : " when the step before it finishes";
  return ` at ${w.at}`;
}
