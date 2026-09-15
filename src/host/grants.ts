// SPDX-License-Identifier: AGPL-3.0-only
// Grants and detail (record 25): what a person may open, and how much of a
// record they see. A grant names a page and how far a person goes there:
// see, or work, which includes see; the assistant has use. Detail is
// ordered: plain, quasi (the quasi-identifying class, such as sex and age)
// and sensitive. The engine's capabilities say both for the person a token
// names; an older engine says ladder names instead, and each stands for its
// set, as the vectors every part tests against fix them.

/** Every grant, sorted by code point. */
export const GRANTS: readonly string[] = [
  "assistant-settings:see",
  "assistant-settings:work",
  "assistant:use",
  "audit:see",
  "data:see",
  "data:work",
  "database:see",
  "database:work",
  "identity:see",
  "identity:work",
  "install:see",
  "install:work",
  "kvasir:see",
  "kvasir:work",
  "pipelines:see",
  "pipelines:work",
  "places:see",
  "places:work",
  "query:see",
  "query:work",
  "release:see",
  "release:work",
  "review:see",
  "review:work",
];

/** The detail levels, lowest first. */
export const DETAILS = ["plain", "quasi", "sensitive"] as const;
export type Detail = (typeof DETAILS)[number];

/** What a person may open and how much of a record they see. */
export interface Access {
  grants: readonly string[];
  detail: Detail;
}

/** A grants list as a part reads it: a string outside the vocabulary dropped, each work grant with its see, sorted. */
export function grantsOf(list: unknown): string[] {
  const held = new Set<string>();
  for (const g of Array.isArray(list) ? list : []) {
    if (typeof g !== "string" || !GRANTS.includes(g)) continue;
    held.add(g);
    if (g.endsWith(":work")) held.add(`${g.slice(0, -":work".length)}:see`);
  }
  return [...held].sort();
}

/** A detail as a part reads it: absent or unknown reads as plain. */
export function detailOf(v: unknown): Detail {
  return (DETAILS as readonly unknown[]).includes(v) ? (v as Detail) : "plain";
}

const rank = (d: Detail) => DETAILS.indexOf(d);

export function higherDetail(a: Detail, b: Detail): Detail {
  return rank(a) >= rank(b) ? a : b;
}

/** Whether a detail sees at least what another does. */
export function reaches(held: Detail, need: Detail): boolean {
  return rank(held) >= rank(need);
}

/** Whether a person holds a grant: a work grant holds its see. */
export function holds(grants: readonly string[], grant: string): boolean {
  if (grants.includes(grant)) return true;
  return grant.endsWith(":see") && grants.includes(`${grant.slice(0, -":see".length)}:work`);
}

const reader = grantsOf(["query:work", "data:see"]);
const reviewer = grantsOf([...reader, "review:work", "pipelines:see"]);
const operator = grantsOf([
  ...reviewer,
  "data:work",
  "release:work",
  "pipelines:work",
  "places:work",
  "install:see",
  "kvasir:see",
  "assistant-settings:see",
]);

/** The sets the ladder's names and `assist` stand for, wherever one is still met. */
export const SETS: Readonly<Record<"reader" | "reviewer" | "operator" | "admin" | "assist", Access>> = {
  reader: { grants: reader, detail: "plain" },
  reviewer: { grants: reviewer, detail: "quasi" },
  operator: { grants: operator, detail: "sensitive" },
  admin: { grants: GRANTS.filter((g) => g !== "assistant:use"), detail: "sensitive" },
  assist: { grants: ["assistant:use"], detail: "plain" },
};

/** What an engine serving with its authentication off gives: every grant and detail sensitive. */
export const EVERYTHING: Access = { grants: GRANTS, detail: "sensitive" };

/** What a list of ladder names, `assist` and grants adds up to: a name stands for its set, a grant is taken as it is, and the higher detail holds. */
export function accessOfNames(names: readonly string[]): Access {
  const grants: string[] = [];
  let detail: Detail = "plain";
  for (const name of names) {
    if (Object.hasOwn(SETS, name)) {
      const set = SETS[name as keyof typeof SETS];
      grants.push(...set.grants);
      detail = higherDetail(detail, set.detail);
    } else grants.push(name);
  }
  return { grants: grantsOf(grants), detail };
}
