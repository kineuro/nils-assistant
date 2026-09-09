// SPDX-License-Identifier: AGPL-3.0-only
// keyword-tune (Wave 4c D6): the manifest, the overlay a hypothesis becomes, and the diff read from a rehearsal.

import { describe, expect, it } from "vitest";
import { diffOf, overlayOf, type Prediction } from "../src/stations/keyword-tune.ts";
import { loadManifests } from "../src/stations/manifest.ts";

const p: Prediction = {
  axis: "post_contrast",
  bucket: "contrast_positive",
  add: ["zzgado"],
  remove: [],
  flip: ["post_contrast:vote|1|"],
  must_not_regress: ["post_contrast=0"],
  at: 1,
};

describe("keyword-tune", () => {
  it("has the grant of section 9.13, writes an overlay and a review decision, and re-enters at hypothesise", () => {
    const m = loadManifests(["./stations"]).get("keyword-tune");
    if (!m) throw new Error("no keyword-tune manifest");
    expect(Object.keys(m.grant).sort()).toEqual([
      "classify/signals",
      "classify/try",
      "overlays",
      "overlays/{id}",
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
  });

  it("turns a hypothesis into an overlay of one bucket with the site's case", () => {
    const o = overlayOf(p, { manufacturer: "SYNTHETIC" }, "t1 mprage zzgado", "1");
    expect(o.buckets).toEqual({ contrast_positive: { add: ["zzgado"] } });
    expect(o.scope).toEqual({ manufacturer: "SYNTHETIC" });
    expect((o.cases as { axes: Record<string, string> }[])[0].axes).toEqual({ post_contrast: "1" });
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
});
