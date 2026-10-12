// SPDX-License-Identifier: AGPL-3.0-only
// The routing hint (one chat, 2026-10-09): which skill a person's words look
// like, read deterministically from the words alone, as src/stations/select.ts
// picks worked examples. The hint rides with the turn's facts; the model may
// overrule it when the words mean otherwise. It never activates a skill.

export type SkillId =
  | "find-data"
  | "analyse-table"
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
  /** Whether the words ask about the registry's jobs, which jobs_read answers with no skill. */
  jobs?: boolean;
  /** Whether the words ask for a file (a CSV, a spreadsheet, something to download or attach), which the chat cannot make yet. */
  file?: boolean;
  /** The words that decided, for the hint's line. */
  because: string;
}

const RULES: { skill: SkillId; re: RegExp; because: string }[] = [
  {
    skill: "analyse-table",
    re: /\b(analy[sz]e|analysis of|median|medians|percentiles?|quartiles?|standard deviation|spread|histogram|distribution|chart|plot|graph|cross.?tab\w*|csv|spreadsheet|download)\b/iu,
    because: "a computation over many rows is asked",
  },
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
    re: /\bidentit(y|ies)\b|\btells? (its|their) (people|subjects) apart\b|\bone person\b|\bsame person\b|\bmerge\b|\bpatient ?id\b|\bheld back\b/iu,
    because: "how a dataset tells its subjects apart is asked",
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
  /^\s*(which|what)\s+(cohorts|datasets|clinical scores|scores|disease courses|courses|kinds of scans|scan kinds|kinds of scan|event kinds|diseases)\b|^\s*how many (cohorts|datasets)\b|\bwhat (clinical )?scores (are|does)\b/iu;

// what the registry's jobs did or do: "what is the last job" is no question of the data (2026-10-09)
const JOBS = /\bjobs?\b|\bwhat(?:'s|\s+is)\s+(?:running|queued)\b|\bin the queue\b/iu;

const FIND =
  /\b(how many|which|list|show|count|give me|who|what is the|what are the|latest|mean|average|subjects?|sessions?|stacks?|scans?|series|edss|sdmt|cohort)\b/iu;

// a file asked of the chat: a kind of file and something done with it ("can you make a csv and upload it here?",
// 2026-10-12, where the chat asked which rows and wrote nothing else); a question's answer has Download CSV on its card
const FILE_KIND = /\b(csv|tsv|excel|spreadsheets?|xlsx?|files?|downloads?)\b/iu;
const FILE_ACT = /\b(make|create|give|send|upload|attach|download|export|save|produce|generate|write)\b/iu;

/** The skill a person's words look like, the summary questions first. */
export function routeOf(message: string): Route {
  const text = message.trim();
  if (SUMMARY.test(text)) return { skill: null, summary: true, because: "the registry summary answers it" };
  if (FILE_KIND.test(text) && FILE_ACT.test(text))
    return { skill: null, summary: false, file: true, because: "a file is asked for" };
  for (const r of RULES) if (r.re.test(text)) return { skill: r.skill, summary: false, because: r.because };
  if (JOBS.test(text))
    return { skill: null, summary: false, jobs: true, because: "the registry's jobs are asked about" };
  if (FIND.test(text)) return { skill: "find-data", summary: false, because: "a question about the data" };
  return { skill: null, summary: false, because: "no skill's words" };
}

/** The hint as the turn's facts carry it: one line the model may overrule. `tools` are the tools mounted. */
export function hintLine(r: Route, mounted: readonly string[], tools: readonly string[] = []): string {
  if (r.file)
    return mounted.includes("find-data")
      ? `Hint from the words (${r.because}): a question's answer is saved as a CSV with Download CSV on the answer's card in this chat, at the person's own detail. Draft the question the words ask for, or name the one drafted before, then say in plain words that its card has Download CSV. Any other file (a chart, a picture, an analysis's output) cannot be made here yet: it needs the analysis sandbox, which is coming. Answer in words, without asking first. Overrule it when the words mean otherwise.`
      : `Hint from the words (${r.because}): this person may not look up data here, so there is no answer to save as a file; say so in one sentence, and that an admin can give it.`;
  if (r.jobs)
    return tools.includes("jobs_read")
      ? `Hint from the words (${r.because}): jobs_read answers this, the newest first; no skill is needed.`
      : `Hint from the words (${r.because}): this person may not read the jobs here; say so in one sentence.`;
  if (r.summary)
    return "Hint from the words: the facts above (the registry summary and the datasets) answer this; no skill is needed.";
  if (r.skill === "find-data" && mounted.includes(r.skill))
    return `Hint from the words (${r.because}): this looks like the find-data skill: activate it and draft the question, even when the summary seems to hold the number. Overrule it when the words mean otherwise.`;
  if (r.skill && mounted.includes(r.skill))
    return `Hint from the words (${r.because}): this looks like the ${r.skill} skill. Overrule it when the words mean otherwise.`;
  if (r.skill)
    return `Hint from the words (${r.because}): this person may not do that here; say so in one sentence.`;
  return "Hint from the words: no skill fits clearly; answer from what you know, or ask one short question.";
}
