# identity-check's evals

Closing bar 8, second half: the station reports two candidate rules on a synthetic tree whose placeholder tag it names by shape. The run file of a live check lands here: the synthetic knob tree (a placeholder PatientID, subject codes as the first directory), the probe's two histograms, and the rule it proposed with the path question answered.

`run-2026-09-09.json` is that run, over a registered location, before datasets.

## Over a dataset (record 26)

The next live run is over a dataset: the message names it (`dataset: <name>`), the probe reads its originals as the root `@<name>/originals`, the run reads the identifier types and the held shapes, and its result carries `held` with a reading and `map_needed`. The run file must show:

- `nils_dataset` answering the dataset's current rule and what arrives, no path;
- `nils_identifier_types` answering the registry's types, and the proposed rule naming one of them, or `new_type` with a description;
- `nils_held` answering shapes and counts only, and `held.reading` read against the shape the proposed rule's source answered with in the probe: `same_kind` with `map_needed: true` when the held shape is the rule's (a map releases the files, no rule change would), `second_kind` when a held shape is unlike the rule's (another kind of identifier is on this dataset), `none` when nothing is held;
- the six checks passing, `no_identifier_value` among them: shapes only, digits as 9 and letters as A, in the tools' answers and in the verdict.

Two synthetic datasets make the two readings: one whose originals carry one identifier type in PatientID with a few files whose identifier the map does not name (same kind), and one whose originals carry a code in PatientID and a study identifier of another shape on a few files (second kind). Made-up type names only.
