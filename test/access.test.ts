// SPDX-License-Identifier: AGPL-3.0-only
// The chat, slice 1: one key per person, and conversations that are their
// owner's. A token names a person once; a stranger reads, posts, aborts and
// pushes a token to someone else's conversation as if it did not exist; a
// conversation opened before owners were kept is claimed by the person its
// subject named; a person's list keeps the pinned first and the deleted out;
// notes and plans written under the bare sub become the principal's; and the
// decisions of a conversation outlive the process that heard them.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { doorOf, guard, personIn } from "../src/host/access.ts";
import { EVERYTHING, SETS } from "../src/host/grants.ts";
import { LadderStore } from "../src/host/ladder-store.ts";
import { Lineage } from "../src/host/lineage.ts";
import { Notes } from "../src/host/notes.ts";
import { bareOf, People, type Person } from "../src/host/people.ts";

function engine(names: Record<string, string>) {
  const calls: (string | null)[] = [];
  const read = async (token: string | null) => {
    calls.push(token);
    const principal = token ? names[token] : undefined;
    return principal ? { principal, roles: ["reader"], policy: [] } : null;
  };
  return { calls, read };
}

describe("a person", () => {
  it("is named by the engine once per token, and a token it does not know names no one", async () => {
    let now = 1_000_000;
    const e = engine({ "t-anna": "anna@lab" });
    const people = new People(e.read, () => now);
    expect((await people.of("t-anna"))?.principal).toBe("anna@lab");
    expect((await people.of("t-anna"))?.roles).toEqual(["reader"]);
    expect(await people.of("t-unknown")).toBeNull();
    expect(e.calls).toEqual(["t-anna", "t-unknown"]);
    now += 5 * 60_000 + 1;
    await people.of("t-anna");
    expect(e.calls).toEqual(["t-anna", "t-unknown", "t-anna"]);
    // a token that expires sooner is asked about again once it has
    const exp = Math.floor(now / 1000) + 10;
    const jwt = `x.${Buffer.from(JSON.stringify({ sub: "ben", exp })).toString("base64url")}.y`;
    const e2 = engine({ [jwt]: "ben@lab" });
    const people2 = new People(e2.read, () => now);
    await people2.of(jwt);
    now += 11_000;
    await people2.of(jwt);
    expect(e2.calls).toHaveLength(2);
    expect(bareOf("anna@lab")).toBe("anna");
    expect(bareOf("anna@lab@node")).toBe("anna@lab");
  });

  it("holds the grants and detail the engine gives, or an older engine's roles and entitlements as their sets", async () => {
    const of = (doc: Record<string, unknown>) =>
      new People(async () => ({ principal: "anna@lab", ...doc })).of("t-anna");
    // grants and detail as the engine says them, a work grant with its see; its roles are not read beside them
    expect(
      await of({
        grants: ["assistant:use", "review:work", "coffee:work"],
        detail: "quasi",
        roles: ["admin"],
      }),
    ).toMatchObject({ grants: ["assistant:use", "review:see", "review:work"], detail: "quasi" });
    expect(await of({ detail: "sensitive" })).toMatchObject({ grants: [], detail: "sensitive" });
    expect(await of({ grants: ["query:see"], detail: "everything" })).toMatchObject({ detail: "plain" });
    // an engine that sends neither: each ladder name stands for its set, and assist for the assistant
    expect(await of({ roles: ["reader", "reviewer"], entitlements: ["reviewer", "assist"] })).toMatchObject({
      grants: [...SETS.reviewer.grants, "assistant:use"].sort(),
      detail: "quasi",
    });
    expect(await of({ roles: ["reader", "reviewer", "operator", "admin"] })).toMatchObject({
      grants: SETS.admin.grants,
      detail: "sensitive",
    });
    expect(await of({ roles: [] })).toMatchObject({ grants: [], detail: "plain" });
    // an engine serving with its authentication off gives everything
    expect(await of({ auth: "off", roles: ["reader"] })).toMatchObject({
      grants: EVERYTHING.grants,
      detail: "sensitive",
    });
  });

  it("is asked for by the doors that name a conversation, and only by them", () => {
    expect(doorOf("POST", "/agents/ask-help/c1")).toEqual({ kind: "conversation", id: "c1", opens: true });
    expect(doorOf("GET", "/agents/ask-help/c1")).toEqual({ kind: "conversation", id: "c1", opens: false });
    expect(doorOf("POST", "/agents/ask-help/c1/abort")).toEqual({
      kind: "conversation",
      id: "c1",
      opens: false,
    });
    expect(doorOf("GET", "/agents/ask-help/c1/attachments/a1")).toMatchObject({ id: "c1", opens: false });
    expect(doorOf("POST", "/conversations/c1/token")).toEqual({
      kind: "conversation",
      id: "c1",
      opens: true,
      tokenInBody: true,
    });
    expect(doorOf("POST", "/conversations/c1/feedback")).toMatchObject({ id: "c1", opens: false });
    expect(doorOf("PATCH", "/conversations/c1")).toMatchObject({ id: "c1", opens: false });
    expect(doorOf("GET", "/ledger/c1")).toMatchObject({ id: "c1", opens: false });
    expect(doorOf("GET", "/conversations/c1/notes")).toEqual({ kind: "person" });
    expect(doorOf("GET", "/conversations")).toEqual({ kind: "person" });
    expect(doorOf("POST", "/stations/ask-help/runs")).toEqual({ kind: "person" });
    expect(doorOf("GET", "/runs/run-1/verdict")).toEqual({ kind: "person" });
    expect(doorOf("POST", "/notes/institutional")).toEqual({ kind: "person" });
    expect(doorOf("GET", "/notes/institutional")).toEqual({ kind: "open" });
    expect(doorOf("GET", "/capabilities")).toEqual({ kind: "open" });
  });
});

describe("a conversation", () => {
  function host(store: Lineage, authOff = false) {
    const people = new People(engine({ "t-anna": "anna@lab", "t-ben": "ben@lab" }).read);
    const app = new Hono();
    const kept: string[] = [];
    app.use("*", guard({ people, lineage: () => store, authOff: () => authOff }));
    app.post("/agents/:station/:id", (c) => {
      const who = personIn(c.req.raw) as Person;
      store.open({
        id: c.req.param("id"),
        station: c.req.param("station"),
        subject: who.principal,
        owner: who.principal,
      });
      return c.json({ submissionId: "s1" }, 202);
    });
    app.get("/agents/:station/:id", (c) => c.json({ messages: [] }));
    app.all("/agents/:station/:id/abort", (c) => c.json({ aborted: true }));
    app.post("/conversations/:id/token", async (c) => {
      // the guard read the body first, and the door reads it again
      const body = (await c.req.json()) as { token: string };
      kept.push(`${c.req.param("id")}:${body.token}`);
      return c.json({ conversation: c.req.param("id") });
    });
    app.get("/conversations/:id/feedback", (c) => c.json({ accepted: [], rejected: [] }));
    return { app, kept };
  }
  const as = (token: string | null, init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const turn = JSON.stringify({ kind: "user", body: "hi" });
  const push = (token: string) => as(null, { method: "POST", body: JSON.stringify({ token }) });

  it("is its owner's: a stranger reads, posts, aborts and pushes a token as if it were not there", async () => {
    const store = new Lineage(":memory:");
    const { app, kept } = host(store);
    expect(
      (await app.request("/agents/ask-help/c1", as("t-anna", { method: "POST", body: turn }))).status,
    ).toBe(202);
    expect(store.conversation("c1")?.owner).toBe("anna@lab");
    expect((await app.request("/agents/ask-help/c1", as("t-anna"))).status).toBe(200);
    for (const [path, init] of [
      ["/agents/ask-help/c1", {}],
      ["/agents/ask-help/c1", { method: "POST", body: turn }],
      ["/agents/ask-help/c1/abort", { method: "POST" }],
      ["/conversations/c1/feedback", {}],
    ] as [string, RequestInit][]) {
      expect((await app.request(path, as("t-ben", init))).status, `${init.method ?? "GET"} ${path}`).toBe(
        404,
      );
    }
    expect((await app.request("/conversations/c1/token", push("t-ben"))).status).toBe(404);
    expect(kept).toEqual([]);
    // the owner's push is kept, and so is a push that names a conversation not yet opened
    expect((await app.request("/conversations/c1/token", push("t-anna"))).status).toBe(200);
    expect((await app.request("/conversations/c2/token", push("t-ben"))).status).toBe(200);
    expect(kept).toEqual(["c1:t-anna", "c2:t-ben"]);
    // no token names no one; an id nobody opened reads as missing
    expect((await app.request("/agents/ask-help/c1", as(null))).status).toBe(401);
    expect((await app.request("/agents/ask-help/c9", as("t-anna"))).status).toBe(404);
    // a deleted conversation is gone for its owner too, and a turn cannot open it again
    store.remove("c1");
    expect((await app.request("/agents/ask-help/c1", as("t-anna"))).status).toBe(404);
    expect(
      (await app.request("/agents/ask-help/c1", as("t-anna", { method: "POST", body: turn }))).status,
    ).toBe(404);
  });

  it("opened before owners were kept is claimed by the person its subject named", async () => {
    const store = new Lineage(":memory:");
    store.open({ id: "old", station: "ask-help", subject: "anna" });
    store.open({ id: "off", station: "ask-help", subject: "anonymous" });
    const { app } = host(store);
    expect((await app.request("/agents/ask-help/old", as("t-ben"))).status).toBe(404);
    expect((await app.request("/agents/ask-help/old", as("t-anna"))).status).toBe(200);
    expect(store.conversation("old")).toMatchObject({ owner: "anna@lab", subject: "anna@lab" });
    // anonymous is nobody's while the engine checks tokens, and the one person's while it does not
    expect((await app.request("/agents/ask-help/off", as("t-anna"))).status).toBe(404);
    const off = host(store, true);
    expect((await off.app.request("/agents/ask-help/off", as("t-anna"))).status).toBe(200);
    expect(store.conversation("off")?.owner).toBe("anna@lab");
  });

  it("of a person are listed pinned first, the archived apart, the deleted never, and searched by title", () => {
    const store = new Lineage(":memory:");
    const one = store.create({ station: "ask-help", owner: "anna@lab", title: "T1w after contrast" });
    const two = store.create({ station: "concierge", owner: "anna@lab" });
    const three = store.create({
      station: "ask-help",
      owner: "anna@lab",
      title: "  sessions   near a relapse ",
    });
    store.create({ station: "ask-help", owner: "ben@lab", title: "not hers" });
    expect(one.id).toMatch(/^c-[0-9a-f]{32}$/u);
    expect(three.title).toBe("sessions near a relapse");
    store.patch(two.id, { pinned: true });
    store.patch(three.id, { archived: true });
    expect(store.mine("anna@lab").map((r) => r.id)).toEqual([two.id, one.id]);
    expect(store.mine("anna@lab", { archived: true }).map((r) => r.id)).toEqual([three.id]);
    expect(store.mine("anna@lab", { q: "contrast" }).map((r) => r.id)).toEqual([one.id]);
    expect(store.mine("anna@lab", { q: "%" })).toEqual([]);
    store.patch(one.id, { title: "renamed" });
    expect(store.conversation(one.id)).toMatchObject({ title: "renamed", title_by: "person" });
    store.remove(one.id);
    expect(store.mine("anna@lab").map((r) => r.id)).toEqual([two.id]);
    expect(store.access(one.id, "anna@lab", { authOff: false })).toBe("none");
  });
});

describe("rows written under an older key", () => {
  it("become the principal's: notes, plans and conversations", () => {
    const notes = new Notes(":memory:");
    notes.add({ subject: "anna", kind: "study", text: "cohort a", station: "ask-help" });
    notes.add({ subject: "anonymous", kind: "study", text: "off mode", station: "ask-help" });
    expect(notes.adopt("anna@lab", { bare: "anna", authOff: false })).toBe(1);
    expect(notes.list("anna@lab").map((n) => n.text)).toEqual(["cohort a"]);
    expect(notes.adopt("anna@lab", { bare: "anna", authOff: true })).toBe(1);
    const ladder = new LadderStore(":memory:");
    ladder.db
      .prepare(
        "INSERT INTO plan (id, conversation, subject, instruction, state, created_at) VALUES ('p1', 'c1', 'anna', 'digest it', 'proposed', 1)",
      )
      .run();
    expect(ladder.confirm("p1", "anna@lab")).toHaveProperty("refused");
    expect(ladder.adopt("anna@lab", { bare: "anna", authOff: false })).toBe(1);
    expect(ladder.confirm("p1", "anna@lab")).toMatchObject({ state: "confirmed" });
    const store = new Lineage(":memory:");
    store.open({ id: "c1", station: "ask-help", subject: "anna" });
    store.open({ id: "c2", station: "ask-help", subject: "ben" });
    expect(store.adopt("anna@lab", { authOff: false })).toBe(1);
    expect(store.mine("anna@lab").map((r) => r.id)).toEqual(["c1"]);
    expect(store.list(0, { principal: "anna@lab", authOff: false })).toEqual([]);
  });
});

describe("a conversation's decisions", () => {
  it("outlive the process that heard them", async () => {
    process.env.ASSISTANT_LINEAGE = ":memory:";
    const { feedbackOf, theLineage } = await import("../src/seam/for.ts");
    const store = theLineage();
    store.open({
      id: "c-restart",
      station: "ask-help",
      subject: "anna@lab",
      owner: "anna@lab",
      lineage: 3,
      document: 3,
    });
    store.proposed({ conversation: "c-restart", document: 9, parent: 3, sentence: "narrow to cohort a" });
    store.decide("c-restart", "accepted", { document: 9 });
    store.proposed({ conversation: "c-restart", document: 10, parent: 9, sentence: "add a T1" });
    store.decide("c-restart", "rejected", { document: 10, why: "the wrong sequence" });
    expect(feedbackOf("c-restart")).toEqual({
      accepted: [{ document: 9, sentence: "narrow to cohort a" }],
      rejected: [{ document: 10, sentence: "add a T1", why: "the wrong sequence" }],
    });
  });
});
