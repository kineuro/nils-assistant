// SPDX-License-Identifier: AGPL-3.0-only
// Standing grants in plain words (record 55, ruling 24). A standing grant is
// kept by the engine door it opens, but no door reaches a person's screen:
// each is shown as what it lets the assistant do, in the desk's words, under
// the page whose grant it needs. A person may give one action, a whole page
// (`page:<id>`), or everything (`*`), and an admin needs none: they hold
// everything, and the assistant acting for them acts with their access.

import { opens, type PolicyRow, rungOf } from "./ladder.ts";

/** The pages a grant names, as the desk's People page lists them. */
export const PAGES = [
  "assistant",
  "query",
  "data",
  "review",
  "release",
  "pipelines",
  "models",
  "campaigns",
  "install",
  "kvasir",
  "assistant-settings",
  "places",
  "database",
  "identity",
  "audit",
] as const;
export type PageId = (typeof PAGES)[number];

/** The page names a person reads, as the desk draws them. */
export const PAGE_WORDS: Record<PageId, string> = {
  assistant: "Assistant",
  query: "Query",
  data: "Data",
  review: "Review",
  release: "Release",
  pipelines: "Pipelines",
  models: "Models",
  campaigns: "Campaigns",
  install: "The install",
  kvasir: "Language models",
  "assistant-settings": "The assistant's settings",
  places: "Places",
  database: "Backups",
  identity: "People",
  audit: "Audit",
};

/** What each door the ladder offers lets the assistant do, in the desk's words, and the page it sits under. */
const WORDS: Record<string, { page: PageId; words: string }> = {
  "POST /api/jobs": { page: "data", words: "Read, sort, pseudonymise and bring in data" },
  "POST /api/jobs/{id}/cancel": { page: "pipelines", words: "Cancel jobs" },
  "POST /api/sessions/rebuild": { page: "data", words: "Rebuild the visits" },
  "POST /api/places/{id}/originals": { page: "data", words: "Act on a dataset's originals" },
  "POST /api/linkage/types": { page: "data", words: "Add ID types" },
  "POST /api/linkage/imports": { page: "data", words: "Bring in identifier maps" },
  "POST /api/linkage/held/code": { page: "data", words: "Code held files anyway" },
  "POST /api/linkage/merge": { page: "data", words: "Merge two subjects" },
  "PUT /api/datasets/{name}/headers": { page: "data", words: "Flag a dataset's headers" },
  "POST /api/ask/run": { page: "query", words: "Run questions" },
  "POST /api/ask/jobs": { page: "query", words: "Queue questions" },
  "POST /api/ask/apply": { page: "query", words: "Apply a question's changes" },
  "POST /api/review/{id}/let-go": { page: "review", words: "Let go of review items" },
  "POST /api/review/{id}/provisional": { page: "review", words: "Answer review items blind" },
  "POST /api/review/gate": { page: "review", words: "Run the review gate" },
  "POST /api/review/system1/run": { page: "review", words: "Run System 1 over the archive" },
  "POST /api/audit/draws/{id}/grade": { page: "review", words: "Grade audit samples" },
  "POST /api/datasets/{name}/steps/{step}/run": { page: "pipelines", words: "Run pipelines on datasets" },
  "POST /api/cohorts/{name}/steps/{step}/run": { page: "pipelines", words: "Run pipelines on cohorts" },
  "POST /api/picks/run": { page: "pipelines", words: "Pick main scans" },
  "POST /api/picks/rules": { page: "pipelines", words: "Save main-scan rules" },
  "POST /api/pipelines": { page: "pipelines", words: "Add pipelines" },
  "PUT /api/pipelines/lane": { page: "pipelines", words: "Set the pipeline lane" },
  "PUT /api/pipelines/secrets/{id}": { page: "pipelines", words: "Set pipeline secrets" },
  "DELETE /api/pipelines/secrets/{id}": { page: "pipelines", words: "Forget pipeline secrets" },
  "POST /api/tools/dcm2niix/install": { page: "pipelines", words: "Install dcm2niix" },
  "POST /api/campaigns/{id}/assignments/{assignment}/release": {
    page: "campaigns",
    words: "Give campaign items back",
  },
  "POST /api/campaigns/{id}/suggestions": { page: "campaigns", words: "Bring suggestions into campaigns" },
  "POST /api/campaigns/{id}/raters": { page: "campaigns", words: "Change a campaign's raters" },
  "POST /api/certificates/{id}/unseal": { page: "campaigns", words: "Unseal certified samples" },
  "POST /api/places/explore": { page: "places", words: "Explore the sources" },
  "PUT /api/places/{id}": { page: "places", words: "Change places" },
  "PUT /api/backups/schedule": { page: "database", words: "Set the backup schedule" },
  "PUT /api/settings": { page: "install", words: "Change the registry's calendar" },
};

/** The first grant a policy row names, whose page the door sits under. */
function grantOf(row: Pick<PolicyRow, "grant" | "role"> | undefined): string | null {
  if (!row) return null;
  if (typeof row.grant === "string") return row.grant;
  if (Array.isArray(row.grant) && row.grant.length > 0) return row.grant[0];
  return null;
}

function pageOfGrant(grant: string | null): PageId | null {
  const page = grant?.split(":")[0] ?? "";
  return (PAGES as readonly string[]).includes(page) ? (page as PageId) : null;
}

/** A label the engine gave a door ("Providing an identifier map"), or nothing. */
function labelOf(row: PolicyRow | undefined): string | null {
  const label = (row as { label?: { present?: unknown } } | undefined)?.label?.present;
  return typeof label === "string" && label.trim() ? label.trim() : null;
}

/** What a door lets the assistant do and the page it sits under: the words the desk shows, never the path. */
export function actionOf(door: string, row?: PolicyRow): { page: PageId; words: string } {
  const known = WORDS[door];
  if (known) return known;
  const page = pageOfGrant(grantOf(row)) ?? pageOfDoor(door);
  return { page, words: labelOf(row) ?? `A step on ${PAGE_WORDS[page]}` };
}

/** A door the policy no longer names, read for its page by its path alone (an older grant's door). */
function pageOfDoor(door: string): PageId {
  const path = door.split(" ")[1] ?? door;
  if (/\/api\/(ask|selections)/u.test(path)) return "query";
  if (/\/api\/(review|audit)/u.test(path)) return "review";
  if (/\/api\/(campaigns|certificates|label-sets)/u.test(path)) return "campaigns";
  if (/\/api\/(pipelines|picks|tools|runs)|\/steps\//u.test(path)) return "pipelines";
  if (/\/api\/places/u.test(path)) return "places";
  if (/\/api\/backups/u.test(path)) return "database";
  if (/\/api\/settings/u.test(path)) return "install";
  if (/\/api\/models/u.test(path)) return "models";
  if (/\/api\/releases|\/api\/handovers/u.test(path)) return "release";
  return "data";
}

/** A standing grant's scope as it is kept: one door, a whole page (`page:<id>`) or everything (`*`). */
export const EVERYTHING_SCOPE = "*";
export const pageScope = (page: PageId): string => `page:${page}`;

/** The page a kept scope names, or null when it names one door or everything. */
export function scopePage(scope: string): PageId | null {
  const m = /^page:(.+)$/u.exec(scope);
  return m && (PAGES as readonly string[]).includes(m[1]) ? (m[1] as PageId) : null;
}

/** A kept scope in words: one action, everything on a page, or everything. */
export function scopeWords(scope: string, policy: PolicyRow[]): { page: PageId | null; words: string } {
  if (scope === EVERYTHING_SCOPE) return { page: null, words: "Everything the assistant may do for you" };
  const page = scopePage(scope);
  if (page) return { page, words: `Everything on ${PAGE_WORDS[page]}` };
  return actionOf(
    scope,
    policy.find((r) => r.door === scope),
  );
}

/** Whether a kept scope covers a door: the door itself, its page, or everything. */
export function covers(scope: string, door: string, policy: PolicyRow[]): boolean {
  if (scope === door || scope === EVERYTHING_SCOPE) return true;
  const page = scopePage(scope);
  if (!page) return false;
  return (
    actionOf(
      door,
      policy.find((r) => r.door === door),
    ).page === page
  );
}

/** The rung-two actions a person's grants open, by page in the desk's order, each with its words. */
export function offerOf(
  policy: PolicyRow[],
  grants: readonly string[],
): { page: PageId; title: string; actions: { door: string; words: string }[] }[] {
  const by = new Map<PageId, { door: string; words: string }[]>();
  for (const row of policy) {
    if (rungOf(row) !== 2 || !opens(grants, row)) continue;
    const a = actionOf(row.door, row);
    const list = by.get(a.page) ?? [];
    if (!list.some((x) => x.words === a.words)) list.push({ door: row.door, words: a.words });
    by.set(a.page, list);
  }
  return PAGES.filter((p) => by.has(p)).map((p) => ({
    page: p,
    title: PAGE_WORDS[p],
    actions: by.get(p) ?? [],
  }));
}
