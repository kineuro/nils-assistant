// SPDX-License-Identifier: AGPL-3.0-only
// The models the gateway lists (the chat, slice 3): each one's context window
// and largest answer, read from Kvasir's catalog at start, and the compaction
// each earns. A conversation is summarized once its context leaves less than a
// reserve of the window: a quarter of it, or less when the summary the runtime
// asks for out of that reserve would not fit the model's largest answer, and
// never less than that largest answer. The latest sixth of the window, at most
// 20,000 tokens, stays word for word.

export interface Limits {
  contextWindow: number;
  maxTokens: number;
}

const known = new Map<string, Limits>();

/** The catalog's models, kept by id; a model with no window stays unknown. */
export function setModels(models: { id: string; contextWindow?: number; maxTokens?: number }[]): void {
  known.clear();
  for (const m of models)
    if (typeof m.contextWindow === "number" && m.contextWindow > 0)
      known.set(m.id, {
        contextWindow: m.contextWindow,
        maxTokens: typeof m.maxTokens === "number" && m.maxTokens > 0 ? m.maxTokens : 0,
      });
}

export function limitsOf(id: string): Limits | null {
  return known.get(id) ?? null;
}

/** Every known model with its limits, for the capabilities. */
export function modelList(): ({ id: string } & Limits)[] {
  return [...known.entries()].map(([id, l]) => ({ id, ...l }));
}

/** The compaction a model earns; none when its window is unknown, which leaves the runtime's own. */
export function compactionFor(
  l: Limits | null,
): { reserveTokens: number; keepRecentTokens: number } | undefined {
  if (!l) return undefined;
  // the runtime asks for a summary of at most four fifths of the reserve
  const summaryFits = l.maxTokens > 0 ? Math.floor(l.maxTokens / 0.8) : Math.floor(l.contextWindow / 4);
  const reserveTokens = Math.max(l.maxTokens, Math.min(Math.floor(l.contextWindow / 4), summaryFits));
  const keepRecentTokens = Math.min(Math.floor(l.contextWindow / 6), 20_000);
  return { reserveTokens, keepRecentTokens };
}
