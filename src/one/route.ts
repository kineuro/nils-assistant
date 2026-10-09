// SPDX-License-Identifier: AGPL-3.0-only
// The routing hint (one chat, 2026-10-09): which skill a person's words look
// like, read deterministically from the words alone, as src/stations/select.ts
// picks worked examples. The hint rides with the turn's facts; the model may
// overrule it when the words mean otherwise. It never activates a skill.

export type SkillId =
  | "find-data"
  | "plan-work"
  | "plan-analysis"
  | "read-run"
  | "tune-sorting-words"
  | "check-identities";

export interface Route {
  /** The skill the words look like; null when the registry summary answers them, or nothing fits. */
  skill: SkillId | null;
  /** Whether the registry summary alone answers the words. */
  summary: boolean;
  /** The words that decided, for the hint's line. */
  because: string;
}

const RULES: { skill: SkillId; re: RegExp; because: string }[] = [
  {
    skill: "read-run",
    re: /\b(how did|how has|how was)\b[^.?]*\brun\b|\brun\s+#?\d+\b|\bpipeline run\b|\bin that run\b|\bfailed units?\b/iu,
    because: "a run of an analysis is named",
  },
  {
    skill: "tune-sorting-words",
    re: /\bsorting\b|\bteach\b[^.?]*\bword\b|\bkeywords?\b|\bword list\b|\bsorting words\b/iu,
    because: "the words of the sorting are named",
  },
  {
    skill: "check-identities",
    re: /\bidentit(y|ies)\b|\btells? (its|their) people apart\b|\bone person\b|\bsame person\b|\bmerge\b|\bpatient ?id\b|\bheld back\b|\bdataset ds-/iu,
    because: "how a dataset tells people apart is asked",
  },
  {
    skill: "plan-work",
    re: /^\s*(now\s+|please\s+|then\s+)?(digest|fingerprint|classify|rebuild|erase|bring in|pseudonymi[sz]e|release|run the|queue|schedule|import|ingest)\b|\b(tonight|at \d{1,2}[:.]\d{2}|every night|when the batch lands)\b|\bdigest what is in\b/iu,
    because: "an instruction to do something to the registry",
  },
  {
    skill: "plan-analysis",
    re: /\b(volumes?|hippocamp\w*|thalam\w*|ventric\w*|lesion\w*|atroph\w*|segment\w*|cortical thickness|image quality|poor (image )?quality|snr|motion|skull strip\w*|brain age|brain mask)\b/iu,
    because: "numbers measured from images are asked",
  },
];

const SUMMARY =
  /^\s*(which|what)\s+(cohorts|clinical scores|scores|disease courses|courses|kinds of scans|scan kinds|kinds of scan|event kinds|diseases)\b|^\s*how many cohorts\b|\bwhat (clinical )?scores (are|does)\b/iu;

const FIND =
  /\b(how many|which|list|show|count|give me|who|what is the|what are the|latest|mean|average|subjects?|sessions?|stacks?|scans?|series|edss|sdmt|cohort)\b/iu;

/** The skill a person's words look like, the summary questions first. */
export function routeOf(message: string): Route {
  const text = message.trim();
  if (SUMMARY.test(text)) return { skill: null, summary: true, because: "the registry summary answers it" };
  for (const r of RULES) if (r.re.test(text)) return { skill: r.skill, summary: false, because: r.because };
  if (FIND.test(text)) return { skill: "find-data", summary: false, because: "a question about the data" };
  return { skill: null, summary: false, because: "no skill's words" };
}

/** The hint as the turn's facts carry it: one line the model may overrule. */
export function hintLine(r: Route, mounted: readonly string[]): string {
  if (r.summary) return "Hint from the words: the registry summary above answers this; no skill is needed.";
  if (r.skill && mounted.includes(r.skill))
    return `Hint from the words (${r.because}): this looks like the ${r.skill} skill. Overrule it when the words mean otherwise.`;
  if (r.skill)
    return `Hint from the words (${r.because}): this person may not do that here; say so in one sentence.`;
  return "Hint from the words: no skill fits clearly; answer from what you know, or ask one short question.";
}
