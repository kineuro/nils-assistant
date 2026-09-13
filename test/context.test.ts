// SPDX-License-Identifier: AGPL-3.0-only
// The chat, slice 3: each model's compaction from its limits, a conversation's
// context kept from the runtime's events, and a tool result too large for the
// window shortened to its shape.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessageEvent, type Context, createProvider, type Model } from "@earendil-works/pi-ai";
import { init, observe, useModel } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Observe, tokensOf, watchContext } from "../src/host/context.ts";
import { Lineage } from "../src/host/lineage.ts";
import { compactionFor, limitsOf, modelList, setModels } from "../src/host/models.ts";
import { shorten } from "../src/seam/client.ts";
import { fakeProvider } from "./child/fake-provider.ts";
import { Slow } from "./child/slow-agent.ts";

describe("a model's compaction", () => {
  it("summarizes before the window fills, with room for the model's largest answer and for its summary", () => {
    setModels([
      { id: "fast", contextWindow: 65_536, maxTokens: 8_192 },
      { id: "long", contextWindow: 65_536, maxTokens: 16_384 },
      { id: "vast", contextWindow: 200_000, maxTokens: 64_000 },
      { id: "nameless" },
    ]);
    expect(compactionFor(limitsOf("fast"))).toEqual({ reserveTokens: 10_240, keepRecentTokens: 10_922 });
    expect(compactionFor(limitsOf("long"))).toEqual({ reserveTokens: 16_384, keepRecentTokens: 10_922 });
    expect(compactionFor(limitsOf("vast"))).toEqual({ reserveTokens: 64_000, keepRecentTokens: 20_000 });
    expect(limitsOf("nameless")).toBeNull();
    expect(compactionFor(null)).toBeUndefined();
    expect(modelList().map((m) => m.id)).toEqual(["fast", "long", "vast"]);
  });
});

describe("a conversation's context", () => {
  it("is kept from the runtime's turns and summaries", () => {
    setModels([{ id: "fast", contextWindow: 65_536, maxTokens: 8_192 }]);
    const store = new Lineage(":memory:");
    store.open({ id: "c1", station: "ask-help", subject: "anna@lab", owner: "anna@lab" });
    let emit: ((event: Record<string, unknown>, ctx: { id?: string }) => void) | null = null;
    const stop = watchContext({
      observe: (s) => {
        emit = s;
        return () => {
          emit = null;
        };
      },
      lineage: () => store,
    });
    const send = (e: Record<string, unknown>) => emit?.(e, { id: "c1" });
    send({
      type: "turn",
      instanceId: "c1",
      purpose: "agent",
      isError: false,
      request: { requestedModel: "fast" },
      response: { usage: { input: 9_000, output: 120, cacheRead: 0, cacheWrite: 0, totalTokens: 9_120 } },
    });
    expect(store.conversation("c1")).toMatchObject({
      context_tokens: 9_120,
      context_window: 65_536,
      compactions: null,
    });
    // a summary's own turn is not the conversation's context, and a failed turn changes nothing
    send({
      type: "turn",
      instanceId: "c1",
      purpose: "compaction",
      isError: false,
      response: { usage: { totalTokens: 50_000 } },
    });
    send({
      type: "turn",
      instanceId: "c1",
      purpose: "agent",
      isError: true,
      response: { usage: { totalTokens: 60_000 } },
    });
    expect(store.conversation("c1")?.context_tokens).toBe(9_120);
    send({
      type: "compaction",
      instanceId: "c1",
      isError: false,
      messagesBefore: 40,
      messagesAfter: 6,
      durationMs: 900,
    });
    send({
      type: "turn",
      instanceId: "c1",
      purpose: "agent",
      isError: false,
      request: { requestedModel: "unknown" },
      response: { usage: { input: 11_000, output: 200 } },
    });
    expect(store.conversation("c1")).toMatchObject({
      context_tokens: 11_200,
      context_window: 65_536,
      compactions: 1,
    });
    expect(store.conversation("c1")?.compacted_at).toEqual(expect.any(Number));
    expect(tokensOf(undefined)).toBeNull();
    expect(tokensOf({ input: 0, output: 0 })).toBeNull();
    stop();
    expect(emit).toBeNull();
  });
});

describe("a tool result", () => {
  it("too large for the window is shortened to its shape, and a small one is left as it is", () => {
    const small = { rows: [[1, "a"]], count: 1 };
    expect(shorten(small)).toBe(small);
    const big = {
      handle: 7,
      rows: Array.from({ length: 5_000 }, (_, i) => ({ id: i, note: "x".repeat(40) })),
    };
    const out = shorten(big) as { handle: number; rows: unknown[] };
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(24_000);
    expect(out.handle).toBe(7);
    expect(out.rows.at(-1)).toMatch(/more items$/u);
    expect(shorten("y".repeat(100_000))).toMatch(/more characters\)$/u);
  });
});

/** A model whose every answer reports a context nearly as large as its window, and which writes a summary when asked for one. */
function fullProvider() {
  const model: Model<"openai-completions"> = {
    id: "b",
    name: "full",
    api: "openai-completions",
    provider: "full" as never,
    baseUrl: "http://full.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_768,
    maxTokens: 4_096,
  };
  const reply = (text: string, tokens: number) => ({
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-completions" as const,
    provider: "full",
    model: "b",
    usage: {
      input: tokens - 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: tokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  });
  const stream = (_m: Model<"openai-completions">, context: Context) => {
    const summarizing = (context.systemPrompt ?? "").includes("summarization");
    const message = summarizing
      ? reply("Goal: count the cohorts. Progress: counted.", 500)
      : reply("done", 30_000);
    const text = message.content[0].text;
    return (async function* (): AsyncGenerator<AssistantMessageEvent> {
      yield { type: "start", partial: message } as never;
      yield { type: "text_start", contentIndex: 0, partial: message } as never;
      yield { type: "text_delta", contentIndex: 0, delta: text, partial: message } as never;
      yield { type: "text_end", contentIndex: 0, content: text, partial: message } as never;
      yield { type: "done", reason: "stop", message } as never;
    })();
  };
  return createProvider<"openai-completions">({
    id: "full",
    name: "full",
    auth: { apiKey: { name: "none", resolve: async () => ({ auth: { apiKey: "x" } }) } },
    models: [model],
    api: { stream: stream as never, streamSimple: stream as never },
  });
}

function Full() {
  useModel("full/b", { compaction: { reserveTokens: 4_096, keepRecentTokens: 200 } });
  return "Answer in one word.";
}

describe("the runtime's own events", () => {
  // one process holds one runtime: both agents and both models share it
  let flue: Awaited<ReturnType<typeof start>> | null = null;
  const stops: (() => void)[] = [];
  beforeAll(async () => {
    process.env.SLOW_MS = "0";
    flue = await start({
      agents: [
        { agent: Slow, name: "slow" },
        { agent: Full, name: "full" },
      ],
      db: sqlite(join(mkdtempSync(join(tmpdir(), "context-")), "a.sqlite")),
      providers: [fakeProvider(), fullProvider()],
    });
  });
  afterAll(async () => {
    for (const s of stops) s();
    await flue?.stop();
  });

  it("put a conversation's context in the registry after a real turn", async () => {
    setModels([{ id: "m", contextWindow: 32_768, maxTokens: 4_096 }]);
    const store = new Lineage(":memory:");
    store.open({ id: "c-real", station: "slow", subject: "anna@lab", owner: "anna@lab" });
    const stop = watchContext({ observe: observe as unknown as Observe, lineage: () => store });
    stops.push(stop);
    const handle = init(Slow, { id: "c-real" });
    expect((await handle.read(await handle.dispatch("go"))).text).toBe("done");
    stop();
    expect(store.conversation("c-real")).toMatchObject({ context_tokens: 2, context_window: 32_768 });
  });

  it("count a summary of earlier turns once the context passes its reserve", async () => {
    setModels([{ id: "b", contextWindow: 32_768, maxTokens: 4_096 }]);
    const store = new Lineage(":memory:");
    store.open({ id: "c-full", station: "full", subject: "anna@lab", owner: "anna@lab" });
    stops.push(watchContext({ observe: observe as unknown as Observe, lineage: () => store }));
    const handle = init(Full, { id: "c-full" });
    for (let i = 0; i < 3; i++)
      await handle.read(await handle.dispatch(`${"a long question about the cohorts ".repeat(80)}${i}`));
    const until = Date.now() + 5_000;
    while ((store.conversation("c-full")?.compactions ?? 0) === 0 && Date.now() < until)
      await new Promise((r) => setTimeout(r, 50));
    expect(store.conversation("c-full")?.compactions ?? 0).toBeGreaterThan(0);
    expect(store.conversation("c-full")?.context_window).toBe(32_768);
  }, 30_000);
});
