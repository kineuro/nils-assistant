# Changelog

All notable changes to the NILS assistant are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The first release will be 1.0.0; until then pre-releases are tagged `v1.0.0-alpha.N`.

## [Unreleased]

### Added

- The analysis sandbox, a trial (2026-10-10): the one agent's `analysis_table` tool and `analyse-table` skill run Python over a stored question's rows offline, in Pyodide 0.28.3 inside a child Node process started for one run under Node's permission model (it reads only Pyodide's folder and its own file, writes nothing, starts no process, has no environment and no code generation from strings; the network globals, the process object and Python's bridge to JavaScript are taken away before any code runs), capped in time, memory and answer size. The rows (at most 2,000) go to the sandbox as CSV and never into the conversation; the result comes back as registry data; a column the person sees only as shapes is left out, and code that needs one is refused; a plain SVG chart is shown beside the turn as a `chart` data part. Four one-chat bench conversations cover it: a count and a mean by group, a refusal below the person's level, and text planted in the registry.
- One chat (record 55 B6): one agent, `nils` (`src/one/`), is the only voice of the chat. The stations' work became six skills it activates when a turn needs one (find-data, plan-work, plan-analysis, read-run, tune-sorting-words, check-identities), and about ten tools are mounted from the person's grants for the conversation's life. Each turn starts with the facts: what the registry holds, its datasets and their steps, what the person may do, and a hint from the words. The guards are code: a turn cap, a token cap, the repeat detector, one read-only sub-agent at a time, and the active skill's checks and plain words before a turn settles. Its model calls carry the concierge's Kvasir purpose. It writes nothing itself: `propose_change` puts a card before the person.
- The changes doors, `GET /changes/{id}` and `POST /changes/{id}/decide` (approved or declined). A decision is recorded first, and an approval is applied by the host under the person's token: a job plan is confirmed, an analysis queued, sorting words proposed as an overlay, a merge made at the engine's merge door, and an identity rule recorded.
- Settings: `ASSISTANT_ONE_CHAT` (`0` serves no one agent), `ASSISTANT_CHANGES` (the changes' store, `./data/changes.sqlite` unless said) and `ONE_CHAT_FIND` (`subagent` gives finding data to a read-only sub-agent instead of a skill).
- The one-chat bench: `npm run bench:one-chat` drives forty-two multi-turn conversations, each three times, graded on outcomes with pass@1 and pass^3 (`bench/ONE-CHAT.md`), and `npm run bench:one-chat-stub` serves a stand-in that speaks its interface where no model runs. The stations' live runs on the local 27B of 2026-10-08 and 2026-10-09 are in `bench/results/`.
- identity-check proposes a merge (record 55 K9): a dataset's probe names the subjects whose birth date and sex agree and whose visits overlap, by their codes, and `propose_merge` takes one such pair, the subject kept first, with why. The result carries `merge` (`subjects`, `canonical`, `alias`, `agree`, `visits`, `why`, and `act`, the body a person sends to the engine's merge door, `POST /api/linkage/merge`); the station never merges and never dials that door. The check `merge_named` asks for the merge when the probe named a pair and refuses one it did not, and the merge's two codes are the one exception to shapes only.
- `npm run bench:offline`: a station's question set run through its own code against a seeded engine with a stub model, no model and no network.

### Changed

- Flue 2.2.2 and pi-ai 0.87.1, from 2.0.5 and 0.83.0. Since pi 0.86 a provider gets the prompt and the tools as system messages in the transcript; the Kvasir provider and the title call send the transcript collapsed, as pi does for a model that takes a system message only first, because Kvasir's own pi reads only the prompt and the tools.
- identity-check probes a dataset by its name (`{dataset}`), which the engine's probe door now takes, instead of `root: @<name>/originals`, which it refused.
- identity-check reads a held shape as a second kind of identifier also when the rule read it only on the files held under it, beside the rule's own shape on files that are not held (a study number in a few files' PatientID).
- `nils_dataset` without a name answers the datasets by name.

### Fixed

- The one agent's caps hold its model calls too. Once the tools are stopped, or the turn's model calls, tokens or time are spent, the model gets one call to answer and the call after it is refused. A model that kept calling the framework's own tools after a stop was called again until the submission's hour ran out.
- `POST /changes/{id}/decide` checks that the change is the caller's before it keeps their token for the change's conversation. A stranger's decision learns nothing of the change, a question version's kind included.
- After the runtime summarizes a conversation's earlier turns, the next turn tells the facts again, whole.
- An analysis card names whom the run covers and its settings, read from the command its approval queues.
- `/capabilities` lists the one agent under the purpose its calls carry, `assistant.concierge`, and names the runtime versions in use.

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
