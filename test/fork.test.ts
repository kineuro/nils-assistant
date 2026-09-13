// SPDX-License-Identifier: AGPL-3.0-only
// The chat, slice 4: a conversation continued from one of its messages. The
// cut is taken where every turn before it settled, and never at a message
// that joined a running reply; the copy reads what the old conversation read
// up to there, answers on its own, and leaves the old one as it was; and the
// registry keeps the copies made at one message as versions of it, listed
// once, named and deleted together.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { createAgentRouter } from "@flue/runtime/routing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ForkRefused,
  firstUserMessage,
  forkStream,
  incarnation,
  planFork,
  type Rec,
  sqlFor,
  streamPath,
} from "../src/host/fork.ts";
import { type ConversationRow, Lineage } from "../src/host/lineage.ts";
import { fakeProvider } from "./child/fake-provider.ts";
import { Slow } from "./child/slow-agent.ts";

const rec = (type: string, o: Partial<Rec> = {}): Rec => ({ type, ...o });

describe("a fork's cut", () => {
  const batches = [
    { seq: 0, records: [rec("conversation_created")] },
    {
      seq: 1,
      records: [
        rec("user_message", { messageId: "m1", submissionId: "s1", timestamp: 1000 }),
        rec("agent_start_run", { submissionId: "s1", attemptId: "t1" }),
      ],
    },
    {
      seq: 2,
      records: [
        rec("assistant_message_started", { messageId: "a1", submissionId: "s1", attemptId: "t1" }),
        rec("assistant_message_completed", { messageId: "a1", submissionId: "s1", attemptId: "t1" }),
      ],
    },
    {
      seq: 3,
      records: [
        rec("submission_settled", { submissionId: "s1", attemptId: "t1" }),
        rec("user_message", { messageId: "m2", submissionId: "s2", timestamp: 2000 }),
      ],
    },
    {
      seq: 4,
      records: [
        rec("assistant_message_started", { messageId: "a2", submissionId: "s2", attemptId: "t2" }),
        rec("submission_settled", { submissionId: "s2", attemptId: "t2" }),
      ],
    },
  ];

  it("copies what came before a message, dividing the batch it shares with the turn before", () => {
    expect(planFork(batches, "m2")).toEqual({
      whole: 3,
      partial: [batches[3].records[0]],
      cutAt: 2000,
      cutSeq: 3,
      messages: ["m1", "a1"],
    });
    expect(planFork(batches, "m1")).toMatchObject({
      whole: 1,
      partial: null,
      cutAt: 1000,
      cutSeq: 1,
      messages: [],
    });
    expect(planFork(batches)).toMatchObject({
      whole: 5,
      partial: null,
      cutAt: null,
      messages: ["m1", "a1", "m2", "a2"],
    });
  });

  it("is refused at a message it does not know, after a turn that has not settled, and at a message that joined a running reply", () => {
    expect(() => planFork(batches, "nope")).toThrow(ForkRefused);
    const unsettled = batches.map((b) => (b.seq === 3 ? { seq: 3, records: [b.records[1]] } : b));
    expect(() => planFork(unsettled, "m2")).toThrow(/has not settled/u);
    expect(() => planFork(unsettled)).toThrow(/still running/u);
    const joined = [
      ...batches,
      {
        seq: 5,
        records: [
          rec("user_message", { messageId: "m3", submissionId: "s3" }),
          rec("assistant_message_started", { messageId: "a3", submissionId: "s4", attemptId: "t4" }),
          rec("submission_settled", { submissionId: "s3", attemptId: "t4" }),
          rec("submission_settled", { submissionId: "s4", attemptId: "t4" }),
        ],
      },
    ];
    expect(() => planFork(joined, "m3")).toThrow(/joined a reply/u);
    expect(incarnation(0)).toMatch(/^inc_0{10}[0-9A-HJKMNP-TV-Z]{16}$/u);
  });
});

describe("a conversation continued from one of its messages", () => {
  const file = join(mkdtempSync(join(tmpdir(), "fork-")), "assistant.sqlite");
  let flue: Awaited<ReturnType<typeof start>> | null = null;
  beforeAll(async () => {
    process.env.SLOW_MS = "0";
    flue = await start({
      agents: [{ agent: Slow, name: "slow" }],
      db: sqlite(file),
      providers: [fakeProvider()],
    });
  });
  afterAll(async () => {
    await flue?.stop();
  });

  type History = { messages: { id: string; role: string; parts: { type: string; text?: string }[] }[] };
  const history = async (id: string) =>
    (await (await createAgentRouter(Slow).request(`/${id}?view=history`)).json()) as History;
  const said = (h: History, role: string) =>
    h.messages
      .filter((m) => m.role === role)
      .map((m) =>
        m.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join(""),
      );

  it("reads what the old one read up to there, answers on its own, and leaves the old one as it was", async () => {
    const a = init(Slow, { id: "c-a" });
    await a.read(await a.dispatch("first"));
    await a.read(await a.dispatch("second"));
    const second = (await history("c-a")).messages.filter((m) => m.role === "user")[1];
    const sql = sqlFor(file);
    try {
      const plan = await forkStream(sql, {
        from: { agentName: "slow", instanceId: "c-a" },
        to: { agentName: "slow", instanceId: "c-b" },
        before: second.id,
      });
      expect(plan.messages.length).toBeGreaterThan(1);
      const b = init(Slow, { id: "c-b" });
      expect((await b.read(await b.dispatch("second, said again"))).text).toBe("done");
      const branch = await history("c-b");
      expect(said(branch, "user")).toEqual(["first", "second, said again"]);
      expect(said(await history("c-a"), "user")).toEqual(["first", "second"]);
      expect(await firstUserMessage(sql, streamPath("slow", "c-b"), plan.offset)).toBe(
        branch.messages.filter((m) => m.role === "user")[1].id,
      );
      // a copy of the whole conversation carries every turn, and a copy is never made twice under one id
      const copy = {
        from: { agentName: "slow", instanceId: "c-b" },
        to: { agentName: "slow", instanceId: "c-c" },
      };
      await forkStream(sql, copy);
      expect(said(await history("c-c"), "user")).toEqual(["first", "second, said again"]);
      await expect(forkStream(sql, copy)).rejects.toThrow(/exists already/u);
    } finally {
      await sql.close();
    }
  }, 30_000);
});

describe("a conversation's versions", () => {
  const at = (store: Lineage, id: string, updated: number, created: number) =>
    store.db
      .prepare("UPDATE conversation SET updated_at = ?, created_at = ? WHERE id = ?")
      .run(updated, created, id);
  const row = (store: Lineage, id: string) => store.conversation(id) as ConversationRow;

  it("are listed once, as the version used last, and named, pinned and deleted together", () => {
    const store = new Lineage(":memory:");
    const a = store.create({ station: "ask-help", owner: "anna@lab", title: "cohorts" });
    at(store, a.id, 2000, 1000);
    const b = store.branch({
      id: store.newId(),
      source: row(store, a.id),
      slot: "m2",
      origin: a.id,
      offset: 4,
    });
    at(store, b.id, 2000, 3000);
    // made but not sent into yet: the list keeps the first, and nothing can be switched to
    expect(store.mine("anna@lab").map((r) => r.id)).toEqual([a.id]);
    expect(store.unsent(a.id).map((r) => r.id)).toEqual([b.id]);
    expect(store.versions(a.id)).toEqual([]);
    store.setBranchMessage(b.id, "m2b");
    at(store, b.id, 4000, 3000);
    expect(store.mine("anna@lab").map((r) => r.id)).toEqual([b.id]);
    expect(store.versions(a.id)).toEqual([
      {
        slot: "m2",
        versions: [
          { conversation: a.id, message: "m2" },
          { conversation: b.id, message: "m2b" },
        ],
      },
    ]);
    // switched back to the first way: the list shows it from now on
    store.patch(a.id, { current: true });
    expect(store.mine("anna@lab").map((r) => r.id)).toEqual([a.id]);
    // sent again instead of a version's own first message: a third version of the same place
    expect(store.slotOf("m2b")).toEqual({ slot: "m2", origin: a.id });
    expect(store.slotOf("m9")).toEqual({ slot: "m9", origin: null });
    const placed = store.slotOf("m2b");
    const c = store.branch({
      id: store.newId(),
      source: row(store, b.id),
      slot: placed.slot,
      origin: placed.origin,
      offset: 4,
    });
    store.setBranchMessage(c.id, "m2c");
    expect(store.versions(c.id)[0]?.versions.map((v) => v.message)).toEqual(["m2", "m2b", "m2c"]);
    store.patch(c.id, { title: "cohort counts", pinned: true });
    expect(row(store, a.id)).toMatchObject({ title: "cohort counts" });
    expect(row(store, b.id).pinned_at).not.toBeNull();
    store.remove(b.id);
    expect(store.mine("anna@lab")).toEqual([]);
    expect(store.access(a.id, "anna@lab", { authOff: false })).toBe("none");
  });

  it("find where a message was first sent, and a whole copy is a conversation of its own", () => {
    const store = new Lineage(":memory:");
    const a = store.create({ station: "ask-help", owner: "anna@lab", title: "cohorts" });
    const b = store.branch({
      id: store.newId(),
      source: row(store, a.id),
      slot: "m5",
      origin: a.id,
      offset: 10,
    });
    // a message in the copied batches was first sent in the conversation copied; a later one in the version
    expect(store.originOf(row(store, b.id), 3)).toBe(a.id);
    expect(store.originOf(row(store, b.id), 12)).toBe(b.id);
    const copy = store.branch({
      id: store.newId(),
      source: row(store, b.id),
      slot: null,
      origin: null,
      offset: 14,
    });
    expect(row(store, copy.id)).toMatchObject({
      title: "cohorts (continued)",
      forked_from: b.id,
      fork_root: copy.id,
    });
    expect(store.originOf(row(store, copy.id), 3)).toBe(copy.id);
    expect(store.mine("anna@lab").map((r) => r.id)).toContain(copy.id);
  });

  it("carry the page's context, the proposals made before the cut and the verdicts on the answers they carry", () => {
    const store = new Lineage(":memory:");
    const a = store.create({ station: "ask-help", owner: "anna@lab" });
    store.contextPut(a.id, { page: { kind: "assistant", id: null } });
    store.proposed({ conversation: a.id, document: 7, parent: null, sentence: "cohort A" });
    store.proposed({ conversation: a.id, document: 8, parent: 7, sentence: "the women in cohort A" });
    store.db.prepare("UPDATE proposal SET at = CASE document WHEN 7 THEN 1000 ELSE 3000 END").run();
    store.decide(a.id, "accepted", { document: 7 });
    store.rate(a.id, "a1", "up");
    store.rate(a.id, "a2", "down", "wrong cohort");
    const b = store.branch({
      id: store.newId(),
      source: row(store, a.id),
      slot: "m2",
      origin: a.id,
      offset: 3,
    });
    store.copyState(a.id, b.id, { cutAt: 2000, messages: ["m1", "a1"] });
    expect(store.proposals(b.id).map((p) => [p.document, p.decided])).toEqual([[7, "accepted"]]);
    expect(store.ratings(b.id).map((r) => r.message)).toEqual(["a1"]);
    expect(store.contextOf(b.id)).toEqual(store.contextOf(a.id));
  });
});
