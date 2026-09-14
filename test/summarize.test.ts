// SPDX-License-Identifier: AGPL-3.0-only
// The chat, slice 11: a conversation summarized when the person asks. The
// summarize signal sets the compaction of its one submission, so the runtime
// summarizes the earlier turns once the short answer is done, where ordinary
// turns of the same conversation left them as they were.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessageEvent, type Context, createProvider, type Model } from "@earendil-works/pi-ai";
import { init, observe, useDelivery, useModel } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { doorOf } from "../src/host/access.ts";
import { capabilities } from "../src/host/capabilities.ts";
import { type Observe, watchContext } from "../src/host/context.ts";
import { Lineage } from "../src/host/lineage.ts";
import { setModels } from "../src/host/models.ts";
import { snapshotOf } from "../src/host/shares.ts";
import {
  isSummarize,
  isSummarizeMark,
  SUMMARIZE_SIGNAL,
  summarizable,
  summarizeCompaction,
} from "../src/host/summarize.ts";

const WINDOW = 32_768;
const nothing = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** A model whose turns fill little of its window, and which writes a summary when the runtime asks for one. */
function quietProvider() {
  const model: Model<"openai-completions"> = {
    id: "q",
    name: "quiet",
    api: "openai-completions",
    provider: "quiet" as never,
    baseUrl: "http://quiet.invalid",
    reasoning: false,
    input: ["text"],
    cost: nothing,
    contextWindow: WINDOW,
    maxTokens: 4_096,
  };
  const reply = (text: string) => ({
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-completions" as const,
    provider: "quiet",
    model: "q",
    usage: {
      input: 40,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 50,
      cost: { ...nothing, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  });
  const stream = (_m: Model<"openai-completions">, context: Context) => {
    const message = (context.systemPrompt ?? "").includes("summarization")
      ? reply("Goal: count the cohorts. Progress: counted.")
      : reply("Noted.");
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
    id: "quiet",
    name: "quiet",
    auth: { apiKey: { name: "none", resolve: async () => ({ auth: { apiKey: "x" } }) } },
    models: [model],
    api: { stream: stream as never, streamSimple: stream as never },
  });
}

/** The lever a station pulls: its ordinary compaction, or the summarize compaction for the submission the signal started. */
function Summarizing() {
  let delivered: unknown = null;
  try {
    delivered = useDelivery();
  } catch {
    delivered = null;
  }
  useModel("quiet/q", {
    compaction: isSummarize(delivered)
      ? summarizeCompaction(WINDOW)
      : { reserveTokens: 1_024, keepRecentTokens: 20_000 },
  });
  return "Answer in one word.";
}

describe("a conversation summarized when the person asks", () => {
  let flue: Awaited<ReturnType<typeof start>> | null = null;
  const stops: (() => void)[] = [];
  beforeAll(async () => {
    flue = await start({
      agents: [{ agent: Summarizing, name: "summarizing" }],
      db: sqlite(join(mkdtempSync(join(tmpdir(), "summarize-")), "a.sqlite")),
      providers: [quietProvider()],
    });
  });
  afterAll(async () => {
    for (const s of stops) s();
    await flue?.stop();
  });

  it("knows the signal, and sets a compaction that summarizes all but the latest turn", () => {
    expect(isSummarize(SUMMARIZE_SIGNAL)).toBe(true);
    expect(isSummarize({ kind: "user", body: "summarize" })).toBe(false);
    expect(isSummarize({ kind: "signal", type: "registry", body: "x" })).toBe(false);
    expect(isSummarize(null)).toBe(false);
    expect(summarizeCompaction(65_536)).toEqual({ reserveTokens: 65_535, keepRecentTokens: 2_000 });
    expect(summarizeCompaction(8_192)).toEqual({ reserveTokens: 8_191, keepRecentTokens: 1_024 });
  });

  it("counts what there is to summarize since the person last asked, as the runtime counts it", () => {
    const said = (id: string, role: string, chars: number) => ({
      id,
      role,
      display: "visible",
      parts: [{ type: "text", text: "x".repeat(chars) }],
    });
    const mark = {
      id: "s1",
      role: "system",
      display: "diagnostic",
      signal: { tagName: "summarize" },
      parts: [{ type: "text", text: SUMMARIZE_SIGNAL.body }],
    };
    expect(summarizable({ messages: [] }, 2_000)).toEqual({ enough: false, since: "start" });
    expect(
      summarizable({ messages: [said("u1", "user", 400), said("a1", "assistant", 4_000)] }, 2_000),
    ).toEqual({
      enough: false,
      since: "start",
    });
    // reasoning and a tool's input and output count as the runtime counts them, about four characters a token
    const long = [
      said("u1", "user", 400),
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "r".repeat(3_000) },
          {
            type: "dynamic-tool",
            toolName: "nils_rows",
            input: { handle: 4 },
            output: { rows: "y".repeat(4_000) },
          },
          { type: "text", text: "z".repeat(1_000) },
        ],
      },
    ];
    expect(summarizable({ messages: long }, 2_000)).toEqual({ enough: true, since: "start" });
    expect(summarizable({ messages: [...long, mark, said("a2", "assistant", 60)] }, 2_000)).toEqual({
      enough: false,
      since: "summary",
    });
    expect(isSummarizeMark(mark)).toBe(true);
    expect(isSummarizeMark({ role: "system", signal: { tagName: "registry" } })).toBe(false);
    expect(isSummarizeMark(null)).toBe(false);
  });

  it("is the owner's door, listed, and leaves the summarize and its one line out of a share and an export", () => {
    expect(doorOf("POST", "/conversations/c1/summarize")).toEqual({
      kind: "conversation",
      id: "c1",
      opens: false,
    });
    expect(
      JSON.stringify(
        capabilities({ version: "test", retentionDays: 30 } as never, [], {
          teaching_open: false,
          conversations: 0,
        }),
      ),
    ).toContain("POST /conversations/{id}/summarize");
    const said = (id: string, role: string, words: string) => ({
      id,
      role,
      display: "visible",
      parts: [{ type: "text", text: words }],
    });
    const mark = {
      id: "s1",
      role: "system",
      display: "diagnostic",
      signal: { tagName: "summarize" },
      parts: [{ type: "text", text: SUMMARIZE_SIGNAL.body }],
    };
    const snapshot = snapshotOf({
      messages: [
        said("u1", "user", "how many cohorts"),
        said("a1", "assistant", "Three."),
        mark,
        said("a2", "assistant", "The earlier conversation is being summarized."),
        said("u2", "user", "and how many subjects"),
        said("a3", "assistant", "Forty."),
      ],
    });
    expect(snapshot.messages.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a3"]);
  });

  it("summarizes the earlier turns on the signal, where ordinary turns left them as they were", async () => {
    setModels([{ id: "q", contextWindow: WINDOW, maxTokens: 4_096 }]);
    const store = new Lineage(":memory:");
    store.open({ id: "c-sum", station: "summarizing", subject: "anna@lab", owner: "anna@lab" });
    stops.push(watchContext({ observe: observe as unknown as Observe, lineage: () => store }));
    const handle = init(Summarizing, { id: "c-sum" });
    for (let i = 0; i < 3; i++)
      await handle.read(await handle.dispatch(`${"a long question about the cohorts ".repeat(200)}${i}`));
    await new Promise((r) => setTimeout(r, 300));
    expect(store.conversation("c-sum")?.compactions ?? 0).toBe(0);
    // a handle takes a message wrapped; the host's door posts it bare, as the runtime's HTTP door takes it
    await handle.read(await handle.dispatch({ message: SUMMARIZE_SIGNAL }));
    const until = Date.now() + 5_000;
    while ((store.conversation("c-sum")?.compactions ?? 0) === 0 && Date.now() < until)
      await new Promise((r) => setTimeout(r, 50));
    expect(store.conversation("c-sum")?.compactions ?? 0).toBe(1);
  }, 30_000);
});
