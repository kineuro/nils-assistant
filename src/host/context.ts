// SPDX-License-Identifier: AGPL-3.0-only
// How full each conversation's context is (the chat, slice 3), from the
// runtime's own events in this process: after every model turn of a
// conversation, the tokens its context held and its model's window; after
// every summary of its earlier turns, one more compaction. The desk reads it
// with the conversation and shows it as a meter and a note.

import type { Lineage } from "./lineage.ts";
import { limitsOf } from "./models.ts";

interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  total?: number;
}

/** The tokens a turn's context held: the runtime's total when it gives one, else the sum of its parts. */
export function tokensOf(u: Usage | undefined): number | null {
  if (!u) return null;
  const total =
    typeof u.totalTokens === "number" && u.totalTokens > 0
      ? u.totalTokens
      : typeof u.total === "number" && u.total > 0
        ? u.total
        : 0;
  if (total > 0) return total;
  const sum = (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
  return sum > 0 ? sum : null;
}

export type Observe = (
  subscriber: (event: Record<string, unknown>, ctx: { id?: string }) => void,
) => () => void;

/** Keep each conversation's context in the registry from the runtime's events; returns the unsubscribe. */
export function watchContext(o: { observe: Observe; lineage: () => Lineage }): () => void {
  return o.observe((event, ctx) => {
    const id = typeof event.instanceId === "string" && event.instanceId ? event.instanceId : ctx?.id;
    if (!id) return;
    if (event.type === "turn" && event.purpose === "agent" && event.isError !== true) {
      const tokens = tokensOf((event.response as { usage?: Usage } | undefined)?.usage);
      if (tokens === null) return;
      const model = (event.request as { requestedModel?: unknown } | undefined)?.requestedModel;
      const window = typeof model === "string" ? (limitsOf(model)?.contextWindow ?? null) : null;
      o.lineage().noteContext(id, tokens, window);
    } else if (event.type === "compaction" && event.isError !== true) {
      o.lineage().noteCompaction(id);
    }
  });
}
