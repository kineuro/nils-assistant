// SPDX-License-Identifier: AGPL-3.0-only
// The chat, slice 7: a conversation exported as markdown holds what was said,
// the steps by what they did and the versions proposed, never a tool's data.

import { describe, expect, it } from "vitest";
import { markdownOf, stepWords } from "../src/host/export.ts";
import { snapshotOf } from "../src/host/shares.ts";

describe("a conversation exported as markdown", () => {
  it("writes each turn in order, the steps in words and the proposals with their decisions", () => {
    const snapshot = snapshotOf(
      {
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "The women in cohort A?" }] },
          {
            id: "a1",
            role: "assistant",
            parts: [
              { type: "dynamic-tool", toolName: "nils_draft", state: "output-available" },
              { type: "dynamic-tool", toolName: "nils_preview", state: "output-error" },
              { type: "dynamic-tool", toolName: "settle", state: "output-available" },
              { type: "text", text: "31 of the 38 are **women**." },
              {
                type: "data-move_proposal",
                data: { kind: "move_proposal", document: 12, parent: 7, sentence: "only women" },
              },
            ],
          },
        ],
      },
      [{ document: 12, decided: "accepted" }],
    );
    expect(markdownOf({ title: "Cohort A", station: "ask-help", at: "2026-09-14T10:00:00Z", snapshot })).toBe(
      [
        "# Cohort A",
        "",
        "Exported 2026-09-14, from the ask-help station.",
        "",
        "## You",
        "",
        "The women in cohort A?",
        "",
        "## The assistant",
        "",
        "*Steps: drafted the query; previewed the first rows (it failed).*",
        "",
        "31 of the 38 are **women**.",
        "",
        "- A new version of the query, document 12, from document 7: only women (accepted)",
        "",
      ].join("\n"),
    );
    expect(
      markdownOf({
        title: null,
        station: "concierge",
        at: "2026-09-14T10:00:00Z",
        snapshot: { v: 1, messages: [] },
      }),
    ).toBe("# A conversation\n\nExported 2026-09-14, from the concierge station.\n");
    expect(stepWords("nils_new_door")).toBe("used new door");
  });
});
