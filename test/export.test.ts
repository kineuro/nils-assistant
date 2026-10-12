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

describe("a conversation of the one chat exported (2026-10-12)", () => {
  const replaced = { type: "data-replaced", data: { kind: "replaced" } };
  const asked = {
    type: "data-clarification",
    data: {
      kind: "clarification",
      question: "I can't attach a file here. Which rows did you want?",
      options: [
        { label: "The two failed jobs", count: 2 },
        { label: "All scans in study-a", count: 28 },
        { label: "Something else", count: null },
      ],
    },
  };
  const md = (
    messages: unknown[],
    decisions: { document: number; decided: "accepted" | "rejected" | null }[] = [],
  ) =>
    markdownOf({
      title: "A thread",
      station: "nils",
      at: "2026-10-12T02:00:00Z",
      snapshot: snapshotOf({ messages } as never, decisions),
    });

  it("holds an answer a check sent back once, as its replacement", () => {
    const text = md([
      { id: "u1", role: "user", parts: [{ type: "text", text: "What are magnitude and phase in SyMRI?" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "the person asks" },
          { type: "text", text: "The first draft, which a check sent back." },
          replaced,
          { type: "reasoning", text: "say it again" },
          { type: "text", text: "The answer the person read." },
        ],
      },
    ]);
    expect(text).toMatch(/The answer the person read\./u);
    expect(text).not.toMatch(/first draft/u);
    // a mark with no words after it leaves the words it marked, as the desk does
    const kept = md([
      { id: "u1", role: "user", parts: [{ type: "text", text: "Hello?" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Words that stand." }, replaced] },
    ]);
    expect(kept).toMatch(/Words that stand\./u);
  });

  it("writes a question the turn asked, with its choices, so a turn that asked is never only its steps", () => {
    const text = md([
      { id: "u1", role: "user", parts: [{ type: "text", text: "can you make a csv and upload it here?" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "dynamic-tool", toolName: "ask_user", state: "output-available" }, asked],
      },
    ]);
    expect(text).toContain(
      [
        "*Steps: asked you.*",
        "",
        "I can't attach a file here. Which rows did you want?",
        "",
        "- The two failed jobs (2)",
        "- All scans in study-a (28)",
        "- Something else",
      ].join("\n"),
    );
  });

  it("lists the one chat's question versions once each, with their decisions, and its steps in words", () => {
    const card = {
      type: "data-approval",
      data: {
        kind: "approval",
        id: "c1",
        change: "query_version",
        title: null,
        sentence: "The question as it stands now (document 5).",
        lines: [],
        ref: { document: 5, parent: null },
      },
    };
    const text = md(
      [
        { id: "u1", role: "user", parts: [{ type: "text", text: "Any MEDIC stacks?" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "dynamic-tool", toolName: "activate_skill", state: "output-available" },
            { type: "dynamic-tool", toolName: "query_draft", state: "output-available" },
            { type: "text", text: "None of the 38 stacks, stored as document 5." },
            card,
            card,
          ],
        },
      ],
      [{ document: 5, decided: "accepted" }],
    );
    expect(text).toContain("*Steps: got ready; drafted the query.*");
    expect(text.match(/A new version of the query, document 5/gu)).toHaveLength(1);
    expect(text).toMatch(/document 5: The question as it stands now \(document 5\)\. \(accepted\)/u);
  });
});
