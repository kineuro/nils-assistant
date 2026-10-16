// SPDX-License-Identifier: AGPL-3.0-only
// Record 55, ruling 24, on the one agent with a scripted model and a stub
// engine whose site keeps a ctrl-id map. The site's admin asked "how many SWI
// acquisition types does Ctrl0042 has?" twice and was answered for the whole
// cohort, since the ID could not be turned into a subject. Now the agent
// resolves the ID first with one lookup and asks of the subject code it
// answers; an admin's calls carry the admin's own reach, never a station's
// lower ceiling; a reviewer's keep the station's; and an ID no subject has is
// said so, never answered for a cohort.
//
// The T10 bench of 2026-10-16 added the other half: a subject code is no ID,
// but the model cannot tell one from an ID, called the tool on SYN0005 and was
// told that no subject has the ID, so it refused to plan an erasure. A value no
// ID type knows is now asked last as a subject code too, the tool says when it
// is one, and a site with no map at all still asks the engine.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { init } from "@flue/runtime";
import { sqlite, start } from "@flue/runtime/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

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
const { admitPath } = await import("../src/seam/redactor.ts");

/** The site's ctrl-id map, as the engine keeps it: Ctrl0042 is subject ab12cd34 (a made-up code). */
const MAP: Record<string, string> = { Ctrl0042: "ab12cd34" };
const CODE = "ab12cd34";
/** The subject codes the engine knows: a subject's own, and the code of a subject that was merged into ab12cd34. */
const CODES: Record<string, string> = { ab12cd34: "ab12cd34", SYN0005: "SYN0005", ef56ab78: "ab12cd34" };

/** The ID types the stub's site keeps, as GET linkage/types lists them: a site with a map, and one with none. */
const BUILT_IN = [
  { name: "patient-id", identifiers: 0, identifying: true },
  { name: "study-instance-uid", identifiers: 0, identifying: true },
  { name: "subject-code", identifiers: 0 },
  { name: "personnummer", identifiers: 0, identifying: true },
];
const WITH_MAP = [
  ...BUILT_IN,
  { name: "hospital-id", identifiers: 3, identifying: true },
  { name: "ctrl-id", identifiers: 78, subjects: 78 },
];
let siteTypes: { name: string; identifiers: number; identifying?: boolean; subjects?: number }[] = WITH_MAP;

const engine = await stubEngine((c) => {
  const p = c.path.split("?")[0];
  if (p === "/api/capabilities") return { body: { auth: "off", policy: [], detail: "sensitive" } };
  if (p === "/api/linkage/types") return { body: siteTypes };
  if (p === "/api/linkage/resolve") {
    const b = c.body as { id_type?: string; value?: string };
    // an ID that identifies a person anywhere needs every detail, which the person's call here does not carry,
    // and a value that is not a personnummer is refused as one: both are refusals the tool moves past
    if (b.id_type === "patient-id")
      return { status: 403, body: { error: "resolving a patient-id needs detail sensitive" } };
    if (b.id_type === "personnummer")
      return { status: 400, body: { error: "not an ID that is the same everywhere" } };
    // a person whose account may not look IDs up
    if (String(b.value).startsWith("Locked")) return { status: 403, body: { error: "needs detail quasi" } };
    // a subject code is the subject it names, and a merged subject's code the one it was merged into
    if (b.id_type === "subject-code") {
      const code = CODES[String(b.value)];
      return {
        body: code
          ? { id_type: b.id_type, known: true, subject_code: code, scans: 9, datasets: ["controls"] }
          : { id_type: b.id_type, known: false },
      };
    }
    if (b.id_type !== "ctrl-id")
      return {
        status: 404,
        body: { error: `no ID type named ${b.id_type}; the types are patient-id, ctrl-id` },
      };
    const code = MAP[String(b.value)];
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
    // an unnamed ID is never tried as one that identifies a person anywhere (flagged, or built in)
    expect(asked).toEqual([{ id_type: "ctrl-id", value: "Ctrl0042" }]);
    // and the ID that a map knows is not asked as a subject code as well: the code is tried last
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
    // what was asked: an unnamed value was asked as an ID and, last, as a subject code
    expect(answered).toMatch(/the ID or subject code Ctrl9999/u);
    expect(resolves().map((d) => (d.body as { id_type: string }).id_type)).toEqual([
      "ctrl-id",
      "subject-code",
    ]);
  }, 60_000);

  it("is dialled only by the one agent acting for the person, never by a station", () => {
    expect(admitPath("/api/linkage/resolve", "POST").ok).toBe(false);
    expect(admitPath("/api/linkage/resolve", "POST", false, true).ok).toBe(true);
    expect(admitPath("/api/linkage/held/reveal", "POST", false, true).ok).toBe(false);
  });

  it("tries an identifying type only when the person names it, and says when the account may not look IDs up", async () => {
    notePerson("oc-ctrl-named", { grants: SETS.admin.grants, detail: "sensitive" });
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "subject_resolve", args: { value: "PX-0077", id_type: "patient-id" } },
      { text: "That patient ID cannot be looked up here." },
    ]);
    let h = init(Nils, { id: "oc-ctrl-named" });
    await h.read(await h.dispatch("which subject is patient-id PX-0077?"));
    expect(resolves().map((d) => d.body)).toEqual([{ id_type: "patient-id", value: "PX-0077" }]);
    // every type refused: the account may not, which is not the ID being unknown
    notePerson("oc-ctrl-locked", { grants: SETS.reviewer.grants, detail: "quasi" });
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "subject_resolve", args: { value: "Locked0042" } },
      { text: "Your account cannot look a subject up by an ID here." },
    ]);
    h = init(Nils, { id: "oc-ctrl-locked" });
    await h.read(await h.dispatch("how many scans does Locked0042 have?"));
    const answered = toolAnswer("subject_resolve");
    expect(answered).toMatch(/may not look IDs up/u);
    expect(answered).not.toMatch(/no subject you may see/u);
  }, 60_000);
});

describe("a subject code is no ID (the T10 bench, 2026-10-16)", () => {
  afterEach(() => {
    siteTypes = WITH_MAP;
  });

  it("is asked last as a subject code, and the answer says it is one, whose subject the registry has", async () => {
    siteTypes = WITH_MAP;
    notePerson("oc-code-own", { grants: SETS.admin.grants, detail: "sensitive" });
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "subject_resolve", args: { value: "ab12cd34" } },
      { text: "ab12cd34 is a subject of the registry." },
    ]);
    const h = init(Nils, { id: "oc-code-own" });
    await h.read(await h.dispatch("how many SWI acquisition types does ab12cd34 have?"));
    // the map's type first, the subject code last, and never a type that identifies a person anywhere
    expect(resolves().map((d) => d.body)).toEqual([
      { id_type: "ctrl-id", value: "ab12cd34" },
      { id_type: "subject-code", value: "ab12cd34" },
    ]);
    const answered = toolAnswer("subject_resolve");
    expect(answered).toMatch(/is a subject code, not an ID/u);
    expect(answered).toMatch(/needs no resolving/u);
    expect(answered).toMatch(/\\"subject_code\\":\\"ab12cd34\\"/u);
    expect(answered).toMatch(/subject\.code = ab12cd34/u);
    // not the answer of an ID that is unknown
    expect(answered).not.toMatch(/no subject you may see/u);
  }, 60_000);

  it("is the subject it names on a site with no map, where no ID type was asked before", async () => {
    // the T10 bench's registries keep the four built-in types and no map: every one is flagged or the registry's own
    siteTypes = BUILT_IN;
    notePerson("oc-code-nomap", { grants: SETS.admin.grants, detail: "sensitive" });
    play([
      { tool: "activate_skill", args: { name: "plan-work" } },
      { tool: "subject_resolve", args: { value: "SYN0005" } },
      { text: "The erasure of SYN0005 is on a card for you." },
    ]);
    const h = init(Nils, { id: "oc-code-nomap" });
    await h.read(await h.dispatch("Erase subject SYN0005 and everything derived from it."));
    // the engine is asked, as a subject code, rather than no type being tried
    expect(resolves().map((d) => d.body)).toEqual([{ id_type: "subject-code", value: "SYN0005" }]);
    const answered = toolAnswer("subject_resolve");
    expect(answered).toMatch(/SYN0005 is a subject code, not an ID/u);
    expect(answered).not.toMatch(/no subject you may see/u);
    // the next step serves work on the subject as well as a question about its scans
    expect(answered).toMatch(/work on the subject names it by that code/u);
  }, 60_000);

  it("says a merged subject's code is the code of the subject it was merged into", async () => {
    siteTypes = BUILT_IN;
    notePerson("oc-code-merged", { grants: SETS.admin.grants, detail: "sensitive" });
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "subject_resolve", args: { value: "ef56ab78", id_type: "subject-code" } },
      { text: "ef56ab78 was merged into ab12cd34." },
    ]);
    const h = init(Nils, { id: "oc-code-merged" });
    await h.read(await h.dispatch("how many scans does ef56ab78 have?"));
    // a named type is the one asked
    expect(resolves().map((d) => d.body)).toEqual([{ id_type: "subject-code", value: "ef56ab78" }]);
    const answered = toolAnswer("subject_resolve");
    expect(answered).toMatch(/ef56ab78 is a subject code, not an ID: its subject was merged into ab12cd34/u);
    expect(answered).toMatch(/subject\.code = ab12cd34/u);
  }, 60_000);

  it("says a code no subject holds is no subject, in the words of what was asked, never for a cohort", async () => {
    siteTypes = BUILT_IN;
    notePerson("oc-code-none", { grants: SETS.admin.grants, detail: "sensitive" });
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "subject_resolve", args: { value: "SYN9999" } },
      { tool: "subject_resolve", args: { value: "SYN9999", id_type: "subject-code" } },
      { text: "No subject has SYN9999." },
    ]);
    const h = init(Nils, { id: "oc-code-none" });
    await h.read(await h.dispatch("how many scans does SYN9999 have?"));
    const answers: string[] = [];
    for (const c of seen)
      for (const m of c.messages as unknown as { role: string; toolName?: string; content?: unknown }[])
        if (m.role === "toolResult" && m.toolName === "subject_resolve")
          answers.push(JSON.stringify(m.content));
    const [unnamed, named] = [...new Set(answers)];
    expect(unnamed).toMatch(/no subject you may see has the ID or subject code SYN9999/u);
    expect(named).toMatch(/no subject you may see has the subject code SYN9999/u);
    for (const a of [unnamed, named]) expect(a).toMatch(/never answer for a whole cohort/u);
  }, 60_000);

  it("does not say no subject has an ID when the site keeps no type to ask", async () => {
    // an engine that lists only types that identify a person: there is nothing a person could name a subject by
    siteTypes = [
      { name: "patient-id", identifiers: 0, identifying: true },
      { name: "personnummer", identifiers: 0, identifying: true },
    ];
    notePerson("oc-code-notypes", { grants: SETS.admin.grants, detail: "sensitive" });
    play([
      { tool: "activate_skill", args: { name: "find-data" } },
      { tool: "subject_resolve", args: { value: "Ctrl0042" } },
      { text: "I cannot look an ID up here; which subject code do you mean?" },
    ]);
    const h = init(Nils, { id: "oc-code-notypes" });
    await h.read(await h.dispatch("how many scans does Ctrl0042 have?"));
    expect(resolves()).toEqual([]);
    const answered = toolAnswer("subject_resolve");
    expect(answered).toMatch(/keeps no ID type/u);
    expect(answered).not.toMatch(/no subject you may see/u);
  }, 60_000);
});
