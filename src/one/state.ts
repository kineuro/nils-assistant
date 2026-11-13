// SPDX-License-Identifier: AGPL-3.0-only
// What the one agent keeps between calls (one chat, 2026-10-09): per turn,
// the guards' counts (a turn cap, a token cap, the repeat detector of
// src/stations/machine.ts, warn at 3 and stop at 5), the skills activated,
// the documents drafted and the changes proposed, and the answer's last
// words, so the checks before the turn settles read what the turn did; per
// conversation, what a skill's later turn builds on (the sorting words
// rehearsed, the identity probes). Held in the process like the stations'
// own readings; a restart forgets them, and the next turn reads again.

import type { JsonValue } from "@flue/runtime";
import type { HeldBack } from "../seam/shaped.ts";
import type { HeldShape, ProbeCandidate } from "../stations/identity-check.ts";
import type { Prediction } from "../stations/keyword-tune.ts";
import { initialState, Machine } from "../stations/machine.ts";
import type { Manifest } from "../stations/manifest.ts";
import type { ChangeKind } from "./changes.ts";
import type { TurnOutputs } from "./workspace.ts";

/** The guards of one turn: model calls, tool calls, the input tokens over all its model calls, and wall time. */
export const TURN_BUDGET = { turns: 12, tool_calls: 24, wall_clock_seconds: 600, input_tokens: 400_000 };

const MANIFEST = {
  id: "nils",
  budget: TURN_BUDGET,
  phases: { initial: "turn", transitions: [] },
} as unknown as Manifest;

export interface Proposed {
  kind: ChangeKind;
  id: string;
  details: Record<string, unknown>;
}

export interface TurnState {
  /** The person's words that started the turn. */
  message: string;
  machine: Machine;
  skills: Set<string>;
  /** Tool names called, in order (the parent's own, never a sub-agent's). */
  tools: string[];
  drafted: number[];
  /**
   * The questions the registry stopped at the chat's time limit this turn (2026-11-13): the stored document, null
   * where nothing was stored, and the text drafted where a draft met it. A valid question that is only slow is
   * never drafted again; its answer comes from a job.
   */
  slow: { document: number | null; text: string | null }[];
  proposed: Proposed[];
  /** The runs read this turn, with the reading the checks compare the answer with. */
  runs: { run: number; failed: number; metrics: string[] }[];
  /** The answer's text, model call by model call: the last is the answer the checks read. */
  texts: string[];
  /** How many times the checks sent the turn back. */
  nudges: number;
  /** How many times the turn was sent back for ending with nothing the person can read (2026-10-12). */
  silent: number;
  /** A guard stopped the tools: the model is to answer now; another tool call ends the turn. */
  stopped: string | null;
  asked: boolean;
  /** The question the turn drafted was offered as the conversation's new version. */
  offered: boolean;
  /** The datasets the turn is about: those its words name, or those named before that a follow-up keeps. */
  datasets: string[];
  /** What the turn's analysis handed the person from its workspace's /out: charts and files, and what was seen. */
  outputs: TurnOutputs;
  /**
   * The columns the last answer the turn read held as shapes at the person's detail (record 55 K7, 2026-10-12):
   * the answer may state no value of them, and says their detail does not show them.
   */
  shaped: string[];
  /**
   * The columns the last answer the turn read held values back in (record 55 K7, the ruling on aggregates of
   * 2026-10-12): the answer says which and why, and states no value of them.
   */
  heldBack: HeldBack[];
}

export interface Rehearsal {
  prediction: Prediction;
  /** The rule change's scope (contracts/patch/v1): pack, site:, dataset:, scanner: or batch:. */
  scope: string;
  case_text: string;
  case_value: string;
  /** The typed operations rehearsed (record 56, section 5.5), with the patch's own case. */
  operations: Record<string, JsonValue>[];
  cases: Record<string, JsonValue>[];
  reason: string;
  evidence: Record<string, JsonValue>;
  diff: { verdict: "keep" | "partial" | "revert"; why: string };
  /** The answers people gave that the change breaks, right to wrong. */
  breaks: number;
  at: number;
}

export interface Probe {
  job: number;
  dataset: string;
  rules: Record<string, unknown>[];
  candidates: ProbeCandidate[] | null;
  at: number;
}

export interface ConversationState {
  /** The review groups the sorting's signals showed, per conversation, for the tune's check. */
  groups: Set<string>;
  /** The values the signals report per axis. */
  values: Map<string, Set<string>>;
  packLists: Map<string, string[]>;
  /** The pack's version as its door said, which whole-pack signals are read under. */
  packVersion: string | null;
  /** The signals scopes read in this conversation. */
  signalsRead: Set<string>;
  rehearsal: Rehearsal | null;
  probes: Probe[];
  types: string[] | null;
  held: Map<string, HeldShape[]>;
  /** The documents this conversation drafted, newest last. */
  documents: number[];
  /** The datasets the person named last: a follow-up that names none keeps them. */
  datasets: string[];
}

const turns = new Map<string, TurnState>();
const conversations = new Map<string, ConversationState>();

export function newTurn(conversation: string, message: string, now = Date.now()): TurnState {
  const t: TurnState = {
    message,
    machine: new Machine(MANIFEST, initialState(MANIFEST, now)),
    skills: new Set(),
    tools: [],
    drafted: [],
    slow: [],
    proposed: [],
    runs: [],
    texts: [],
    nudges: 0,
    silent: 0,
    stopped: null,
    asked: false,
    offered: false,
    datasets: [],
    outputs: { charts: [], files: [], seen: new Map() },
    shaped: [],
    heldBack: [],
  };
  turns.set(conversation, t);
  return t;
}

/** The turn running in a conversation; a fresh one when the process has none (a restart mid-turn). */
export function turnOf(conversation: string): TurnState {
  return turns.get(conversation) ?? newTurn(conversation, "");
}

export function conversationOf(id: string): ConversationState {
  let c = conversations.get(id);
  if (!c) {
    c = {
      groups: new Set(),
      values: new Map(),
      packLists: new Map(),
      packVersion: null,
      signalsRead: new Set(),
      rehearsal: null,
      probes: [],
      types: null,
      held: new Map(),
      documents: [],
      datasets: [],
    };
    conversations.set(id, c);
  }
  return c;
}

/** The answer the turn ended with: the text of its last model call that wrote any. */
export function answerOf(t: TurnState): string {
  for (let i = t.texts.length - 1; i >= 0; i--) if (t.texts[i].trim()) return t.texts[i].trim();
  return "";
}

/** The steps of the job plan that runs a stored question, as propose_change takes them. */
export const runSteps = (document: number | string): string =>
  `[{"verb": "run", "args": {"document": ${document}}}]`;

/** The stored question of the turn that was too slow for the chat, the newest; null when none was stored. */
export function slowDocument(t: TurnState): number | null {
  for (let i = t.slow.length - 1; i >= 0; i--) {
    const d = t.slow[i].document;
    if (d !== null) return d;
  }
  return null;
}

/** Whether the turn proposed the job plan that runs a stored question. */
export function runPlanned(t: TurnState, document: number): boolean {
  return t.proposed.some(
    (p) => p.kind === "job_plan" && JSON.stringify(p.details).includes(`run question ${document}"`),
  );
}

/**
 * What a turn that must answer now says of the questions it stored (2026-11-13). A turn whose work was spent was
 * told only to answer with what it had, and said of a question the registry had stored that none was;
 * the person was left with no number to ask for and no next step. The stored document is named with what can be
 * done with it: a question too slow for the chat runs as a job.
 */
export function storedWords(t: TurnState): string {
  const slow = slowDocument(t);
  if (slow !== null)
    return runPlanned(t, slow)
      ? `The question is stored as document ${slow} and is valid; it takes too long to count in the chat, and its job plan waits for the person's approval on the card. Say so with the document's number; never say it was not stored.`
      : `The question is stored as document ${slow} and is valid; it takes too long to count in the chat, so there is no count yet and no job has been started. Say so with the document's number, and offer to run it as a job: when they say yes, you raise the job plan in your next message. Never say it was not stored.`;
  const lost = t.slow.length
    ? "A question that ran past the chat's time limit was not stored and has no number: say so, and never say it is stored or running."
    : "";
  const last = t.drafted.at(-1);
  const kept =
    last === undefined
      ? ""
      : `The last question stored is document ${last}: name it by its number with what it answered, and never say nothing was stored.`;
  return [lost, kept].filter(Boolean).join(" ");
}

/** What a tool answers when a guard ends the turn's work: stop, answer now, and what of the turn is stored. */
export function stopNext(t: TurnState): string {
  return [
    "Stop calling tools. Answer the person now, in plain words, with what you have; say what is missing.",
    storedWords(t),
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The question the turn keeps (round 4, 2026-10-12): the first the answer names ("document 41", "question 41") of
 * those the turn drafted, else the last it drafted. The model sometimes drafts a nearby question after the one that
 * answers (a breakdown, a check) and names the answering one; the card offered the last drafted, and the person kept
 * a question the answer was not about. A skill line ("once a question answers, draft no other") did not hold it.
 */
export function keptDocument(drafted: readonly number[], answer: string): number | undefined {
  for (const m of answer.matchAll(/\b(?:document|question)s?\s+(?:#\s*)?(\d+)\b/giu)) {
    const n = Number(m[1]);
    if (drafted.includes(n)) return n;
  }
  return drafted.at(-1);
}

export function forgetConversation(id: string): void {
  turns.delete(id);
  conversations.delete(id);
}
