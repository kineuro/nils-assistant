// SPDX-License-Identifier: AGPL-3.0-only
// A fake pi provider for the host tests: answers one tool call, then a final
// sentence, with no network. Shared by the child process and the parent.

import type { AssistantMessageEvent, Context } from "@earendil-works/pi-ai";
import { createProvider, type Model, type Provider } from "@earendil-works/pi-ai";

type Api = "openai-completions";

function message(content: Model<Api>["cost"] extends never ? never : unknown[], stop: "toolUse" | "stop") {
  return {
    role: "assistant" as const,
    content,
    api: "openai-completions" as const,
    provider: "fake",
    model: "m",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: stop,
    timestamp: Date.now(),
  };
}

/** Calls `slow` when it has not been called in the context; otherwise says done. */
export function fakeProvider(): Provider<Api> {
  const model: Model<Api> = {
    id: "m",
    name: "fake",
    api: "openai-completions",
    provider: "fake" as never,
    baseUrl: "http://fake.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 4096,
  };
  const stream = (_m: Model<Api>, context: Context) => {
    const called = context.messages.some(
      (m) =>
        m.role === "toolResult" || (m.role === "assistant" && m.content.some((c) => c.type === "toolCall")),
    );
    return (async function* (): AsyncGenerator<AssistantMessageEvent> {
      if (!called) {
        const call = { type: "toolCall" as const, id: "call_slow", name: "slow", arguments: {} };
        const partial = message([call], "toolUse");
        yield { type: "start", partial } as never;
        yield { type: "toolcall_start", contentIndex: 0, partial } as never;
        yield { type: "toolcall_end", contentIndex: 0, toolCall: call, partial } as never;
        yield { type: "done", reason: "toolUse", message: partial } as never;
      } else {
        const partial = message([{ type: "text", text: "done" }], "stop");
        yield { type: "start", partial } as never;
        yield { type: "text_start", contentIndex: 0, partial } as never;
        yield { type: "text_delta", contentIndex: 0, delta: "done", partial } as never;
        yield { type: "text_end", contentIndex: 0, content: "done", partial } as never;
        yield { type: "done", reason: "stop", message: partial } as never;
      }
    })();
  };
  return createProvider<Api>({
    id: "fake",
    name: "fake",
    auth: { apiKey: { name: "none", resolve: async () => ({ auth: { apiKey: "x" } }) } },
    models: [model],
    api: { stream: stream as never, streamSimple: stream as never },
  });
}
