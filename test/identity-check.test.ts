// SPDX-License-Identifier: AGPL-3.0-only
// identity-check (Wave 4c D7, record 26): the manifest, the path question, that a value never passes as a
// shape, a probe over a dataset's originals by name, the identifier types and the held shapes read through
// the seam, and the held reading against the rule's shapes.

import { afterAll, describe, expect, it } from "vitest";
import { FORBIDDEN, GrantKeeper } from "../src/seam/grant.ts";
import { admitPath } from "../src/seam/redactor.ts";
import {
  candidateFor,
  carriesValue,
  datasetName,
  heldReading,
  heldShapesOf,
  heldVerdict,
  identityCheckChecks,
  identityCheckTools,
  probesOf,
  proposedOf,
  rootOf,
  ruleComplaint,
  shapesOf,
  typeNames,
  typesOf,
  usesPath,
} from "../src/stations/identity-check.ts";
import { loadManifests } from "../src/stations/manifest.ts";
import type { Verdict } from "../src/stations/verdict.ts";
import { seamOf, stubEngine, toolContext } from "./child/stub-engine.ts";

const verdict = (result: Record<string, unknown>): Verdict => ({ result }) as unknown as Verdict;

const CURRENT = { id_type: "patient-id", from: [{ field: "PatientID" }] };
const CANDIDATE = {
  id_type: "study-id",
  from: [{ field: "PatientID", pattern: "^(?<id>[A-Z]{2}[0-9]{4})$" }],
};
const PATH_RULE = {
  id_type: "subject-code",
  code: "verbatim",
  from: [{ path: { segment: 1 }, pattern: "^(?<id>[A-Z]{3}[0-9]{3})$" }],
};

/** The probe's answer, as the engine shapes it: candidates in the order the rules were sent, shapes only. */
const PROBE_RESULT = {
  sample: { asked: 500, files: 120, parsed: 120, refused: 0 },
  candidates: [
    {
      label: "rules[0]",
      rule: { id_type: "patient-id", sources: ["PatientID"] },
      files: 120,
      sources: [
        {
          source: "PatientID",
          answered: 120,
          empty: 0,
          unparsed: 0,
          unread: 0,
          shapes: { AA9999: 110, "99999999-9999": 10 },
          other_shapes: 0,
        },
      ],
      identity_constant: { constant: false, shape: "AA9999", files: 120, distinct: 40 },
      subjects: 40,
      studies: 44,
      diagnostics: { odd_header: { count: 2, samples: ["never shown"] } },
    },
    {
      label: "rules[1]",
      rule: { id_type: "study-id", sources: ["PatientID"] },
      files: 120,
      sources: [
        {
          source: "PatientID",
          answered: 110,
          empty: 10,
          unparsed: 0,
          unread: 0,
          shapes: { AA9999: 110 },
          other_shapes: 0,
        },
      ],
      identity_constant: { constant: false, shape: "AA9999", files: 110, distinct: 40 },
      subjects: 40,
      studies: 44,
      diagnostics: {},
    },
  ],
};

const closers: (() => void)[] = [];
afterAll(() => {
  for (const c of closers) c();
});

/** A stub engine with one dataset, two identifier types and held shapes as the test names them. */
async function engine(held: { shape: string; files: number; first_seen?: string; batch?: number }[]) {
  const e = await stubEngine((c) => {
    if (c.path === "/api/sources")
      return {
        body: {
          sources: [
            {
              name: "scanner-a",
              arrives: "identified",
              identity: CURRENT,
              unmapped: "hold",
              held: { files: held.reduce((n, h) => n + h.files, 0), identifiers: held.length },
              trees: {
                originals: { path: "/never/shown", files: 120, bytes: 1 },
                anon: { path: "/never", files: 100 },
              },
            },
          ],
        },
      };
    if (c.path === "/api/linkage/types")
      return {
        body: {
          types: [
            { name: "patient-id", description: "the tag" },
            { name: "study-id", description: "a study's own" },
          ],
        },
      };
    if (c.path.startsWith("/api/linkage/held?place=scanner-a")) return { body: held };
    if (c.path === "/api/ingest/probe" && c.method === "POST")
      return { status: 202, body: { job: 7, state: "queued" } };
    if (c.path === "/api/jobs/7") return { body: { id: 7, state: "done", result: PROBE_RESULT } };
    return null;
  });
  closers.push(e.close);
  return e;
}

const GRANT = {
  capabilities: {},
  sources: {},
  "linkage/types": {},
  "linkage/held": {},
  "ingest/probe": {},
  "jobs/{id}": {},
};

const tool = (name: string) => {
  const t = identityCheckTools().find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

describe("identity-check", () => {
  it("holds the probe at the operator ceiling, reads the dataset, the types and the held shapes, and writes a rule and a review decision", () => {
    const m = loadManifests(["./stations"]).get("identity-check");
    if (!m) throw new Error("no identity-check manifest");
    expect(m.ceiling).toBe("operator");
    expect(Object.keys(m.grant).sort()).toEqual([
      "capabilities",
      "ingest/probe",
      "jobs/{id}",
      "linkage/held",
      "linkage/types",
      "sources",
    ]);
    expect(m.writes).toEqual(["identity_rule", "review_decision"]);
    expect(m.checks).toEqual([
      "rule_validated",
      "names_rule_and_saw",
      "no_identifier_value",
      "path_answered",
      "type_named",
      "held_read",
    ]);
    const props = m.result.properties as Record<string, unknown>;
    for (const k of ["dataset", "new_type", "held", "map_needed"]) expect(props).toHaveProperty(k);
  });

  it("a station may dial the two linkage reads that answer names and shapes, and no other linkage door", () => {
    expect(admitPath("/api/linkage/types", "GET").ok).toBe(true);
    expect(admitPath("/api/linkage/held?place=scanner-a", "GET").ok).toBe(true);
    expect(admitPath("/api/linkage/types", "POST").ok).toBe(false);
    expect(admitPath("/api/linkage/held/reveal", "POST").ok).toBe(false);
    expect(admitPath("/api/linkage/held/code", "POST").ok).toBe(false);
    expect(admitPath("/api/linkage/imports", "POST").ok).toBe(false);
    expect(admitPath("/api/linkage/merge", "POST").ok).toBe(false);
    expect(admitPath("/api/linkage/held", "PUT").ok).toBe(false);
    expect(admitPath("/api/ask/values", "POST").ok).toBe(false);
    for (const f of ["linkage/imports", "linkage/held/reveal", "linkage/held/code", "linkage/merge"]) {
      expect(FORBIDDEN).toContain(f);
      expect(() => new GrantKeeper({ [f]: {} })).toThrow(/a person's/u);
    }
  });

  it("tells a shape from a value", () => {
    expect(carriesValue("PatientID answered AAAA on 100 files; path segment 1 answered AAA999")).toBeNull();
    expect(carriesValue("the folder AAA111 held the code")).toBe("AAA111");
    expect(carriesValue("born 19840110-1234")).toBe("19840110-1234");
    expect(carriesValue("held shape 99999999-9999 on 10 files")).toBeNull();
    expect(usesPath({ id_type: "subject-code", from: [{ path: { segment: 1 } }] })).toBe(true);
    expect(usesPath({ id_type: "patient-id", from: [{ field: "PatientID" }] })).toBe(false);
  });

  it("says what is wrong with a rule before the grant is spent", () => {
    expect(ruleComplaint({ id_type: "patient-id", from: [{ field: "PatientID" }] })).toBeNull();
    expect(ruleComplaint(PATH_RULE)).toBeNull();
    expect(ruleComplaint({ id_type: "PatientID", from: [{ field: "PatientID" }] })).toMatch(/lowercase/u);
    expect(ruleComplaint({ id_type: "patient-id" })).toMatch(/from is a list/u);
    expect(
      ruleComplaint({ id_type: "subject", from: [{ path: { segment: 1 }, pattern: "[A-Z]{3}[0-9]{3}" }] }),
    ).toMatch(/named group/u);
    expect(ruleComplaint({ id_type: "subject", from: [{ segment: 1 }] })).toMatch(/one of the two/u);
  });

  it("a dataset is one name and its originals are the probe's root, never a path", () => {
    expect(datasetName("scanner-a")).toBe("scanner-a");
    expect(datasetName("@scanner-a")).toBe("scanner-a");
    expect(datasetName("scanner-a/2026")).toBeNull();
    expect(datasetName("")).toBeNull();
    expect(rootOf("scanner-a")).toBe("@scanner-a/originals");
    expect(typeNames({ types: [{ name: "patient-id" }, "study-id", { name: "Bad Name" }] })).toEqual([
      "patient-id",
      "study-id",
    ]);
    expect(typeNames(["a-type"])).toEqual(["a-type"]);
    expect(
      heldShapesOf([{ shape: "AA9999", files: 3, first_seen: "2026-09-15", batch: 4, value: "never" }]),
    ).toEqual([{ shape: "AA9999", files: 3, first_seen: "2026-09-15", batch: 4 }]);
    expect(heldShapesOf({ held: [{ files: 3 }] })).toEqual([]);
  });

  it("reads the held shapes against the rule's: alike is a map, unlike is a second kind", () => {
    const held = (shapes: string[]) =>
      shapes.map((shape) => ({ shape, files: 1, first_seen: null, batch: null }));
    expect(heldReading([], ["AA9999"])).toEqual({ reading: "none", map_needed: false });
    expect(heldReading(held(["AA9999"]), ["AA9999"])).toEqual({ reading: "same_kind", map_needed: true });
    expect(heldReading(held(["99999999-9999"]), ["AA9999"])).toEqual({
      reading: "second_kind",
      map_needed: false,
    });
    expect(heldReading(held(["AA9999", "99999999-9999"]), ["AA9999"])).toEqual({
      reading: "mixed",
      map_needed: true,
    });
    expect(heldReading(held(["AA9999"]), null)).toEqual({ reading: "unknown", map_needed: false });
    expect(shapesOf(PROBE_RESULT.candidates[0])).toEqual(["AA9999", "99999999-9999"]);
    expect(shapesOf(undefined)).toEqual([]);
    const probed = [
      {
        job: 7,
        dataset: "scanner-a",
        location: null,
        rules: [CURRENT, CANDIDATE],
        at: 1,
        candidates: PROBE_RESULT.candidates,
      },
    ];
    expect(candidateFor(probed, CANDIDATE)?.label).toBe("rules[1]");
    expect(candidateFor(probed, PATH_RULE)).toBeNull();
  });

  it("refuses a verdict that names no source, no shapes, or a value", () => {
    const checks = identityCheckChecks();
    expect(checks.names_rule_and_saw(verdict({ sentence: "use the folder", saw: [] }), {})).toMatch(
      /names no source|saw is the list/u,
    );
    expect(
      checks.names_rule_and_saw(
        verdict({
          sentence: "path segment 1 answered AAA999 on every file",
          saw: [{ rule: "rule 2", source: "path segment 1", shape: "AAA999", answered: 100 }],
        }),
        {},
      ),
    ).toBeNull();
    expect(checks.no_identifier_value(verdict({ sentence: "the folder was AAA111" }), {})).toMatch(
      /value, not a shape: AAA999/u,
    );
    expect(checks.rule_validated(verdict({ proposed: {} }), { conversation: "none" })).toMatch(
      /no rule was proposed/u,
    );
    expect(checks.type_named(verdict({}), { conversation: "none" })).toMatch(/no rule was proposed/u);
    expect(checks.held_read(verdict({}), { conversation: "none" })).toBeNull();
  });

  it("over a dataset: the probe reads the originals by name, the held shapes of the rule's kind need a map, and the rule names a known type", async () => {
    const e = await engine([{ shape: "AA9999", files: 10, first_seen: "2026-09-15T00:00:00Z", batch: 3 }]);
    const conversation = "c-same-kind";
    const seam = seamOf(
      e.url,
      { id: "identity-check", grant: GRANT, ceiling: "operator", content: "rows" },
      conversation,
    );
    const ctx = (phase: string, n: number) => toolContext(seam, conversation, phase, n);
    // the dataset as declared, no path
    const ds = await tool("nils_dataset").run({ dataset: "scanner-a" }, ctx("read", 1));
    expect(ds.output).toMatchObject({
      name: "scanner-a",
      arrives: "identified",
      identity: CURRENT,
      originals: { files: 120 },
    });
    expect(JSON.stringify(ds.output)).not.toContain("/never");
    expect((await tool("nils_dataset").run({ dataset: "elsewhere" }, ctx("read", 2))).output).toMatchObject({
      refused: true,
      why: "no dataset named elsewhere; the datasets are scanner-a",
    });
    // the types and the held shapes, through the seam
    const types = await tool("nils_identifier_types").run({}, ctx("read", 3));
    expect(types.output).toEqual({
      types: [
        { name: "patient-id", description: "the tag" },
        { name: "study-id", description: "a study's own" },
      ],
    });
    expect(typesOf(conversation)).toEqual(["patient-id", "study-id"]);
    const held = await tool("nils_held").run({ dataset: "scanner-a" }, ctx("read", 4));
    expect(held.output).toMatchObject({
      dataset: "scanner-a",
      held: [{ shape: "AA9999", files: 10, batch: 3 }],
    });
    // the probe over the originals, by root, never a path, and one of dataset or location
    expect(
      (await tool("nils_probe").run({ rules: [CURRENT, CANDIDATE] }, ctx("diagnose", 5))).output,
    ).toMatchObject({ refused: true, why: expect.stringMatching(/one of the two/u) });
    expect(
      (await tool("nils_probe").run({ dataset: "a/b", rules: [CURRENT, CANDIDATE] }, ctx("diagnose", 6)))
        .output,
    ).toMatchObject({ refused: true, why: expect.stringMatching(/one name/u) });
    const probe = await tool("nils_probe").run(
      { dataset: "scanner-a", rules: [CURRENT, CANDIDATE] },
      ctx("diagnose", 7),
    );
    expect(probe.output).toMatchObject({ job: 7, state: "queued" });
    const dialled = e.seen.find((c) => c.path === "/api/ingest/probe");
    expect(dialled?.body).toEqual({ root: "@scanner-a/originals", sample: 500, rules: [CURRENT, CANDIDATE] });
    expect(probesOf(conversation)[0]).toMatchObject({ job: 7, dataset: "scanner-a", location: null });
    // the job's result, the diagnostics' samples dropped, the candidates kept for the held reading
    const job = await tool("nils_job").run({ job: 7 }, ctx("diagnose", 8));
    expect(JSON.stringify(job.output)).not.toContain("never shown");
    expect((job.output as { result: { candidates: unknown[] } }).result.candidates.length).toBe(2);
    expect(probesOf(conversation)[0].candidates?.length).toBe(2);
    // a rule of an unknown type is refused unless proposed as new; the current rule names a known one
    expect(
      (
        await tool("propose_rule").run(
          { rule: { id_type: "other-id", from: [{ field: "PatientID" }] }, why: "x" },
          ctx("propose", 9),
        )
      ).output,
    ).toMatchObject({ refused: true, why: expect.stringMatching(/not one the probe took/u) });
    const proposed = await tool("propose_rule").run(
      { rule: CURRENT, why: "the tag answers one shape" },
      ctx("propose", 10),
    );
    expect(proposed.output).toMatchObject({ recorded: true });
    expect(proposedOf(conversation)?.new_type).toBeNull();
    // the held reading: the held shape is one the rule answered with, so a map is needed
    expect(heldVerdict(conversation)).toEqual({
      held: { shapes: [{ shape: "AA9999", files: 10 }], reading: "same_kind" },
      map_needed: true,
    });
    const checks = identityCheckChecks();
    const ok = verdict({
      location: "scanner-a",
      saw: [{ source: "PatientID", shape: "AA9999" }],
      proposed: CURRENT,
      held: { shapes: [{ shape: "AA9999", files: 10 }], reading: "same_kind" },
      map_needed: true,
      sentence:
        "PatientID answered AA9999; the held files carry the same shape, so a map is needed, not a rule change.",
    });
    expect(checks.type_named(ok, { conversation })).toBeNull();
    expect(checks.held_read(ok, { conversation })).toBeNull();
    expect(checks.held_read(verdict({ ...ok.result, held: { reading: "none" } }), { conversation })).toMatch(
      /held.reading is same_kind/u,
    );
    expect(checks.held_read(verdict({ ...ok.result, map_needed: false }), { conversation })).toMatch(
      /map_needed is true/u,
    );
    expect(
      checks.held_read(verdict({ ...ok.result, sentence: "PatientID answered AA9999." }), { conversation }),
    ).toMatch(/a map is needed, not a rule change/u);
  });

  it("over a dataset: a held shape unlike the rule's is a second kind, and a new type is proposed with a description", async () => {
    const e = await engine([{ shape: "99999999-9999", files: 4 }]);
    const conversation = "c-second-kind";
    const seam = seamOf(
      e.url,
      { id: "identity-check", grant: GRANT, ceiling: "operator", content: "rows" },
      conversation,
    );
    const ctx = (phase: string, n: number) => toolContext(seam, conversation, phase, n);
    await tool("nils_identifier_types").run({}, ctx("read", 1));
    await tool("nils_held").run({ dataset: "scanner-a" }, ctx("read", 2));
    const NEW = {
      id_type: "site-code",
      from: [{ field: "PatientID", pattern: "^(?<id>[A-Z]{2}[0-9]{4})$" }],
    };
    await tool("nils_probe").run({ dataset: "scanner-a", rules: [CURRENT, NEW] }, ctx("diagnose", 3));
    await tool("nils_job").run({ job: 7 }, ctx("diagnose", 4));
    // the type is not the registry's: refused without new_type, recorded with it
    expect((await tool("propose_rule").run({ rule: NEW, why: "x" }, ctx("propose", 5))).output).toMatchObject(
      { refused: true, why: expect.stringMatching(/site-code is not a type the registry knows/u) },
    );
    const proposed = await tool("propose_rule").run(
      { rule: NEW, why: "x", new_type: { name: "site-code", description: "the site's own code" } },
      ctx("propose", 6),
    );
    expect(proposed.output).toMatchObject({ recorded: true });
    expect(proposedOf(conversation)?.new_type).toEqual({
      name: "site-code",
      description: "the site's own code",
    });
    // the candidate at the rule's place answered AA9999 only; the held shape is unlike it
    expect(heldVerdict(conversation)).toEqual({
      held: { shapes: [{ shape: "99999999-9999", files: 4 }], reading: "second_kind" },
      map_needed: false,
    });
    const checks = identityCheckChecks();
    const base = {
      location: "scanner-a",
      saw: [{ source: "PatientID", shape: "AA9999" }],
      proposed: NEW,
      held: { shapes: [{ shape: "99999999-9999", files: 4 }], reading: "second_kind" },
      map_needed: false,
    };
    expect(checks.type_named(verdict({ ...base, new_type: null, sentence: "s" }), { conversation })).toMatch(
      /no new type with a description/u,
    );
    expect(
      checks.type_named(
        verdict({
          ...base,
          new_type: { name: "site-code", description: "the site's own code" },
          sentence: "s",
        }),
        { conversation },
      ),
    ).toBeNull();
    expect(
      checks.held_read(verdict({ ...base, sentence: "PatientID answered AA9999." }), { conversation }),
    ).toMatch(/second kind of identifier/u);
    expect(
      checks.held_read(
        verdict({
          ...base,
          sentence:
            "PatientID answered AA9999; the held shape is unlike the rule's, a second kind of identifier is on this dataset.",
        }),
        { conversation },
      ),
    ).toBeNull();
  });

  it("over a dataset: the types and the held shapes must have been read before settling", async () => {
    const e = await engine([]);
    const conversation = "c-unread";
    const seam = seamOf(
      e.url,
      { id: "identity-check", grant: GRANT, ceiling: "operator", content: "rows" },
      conversation,
    );
    const ctx = (phase: string, n: number) => toolContext(seam, conversation, phase, n);
    await tool("nils_probe").run({ dataset: "scanner-a", rules: [CURRENT, CANDIDATE] }, ctx("diagnose", 1));
    await tool("propose_rule").run({ rule: CURRENT, why: "x" }, ctx("propose", 2));
    const checks = identityCheckChecks();
    const v = verdict({
      location: "scanner-a",
      saw: [{ source: "PatientID", shape: "AA9999" }],
      proposed: CURRENT,
      sentence: "PatientID answered AA9999.",
    });
    expect(checks.type_named(v, { conversation })).toMatch(/identifier types were not read/u);
    expect(checks.held_read(v, { conversation })).toMatch(/held identifiers were not read/u);
    await tool("nils_identifier_types").run({}, ctx("diagnose", 3));
    await tool("nils_held").run({ dataset: "scanner-a" }, ctx("diagnose", 4));
    expect(checks.type_named(v, { conversation })).toBeNull();
    expect(heldVerdict(conversation)).toEqual({ held: { shapes: [], reading: "none" }, map_needed: false });
    expect(
      checks.held_read(verdict({ ...v.result, held: { shapes: [], reading: "none" }, map_needed: false }), {
        conversation,
      }),
    ).toBeNull();
  });

  it("over a registered location, as before datasets: no types, no held, and the probe names the location", async () => {
    const e = await engine([]);
    const conversation = "c-location";
    const seam = seamOf(
      e.url,
      { id: "identity-check", grant: GRANT, ceiling: "operator", content: "rows" },
      conversation,
    );
    const ctx = (phase: string, n: number) => toolContext(seam, conversation, phase, n);
    await tool("nils_probe").run({ location: "src", rules: [CURRENT, PATH_RULE] }, ctx("diagnose", 1));
    expect(e.seen.find((c) => c.path === "/api/ingest/probe")?.body).toEqual({
      location: "src",
      sample: 500,
      rules: [CURRENT, PATH_RULE],
    });
    expect(
      (await tool("propose_rule").run({ rule: PATH_RULE, why: "x" }, ctx("propose", 2))).output,
    ).toMatchObject({ refused: true, why: expect.stringMatching(/direct identifier/u) });
    await tool("propose_rule").run(
      { rule: PATH_RULE, why: "x", path_is_direct_identifier: false },
      ctx("propose", 3),
    );
    const checks = identityCheckChecks();
    const v = verdict({
      location: "src",
      saw: [{ source: "path segment 1", shape: "AAA999" }],
      proposed: PATH_RULE,
      path_is_direct_identifier: false,
      sentence: "path segment 1 answered AAA999.",
    });
    expect(checks.type_named(v, { conversation })).toBeNull();
    expect(checks.held_read(v, { conversation })).toBeNull();
    expect(checks.path_answered(v, { conversation })).toBeNull();
    expect(heldVerdict(conversation)).toEqual({ held: null, map_needed: null });
  });
});
