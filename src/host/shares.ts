// SPDX-License-Identifier: AGPL-3.0-only
// Sharing a conversation (the chat, slice 5). A share holds a snapshot of the
// words and the cards' references, never a tool's input or output, so what a
// viewer sees of the data is read again under their own grants when they open
// a card. The words may still quote what the tools read, so a share also
// holds the most the conversation could have read: the highest step any of
// its turns ran with, the lower of the step of the person's detail and the
// station's ceiling (record 25). A viewer whose detail does not reach it is
// refused, with the class named. It is an upper bound: the engine states the
// class a scope reaches, not the class of what a read returned.

import { type Detail, holds, reaches } from "./grants.ts";
import { splitReasoning } from "./reasoning.ts";
import { isSummarizeMark } from "./summarize.ts";

/** The ladder's steps, from the least to the most they reach, as a station's ceiling and a kept reach name them. */
export const ROLES = ["reader", "reviewer", "operator", "admin"] as const;
export type Role = (typeof ROLES)[number];

const rank = (r: Role) => ROLES.indexOf(r);

export function asRole(r: unknown): Role | null {
  return typeof r === "string" && (ROLES as readonly string[]).includes(r) ? (r as Role) : null;
}

/** The step a person's detail reads as beside a ceiling: plain as reader, quasi as reviewer, sensitive as operator. */
export function stepOf(detail: Detail): Role {
  return detail === "sensitive" ? "operator" : detail === "quasi" ? "reviewer" : "reader";
}

/** The detail a reach asks of whoever reads it; a reach kept as admin asks what operator does. */
export function detailFor(reach: Role): Detail {
  return reach === "reader" ? "plain" : reach === "reviewer" ? "quasi" : "sensitive";
}

export function minRole(a: Role, b: Role): Role {
  return rank(a) <= rank(b) ? a : b;
}

export function maxRole(a: Role, b: Role): Role {
  return rank(a) >= rank(b) ? a : b;
}

/** Whether a person may read what a conversation could have read: they hold the assistant, and their detail reaches it. */
export function mayRead(who: { grants: readonly string[]; detail: Detail }, reach: Role): boolean {
  return holds(who.grants, "assistant:use") && reaches(who.detail, detailFor(reach));
}

/** The class a share guards, in the engine's name and in words; none for what every reader reaches. */
export function guards(reach: Role): { class: "quasi_identifying" | "sensitive"; words: string } | null {
  if (reach === "reviewer")
    return { class: "quasi_identifying", words: "quasi-identifying values, such as a subject's sex and age" };
  if (reach === "operator" || reach === "admin") return { class: "sensitive", words: "sensitive values" };
  return null;
}

/** The principal of a person the desk names by subject: on one desk everyone's tokens come from the owner's issuer. */
export function principalFor(subject: string, owner: string): string {
  const at = owner.lastIndexOf("@");
  return at > 0 ? `${subject}@${owner.slice(at + 1)}` : subject;
}

export interface SnapshotMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** The steps the assistant took, by tool name only. */
  steps: { name: string; failed: boolean }[];
  /** The query versions it proposed, as references, with the owner's decisions. */
  proposals: {
    document: number;
    parent: number | null;
    sentence: string;
    decided: "accepted" | "rejected" | null;
  }[];
}

export interface Snapshot {
  v: 1;
  messages: SnapshotMessage[];
}

/** Two steps' words, a paragraph apart (the chat, slice 9). */
export function joinSteps(before: string, next: string): string {
  if (before === "" || next === "") return before + next;
  if (before.endsWith("\n\n")) return before + next;
  return before.endsWith("\n") ? `${before}\n${next}` : `${before}\n\n${next}`;
}

interface HistoryPart {
  type: string;
  text?: string;
  data?: unknown;
  toolName?: string;
  state?: string;
}

interface HistoryMessage {
  id: string;
  role: string;
  display?: string;
  /** A signal's tag, which the runtime keeps with it. */
  signal?: { tagName?: string };
  parts?: HistoryPart[];
}

const kindOf = (p: HistoryPart): unknown =>
  p.type.startsWith("data-") ? (p.data as { kind?: unknown } | undefined)?.kind : undefined;

/** The words of an answer's text parts, each step's a paragraph apart, with any reasoning a model left inline read out. */
function wordsOf(parts: readonly HistoryPart[], assistant: boolean): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (assistant ? splitReasoning(p.text ?? "").text : (p.text ?? "")))
    .reduce(joinSteps, "");
}

/**
 * An answer's words as the person read them (2026-10-12): where a check sent the turn back, the words before its
 * `replaced` mark gave way to the answer written after it, so they are left out once that answer has words of its
 * own, as the desk leaves them out. An export once held both, the draft and its replacement, one after the other.
 */
export function answerWords(parts: readonly HistoryPart[]): string {
  const mark = parts.findLastIndex((p) => kindOf(p) === "replaced");
  const after = mark < 0 ? "" : wordsOf(parts.slice(mark + 1), true);
  return after.trim() ? after : wordsOf(parts, true);
}

/**
 * The question a turn asked the person, as words (2026-10-12): the question, then its choices, each with how many
 * it would give where that was said. A turn that ended with a question has no words of its own, and an export once
 * showed it as its steps and nothing else.
 */
export function askedWords(parts: readonly HistoryPart[]): string {
  const asked = parts
    .flatMap((p) => {
      const kind = kindOf(p);
      const d = p.data as { question?: unknown; options?: unknown } | undefined;
      return (kind === "clarification" || kind === "choice") &&
        typeof d?.question === "string" &&
        d.question.trim()
        ? [d]
        : [];
    })
    .at(-1);
  if (!asked) return "";
  const options = (Array.isArray(asked.options) ? asked.options : []).flatMap((o) => {
    const x = o as { label?: unknown; count?: unknown } | null;
    return typeof x?.label === "string" && x.label.trim()
      ? [`- ${x.label.trim()}${typeof x.count === "number" ? ` (${x.count.toLocaleString("en-US")})` : ""}`]
      : [];
  });
  return [String(asked.question).trim(), ...(options.length ? [options.join("\n")] : [])].join("\n\n");
}

/** The snapshot of a conversation's history: what was said, the steps by name, and the proposals with their decisions. */
export function snapshotOf(
  history: { messages?: HistoryMessage[] },
  decisions: { document: number; decided: "accepted" | "rejected" | null }[] = [],
): Snapshot {
  const decided = new Map(decisions.map((d) => [d.document, d.decided]));
  const messages: SnapshotMessage[] = [];
  // where the person asked to summarize, and the one line that answered, are not part of what was said (the chat, slice 11)
  let summarizing = false;
  for (const m of history.messages ?? []) {
    if (isSummarizeMark(m)) {
      summarizing = true;
      continue;
    }
    if (m.display && m.display !== "visible") continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (summarizing) {
      summarizing = false;
      if (m.role === "assistant") continue;
    }
    const parts = m.parts ?? [];
    // each step's words a paragraph apart, with any reasoning a model left inline read out (the chat, slice 9); an
    // answer a check sent back is left out once its replacement has words, and a question the turn asked is words
    // of its own (2026-10-12)
    const text =
      m.role === "assistant" ? joinSteps(answerWords(parts), askedWords(parts)) : wordsOf(parts, false);
    const steps =
      m.role === "assistant"
        ? parts.flatMap((p) =>
            p.type === "dynamic-tool" && typeof p.toolName === "string"
              ? [{ name: p.toolName, failed: p.state === "output-error" }]
              : [],
          )
        : [];
    const listed = parts.flatMap((p) => {
      const d = p.data as
        | {
            kind?: unknown;
            change?: unknown;
            document?: unknown;
            parent?: unknown;
            sentence?: unknown;
            ref?: { document?: unknown; parent?: unknown };
          }
        | undefined;
      if (!p.type.startsWith("data-") || typeof d?.sentence !== "string") return [];
      // a station's version of the question, or the one chat's card for one (2026-10-12: the export left those out)
      const [document, parent] =
        d.kind === "move_proposal"
          ? [d.document, d.parent]
          : d.kind === "approval" && d.change === "query_version"
            ? [d.ref?.document, d.ref?.parent]
            : [undefined, undefined];
      return typeof document === "number"
        ? [
            {
              document,
              parent: typeof parent === "number" ? parent : null,
              sentence: d.sentence,
              decided: decided.get(document) ?? null,
            },
          ]
        : [];
    });
    // one card per question, as the desk shows it
    const proposals = listed.filter((x, i) => listed.findIndex((y) => y.document === x.document) === i);
    // a turn that wrote no words answered with the sentence it settled on, unless its proposals already say it (the chat, slice 7)
    const settled = parts
      .flatMap((p) => {
        const d = p.data as { kind?: unknown; phase?: unknown; text?: unknown } | undefined;
        return p.type.startsWith("data-") &&
          d?.kind === "status" &&
          d.phase === "finish" &&
          typeof d.text === "string"
          ? [d.text]
          : [];
      })
      .at(-1);
    const said = text || (m.role === "assistant" && proposals.length === 0 ? (settled ?? "") : "");
    if (m.role === "assistant" && !said && steps.length === 0 && proposals.length === 0) continue;
    messages.push({ id: m.id, role: m.role, text: said, steps, proposals });
  }
  return { v: 1, messages };
}
