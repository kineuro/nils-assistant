// SPDX-License-Identifier: AGPL-3.0-only
// The chat, slice 7: recall. A person's own conversations are found by the
// words of their titles and of the answer each settled, the closest first;
// never another person's, never a deleted one, and versions once.

import { describe, expect, it } from "vitest";
import { doorOf } from "../src/host/access.ts";
import { type ConversationRow, Lineage } from "../src/host/lineage.ts";

describe("recall across a person's conversations", () => {
  it("finds their own by the words that carry meaning, in titles and in what each settled, the most matched first", () => {
    const store = new Lineage(":memory:");
    const at = (id: string, t: number) =>
      store.db.prepare("UPDATE conversation SET updated_at = ? WHERE id = ?").run(t, id);
    const a = store.create({ station: "ask-help", owner: "anna@desk", title: "Women in cohort A" });
    store.noteGist(a.id, "31 of the 38 subjects in cohort A are women.");
    at(a.id, 1000);
    const b = store.create({ station: "concierge", owner: "anna@desk", title: "Sessions per cohort" });
    store.noteGist(b.id, "Cohort B has 12 subjects and 40 sessions.");
    at(b.id, 2000);
    const others = store.create({ station: "ask-help", owner: "bo@desk", title: "Women in cohort A" });
    store.noteGist(others.id, "Another person's answer about cohort A.");
    const gone = store.create({ station: "ask-help", owner: "anna@desk", title: "cohort A, deleted" });
    store.remove(gone.id);
    expect(store.recall("anna@desk", "cohort").map((r) => r.id)).toEqual([b.id, a.id]);
    expect(store.recall("anna@desk", "cohort women").map((r) => r.id)).toEqual([a.id, b.id]);
    // a question as a person or a model words it: its filler passed over, its words met by their stems
    expect(store.recall("anna@desk", "Which cohorts hold the most women?").map((r) => r.id)).toEqual([
      a.id,
      b.id,
    ]);
    // as many words in each: the latest first
    expect(store.recall("anna@desk", "how many subjects does each cohort hold").map((r) => r.id)).toEqual([
      b.id,
      a.id,
    ]);
    // whole words: "men" is not in "women"
    expect(store.recall("anna@desk", "men")).toEqual([]);
    // two letters count when they name something
    const c = store.create({ station: "query", owner: "anna@desk", title: "T1 series in the MS cohort" });
    at(c.id, 500);
    expect(store.recall("anna@desk", "my MS series").map((r) => r.id)).toEqual([c.id]);
    expect(store.recall("anna@desk", "the t1 ones").map((r) => r.id)).toEqual([c.id]);
    expect(store.recall("anna@desk", "sessions", { except: b.id })).toEqual([]);
    expect(store.recall("anna@desk", "100%_")).toEqual([]);
    expect(store.recall("anna@desk", "   ")).toEqual([]);
    // a gist is one line of at most 240 characters
    store.noteGist(a.id, `  ${"long ".repeat(80)}`);
    expect(store.conversation(a.id)?.gist?.length).toBeLessThanOrEqual(240);
    // the versions of one conversation are found once, as the version used last
    const v = store.branch({
      id: store.newId(),
      source: store.conversation(b.id) as ConversationRow,
      slot: "m1",
      origin: b.id,
      offset: 3,
    });
    at(v.id, 3000);
    expect(store.recall("anna@desk", "sessions").map((r) => r.id)).toEqual([v.id]);
    expect(doorOf("GET", `/conversations/${a.id}/export`)).toEqual({
      kind: "conversation",
      id: a.id,
      opens: false,
    });
  });
});
