// SPDX-License-Identifier: AGPL-3.0-only
// Grants and detail (record 25), against the vectors every part runs: the
// vocabulary and the sets the ladder's names stand for, a token's grants and
// detail as a part reads them, groups bound to names or grants, and a named
// role list.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accessOfNames,
  detailOf,
  EVERYTHING,
  GRANTS,
  grantsOf,
  higherDetail,
  holds,
  SETS,
} from "../src/host/grants.ts";

interface Expected {
  grants?: string[];
  detail?: string;
  refused?: true;
}

const vectors = JSON.parse(readFileSync(join(import.meta.dirname, "vectors", "grants.json"), "utf8")) as {
  sets: Record<string, { grants: string[]; detail: string }>;
  everything: { grants: string[]; detail: string };
  roles: Record<string, string>;
  claims: {
    name: string;
    claims: { grants?: unknown; detail?: unknown; groups?: string[] };
    expect: Expected;
  }[];
  ceilings: { name: string; grants: string[]; detail: string; ceiling: string; expect: Expected }[];
  named: { name: string; roles: string; expect: Expected }[];
};

/** What a caller is left with, in the vectors' terms: refused when they hold no grant. */
const outcome = (a: { grants: readonly string[]; detail: string }): Expected =>
  a.grants.length === 0 ? { refused: true } : { grants: [...a.grants], detail: a.detail };

describe("the grants vocabulary", () => {
  it("names every grant, and the sets the ladder's names and assist stand for", () => {
    expect([...GRANTS]).toEqual(vectors.everything.grants);
    expect(EVERYTHING).toEqual(vectors.everything);
    expect(SETS).toEqual(vectors.sets);
    expect(holds(["kvasir:work"], "kvasir:see")).toBe(true);
    expect(holds(["kvasir:see"], "kvasir:work")).toBe(false);
    expect(holds(SETS.admin.grants, "assistant:use")).toBe(false);
  });

  it("reads a token's grants and detail, and groups bound to a name or a grant", () => {
    for (const v of vectors.claims) {
      const bound = accessOfNames(
        (v.claims.groups ?? []).flatMap((g) => (Object.hasOwn(vectors.roles, g) ? [vectors.roles[g]] : [])),
      );
      const grants = grantsOf([...grantsOf(v.claims.grants), ...bound.grants]);
      const detail = higherDetail(detailOf(v.claims.detail), bound.detail);
      expect(outcome({ grants, detail }), v.name).toEqual(v.expect);
    }
  });

  it("reads a role list's ladder names as their sets and its grants as they are", () => {
    for (const v of vectors.named)
      expect(outcome(accessOfNames(v.roles.split(","))), v.name).toEqual(v.expect);
  });
});
