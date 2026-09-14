// SPDX-License-Identifier: AGPL-3.0-only
// A conversation summarized when the person asks (the chat, slice 11). The
// runtime summarizes a conversation's earlier turns by itself as its context
// fills, and offers no way to do it on demand from outside the station. So the
// host sends the station a summarize signal: for that one submission the station
// sets its compaction so that, once its short answer is done, the runtime
// summarizes everything but the latest turns, and the thread notes it as it does
// when the runtime summarizes by itself. The host first counts what there is to
// summarize, so a conversation too short for it is told so and no model is asked.

/** The tag the summarize signal carries: the runtime keeps it with the signal, so the thread can show where the person asked. */
export const SUMMARIZE_TAG = "summarize";

/** The signal the host sends the station, as the runtime's HTTP door takes a message. */
export const SUMMARIZE_SIGNAL = {
  kind: "signal",
  type: "summarize",
  tagName: SUMMARIZE_TAG,
  body: "The person asked to summarize the conversation so far, so that it takes less of the context. Answer in one short sentence that the earlier conversation is being summarized, and call no tool.",
} as const;

/** The tokens a summarize keeps as they were: about the latest turn. */
export const SUMMARIZE_KEEP = 2_000;

/** Whether a delivered message is the summarize signal. */
export function isSummarize(delivered: unknown): boolean {
  const d = delivered as { kind?: unknown; type?: unknown } | null;
  return d?.kind === "signal" && d.type === "summarize";
}

/** Whether a message of a conversation's history is where the person asked to summarize. */
export function isSummarizeMark(message: unknown): boolean {
  const m = message as { signal?: { tagName?: unknown } } | null;
  return m?.signal?.tagName === SUMMARIZE_TAG;
}

/**
 * The compaction a summarize submission runs with: the whole window is reserve, so the runtime summarizes as
 * soon as the submission is idle, and the latest turn stays as it was. The summary itself stays within what
 * the runtime asks of it, at most four fifths of the reserve and never more than its own cap.
 */
export function summarizeCompaction(contextWindow: number): {
  reserveTokens: number;
  keepRecentTokens: number;
} {
  return {
    reserveTokens: Math.max(contextWindow - 1, 1),
    keepRecentTokens: Math.max(Math.min(SUMMARIZE_KEEP, Math.floor(contextWindow / 8)), 1),
  };
}

interface CountedPart {
  type: string;
  text?: unknown;
  input?: unknown;
  output?: unknown;
  errorText?: unknown;
}

const sizeOf = (v: unknown): number =>
  v === undefined || v === null ? 0 : typeof v === "string" ? v.length : (JSON.stringify(v)?.length ?? 0);

/**
 * Whether a conversation holds enough to summarize, counted as the runtime counts it, about four characters a
 * token: the words, the reasoning and the tool calls since the person last asked to summarize must come to more
 * than a summarize keeps as it was, or the runtime would find nothing earlier to summarize. `since` says where
 * the count began.
 */
export function summarizable(
  history: { messages?: readonly unknown[] },
  keep: number,
): { enough: boolean; since: "start" | "summary" } {
  const messages = history.messages ?? [];
  let from = 0;
  for (let i = 0; i < messages.length; i++) if (isSummarizeMark(messages[i])) from = i + 1;
  let chars = 0;
  for (const message of messages.slice(from)) {
    const m = message as { role?: unknown; parts?: CountedPart[] } | null;
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    for (const p of m.parts ?? []) {
      if (p.type === "text" || p.type === "reasoning") chars += sizeOf(p.text);
      else if (p.type === "dynamic-tool") chars += sizeOf(p.input) + sizeOf(p.output) + sizeOf(p.errorText);
    }
  }
  return { enough: Math.ceil(chars / 4) > keep, since: from > 0 ? "summary" : "start" };
}
