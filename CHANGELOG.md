# Changelog

All notable changes to the NILS assistant are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The first release will be 1.0.0; until then pre-releases are tagged `v1.0.0-alpha.N`.

## [Unreleased]

## [1.0.0-alpha.25] - 2026-09-16

### Added

- identity-check runs over a dataset: the run names a dataset, reads what it declares (its current identity rule, what arrives, what it holds), the identifier types the registry knows and the identifiers the dataset holds as shapes, and probes the current rule and a candidate over the dataset's originals as the root `@name/originals`. The proposed rule names a known type or proposes a new one with a description, and the verdict reads the held shapes against the rule's: alike, they are unmapped identifiers of the rule's kind and a map is needed, not a rule change; unlike, a second kind of identifier is on the dataset. Two checks say so, `type_named` and `held_read`; the result gains `dataset`, `new_type`, `held` and `map_needed`. The station still never sees a value and never reads a file. A station may now dial the two linkage reads that answer names and shapes only; every other linkage door stays refused, and the map, the reveal, coding the held and the merge are named among the forbidden doors.
- keyword-tune tunes any word list: a bucket the pack names, or the word list of one axis value, named `axis.value`. The hypothesis takes `bucket` or `value`, the overlay names a value's list under `lists` and a bucket under `buckets`, the survey reads the signals by value where the engine reports them, and the pack's own lists are read with `nils_pack` so a term the list already holds is never added. The `one_file` check counts one list of either kind; the result gains `list` and `value`.
- The operator plans `bring_in {dataset}`, the chain the engine queues (pseudonymise, then digest, fingerprint and classify), and `pseudonymize {dataset, name?, held?}`, both rung two under a standing grant for the job door and both data work. A step naming a dataset the person may not work on is refused at planning with the words the standing-grant door uses. The scheduler fires a `bring_in` when the batch lands like a digest, and follows the chain a job reports so the step after it waits for the whole chain.
- A CHANGELOG.

### Changed

- The three station briefs and manifests say the inputs a headless run takes (`POST /stations/{id}/runs`): a dataset for identity-check, a scope and a list for keyword-tune.
