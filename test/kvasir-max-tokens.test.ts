// SPDX-License-Identifier: AGPL-3.0-only
// A model call to Kvasir names its longest answer (7b, slice call-cap). Flue's agent loop asks pi for a call with
// no maxTokens of its own, and pi-messages sends only the caller's, so every call of the one agent reached Kvasir
// with none; Kvasir then sent none to the model server, and a thinking model answered for as long as its context
// held (89,972 tokens in 65 minutes on the 27B, 2026-10-16). The provider now asks for the catalog's longest answer
// where the caller names none, kept inside what the context leaves, and keeps a caller's own.

import { normalizeContext } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { kvasirProvider } from "../src/providers/kvasir.ts";

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const events = [
  { type: "start" },
  { type: "text_start", contentIndex: 0 },
  { type: "text_delta", contentIndex: 0, delta: "ok" },
  { type: "text_end", contentIndex: 0, content: "ok" },
  { type: "done", reason: "stop", usage },
];

function rig(contextWindow: number, maxTokens: number) {
  const sent: { maxTokens?: number }[] = [];
  const dial = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    sent.push((JSON.parse(String(init?.body)) as { options: { maxTokens?: number } }).options);
    return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;
  const provider = kvasirProvider({
    station: "nils",
    purpose: "assistant.concierge",
    catalog: {
      baseUrl: "http://kvasir.test/v1/pi",
      models: [
        {
          id: "thinker",
          name: "Thinker",
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow,
          maxTokens,
        },
      ],
    },
    key: "the-app-key",
  });
  return { sent, dial, provider, model: provider.getModels()[0] as never };
}

const context = normalizeContext({
  messages: [{ role: "user" as const, content: "Who am I?", timestamp: 1 }],
});

async function drain(s: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of s) {
    // the body sent is what these tests read
  }
}

describe("a model call to Kvasir", () => {
  it("asks for the catalog's longest answer when the caller names none, as Flue's agent loop does", async () => {
    const r = rig(262_144, 16_384);
    await drain(r.provider.streamSimple(r.model, context, { apiKey: "the-app-key", fetch: r.dial } as never));
    await drain(r.provider.stream(r.model, context, { apiKey: "the-app-key", fetch: r.dial } as never));
    expect(r.sent.map((o) => o.maxTokens)).toEqual([16_384, 16_384]);
  });

  it("keeps the caller's own longest answer", async () => {
    const r = rig(262_144, 16_384);
    await drain(
      r.provider.streamSimple(r.model, context, {
        apiKey: "the-app-key",
        fetch: r.dial,
        maxTokens: 4_096,
      } as never),
    );
    expect(r.sent[0]?.maxTokens).toBe(4_096);
  });

  it("asks for no more than the context leaves", async () => {
    const r = rig(20_000, 65_536);
    await drain(r.provider.streamSimple(r.model, context, { apiKey: "the-app-key", fetch: r.dial } as never));
    const asked = r.sent[0]?.maxTokens ?? 0;
    expect(asked).toBeGreaterThan(0);
    expect(asked).toBeLessThan(20_000);
  });
});
