// SPDX-License-Identifier: AGPL-3.0-only
// The chat, slice 7: a turn that wrote no words answered with the sentence it
// settled on, which a share and an export keep, unless its proposals say it.

import { describe, expect, it } from "vitest";
import { snapshotOf } from "../src/host/shares.ts";

describe("a turn that settled without words", () => {
  it("is kept with the sentence it settled on, unless its proposals already say it", () => {
    const snap = snapshotOf({
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "dynamic-tool", toolName: "search_conversations", state: "output-available" },
            {
              type: "data-status",
              data: { kind: "status", phase: "finish", text: "It was titled Sessions per cohort." },
            },
          ],
        },
        {
          id: "a2",
          role: "assistant",
          parts: [
            { type: "data-status", data: { kind: "status", phase: "finish", text: "only women" } },
            {
              type: "data-move_proposal",
              data: { kind: "move_proposal", document: 12, parent: null, sentence: "only women" },
            },
          ],
        },
      ],
    });
    expect(snap.messages.map((m) => m.text)).toEqual(["It was titled Sessions per cohort.", ""]);
  });
});
