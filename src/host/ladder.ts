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
// rung: the host reads it from the policy. Record 26 adds the dataset verbs
// to rung two: pseudonymise, and bring in what is new, the chain the engine
// queues with `then`.

import { holds, SETS } from "./grants.ts";

export interface PolicyRow {
  door: string;
  /** The grant the door needs (record 25): one, or several of which any opens it. */
  grant?: string | string[];
  /** The second grant a door needs beside the first, where it needs two at once. */
  also?: string;
  /** An older engine's ladder step, which stands for its set. */
  role?: string;
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

/** Every door of a policy with its rung, and the grants it needs as the engine names them. */
export function ladderOf(policy: PolicyRow[]): {
  door: string;
  rung: Rung;
  grant: string | string[] | null;
  also: string | null;
  role: string | null;
}[] {
  return policy.map((r) => ({
    door: r.door,
    rung: rungOf(r),
    grant: r.grant ?? null,
    also: r.also ?? null,
    role: r.role ?? null,
  }));
}

/**
 * Whether a person's grants open a door, so a standing grant for it never exceeds the person (record 25): the
 * grant its policy row names, or any of several, and the second grant beside it where the row names one. An
 * older engine's row names a ladder step instead, whose whole set is needed. A row that names neither opens
 * nothing.
 */
export function opens(grants: readonly string[], row: Pick<PolicyRow, "grant" | "also" | "role">): boolean {
  if (typeof row.also === "string" && !holds(grants, row.also)) return false;
  if (typeof row.grant === "string") return holds(grants, row.grant);
  if (Array.isArray(row.grant)) return row.grant.some((g) => holds(grants, g));
  if (typeof row.role !== "string" || !Object.hasOwn(SETS, row.role)) return false;
  return SETS[row.role as keyof typeof SETS].grants.every((g) => holds(grants, g));
}

/** What a door's policy row needs, in words. */
export function needOf(row: Pick<PolicyRow, "grant" | "also" | "role">): string {
  const also = typeof row.also === "string" && row.also ? ` and ${row.also}` : "";
  if (typeof row.grant === "string") return `${row.grant}${also}`;
  if (Array.isArray(row.grant) && row.grant.length > 0)
    return `${row.grant.length === 1 ? row.grant[0] : `one of ${row.grant.join(", ")}`}${also}`;
  if (typeof row.role === "string" && row.role) return `the grants of the ${row.role} step`;
  return "a grant the engine does not name";
}

/** The words of a refusal when a door, or a verb of it, needs a grant the person does not hold (record 25): the standing-grant door and the plan say the same. */
export function exceeds(what: string, row: Pick<PolicyRow, "grant" | "also" | "role">): string {
  return `${what} needs ${needOf(row)}, which you do not hold; a grant never exceeds the person`;
}

/** The verbs a plan may name (section 9.3), each mapped to the engine door it calls; the rung comes from the policy, never from here. */
export interface VerbSpec {
  door: string;
  method: "POST";
  /**
   * The grant the verb itself needs at the door, where the door names the grants of several verbs and the
   * engine checks the verb's own when it queues (record 26: pseudonymise and bring-in are data work). A step
   * of the verb is refused at planning when the person's grants are known and do not hold it.
   */
  needs?: string;
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
/** A source place's name, given with or without the @ the job door reads. */
const placeOf = (v: unknown): string | null => text(v)?.replace(/^@/u, "") || null;

/** The engine scopes none of its job verbs to a batch: a step naming one would run wider than its words, so it is refused. */
function batchless(verb: string, runs: string, a: Record<string, unknown>): { refused: string } | null {
  return a.batch === undefined || a.batch === null ? null : { refused: `${verb} takes no batch: it ${runs}` };
}

/**
 * The tree a digest walks, as the engine's job door resolves it (4c section 6.5): `@name` for a source
 * place, one of the names the capabilities list under ingest_roots, or `@name/relative` for a folder
 * inside it. Never a path of the host, and never a relative part that leaves the place: the door refuses
 * both, so the plan refuses them first.
 */
function treeOf(a: Record<string, unknown>): string | { refused: string } {
  const name = placeOf(a.place);
  if (name === null)
    return { refused: "digest names a source place, one of the ingest_roots the capabilities list" };
  if (name.includes("/"))
    return { refused: "digest names the source place alone, and a folder inside it as path" };
  const rel = text(a.path);
  if (rel === null) return `@${name}`;
  if (rel.startsWith("/") || rel.split("/").includes(".."))
    return { refused: `digest path ${rel} is not a folder inside the source place ${name}` };
  return `@${name}/${rel}`;
}

/**
 * The dataset a step names (record 26): a place with the source role, by its name alone, as the job door
 * reads `@name`. Never a path, never a folder inside it: the pseudonymiser reads the dataset's originals and
 * the chain its trees, both of which the engine resolves from the name.
 */
function datasetOf(verb: string, a: Record<string, unknown>): string | { refused: string } {
  const name = placeOf(a.dataset ?? a.place);
  if (name === null)
    return { refused: `${verb} names a dataset, one of the ingest_roots the capabilities list` };
  if (name.includes("/")) return { refused: `${verb} names the dataset alone, never a folder inside it` };
  return name;
}

const datasetWords = (a: Record<string, unknown>): string => {
  const name = placeOf(a.dataset ?? a.place);
  return name === null ? "a dataset" : `the dataset ${name}`;
};

export const VERBS: Record<string, VerbSpec> = {
  digest: {
    door: "POST /api/jobs",
    method: "POST",
    call: (a) => {
      const tree = batchless("digest", "walks a source place", a) ?? treeOf(a);
      return typeof tree === "string" ? { path: "/api/jobs", body: { command: ["digest", tree] } } : tree;
    },
    words: (a) => {
      const name = placeOf(a.place);
      const place = name === null ? "a source place" : `the source place ${name}`;
      const rel = text(a.path);
      return rel === null ? `digest ${place}` : `digest ${rel} in ${place}`;
    },
  },
  classify: {
    door: "POST /api/jobs",
    method: "POST",
    call: (a) => {
      const pack = text(a.pack);
      return (
        batchless("classify", "judges every stack", a) ?? {
          path: "/api/jobs",
          body: { command: pack === null ? ["classify"] : ["classify", "--pack", pack] },
        }
      );
    },
    words: (a) => {
      const pack = text(a.pack);
      return `classify every stack with ${pack === null ? "the default pack" : `pack ${pack}`}`;
    },
  },
  fingerprint: {
    door: "POST /api/jobs",
    method: "POST",
    call: (a) =>
      batchless("fingerprint", "fingerprints every stack that has none yet", a) ?? {
        path: "/api/jobs",
        body: { command: ["fingerprint"] },
      },
    words: () => "fingerprint every stack that has no fingerprint yet",
  },
  pseudonymize: {
    door: "POST /api/jobs",
    method: "POST",
    needs: "data:work",
    call: (a) => {
      const name =
        batchless("pseudonymize", "reads every file of the dataset's originals", a) ??
        datasetOf("pseudonymize", a);
      if (typeof name !== "string") return name;
      const batch = text(a.name);
      const command = ["pseudonymize", `@${name}`];
      if (batch !== null) command.push("--name", batch);
      if (a.held === true || a.held === "true") command.push("--held");
      return { path: "/api/jobs", body: { command } };
    },
    words: (a) => {
      const batch = text(a.name);
      const held = a.held === true || a.held === "true" ? ", the held files too" : "";
      return `pseudonymise the originals of ${datasetWords(a)} into its pseudonymised tree${batch === null ? "" : ` as batch ${batch}`}${held}`;
    },
  },
  bring_in: {
    door: "POST /api/jobs",
    method: "POST",
    needs: "data:work",
    call: (a) => {
      const name =
        batchless("bring_in", "brings in what is new in the dataset", a) ?? datasetOf("bring_in", a);
      return typeof name === "string"
        ? { path: "/api/jobs", body: { command: ["bring-in", `@${name}`] } }
        : name;
    },
    words: (a) =>
      `bring in what is new in ${datasetWords(a)}: pseudonymise, then digest, fingerprint and classify, each queued when the one before it is done`,
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

/**
 * A plan from the verbs the station named and the engine's policy: rung-two verbs are steps, rung-three
 * verbs are proposals, unknown verbs are refused by name. With the person's grants known, a step whose door
 * or verb needs a grant they do not hold is refused with the words the standing-grant door uses, so a plan
 * never names a dataset the person may not work on.
 */
export function planFrom(steps: unknown, policy: PolicyRow[], grants?: readonly string[]): Planned {
  const out: Planned = { steps: [], proposals: [], refused: [] };
  const rows = new Map(policy.map((r) => [r.door, r]));
  let n = 0;
  for (const raw of Array.isArray(steps) ? steps : []) {
    n += 1;
    const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const verb = String(s.verb ?? "")
      .toLowerCase()
      .replace(/-/gu, "_");
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
    if (grants) {
      // the door's own grant, then the verb's where the door names several and the engine checks the verb's
      if (!opens(grants, row)) {
        out.refused.push({ n, verb, why: `step ${n}: ${exceeds(spec.door, row)}` });
        continue;
      }
      if (spec.needs && !holds(grants, spec.needs)) {
        out.refused.push({ n, verb, why: `step ${n}: ${exceeds(spec.words(args), { grant: spec.needs })}` });
        continue;
      }
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
