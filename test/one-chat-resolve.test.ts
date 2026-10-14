// SPDX-License-Identifier: AGPL-3.0-only
// Record 55, ruling 24, on the one agent with a scripted model and a stub
// engine whose site keeps a ctrl-id map. The site's admin asked "how many SWI
// acquisition types does Ctrl0042 has?" twice and was answered for the whole
// cohort, since the ID could not be turned into a subject. Now the agent
// resolves the ID first with one lookup and asks of the subject code it
// answers; an admin's calls carry the admin's own reach, never a station's
// lower ceiling; a reviewer's keep the station's; and an ID no subject has is
// said so, never answered for a cohort.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { init } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "one-resolve-"));
process.env.ASSISTANT_LEDGER = join(dir, "seam.sqlite");
process.env.ASSISTANT_LINEAGE = join(dir, "lineage.sqlite");
process.env.ASSISTANT_NOTES = join(dir, "notes.sqlite");
process.env.ASSISTANT_LADDER = join(dir, "ladder.sqlite");

const { stubEngine } = await import("./child/stub-engine.ts");
const { scriptedProvider } = await import("./child/loop-provider.ts");
const { probeEngineAuth, registerStation } = await import("../src/seam/for.ts");
const { loadManifests } = await import("../src/stations/manifest.ts");
const { ChangeStore, useChangeStore } = await import("../src/one/changes.ts");
const { oneAgent, notePerson } = await import("../src/one/agent.ts");
const { SETS } = await import("../src/host/grants.ts");

/** The site's ctrl-id map, as the engine keeps it: Ctrl0042 is subject ab12cd34 (a made-up code). */
const MAP: Record<string, string> = { Ctrl0042: "ab12cd34" };
const CODE = "ab12cd34";

const engine = await stubEngine((c) => {
  const p = c.path.split("?")[0];
  if (p === "/api/capabilities") return { body: { auth: "off", policy: [], detail: "sensitive" } };
  if (p === "/api/linkage/types")
    return {
      body: [
        { name: "patient-id", identifiers: 0 },
        { name: "study-instance-uid", identifiers: 0 },
        { name: "subject-code", identifiers: 0 },
        { name: "ctrl-id", identifiers: 78, subjects: 78 },
      ],
    };
  if (p === "/api/linkage/resolve") {
    const b = c.body as { id_type?: string; value?: string };
    if (!["patient-id", "ctrl-id", "personnummer"].includes(String(b.id_type)))
      return {
        status: 404,
        body: { error: `no ID type named ${b.id_type}; the types are patient-id, ctrl-id` },
      };
    const code = b.id_type === "ctrl-id" ? MAP[String(b.value)] : undefined;
    return {
      body: code
        ? { id_type: b.id_type, known: true, subject_code: code, scans: 9, datasets: ["controls"] }
        : { id_type: b.id_type, known: false },
    };
  }
  if (p === "/api/ask/catalog")
    return {
      body: {
        epoch: 3,
        pack: { name: "mri", version: "1.0.0" },
        levels: [{ level: "subject", fields: [{ path: "code", type: "text", class: "quasi_identifying" }] }],
        axes: [{ name: "base", values: [{ id: "SWI" }, { id: "T1w" }] }],
        kinds: [],
        cohorts: [{ name: "controls", members: 78 }],
      },
    };
  if (p === "/api/ask/guide") return { body: { grounding: [] } };
  if (p === "/api/ask/draft")
    return { body: { document: 901, hash: "h", diagnosis: [{ set: "swi", rows: 2 }] } };
  if (p === "/api/ask/preview")
    return {
      body: {
        level: "aggregate",
        columns: ["family", "n_scans"],
        rows: [
          ["SWI", 3],
          ["SWI phase", 1],
        ],
      },
    };
  if (p === "/api/sources") return { body: { count: 0, sources: [] } };
  return null;
});
process.env.NILS_URL = engine.url;
await probeEngineAuth(engine.url);
for (const m of loadManifests(["./stations"]).values())
  registerStation({
    id: m.id,
    version: "t",
    grant: m.grant,
    ceiling: m.ceiling,
    content: m.content,
    model: "m",
  });
useChangeStore(() => new ChangeStore(join(dir, "changes.sqlite")));

type Step = { tool: string; args: Record<string, unknown> } | { text: string };
let script: Step[] = [];
let seen: Context[] = [];
let calls = 0;
const provider = scriptedProvider("kvasir-nils", (context) => {
  seen.push(structuredClone(context));
  const next = script[Math.min(calls, script.length - 1)];
  calls += 1;
  return next;
});
function play(steps: Step[]): void {
  script = steps;
  seen = [];
  calls = 0;
  engine.seen.length = 0;
}

const Nils = oneAgent({ model: "m", arm: "skill", stationDirs: ["./stations"] });
let flue: Awaited<ReturnType<typeof start>>;
beforeAll(async () => {
  flue = await start({ agents: [Nils], db: sqlite(join(dir, "flue.sqlite")), providers: [provider] });
});
afterAll(async () => {
  await flue.stop();
  engine.close();
});

const QUESTION = "how many SWI acquisition types does Ctrl0042 has?";
const DOCUMENT = [
  "ast_version: 1",
  "name: SWI acquisition types of one subject",
  "scheme: default",
  "sets:",
  "  scans: {grain: stack, where: [['=', {}, ['field', {}, 'subject.code'], 'ab12cd34'], ['=', {}, ['axis', {}, 'base'], 'SWI']]}",
  "out: {set: scans, level: count}",
].join("\n");

/** What a tool answered the model, by the tool's name, from the requests the model saw. */
function toolAnswer(name: string): string {
  for (const c of seen)
    for (const m of c.messages as unknown as { role: string; toolName?: string; content?: unknown }[])
      if (m.role === "toolResult" && m.toolName === name) return JSON.stringify(m.content);
  return "";
}

const resolves = () => engine.seen.filter((d) => d.path.startsWith("/api/linkage/resolve"));

describe("a subject named by an ID (record 55, ruling 24)", () => {
  it("is resolved to its subject code first, and the admin's question is asked of that subject", async () => {
    notePerson("oc-ctrl-admin", { grants: SETS.admin.grants, detail: "sensitive" });
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "subject_resolve", args: { value: "Ctrl0042" } },
      { tool: "query_draft", args: { text: DOCUMENT } },
      { text: "Ctrl0042 (subject ab12cd34) has 2 SWI acquisition types." },
    ]);
    const h = init(Nils, { id: "oc-ctrl-admin" });
    const reply = await h.read(await h.dispatch(QUESTION));
    expect(reply.text).toMatch(/ab12cd34/u);
    // the types are read once, and each a person names subjects by is tried until one knows the ID
    const asked = resolves().map((d) => d.body);
    expect(asked).toContainEqual({ id_type: "ctrl-id", value: "Ctrl0042" });
    expect(asked.some((b) => (b as { id_type?: string }).id_type === "subject-code")).toBe(false);
    // the answer the model reads names the subject code, and says to ask of it, never of a cohort
    const answered = toolAnswer("subject_resolve");
    expect(answered).toMatch(/ab12cd34/u);
    expect(answered).toMatch(/subject\.code/u);
    // the question then drafted is the subject's
    const draft = engine.seen.find((d) => d.path.startsWith("/api/ask/draft"));
    expect(JSON.stringify(draft?.body)).toContain(CODE);
    // an admin's calls carry the admin's reach, not ask-help's lower ceiling
    for (const d of resolves()) expect(d.headers?.["x-nils-ceiling"]).toBe("admin");
    expect(draft?.headers?.["x-nils-ceiling"]).toBe("admin");
  }, 60_000);

  it("keeps a station's ceiling for a person who is no admin, and names the type when they do", async () => {
    notePerson("oc-ctrl-reviewer", { grants: SETS.reviewer.grants, detail: "quasi" });
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "subject_resolve", args: { value: "Ctrl0042", id_type: "ctrl-id" } },
      { text: "Ctrl0042 is subject ab12cd34." },
    ]);
    const h = init(Nils, { id: "oc-ctrl-reviewer" });
    await h.read(await h.dispatch("which subject is ctrl-id Ctrl0042?"));
    // a named type is the one asked, and the types are not read
    expect(resolves().map((d) => d.body)).toEqual([{ id_type: "ctrl-id", value: "Ctrl0042" }]);
    expect(engine.seen.some((d) => d.path.startsWith("/api/linkage/types"))).toBe(false);
    expect(resolves()[0].headers?.["x-nils-ceiling"]).toBe("reviewer");
  }, 60_000);

  it("says an ID no subject has is not known, and never answers for a cohort instead", async () => {
    notePerson("oc-ctrl-none", { grants: SETS.admin.grants, detail: "sensitive" });
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "subject_resolve", args: { value: "Ctrl9999" } },
      { text: "No subject has the ID Ctrl9999." },
    ]);
    const h = init(Nils, { id: "oc-ctrl-none" });
    await h.read(await h.dispatch("how many SWI acquisition types does Ctrl9999 have?"));
    const answered = toolAnswer("subject_resolve");
    expect(answered).toMatch(/never answer for a whole cohort/u);
    expect(answered).not.toMatch(/ab12cd34/u);
  }, 60_000);
});
