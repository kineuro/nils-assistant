# analysis-plan's evals

Record 49 A5's bar: a question about images becomes a runnable document at the station bar. The fixture set is `cases.yml`: eleven questions with the plan that answers each (the pipeline, the parameters that differ from their defaults, and whom it runs over, a saved selection or cohorts with all, first or latest sessions), one question whose right answer is no plan (a cohort the registry does not list), and the engine's pre-flight of each plan as synthetic counts. The catalog is `bench/analyses/catalog.json`, the starter catalog of record 49 A4 as `GET /api/pipelines` answers it, made from the engine's own descriptors.

## Offline

`test/analysis-plan.test.ts` plays every case through `plan_run` against a stub engine: each becomes a run document with the pipeline as name@version, `select` or `handle`, the parameters with their defaults, the engine's pre-flight (each missing unit by its reason alone), the question and the reason, and the job's command line a person's Run would queue; the checks pass on it; nothing is queued, no campaign is made, no selection is saved. The unknown cohort is refused with the cohorts there are.

## Live

```sh
STATION=analysis-plan ASSISTANT_URL=http://127.0.0.1:<port> NILS_URL=http://127.0.0.1:<port> npm run bench:analyses
```

It needs an engine that serves record 49's doors with the starter catalog seeded, the cohorts `ms-cohort-a`, `ms-cohort-b` and `nmosd`, the saved selections `ms-baseline@1` and `every-t1@2`, and an assistant host whose model is the local 27B. A case passes when the verdict's `run_document` names the expected pipeline, parameters and selection and carries a pre-flight; both splits of `bench/manifest/split.ts` are reported and the run file lands here as `run-<date>.json`.

No live run has been taken yet.
