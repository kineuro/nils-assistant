// SPDX-License-Identifier: AGPL-3.0-only
// One chat (2026-10-09), the parts of the one agent that need no model:
// what a person's grants mount, the routing hint, the turn's facts, plain
// words, the skills on disk, the decoy task tool left out, the checks
// before a turn settles, and a proposed change decided and applied.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { SETS } from "../src/host/grants.ts";
import { decide } from "../src/one/apply.ts";
import { ChangeStore } from "../src/one/changes.ts";
import { activeSkills, complaintsOf } from "../src/one/checks.ts";
import { factsOf, factsSummary } from "../src/one/facts.ts";
import { grantsLine, mountFor, SKILL_ORDER, TOOL_ORDER } from "../src/one/mount.ts";
import { hintLine, routeOf } from "../src/one/route.ts";
import { bodyFor, findExamples, loadSkills, parseSkill } from "../src/one/skills.ts";
import { conversationOf, newTurn } from "../src/one/state.ts";
import { searchCatalog, TOOLS } from "../src/one/tools.ts";
import { plainly, unplainWords } from "../src/one/words.ts";
import { withoutTask } from "../src/providers/kvasir.ts";
import { GrantKeeper } from "../src/seam/grant.ts";
import { Ledger } from "../src/seam/ledger.ts";
import { seamOf, stubEngine } from "./child/stub-engine.ts";

describe("what a person's grants mount", () => {
  it("mounts every tool and skill for an admin, in the fixed order", () => {
    const m = mountFor(SETS.admin);
    expect(m.tools).toEqual([...TOOL_ORDER]);
    expect(m.skills).toEqual([...SKILL_ORDER]);
  });

  it("leaves a person without query:see no tool that looks into the data", () => {
    const m = mountFor({ grants: ["assistant:use"], detail: "plain" });
    expect(m.tools).toEqual(["registry_summary", "plan_update", "ask_user", "propose_change"]);
    expect(m.skills).toEqual([]);
    expect(grantsLine(m)).toMatch(/may only ask what the registry holds/u);
    expect(grantsLine(m)).toMatch(/an admin can give it/u);
  });

  it("gives a reader finding data and nothing that plans or changes", () => {
    const m = mountFor(SETS.reader);
    expect(m.skills).toEqual(["find-data"]);
    expect(m.tools).toContain("query_draft");
    expect(m.tools).not.toContain("run_read");
    expect(grantsLine(m)).toMatch(/counts and plain fields only/u);
  });

  it("names every tool the bench's lexicon names, and no other", () => {
    expect(Object.keys(TOOLS).sort()).toEqual([...TOOL_ORDER].sort());
  });
});

describe("the routing hint", () => {
  const cases: [string, string | null, boolean][] = [
    ["Which cohorts does the registry hold, and how many people are in each?", null, true],
    ["What clinical scores are recorded?", null, true],
    ["How many cohorts are there now, and what is the newest one called?", null, true],
    ["How many subjects are in cohort B?", "find-data", false],
    ["Back to the nmosd people, which of them have an MPRAGE?", "find-data", false],
    ["Digest what is in the inbox.", "plan-work", false],
    ["Now digest what is in the inbox.", "plan-work", false],
    ["Rebuild the sessions tonight at 02:00 UTC.", "plan-work", false],
    ["Erase subject SYN0005 and everything derived from it.", "plan-work", false],
    ["What are the hippocampal volumes in the NMOSD cohort?", "plan-analysis", false],
    ["Which scans in my selection ms-baseline@1 have poor image quality?", "plan-analysis", false],
    ["How did run 12 go?", "read-run", false],
    ["Thanks. And in that run, how many units failed?", "read-run", false],
    [
      "Something else: in batch 4 the radiographers write zorvex. Teach the sorting that word.",
      "tune-sorting-words",
      false,
    ],
    ["Check how dataset ds-same tells its people apart. Is anything held back?", "check-identities", false],
  ];
  it.each(cases)("%s", (words, skill, summary) => {
    const r = routeOf(words);
    expect(r.skill).toBe(skill);
    expect(r.summary).toBe(summary);
  });

  it("says a skill the person may not use is to be refused, not suggested", () => {
    expect(hintLine(routeOf("Digest what is in the inbox."), ["find-data"])).toMatch(/may not do that here/u);
    expect(hintLine(routeOf("How many subjects are in cohort B?"), ["find-data"])).toMatch(
      /find-data skill/u,
    );
  });
});

describe("the turn's facts", () => {
  it("carries nothing a tag would escape, and no engine word in its headings", () => {
    const s = factsSummary(
      '## The registry (pack mri 1.0, epoch 7)\nGrains:\n- cohort -> subject\nFields per level (`["field", {}, "<path>"]`):\nSession schemes: default (write `scheme: default`)\n## The engine\'s grounding\n- a >= b & c',
    );
    expect(s).not.toMatch(/[<>&]/u);
    expect(s).not.toMatch(/epoch|pack|scheme/iu);
    expect(s).toMatch(/What the registry holds/u);
  });

  it("leaves the language's functions to the find skill, which carries them as written", () => {
    const s = factsSummary(
      "Cohorts (by name): a\nFunctions, by family:\n- compare: =, >, >=, <\n- text: contains\nAfter.",
    );
    expect(s).not.toMatch(/compare|contains/u);
    expect(s).toMatch(/Cohorts[\s\S]*After\./u);
    const find = loadSkills(["./stations"], ["find-data"]).get("find-data");
    if (!find) throw new Error("no find-data");
    expect(bodyFor(find, "how many", [], { compare: ["=", ">", ">="] })).toMatch(/- compare: =, >, >=/u);
  });

  it("sends the summary and the grants once, the hint every turn", () => {
    const first = factsOf({
      told: { summary: null, grants: null },
      summary: "S",
      grants: "G",
      hint: "H",
      document: null,
    });
    expect(first.text).toBe("S\n\nG\n\nH");
    const second = factsOf({ told: first.told, summary: "S", grants: "G", hint: "H2", document: 9 });
    expect(second.text).toBe("The question open on the person's page is document 9.\n\nH2");
    const changed = factsOf({ told: second.told, summary: "S2", grants: "G", hint: "H3", document: null });
    expect(changed.text).toBe("S2\n\nH3");
  });
});

describe("plain words", () => {
  it("finds the bench's door phrases and engine words, and none in a plain answer", () => {
    expect(unplainWords("The ask-help station is working on it; the catalog door is closed to me.")).toEqual(
      expect.arrayContaining(["station", "is working on it", "catalog", "closed to me"]),
    );
    expect(unplainWords("Cohort B has 24 subjects.")).toEqual([]);
  });

  it("matches the bench's lexicon word for word", async () => {
    const { DOOR_PHRASES, ENGINE_WORDS } = await import("../src/one/words.ts");
    const yml = `door_phrases:\n${DOOR_PHRASES.map((p) => `  - ${JSON.stringify(p)}`).join("\n")}\nengine_words:\n${ENGINE_WORDS.map((p) => `  - ${JSON.stringify(p)}`).join("\n")}\n`;
    const back = parse(yml) as { door_phrases: string[]; engine_words: string[] };
    expect(back.door_phrases).toEqual([...DOOR_PHRASES]);
  });

  it("puts a seam's refusal in plain words before the model reads it", () => {
    expect(plainly("draft is not in this station's grant; the grant holds catalog, guide")).toBe(
      "draft is not open to this chat",
    );
    expect(unplainWords(plainly("the door refused: no grant for this phase"))).toEqual([]);
  });
});

describe("the skills", () => {
  const skills = loadSkills(["./stations"], SKILL_ORDER);
  it("reads all six from disk, each with one catalog line", () => {
    expect([...skills.keys()]).toEqual([...SKILL_ORDER]);
    for (const s of skills.values()) {
      expect(s.description.length).toBeGreaterThan(40);
      expect(s.description.length).toBeLessThan(260);
      expect(s.body).not.toMatch(/\bnils_\w+|\bsettle\b|\badvance\b/u);
    }
  });

  it("names only the one agent's tools in its bodies", () => {
    const named = new Set<string>();
    for (const s of skills.values())
      for (const m of s.body.matchAll(
        /`(registry_\w+|query_\w+|jobs_read|run_read|plan_update|ask_user|propose_change|\w+_\w+)`/gu,
      ))
        named.add(m[1]);
    for (const n of named)
      if (/^(registry|query)_|^(jobs_read|run_read|plan_update|ask_user|propose_change)$/u.test(n))
        expect(TOOL_ORDER as readonly string[]).toContain(n);
  });

  it("gives finding data the worked examples closest to the words", () => {
    const find = skills.get("find-data");
    if (!find) throw new Error("no find-data");
    const body = bodyFor(
      find,
      "List the subjects who converted from RRMS to SPMS",
      findExamples(["./stations"]),
    );
    expect(body).toMatch(/Worked examples closest/u);
    expect(body).toMatch(/change/u);
    expect((body.match(/### Example/gu) ?? []).length).toBe(3);
  });

  it("refuses a skill file without front matter", () => {
    expect(() => parseSkill("no front matter")).toThrow(/front matter/u);
  });
});

describe("the request to the model", () => {
  it("leaves out Flue's decoy task tool and its empty roster", () => {
    const ctx = withoutTask({
      systemPrompt:
        "Head.\n\n## Available Skills\n\n- **find-data**\n\n## Available Agents\n\nNone. No subagents are currently declared, so the `task` tool has no valid `agent` value \u2014 do not call it unless an agent is introduced later in the conversation.\n\nDate: Fri",
      tools: [
        { name: "task", description: "", parameters: {} },
        { name: "query_draft", description: "", parameters: {} },
      ],
      messages: [],
    } as never) as unknown as { systemPrompt: string; tools: { name: string }[] };
    expect(ctx.tools.map((t) => t.name)).toEqual(["query_draft"]);
    expect(ctx.systemPrompt).not.toMatch(/Available Agents|task/u);
    expect(ctx.systemPrompt).toMatch(/Available Skills[\s\S]*Date: Fri/u);
  });
});

describe("the checks before a turn settles", () => {
  it("sends back an answer in engine words, and lets a plain one settle", async () => {
    const t = newTurn("chk-1", "How many?");
    t.texts.push("The ask-help station counted 24 subjects.");
    const c = { turn: t, convo: conversationOf("chk-1"), conversation: "chk-1", validate: null };
    expect((await complaintsOf(c)).join(" ")).toMatch(/station/u);
    t.texts.push("Cohort B has 24 subjects.");
    expect(await complaintsOf(c)).toEqual([]);
  });

  it("holds a found document to the engine's validation", async () => {
    const t = newTurn("chk-2", "How many?");
    t.drafted.push(5);
    t.texts.push("There are 3.");
    expect(activeSkills(t).has("find-data")).toBe(true);
    const c = {
      turn: t,
      convo: conversationOf("chk-2"),
      conversation: "chk-2",
      validate: async () => "set x: no such field",
    };
    expect((await complaintsOf(c))[0]).toMatch(/does not validate: set x: no such field/u);
  });

  it("asks a read run's answer for the failed units and each broken check", async () => {
    const t = newTurn("chk-3", "How did run 4 go?");
    t.runs.push({ run: 4, failed: 4, metrics: ["qc_general_white_matter"] });
    t.texts.push("The run went fine.");
    const c = { turn: t, convo: conversationOf("chk-3"), conversation: "chk-3", validate: null };
    const out = (await complaintsOf(c)).join(" ");
    expect(out).toMatch(/how many units failed: 4/u);
    expect(out).toMatch(/qc_general_white_matter/u);
  });

  it("sends back an instruction that was answered without a plan", async () => {
    const t = newTurn("chk-4", "Digest the inbox.");
    t.skills.add("plan-work");
    t.texts.push("I will digest the inbox.");
    const c = { turn: t, convo: conversationOf("chk-4"), conversation: "chk-4", validate: null };
    expect((await complaintsOf(c)).join(" ")).toMatch(/kind job_plan/u);
  });
});

describe("searching the registry's names", () => {
  it("finds fields, sorting values, kinds and cohorts by the person's words", () => {
    const cat = {
      levels: [{ level: "stack", fields: [{ path: "slice_thickness", type: "number", class: "plain" }] }],
      axes: [{ name: "technique", values: [{ id: "MPRAGE" }, { id: "TSE" }] }],
      kinds: [{ name: "EDSS", unit: null }],
      cohorts: [{ name: "ms-cohort-b", members: 24 }],
    };
    const found = searchCatalog(cat as never, "mprage slice edss cohort-b");
    expect(found).toEqual(
      expect.arrayContaining([
        "field slice_thickness of stack (number)",
        "scan sorting technique = MPRAGE",
        "event kind EDSS",
        "cohort ms-cohort-b (24 members)",
      ]),
    );
  });
});

describe("a proposed change, decided by the person", () => {
  const dir = mkdtempSync(join(tmpdir(), "one-changes-"));

  it("records the approval first, then applies sorting words and a merge at the engine, under the person's seam", async () => {
    const engine = await stubEngine((c) =>
      c.method === "POST" && c.path === "/api/overlays"
        ? { body: { id: 31, review_item: 7 } }
        : c.method === "POST" && c.path === "/api/linkage/merge"
          ? { body: { merged: true } }
          : null,
    );
    try {
      const changes = new ChangeStore(join(dir, "changes.sqlite"));
      const ledger = new Ledger(join(dir, "seam.sqlite"));
      const seam = () =>
        seamOf(
          engine.url,
          {
            id: "one-decide",
            grant: { jobs: {}, overlays: {}, "linkage/merge": {} },
            ceiling: "operator",
            content: "catalog",
            decides: true,
          },
          "conv-a",
        );
      const deps = { changes, ledger, seam, confirmPlan: async () => ({ refused: "no plan" }) };
      const overlay = changes.propose({
        conversation: "conv-a",
        subject: "nima@n",
        kind: "overlay",
        sentence: "Add zorvex to the contrast words.",
        payload: {
          name: "zorvex",
          overlay: { buckets: { contrast_positive: { add: ["zorvex"] } } },
          scope: "batch:4",
          why: "the site's agent",
        },
      });
      // a stranger cannot decide it
      expect(await decide(deps, overlay.id, "someone@n", "approved")).toMatchObject({
        ok: false,
        status: 404,
      });
      const r = await decide(deps, overlay.id, "nima@n", "approved");
      expect(r.ok).toBe(true);
      expect(engine.seen.find((c) => c.path === "/api/overlays")?.body).toMatchObject({
        name: "zorvex",
        scope: "batch:4",
      });
      // decided once only
      expect(await decide(deps, overlay.id, "nima@n", "declined")).toMatchObject({ ok: false, status: 409 });
      const rows = ledger.rows("conv-a");
      expect(rows.some((x) => x.phase === "approval" && x.operation === "changes/overlay")).toBe(true);

      const merge = changes.propose({
        conversation: "conv-a",
        subject: "nima@n",
        kind: "identity_merge",
        sentence: "BENM01 and BENM02 are one person.",
        payload: { canonical: "BENM01", alias: "BENM02", why: "the same birth date and sex" },
      });
      expect((await decide(deps, merge.id, "nima@n", "approved")).ok).toBe(true);
      expect(engine.seen.find((c) => c.path === "/api/linkage/merge")?.body).toEqual({
        canonical: "BENM01",
        alias: "BENM02",
        why: "the same birth date and sex",
      });

      const declined = changes.propose({
        conversation: "conv-a",
        subject: "nima@n",
        kind: "identity_merge",
        sentence: "x",
        payload: {},
      });
      const before = engine.seen.length;
      expect(await decide(deps, declined.id, "nima@n", "declined")).toMatchObject({ ok: true });
      expect(engine.seen.length).toBe(before);
      expect(ledger.rows("conv-a").some((x) => x.phase === "decline")).toBe(true);

      const version = changes.propose({
        conversation: "conv-a",
        subject: "nima@n",
        kind: "query_version",
        sentence: "v",
        payload: { document: 3 },
      });
      expect(await decide(deps, version.id, "nima@n", "approved")).toMatchObject({ ok: false, status: 409 });
    } finally {
      engine.close();
    }
  });

  it("lets only a person's approval seam hold a merge, never a station's grant", () => {
    expect(() => new GrantKeeper({ "linkage/merge": {} })).toThrow(/a grant may not hold linkage\/merge/u);
    expect(() => new GrantKeeper({ "linkage/merge": {} }, true)).toThrow();
    expect(() => new GrantKeeper({ "linkage/merge": {} }, "decides")).not.toThrow();
    expect(() => new GrantKeeper({ "review/{id}/apply": {} }, "decides")).toThrow();
  });
});
