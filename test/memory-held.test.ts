// SPDX-License-Identifier: AGPL-3.0-only
// A conversation's held memory is its owner's alone: a copy continued by someone else reads its own.

import { describe, expect, it } from "vitest";
import { heldFor } from "../src/stations/memory.ts";

describe("a conversation's held memory", () => {
  it("is used only for the person it was taken for", () => {
    const held = { owner: "anna@desk", text: "\n\nWhat you know of this person: study: document 12" };
    expect(heldFor(held, "anna@desk")).toBe(held.text);
    // a share continued by its reader: the reader's own memory is read instead
    expect(heldFor(held, "cy@desk")).toBeNull();
    // a snapshot kept before snapshots named their person is read again once
    expect(heldFor(held.text, "anna@desk")).toBeNull();
    expect(heldFor(null, "anna@desk")).toBeNull();
    expect(heldFor({ owner: "anna@desk" }, "anna@desk")).toBeNull();
  });
});
