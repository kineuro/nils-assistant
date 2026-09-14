// SPDX-License-Identifier: AGPL-3.0-only
// The chat, slice 5: sharing a conversation. The most a conversation could
// read is kept from its turns and its delegates; a share's snapshot holds the
// words, the steps by name and the proposals, never a tool's input or output;
// one share per conversation, read by its audience, revoked with its
// snapshot, and gone with the conversation.

import { describe, expect, it } from "vitest";
import { doorOf } from "../src/host/access.ts";
import { Lineage } from "../src/host/lineage.ts";
import {
  guards,
  maxRole,
  mayRead,
  minRole,
  principalFor,
  type Snapshot,
  snapshotOf,
  topRole,
} from "../src/host/shares.ts";

describe("the most a conversation could read", () => {
  it("is the lower of the person's highest role and the station's ceiling, kept at its highest", () => {
    expect(topRole(["reader", "operator", "assist"])).toBe("operator");
    expect(topRole(["assist"])).toBeNull();
    expect(minRole("operator", "reviewer")).toBe("reviewer");
    expect(maxRole("reader", "reviewer")).toBe("reviewer");
    const store = new Lineage(":memory:");
    const c = store.create({ station: "concierge", owner: "anna@desk" });
    expect(store.conversation(c.id)).toMatchObject({ reach: null, reach_complete: 1 });
    store.noteReach(c.id, "operator", "reader");
    expect(store.conversation(c.id)?.reach).toBe("reader");
    // a delegate with a higher ceiling raises it, and a later turn with a lower one does not lower it
    store.noteReach(c.id, "operator", "reviewer");
    store.noteReach(c.id, "operator", "reader");
    expect(store.conversation(c.id)).toMatchObject({ reach: "reviewer", role_top: "operator" });
    // a person the host could not name counts as reaching the station's ceiling
    const d = store.create({ station: "ask-help", owner: "anna@desk" });
    store.noteReach(d.id, null, "reviewer");
    expect(store.conversation(d.id)?.reach).toBe("reviewer");
    expect(guards("reader")).toBeNull();
    expect(guards("reviewer")?.class).toBe("quasi_identifying");
    expect(guards("admin")?.class).toBe("sensitive");
    expect(mayRead(["reader", "reviewer"], "reviewer")).toBe(true);
    expect(mayRead(["reader", "assist"], "reviewer")).toBe(false);
    expect(mayRead([], "reader")).toBe(false);
    expect(principalFor("bo", "anna@desk.example:7200")).toBe("bo@desk.example:7200");
  });
});

describe("a share's snapshot", () => {
  it("keeps the words, the steps by name and the proposals with their decisions, and never a tool's input or output", () => {
    const history = {
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "the women in cohort A" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "nils_draft",
              state: "output-available",
              input: { note: "input-kept-out" },
              output: { rows: [["output-kept-out"]] },
            },
            { type: "text", text: "31 of 38 are women." },
            {
              type: "data-move_proposal",
              data: { kind: "move_proposal", document: 12, parent: 7, sentence: "only women" },
            },
          ],
        },
        { id: "s1", role: "system", parts: [{ type: "text", text: "settled" }] },
        { id: "h1", role: "user", display: "hidden", parts: [{ type: "text", text: "a signal" }] },
        { id: "a2", role: "assistant", parts: [] },
      ],
    };
    const snap = snapshotOf(history, [{ document: 12, decided: "accepted" }]);
    expect(snap).toEqual({
      v: 1,
      messages: [
        { id: "u1", role: "user", text: "the women in cohort A", steps: [], proposals: [] },
        {
          id: "a1",
          role: "assistant",
          text: "31 of 38 are women.",
          steps: [{ name: "nils_draft", failed: false }],
          proposals: [{ document: 12, parent: 7, sentence: "only women", decided: "accepted" }],
        },
      ],
    });
    expect(JSON.stringify(snap)).not.toMatch(/kept-out/u);
  });
});

describe("a share", () => {
  it("is one per conversation, updated in place, read by its audience, revoked with its snapshot, and gone with the conversation", () => {
    const store = new Lineage(":memory:");
    const c = store.create({ station: "ask-help", owner: "anna@desk", title: "cohorts" });
    const snapshot: Snapshot = {
      v: 1,
      messages: [{ id: "u1", role: "user", text: "hi", steps: [], proposals: [] }],
    };
    const put = {
      conversation: c.id,
      owner: "anna@desk",
      ownerDisplay: "Anna",
      audience: "people" as const,
      people: [{ principal: "bo@desk", display: "Bo" }],
      reach: "reviewer",
      extent: 4,
      title: "cohorts",
      snapshot,
    };
    const s = store.putShare(put);
    expect(s.id).toMatch(/^s-[0-9a-f]{32}$/u);
    expect(store.inAudience(s, "bo@desk")).toBe(true);
    expect(store.inAudience(s, "cy@desk")).toBe(false);
    expect(store.sharedWith("bo@desk").map((x) => x.id)).toEqual([s.id]);
    expect(store.sharedWith("cy@desk")).toEqual([]);
    expect(store.sharedWith("anna@desk")).toEqual([]);
    // shared again with everyone on the desk: the same share, a newer snapshot
    const again = store.putShare({ ...put, audience: "desk", people: [], extent: 6 });
    expect(again).toMatchObject({ id: s.id, audience: "desk", extent: 6, people: "[]" });
    expect(store.sharedWith("cy@desk").map((x) => x.id)).toEqual([s.id]);
    expect(store.sharedIds("anna@desk").has(c.id)).toBe(true);
    store.noteRead(s.id, "cy@desk", "Cy");
    store.noteRead(s.id, "cy@desk", "Cy");
    expect(store.reads(s.id)).toMatchObject([{ reader: "cy@desk", display: "Cy", count: 2 }]);
    expect(store.revokeShare(c.id)).toBe(true);
    expect(store.share(s.id)).toMatchObject({ snapshot: null });
    expect(store.share(s.id)?.revoked_at).not.toBeNull();
    expect(store.sharesBy("anna@desk")).toEqual([]);
    expect(store.sharedWith("bo@desk")).toEqual([]);
    // shared once more, then the conversation deleted: the share goes with it
    const third = store.putShare(put);
    expect(third.id).not.toBe(s.id);
    store.remove(c.id);
    expect(store.share(third.id)?.revoked_at).not.toBeNull();
    store.sweep(-1);
    expect(store.share(third.id)).toBeNull();
    expect(store.reads(s.id)).toEqual([]);
  });

  it("is kept by its owner's doors and read through the person's own", () => {
    expect(doorOf("PUT", "/conversations/c-1/share")).toEqual({
      kind: "conversation",
      id: "c-1",
      opens: false,
    });
    expect(doorOf("DELETE", "/conversations/c-1/share")).toEqual({
      kind: "conversation",
      id: "c-1",
      opens: false,
    });
    expect(doorOf("GET", "/shares")).toEqual({ kind: "person" });
    expect(doorOf("GET", "/shared")).toEqual({ kind: "person" });
    expect(doorOf("GET", "/shares/s-1")).toEqual({ kind: "person" });
    expect(doorOf("POST", "/shares/s-1/continue")).toEqual({ kind: "person" });
  });
});
