---
name: analysis-plan
description: Turns a person's question about their images into a run document (whom to run over, which analysis at which version, its parameters, and the engine's pre-flight of that run). Runs nothing; the person presses Run.
---

# analysis-plan

A person asks a question that needs numbers measured from images: volumes, lesion load, image quality. You choose the analysis that measures them, its parameters and whom to run it over, record it with `plan_run`, and explain the choice. The engine checks the run before anything happens (the pre-flight): how many units, which lack an input, how long, whether a GPU is needed. You restate that; you never count.

## Which analysis answers which question

| The question asks about | Choose | Parameters | Why |
|---|---|---|---|
| volumes of brain structures (hippocampus, thalamus, ventricles, intracranial volume) on clinical scans | `synthseg` | `robust` true | works on scans of any contrast and resolution, which is most clinical data; its own quality scores are the checks |
| lesion load, lesion volume, white-matter lesions in MS or NMOSD | `samseg-lesions` | `lesion` on | reads the T1w and the FLAIR together and labels the lesions (label 99); a session without a FLAIR is named missing |
| brain volumes without lesions, faster, where no FLAIR exists | `samseg-lesions` | `lesion` off | a quarter of the time, the anatomy from the T1w alone |
| cortical thickness, surfaces, the reference FreeSurfer numbers, "as we do by hand" | `freesurfer-recon-all` | defaults | the field's reference, but 5 to 8 hours a session and the lab's licence; say so |
| image quality, SNR, motion, "which scans are bad" | `mriqc` | defaults | quality metrics per image; its checks flag low SNR and high CJV |
| a brain mask, skull stripping, brain volume only | `synthstrip` | defaults | under a minute a session |
| bias field correction as a preparation step | `n4-bias-correction` | defaults | prepares a T1w for other tools; it measures nothing |

Choose from the catalog in your instructions only. When two analyses fit, choose the cheaper one that measures what was asked, and name the other in your sentence. A measure the person will ask for later is read in the ask as `measure.<pipeline>.<name>`, such as `measure.synthseg.left_hippocampus`.

## Whom it runs over

- The person names a saved selection ("my ms-baseline selection", "selection:ms-baseline@2"): pass `selection` with its name and version.
- The person names a cohort or a group the cohorts list ("the NMOSD cohort", "MS patients"): pass `cohorts` with the cohort names from your instructions, and `sessions`:
  - `all` for "over time", "every visit", "longitudinal", "change", or no word about time;
  - `first` for "at baseline", "first scan", "at diagnosis";
  - `latest` for "most recent", "last visit", "now".
- Never both. Never a name the cohorts do not list; when none fits, say which cohorts exist and settle without a plan.

## Settling

Call `plan_run` once with the question in the person's words, the pipeline, only the parameters you change, whom it runs over and `why` in one clause. Then settle with `plan` (the id it answered) and one `sentence` that says what will be measured and why this analysis, and restates the pre-flight: the pipeline's name, the units ready of the total, the missing ones and why, the time, and whether it is ready or what blocks it. Say the person starts it with Run. If `plan_run` refuses, read why, correct the one thing it names and call it again.

Never promise a result, never start anything, never write a subject's code or a date.
