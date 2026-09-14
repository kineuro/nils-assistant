// SPDX-License-Identifier: AGPL-3.0-only
// A conversation named by the model (the chat, slice 10). The desk names a new
// conversation by the start of its first message; once its first answer has
// settled, the host asks Kvasir's assistant.title purpose for a name of at most
// eight words from that first message alone, since the title purpose is catalog
// class and an answer can hold counts. The name is tidied and must pass the shape
// guard memory uses, so a code, a date or an identifier never becomes a title;
// otherwise the first words stay. A name the person gave always wins.

import type { Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/pi-messages";
import type { Catalog } from "../providers/kvasir.ts";
import { guardMemory } from "./guard.ts";

/**
 * How the host asks Kvasir's assistant.title purpose for a name: the stations' model, the app's key, and room
 * for a short answer after any reasoning; null when Kvasir's catalog does not list the model.
 */
export function kvasirTitles(o: {
  catalog: Catalog;
  model: string;
  key: string;
  fetch?: typeof fetch;
}): ((instructions: string, message: string) => Promise<string>) | null {
  const entry = o.catalog.models.find((m) => m.id === o.model);
  if (!entry) return null;
  const model: Model<"pi-messages"> = {
    id: entry.id,
    name: entry.name,
    api: "pi-messages",
    provider: "kvasir-title" as never,
    baseUrl: o.catalog.baseUrl,
    reasoning: entry.reasoning,
    input: entry.input,
    cost: entry.cost,
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
  };
  const dial = o.fetch ?? fetch;
  // the purpose rides every call, as a station's provider sends its own
  const withPurpose: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("x-kvasir-purpose", "assistant.title");
    return dial(input, { ...init, headers });
  };
  return async (instructions, message) => {
    let text = "";
    const events = streamSimple(
      model,
      { systemPrompt: instructions, messages: [{ role: "user", content: message, timestamp: Date.now() }] },
      { apiKey: o.key, maxTokens: 1024, fetch: withPurpose, signal: AbortSignal.timeout(90_000) },
    );
    for await (const ev of events) {
      if (ev.type === "text_delta") text += ev.delta;
      else if (ev.type === "error")
        throw new Error(ev.error.errorMessage ?? "Kvasir did not name the conversation");
    }
    return text;
  };
}

export const TITLE_INSTRUCTIONS = [
  "Name a conversation for a list of conversations, from the first message someone sent in it.",
  "Answer with the name alone: at most eight words, no quotes and no full stop, in the language of the message.",
  "Say what the message is about. Never write a person's name, a subject code, a date, an identifier or a number taken from the message.",
].join(" ");

const MAX_WORDS = 8;

/** A model's answer as a title: its first line without a label, quotes, emphasis or closing stop, at most eight words; null when nothing is left or the guard refuses it. */
export function titleFromAnswer(answer: string): string | null {
  const line =
    answer
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l !== "") ?? "";
  const bare = line
    .replace(/^(?:title|name)\s*:\s*/iu, "")
    .replace(/^[\s"'“”‘’«»`*_#]+|[\s"'“”‘’«»`*_]+$/gu, "")
    .replace(/[\s.。!?…:;,]+$/u, "")
    .trim();
  const words = bare.split(/\s+/u).filter(Boolean);
  if (words.length === 0) return null;
  const title = words.slice(0, MAX_WORDS).join(" ").slice(0, 120);
  return guardMemory(title).ok ? title : null;
}

/** The model's name for a conversation from its first message, or null when it gives none that may stand. */
export async function nameConversation(
  first: string,
  complete: (instructions: string, message: string) => Promise<string>,
): Promise<string | null> {
  const message = first.trim().slice(0, 2000);
  if (!message) return null;
  return titleFromAnswer(await complete(TITLE_INSTRUCTIONS, message));
}
