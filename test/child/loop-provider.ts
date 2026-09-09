// SPDX-License-Identifier: AGPL-3.0-only
// A fake pi provider for the station tests, registered under a station's
// own provider id: it calls one tool forever, or settles when told.

import type { AssistantMessageEvent, Context } from "@earendil-works/pi-ai";
import { createProvider, type Model, type Provider } from "@earendil-works/pi-ai";

type Api = "openai-completions";

function msg(content: unknown[], stop: "toolUse" | "stop") {
  return {
    role: "assistant" as const,
    content,
    api: "openai-completions" as const,
    provider: "fake",
    model: "m",
    usage: {
      input: 100,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 110,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: stop,
    timestamp: Date.now(),
  };
}

/** `plan(context)` says what the model does next: a tool call, or the final text. */
export function scriptedProvider(
  id: string,
  plan: (
    context: Context,
    calls: number,
  ) => { tool: string; args: Record<string, unknown> } | { text: string },
): Provider<Api> {
  const model: Model<Api> = {
    id: "m",
    name: "fake",
    api: "openai-completions",
    provider: id as never,
    baseUrl: "http://fake.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32768,
    maxTokens: 4096,
  };
  let calls = 0;
  const stream = (_m: Model<Api>, context: Context) => {
    const next = plan(context, calls);
    calls += 1;
    return (async function* (): AsyncGenerator<AssistantMessageEvent> {
      if ("tool" in next) {
        const call = {
          type: "toolCall" as const,
          id: `call_${calls}`,
          name: next.tool,
          arguments: next.args,
        };
        const partial = msg([call], "toolUse");
        yield { type: "start", partial } as never;
        yield { type: "toolcall_start", contentIndex: 0, partial } as never;
        yield { type: "toolcall_end", contentIndex: 0, toolCall: call, partial } as never;
        yield { type: "done", reason: "toolUse", message: partial } as never;
      } else {
        const partial = msg([{ type: "text", text: next.text }], "stop");
        yield { type: "start", partial } as never;
        yield { type: "text_start", contentIndex: 0, partial } as never;
        yield { type: "text_delta", contentIndex: 0, delta: next.text, partial } as never;
        yield { type: "text_end", contentIndex: 0, content: next.text, partial } as never;
        yield { type: "done", reason: "stop", message: partial } as never;
      }
    })();
  };
  return createProvider<Api>({
    id,
    name: id,
    auth: { apiKey: { name: "none", resolve: async () => ({ auth: { apiKey: "x" } }) } },
    models: [model],
    api: { stream: stream as never, streamSimple: stream as never },
  });
}
