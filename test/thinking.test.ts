// SPDX-License-Identifier: AGPL-3.0-only
// The chat, slice 9: a model's reasoning never reaches a share or an export as
// its answer, whether its runtime separated it or left it inline, and each
// step's words stay a paragraph apart.

import { describe, expect, it } from "vitest";
import { markdownOf } from "../src/host/export.ts";
import { joinSteps, snapshotOf } from "../src/host/shares.ts";

describe("reasoning kept out of what an answer is", () => {
  it("leaves separated and inline reasoning out of a share's snapshot and an export, and keeps steps apart", () => {
    const snapshot = snapshotOf({
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "How many subjects?" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "reasoning", text: "The runtime separated this." },
            { type: "text", text: "<think>\nAnd left this inline.\n</think>\n\nLet me count." },
            { type: "dynamic-tool", toolName: "nils_describe", state: "output-available" },
            { type: "text", text: "<|channel>thought\nSumming.<channel|>There are 38." },
          ],
        },
      ],
    });
    expect(snapshot.messages[0]?.text).toBe("How many subjects?");
    expect(snapshot.messages[1]?.text).toBe("Let me count.\n\nThere are 38.");
    const md = markdownOf({ title: "Subjects", station: "concierge", at: "2026-09-14T08:00:00Z", snapshot });
    expect(md).not.toMatch(/separated this|left this inline|Summing|think>|channel/u);
    expect(md).toContain("Let me count.\n\nThere are 38.");
  });

  it("joins two steps' words a paragraph apart, whatever space they end with", () => {
    expect(joinSteps("", "b")).toBe("b");
    expect(joinSteps("a", "b")).toBe("a\n\nb");
    expect(joinSteps("a\n", "b")).toBe("a\n\nb");
    expect(joinSteps("a\n\n", "b")).toBe("a\n\nb");
    expect(joinSteps("a", "")).toBe("a");
  });
});
