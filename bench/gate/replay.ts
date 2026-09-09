// SPDX-License-Identifier: AGPL-3.0-only
// The gate, deterministic (Wave 4c §9.10 part 3): a recorded provider. A
// fixture holds what a model answered once, as pi's event stream, attempt by
// attempt; replaying it needs no network, and a test that asks "did the
// recovery path fire" reads the attempts and their terminal transitions,
// never the message text.

import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";

export interface Attempt {
  /** pi's events for this attempt, in order; the last is `done` or `error`. */
  events: AssistantMessageEvent[];
}

export interface Fixture {
  id: string;
  /** The question asked, paraphrased; never a term from the source corpus. */
  question: string;
  model: string;
  recorded_at: string;
  attempts: Attempt[];
}

export type Transition = { attempt: number; reason: string; terminal: "done" | "error" };

/** A stream function that replays one fixture, one attempt per call, and logs each attempt's terminal transition. */
export function recorded(fixture: Fixture): {
  stream: () => AsyncIterable<AssistantMessageEvent>;
  transitions: Transition[];
  remaining: () => number;
} {
  let at = 0;
  const transitions: Transition[] = [];
  return {
    transitions,
    remaining: () => fixture.attempts.length - at,
    stream: () => {
      const attempt = fixture.attempts[at];
      const index = at;
      at += 1;
      if (!attempt) throw new Error(`fixture ${fixture.id}: no attempt ${index + 1} was recorded`);
      return (async function* () {
        for (const ev of attempt.events) {
          if (ev.type === "done")
            transitions.push({ attempt: index + 1, reason: ev.reason, terminal: "done" });
          if (ev.type === "error")
            transitions.push({ attempt: index + 1, reason: ev.reason, terminal: "error" });
          yield ev;
        }
      })();
    },
  };
}

/**
 * The message a replayed stream ended with, or null when it ended in an
 * error. Two shapes are read: pi's internal events, whose `done` carries
 * the message, and the pi-messages wire that Kvasir's door speaks, whose
 * text and tool calls arrive as deltas and end blocks and whose `done`
 * carries only the usage.
 */
export async function last(events: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessage | null> {
  const blocks: Record<
    number,
    { type: "text" | "thinking" | "toolCall"; text: string; name?: string; id?: string }
  > = {};
  let usage: AssistantMessage["usage"] | null = null;
  let reason: string | null = null;
  let failed = false;
  for await (const raw of events) {
    const ev = raw as unknown as Record<string, unknown> & { type: string };
    if (ev.type === "done") {
      if (ev.message) return ev.message as AssistantMessage;
      usage = (ev.usage as AssistantMessage["usage"]) ?? null;
      reason = String(ev.reason ?? "stop");
    } else if (ev.type === "error") failed = true;
    else if (ev.type === "text_delta" || ev.type === "thinking_delta") {
      const i = Number(ev.contentIndex ?? 0);
      if (!blocks[i]) blocks[i] = { type: ev.type === "text_delta" ? "text" : "thinking", text: "" };
      blocks[i].text += String(ev.delta ?? "");
    } else if (ev.type === "text_end" || ev.type === "thinking_end") {
      const i = Number(ev.contentIndex ?? 0);
      if (!blocks[i]) blocks[i] = { type: ev.type === "text_end" ? "text" : "thinking", text: "" };
      if (typeof ev.content === "string" && ev.content.length >= blocks[i].text.length)
        blocks[i].text = ev.content;
    } else if (ev.type === "toolcall_start") {
      blocks[Number(ev.contentIndex ?? 0)] = {
        type: "toolCall",
        text: "",
        name: String(ev.toolName ?? ""),
        id: String(ev.id ?? ""),
      };
    } else if (ev.type === "toolcall_delta") {
      const i = Number(ev.contentIndex ?? 0);
      if (!blocks[i]) blocks[i] = { type: "toolCall", text: "" };
      blocks[i].text += String(ev.delta ?? "");
    }
  }
  if (failed || reason === null) return null;
  const content = Object.keys(blocks)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => {
      const b = blocks[i];
      if (b.type === "text") return { type: "text" as const, text: b.text };
      if (b.type === "thinking") return { type: "thinking" as const, thinking: b.text };
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(b.text || "{}");
      } catch {
        args = {};
      }
      return { type: "toolCall" as const, id: b.id ?? "", name: b.name ?? "", arguments: args };
    });
  return {
    role: "assistant",
    content,
    api: "pi-messages",
    provider: "kvasir",
    model: "",
    usage: usage ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: reason === "length" ? "length" : "stop",
    timestamp: 0,
  } as AssistantMessage;
}

/** Retry on a provider error, at most `budget` attempts: the recovery path a station takes (§9.4), fired here so a fixture can assert it. */
export async function withRecovery(
  stream: () => AsyncIterable<AssistantMessageEvent>,
  budget: number,
): Promise<{ message: AssistantMessage | null; attempts: number }> {
  for (let i = 1; i <= budget; i++) {
    const message = await last(stream());
    if (message) return { message, attempts: i };
  }
  return { message: null, attempts: budget };
}

/** The text an assistant message carries, joined. */
export function textOf(m: AssistantMessage | null): string {
  return (m?.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("");
}
