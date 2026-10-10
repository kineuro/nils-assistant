# The operator's evals

Bar 3 of Wave 5 (section 13): the overnight instruction runs as a plan. The ladder test in `test/ladder.test.ts` builds the plan the station would make from its verbs and drives the scheduler against a stub engine; a live run's file lands here when one is taken on the rig.

## Datasets (record 26)

The same test plans "when the next batch lands, bring in what is new in the dataset" as one rung-two `bring_in` step under a standing grant for the job door, queued as the engine's `bring-in @<dataset>` when the batch lands, and followed through the chain the job reports (pseudonymise, then digest, fingerprint and classify) before the step after it fires; a `pseudonymize` step queues `pseudonymize @<dataset>` with its batch name and the held flag; and a step naming a dataset a person may not work on (no `data:work` among their grants) is refused at planning with the words the standing-grant door uses. A live run's file lands here when one is taken on the rig, over a synthetic dataset with a made-up name.

## The question set (Wave 7a)

`cases.yml`: 13 cases, run by `bench/measure.ts` through `bench/cases.ts` on the registry `bench/seed.ts` builds (`bench/fixtures.ts` says what it holds for this station). Twelve expect a plan (digest, classify on a batch's landing, fingerprint then classify, bring in, pseudonymise the held files, a rebuild at a time, a stored question, and the person's acts as proposals: handover, adopt, release, erase, an identity rule); one asks for an act with no verb and expects no step and no proposal. Every case holds the station inside its grant. `test/cases.test.ts` holds the set to its shape and to the seed. Measured live on the local 27B on 2026-10-08 and, after the upgrade to Flue 2.2.2, on 2026-10-09: 0 of 13 both times, 9 of them only for two calls outside the station's grant (bench/results/stations-2026-10-08-qwen38-27b-summary.md and stations-2026-10-09-qwen38-27b-summary.md).
