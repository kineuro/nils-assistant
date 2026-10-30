// SPDX-License-Identifier: AGPL-3.0-only
// Record 57 P9: plan-analysis reads the packs, the families and the workflows from the engine's catalog, and the
// pre-flight's judgement and a workflow's plan become counts and reasons with no unit, subject or day in them.
import { describe, expect, it } from "vitest";
import { countSaid, skipsOf } from "../src/one/checks.ts";
import {
  caveatLines,
  familiesOf,
  judgedOf,
  leftOutOf,
  overviewText,
  packOf,
  packsOf,
  packText,
  planOf,
  skipLines,
  withoutUnits,
  workflowsOf,
} from "../src/stations/packs.ts";
import { entriesOf, runCommand } from "../src/stations/pipelines.ts";

const pack = {
  nils_pack: 1,
  goals: { goal: ["fast", "standard", "research"] },
  needs: {
    t1w: {
      hard: [
        {
          when: "dimension == '3D'",
          words: "the T1 is 2D; MRIQC's metrics are validated on 3D",
          source: "MRIQC docs",
        },
      ],
      soft: [{ when: "post_contrast != 'given'", words: "the T1 is post-contrast", source: "policy" }],
    },
    flair: {
      hard_if: "lesions == 'on'",
      hard: [{ when: "present(flair)", words: "no FLAIR picked", source: "wiki" }],
    },
  },
  knobs: {
    threads: { what: "the threads one session uses", comparability: "none", set_by: "person" },
    robust: { what: "the robust network", comparability: "breaks", set_by: "rule" },
    seed: { set_by: "fixed" },
  },
  rules: [
    {
      id: "robust-on-2d",
      when: "t1w.dimension == '2D'",
      set: { robust: true },
      why: "2D needs it",
      source: "paper",
    },
  ],
  checks: [{ metric: "snr", op: ">=", value: 8, action: "flag", words: "SNR under 8", source: "policy" }],
};

const catalog = {
  pipelines: [
    {
      id: 37,
      name: "mriqc",
      version: 5,
      label: "mriqc@5",
      description: "Measure image quality.",
      level: "session",
      roles: ["t1w"],
      pack,
    },
    {
      id: 21,
      name: "mriqc",
      version: 4,
      label: "mriqc@4",
      description: "Older.",
      level: "session",
      pack: "none",
    },
    {
      id: 28,
      name: "registration-ants",
      version: 1,
      label: "registration-ants@1",
      description: "ANTs.",
      level: "session",
      family: "registration",
      pack: { goals: {} },
    },
  ],
  families: [
    {
      family: true,
      name: "registration",
      words: "Align images",
      goals: { goal: ["fast", "standard"], switches: { task: ["within_session", "to_template"] } },
      tasks: {
        within_session: {
          level: "session",
          words: "the FLAIR onto the T1w",
          members: ["ants", "synthmorph"],
        },
      },
      members: [{ member: "ants", pipeline: "registration-ants", words: "rigid with mutual information" }],
      rules: [{ id: "fine-3d", route: "ants", why: "both 3D at 1.5 mm or finer", source: "Table 5 R3" }],
    },
  ],
};

const workflows = {
  workflows: [
    {
      id: 2,
      name: "flair-lesions",
      version: 1,
      label: "flair-lesions@1",
      state: "active",
      workflow: {
        title: "FLAIR lesions",
        what: "Register, then SAMSEG",
        steps: [
          {
            id: "register",
            of: "family",
            name: "registration",
            switches: { task: "within_session" },
            knobs: [],
          },
          {
            id: "samseg",
            of: "pipeline",
            name: "samseg-lesions",
            switches: { lesions: "on" },
            knobs: ["threads"],
          },
        ],
        links: [{ from: "register.flair_aligned", to: "samseg.aligned_flair" }],
      },
    },
  ],
};

describe("the catalog in the packs' own words (record 57 P9)", () => {
  it("reads needs, knobs and who sets them, rules and checks with their sources", () => {
    const p = packOf(pack);
    expect(p?.needs).toEqual([
      expect.objectContaining({
        role: "t1w",
        hard: true,
        words: expect.stringMatching(/2D/u),
        source: "MRIQC docs",
      }),
      expect.objectContaining({ role: "t1w", hard: false }),
      expect.objectContaining({ role: "flair", hard: true, hardIf: "lesions == 'on'" }),
    ]);
    expect(p?.knobs.map((k) => [k.id, k.setBy])).toEqual([
      ["threads", "person"],
      ["robust", "rule"],
      ["seed", "fixed"],
    ]);
    expect(packOf("none")).toBeNull();
    expect(packOf({ error: "a newer contract" })).toBeNull();
  });

  it("lists each analysis once, its family members under the family, and the workflows", () => {
    const text = overviewText(
      entriesOf(catalog),
      packsOf(catalog),
      familiesOf(catalog),
      workflowsOf(workflows),
    );
    expect(text).toMatch(/- mriqc@5: Measure image quality\./u);
    expect(text).not.toMatch(/mriqc@4/u);
    expect(text).not.toMatch(/- registration-ants@1/u);
    expect(text).toMatch(/a person may set: threads \(the threads one session uses\)/u);
    expect(text).toMatch(/set by its rules per session, never by hand: robust/u);
    expect(text).toMatch(
      /skips a session where: the T1 is 2D.*no FLAIR picked \(only when lesions == 'on'\)/u,
    );
    expect(text).toMatch(/- registration: Align images/u);
    expect(text).toMatch(/- flair-lesions@1: FLAIR lesions\. Register, then SAMSEG/u);
    expect(text).toMatch(
      /register \(the family registration, task within_session\) then samseg \(samseg-lesions, lesions on\)/u,
    );
    expect(text).toMatch(/a person may set: samseg\.threads/u);
  });

  it("gives one analysis in full with the source of each need, rule and check, and no fixed knob", () => {
    const [e] = entriesOf(catalog);
    const text = packText(e, packOf(pack));
    expect(text).toMatch(/the T1 is 2D; MRIQC's metrics are validated on 3D \[MRIQC docs\]/u);
    expect(text).toMatch(/robust-on-2d: 2D needs it \[paper\]/u);
    expect(text).toMatch(/SNR under 8 \(flag\) \[policy\]/u);
    expect(text).toMatch(/results with another value are not comparable/u);
    expect(text).not.toMatch(/- seed/u);
  });
});

const preflight = {
  unit: "session",
  units: { total: 5, ready: 3, missing: 0 },
  cannot: [{ why: "its T1w is released as UNIT1", units: 2, named: ["sub-1_ses-x"] }],
  main: {
    visits: 9,
    main_visits: 5,
    without: {
      visits: 4,
      why: [
        { why: "it holds no t1w scan", visits: 2 },
        { why: "it holds a t1w scan and none is picked", visits: 2 },
      ],
      named: [{ subject_id: 3, subject: "abc", session_day: "2020-01-01", why: "x" }],
    },
  },
  units_judged: {
    ready: 3,
    skipped: 2,
    routed: 0,
    cannot_tell: 1,
    with_caveats: 1,
    skipped_by_why: [{ why: "the T1 is 2D", units: 1 }],
    units: [
      {
        unit: "sub-1_ses-a",
        subject_id: 1,
        session_day: "2020-01-01",
        status: "skipped",
        words: "the T1 is 2D",
      },
      {
        unit: "sub-2_ses-b",
        subject_id: 2,
        status: "skipped",
        cannot_tell: "t1w.dimension",
        words: "cannot tell: t1w.dimension",
      },
      { unit: "sub-3_ses-c", subject_id: 3, status: "ready", caveats: ["the T1 is post-contrast"] },
    ],
  },
};

describe("the pre-flight's judgement as counts and reasons", () => {
  it("says who is left out, cannot run, is skipped and why, with no unit named", () => {
    const lines = skipLines({
      unit: "session",
      judged: judgedOf(preflight),
      leftOut: leftOutOf(preflight),
      cannot: [{ why: "its T1w is released as UNIT1", units: 2 }],
    });
    expect(lines).toEqual([
      "left out before the run: 4 sessions of 9 (2: it holds no t1w scan; 2: it holds a t1w scan and none is picked)",
      "cannot run: 2 sessions: its T1w is released as UNIT1",
      "skipped: 1 session: the T1 is 2D",
      "skipped: 1 session: the registry cannot tell t1w.dimension (a person may let it run)",
    ]);
    expect(caveatLines("session", judgedOf(preflight))).toEqual([
      "runs with a caveat, 1 session: the T1 is post-contrast",
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/sub-|2020|abc/u);
  });

  it("keeps the pre-flight on the card without a unit's name, subject or day", () => {
    const kept = JSON.stringify(withoutUnits(preflight));
    expect(kept).not.toMatch(/sub-|2020-01-01|"abc"|subject_id/u);
    expect(kept).toMatch(/"skipped_by_why"/u);
  });

  it("reads a workflow's plan: each step's counts, the family's routing, the links not simply fed", () => {
    const plan = planOf({
      runnable: true,
      words: "2 steps planned; every link holds",
      verdicts: { fed: 1, missing: 1 },
      steps: [
        {
          step: "register",
          pipeline: "registration",
          preflight: {
            family: "registration",
            units: [
              {
                status: "routed",
                member: "synthmorph",
                why: "one image is 2D",
                subject_id: 9,
                unit: "sub-9",
              },
              { status: "routed", member: "ants", why: "both 3D", unit: "sub-8" },
              { status: "skipped", words: "cannot tell: flair.body_part", cannot_tell: "flair.body_part" },
            ],
            counts: { units: 3, routed: 2, skipped: 1, cannot_tell: 1, skipped_by_words: [] },
          },
        },
        {
          step: "segcsvd",
          pipeline: "segcsvd@6",
          preflight: {
            unit: "session",
            units: { total: 3, ready: 0 },
            units_judged: {
              skipped: 3,
              skipped_by_why: [{ why: "a side of the T1's voxel is over 1.2 mm", units: 3 }],
            },
            blockers: ["no session can run"],
          },
        },
      ],
      links: [
        { verdict: "fed", words: "fed by register" },
        { verdict: "missing", words: "register.brain_mask is fed by no step" },
      ],
    });
    expect(plan.steps[0]).toMatchObject({ units: { total: 3, ready: 2 } });
    expect(plan.steps[0].lines).toEqual([
      "skipped: 1 session: the registry cannot tell flair.body_part (a person may let it run)",
      "routed to synthmorph: 1 session: one image is 2D",
      "routed to ants: 1 session: both 3D",
    ]);
    expect(plan.steps[1].lines).toEqual(["skipped: 3 sessions: a side of the T1's voxel is over 1.2 mm"]);
    expect(plan.links).toEqual([{ verdict: "missing", words: "register.brain_mask is fed by no step" }]);
    expect(skipsOf({ plan })).toHaveLength(4);
  });
});

describe("the answer says every count the check gave", () => {
  it("finds a line's count in digits or words", () => {
    expect(
      countSaid("Two sessions are skipped because the T1 is 2D.", "skipped: 2 sessions: the T1 is 2D"),
    ).toBe(true);
    expect(countSaid("Sessions are skipped because the T1 is 2D.", "skipped: 2 sessions: the T1 is 2D")).toBe(
      false,
    );
  });

  it("queues the person's goal and switches as the run takes them", () => {
    expect(
      runCommand(
        "samseg-lesions@6",
        { select: "main@dataset:a" },
        {},
        { goal: "fast", switches: { lesions: "off" } },
      ),
    ).toEqual([
      "run",
      "samseg-lesions@6",
      "--select",
      "main@dataset:a",
      "--goal",
      "fast",
      "--switch",
      "lesions=off",
    ]);
  });
});
