// SPDX-License-Identifier: AGPL-3.0-only
// The rater of site participation (Wave 7b step 5): a raters' campaign read blind through a fake engine's
// campaign doors with a fake model server; both items answered, the answers legal on the campaign's own
// vocabulary and translated through its earlier names; a campaign whose why is not blind refused with the reason
// and its lease given back; the status door shows counts and nothing of an item; the registered prompt, schema
// and constraints hash to what the audit runner registers.

import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, describe, expect, it } from "vitest";
import { doorOf, guard } from "../src/host/access.ts";
import { Lineage } from "../src/host/lineage.ts";
import { People } from "../src/host/people.ts";
import { kvasirChat } from "../src/providers/kvasir.ts";
import { mountRaters } from "../src/raters/doors.ts";
import { violations } from "../src/raters/legal.ts";
import { checkPacket, packetFromDoors, Refused } from "../src/raters/packet.ts";
import { composePrompt, extendSchema } from "../src/raters/prompt.ts";
import { CONSTRAINTS_TEXT, PROMPT_V34, REGISTERED_SHA256, SCHEMA_TEXT } from "../src/raters/registered.ts";
import { campaignValue, translate, valueCounts } from "../src/raters/values.ts";
import { Seam } from "../src/seam/client.ts";
import { Ledger } from "../src/seam/ledger.ts";
import { Tokens } from "../src/seam/tokens.ts";
import { type Dialled, stubEngine } from "./child/stub-engine.ts";

const closers: (() => void)[] = [];
afterAll(() => {
  for (const c of closers) c();
});

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** The header text of the fixture: a marker that must never appear in a status, a log line or a count. */
const MARKER = "ZEBRA-MARKER-SERIES";
const AXES = ["provenance", "technique", "modifier", "construct", "base"];

/** The served question: the pack's values with a meaning each, and the earlier names a reader may answer by. */
const QUESTION = {
  axes: AXES,
  values: {
    provenance: ["RawRecon", "Localizer", "SubtractionDerived"],
    technique: ["3D-TSE", "TSE", "MPRAGE", "GRE"],
    modifier: ["FLAIR", "FatSat"],
    construct: ["MIP", "ADC"],
    base: ["T1w", "T2w", "PDw"],
  },
  vocabulary: {
    provenance: {
      RawRecon: { meaning: "an ordinary reconstruction" },
      Localizer: { meaning: "a scout" },
      SubtractionDerived: { meaning: "a subtraction" },
    },
    technique: {
      "3D-TSE": { meaning: "a 3D turbo spin echo (SPACE, CUBE, VISTA)" },
      TSE: { meaning: "a turbo spin echo" },
      MPRAGE: { meaning: "an inversion-prepared 3D gradient echo" },
      GRE: { meaning: "a gradient echo" },
    },
    modifier: { FLAIR: { meaning: "fluid attenuated" }, FatSat: { meaning: "fat saturated" } },
    construct: { MIP: { meaning: "a maximum intensity projection" }, ADC: { meaning: "an ADC map" } },
    base: {
      T1w: { meaning: "T1 weighted" },
      T2w: { meaning: "T2 weighted" },
      PDw: { meaning: "PD weighted" },
    },
  },
  earlier_names: { technique: { SPACE: "3D-TSE", HASTE: "SS-TSE" }, base: { none: null } },
};

function header(stack: number, n: number) {
  return {
    stack,
    item: n,
    blind: true,
    fields: [
      { level: "series", column: "series_description", value: `${MARKER}-${n}` },
      { level: "series", column: "protocol_name", value: "t2_space_sag" },
      { level: "series_mr", column: "scanning_sequence", value: "SE" },
      { level: "series_mr", column: "sequence_variant", value: "SK\\SP" },
      { level: "series_mr", column: "mr_acquisition_type", value: "3D" },
      { level: "series_mr", column: "repetition_time", value: 3200 },
      { level: "series_mr", column: "echo_time", value: 408 },
      { level: "series_mr", column: "n_instances", value: 176 },
      { level: "stack", column: "n_instances", value: 160 },
    ],
    fingerprint: { n_slices: 160, stacks_in_series: 1 },
    session: [{ order: 1, series_number: 3, description: `${MARKER}-${n}`, this_stack: true }],
  };
}

/** The fake engine: campaign 7 blind with two items, campaign 8 made to suggest the rules (not blind). */
function engine() {
  const claimed: Record<string, number> = {};
  const answers: Dialled[] = [];
  const released: Dialled[] = [];
  return stubEngine((call) => {
    const { method, path, body } = call;
    const m = /^\/api\/campaigns\/(\d+)(\/.*)?$/u.exec(path);
    if (!m) return null;
    const c = m[1] as string;
    const rest = m[2] ?? "";
    if (method === "GET" && rest === "")
      return {
        body: {
          campaign: {
            id: Number(c),
            purpose: "audit",
            suggest: c === "7" ? "none" : "rules",
            question: QUESTION,
          },
        },
      };
    if (method === "POST" && rest === "/claim") {
      if ((body as { role?: string })?.role !== "rater") return { status: 400, body: { error: "role" } };
      const n = (claimed[c] ?? 0) + 1;
      claimed[c] = n;
      if (n > 2) return { body: { assignment: null, item: null, why: "nothing is left for the caller" } };
      return { body: { assignment: { id: 100 + n }, item: { id: n, stack_id: 4240 + n }, held: false } };
    }
    const item = /^\/items\/(\d+)\/(why|header)$/u.exec(rest);
    if (method === "GET" && item) {
      const n = Number(item[1]);
      if (item[2] === "why")
        return c === "7"
          ? { body: { item: n, blind: true, texts: { study_description: "brain routine" }, physics: {} } }
          : { body: { item: n, blind: false, suggested: { technique: "TSE" }, texts: {}, physics: {} } };
      return { body: header(4240 + n, n) };
    }
    const asg = /^\/assignments\/(\d+)\/(answer|release)$/u.exec(rest);
    if (method === "POST" && asg) {
      if (asg[2] === "release") {
        released.push(call);
        return { body: { assignment: Number(asg[1]), state: "released" } };
      }
      const value = (body as { value?: unknown })?.value;
      if (typeof value !== "string")
        return { status: 400, body: { error: "value: the joint answer as text" } };
      const joint = JSON.parse(value) as Record<string, unknown>;
      if (Object.keys(joint).sort().join() !== [...AXES].sort().join())
        return { status: 400, body: { error: "every asked axis and no other" } };
      answers.push(call);
      return { body: { answer: answers.length, item: Number(asg[1]) - 100, state: "open" } };
    }
    return null;
  }).then((e) => ({ ...e, answers, released }));
}

function text(req: IncomingMessage): Promise<string> {
  return new Promise((r) => {
    let t = "";
    req.on("data", (d) => {
      t += String(d);
    });
    req.on("end", () => r(t));
  });
}

/** The fake model server: answers by the item it is shown; the first item's technique by its earlier name twice, so the retry runs and the translation does. */
async function modelServer() {
  const seen: { headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }[] =
    [];
  const server: Server = createServer(async (req, res) => {
    const body = JSON.parse(await text(req)) as Record<string, unknown>;
    seen.push({ headers: req.headers, body });
    const user =
      (body.messages as { role: string; content: string }[]).find((m) => m.role === "user")?.content ?? "";
    const first = user.includes(`${MARKER}-1`);
    const answer = {
      provenance: { reason: "ordinary", value: "RawRecon", confidence: "high" },
      technique: { reason: "SPACE in the protocol", value: first ? "SPACE" : "GRE", confidence: "high" },
      modifier: { reason: "none", value: [], confidence: "medium" },
      construct: { reason: "none", value: [], confidence: "medium" },
      base: {
        reason: first ? "long TE" : "no weighting",
        value: first ? "T2w" : "none",
        confidence: "medium",
      },
      body_part: { reason: "sagittal spine protocol", value: "cant_tell", confidence: "low" },
      post_contrast: { reason: "no agent named", value: "not_given", confidence: "medium" },
      unsure: false,
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        model: "fake-model",
        choices: [
          {
            message: {
              content: `<think>\nreading the header\n</think>\n${JSON.stringify(answer)}`,
              reasoning_content: null,
            },
            finish_reason: "stop",
          },
        ],
        usage: { completion_tokens: 42 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, seen, close: () => server.close() };
}

async function host() {
  const e = await engine();
  const m = await modelServer();
  closers.push(e.close, m.close);
  const dir = mkdtempSync(join(tmpdir(), "raters-"));
  const ledger = new Ledger(join(dir, "seam.sqlite"));
  const store = new Lineage(":memory:");
  const tokens = new Tokens();
  const people = new People(async (token) =>
    token === "t-anna"
      ? { principal: "anna@lab", grants: ["assistant:use", "campaigns:work"], detail: "plain", policy: [] }
      : token === "t-ben"
        ? { principal: "ben@lab", grants: ["assistant:use", "campaigns:work"], detail: "plain", policy: [] }
        : null,
  );
  const lines: string[] = [];
  const app = new Hono();
  app.use("*", guard({ people, lineage: () => store, authOff: () => false }));
  mountRaters(app, {
    seam: (conversation) =>
      new Seam({
        engine: e.url,
        station: {
          id: "rater",
          version: "t",
          grant: {
            "campaigns/{id}": {},
            "campaigns/{id}/claim": {},
            "campaigns/{id}/items/{id}/why": {},
            "campaigns/{id}/items/{id}/header": {},
            "campaigns/{id}/assignments/{id}/answer": {},
            "campaigns/{id}/assignments/{id}/release": {},
          },
          ceiling: "admin",
          content: "rows",
          model: "fake-model",
        },
        conversation,
        token: () => tokens.get(conversation),
        authOff: () => false,
        ledger,
      }),
    chat: (call) => kvasirChat({ url: m.url, key: "kvs_test", purpose: "assistant.rater" }, call),
    model: (named) => named ?? "fake-model",
    tokens,
    lineage: () => store,
    sleep: async () => {},
    say: (line) => lines.push(line),
  });
  const as = (token: string, init: RequestInit = {}) =>
    app.request("/raters/runs", {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
  const status = (id: string, token = "t-anna") =>
    app.request(`/raters/runs/${id}`, { headers: { authorization: `Bearer ${token}` } });
  const settled = async (id: string) => {
    for (let i = 0; i < 400; i++) {
      const r = (await (await status(id)).json()) as { done: boolean };
      if (r.done) return r as Record<string, unknown>;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("the run did not settle");
  };
  return { e, m, app, as, status, settled, lines, store };
}

describe("the rater's blind read", () => {
  it("answers both items legally on the campaign's vocabulary, with thinking on, and shows counts only", async () => {
    const h = await host();
    const started = await h.as("t-anna", { method: "POST", body: JSON.stringify({ campaign: 7 }) });
    expect(started.status).toBe(202);
    const run = (await started.json()) as {
      run: string;
      conversation: string;
      thinking: boolean;
      token: string;
      principal: string;
    };
    expect(run.thinking).toBe(true);
    expect(run.token).toBe("held");
    expect(run.principal).toBe("anna@lab");
    const done = await h.settled(run.run);
    expect(done).toMatchObject({ state: "done", claimed: 2, answered: 2, refused: 0, errors: 0 });
    // the answers: one per item, every asked axis, legal on the question's values, the earlier names translated
    expect(h.e.answers).toHaveLength(2);
    const joint = h.e.answers.map(
      (a) => JSON.parse((a.body as { value: string }).value) as Record<string, unknown>,
    );
    expect(joint[0]).toEqual({
      base: "T2w",
      construct: [],
      modifier: [],
      provenance: "RawRecon",
      technique: "3D-TSE",
    });
    expect(joint[1]).toEqual({
      base: null,
      construct: [],
      modifier: [],
      provenance: "RawRecon",
      technique: "GRE",
    });
    for (const a of h.e.answers) expect((a.body as { why: string }).why).toMatch(/blind header read/u);
    // the first item's SPACE broke the registered vocabulary, so the runner's one retry ran; the counts say so and nothing else
    expect(done.counts).toMatchObject({
      retried: 1,
      illegal_final: 1,
      legal_first: 1,
      translated_cells: { technique: 1, base: 1 },
      cant_tell_cells: {},
      out_of_vocabulary_cells: {},
      completion_tokens: 42 * 3,
    });
    expect(h.m.seen).toHaveLength(3);
    // the door sequence, as the person, under the admin ceiling, the claim as a rater
    const claim = h.e.seen.find((c) => c.path.endsWith("/claim"));
    expect(claim?.body).toEqual({ role: "rater" });
    expect(claim?.headers?.authorization).toBe("Bearer t-anna");
    expect(claim?.headers?.["x-nils-ceiling"]).toBe("admin");
    expect(JSON.parse(String(claim?.headers?.["x-nils-actor"]))).toMatchObject({
      kind: "agent",
      name: "rater",
    });
    expect(h.e.seen.map((c) => c.path.replace(/\d+/gu, "N")).filter((p) => p.includes("/items/"))).toEqual([
      "/api/campaigns/N/items/N/why",
      "/api/campaigns/N/items/N/header",
      "/api/campaigns/N/items/N/why",
      "/api/campaigns/N/items/N/header",
    ]);
    // the model call: the registered prompt with the question's vocabulary, the packet, the schema, thinking on
    const call = h.m.seen[0] as { headers: Record<string, string>; body: Record<string, unknown> };
    expect(call.headers["x-kvasir-purpose"]).toBe("assistant.rater");
    expect(call.headers.authorization).toBe("Bearer kvs_test");
    expect(call.headers["x-kvasir-person"]).toBeUndefined();
    expect(call.body).toMatchObject({
      model: "fake-model",
      temperature: 0,
      chat_template_kwargs: { enable_thinking: true },
      response_format: { type: "json_schema", json_schema: { name: "answer" } },
    });
    const msgs = call.body.messages as { role: string; content: string }[];
    expect(msgs[0]?.content).toContain("- `3D-TSE`: a 3D turbo spin echo (SPACE, CUBE, VISTA)");
    expect(msgs[0]?.content).toContain("# Header judge");
    const packet = JSON.parse(
      (msgs[1]?.content ?? "").replace(/^The stack:\n```json\n/u, "").replace(/\n```$/u, ""),
    );
    expect(packet).toMatchObject({
      stack: 4241,
      header: {
        texts: { series_description: `${MARKER}-1`, study_description: "brain routine" },
        geometry: { n_instances: 160, n_slices: 160 },
      },
    });
    expect(packet.session).toHaveLength(1);
    // the status, the start's answer and the log lines carry nothing of an item
    for (const doc of [JSON.stringify(done), JSON.stringify(run), h.lines.join("\n")]) {
      expect(doc).not.toContain(MARKER);
      expect(doc).not.toContain("4241");
      expect(doc).not.toContain("brain routine");
    }
    expect(h.lines).toHaveLength(2);
    expect(h.lines[1]).toMatch(/done: claimed 2, answered 2, refused 0/u);
    // another person sees no such run; the run's conversation is the person's
    expect((await h.status(run.run, "t-ben")).status).toBe(404);
    expect((await h.status(run.run, "t-nobody")).status).toBe(401);
    expect(h.store.access(run.conversation as string, "anna@lab", { authOff: false })).toBe("owner");
  });

  it("refuses a campaign whose why is not blind, says why, gives the lease back and calls no model", async () => {
    const h = await host();
    const started = await h.as("t-anna", {
      method: "POST",
      body: JSON.stringify({ campaign: "8", thinking: false }),
    });
    expect(started.status).toBe(202);
    const run = (await started.json()) as { run: string; thinking: boolean };
    expect(run.thinking).toBe(false);
    const done = await h.settled(run.run);
    expect(done).toMatchObject({ state: "refused", claimed: 1, answered: 0, refused: 1 });
    expect(done.error).toMatch(/why does not say blind: true/u);
    expect(h.e.answers).toHaveLength(0);
    expect(h.e.released).toHaveLength(1);
    expect(h.m.seen).toHaveLength(0);
    expect(h.e.seen.some((c) => c.path.endsWith("/header"))).toBe(false);
  });

  it("refuses a bad body, a second run on a campaign being read, and a stranger", async () => {
    const h = await host();
    expect((await h.as("t-anna", { method: "POST", body: "{}" })).status).toBe(400);
    expect(
      (await h.as("t-anna", { method: "POST", body: JSON.stringify({ campaign: 7, thinking: "yes" }) }))
        .status,
    ).toBe(400);
    expect((await h.as("t-nobody", { method: "POST", body: JSON.stringify({ campaign: 7 }) })).status).toBe(
      401,
    );
    const first = await h.as("t-anna", { method: "POST", body: JSON.stringify({ campaign: 7 }) });
    const second = await h.as("t-anna", { method: "POST", body: JSON.stringify({ campaign: 7 }) });
    expect(second.status).toBe(409);
    await h.settled(((await first.json()) as { run: string }).run);
    expect(doorOf("POST", "/raters/runs")).toEqual({ kind: "person" });
    expect(doorOf("GET", "/raters/runs/rater-1")).toEqual({ kind: "person" });
  });
});

describe("the registered texts and the ported rules", () => {
  it("carry the prompt, schema and constraints the audit runner registers, byte for byte", () => {
    expect(sha256(PROMPT_V34)).toBe("f6ab8afcc01cdf8016ee1395e5382f1b3f8e22471d7293e1c2f72cd2e8135c33");
    expect(sha256(SCHEMA_TEXT)).toBe("7b595f512eac6a745b46055ba7c505721ed5265c5ed81134a92cb114ce38d410");
    expect(sha256(CONSTRAINTS_TEXT)).toBe("0e283111bcf4a3e31bca31ac76dc1ca2872f9085076ea3a7ad46caf52fc0309f");
    expect(REGISTERED_SHA256).toEqual({
      PROMPT_V34: sha256(PROMPT_V34),
      SCHEMA_TEXT: sha256(SCHEMA_TEXT),
      CONSTRAINTS_TEXT: sha256(CONSTRAINTS_TEXT),
    });
    expect(PROMPT_V34).not.toContain("—");
  });

  it("composes the prompt from the served vocabulary and widens the schema, never narrowing it", () => {
    const p = composePrompt(PROMPT_V34, QUESTION);
    expect(p.vocabulary).toMatchObject({ source: "question", axes_served: AXES });
    expect(p.text).toContain("- `GRE`: a gradient echo");
    expect(p.text).toContain("- `MPRAGE`: an inversion-prepared 3D gradient echo");
    expect(PROMPT_V34).toContain("- `MPRAGE` (family GRE):");
    expect(p.text).not.toContain("- `MPRAGE` (family GRE):");
    const same = composePrompt(PROMPT_V34, null);
    expect(same.text).toBe(PROMPT_V34);
    expect(same.vocabulary.source).toBe("prompt");
    // the fixed lines are those of this composition: the same question composes the same text and hashes
    expect(composePrompt(PROMPT_V34, QUESTION)).toEqual(p);
    expect(same.vocabulary.vocabulary_sha256).toBe(sha256(""));
    const schema = extendSchema(JSON.parse(SCHEMA_TEXT), {
      values: { technique: ["Brand-New"], modifier: ["Spiral", "Newer"] },
      vocabulary: {
        technique: { "Brand-New": { meaning: "new" } },
        modifier: { Spiral: { meaning: "s" }, Newer: { meaning: "n" } },
      },
    }) as { properties: Record<string, { properties: { value: Record<string, unknown> } }> };
    const tech = schema.properties.technique?.properties.value.enum as string[];
    expect(tech).toContain("Brand-New");
    expect(tech).toContain("MPRAGE");
    const mod = schema.properties.modifier?.properties.value.anyOf as {
      type: string;
      items?: { enum: string[] };
    }[];
    expect(mod[0]?.items?.enum).toContain("Newer");
    expect(mod[0]?.items?.enum?.filter((v) => v === "Spiral")).toHaveLength(1);
  });

  it("checks legality against the constraints and translates through the earlier names", () => {
    const c = JSON.parse(CONSTRAINTS_TEXT);
    const legal = {
      technique: { value: "MPRAGE" },
      base: { value: "T1w" },
      modifier: { value: [] },
      construct: { value: [] },
    };
    expect(violations(legal, c)).toEqual([]);
    expect(violations({ ...legal, base: { value: "T2w" } }, c)).toEqual([
      "base/technique:MPRAGE: base must be T1w",
    ]);
    expect(violations({ technique: { value: "Brand-New" } }, c)).toEqual([
      'technique: ["Brand-New"] not in the vocabulary',
    ]);
    expect(
      violations({ technique: { value: "Brand-New" } }, c, { technique: new Set(["Brand-New"]) }),
    ).toEqual([]);
    expect(violations({ modifier: { value: ["FLAIR", "STIR"] } }, c)).toContainEqual(
      expect.stringMatching(/at most one of/u),
    );
    const earlier = { technique: { SPACE: "3D-TSE" }, base: { none: null } };
    const allowed = new Set(["3D-TSE", "TSE"]);
    expect(translate("SPACE", "technique", allowed, earlier)).toEqual({ value: "3D-TSE", changed: true });
    expect(translate("TSE", "technique", allowed, earlier)).toEqual({ value: "TSE", changed: false });
    expect(translate("none", "base", new Set(["T1w"]), earlier)).toEqual({ value: null, changed: true });
    expect(translate(["Spiral", "SPACE"], "modifier", new Set(["Spiral"]), earlier)).toEqual({
      value: ["Spiral", "SPACE"],
      changed: false,
    });
    const counts = valueCounts();
    const value = campaignValue(
      { technique: { value: "Odd" }, base: { value: "cant_tell" }, provenance: { value: null } },
      ["technique", "base", "provenance"],
      { technique: allowed, base: new Set(["T1w"]), provenance: new Set(["RawRecon"]) },
      counts,
      earlier,
    );
    expect(JSON.parse(value)).toEqual({ base: "cant_tell", provenance: "cant_tell", technique: "cant_tell" });
    expect(counts).toEqual({
      cant_tell_cells: { base: 1, provenance: 1, technique: 1 },
      out_of_vocabulary_cells: { technique: 1 },
      translated_cells: {},
    });
  });

  it("refuses a packet with an identifier key or a personnummer-shaped text, and places the doors' columns", () => {
    expect(() => checkPacket({ header: { texts: { patient_name: "x" } } })).toThrow(Refused);
    expect(() => checkPacket({ header: { texts: { series_description: "id 19850101-1234 here" } } })).toThrow(
      /personnummer-shaped/u,
    );
    expect(() => checkPacket({ header: { physics: { repetition_time: "198501011234" } } })).not.toThrow();
    const { packet, unplaced } = packetFromDoors(
      5,
      {
        fields: [
          { level: "instance", column: "echo_time", value: 90 },
          { level: "series_mr", column: "echo_time", value: 95 },
          { level: "series", column: "unknown_column", value: "x" },
          { level: "series", column: "text_protocol_name", value: "p" },
        ],
        private: [{ tag: "(0019,100c)", value: "1000" }],
      },
      { texts: { series_description: "d" }, header: { orientation: "sag" } },
    );
    expect(packet).toEqual({
      stack: 5,
      header: {
        texts: { series_description: "d", protocol_name: "p" },
        sequence: {},
        physics: { echo_time: 95 },
        geometry: { orientation: "sag" },
        private: [{ tag: "(0019,100c)", value: "1000" }],
      },
      session: [],
    });
    expect(unplaced).toBe(1);
  });
});
