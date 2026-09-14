// SPDX-License-Identifier: AGPL-3.0-only
// The chat, slice 10: a conversation named by the model from its first message,
// never with a shape of a person's data, and never over a name the person gave.

import { describe, expect, it } from "vitest";
import { doorOf } from "../src/host/access.ts";
import { type ConversationRow, Lineage } from "../src/host/lineage.ts";
import {
  kvasirTitles,
  nameConversation,
  openingWords,
  TITLE_INSTRUCTIONS,
  titleFromAnswer,
} from "../src/host/titles.ts";

describe("a conversation named by the model", () => {
  it("takes the first line of the model's answer, without a label, quotes or a closing stop, at most eight words", () => {
    expect(titleFromAnswer('"Subjects per cohort."')).toBe("Subjects per cohort");
    expect(titleFromAnswer("Title: Women in cohort A\nand more")).toBe("Women in cohort A");
    expect(titleFromAnswer("**Sessions by scanner and year**")).toBe("Sessions by scanner and year");
    expect(titleFromAnswer("one two three four five six seven eight nine ten")).toBe(
      "one two three four five six seven eight",
    );
    expect(titleFromAnswer("   \n  ")).toBeNull();
  });

  it("never keeps a name shaped like a person's data", () => {
    expect(titleFromAnswer("Sessions of S-0012")).toBeNull();
    expect(titleFromAnswer("Scans from 2024-03-01")).toBeNull();
  });

  it("asks with the first message alone, and names nothing for an empty one", async () => {
    const asked: string[] = [];
    const complete = async (instructions: string, message: string) => {
      asked.push(instructions, message);
      return "Subjects per cohort";
    };
    expect(await nameConversation("  How many subjects does each cohort hold?  ", complete)).toBe(
      "Subjects per cohort",
    );
    expect(asked).toEqual([TITLE_INSTRUCTIONS, "How many subjects does each cohort hold?"]);
    expect(await nameConversation("   ", complete)).toBeNull();
  });

  it("asks Kvasir's title purpose with the app's key, and reads the words it answers", async () => {
    const seen: { url?: string; purpose?: string | null; auth?: string | null; body?: string } = {};
    const usage = {
      input: 1,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 4,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const events = [
      { type: "start" },
      { type: "text_start", contentIndex: 0 },
      { type: "text_delta", contentIndex: 0, delta: "Subjects " },
      { type: "text_delta", contentIndex: 0, delta: "per cohort" },
      { type: "text_end", contentIndex: 0, content: "Subjects per cohort" },
      { type: "done", reason: "stop", usage },
    ];
    const dial = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.url = String(input);
      seen.purpose = headers.get("x-kvasir-purpose");
      seen.auth = headers.get("authorization");
      seen.body = String(init?.body);
      return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;
    const catalog = {
      baseUrl: "http://kvasir.test/v1",
      models: [
        {
          id: "qwen",
          name: "Qwen",
          reasoning: true,
          input: ["text" as const],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32768,
          maxTokens: 4096,
        },
      ],
    };
    const complete = kvasirTitles({ catalog, model: "qwen", key: "the-app-key", fetch: dial });
    expect(complete).not.toBeNull();
    expect(
      await nameConversation(
        "How many subjects does each cohort hold?",
        complete as NonNullable<typeof complete>,
      ),
    ).toBe("Subjects per cohort");
    expect(seen.url).toBe("http://kvasir.test/v1/messages");
    expect(seen.purpose).toBe("assistant.title");
    expect(seen.auth).toBe("Bearer the-app-key");
    expect(seen.body).toContain("How many subjects does each cohort hold?");
    expect(kvasirTitles({ catalog: { ...catalog, models: [] }, model: "qwen", key: "k" })).toBeNull();
  });

  it("replaces only a name made of the first words, on every version, and never a name the person gave", () => {
    const store = new Lineage(":memory:");
    const words = store.create({
      station: "concierge",
      owner: "anna@desk",
      title: "How many subjects does each",
      titleBy: "words",
    });
    expect(words.title_by).toBe("words");
    const version = store.branch({
      id: store.newId(),
      source: store.conversation(words.id) as ConversationRow,
      slot: "m1",
      origin: words.id,
      offset: 2,
    });
    expect(store.setModelTitle(words.id, "Subjects per cohort")?.title).toBe("Subjects per cohort");
    expect(store.conversation(words.id)?.title_by).toBe("model");
    expect(store.conversation(version.id)?.title).toBe("Subjects per cohort");
    // a second naming changes nothing
    expect(store.setModelTitle(words.id, "Something else")?.title).toBe("Subjects per cohort");
    const renamed = store.create({
      station: "concierge",
      owner: "anna@desk",
      title: "first words",
      titleBy: "words",
    });
    store.patch(renamed.id, { title: "My own name" });
    expect(store.setModelTitle(renamed.id, "A model's name")?.title).toBe("My own name");
    expect(store.create({ station: "concierge", owner: "anna@desk", title: "A name I gave" }).title_by).toBe(
      "person",
    );
    expect(doorOf("POST", `/conversations/${words.id}/title`)).toEqual({
      kind: "conversation",
      id: words.id,
      opens: false,
    });
  });
  it("names a conversation from the words of its first message, never from its id", () => {
    expect(
      openingWords({
        messages: [
          { role: "assistant", parts: [{ type: "text", text: "Hello." }] },
          {
            role: "user",
            parts: [
              { type: "text", text: " Which cohorts? " },
              { type: "text", text: "And sizes." },
            ],
          },
        ],
      }),
    ).toBe("Which cohorts? And sizes.");
    expect(openingWords({ messages: [] })).toBeNull();
    expect(openingWords({})).toBeNull();
  });
});
