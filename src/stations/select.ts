// SPDX-License-Identifier: AGPL-3.0-only
// The small-model selector (Wave 4c §9.9, built in the refinement of
// ask-help): which worked examples to put in front of the model for one
// question. A small model copies the closest example well and drifts when it
// reads forty; so the cookbook stays on disk and a few examples travel with
// each delivered message. The choice is deterministic and reads nothing but
// the words: the idioms a question carries (a count, a table, per something,
// a first session, a window, a most, an at-least) matched against the idioms
// an example's document uses, and the words the two questions share.

export interface Example {
  file: string;
  question: string;
  text: string;
}

const STOP = new Set(
  "the a an of in and or to with for is are how what which list show give me each every per at on by as their its it that this them one from all any have has had do does did was were be been who whose than then also there here into over about"
    .split(" ")
    .filter(Boolean),
);

/** The words of a question, lowercased, the stop words dropped, a plural folded. */
export function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9.]+/u)) {
    const w = raw.replace(/\.$/u, "");
    if (!w || STOP.has(w) || w.length < 2) continue;
    out.add(w.endsWith("s") && w.length > 3 ? w.slice(0, -1) : w);
  }
  return out;
}

/** The idioms a question's words carry. */
export function idiomsOfQuestion(q: string): Set<string> {
  const t = q.toLowerCase();
  const out = new Set<string>();
  if (/\bhow many\b|\bthe number of\b|\bcount\b|\bshare of\b|\bpercent/u.test(t)) out.add("count");
  if (/\bwhich\b|\blist\b|\bshow\b|\btable\b|\bgive\b|\bwho\b|\bname\b/u.test(t)) out.add("record");
  if (/\bper\b|\beach\b|\bsplit\b|\bby (sex|cohort|year|subject|technique)\b|\bdistribution\b/u.test(t))
    out.add("group");
  if (/\bfirst\b|\bsecond\b|\blatest\b|\blast\b|\bearliest\b|\bmost recent\b/u.test(t)) out.add("ordinal");
  if (
    /\bwithin\b|\bafter\b|\bbefore\b|\baround\b|\bnear\b|\bapart\b|\bof (their|the|a|its) (first|session|diagnosis|transition)/u.test(
      t,
    )
  )
    out.add("near");
  if (
    /\bmost common\b|\bmost\b|\bhighest\b|\blowest\b|\bthinnest\b|\bmean\b|\baverage\b|\bmedian\b|\bminimum\b|\bmaximum\b|\bsum\b|\btotal\b/u.test(
      t,
    )
  )
    out.add("aggregate");
  if (
    /\bat least\b|\bboth\b|\bno\b|\bwithout\b|\bbut not\b|\bonly in\b|\bnot in\b|\bmore than\b|\bat any time\b|\bever\b/u.test(
      t,
    )
  )
    out.add("has");
  if (
    /\bflair\b|\bmprage\b|\bt1\b|\bt2\b|\btse\b|\bdwi\b|\bswi\b|\b3d\b|\btesla\b|\bslice\b|\bresolution\b|\bisotropic\b|\bmillimet|\bmm\b|\bscout\b|\blocalizer\b|\breformat\b|\bderived\b|\bstack\b|\bseries\b|\bprotocol\b|\bsequence\b|\bfield strength\b|\bweighted\b/u.test(
      t,
    )
  )
    out.add("imaging");
  if (
    /\bedss\b|\bsdmt\b|\bdiagnos|\btransition\b|\bscore\b|\bcourse\b|\brrms\b|\bspms\b|\bppms\b|\bhiv\b|\bconvert|\bclinical\b|\bevent\b/u.test(
      t,
    )
  )
    out.add("clinical");
  if (/\bage\b|\bold\b|\byounger\b|\bolder\b|\bunder\b|\bborn\b/u.test(t)) out.add("age");
  if (/\byear\b|\bcalendar\b|\bdays\b|\bgap\b|\bbetween\b/u.test(t)) out.add("time");
  return out;
}

/** The idioms an example's document uses, read from its text. */
export function idiomsOfDocument(text: string): Set<string> {
  const out = new Set<string>();
  if (/level: count/u.test(text)) out.add("count");
  if (/level: record/u.test(text)) out.add("record");
  if (/grain: group/u.test(text)) out.add("group");
  if (/"ordinal"|\bpick:/u.test(text)) out.add("ordinal");
  if (/\bnear:/u.test(text)) out.add("near");
  if (/"(avg|min|max|sum|share)"|limit: 1/u.test(text)) out.add("aggregate");
  if (/\bhas:|algebra:/u.test(text)) out.add("has");
  if (/"axis"|"derived"|grain: stack|text_series_description/u.test(text)) out.add("imaging");
  if (/grain: event|"change"/u.test(text)) out.add("clinical");
  if (/"age_at"/u.test(text)) out.add("age");
  if (/"part"|"days_between"|"prev"|"next"/u.test(text)) out.add("time");
  return out;
}

/** The examples closest to a question, k of them, best first. */
export function closest<T extends Example>(question: string, examples: T[], k = 4): T[] {
  const qw = words(question);
  const qi = idiomsOfQuestion(question);
  const scored = examples.map((e, i) => {
    const ew = words(e.question);
    const ei = new Set([...idiomsOfDocument(e.text), ...idiomsOfQuestion(e.question)]);
    let shared = 0;
    for (const w of qw) if (ew.has(w)) shared++;
    const union = new Set([...qw, ...ew]).size || 1;
    let idioms = 0;
    for (const x of qi) if (ei.has(x)) idioms++;
    let extra = 0;
    for (const x of ei) if (!qi.has(x)) extra++;
    // shared idioms weigh most, then the words shared, then the example's spare idioms count against it, and a shorter example wins a tie
    const score = idioms * 3 + (10 * shared) / union - extra * 0.5 - e.text.length / 100000;
    return { e, i, score };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, k).map((s) => s.e);
}
