// SPDX-License-Identifier: AGPL-3.0-only
// Record 23: a model call streams for the person whose conversation it is. Each
// model call is marked with its conversation, a station's provider and the title
// call send that person's token beside the app's key, a station falls back to a
// model Kvasir lists or names its own where Kvasir lists none, and the catalog is
// taken again only when it changes.

import { describe, expect, it } from "vitest";
import { chosenModel, setModels } from "../src/host/models.ts";
import { kvasirTitles } from "../src/host/titles.ts";
import { type Catalog, kvasirProvider, servedCatalog, watchCatalog } from "../src/providers/kvasir.ts";
import { personInstrumentation, streamFor, streamingConversation } from "../src/providers/person.ts";

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
const qwen: Catalog["models"][number] = {
  id: "qwen",
  name: "Qwen",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32768,
  maxTokens: 4096,
  locality: "local",
};
const catalog: Catalog = { baseUrl: "http://kvasir.test/v1", models: [qwen] };

/** A Kvasir that answers every call with a word, and the headers each call came with. */
function kvasir() {
  const seen: { purpose: string | null; person: string | null; auth: string | null }[] = [];
  const dial = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      purpose: headers.get("x-kvasir-purpose"),
      person: headers.get("x-kvasir-person"),
      auth: headers.get("authorization"),
    });
    return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;
  return { seen, dial };
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream) {
    // the words are not what these tests read
  }
}

describe("a model call for a person", () => {
  it("is marked with its conversation, and only a model call of an instance is", async () => {
    const { interceptor } = personInstrumentation();
    const read = async () => streamingConversation();
    expect(await interceptor({ type: "model", turnId: "turn_1" }, { instanceId: "c-anna" }, read)).toBe(
      "c-anna",
    );
    expect(
      await interceptor(
        { type: "tool", toolCallId: "call_1", toolName: "describe" },
        { instanceId: "c-anna" },
        read,
      ),
    ).toBeNull();
    expect(await interceptor({ type: "model", turnId: "turn_2" }, {}, read)).toBeNull();
    expect(streamingConversation()).toBeNull();
  });

  it("carries the person's token beside the app's key and the station's purpose, and none where nobody's is held", async () => {
    const { seen, dial } = kvasir();
    const held = new Map([["c-anna", "anna-token"]]);
    const provider = kvasirProvider({
      station: "concierge",
      purpose: "assistant.concierge",
      catalog,
      key: "the-app-key",
      person: () => {
        const conversation = streamingConversation();
        return conversation ? (held.get(conversation) ?? null) : null;
      },
    });
    const model = provider.getModels()[0];
    const context = { messages: [{ role: "user" as const, content: "How many subjects?", timestamp: 1 }] };
    const options = { apiKey: "the-app-key", fetch: dial } as never;
    await drain(streamFor("c-anna", () => provider.streamSimple(model as never, context, options)));
    await drain(streamFor("c-anna", () => provider.stream(model as never, context, options)));
    await drain(streamFor("c-bo", () => provider.streamSimple(model as never, context, options)));
    await drain(provider.streamSimple(model as never, context, options));
    const app = { purpose: "assistant.concierge", auth: "Bearer the-app-key" };
    expect(seen).toEqual([
      { ...app, person: "anna-token" },
      { ...app, person: "anna-token" },
      { ...app, person: null },
      { ...app, person: null },
    ]);
  });

  it("names a conversation with the token of the person whose conversation it is", async () => {
    const { seen, dial } = kvasir();
    const complete = kvasirTitles({ catalog, model: "qwen", key: "the-app-key", fetch: dial });
    if (!complete) throw new Error("the catalog lists qwen");
    expect(await complete("Name it.", "How many subjects?", "anna-token")).toBe("ok");
    await complete("Name it.", "How many subjects?");
    expect(seen).toEqual([
      { purpose: "assistant.title", person: "anna-token", auth: "Bearer the-app-key" },
      { purpose: "assistant.title", person: null, auth: "Bearer the-app-key" },
    ]);
  });
});

describe("the models Kvasir lists", () => {
  it("give a station the model it names while it is listed, else the first listed, a local one first", () => {
    setModels([
      { id: "remote-a", contextWindow: 200_000, maxTokens: 8192, locality: "remote" },
      { id: "card", contextWindow: 65_536, maxTokens: 8192, locality: "local" },
    ]);
    expect(chosenModel("card")).toBe("card");
    expect(chosenModel("remote-a")).toBe("remote-a");
    expect(chosenModel("qwen38-27b-fast")).toBe("card");
    setModels([]);
    expect(chosenModel("qwen38-27b-fast")).toBe("qwen38-27b-fast");
  });

  it("are Kvasir's own, or where Kvasir lists none, the model the host names under its own name", () => {
    const served = servedCatalog({ ...catalog, models: [] }, "chatgpt");
    expect(served.models.map((m) => [m.id, m.contextWindow, m.maxTokens, m.reasoning])).toEqual([
      ["chatgpt", 128_000, 16_384, false],
    ]);
    expect(servedCatalog(catalog, "chatgpt")).toBe(catalog);
    setModels(served.models);
    expect(chosenModel("chatgpt")).toBe("chatgpt");
  });

  it("are taken again only when they change, and a failed read keeps what the host has and is said once", async () => {
    const said: string[] = [];
    const taken: string[][] = [];
    let next: Catalog | Error = catalog;
    const watch = watchCatalog({
      read: async () => {
        if (next instanceof Error) throw next;
        return next;
      },
      apply: (c) => taken.push(c.models.map((m) => m.id)),
      had: catalog,
      every: 3_600_000,
      say: (line) => said.push(line),
    });
    await watch.tick();
    expect(taken).toEqual([]);
    next = { ...catalog, models: [qwen, { ...qwen, id: "card" }] };
    await watch.tick();
    await watch.tick();
    expect(taken).toEqual([["qwen", "card"]]);
    next = new Error("Kvasir answered 503 to /v1/config");
    await watch.tick();
    await watch.tick();
    expect(said).toEqual(["Kvasir's catalog was not read again: Kvasir answered 503 to /v1/config"]);
    next = { ...catalog, models: [] };
    await watch.tick();
    expect(taken).toEqual([["qwen", "card"], []]);
    watch.stop();
  });
});
