// SPDX-License-Identifier: AGPL-3.0-only
// The seam (Wave 4c §9.3, §9.7, §9.16): the grant applied before dialling,
// the ceiling and the actor on every call, the idempotency key from the
// tool call id, the ledger with no content column, the redactor's context
// and store rules, the tokens the desk hands, and the falsifiable form of
// the rule: no module outside the seam imports an HTTP client.

import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Seam, toolResult } from "../src/seam/client.ts";
import { FORBIDDEN, GrantKeeper, operationOf } from "../src/seam/grant.ts";
import { actorHeader, idempotencyKey } from "../src/seam/headers.ts";
import { Ledger } from "../src/seam/ledger.ts";
import {
  admitDocument,
  admitHandle,
  classifyProviderError,
  redactText,
  redactValue,
} from "../src/seam/redactor.ts";
import { Tokens } from "../src/seam/tokens.ts";

const MARKER = "MARKER-19850101-1234-0000";

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** A fake engine that records every request and answers by path. */
async function fakeEngine() {
  const seen: { method: string; path: string; headers: Record<string, string>; body: string }[] = [];
  const server: Server = createServer(async (req, res) => {
    const text = await body(req);
    seen.push({
      method: req.method ?? "",
      path: req.url ?? "",
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
      body: text,
    });
    const json = (status: number, o: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    if (req.url === "/api/ask/describe")
      return json(200, { sets: [["scope", "scope: cohorts."]], conventions: [] });
    if (req.url === "/api/ask/handles/9")
      return json(200, {
        id: 9,
        disclosure: "local, projecting identifying",
        suppression: { classes: ["identifying"] },
        rows: [[MARKER]],
      });
    if (req.url === "/api/ask/handles/7")
      return json(200, { id: 7, disclosure: "local", suppression: { classes: [] } });
    if (req.url === "/api/ask/run")
      return json(200, {
        handle: 7,
        hash: "h",
        row_count: 1,
        disclosure: "local",
        suppression: { classes: [] },
      });
    if (req.url === "/api/ask/apply") return json(409, { error: "stale_options" });
    return json(404, { error: "no door" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address() as { port: number };
  return { url: `http://127.0.0.1:${a.port}`, seen, server };
}

const closers: (() => void)[] = [];
afterAll(() => {
  for (const c of closers) c();
});

function ledger() {
  const dir = mkdtempSync(join(tmpdir(), "seam-"));
  return { ledger: new Ledger(join(dir, "seam.sqlite")), dir };
}

describe("the grant", () => {
  it("names operations the way the manifest does, and refuses every decision apply verb", () => {
    expect(operationOf("GET", "/api/ask/catalog/session")).toBe("catalog/{level}");
    expect(operationOf("GET", "/api/ask/catalog/stack/echo_time/values?limit=3")).toBe(
      "catalog/{level}/{field}/values",
    );
    expect(operationOf("GET", "/api/ask/handles/77/rows?page=1")).toBe("handles/{id}/rows");
    expect(operationOf("POST", "/api/ask/apply")).toBe("apply");
    expect(operationOf("POST", "/api/review/12/apply")).toBe("review/{id}/apply");
    for (const f of FORBIDDEN) expect(() => new GrantKeeper({ [f]: {} })).toThrow(/a person's/u);
    const k = new GrantKeeper({ describe: { calls: 1 }, "handles/{id}/rows": { rows: 50 } });
    expect(k.decide("POST", "/api/ask/describe").allowed).toBe(true);
    expect(k.decide("POST", "/api/ask/describe")).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/cap is 1/u),
    });
    expect(k.decide("GET", "/api/ask/handles/1/rows", 200)).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/cap is 50/u),
    });
    expect(k.decide("POST", "/api/ask/run")).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/not in this station's grant/u),
    });
  });
});

describe("the headers and the key", () => {
  it("shape the actor as the contract fixes it and derive the key from the tool call", () => {
    expect(
      JSON.parse(
        actorHeader({ kind: "agent", name: "ask-help", model: "m", version: "1", conversation: "c1" }),
      ),
    ).toEqual({ kind: "agent", name: "ask-help", model: "m", version: "1", conversation: "c1" });
    expect(idempotencyKey("call_1", "run")).toBe(idempotencyKey("call_1", "run"));
    expect(idempotencyKey("call_1", "run")).not.toBe(idempotencyKey("call_1", "apply"));
    expect(idempotencyKey("call_1", "run")).toHaveLength(48);
  });
});

describe("the redactor", () => {
  it("refuses a document that projects identifiers and a handle above the class, and scrubs a store write", () => {
    expect(admitDocument({ out: { identifiers: ["patient-id"] } }, "rows")).toMatchObject({ ok: false });
    expect(admitDocument({ out: { identifiers: ["patient-id"] } }, "identifiers")).toEqual({ ok: true });
    expect(admitHandle({ suppression: { classes: ["identifying"] } }, "rows")).toMatchObject({ ok: false });
    expect(admitHandle({ suppression: { classes: ["quasi_identifying"] } }, "rows")).toEqual({ ok: true });
    expect(admitHandle({ suppression: { classes: ["quasi_identifying"] } }, "catalog")).toMatchObject({
      ok: false,
    });
    expect(redactText("born 19850101-1234, uid 1.2.840.113619.2.55.3.2831, code 123456789")).toBe(
      "born [personal number], uid [uid], code [digits]",
    );
    expect(redactText("id 198501011234")).toBe("id [personal number]");
    expect(redactValue({ a: ["x 19850101-1234"], b: 7 })).toEqual({ a: ["x [personal number]"], b: 7 });
    expect(classifyProviderError(401, "")).toBe("token_unavailable");
    expect(classifyProviderError(400, "")).toBe("provider_refused");
    expect(classifyProviderError(502, "")).toBe("provider_error");
  });
});

describe("the tokens", () => {
  it("are held per conversation, expire by their exp claim, and are listed for the push", () => {
    const t = new Tokens();
    const exp = Math.floor(Date.now() / 1000) + 600;
    const jwt = `x.${Buffer.from(JSON.stringify({ sub: "anna", exp })).toString("base64url")}.y`;
    t.put("c1", jwt);
    expect(t.get("c1")).toBe(jwt);
    expect(t.get("c1", exp + 1)).toBeNull();
    expect(t.expiring(900)).toEqual(["c1"]);
    expect(t.expiring(60)).toEqual([]);
    t.put("c2", "opaque-token");
    expect(t.get("c2")).toBe("opaque-token");
    t.forget("c1");
    expect(t.get("c1")).toBeNull();
  });
});

describe("the seam", () => {
  it("dials with the ceiling, the actor and the key, applies the grant first, and writes the ledger", async () => {
    const e = await fakeEngine();
    closers.push(() => e.server.close());
    const { ledger: l } = ledger();
    const seam = new Seam({
      engine: e.url,
      station: {
        id: "ask-help",
        version: "1",
        grant: { describe: { calls: 2 }, run: {}, "handles/{id}": {}, apply: {} },
        ceiling: "reviewer",
        content: "rows",
        model: "qwen",
      },
      conversation: "conv-1",
      token: () => "the-persons-token",
      ledger: l,
    });
    const ok = await seam.call({
      method: "POST",
      path: "/api/ask/describe",
      body: { document_id: 1 },
      toolCallId: "call_1",
      phase: "shape",
    });
    expect(ok.kind).toBe("ok");
    expect(e.seen[0].headers.authorization).toBe("Bearer the-persons-token");
    expect(e.seen[0].headers["x-nils-ceiling"]).toBe("reviewer");
    expect(JSON.parse(e.seen[0].headers["x-nils-actor"])).toMatchObject({
      kind: "agent",
      name: "ask-help",
      conversation: "conv-1",
    });
    expect(e.seen[0].headers["idempotency-key"]).toBeUndefined();
    const ran = await seam.call({
      method: "POST",
      path: "/api/ask/run",
      body: { document_id: 1 },
      toolCallId: "call_2",
      phase: "check",
    });
    expect(ran.kind).toBe("ok");
    expect(e.seen[1].headers["idempotency-key"]).toBe(idempotencyKey("call_2", "run"));
    const refused = await seam.call({
      method: "POST",
      path: "/api/ask/apply",
      body: { document_id: 1 },
      toolCallId: "call_3",
      phase: "refine",
    });
    expect(refused).toMatchObject({ kind: "refused", status: 409 });
    const blocked = await seam.call({
      method: "GET",
      path: "/api/ask/options",
      toolCallId: "call_4",
      phase: "refine",
    });
    expect(blocked).toMatchObject({ kind: "blocked", operation: "options" });
    expect(toolResult(blocked).output).toMatchObject({ blocked: true });
    expect(e.seen).toHaveLength(3);
    const rows = l.rows("conv-1");
    expect(rows.map((r) => [r.operation, r.outcome, r.granted])).toEqual([
      ["options", "blocked", false],
      ["apply", "refused", true],
      ["run", "ok", true],
      ["describe", "ok", true],
    ]);
    expect(rows.find((r) => r.operation === "run")?.handle).toBe(7);
    expect(l.columns()).not.toContain("body");
    for (const c of l.columns()) expect(c).not.toMatch(/content|prompt|message|body|text|token|argument$/u);
    expect(l.hadOutcome("conv-1", "refused")).toBe(true);
    expect(seam.counts).toEqual({ describe: 1, run: 1, apply: 1 });
  });

  it("refuses a handle above the station's class before the model sees it, so a seeded marker reaches no store", async () => {
    const e = await fakeEngine();
    closers.push(() => e.server.close());
    const { ledger: l, dir } = ledger();
    const seam = new Seam({
      engine: e.url,
      station: {
        id: "ask-help",
        version: "1",
        grant: { "handles/{id}": {} },
        ceiling: "reviewer",
        content: "rows",
        model: "qwen",
      },
      conversation: "conv-2",
      token: () => "t",
      ledger: l,
    });
    const above = await seam.call({
      method: "GET",
      path: "/api/ask/handles/9",
      toolCallId: "call_1",
      phase: "check",
    });
    expect(above).toMatchObject({
      kind: "blocked",
      reason: expect.stringMatching(/identifiers fields, above/u),
    });
    expect(JSON.stringify(toolResult(above))).not.toContain(MARKER);
    const within = await seam.call({
      method: "GET",
      path: "/api/ask/handles/7",
      toolCallId: "call_2",
      phase: "check",
    });
    expect(within.kind).toBe("ok");
    const dump = readFileSync(join(dir, "seam.sqlite"));
    expect(dump.includes(MARKER)).toBe(false);
    const withoutToken = new Seam({
      engine: e.url,
      station: {
        id: "s",
        version: "1",
        grant: { describe: {} },
        ceiling: "reader",
        content: "catalog",
        model: "m",
      },
      conversation: "c3",
      token: () => null,
      ledger: l,
    });
    expect(
      await withoutToken.call({
        method: "POST",
        path: "/api/ask/describe",
        body: {},
        toolCallId: "x",
        phase: "p",
      }),
    ).toEqual({ kind: "error", reason: "token_unavailable" });
  });

  it("is the only module that dials: nothing else under src imports an HTTP client", () => {
    const root = join(import.meta.dirname, "..", "src");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) files.push(p);
      }
    };
    walk(root);
    const dials = files.filter((f) =>
      /\bfetch\(|from "node:http"|from "node:https"|from "undici"/u.test(readFileSync(f, "utf8")),
    );
    const allowed = [join(root, "seam", "client.ts"), join(root, "providers", "kvasir.ts")];
    expect(dials.filter((f) => !allowed.includes(f))).toEqual([]);
  });
});
