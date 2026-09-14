// SPDX-License-Identifier: AGPL-3.0-only
// Sharing a conversation (the chat, slice 5). A share holds a snapshot of the
// words and the cards' references, never a tool's input or output, so what a
// viewer sees of the data is read again under their own roles when they open
// a card. The words may still quote what the tools read, so a share also
// holds the most the conversation could have read: the highest role any of
// its turns ran with, the lower of the person's highest role and the
// station's ceiling. A viewer whose roles do not reach it is refused, with
// the class named. It is an upper bound: the engine states the class a scope
// reaches, not the class of what a read returned.

import { splitReasoning } from "./reasoning.ts";
import { isSummarizeMark } from "./summarize.ts";

/** The roles of the engine, from the least to the most they reach. */
export const ROLES = ["reader", "reviewer", "operator", "admin"] as const;
export type Role = (typeof ROLES)[number];

const rank = (r: Role) => ROLES.indexOf(r);

export function asRole(r: unknown): Role | null {
  return typeof r === "string" && (ROLES as readonly string[]).includes(r) ? (r as Role) : null;
}

/** A person's highest role; null when they hold none. */
export function topRole(roles: readonly string[]): Role | null {
  let best: Role | null = null;
  for (const r of roles) {
    const role = asRole(r);
    if (role && (best === null || rank(role) > rank(best))) best = role;
  }
  return best;
}

export function minRole(a: Role, b: Role): Role {
  return rank(a) <= rank(b) ? a : b;
}

export function maxRole(a: Role, b: Role): Role {
  return rank(a) >= rank(b) ? a : b;
}

/** Whether a person's roles reach what a conversation could have read. */
export function mayRead(roles: readonly string[], reach: Role): boolean {
  const top = topRole(roles);
  return top !== null && rank(top) >= rank(reach);
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
    // each step's words a paragraph apart, with any reasoning a model left inline read out (the chat, slice 9)
    const text = parts
      .filter((p) => p.type === "text")
      .map((p) => (m.role === "assistant" ? splitReasoning(p.text ?? "").text : (p.text ?? "")))
      .reduce(joinSteps, "");
    const steps =
      m.role === "assistant"
        ? parts.flatMap((p) =>
            p.type === "dynamic-tool" && typeof p.toolName === "string"
              ? [{ name: p.toolName, failed: p.state === "output-error" }]
              : [],
          )
        : [];
    const proposals = parts.flatMap((p) => {
      const d = p.data as
        | { kind?: unknown; document?: unknown; parent?: unknown; sentence?: unknown }
        | undefined;
      return p.type.startsWith("data-") &&
        d?.kind === "move_proposal" &&
        typeof d.document === "number" &&
        typeof d.sentence === "string"
        ? [
            {
              document: d.document,
              parent: typeof d.parent === "number" ? d.parent : null,
              sentence: d.sentence,
              decided: decided.get(d.document) ?? null,
            },
          ]
        : [];
    });
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
