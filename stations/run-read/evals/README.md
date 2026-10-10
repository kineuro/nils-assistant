# run-read's evals

Record 49 A6's bar: a run with planted failures gets a summary that names them and a campaign over them. The fixture set is `runs.json`: three runs as `GET /api/pipeline-runs/{id}` answers them, with their `pipeline:qc` items as `GET /api/review` lists them, all synthetic.

- `planted-synthseg`: twenty units, two failed for a missing T1w, one whose tool failed, one unreported, and three past SynthSeg's white-matter score (one also past the CSF score); an item of another run sits in the list and is not this run's.
- `samseg-both-sides`: two units past the intracranial checks, one under 0.9 litres and one over 2.3.
- `clean-mriqc`: every unit done, no check broken, so no campaign.

## Offline

`test/run-read.test.ts` plays each through `read_run` against a stub engine: the failures are counted by reason, the breaches by check, the doubtful stacks become a draft ask (each breached check a set of the sessions this run measured past it, their union, the stacks of the pipeline's first input role), and the campaign document names that ask's selection, a form question and no close; nothing but the draft is written. A summary that leaves a check out is sent back. Read below detail quasi, with every unit label blanked as the engine blanks it, the same run gives counts by reason and by check only (each under five said as fewer than five), no unit, value or error words, and no campaign.

## Live

`bench/seed.ts` plants the three runs on a registry of its own (`bench/planted.ts`): a small synthetic DICOM tree, one stand-in pipeline per case whose units fail, stay silent or report measures as the case says, run by the engine through a stand-in container runtime, so each run is a real run with its units, checks and review items. It writes the run ids as the `RUNS` line of `seeded.json`, and `bench/measure.ts` reads it:

```sh
npm run bench:measure -- --model <name> --assistant http://127.0.0.1:<port> --engine http://127.0.0.1:<port> --stations run-read --seeded <home>/seeded.json
```

`test/measure.test.ts` holds each planted run to its case: the failures by reason, the breaches by check and the campaign. Measured live on the local 27B on 2026-10-08 and, after the upgrade to Flue 2.2.2, on 2026-10-09: 1 of 3 both times (bench/results/stations-2026-10-08-qwen38-27b-summary.md and stations-2026-10-09-qwen38-27b-summary.md).

> **Warning:** the draft ask selects the stacks of a doubtful session by the pack's `role` axis. A registry whose classifier leaves that axis empty (the synthetic one does) freezes an empty campaign; the pre-flight of A7 should show its count before a person makes it.
