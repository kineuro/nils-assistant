// SPDX-License-Identifier: AGPL-3.0-only
// The datasets in the turn's facts (one chat, 2026-10-09): where the scans
// came from, read from the engine's sources door under the person's own
// token, each with its state, its subjects, visits and scans (how many are
// sure, how many need a look) and the cohort it feeds. A person asked how
// many T1 scans with contrast a dataset holds and was told there was no
// such dataset: the facts carried the cohorts and nothing of the datasets.
// A dataset is not a cohort. Its own counts answer how much it holds in
// all; anything narrower is a question that names it with the ask's
// `dataset` field (the find-data skill). Words that name a dataset get its
// line in the turn's hint, and a follow-up keeps the dataset named before.
// Where the engine gives no counts, the names the ask's catalog lists stand
// in. Written without angle brackets or ampersands, as the facts are, and in
// the registry's words: subjects, visits, scans.

import type { Answer, Seam } from "../seam/client.ts";

/** One dataset as the facts carry it. */
export interface DatasetFact {
  name: string;
  /** What its structure says: identified, anonymised, both or unknown; null for a name alone. */
  state: string | null;
  subjects: number | null;
  visits: number | null;
  scans: number | null;
  /** Sorted scans no open question asks about; null from an engine that does not count them. */
  sure: number | null;
  /** Scans an open question of the sort asks about. */
  look: number | null;
  /** Scans no sort has judged yet. */
  unsorted: number | null;
  /** The cohorts it feeds, by name; null for a name alone. */
  feeds: string[] | null;
  /** Its newest digest or change, for the order of the list; 0 when unknown. */
  at: number;
}

/** What one read of the datasets gave. */
export type DatasetsRead =
  | { kind: "ok"; list: DatasetFact[] }
  /** The engine refused this person the datasets. */
  | { kind: "closed" }
  /** No answer: an error, a refusal of another kind, or too slow with nothing read before. */
  | { kind: "unread" };

/** How many datasets the facts list, the newest first; the rest are counted. */
export const DATASETS_SHOWN = 30;
/** How long a turn waits for the sources door when nothing was read before. */
export const DATASETS_WAIT_MS = 4000;
/** How long it waits when there is a last read to go on with: a slow door never holds every turn for long. */
export const DATASETS_WAIT_KNOWN_MS = 1500;

const STATES = ["identified", "anonymised", "both", "unknown"];

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const word = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
/** A name as the facts write it: nothing a tag would escape. */
const clean = (s: string): string => s.replace(/[<>&\s]+/gu, " ").trim();
const time = (x: unknown): number => {
  const t = typeof x === "string" ? Date.parse(x) : Number.NaN;
  return Number.isFinite(t) ? t : 0;
};
const rec = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};

/** The state the engine declares; from an engine before Wave 7a, read from how the data arrives. */
function stateOf(s: Record<string, unknown>, d: Record<string, unknown>): string {
  const declared = word(d.state) ?? word(s.state);
  if (declared && STATES.includes(declared)) return declared;
  const arrives = word(s.arrives) ?? word(d.arrives);
  if (arrives === "identified") return "identified";
  if (arrives === "deidentified" || arrives === "coded") return "anonymised";
  return "unknown";
}

/** The cohorts each dataset feeds, from the cohorts door's `feeds`, and the cohorts retired. */
function feedsOf(cohorts: unknown): { by: Map<string, string[]>; retired: Set<string> } {
  const rows = Array.isArray(cohorts) ? cohorts : (rec(cohorts).cohorts ?? []);
  const by = new Map<string, string[]>();
  const retired = new Set<string>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const c = rec(r);
    const name = word(c.name);
    if (!name) continue;
    if (c.retired_at) {
      retired.add(clean(name));
      continue;
    }
    for (const f of Array.isArray(c.feeds) ? c.feeds : []) {
      const ds = word(f);
      if (ds) by.set(ds, [...(by.get(ds) ?? []), clean(name)]);
    }
  }
  return { by, retired };
}

/**
 * The datasets of a sources door's answer (`GET /api/sources`, a list or under `sources`), with the cohorts each
 * feeds from the cohorts door's answer when there is one. A root, a folder whose datasets are listed each on its
 * own, is left out.
 */
export function datasetsOf(sources: unknown, cohorts: unknown = null): DatasetFact[] {
  const rows = Array.isArray(sources) ? sources : (rec(sources).sources ?? []);
  const fed = feedsOf(cohorts);
  const out: DatasetFact[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const s = rec(r);
    const d = rec(s.dataset);
    const raw = word(s.name) ?? word(s.place);
    if (!raw || d.kind === "root" || s.retired === true || s.retired_at) continue;
    const t = rec(s.totals);
    const feeds = new Set<string>();
    const own = word(s.cohort) ?? word(d.cohort);
    if (own) feeds.add(clean(own));
    for (const c of fed.by.get(raw) ?? []) feeds.add(c);
    for (const c of fed.retired) feeds.delete(c);
    const last = rec(rec(s.digests).last);
    out.push({
      name: clean(raw),
      state: stateOf(s, d),
      subjects: num(t.subjects),
      visits: num(t.sessions),
      scans: num(t.stacks),
      sure: num(t.sure),
      look: num(t.to_sort),
      unsorted: num(t.unsorted),
      feeds: [...feeds].sort(),
      at: Math.max(time(last.finished_at), time(last.started_at), time(s.updated_at), time(s.created_at)),
    });
  }
  return out;
}

/** Datasets known by their names alone, as the ask's catalog lists them: no state, counts or cohorts. */
export function namesOnly(names: unknown): DatasetFact[] {
  return (Array.isArray(names) ? names : []).flatMap((n) => {
    const name = word(n);
    return name
      ? [
          {
            name: clean(name),
            state: null,
            subjects: null,
            visits: null,
            scans: null,
            sure: null,
            look: null,
            unsorted: null,
            feeds: null,
            at: 0,
          },
        ]
      : [];
  });
}

/** The newest first; datasets of the same moment by name. */
export function newestFirst(list: readonly DatasetFact[]): DatasetFact[] {
  return [...list].sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
}

const many = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/** One dataset in a line: its name and state, its counts, the cohort it feeds. */
export function lineOf(d: DatasetFact): string {
  const counted = [d.subjects, d.visits, d.scans].some((n) => n !== null);
  let counts: string;
  if (!counted) counts = "its counts are not at hand";
  else if (!d.subjects && !d.visits && !d.scans) counts = "no scans yet";
  else {
    const sizes = [
      d.subjects !== null ? many(d.subjects, "subject") : null,
      d.visits !== null ? many(d.visits, "visit") : null,
      d.scans !== null ? many(d.scans, "scan") : null,
    ].filter(Boolean);
    const sure = [
      d.sure !== null ? `${d.sure} sure` : null,
      d.look !== null && (d.look > 0 || d.sure !== null)
        ? `${d.look} ${d.look === 1 ? "needs" : "need"} a look`
        : null,
      d.unsorted ? `${d.unsorted} not sorted yet` : null,
    ].filter(Boolean);
    counts = `${sizes.join(", ")}${sure.length ? ` (${sure.join(", ")})` : ""}`;
  }
  const feeds =
    d.feeds === null
      ? ""
      : d.feeds.length === 0
        ? "; feeds no cohort"
        : `; feeds the cohort${d.feeds.length > 1 ? "s" : ""} ${d.feeds.join(" and ")}`;
  return `${d.name}${d.state ? ` (${d.state})` : ""}: ${counts}${feeds}`;
}

const HEAD = "## The datasets (where the scans came from)";
const INTRO =
  "A dataset is not a cohort. How many subjects, visits or scans a dataset holds in all is its count here; anything narrower is a question that names the dataset. Body part and post-contrast are answered by the sorting from the headers, then by steps of their own run on a dataset: until a step has run, only what the headers say is known; the hint says which steps have run on a dataset the words name. State: identified, anonymised, both (identified, with an anonymised copy) or unknown. Newest first:";

/**
 * The datasets as the turn's facts carry them: the newest `shown` in full, the rest counted. Where the sources door
 * gave nothing, the names the ask's catalog lists (`names`) stand in: a question can still name a dataset.
 */
export function datasetsBlock(
  read: DatasetsRead,
  names: readonly DatasetFact[] = [],
  shown = DATASETS_SHOWN,
): string {
  if (read.kind !== "ok" && names.length) {
    const why = read.kind === "closed" ? "are not open to this person" : "could not be read this turn";
    const rest = names.length - shown;
    const listed = `${names
      .slice(0, shown)
      .map((d) => d.name)
      .join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`;
    return `${HEAD}\nTheir counts ${why}, but a question can name one. By name: ${listed}. Never say a dataset is not there.`;
  }
  if (read.kind === "closed")
    return `${HEAD}\nThe datasets are not open to this person. Never say a dataset is not there: say their account cannot see the datasets here, and that an admin can give it.`;
  if (read.kind === "unread")
    return `${HEAD}\nThe datasets could not be read this turn. Never say a dataset is not there: say the datasets could not be read just now.`;
  if (read.list.length === 0) return `${HEAD}\nThe registry holds no dataset yet.`;
  const list = newestFirst(read.list);
  const lines = list.slice(0, shown).map((d) => `- ${lineOf(d)}`);
  const rest = list.length - shown;
  if (rest > 0)
    lines.push(
      `- and ${many(rest, "older dataset")} not listed here: registry_describe with what dataset reads one by name`,
    );
  return [HEAD, INTRO, ...lines].join("\n");
}

const literal = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** The datasets the words name, each by its whole name. */
export function datasetsNamed(message: string, list: readonly DatasetFact[]): DatasetFact[] {
  const text = message.toLowerCase();
  return list.filter(
    (d) =>
      d.name.length >= 2 &&
      new RegExp(`(?<![\\p{L}\\p{N}_-])${literal(d.name.toLowerCase())}(?![\\p{L}\\p{N}_-])`, "u").test(text),
  );
}

/** What a hint says last: which steps have run on each dataset it names (src/one/steps.ts), where they were read. */
const after = (steps: readonly string[]): string => steps.map((s) => ` ${s}`).join("");

/** The hint of a turn whose words name datasets: their lines, how a count in all is answered, where anything narrower goes, and their steps. */
export function datasetHint(
  named: readonly DatasetFact[],
  narrower: string,
  steps: readonly string[] = [],
): string {
  const which = named.map(lineOf).join("; and the dataset ");
  return `Hint from the words: they name the dataset ${which}. How many subjects, visits or scans it holds in all is that count: answer with it, with no question drafted, and never say it is not there. ${narrower}${after(steps)}`;
}

/** The hint of a turn that names no dataset after one that did: words that go on about it keep it. */
export function carriedHint(
  carried: readonly DatasetFact[],
  then: string,
  steps: readonly string[] = [],
): string {
  const which = carried.map(lineOf).join("; and the dataset ");
  return `Hint from the words: earlier in this conversation the person named the dataset ${which}. Words that go on about it (them, those, these scans, how many of them) keep it: ${then} Words about something else leave it.${after(steps)}`;
}

/** Whether the words turn to a cohort, which ends a dataset named before: they say cohort, or name one. */
export function leavesDatasets(message: string, cohorts: readonly string[]): boolean {
  if (/\bcohorts?\b/iu.test(message)) return true;
  const text = message.toLowerCase();
  return cohorts.some(
    (c) =>
      c.length >= 2 &&
      new RegExp(`(?<![\\p{L}\\p{N}_-])${literal(c.toLowerCase())}(?![\\p{L}\\p{N}_-])`, "u").test(text),
  );
}

/** Whether an answer gives one of the datasets' own counts in all: a count from the facts, which needs no question. */
export function citesCount(answer: string, datasets: readonly DatasetFact[]): boolean {
  const own = new Set(
    datasets
      .flatMap((d) => [d.subjects, d.visits, d.scans])
      .filter((n): n is number => typeof n === "number" && n > 0),
  );
  if (own.size === 0) return false;
  for (const m of answer.matchAll(/\d{1,3}(?:[,\u00a0\u202f ]\d{3})+(?!\d)|\d+/gu))
    if (own.has(Number(m[0].replace(/\D/gu, "")))) return true;
  return false;
}

// an apostrophe as a model writes it, straight or curly
const Q = "['’]";
const NOT_THERE = new RegExp(
  [
    String.raw`\bno\s+(?:such\s+)?(?:cohort\s+or\s+)?datasets?\s+(?:called|named|by\s+that\s+name|like|in\s+the\s+registry)\b`,
    String.raw`\bthere(?:${Q}s|\s+is)\s+no\s+(?:such\s+)?(?:cohort\s+or\s+)?dataset\b(?!\s+(?:filter|field))`,
    String.raw`\b(?:is\s+not|isn${Q}t|not)\s+a\s+dataset\b`,
    String.raw`\b(?:could\s+not|couldn${Q}t|cannot|can${Q}t|did\s+not|didn${Q}t)\s+find\s+(?:a|any|the)\s+(?:cohort\s+or\s+)?dataset\b`,
  ].join("|"),
  "iu",
);

/** Whether an answer says a dataset the words named is not there. */
export function saysNotThere(answer: string, names: readonly string[]): boolean {
  if (NOT_THERE.test(answer)) return true;
  return names.some((n) =>
    new RegExp(
      String.raw`\bno\s+${literal(n)}(?![\p{L}\p{N}_-])|${literal(n)}[^.]{0,60}\b(?:does\s+not|doesn${Q}t|did\s+not|didn${Q}t)\s+(?:exist|appear)`,
      "iu",
    ).test(answer),
  );
}

// ------------------------------------------------------------------ reading them

const known = new Map<string, DatasetFact[]>();
const closed = new Set<string>();
const reading = new Map<string, Promise<DatasetsRead>>();

/** The datasets read last for a person: none when the engine refused them, null when none were read yet. */
export function knownDatasets(key: string): DatasetFact[] | null {
  return known.get(key) ?? (closed.has(key) ? [] : null);
}

export function forgetDatasets(): void {
  known.clear();
  closed.clear();
  reading.clear();
}

async function fetchDatasets(o: ReadOptions): Promise<DatasetsRead> {
  const [sources, cohorts] = await Promise.all([
    o
      .sources()
      .call({
        method: "GET",
        path: "/api/sources?recent=1",
        toolCallId: `${o.toolCallId}-sources`,
        phase: o.phase,
      })
      .catch((): Answer => ({ kind: "error", reason: "no answer" })),
    o.cohorts
      ? Promise.resolve()
          .then(() =>
            o.cohorts?.().call({
              method: "GET",
              path: "/api/cohorts",
              toolCallId: `${o.toolCallId}-cohorts`,
              phase: o.phase,
            }),
          )
          .catch(() => null)
      : null,
  ]);
  if (sources.kind === "refused" && (sources.status === 401 || sources.status === 403))
    return { kind: "closed" };
  if (sources.kind !== "ok") return { kind: "unread" };
  return { kind: "ok", list: datasetsOf(sources.body, cohorts?.kind === "ok" ? cohorts.body : null) };
}

export interface ReadOptions {
  /** Whose datasets: the person, as the prelude keys its cache. */
  key: string;
  /** The seam the sources door is read through. */
  sources: () => Seam;
  /** The seam the cohorts door is read through, for the cohorts each dataset feeds; the dataset's own word without it. */
  cohorts?: (() => Seam) | null;
  toolCallId: string;
  phase: string;
  /** How long to wait for an answer before going on with the last one read; by default shorter once one was. */
  wait?: number;
}

/**
 * The datasets for a person: read now, through the person's own seams, and kept for the tools of the turn. A read
 * slower than `wait` goes on in the background and the turn takes the last one read; a read already under way is
 * joined, never doubled.
 */
export async function readDatasets(o: ReadOptions): Promise<DatasetsRead> {
  let p = reading.get(o.key);
  if (!p) {
    p = fetchDatasets(o)
      .catch((): DatasetsRead => ({ kind: "unread" }))
      .then((r) => {
        if (r.kind === "ok") {
          known.set(o.key, r.list);
          closed.delete(o.key);
        }
        if (r.kind === "closed") {
          known.delete(o.key);
          closed.add(o.key);
        }
        return r;
      })
      .finally(() => reading.delete(o.key));
    reading.set(o.key, p);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((r) => {
    timer = setTimeout(
      () => r(null),
      o.wait ?? (known.has(o.key) ? DATASETS_WAIT_KNOWN_MS : DATASETS_WAIT_MS),
    );
  });
  const got = await Promise.race([p, late]);
  clearTimeout(timer);
  if (got && got.kind !== "unread") return got;
  const last = known.get(o.key);
  return last ? { kind: "ok", list: last } : (got ?? { kind: "unread" });
}
