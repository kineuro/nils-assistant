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

/** The message a replayed stream ended with, or null when it ended in an error. */
export async function last(events: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessage | null> {
  let out: AssistantMessage | null = null;
  for await (const ev of events) {
    if (ev.type === "done") out = ev.message;
    if (ev.type === "error") out = null;
  }
  return out;
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
