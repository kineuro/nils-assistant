# The stations on the local 27B, 2026-10-08 (Wave 7a, T10 baseline)

The seven stations were measured live, overnight, on the site's own 27B model (`qwen38-27b`, thinking off by the chat template, temperature 0.2, 8,192 output tokens, 65,536 context) through a Kvasir of the bench's own whose only backend was the site's model server. No outside provider was reachable: a guard in front of that Kvasir refused every purpose but the stations' (the title purpose included), and the host's model list read `qwen38-27b` alone before any question was asked. Assistant 1.0.0-alpha.27 from this branch; engine 1.0.0-alpha.79 development build; pack mri 1.0.1.

Two registries, as the README says: the one `bench/seed.ts` builds (keyword-tune, analysis-plan, run-read, identity-check, operator) and the synthetic registry the ask-help and concierge golds were derived on (seed 11, 48 subjects, the gate's key).

| station | passed | loop | held out | median seconds a question | the bar |
|---|---|---|---|---|---|
| concierge | 0 of 5 chains | 0/4 | 0/1 | 27 a turn | not a measure of the model (below) |
| ask-help | 46 of 54 the same answer (strict 43) | 35/38 | 11/16 | 27 | authored 36 of 36 (2026-09-09) |
| keyword-tune | 7 of 11 | 7/11 | 0/0 | 34 | closing bar 8, first half |
| analysis-plan | 7 of 12 | 3/5 | 4/7 | 21 | never measured live |
| run-read | 1 of 3 | 0/2 | 1/1 | 15 | never measured live |
| identity-check | 1 of 11 | 1/8 | 0/3 | 84 | closing bar 8, second half |
| operator | 0 of 13 | 0/10 | 0/3 | 45 | bar 3 of Wave 5 |

No case of the three question sets carries `gap`.

## Read beside the table

- **ask-help.** Authored corpus 33 of 36 in the run, shapes 13 of 18. The three authored misses and shape-18 fell in a quarter of an hour (00:22 to 00:38 UTC) when every model call took about 240 seconds at the model server, so those turns made no call before the bench stopped waiting. Asked again after it (`ask-help/rerun-stalled/`): the three authored questions pass (authored 36 of 36, the bar), shape-01 passes, and shape-18 returns 144 rows against 144 in the gold but a different answer. The other shape misses: shape-03 (seven rows against one), shape-04 (loop stopped), shape-11 (two rows, a different answer).
- **concierge.** The concierge delegates and settles at once with a sentence saying that the task is working; the document comes in a later, woken turn. `bench/chains.ts` reads the verdict of the first turn only, so it finds no document in almost every turn. The 0 of 5 measures the bench, not the station. The same chains run through ask-help directly (`concierge/chains-through-ask-help/`) reach their gold in 4 of 5: chains D and E 4 of 4 turns each, A and B at the opening with no correction (the researcher gave five each; on 2026-09-09 A needed two), C not after four corrections. The concierge also sent chain A to analysis-plan rather than ask-help.
- **The prelude outside the grant.** Every run first fetches the engine's catalog and guide through the seam. Keyword-tune, identity-check, analysis-plan, run-read, the operator and the concierge do not hold those doors, so each run records two calls outside the grant. Cases that allow none fail on that alone: 9 of the operator's 13 fail only for it.
- **keyword-tune.** `nils_try` was refused 36 times: the model wrote the overlay's scope as `post_contrast`, `origin`, `SYNTHETIC` or `batch:3` keys instead of an origin map, retried the same call, and the loop stop ended the run (7 of 11 runs). Proposing a second overlay of the same name on one registry answered a 500 (`UNIQUE constraint failed: overlay.name, overlay.version`), so cases of one invocation are not independent.
- **identity-check.** The station probes a dataset by its name, which the measured engine does not yet accept (`location: a registered ingest location`); every dataset probe was refused and the runs ended by the loop stop. On an engine built from the slice that adds that door (`identity-check-on-the-probe-engine/`, same seed) the score is the same, 1 of 11: the model's dataset arguments were refused, it moved between phases the manifest does not allow, and it proposed rules without a pattern on every source.
- **analysis-plan.** Four plans settled without a pre-flight; for a cohort the registry does not list (ALS) the station planned SynthSeg over `nmosd` instead of answering that no plan is right.
- **run-read.** The clean run was read right. The SAMSEG run's failures were counted right but no campaign was proposed; the SynthSeg run's planted failures were miscounted and no campaign was proposed.
- **Runs that outlive the bench.** The bench polls a run for six minutes; a run still going is scored as it stands and keeps calling the model beside the next case.

## How it was run

- `bench/seed.ts` now lays each dataset under `derivatives/dcm-original`, because the engine reads how a dataset's files arrive from its folder and no longer takes `--arrives`.
- `bench/measure.ts` now reads the file a child script wrote on the next day when a run crosses midnight UTC. Ask-help's file was named 2026-10-09 and was scored after the run with the same code.
