// SPDX-License-Identifier: AGPL-3.0-only
// One chat (2026-10-09), the steps of a dataset in the turn's facts. Asked
// how many T1 scans with contrast a dataset held, the chat drafted the
// question, found none, then counted the scans whose header weighting reads
// T1 and called them contrast-enhanced. Since record 56 body part and
// post-contrast are steps of their own, models run over a dataset's scans
// after the sorting, whose rules answer what the headers say: post_contrast
// given where they say contrast was given (and, on the registries measured,
// never not_given), and the body part where they name it. The facts say, for
// the datasets the words are about, which of sorted, body part,
// post-contrast, main scans and pictures have run, read once a turn from the
// engine's summary of the dataset, and until a step has run, what the headers
// answer and what is not known yet; an engine without the summary leaves them
// out; and the find skill counts the scans the headers mark as given
// contrast, says there may be more, and never answers a sorting value with
// another field in its place.
//
// What was wrong (2026-10-10): the facts said the sorting filled neither
// value, so that nothing was known of either until its step ran. The count
// of none came from the ask, which matched `given` against the label `1` the
// registry stores (an engine fault, fixed there), not from a step not run.

import { describe, expect, it } from "vitest";
import { carriedHint, type DatasetFact, datasetHint, datasetsBlock } from "../src/one/datasets.ts";
import { loadSkills } from "../src/one/skills.ts";
import { newTurn } from "../src/one/state.ts";
import {
  readSteps,
  type Step,
  stepsLine,
  stepsOf,
  stepsRead,
  stepsText,
  stepsWithin,
  unknownSentence,
} from "../src/one/steps.ts";
import { operationOf } from "../src/seam/grant.ts";
import { seamOf, stubEngine } from "./child/stub-engine.ts";

/** One dataset's summary as the Data page's door answers it (Wave 7a): its steps after its counts. */
const SUMMARY = {
  dataset: "study-a",
  state: "anonymised",
  subjects: 63,
  scans: 1003,
  unsorted: 12,
  kinds: [{ kind: "T1w", scans: 271 }],
  steps: [
    { step: "found", state: "done", job: null, files: 9000, tree: "anon" },
    { step: "read", state: "done", job: 101, files: 9000, refused: 0, reads: 1 },
    { step: "sorted", state: "waiting", job: 103, scans: 991, of: 1003, look: 1, passes: 0, unsorted: 12 },
    { step: "body_part", state: "waiting", job: null, served: true, answered: 0, look: 0, of: 1003 },
    { step: "post_contrast", state: "off", job: null, served: false, answered: 0, look: 0, of: 1003 },
    { step: "main_scans", state: "done", job: 103, picked: 120, borders: 3 },
    { step: "pictures", state: "done", job: 103, made: 1003, of: 1003, in_sort: true },
    { step: "views", state: "waiting", job: null, made: 0, of: 1003 },
  ],
};

const steps = (over: Partial<Record<Step["step"], Partial<Step>>>): Step[] =>
  (stepsOf(SUMMARY) ?? []).map((s) => ({ ...s, ...over[s.step] }));

const study: DatasetFact = {
  name: "study-a",
  state: "anonymised",
  subjects: 63,
  visits: 63,
  scans: 1003,
  sure: 990,
  look: 1,
  unsorted: 12,
  feeds: [],
  at: 0,
};

describe("a dataset's steps", () => {
  it("are the five a person sees on its card, in order, read from the dataset's summary", () => {
    expect(stepsOf(SUMMARY)).toEqual([
      { step: "sorted", state: "waiting", done: 991, of: 1003 },
      { step: "body_part", state: "waiting", done: 0, of: 1003 },
      { step: "post_contrast", state: "off", done: 0, of: 1003 },
      { step: "main_scans", state: "done", done: 120, of: null },
      { step: "pictures", state: "done", done: 1003, of: 1003 },
    ]);
    // an engine before the Data page, or an answer of another shape, has none
    for (const body of [null, {}, { steps: "all done" }, { steps: [] }, { steps: [{ step: "found" }] }])
      expect(stepsOf(body), JSON.stringify(body)).toBeNull();
  });

  it("are said in a few plain words each, and a model's step not run says its values are the headers' alone", () => {
    expect(stepsLine(steps({}))).toBe(
      "sorted 991 of 1003 scans; body part not run (from the headers only); post-contrast not run (from the headers only); main scans picked; pictures made",
    );
    expect(
      stepsLine(
        steps({
          sorted: { state: "done", done: 1003 },
          body_part: { state: "done", done: 1003 },
          post_contrast: { state: "done", done: 900 },
          main_scans: { state: "off" },
          pictures: { state: "done", done: 700 },
        }),
      ),
    ).toBe(
      "sorted; body part done; post-contrast done for 900 of 1003 scans; main scans off; pictures made for 700 of 1003 scans",
    );
    expect(
      stepsLine(
        steps({
          sorted: { state: "running", done: 0 },
          body_part: { state: "queued" },
          post_contrast: { state: "running" },
          main_scans: { state: "waiting" },
          pictures: { state: "off" },
        }),
      ),
    ).toBe("being sorted; body part queued; post-contrast running; main scans not picked yet; pictures off");
    expect(
      stepsLine(steps({ sorted: { state: "waiting", done: 0 }, pictures: { state: "waiting" } })),
    ).toMatch(/^not sorted yet; .*; no pictures yet$/u);
  });

  it("say what the headers answer and what is not known yet where body part or post-contrast has not run, and nothing once both have", () => {
    const both = unknownSentence("study-a", steps({})) ?? "";
    expect(both).toBe(
      "Body part and post-contrast have not run on study-a: a scan's body part is known where the headers name it, not yet elsewhere. The scans the headers mark as given contrast are counted, and there may be more; whether the others were is not known yet. Never count another field in their place.",
    );
    // the premise of 2026-10-09, that the sorting answers neither, is gone
    expect(both).not.toMatch(/which body part a scan shows|whether a scan was given contrast are not known/u);
    expect(unknownSentence("study-a", steps({ body_part: { state: "done", done: 1003 } }))).toBe(
      "Post-contrast has not run on study-a: the scans the headers mark as given contrast are counted, and there may be more; whether the others were is not known yet. Never count another field in its place.",
    );
    expect(unknownSentence("study-a", steps({ post_contrast: { state: "done", done: 1003 } }))).toBe(
      "Body part has not run on study-a: a scan's body part is known where the headers name it, not yet elsewhere. Never count another field in its place.",
    );
    expect(
      unknownSentence(
        "study-a",
        steps({ body_part: { state: "done" }, post_contrast: { state: "running" } }),
      ),
    ).toBe(
      "Post-contrast has not finished on study-a: the scans the headers mark as given contrast are counted, and there may be more; whether the others were is not known yet. Never count another field in its place.",
    );
    expect(
      unknownSentence("study-a", steps({ body_part: { state: "queued" }, post_contrast: { state: "off" } })),
    ).toMatch(/^Body part has not finished and post-contrast has not run on study-a: a scan's body part/u);
    expect(
      unknownSentence("study-a", steps({ body_part: { state: "done" }, post_contrast: { state: "done" } })),
    ).toBeNull();
    expect(stepsText("study-a", steps({}))).toBe(
      "The steps of study-a: sorted 991 of 1003 scans; body part not run (from the headers only); post-contrast not run (from the headers only); main scans picked; pictures made. Body part and post-contrast have not run on study-a: a scan's body part is known where the headers name it, not yet elsewhere. The scans the headers mark as given contrast are counted, and there may be more; whether the others were is not known yet. Never count another field in their place.",
    );
  });

  it("go in the hint of a dataset the words name, and of one a follow-up keeps, with nothing a tag would escape", () => {
    const text = stepsText("study-a", steps({}));
    const named = datasetHint([study], "Anything narrower is a question that names the dataset.", [text]);
    expect(named).toMatch(/Anything narrower is a question that names the dataset\. The steps of study-a: /u);
    expect(named).toMatch(/Never count another field in their place\.$/u);
    const kept = carriedHint([study], "draft the question with the dataset named.", [text]);
    expect(kept).toMatch(/Words about something else leave it\. The steps of study-a: /u);
    for (const h of [named, kept]) expect(h).not.toMatch(/[<>&]/u);
    // without steps the hint is as it was
    expect(datasetHint([study], "N.")).toMatch(/feeds no cohort\. How many [^.]*\. N\.$/u);
    // and the datasets say once that the sorting answers the two from the headers, and their steps the rest
    const block = datasetsBlock({ kind: "ok", list: [study] });
    expect(block).toMatch(
      /Body part and post-contrast are answered by the sorting from the headers, then by steps of their own run on a dataset: until a step has run, only what the headers say is known; the hint says which steps have run on a dataset the words name\./u,
    );
    expect(block).not.toMatch(/not sorting|has no answer for it yet/u);
  });

  it("are read by the summary door, which the seam's grant names with the dataset as a parameter", () => {
    expect(operationOf("GET", "/api/datasets/study-a/summary")).toBe("datasets/{name}/summary");
    expect(operationOf("GET", "/api/datasets/study%20a%2Fb/summary")).toBe("datasets/{name}/summary");
    expect(operationOf("GET", "/api/datasets/12/summary")).toBe("datasets/{name}/summary");
  });

  it("are read once a turn, and an engine without the door, a refusal or a slow door gives none", async () => {
    let slow: () => void = () => {};
    const engine = await stubEngine((c) => {
      if (c.path === "/api/datasets/study-a/summary") return { body: SUMMARY };
      if (c.path === "/api/datasets/closed/summary") return { status: 403, body: { error: "data:see" } };
      return null;
    });
    try {
      const seam = seamOf(
        engine.url,
        {
          id: "t-steps",
          grant: { "datasets/{name}/summary": {} },
          ceiling: "operator",
          content: "catalog",
        },
        "steps-a",
      );
      const o = (turn: ReturnType<typeof newTurn>, dataset: string) =>
        readSteps({ turn, dataset, seam: () => seam, toolCallId: "facts", phase: "turn" });
      const turn = newTurn("steps-a", "How many T1 scans with contrast are in study-a?");
      const [a, b] = await Promise.all([o(turn, "study-a"), o(turn, "study-a")]);
      expect(a).toEqual(stepsOf(SUMMARY));
      expect(b).toBe(a);
      expect(await o(turn, "study-a")).toBe(a);
      expect(engine.seen.filter((x) => x.path === "/api/datasets/study-a/summary")).toHaveLength(1);
      expect(stepsRead(turn, "study-a")).toEqual(a);
      // the next turn reads again
      const next = newTurn("steps-a", "And now?");
      expect(stepsRead(next, "study-a")).toBeUndefined();
      await o(next, "study-a");
      expect(engine.seen.filter((x) => x.path === "/api/datasets/study-a/summary")).toHaveLength(2);
      // no door, no dataset, no access: none, and no error
      expect(await o(turn, "study-old")).toBeNull();
      expect(await o(turn, "closed")).toBeNull();
      expect(stepsRead(turn, "closed")).toBeNull();
      // a read slower than the wait: the turn goes on without it, and it lands for the turn's tools later
      const held = new Promise<Step[] | null>((r) => {
        slow = () => r(stepsOf(SUMMARY));
      });
      expect(await stepsWithin(held, 20)).toBeNull();
      slow();
      expect(await stepsWithin(held, 20)).toEqual(stepsOf(SUMMARY));
    } finally {
      engine.close();
    }
  });
});

describe("the find skill", () => {
  const find = loadSkills(["./stations"], ["find-data"]).get("find-data");
  if (!find) throw new Error("no find-data");
  const rule = find.body.split("\n\n").find((x) => x.startsWith("**Body part** and **post-contrast**")) ?? "";

  it("counts the scans the headers mark as given contrast, says there may be more, and never answers with another field", () => {
    // the sorting answers both from the headers; their steps, models, answer the rest
    expect(rule).toMatch(/answered by the sorting from the headers, then by steps of their own/u);
    expect(rule).toMatch(/`body_part` and `body_region` where the headers name them/u);
    expect(rule).toMatch(/`post_contrast` only as `given`, where they say contrast was given/u);
    expect(rule).toMatch(/The facts say which steps have run on a dataset the words name/u);
    expect(rule).toMatch(/`registry_describe` with what dataset says it of any/u);
    // until post-contrast has run: the scans with contrast are counted and may be more; without, not counted at all
    expect(rule).toMatch(
      /Until post-contrast runs there, \*\*the scans with contrast\*\* are those `given`: count them and say there may be more/u,
    );
    expect(rule).toMatch(/\*\*the scans without contrast\*\* cannot be counted yet: say so in one sentence/u);
    // the premise of 2026-10-09 is gone: the sorting fills both where the headers say
    expect(rule).not.toMatch(/not filled by the sorting|hold an answer only where|no run button/u);
    // the field rule stands
    expect(rule).toMatch(/Never answer such a value with another field in its place/u);
    expect(rule).toMatch(/`acquisition_contrast` is the weighting[^.]*never a contrast agent/u);
    expect(rule).toMatch(/`contrast_bolus_agent` is[^.]*what the header says/u);
    // in the skill's voice, short
    expect(rule.split(/\s+/u).length).toBeLessThan(140);
    expect(rule).not.toMatch(/\bpeople\b|\bstation\b|\bdoor\b/iu);
  });

  it("names a dataset in its worked words by a made-up name, and asks for the scans given contrast whether or not the step has run", () => {
    expect(find.body).toMatch(
      /\*\*the T1 scans with contrast in study-a\*\* is a stack set with `\["=", \{\}, \["field", \{\}, "dataset"\], "study-a"\]`, `\["=", \{\}, \["axis", \{\}, "base"\], "T1w"\]` and `\["=", \{\}, \["axis", \{\}, "post_contrast"\], "given"\]`/u,
    );
    expect(find.body).not.toMatch(/where post-contrast has run on it/u);
  });
});
