// SPDX-License-Identifier: AGPL-3.0-only
// Words with two readings, read one way and held in the draft (2026-11-15,
// from live use). Two faults:
// - A name that is a cohort's and a dataset's was asked of the dataset in
//   some chats and of the cohort in others, for the same kind of question,
//   and the counts differed a little. The ruling: the cohort, unless the
//   words say dataset (src/one/datasets.ts reads it); a follow-up keeps the
//   reading of the turn before.
// - "Scans at least five years apart" was counted between consecutive
//   visits, where the plain reading is a subject's first to last; and the
//   earlier day was put first in days_between, which is the first day minus
//   the second, so nothing passed.
// The skill says both. Here the reading is also held where it is made: a
// draft that goes against it is sent back before it reaches the registry,
// with the exact shape to use. Each fault is sent back once a turn; a draft
// that keeps it after that goes on as it is, so a check can never loop.

import { parse } from "yaml";
import {
  cohortShape,
  type DatasetFact,
  datasetsNamed,
  leavesDatasets,
  namesOneOf,
  sharedReadings,
} from "./datasets.ts";
import type { ConversationState, TurnState } from "./state.ts";

// ------------------------------------------------------------------ the names a turn is about

export interface NamesRead {
  /** The datasets the words name, without the shared names they read as the cohort. */
  named: DatasetFact[];
  /** The datasets named before that a follow-up keeps. */
  carried: DatasetFact[];
  /** The shared names the words read as the cohort. */
  cohorts: string[];
  /** The shared names read as the cohort before that a follow-up keeps. */
  keptCohorts: string[];
  /** The shared names the words call a dataset. */
  asDataset: string[];
  /** How the turn reads each shared name: what a draft is held to. */
  readings: TurnState["readings"];
}

/**
 * The datasets and the shared names a turn is about, from its words and the turn before. Words that name one set
 * what the conversation keeps; words that name none keep it (`follows`: they look like a question of the data),
 * until they turn elsewhere: a cohort named ends a dataset, and the word dataset or another cohort's name ends a
 * shared name read as the cohort. A name the words call both a cohort and a dataset is kept as both and held to
 * neither.
 */
export function readNames(
  message: string,
  list: readonly DatasetFact[],
  cohortNames: readonly string[],
  convo: Pick<ConversationState, "datasets" | "cohorts">,
  follows: boolean,
): NamesRead {
  const all = [...cohortNames, ...list.flatMap((x) => x.feeds ?? [])];
  const shared = sharedReadings(message, list, all);
  const cohorts = shared.filter((r) => r.as === "cohort").map((r) => r.name);
  const asDataset = shared.filter((r) => r.as === "dataset").map((r) => r.name);
  const named = datasetsNamed(message, list).filter((x) => !cohorts.includes(x.name));
  if (named.length || cohorts.length) {
    convo.datasets = named.map((x) => x.name);
    convo.cohorts = shared.filter((r) => r.as !== "dataset").map((r) => r.name);
    return {
      named,
      carried: [],
      cohorts,
      keptCohorts: [],
      asDataset,
      readings: [
        ...cohorts.map((name) => ({ name, as: "cohort" as const, kept: false })),
        ...asDataset.map((name) => ({ name, as: "dataset" as const, kept: false })),
      ],
    };
  }
  let carried: DatasetFact[] = [];
  if (leavesDatasets(message, cohortNames)) convo.datasets = [];
  else if (follows) carried = list.filter((x) => convo.datasets.includes(x.name));
  if (/\bdata\s?sets?\b/iu.test(message) || namesOneOf(message, cohortNames)) convo.cohorts = [];
  // a name kept as both is held to neither
  const keptCohorts = convo.cohorts.filter((n) => !convo.datasets.includes(n));
  const are = new Set(all.map((c) => c.toLowerCase()));
  return {
    named,
    carried,
    cohorts,
    keptCohorts,
    asDataset,
    readings: [
      ...keptCohorts.map((name) => ({ name, as: "cohort" as const, kept: true })),
      ...carried
        .filter((x) => are.has(x.name.toLowerCase()) && !convo.cohorts.includes(x.name))
        .map((x) => ({ name: x.name, as: "dataset" as const, kept: true })),
    ],
  };
}

// ------------------------------------------------------------------ how far apart in time

/** Words that ask how far apart in time two scans or visits of a subject are. */
const APART =
  /\bapart\b|\bspan(?:s|ned|ning)?\b|\bfollow[- ]?up\s+(?:of|for|over|spanning)\s+(?:at least|more than|over|a minimum of|\d)|\bfollowed(?:\s+up)?\s+(?:for|over)\b/iu;
/** Words that ask it of one visit and the one before. */
const CONSECUTIVE =
  /\bconsecutive(?:ly)?\b|\bsuccessive\b|\bbetween\s+(?:(?:two|the|their|his|her|each|any|following|subsequent|adjacent|one|and|next)\s+){0,3}(?:visits|sessions|scans)\b|\bgaps?\b|\bintervals?\s+between\b|\bprevious\b|\bthe\s+one\s+before\b|\badjacent\b|\bin\s+a\s+row\b|\bback[- ]to[- ]back\b/iu;
/** A length of time, which makes a word of consecutive visits a question of time. */
const LENGTH = /\b(?:days?|weeks?|months?|years?)\b/iu;

/**
 * How the words ask the time between a subject's visits: `span`, from the earliest to the latest that holds what
 * is asked (apart, a span, a follow-up of at least), `consecutive`, a visit against the one before (consecutive,
 * successive, between visits, a gap, an interval between), or null when they ask neither.
 */
export function timeReading(message: string): "span" | "consecutive" | null {
  if (CONSECUTIVE.test(message)) return APART.test(message) || LENGTH.test(message) ? "consecutive" : null;
  return APART.test(message) ? "span" : null;
}

/** The first-to-last shape, for the hint and for a draft sent back: one the registry accepts as it stands. */
export const SPAN_SHAPE =
  'the sessions that hold what is asked (`holding: {grain: session, from: visits, has: [{set: <the scans>, min: 1}]}`), then a group by subject over them with each day bound by itself, `spans: {grain: group, group: {of: holding, by: [["field", {}, "subject.code"]]}, bind: {first_day: ["min", {set: holding}, ["field", {}, "first"]], last_day: ["max", {set: holding}, ["field", {}, "first"]]}, where: [[">=", {}, ["days_between", {}, ["field", {}, "last_day"], ["field", {}, "first_day"]], <days>]]}`, answered with `out: {set: spans, level: count}`';

/** What the hint says of words that ask the time between visits: which reading, and that the answer states it. */
export function timeNote(reading: "span" | "consecutive" | null): string {
  if (reading === "span")
    return " The words ask how far apart in time and do not say consecutive: read it per subject from the earliest to the latest visit that holds what is asked, never against the visit before (`prev`). `days_between` is its first day minus its second, so the later day goes first. Say the reading in the answer in a few words (from the first to the last such visit).";
  if (reading === "consecutive")
    return " The words ask the time between consecutive visits: each visit against the one before it, `days_between` of the visit's day and then `prev` of it (the later day first). Say the reading in the answer in a few words (between consecutive visits).";
  return "";
}

// ------------------------------------------------------------------ the draft, read

type Clause = [string, Record<string, unknown>, ...unknown[]];
const isMap = (x: unknown): x is Record<string, unknown> =>
  Boolean(x) && typeof x === "object" && !Array.isArray(x);
const isClause = (x: unknown): x is Clause =>
  Array.isArray(x) && x.length >= 2 && typeof x[0] === "string" && isMap(x[1]);

/** Every clause under a value, the outer before the inner. */
function clausesOf(x: unknown, out: Clause[] = [], depth = 0): Clause[] {
  if (depth > 40) return out;
  if (isClause(x)) out.push(x);
  if (Array.isArray(x)) for (const y of x) clausesOf(y, out, depth + 1);
  else if (isMap(x)) for (const y of Object.values(x)) clausesOf(y, out, depth + 1);
  return out;
}

/** A draft as a document; null for text that does not read as one, which the registry answers. */
export function readDraft(text: string): Record<string, unknown> | null {
  try {
    const doc = parse(text) as unknown;
    return isMap(doc) && isMap(doc.sets) ? doc : null;
  } catch {
    return null;
  }
}

const fieldOf = (x: unknown): string | null =>
  isClause(x) && x[0] === "field" && typeof x[2] === "string" ? x[2] : null;

/** The names a clause's value stands for: itself, or a parameter's value or list. */
function namesOf(x: unknown, doc: Record<string, unknown>): string[] {
  if (typeof x === "string") return [x];
  if (isClause(x) && x[0] === "param" && typeof x[2] === "string") {
    const p = isMap(doc.params) ? doc.params[x[2]] : null;
    const v = isMap(p) ? p.value : p;
    return (Array.isArray(v) ? v : [v]).filter((s): s is string => typeof s === "string");
  }
  return [];
}

/** The names compared with a field (`=`, `in`, `has`) under a value. */
function comparedWith(x: unknown, doc: Record<string, unknown>, is: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const c of clausesOf(x)) {
    if (!["=", "in", "has"].includes(c[0])) continue;
    const args = c.slice(2);
    if (!args.some((a) => is(fieldOf(a) ?? ""))) continue;
    for (const a of args) out.push(...namesOf(a, doc));
  }
  return out;
}

/** The datasets a draft narrows to with the field `dataset`. */
export function datasetsAsked(doc: Record<string, unknown>): string[] {
  return comparedWith(doc.sets, doc, (p) => p === "dataset" || p.endsWith(".dataset"));
}

/** The cohorts a draft asks by name: a cohort set's `name`, or `cohort.name` on a set below one. */
export function cohortsAsked(doc: Record<string, unknown>): string[] {
  const out = comparedWith(doc.sets, doc, (p) => p === "cohort.name");
  for (const s of Object.values(doc.sets as Record<string, unknown>))
    if (isMap(s) && s.grain === "cohort") out.push(...comparedWith(s.where, doc, (p) => p === "name"));
  return out;
}

/** The bindings of a draft by name, where one name is bound once. */
function bindingsOf(doc: Record<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const twice = new Set<string>();
  for (const s of Object.values(doc.sets as Record<string, unknown>))
    for (const [k, v] of Object.entries(isMap(s) && isMap(s.bind) ? s.bind : {})) {
      if (out.has(k)) twice.add(k);
      out.set(k, v);
    }
  for (const k of twice) out.delete(k);
  return out;
}

/** What day a clause stands for, where the draft says: the one before, the earliest or the latest of a column. */
function dayOf(x: unknown, binds: Map<string, unknown>, depth = 0): { kind: string; of: string } | null {
  if (!isClause(x) || depth > 4) return null;
  if (x[0] === "prev" || x[0] === "min" || x[0] === "max")
    return { kind: x[0], of: JSON.stringify([x[1].set ?? null, x[2] ?? null]) };
  const name = fieldOf(x);
  return name !== null && binds.has(name) ? dayOf(binds.get(name), binds, depth + 1) : null;
}

/**
 * Whether a draft takes the days between two days the wrong way round: the day before, or the earliest, first.
 * `days_between` is its first day minus its second, so such a draft counts nothing at or above any threshold.
 */
export function daysReversed(doc: Record<string, unknown>): boolean {
  const binds = bindingsOf(doc);
  return clausesOf(doc.sets).some((c) => {
    if (c[0] !== "days_between") return false;
    const a = dayOf(c[2], binds);
    const b = dayOf(c[3], binds);
    if (a?.kind === "prev") return b?.kind !== "prev";
    return a?.kind === "min" && b?.kind === "max" && a.of === b.of;
  });
}

/** Whether a draft reads a row against the one before it. */
export const usesPrev = (doc: Record<string, unknown>): boolean =>
  clausesOf(doc.sets).some((c) => c[0] === "prev");

// ------------------------------------------------------------------ the draft, held to the reading

/** One fault a draft is sent back for: its key, what is wrong, and the shape to use. */
export interface DraftFault {
  key: string;
  why: string;
  next: string;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** What a draft does against the turn's readings; empty for one that keeps them, or that does not read as a document. */
export function draftFaults(text: string, turn: Pick<TurnState, "message" | "readings">): DraftFault[] {
  const doc = readDraft(text);
  if (!doc) return [];
  const out: DraftFault[] = [];
  const datasets = datasetsAsked(doc);
  const cohorts = cohortsAsked(doc);
  for (const r of turn.readings) {
    if (r.as === "cohort" && datasets.some((d) => same(d, r.name)))
      out.push({
        key: `cohort:${r.name.toLowerCase()}`,
        why: `the draft narrows to the dataset ${r.name} with the field dataset, and the person's words ${r.kept ? "go on about the cohort named before and " : ""}do not say dataset: ${r.name} is a cohort and a dataset of the same name, and without the word dataset it is the cohort`,
        next: `Take out every clause on the field dataset that names ${r.name}, and ask the cohort's members: the sets ${cohortShape(r.name)}, with the sessions \`of: people\` and the scans \`of\` those sessions, as the worked examples show. Say in the answer, in one short clause, that the members of the cohort ${r.name} were counted.`,
      });
    if (r.as === "dataset" && cohorts.some((c) => same(c, r.name)))
      out.push({
        key: `dataset:${r.name.toLowerCase()}`,
        why: `the draft asks the cohort ${r.name} by its name, and the person's words ${r.kept ? "go on about the dataset named before" : "say dataset"}: ${r.name} is a cohort and a dataset of the same name, and the words ask the dataset`,
        next: `Take the cohort set named ${r.name} out, with the sets drawn \`of\` it, and name the dataset in the \`where\` of the set that is counted: \`["=", {}, ["field", {}, "dataset"], "${r.name}"]\`, on sets with no cohort above them. Say in the answer, in one short clause, that the dataset ${r.name} was counted.`,
      });
  }
  if (daysReversed(doc))
    out.push({
      key: "days-reversed",
      why: "the draft takes days_between with the earlier day first; it is its first day minus its second, so every row gets zero or less and nothing passes a threshold",
      next: 'Put the later day first: `["days_between", {}, ["field", {}, "first"], ["prev", {}, ["field", {}, "first"]]]` for a visit and the one before, `["days_between", {}, ["field", {}, "last_day"], ["field", {}, "first_day"]]` for a subject\'s latest and earliest.',
    });
  if (timeReading(turn.message) === "span" && usesPrev(doc))
    out.push({
      key: "span",
      why: "the draft measures each visit against the one before it (`prev`), and the person's words ask how far apart without saying consecutive: that is each subject's earliest to latest visit that holds what is asked",
      next: `Take \`prev\` out and use ${SPAN_SHAPE}. Write a length in years as whole days of 365.25 a year (five years are 1826). Say in the answer, in a few words, that it is from the first to the last such visit.`,
    });
  return out;
}

/**
 * What a draft is sent back with before it reaches the registry: every fault it has that this turn was not sent
 * back for yet, in one answer; null when there is none, so the same fault never sends a draft back twice.
 */
export function sendDraftBack(
  text: string,
  turn: Pick<TurnState, "message" | "readings" | "sentBack">,
): { why: string; next: string } | null {
  const faults = draftFaults(text, turn).filter((f) => !turn.sentBack.has(f.key));
  if (faults.length === 0) return null;
  for (const f of faults) turn.sentBack.add(f.key);
  return {
    why: `the draft was not sent to the registry: ${faults.map((f) => f.why).join("; and ")}`,
    next: `${faults.map((f) => f.next).join(" ")} Change only that and draft the whole document again.`,
  };
}
