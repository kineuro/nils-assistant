# Changelog

All notable changes to the NILS assistant are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The first release will be 1.0.0; until then pre-releases are tagged `v1.0.0-alpha.N`.

## [Unreleased]

## [1.0.0-alpha.27] - 2026-09-25

### Added

- analysis-plan (record 49 A5, purpose `assistant.analysis-plan`, content `rows`, ceiling reviewer): a question about images becomes a run document the desk reads as `result.run_document`: the pipeline as name@version, whom it runs over (`select`, a saved selection, or `handle`, the stacks of an ask the station drafts from cohorts with all, first or latest sessions), the parameters held to the descriptor with their defaults, the engine's pre-flight with each missing unit by its reason alone, the question and the reason, and the command a person's Run would queue. The brief carries a short cookbook of which analysis answers which question, and the catalog and the cohorts travel with every turn. It never starts a run.
- run-read (record 49 A6, purpose `assistant.run-read`, content `rows`, ceiling reviewer): after a run, a reading of its checks (the failed units by reason, the units past each declared check with the worst value) and a campaign document over the units past a check, whose ask is stored as a draft for a person to save and make. It closes no item and makes no campaign. Below detail quasi (record 49 R4, R4b) the reading holds counts by reason and by check only, a count under five said as fewer than five, with no unit, value or error text and no campaign; failures are counted by the engine's items and summary, never by unit labels.
- The fixture sets of both stations, the starter catalog as the engine lists it (`bench/analyses/catalog.json`) and `npm run bench:analyses`, the live bench of both.
- The concierge hands a question about measured images to analysis-plan and a finished run to run-read.
- The grant names a pipeline's doors as `pipelines/{name}` and `pipelines/{name}/preflight`, whatever names the pipeline.

## [1.0.0-alpha.26] - 2026-09-24

### Changed

- Kvasir's pi-messages door moved to `/v1/pi/messages` (record 47), and `/v1/config` now gives `{origin}/v1/pi` as the base address. The fallback catalog used when Kvasir does not answer at start and the baseline bench call follow it.

## [1.0.0-alpha.25] - 2026-09-16

### Added

- identity-check runs over a dataset: the run names a dataset, reads what it declares (its current identity rule, what arrives, what it holds), the identifier types the registry knows and the identifiers the dataset holds as shapes, and probes the current rule and a candidate over the dataset's originals as the root `@name/originals`. The proposed rule names a known type or proposes a new one with a description, and the verdict reads the held shapes against the rule's: alike, they are unmapped identifiers of the rule's kind and a map is needed, not a rule change; unlike, a second kind of identifier is on the dataset. Two checks say so, `type_named` and `held_read`; the result gains `dataset`, `new_type`, `held` and `map_needed`. The station still never sees a value and never reads a file. A station may now dial the two linkage reads that answer names and shapes only; every other linkage door stays refused, and the map, the reveal, coding the held and the merge are named among the forbidden doors.
- keyword-tune tunes any word list: a bucket the pack names, or the word list of one axis value, named `axis.value`. The hypothesis takes `bucket` or `value`, the overlay names a value's list under `lists` and a bucket under `buckets`, the survey reads the signals by value where the engine reports them, and the pack's own lists are read with `nils_pack` so a term the list already holds is never added. The `one_file` check counts one list of either kind; the result gains `list` and `value`.
- The operator plans `bring_in {dataset}`, the chain the engine queues (pseudonymise, then digest, fingerprint and classify), and `pseudonymize {dataset, name?, held?}`, both rung two under a standing grant for the job door and both data work. A step naming a dataset the person may not work on is refused at planning with the words the standing-grant door uses. The scheduler fires a `bring_in` when the batch lands like a digest, and follows the chain a job reports so the step after it waits for the whole chain.
- A CHANGELOG.

### Changed

- The three station briefs and manifests say the inputs a headless run takes (`POST /stations/{id}/runs`): a dataset for identity-check, a scope and a list for keyword-tune.
