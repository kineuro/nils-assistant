---
name: plan-analysis
description: Plan an analysis or a workflow of images (volumes, lesions, cortical thickness, image quality, masks) over a dataset, a cohort or a saved selection, checked before anything runs. Use when the person asks for numbers measured from images.
---
# Planning an analysis

A person asks for numbers measured from images. You choose the analysis or the workflow that measures them and whom it runs over, and propose it. The registry checks it before anything happens and says which sessions run, which are left out, skipped or sent to another method, and why. You restate that check; you never count, and you never set a value yourself: the person approves the proposal on its card.

## The loop

1. **Read what there is.** `registry_describe` with `what: pipelines`, once a conversation: every analysis, family and workflow in its own words, with its choices, the settings a person may set, and the needs that skip a session. For one in full (its rules, checks and their sources) use `what: pipeline` with its `name`, when the person asks why or which option.
2. **Choose** from that list only:
   - the analysis whose words measure what was asked; when two fit, the cheaper one that measures it;
   - a **workflow** when the question needs its steps together (lesions with the FLAIR registered first, white-matter hyperintensities over a SynthSeg, cortical thickness after skull stripping), or when the person names it;
   - a family (registration) is never proposed alone: it runs as a step of a workflow.
3. **Whom it runs over**, one of:
   - a dataset the person names ("in study-a", "for the ms-study data"): `dataset: <its name>` (its main scans);
   - a saved selection ("my selection t1-3d@1"): `selection: <name@version>`;
   - a cohort the registry lists: `cohorts: [<its exact name>]` with `sessions` `all` (over time, or no word about time), `first` (baseline) or `latest`.
   - A cohort, dataset or selection the registry does not hold: say plainly there is none, name the ones there are, and propose nothing.
4. **Choices.** Give `goal` (fast, standard, research) or a switch (`switches: {lesions: "off"}`) only when the person chose it; else leave them out and the analysis's rules decide per session. Give `params` only for a setting the list says a person may set and the person asked for. Never a setting the rules set.
5. **`propose_change`** once with `kind: analysis_plan`, `pipeline` or `workflow` (the name), whom it runs over, the choices the person made, `question` (the person's words), `why` (one clause from the analysis's own words) and `sentence`.
6. **Answer** once, after the proposal, from the result's `say` (no words before the tools are done): name the analysis or workflow and why it fits, in its own words; the sessions ready of the total; **every** line of `skipped_and_routed` (or, for a workflow, every line under each step) with its count and its reason in those words: the sessions left out before the run (no main scan of a role), the ones that cannot run, the ones skipped and why, the ones sent to another method and why; what blocks it, if anything; and that it runs when they approve it. A short list is fine.

## Words

Say "its rules" or "its needs", never the word pack or catalog. Counts only: never a subject's code, a session's date or a scan's name.

## Worked examples

- "Lesion volumes in ms-study" → `workflow: flair-lesions, dataset: ms-study` when the FLAIR should be registered first, else `pipeline: samseg-lesions, dataset: ms-study`
- "Image quality of the T1s in study-a" → `pipeline: mriqc, dataset: study-a`; the answer names the sessions its needs skip, such as a 2D T1, in those words
- "Hippocampal volumes at baseline for cohort-d" → `pipeline: synthseg, cohorts: [cohort-d], sessions: first`
- "Cortical thickness for my selection t1-3d@1" → `workflow: cortical, selection: t1-3d@1`, and the answer says what blocks a step

Never promise a result, never start anything.
