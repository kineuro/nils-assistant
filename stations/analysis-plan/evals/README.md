# analysis-plan's evals

Record 49 A5's bar: a question about images becomes a runnable document at the station bar. The fixture set is `cases.yml`: eleven questions with the plan that answers each (the pipeline, the parameters that differ from their defaults, and whom it runs over, a saved selection or cohorts with all, first or latest sessions), one question whose right answer is no plan (a cohort the registry does not list), and the engine's pre-flight of each plan as synthetic counts. The catalog is `bench/analyses/catalog.json`, the starter catalog of record 49 A4 as `GET /api/pipelines` answers it, made from the engine's own descriptors.

## Offline

`test/analysis-plan.test.ts` plays every case through `plan_run` against a stub engine: each becomes a run document with the pipeline as name@version, `select` or `handle`, the parameters with their defaults, the engine's pre-flight (each missing unit by its reason alone), the question and the reason, and the job's command line a person's Run would queue; the checks pass on it; nothing is queued, no campaign is made, no selection is saved, and the handle the pre-flight runs over is never kept. The unknown cohort is refused with the cohorts there are.

## Live

`bench/seed.ts` builds the registry the cases name: the synthetic registry with `ms-cohort-a` and `ms-cohort-b`, the cohort `nmosd` (nine synthetic subjects), the saved selections `ms-baseline@1` (cohort A's T1 at the first session) and `every-t1@2` (version 1 the one-millimetre T1, version 2 every T1), and the starter catalog seeded. Serve it, point an assistant host whose model is the local 27B at it, and measure:

```sh
npm run bench:measure -- --model <name> --assistant http://127.0.0.1:<port> --engine http://127.0.0.1:<port> --stations analysis-plan
```

A case passes when the verdict's `run_document` names the expected pipeline, parameters and selection and carries a pre-flight; both splits of `bench/manifest/split.ts` are reported.

> **Warning:** the synthetic registry has no live picks, so the pre-flight of a bids pipeline leaves every stack out ("no live pick takes it") and counts no unit ready. The plan still carries its pre-flight, which is what the case scores; the counts of `cases.yml` are the stub engine's, not this registry's.

Measured live on the local 27B on 2026-10-08 and, after the upgrade to Flue 2.2.2, on 2026-10-09: 7 of 12, then 8 of 12 (bench/results/stations-2026-10-08-qwen38-27b-summary.md and stations-2026-10-09-qwen38-27b-summary.md).
