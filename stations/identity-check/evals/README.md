# identity-check's evals

Closing bar 8, second half: the station reports two candidate rules on a synthetic tree whose placeholder tag it names by shape. The run file of a live check lands here: the synthetic knob tree (a placeholder PatientID, subject codes as the first directory), the probe's two histograms, and the rule it proposed with the path question answered.

`run-2026-09-09.json` is that run, over a registered location, before datasets.

## Over a dataset (record 26)

The next live run is over a dataset: the message names it (`dataset: <name>`), the probe reads its originals by the dataset's name (`{dataset: <name>}`), the run reads the identifier types and the held shapes, and its result carries `held` with a reading and `map_needed`. The run file must show:

- `nils_dataset` answering the dataset's current rule and what arrives, no path;
- `nils_identifier_types` answering the registry's types, and the proposed rule naming one of them, or `new_type` with a description;
- `nils_held` answering shapes and counts only, and `held.reading` read against the shape the proposed rule's source answered with in the probe: `same_kind` with `map_needed: true` when the held shape is the rule's (a map releases the files, no rule change would), `second_kind` when a held shape is unlike the rule's (another kind of identifier is on this dataset), `none` when nothing is held;
- the six checks passing, `no_identifier_value` among them: shapes only, digits as 9 and letters as A, in the tools' answers and in the verdict.

Two synthetic datasets make the two readings: one whose originals carry one identifier type in PatientID with a few files whose identifier the map does not name (same kind), and one whose originals carry a code in PatientID and a study identifier of another shape on a few files (second kind). Made-up type names only.

## The question set (Wave 7a)

`cases.yml`: 11 cases, run by `bench/measure.ts` through `bench/cases.ts` on the registry `bench/seed.ts` builds (`bench/fixtures.ts` says what it holds for this station). Eight expect a rule (nothing held, held of the rule's kind and a map, a second kind, identity from the folder asked and unprompted, a registered location, a tag the files lack, and one person under two identifiers, record 55 K9); three refuse (an unknown dataset, a path for a dataset, no dataset) and probe nothing. The two gaps the set first found are closed: the engine's probe door takes a dataset by name and reads its originals (`{dataset}`), and a dataset's probe answers the subjects alike, which the station proposes to merge with `propose_merge`; a person merges at the engine's merge door. `test/cases.test.ts` holds the set to its shape and to the seed. `npm run bench:offline` runs the set through the station's code against a seeded engine with the stub model of `bench/stub-model.ts` in place of a model: every case passes there, which says the engine, the station and the cases agree, not what a model scores. No live run of it has been taken yet.
