// SPDX-License-Identifier: AGPL-3.0-only
// The language's functions, findable by a person's words. The registry's
// search looked at fields, sorting values, kinds, cohorts and datasets, and
// never at the functions: words such as "days between", "previous visit" or
// "first to last" found nothing, and the model wrote the clause from memory.
// Each function here has the words that mean it and one line of how it is
// written. A line is shown only for a name the registry's own catalog lists,
// so an older registry never advertises a function it does not have.

/** One function of the language: the words that mean it, and how it is written. */
export interface FunctionUse {
  /** Words and phrases of a search that mean this function, beside its own name. */
  words: RegExp;
  /** One line: the clause and what it answers. */
  usage: string;
}

const APART = String.raw`\bapart\b|\bhow far\b|\bgaps?\b|\bintervals?\b|\btime between\b|\bfollow[- ]?up\b|\bspan`;

export const FUNCTION_USE: Record<string, FunctionUse> = {
  days_between: {
    words: new RegExp(String.raw`\bdays?\b|\bweeks?\b|${APART}`, "iu"),
    usage:
      '["days_between", {}, <later day>, <earlier day>] is the days from the second day to the first: the later day goes first. For a length said in days or weeks',
  },
  months_between: {
    words: new RegExp(String.raw`\bmonths?\b|${APART}`, "iu"),
    usage:
      '["months_between", {}, <later day>, <earlier day>] is the whole calendar months from the second day to the first: the later day goes first. For a length said in months, with the number as said (six months are 6)',
  },
  years_between: {
    words: new RegExp(String.raw`\byears?\s+(?:apart|between|or more)\b|${APART}`, "iu"),
    usage:
      '["years_between", {}, <later day>, <earlier day>] is the whole calendar years from the second day to the first: the later day goes first. For a length said in years, with the number as said (five years are 5)',
  },
  prev: {
    words:
      /\bprevious\b|\bprior\b|\bthe one before\b|\bbefore it\b|\bconsecutive\b|\bsuccessive\b|\bgaps?\b|\bintervals?\b|\bless than\b.*\bapart\b/iu,
    usage:
      '["prev", {}, ["field", {}, "first"]] is the same column of the row before in the set\'s order (a subject\'s visit before this one), among the rows the set\'s has kept: bind it in the set that carries the has or in one drawn from it, never in a set above. The gap to the visit before is ["days_between", {}, ["field", {}, "first"], ["prev", {}, ["field", {}, "first"]]]',
  },
  next: {
    words: /\bnext (?:visit|session|scan)\b|\bfollowing (?:visit|session|scan)\b|\bthe one after\b/iu,
    usage:
      '["next", {}, ["field", {}, "first"]] is the same column of the row after in the set\'s order (a subject\'s visit after this one), bound where prev would be',
  },
  ordinal: {
    words:
      /\bordinals?\b|\b(?:first|second|third|fourth|nth|baseline)\b.*\b(?:visit|session|scan)s?\b|\bvisit number\b/iu,
    usage:
      '["ordinal", {}] bound on a session set is the visit\'s number for its subject, 1 for the first: bind: {n_th: ["ordinal", {}]} and a where on it, [["=", {}, ["field", {}, "n_th"], 1]]',
  },
  min: {
    words: /\bfirst to last\b|\bearliest\b|\bsmallest\b|\bminimum\b|\blowest\b|\bspan/iu,
    usage:
      '["min", {set: <set>}, ["field", {}, "first"]] in a group\'s bind is the smallest of a column over the group\'s set (the earliest day). First to last is the latest and the earliest inside one value: ["years_between", {}, ["max", {set: <set>}, ["field", {}, "first"]], ["min", {set: <set>}, ["field", {}, "first"]]]',
  },
  max: {
    words: /\bfirst to last\b|\blatest\b|\blargest\b|\bmaximum\b|\bhighest\b|\bspan/iu,
    usage:
      '["max", {set: <set>}, ["field", {}, "first"]] in a group\'s bind is the largest of a column over the group\'s set (the latest day)',
  },
  share: {
    words: /\bshares?\b|\bpercent(?:age)?s?\b|\bproportions?\b|\bfractions?\b/iu,
    usage:
      "[\"share\", {of: <count binding>, over: <the set the group is of>}] in a group's bind is the group's part of all the rows, with the denominator named in the document",
  },
  count: {
    words: /\bcounts?\b|\bnumber of\b/iu,
    usage:
      "[\"count\", {set: <set>}] in a group's bind counts the group's rows and reads no column; how many in all is out: {set: <set>, level: count}",
  },
  distinct: {
    words: /\bdistinct\b|\bunique\b|\bdifferent\b/iu,
    usage:
      '["distinct", {set: <set>}, ["field", {}, "session.id"]] in a group\'s bind counts the different values of a column',
  },
  avg: {
    words: /\bmeans?\b|\baverages?\b/iu,
    usage: '["avg", {set: <set>}, ["field", {}, "<field>"]] in a group\'s bind is the mean of a column',
  },
  sum: {
    words: /\btotals?\b|\bsums?\b/iu,
    usage: '["sum", {set: <set>}, ["field", {}, "<field>"]] in a group\'s bind is the total of a column',
  },
  age_at: {
    words: /\bage at\b|\bhow old\b|\baged?\b/iu,
    usage:
      '["age_at", {}, ["field", {}, "subject.birth_date"], ["field", {}, "<date>"]] is the age in whole years on a day',
  },
  part: {
    words: /\bthe year of\b|\bcalendar year\b|\bper year\b|\bby year\b|\beach year\b/iu,
    usage: '["part", {unit: year}, ["field", {}, "first"]] is the year of a day, to compare or to group by',
  },
  ">=": {
    words: /\bsince\b|\bon or after\b|\bfrom \d{4}\b|\bonwards?\b/iu,
    usage:
      'since a date is a where on the day, [">=", {}, ["field", {}, "first"], "2015-01-01"]: on a session its day is first, on an event date',
  },
  contains: {
    words: /\bcontains?\b|\bdescribed as\b|\bincludes? the (?:word|text)\b/iu,
    usage:
      '["contains", {}, ["field", {}, "text_series_description"], "<text>"] is a text that holds another',
  },
};

/** The functions a catalog lists, each once, whatever family it is under. */
export function functionsListed(functions: Record<string, string[]> | undefined | null): Set<string> {
  return new Set(Object.values(functions ?? {}).flat());
}

/**
 * The functions a search's words mean, one line each, of those the registry's catalog lists: named outright (a
 * whole word of the name, such as days, between, ordinal) or by the words that mean them.
 */
export function functionsFound(
  words: string,
  functions: Record<string, string[]> | undefined | null,
): string[] {
  const listed = functionsListed(functions);
  const ws = new Set(
    words
      .toLowerCase()
      .split(/[^a-z0-9_]+/u)
      .filter((w) => w.length >= 4),
  );
  const out: string[] = [];
  for (const [name, use] of Object.entries(FUNCTION_USE)) {
    if (!listed.has(name)) continue;
    const named = ws.has(name) || name.split("_").some((p) => ws.has(p));
    if (named || use.words.test(words)) out.push(`function ${name}: ${use.usage}`);
  }
  return out;
}
