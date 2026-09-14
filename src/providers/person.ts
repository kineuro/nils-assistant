// SPDX-License-Identifier: AGPL-3.0-only
// Whose conversation a model call streams for (record 23). A person's own
// ChatGPT subscription applies to that person's streams alone, so a call to
// Kvasir carries the person's token beside the app's key. Flue hands a
// provider no conversation, only an affinity key of its own, but it runs every
// model call, a turn's and a compaction's, through the execution interceptors
// with the instance the call belongs to. The interceptor here runs the call
// inside that conversation, and the provider reads it back as it builds the
// call's headers.

import { AsyncLocalStorage } from "node:async_hooks";
import type { FlueExecutionInterceptor, FlueInstrumentation } from "@flue/runtime";

const streaming = new AsyncLocalStorage<string>();

/** The conversation the model call being made belongs to, or null outside one. */
export function streamingConversation(): string | null {
  return streaming.getStore() ?? null;
}

/** Work run as a model call of a conversation: what the interceptor does with each call. */
export function streamFor<T>(conversation: string, work: () => T): T {
  return streaming.run(conversation, work);
}

const interceptor: FlueExecutionInterceptor = (operation, ctx, next) =>
  operation.type === "model" && ctx.instanceId ? streamFor(ctx.instanceId, next) : next();

/** What marks each model call with its conversation, installed with Flue's `instrument` before any agent runs. */
export function personInstrumentation(): FlueInstrumentation {
  return {
    observe: () => {},
    interceptor,
    dispose: () => {},
  };
}
