// SPDX-License-Identifier: AGPL-3.0-only
// The checks before a turn settles (one chat, 2026-10-09): the stations'
// own checks, keyed on the skill the turn activated (or the tool it used
// that belongs to it), and the plain-words check on the answer, run when the
// model would stop. A complaint sends the turn back once with what to fix;
// the second time the turn settles as it is, so a check can never loop.

import { VERBS } from "../host/ladder.ts";
import type { Seam } from "../seam/client.ts";
import type { HeldBack } from "../seam/shaped.ts";
import { heldReading, shapeCounts } from "../stations/identity-check.ts";
import { ladderStore } from "../stations/operator.ts";
import { saysNotThere } from "./datasets.ts";
import { answerOf, type ConversationState, type TurnState } from "./state.ts";
import { alikePairs } from "./tools.ts";
import { unplainWords } from "./words.ts";

const SQL =
  /\bselect\b[\s\S]{0,600}?\bfrom\b|\b(?:insert\s+into|delete\s+from|update\s+\w+\s+set|create\s+table|drop\s+table)\b/iu;
const PERSONAL = /\b(?:19|20)\d{6}-?\d{4}\b|\b\d+(?:\.\d+){5,}\b/u;

/** Words that say a value is not shown at the person's detail. */
const NOT_SHOWN =
  /\b(?:shapes?|detail|hidden|withheld|masked|not (?:shown|visible|known|available|open)|(?:does|do|did) not show|(?:does|do|did)n['\u2019]?t show|cannot (?:see|show|give|tell|share)|can['\u2019]?t (?:see|show|give|tell|share))\b/iu;
/** Who can give the access. */
const WHO_GIVES = /\badmin(?:istrator)?s?\b/iu;
/** A value as an answer gives one: a range, an age or a span of time, a year or a date. */
const VALUE =
  /\b\d+(?:[.,]\d+)?\s*(?:to|and|[-\u2013])\s*\d+(?:[.,]\d+)?\b|\b\d+(?:[.,]\d+)?\s*(?:years?|yrs?|y\/o|months?|weeks?|days?)\b|\baged? \d+|\b(?:19|20)\d{2}(?:-\d{2}){0,2}\b/iu;
/** Words of a column's name that say nothing of what it holds. */
const GENERIC = new Set([
  "min",
  "max",
  "avg",
  "mean",
  "sum",
  "total",
  "count",
  "share",
  "all",
  "per",
  "the",
  "and",
  "subject",
  "subjects",
  "session",
  "sessions",
  "stack",
  "stacks",
  "scan",
  "scans",
]);

/** The words of the columns' names that say what they hold: `age_first` holds an age at a first visit. */
export function columnWords(columns: readonly string[]): string[] {
  const words = columns.flatMap((c) => c.toLowerCase().split(/[^a-z]+/u));
  return [...new Set(words.filter((w) => w.length >= 3 && !GENERIC.has(w)))];
}

/** The value an answer gives in a sentence about columns that came back as shapes; null when it gives none. */
export function valueGiven(answer: string, shaped: readonly string[]): string | null {
  const words = columnWords(shaped);
  for (const sentence of answer.split(/(?<=[.!?;:])\s+/u)) {
    const lower = sentence.toLowerCase();
    if (!words.some((w) => new RegExp(`\\b${w}`, "u").test(lower))) continue;
    const m = VALUE.exec(sentence);
    if (m) return m[0];
  }
  return null;
}

/**
 * What is wrong with an answer about columns that came back as shapes at the person's detail (record 55 K7,
 * 2026-10-12): it may state or guess no value of them, and says plainly that the person's detail does not show
 * them and that an admin can give that access; null when it does. A plain reader was once told "ages 21 to 61",
 * which the model had made up.
 */
export function shapedComplaint(answer: string, shaped: readonly string[]): string | null {
  if (shaped.length === 0 || answer.trim() === "") return null;
  const given = valueGiven(answer, shaped);
  if (given === null && NOT_SHOWN.test(answer) && WHO_GIVES.test(answer)) return null;
  const [these, it] = shaped.length === 1 ? ["the column", "it"] : ["the columns", "them"];
  return `${these} ${shaped.join(", ")} came back as shapes at this person's detail, so no value of ${it} is known${given === null ? "" : ` (the answer gives ${given})`}: never state or guess one; say plainly that their detail does not show ${it}, and that an admin can give that access`;
}

/** Asked what the chat would look for: the question is still drafted, so the person has it and its count. */
const WOULD_LOOK =
  /\bwhat (?:would|will|do|should) you (?:look|search) (?:for|at)\b|\bhow would you (?:find|look for|search for)\b/iu;

/** Words that say a value was held back. */
const HELD_SAID =
  /\b(?:held back|withheld|withhold|not (?:shown|given|reported|available)|(?:is|are|was|were) hidden|suppressed|left out|left blank|blank|null|not disclosed)\b/iu;
/** Why: the group is too small. */
const HELD_WHY = /\b(?:5|five)\b|\btoo (?:few|small)\b|\bsmall(?:er)? (?:group|number)s?\b|\bfewer\b/iu;

/**
 * What is wrong with an answer about columns whose values were held back at the person's detail (record 55 K7, the
 * ruling on aggregates of 2026-10-12): a group's mean, spread or count of distinct values of an age is null where
 * the group holds fewer than 5 subjects. The answer says which values were held back and why, as it says what came
 * back as shapes; null when it does. That it states no held value is the rules' and the tool's line: the column's
 * other groups have values it may give.
 */
export function heldBackComplaint(answer: string, held: readonly HeldBack[]): string | null {
  if (held.length === 0 || answer.trim() === "") return null;
  if (HELD_SAID.test(answer) && HELD_WHY.test(answer)) return null;
  const whys = [...new Set(held.map((h) => h.why))].join("; ");
  return `some values of ${held.map((h) => h.column).join(", ")} were held back at this person's detail (${whys}) and are not known: say which values were held back and why, and never state or guess them`;
}

/** Words that take a held list for an empty one, or give it a size. */
const LIST_NONE =
  /\b(?:no|zero|0)\s+(?:rows?|results?|subjects?|scans?|sessions?|visits?|matches|people|one)\b|\bthere (?:are|is|were|was) no\b|\bnone\b|\bnothing\b|\bempty\b|\b(?:[1-4]|one|two|three|four)\s+(?:rows?|subjects?|scans?|sessions?|visits?|people)\b/iu;
const LIST_WHY = /^a list of fewer than 5\b/iu;

/**
 * What is wrong with an answer about a list held back whole at the person's detail (record 55 K7, small lists, the
 * ruling of 2026-10-13): an answer that lists 1 to 4 subjects a quasi identifying field chose has no row. The answer
 * says the list is held back to protect a small group; it never says the list has no rows, none, or how many. Null
 * when it does.
 */
export function heldListComplaint(answer: string, held: readonly HeldBack[]): string | null {
  if (!held.some((h) => LIST_WHY.test(h.why)) || answer.trim() === "") return null;
  if (LIST_NONE.test(answer))
    return "the list was held back at this person's detail to protect a small group: it is not empty and its size is not known; say it is held back to protect a small group, never no rows, none or a number";
  if (!/\bheld back\b|\bwithheld\b|\bnot shown\b/iu.test(answer))
    return "the list was held back at this person's detail to protect a small group: say so, and never that it has no rows, none or a number";
  return null;
}

export interface CheckContext {
  turn: TurnState;
  convo: ConversationState;
  conversation: string;
  /** The seam a document is validated through; null where none is open. */
  validate: ((document: number) => Promise<string | null>) | null;
  /** The skill the words looked like, when the person may use it (the turn's hint). */
  hinted?: string | null;
}

/** The skills a turn counts as active: those it activated, and those whose tools it used. */
export function activeSkills(t: TurnState): Set<string> {
  const s = new Set(t.skills);
  if (t.drafted.length) s.add("find-data");
  for (const p of t.proposed) {
    if (p.kind === "job_plan") s.add("plan-work");
    if (p.kind === "analysis_plan") s.add("plan-analysis");
    if (p.kind === "overlay") s.add("tune-sorting-words");
    if (p.kind === "identity_merge" || p.kind === "identity_rule") s.add("check-identities");
  }
  if (t.runs.length) s.add("read-run");
  return s;
}

/** The lines of an analysis plan that say who is skipped, routed or left out: a pipeline's own, or every step's of a workflow. */
export function skipsOf(details: Record<string, unknown>): string[] {
  if (Array.isArray(details.skipped_and_routed)) return details.skipped_and_routed.map(String);
  const plan = details.plan as { steps?: { lines?: unknown[] }[] } | null | undefined;
  return (plan?.steps ?? []).flatMap((s) => (Array.isArray(s.lines) ? s.lines.map(String) : []));
}

const SMALL = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/** Whether an answer says a skip line's count: the number after the line's first colon, in digits or in words. */
export function countSaid(answer: string, line: string): boolean {
  const m = /:\s*(\d+)\b/u.exec(line);
  if (!m) return true;
  const n = Number(m[1]);
  const words = [m[1], ...(n < SMALL.length ? [SMALL[n]] : [])];
  return words.some((w) => new RegExp(`\\b${w}\\b`, "iu").test(answer));
}

/** What is wrong with the turn as it would settle; empty when nothing is. */
export async function complaintsOf(c: CheckContext): Promise<string[]> {
  const out: string[] = [];
  const answer = answerOf(c.turn);
  const words = unplainWords(answer);
  if (words.length)
    out.push(
      `the answer uses words a person should not need: ${words.join(", ")}. Say it again in everyday words, without them`,
    );
  if (SQL.test(answer)) out.push("the answer carries SQL; say what was counted in words");
  // words written while tools still ran show as steps after an answer (2026-10-12: a quarter of flash-next's turns)
  if (
    process.env.ONE_CHAT_NARRATION_CHECK !== "0" &&
    c.turn.tools.length > 0 &&
    c.turn.texts.slice(0, -1).some((x) => x.trim() !== "")
  )
    out.push(
      "words were written before the last tool call was done; write nothing until the work is done, then the whole answer once",
    );
  if (PERSONAL.test(answer)) out.push("the answer carries an identifier value; leave it out");
  // a column that came back as shapes has no value the chat knows (record 55 K7, 2026-10-12)
  const shaped = shapedComplaint(answer, c.turn.shaped);
  if (shaped) out.push(shaped);
  // a value held back below detail quasi, a group under 5 subjects (record 55 K7, the ruling on aggregates)
  // a list held back whole says so, and is never said to be empty or of a size (record 55 K7, small lists)
  const list = heldListComplaint(answer, c.turn.heldBack ?? []);
  const held = list ? null : heldBackComplaint(answer, c.turn.heldBack ?? []);
  if (list) out.push(list);
  if (held) out.push(held);
  // a dataset the words name and the facts list is there: the chat once said it was not (2026-10-09)
  if (c.turn.datasets.length && saysNotThere(answer, c.turn.datasets))
    out.push(
      `the words name the dataset ${c.turn.datasets.join(" and ")}, which the registry holds: answer from its counts in the facts, and never say it is not there`,
    );
  const active = activeSkills(c.turn);
  // a question for data answered from memory: the person gets no question to keep, and the number is unchecked
  if (
    c.hinted === "find-data" &&
    !c.turn.asked &&
    ((active.size === 0 &&
      /\d/u.test(answer) &&
      !/\b(no|not|none|nothing|isn't|aren't|cannot|can't)\b/iu.test(answer)) ||
      // asked what the chat would look for, it still drafts the question (round 3), with find-data activated or not;
      // the words alone lost one run of three in rounds 3 and 4 (round 4's: the skill activated, nothing drafted)
      (WOULD_LOOK.test(c.turn.message) && c.turn.drafted.length === 0 && !c.turn.tools.includes("task")))
  )
    out.push(
      "this asks for data: activate the find-data skill and draft the question, so the number is the registry's and the person gets the question to keep",
    );
  if (active.has("find-data") && c.turn.drafted.length && c.validate) {
    const last = c.turn.drafted.at(-1) as number;
    const why = await c.validate(last);
    if (why)
      out.push(
        `the last question drafted (document ${last}) does not validate: ${why}. Fix it and draft again`,
      );
  }
  if (active.has("plan-work") && !c.turn.asked) {
    const plan = c.turn.proposed.find((p) => p.kind === "job_plan");
    if (!plan)
      out.push(
        "an instruction to act becomes a plan: propose it with propose_change, kind job_plan, or say in one sentence why it cannot be planned",
      );
    else {
      const id = plan.details.plan_id;
      const store = ladderStore();
      for (const s of typeof id === "string" && store ? store.steps(id) : [])
        if (!VERBS[s.verb]) out.push(`step ${s.n} names no verb the plan knows`);
    }
  }
  if (active.has("plan-analysis")) {
    const plan = c.turn.proposed.find((p) => p.kind === "analysis_plan");
    const pf = plan?.details.preflight as { units?: { ready?: number } } | null | undefined;
    const named = String(plan?.details.workflow ?? plan?.details.pipeline ?? "");
    if (plan && !answer.toLowerCase().includes(named.toLowerCase()))
      out.push(`say which ${plan.details.workflow ? "workflow" : "analysis"} it is: ${named}`);
    if (plan && typeof pf?.units?.ready === "number" && !answer.includes(String(pf.units.ready)))
      out.push(`restate the check's own number: ${pf.units.ready} units ready`);
    // record 57 P9: every session skipped, routed or left out is said with its count and its reason
    for (const line of plan ? skipsOf(plan.details) : [])
      if (!countSaid(answer, line)) out.push(`say this line's count and reason: ${line}`);
  }
  if (active.has("read-run")) {
    const r = c.turn.runs.at(-1);
    const a = answer.toLowerCase();
    if (r && r.failed > 0 && !a.includes(String(r.failed)))
      out.push(`say how many units failed: ${r.failed}, by reason`);
    for (const m of r?.metrics ?? [])
      if (!a.includes(m.toLowerCase())) out.push(`name the check on ${m} and its count`);
  }
  if (active.has("tune-sorting-words")) {
    const r = c.convo.rehearsal;
    const p = c.turn.proposed.find((x) => x.kind === "overlay");
    if (p && r) {
      const unknown = r.prediction.flip.filter((g) => !c.convo.groups.has(g));
      if (unknown.length)
        out.push(`the groups predicted to close are not ones the signals showed: ${unknown.join(", ")}`);
    }
  }
  if (active.has("check-identities")) {
    const a = answer.toLowerCase();
    const p = c.convo.probes.at(-1);
    const held = p ? c.convo.held.get(p.dataset) : undefined;
    if (p?.candidates && held?.length) {
      const reading = heldReading(held, p.candidates[0] ? shapeCounts(p.candidates[0]) : null);
      if (reading.map_needed && !/\bmap\b/u.test(a))
        out.push("identifiers of the rule's own kind are held: say a map releases them, with the word map");
      if (
        (reading.reading === "second_kind" || reading.reading === "mixed") &&
        !/second kind|another kind|other kind|unlike/u.test(a)
      )
        out.push("a held shape is unlike the rule's: say a second kind of identifier is on this dataset");
    }
    if (
      alikePairs(c.convo).length &&
      !c.turn.proposed.some((x) => x.kind === "identity_merge") &&
      p &&
      Date.now() - p.at < 600_000
    )
      out.push(
        "the probe found two subjects alike: propose their merge with propose_change, kind identity_merge",
      );
  }
  return out;
}

/** A document validated through the find seam: why it is not clean, or null. */
export function validator(seam: () => Seam): (document: number) => Promise<string | null> {
  return async (document) => {
    const a = await seam().call({
      method: "POST",
      path: "/api/ask/validate",
      body: { document_id: document, mode: "strict" },
      toolCallId: `check-${document}-${Date.now()}`,
      phase: "check",
    });
    if (a.kind !== "ok") return null;
    const b = a.body as { valid?: boolean; issues?: unknown[] };
    return b.valid === false || (b.issues?.length ?? 0) > 0
      ? JSON.stringify(b.issues ?? []).slice(0, 300)
      : null;
  };
}

/**
 * Whether a turn would end with something the person can read: its words, a question it asked, or a change it
 * proposed on a card (2026-10-12). A turn once ended with its steps and nothing else.
 */
export function readable(t: TurnState): boolean {
  return answerOf(t) !== "" || t.asked || t.proposed.length > 0;
}

/** The signal that sends back a turn that wrote nothing the person can read. */
export const SILENT_BACK =
  "Before you finish: you have written nothing the person can read. Answer them now, in plain words, with what you have; if something is missing or cannot be done here, say what and what they can do instead.";

/** The signal that sends a turn back: what to fix, and that the new answer replaces the old. */
export function sendBack(complaints: string[]): string {
  return `Before you finish: ${complaints.join("; ")}. Then give the person the whole answer again in plain words; it replaces the one before.`;
}
