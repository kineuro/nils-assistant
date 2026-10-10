---
name: plan-analysis
description: Plan an analysis of images (volumes, lesion load, image quality, brain masks) over a cohort or a saved selection, checked by the registry before anything runs. Use when the person asks for numbers measured from images.
---
# Planning an analysis

A person asks a question that needs numbers measured from images. You choose the analysis that measures them, whom it runs over, and propose it; the registry checks the run before anything happens (how many scans are ready, which lack an input, how long). You restate that check; you never count.

## Which analysis answers which question

| The question asks about | pipeline | params |
|---|---|---|
| volumes of brain structures (hippocampus, thalamus, ventricles, intracranial volume) | `synthseg` | `{robust: true}` |
| lesion load, lesion volume, white-matter lesions (MS, NMOSD) | `samseg-lesions` | `{lesion: true}` |
| brain volumes without lesions, faster, where no FLAIR exists | `samseg-lesions` | `{lesion: false}` |
| cortical thickness, surfaces, FreeSurfer's reference numbers | `freesurfer-recon-all` | none (5 to 8 hours a session: say so) |
| image quality, SNR, motion, "which scans are bad" | `mriqc` | none |
| a brain mask, skull stripping, brain volume only | `synthstrip` | none |

Choose only an analysis `registry_describe` with what pipelines lists. When two fit, choose the cheaper one that measures what was asked.

## Whom it runs over

- A saved selection the person names ("my selection ms-baseline@1"): `selection: ms-baseline@1`.
- A cohort the registry summary lists: `cohorts: [<its exact name>]` and `sessions`: `all` for over time or no word about time, `first` for at baseline or first scan, `latest` for most recent. "Cohort B" is the listed name that ends in b, such as `ms-cohort-b`.
- Never both. A cohort the summary does not list (ALS, for one): say plainly there is no such cohort, name the ones there are, and propose nothing.

## The loop

1. **`propose_change`** once with `kind: analysis_plan`, `pipeline` (the name), `params` (only what you change), `cohorts` with `sessions` or `selection`, `question` (the person's words), `why` (one clause), and `sentence`.
2. Answer with what it measures and why this analysis, and restate the check from the answer's `say`: the units ready of the total, the missing ones and why, the time, and that it runs when they approve it.

## Worked examples

- "What are the hippocampal volumes in the NMOSD cohort?" → `pipeline: synthseg, params: {robust: true}, cohorts: [nmosd], sessions: all`
- "White-matter lesion volume at baseline for cohort B" → `pipeline: samseg-lesions, params: {lesion: true}, cohorts: [ms-cohort-b], sessions: first`
- "Which scans in my selection ms-baseline@1 have poor image quality?" → `pipeline: mriqc, selection: ms-baseline@1`

Never promise a result, never start anything, never write a subject's code or a date.
