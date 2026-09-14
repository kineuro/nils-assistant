// SPDX-License-Identifier: AGPL-3.0-only
// The chat, slice 12: a card, a cohort or a result named in a person's words,
// read plainly for an export and for the model's title, and explained to every
// station.

import { describe, expect, it } from "vitest";
import { markdownOf } from "../src/host/export.ts";
import { MENTION_RULE, plainMentions } from "../src/host/mentions.ts";
import { nameConversation } from "../src/host/titles.ts";

const words =
  "How many in @[MS cohort](cohort:MS%20cohort) match @[T1 series \\[2024\\]](result:45) and @[Women](card:12)?";

describe("a mention in a person's words", () => {
  it("reads as its name, and with what it names when asked", () => {
    expect(plainMentions(words)).toBe("How many in MS cohort match T1 series [2024] and Women?");
    expect(plainMentions(words, { kinds: true })).toBe(
      "How many in MS cohort (cohort) match T1 series [2024] (result 45) and Women (card 12)?",
    );
    expect(plainMentions("mail anna@example.org about [a link](https://example.org)")).toBe(
      "mail anna@example.org about [a link](https://example.org)",
    );
    expect(MENTION_RULE).toContain("@[name](card:12)");
  });

  it("is written plainly in an export, and the model names a conversation from the names alone", async () => {
    const md = markdownOf({
      title: "Cohort counts",
      station: "concierge",
      at: "2026-09-14T08:00:00Z",
      snapshot: { v: 1, messages: [{ id: "u1", role: "user", text: words, steps: [], proposals: [] }] },
    });
    expect(md).toContain(
      "How many in MS cohort (cohort) match T1 series [2024] (result 45) and Women (card 12)?",
    );
    expect(md).not.toContain("@[");
    let asked = "";
    const title = await nameConversation(words, async (_instructions, message) => {
      asked = message;
      return "Cohort and series counts";
    });
    expect(asked).toBe("How many in MS cohort match T1 series [2024] and Women?");
    expect(title).toBe("Cohort and series counts");
  });
});
