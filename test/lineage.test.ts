// SPDX-License-Identifier: AGPL-3.0-only
// Conversations by lineage, the typed context and stale proposals (Wave 5
// D1): a conversation is keyed by the document's lineage; a proposal names
// the base it was made against and cannot be accepted once the document
// moved; the rail's context admits identifiers, names, counts and codes and
// drops rows; a user turn's extras stay in the host and the runtime gets
// the words.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { Lineage } from "../src/host/lineage.ts";
import { interceptTurn, splitTurn } from "../src/host/turns.ts";
import { admit, renderContext } from "../src/seam/context.ts";

const poison = {
  page: { kind: "handle", id: "71" },
  document_id: 12,
  content_hash: "9f3c2b1a9f3c2b1a",
  chain: [12, 9, 3],
  epoch: 4,
  sets: [{ name: "people", grain: "subject", values: ["S-0001", "S-0002"] }],
  funnel: [{ set: "people", rows: 48 }],
  pack: { name: "mri", version: "0.1.1" },
  handle_id: 71,
  declaration: { scheme: "default", note: "x".repeat(1000), rows: [["S-0001", 3.5]] },
  error_codes: ["scheme_mismatch"],
  job_ids: [7],
  rows: [["S-0001", 3.5, "1961-04-02"]],
  columns: ["subject", "edss", "birth"],
  transcript: "the person said S-0001 has EDSS 3.5",
};

describe("the typed context", () => {
  it("admits identifiers, names, counts and codes, and nothing else", () => {
    const c = admit(poison) as unknown as Record<string, unknown>;
    expect(Object.keys(c).sort()).toEqual(
      [
        "chain",
        "content_hash",
        "declaration",
        "document_id",
        "epoch",
        "error_codes",
        "funnel",
        "handle_id",
        "job_ids",
        "pack",
        "page",
        "sets",
      ].sort(),
    );
    expect(c.sets).toEqual([{ name: "people", grain: "subject" }]);
    expect(c.declaration).toEqual({ scheme: "default" });
    expect(JSON.stringify(c)).not.toContain("S-0001");
    expect(JSON.stringify(c)).not.toContain("1961");
  });
  it("renders one line per item and none of the rows", () => {
    const text = renderContext(admit(poison));
    expect(text).toContain("the open document: 12 (hash 9f3c2b1a9f3c)");
    expect(text).toContain("people (subject)");
    expect(text).toContain("people 48");
    expect(text).toContain("handle 71");
    expect(text).not.toContain("S-0001");
    expect(text).not.toContain("3.5");
    expect(text.split("\n").length).toBeLessThanOrEqual(12);
    expect(renderContext(null)).toBe("");
  });
});

describe("conversations by lineage", () => {
  it("keeps a conversation on its lineage, its proposals with their base, and lists newest first", () => {
    const l = new Lineage(":memory:");
    l.open({ id: "c1", station: "ask-help", subject: "anna", lineage: 3, document: 3 });
    l.contextPut("c1", { page: { kind: "ask", id: "3" }, document_id: 3, content_hash: "abcdef0123456789" });
    const p = l.proposed({ conversation: "c1", document: 9, parent: null, sentence: "narrow to cohort a" });
    expect(p.base_document).toBe(3);
    expect(p.base_hash).toBe("abcdef0123456789");
    expect(l.decide("c1", "accepted", { document: 9, current: 3 })).toEqual({
      ok: true,
      document: 9,
      head: 9,
    });
    expect(l.headOf(3)).toBe(9);
    l.open({ id: "c2", station: "ask-help", subject: "anna", lineage: 3, document: 9 });
    l.proposed({ conversation: "c2", document: 12, parent: 9, sentence: "add a T1" });
    expect(l.decide("c2", "rejected", { document: 12, why: "the wrong sequence" })).toMatchObject({
      ok: true,
    });
    const list = l.list(3);
    expect(list.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(list[0].proposals[0]).toMatchObject({
      document: 12,
      base_document: 9,
      decided: "rejected",
      why: "the wrong sequence",
    });
    expect(list[1].proposals[0]).toMatchObject({ document: 9, decided: "accepted" });
    expect(l.list(99)).toEqual([]);
  });

  it("a proposal on a document that moved reads as stale and cannot be accepted", () => {
    const l = new Lineage(":memory:");
    l.open({ id: "c1", station: "ask-help", subject: "anna", lineage: 3, document: 3 });
    l.proposed({ conversation: "c1", document: 9, parent: null, sentence: "one" });
    // the person clicked meanwhile: the desk is on 10 now
    expect(l.stale("c1", { document: 9, current: 10 })).toEqual({
      ok: false,
      stale: true,
      document: 9,
      base: 3,
      moved_to: 10,
    });
    expect(l.decide("c1", "accepted", { document: 9, current: 10 })).toMatchObject({
      ok: false,
      stale: true,
    });
    expect(l.proposal("c1", 9)?.decided).toBeNull();
    // or another conversation of the lineage moved its head
    l.open({ id: "c2", station: "ask-help", subject: "anna", lineage: 3, document: 3 });
    l.proposed({ conversation: "c2", document: 11, parent: null, sentence: "two" });
    l.decide("c2", "accepted", { document: 11 });
    expect(l.stale("c1", { document: 9 })).toMatchObject({ ok: false, stale: true, base: 3, moved_to: 11 });
    // a rejection is never stale; a proposal made on the head is fine
    expect(l.decide("c1", "rejected", { document: 9, why: "old" })).toMatchObject({ ok: true });
    l.open({ id: "c3", station: "ask-help", subject: "anna", lineage: 3, document: 11 });
    l.proposed({ conversation: "c3", document: 13, parent: 11, sentence: "three" });
    expect(l.decide("c3", "accepted", { document: 13, current: 11 })).toMatchObject({ ok: true, head: 13 });
  });
});

describe("a user turn from the desk", () => {
  it("keeps the context, the document and the lineage in the host and forwards the words", async () => {
    expect(
      splitTurn({
        kind: "user",
        body: "hi",
        context: { page: { kind: "ask", id: null } },
        lineage: 3,
        document: 12,
      }),
    ).toEqual({
      forward: { kind: "user", body: "hi" },
      context: { page: { kind: "ask", id: null } },
      lineage: 3,
      document: 12,
    });
    expect(splitTurn({ kind: "user", body: "hi" })).toEqual({
      forward: { kind: "user", body: "hi" },
      context: undefined,
      lineage: null,
      document: null,
    });
    const seen: unknown[] = [];
    const stub = new Hono();
    stub.post("/:id", async (c) => {
      seen.push({ id: c.req.param("id"), body: await c.req.json(), auth: c.req.header("authorization") });
      return c.json({ submissionId: "s1" }, 202);
    });
    const store = new Lineage(":memory:");
    const handler = interceptTurn({
      routers: new Map([["ask-help", stub]]),
      lineage: () => store,
      subject: () => "anna",
    });
    const app = new Hono();
    app.post("/agents/:station/:id", handler as never);
    const r = await app.request("/agents/ask-help/c9", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer t" },
      body: JSON.stringify({ kind: "user", body: "narrow it", context: poison, lineage: 3, document: 12 }),
    });
    expect(r.status).toBe(202);
    expect(seen).toEqual([{ id: "c9", body: { kind: "user", body: "narrow it" }, auth: "Bearer t" }]);
    expect(store.conversation("c9")).toMatchObject({
      station: "ask-help",
      subject: "anna",
      lineage: 3,
      document: 12,
    });
    expect(store.headOf(3)).toBe(12);
    const kept = store.contextOf("c9");
    expect(kept?.document_id).toBe(12);
    expect(JSON.stringify(kept)).not.toContain("S-0001");
    const missing = await app.request("/agents/nope/c9", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(missing.status).toBe(404);
  });
});
