// SPDX-License-Identifier: AGPL-3.0-only
// keyword-tune (Wave 4c D6, record 26): the manifest, the overlay a hypothesis becomes for a bucket and for a
// value's list, the diff read from a rehearsal, the signals read by value, the pack's lists read before a term
// is added, and the one-file check over a list of either kind.

import { afterAll, describe, expect, it } from "vitest";
import {
  diffOf,
  keywordTuneChecks,
  keywordTuneTools,
  listName,
  listsOfPack,
  listsTouched,
  overlayOf,
  type Prediction,
  packListOf,
  predictionOf,
  valuesOf,
  valuesSeen,
} from "../src/stations/keyword-tune.ts";
import { loadManifests } from "../src/stations/manifest.ts";
import type { Verdict } from "../src/stations/verdict.ts";
import { seamOf, stubEngine, toolContext } from "./child/stub-engine.ts";

const p: Prediction = {
  axis: "post_contrast",
  bucket: "contrast_positive",
  value: null,
  list: "contrast_positive",
  add: ["zzgado"],
  remove: [],
  flip: ["post_contrast:vote|1|"],
  must_not_regress: ["post_contrast=0"],
  at: 1,
};

const onValue: Prediction = { ...p, bucket: null, value: "1", list: "post_contrast.1" };

const verdict = (result: Record<string, unknown>): Verdict => ({ result }) as unknown as Verdict;

const closers: (() => void)[] = [];
afterAll(() => {
  for (const c of closers) c();
});

const GRANT = { "classify/signals": {}, "packs/{name}": {}, review: {}, "classify/try": {}, overlays: {} };

const tool = (name: string) => {
  const t = keywordTuneTools().find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

describe("keyword-tune", () => {
  it("has the grant of section 9.13 with the pack door, writes an overlay and a review decision, and re-enters at hypothesise", () => {
    const m = loadManifests(["./stations"]).get("keyword-tune");
    if (!m) throw new Error("no keyword-tune manifest");
    expect(Object.keys(m.grant).sort()).toEqual([
      "classify/signals",
      "classify/try",
      "overlays",
      "overlays/{id}",
      "packs/{name}",
      "review",
      "review/{id}",
    ]);
    expect(m.writes).toEqual(["overlay", "review_decision"]);
    expect(m.phases.follow_up).toBe("hypothesise");
    expect(m.checks).toEqual([
      "one_file",
      "prediction_before_rehearsal",
      "rehearsal_wrote_nothing",
      "groups_exist",
    ]);
    expect(m.result.required).toEqual(["axis", "list", "sentence", "diff"]);
  });

  it("turns a hypothesis into an overlay of one bucket, or of one value's list as axis.value, with the site's case", () => {
    const o = overlayOf(p, { manufacturer: "SYNTHETIC" }, "t1 mprage zzgado", "1");
    expect(o.buckets).toEqual({ contrast_positive: { add: ["zzgado"] } });
    expect(o.lists).toBeUndefined();
    expect(o.scope).toEqual({ manufacturer: "SYNTHETIC" });
    expect((o.cases as { axes: Record<string, string> }[])[0].axes).toEqual({ post_contrast: "1" });
    const l = overlayOf({ ...onValue, remove: ["gd"] }, {}, "t1 mprage zzgado", "1");
    expect(l.lists).toEqual({ "post_contrast.1": { add: ["zzgado"], remove: ["gd"] } });
    expect(l.buckets).toBeUndefined();
    expect((l.cases as { name: string }[])[0].name).toBe("the site's post_contrast.1 term");
    expect(listsTouched(o)).toEqual(["contrast_positive"]);
    expect(listsTouched(l)).toEqual(["post_contrast.1"]);
    expect(listsTouched({ buckets: { a: {} }, lists: { "x.y": {} } })).toEqual(["a", "x.y"]);
    expect(listName("technique", null, "mprage")).toBe("technique.mprage");
    expect(listName("technique", "tech_bucket", null)).toBe("tech_bucket");
  });

  it("reads the values the signals report by value, and the lists a pack answers in either shape", () => {
    expect(valuesOf({ "0": {}, "1": {} })).toEqual(["0", "1"]);
    expect(valuesOf([{ value: "mprage" }, "tse"])).toEqual(["mprage", "tse"]);
    expect(valuesOf(null)).toEqual([]);
    const asLists = listsOfPack({
      axes: [
        {
          axis: "post_contrast",
          values: [
            { value: "1", keywords: ["Gad", "gd"] },
            { value: "0", keywords: [] },
          ],
        },
      ],
      buckets: [{ bucket: "contrast_positive", keywords: ["gad"] }],
    });
    expect([...asLists]).toEqual([
      ["post_contrast.1", ["gad", "gd"]],
      ["post_contrast.0", []],
      ["contrast_positive", ["gad"]],
    ]);
    const asObjects = listsOfPack({
      axes: { technique: { values: { mprage: { keywords: ["mprage", "mp-rage"] }, tse: ["tse"] } } },
      buckets: { tech_bucket: { terms: ["x"] } },
    });
    expect(asObjects.get("technique.mprage")).toEqual(["mprage", "mp-rage"]);
    expect(asObjects.get("technique.tse")).toEqual(["tse"]);
    expect(asObjects.get("tech_bucket")).toEqual(["x"]);
    expect(listsOfPack(null).size).toBe(0);
  });

  it("reads keep, partial and revert from the rehearsal against the prediction", () => {
    expect(
      diffOf(p, {
        moves: [{ axis: "post_contrast", from: "", to: "1", stacks: 17 }],
        review_items: { close: 1, open: 0 },
      }).verdict,
    ).toBe("keep");
    expect(
      diffOf(p, {
        moves: [{ axis: "post_contrast", from: "", to: "1", stacks: 17 }],
        review_items: { close: 0, open: 2 },
      }).verdict,
    ).toBe("partial");
    expect(diffOf(p, { moves: [], review_items: { close: 0, open: 0 } }).verdict).toBe("partial");
    expect(
      diffOf(p, {
        moves: [{ axis: "post_contrast", from: "0", to: "1", stacks: 2 }],
        review_items: { close: 0, open: 0 },
      }),
    ).toMatchObject({ verdict: "revert", why: expect.stringMatching(/must not regress/u) });
    expect(
      diffOf(p, {
        moves: [{ axis: "technique", from: "SE", to: "MPRAGE", stacks: 1 }],
        review_items: { close: 0, open: 0 },
      }),
    ).toMatchObject({ verdict: "revert", why: expect.stringMatching(/not the axis/u) });
  });

  it("a hypothesis names one list of either kind, a value the signals showed, and no term the pack's list already holds", async () => {
    const e = await stubEngine((c) => {
      if (c.path.startsWith("/api/classify/signals"))
        return {
          body: {
            axes: {
              post_contrast: {
                open_review: { "post_contrast:vote|1|": 3 },
                by_value: { "0": { keywords: 40 }, "1": { keywords: 10 } },
              },
              technique: { open_review: {}, by_value: [{ value: "mprage" }, { value: "tse" }] },
            },
          },
        };
      if (c.path === "/api/packs/mri")
        return {
          body: {
            name: "mri",
            axes: [
              {
                axis: "post_contrast",
                values: [
                  { value: "1", keywords: ["gad", "gd"] },
                  { value: "0", keywords: [] },
                ],
              },
              { axis: "technique", values: [{ value: "mprage", keywords: ["mprage"] }] },
            ],
            buckets: { contrast_positive: { keywords: ["gad"] } },
          },
        };
      return null;
    });
    closers.push(e.close);
    const conversation = "c-lists";
    const seam = seamOf(
      e.url,
      { id: "keyword-tune", grant: GRANT, ceiling: "reviewer", content: "rows" },
      conversation,
    );
    const ctx = (phase: string, n: number) => toolContext(seam, conversation, phase, n);
    await tool("nils_signals").run({ scope: "batch:1" }, ctx("survey", 1));
    expect(valuesSeen(conversation, "post_contrast")).toEqual(["0", "1"]);
    expect(valuesSeen(conversation, "technique")).toEqual(["mprage", "tse"]);
    // the pack's lists, one axis at a time, the buckets always
    const pack = await tool("nils_pack").run({ axis: "post_contrast" }, ctx("survey", 2));
    expect(Object.keys((pack.output as { lists: Record<string, unknown> }).lists).sort()).toEqual([
      "contrast_positive",
      "post_contrast.0",
      "post_contrast.1",
    ]);
    expect(packListOf(conversation, "post_contrast.1")).toEqual(["gad", "gd"]);
    expect(packListOf(conversation, "technique.mprage")).toEqual(["mprage"]);
    const hyp = (args: Record<string, unknown>, n: number) =>
      tool("hypothesis").run(args, ctx("hypothesise", n));
    // one list, of either kind
    expect((await hyp({ axis: "post_contrast", add: ["zzgado"] }, 3)).output).toMatchObject({
      refused: true,
      why: expect.stringMatching(/one list/u),
    });
    expect(
      (await hyp({ axis: "post_contrast", bucket: "contrast_positive", value: "1", add: ["zzgado"] }, 4))
        .output,
    ).toMatchObject({ refused: true, why: expect.stringMatching(/one of the two/u) });
    // a value the signals did not show
    expect((await hyp({ axis: "post_contrast", value: "2", add: ["zzgado"] }, 5)).output).toMatchObject({
      refused: true,
      why: "2 is not a value the signals report on post_contrast; they report 0, 1",
    });
    // a term the list already holds, a term it does not hold
    expect((await hyp({ axis: "post_contrast", value: "1", add: ["Gad"] }, 6)).output).toMatchObject({
      refused: true,
      why: expect.stringMatching(/post_contrast\.1 already holds gad/u),
    });
    expect((await hyp({ axis: "post_contrast", value: "1", remove: ["zzgado"] }, 7)).output).toMatchObject({
      refused: true,
      why: "post_contrast.1 does not hold zzgado",
    });
    expect(
      (await hyp({ axis: "post_contrast", bucket: "contrast_positive", add: ["gad"] }, 8)).output,
    ).toMatchObject({ refused: true, why: expect.stringMatching(/contrast_positive already holds gad/u) });
    // the value's list, recorded as axis.value
    const ok = await hyp(
      {
        axis: "post_contrast",
        value: "1",
        add: ["zzgado"],
        flip: ["post_contrast:vote|1|"],
        must_not_regress: ["post_contrast=0"],
      },
      9,
    );
    expect(ok.output).toMatchObject({ recorded: true });
    expect(predictionOf(conversation)).toMatchObject({
      axis: "post_contrast",
      bucket: null,
      value: "1",
      list: "post_contrast.1",
      add: ["zzgado"],
    });
    // the one-file check counts one list of either kind, the hypothesis's own
    const checks = keywordTuneChecks();
    const overlay = overlayOf(predictionOf(conversation) as Prediction, {}, "t1 zzgado", "1");
    expect(checks.one_file(verdict({ overlay }), { conversation })).toBeNull();
    expect(
      checks.one_file(verdict({ overlay: { buckets: { contrast_positive: { add: ["zzgado"] } } } }), {
        conversation,
      }),
    ).toMatch(/a tune touches one, post_contrast\.1/u);
    expect(
      checks.one_file(verdict({ overlay: { lists: { "post_contrast.1": {}, "post_contrast.0": {} } } }), {
        conversation,
      }),
    ).toMatch(/touches 2 lists/u);
    expect(checks.groups_exist(verdict({}), { conversation })).toBeNull();
    // a bucket the pack names still goes under buckets
    await hyp({ axis: "post_contrast", bucket: "contrast_positive", add: ["zzgado"] }, 10);
    expect(overlayOf(predictionOf(conversation) as Prediction, {}, "", "").buckets).toEqual({
      contrast_positive: { add: ["zzgado"] },
    });
    expect(
      checks.one_file(verdict({ overlay: { buckets: { contrast_positive: {} } } }), { conversation }),
    ).toBeNull();
    // a value on an axis the signals did not report by value is taken as given; the engine's try is the judge
    expect((await hyp({ axis: "plane", value: "sagittal", add: ["sag"] }, 11)).output).toMatchObject({
      recorded: true,
    });
  });
});
