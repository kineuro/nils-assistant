// SPDX-License-Identifier: AGPL-3.0-only
// A station's calls to Kvasir carry the station's purpose. pi's model registry
// merges a model's own headers into a call, never its provider's, so Kvasir filed
// every station's calls under the first purpose of the app's key; the provider
// now puts the purpose into each call itself.

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

describe("a station's calls to Kvasir", () => {
  it("carry the station's purpose, with the headers the call already had and the app's key", async () => {
    const seen: { purpose?: string | null; other?: string | null; auth?: string | null }[] = [];
    const dial = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({
        purpose: headers.get("x-kvasir-purpose"),
        other: headers.get("x-other"),
        auth: headers.get("authorization"),
      });
      return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;
    const provider = kvasirProvider({
      station: "concierge",
      purpose: "assistant.concierge",
      catalog: {
        baseUrl: "http://kvasir.test/v1",
        models: [
          {
            id: "qwen",
            name: "Qwen",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 32768,
            maxTokens: 4096,
          },
        ],
      },
      key: "the-app-key",
    });
    const model = provider.getModels()[0];
    expect(model).toBeDefined();
    const context = { messages: [{ role: "user" as const, content: "How many subjects?", timestamp: 1 }] };
    for await (const _ of provider.streamSimple(model as never, context, {
      apiKey: "the-app-key",
      fetch: dial,
      headers: { "x-other": "kept" },
    } as never)) {
      // what the stream says is not what this test reads
    }
    for await (const _ of provider.stream(model as never, context, {
      apiKey: "the-app-key",
      fetch: dial,
    } as never)) {
      // nor here
    }
    expect(seen).toEqual([
      { purpose: "assistant.concierge", other: "kept", auth: "Bearer the-app-key" },
      { purpose: "assistant.concierge", other: null, auth: "Bearer the-app-key" },
    ]);
  });
});
