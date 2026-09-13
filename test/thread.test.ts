// SPDX-License-Identifier: AGPL-3.0-only
// The chat, slice 4: the thread. The owner's verdict on an answer is kept with
// the conversation, changed or taken back, swept with it, and posted through
// the door that names the conversation, which only its owner passes.

import { describe, expect, it } from "vitest";
import { doorOf } from "../src/host/access.ts";
import { Lineage } from "../src/host/lineage.ts";

describe("an answer's verdict", () => {
  it("is kept per answer, changed, taken back, and swept with the conversation", () => {
    const store = new Lineage(":memory:");
    const c = store.create({ station: "ask-help", owner: "anna@lab" });
    expect(store.rate(c.id, "m-2", "down", `  ${"too long ".repeat(80)}`)).toMatchObject({
      message: "m-2",
      verdict: "down",
    });
    expect(store.ratings(c.id)[0]?.reason?.length).toBe(500);
    store.rate(c.id, "m-2", "up", "   ");
    store.rate(c.id, "m-4", "down", "wrong cohort");
    expect(store.ratings(c.id).map((r) => [r.message, r.verdict, r.reason])).toEqual([
      ["m-2", "up", null],
      ["m-4", "down", "wrong cohort"],
    ]);
    expect(store.rate(c.id, "m-4", null)).toBeNull();
    expect(store.ratings(c.id).map((r) => r.message)).toEqual(["m-2"]);
    store.sweep(-1);
    expect(store.ratings(c.id)).toEqual([]);
  });

  it("is posted through the door that names the conversation", () => {
    expect(doorOf("POST", "/conversations/c-1/ratings")).toEqual({
      kind: "conversation",
      id: "c-1",
      opens: false,
    });
  });
});
