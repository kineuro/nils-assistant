---
name: identity-check
description: Is the identity rule right for this dataset, and should identity come from the path instead of the tag. A probe over the dataset's originals, shapes only, the identifier types and the held identifiers read, then one proposed rule.
---

# identity-check

The decision point is which identity rule a dataset should be pseudonymised and digested under: the tag its rule reads, another tag, or a path segment. You are given a dataset by name. You never read a file and you never see a value: the engine's probe answers shapes (`AAA999` for three letters and three digits, `9999` for four digits) and counts, and the held door answers shapes and counts too.

## The phases

1. **read**: `nils_dataset` for what the dataset declares: what arrives, its current identity rule (the one you compare against; the default reads `PatientID`), whether an unmapped identifier is held or coded, and whether it has an originals tree. `nils_identifier_types` for the types the registry knows. `nils_held` for the identifiers the dataset holds because the linkage store does not know them, as shapes. `nils_capabilities` when you need the packs or the registered locations.
2. **diagnose**: `nils_probe` over the dataset with two rules or more, the current rule first and the candidate beside it. The probe reads the dataset's originals; there is no path anywhere in this station. A candidate that reads the path names the segment counted from one (`{"path": {"segment": 1}}`), and a pattern with an `id` group. Read the job with `nils_job` until it is done. Per candidate and per source: the shape histogram, how many files answered, were empty, could not be parsed or were not read because an earlier source answered; `identity_constant` (one value across the sample means a placeholder, not an identity); the subject and study counts. Then read the held shapes against the shape the rule's source answered with: a held shape the rule answered with is an unmapped identifier of the rule's kind, and a map releases its files; a held shape the rule never answered with is a second kind of identifier on this dataset.
3. **propose**: `propose_rule` with one of the rules the probe took and why. Its `id_type` is one of the registry's identifier types; when none fits, name it and give `new_type` with a description, and a person makes it. When the rule reads a path segment, answer `path_is_direct_identifier`: true when the folder name is a personal number, a name or anything that identifies the person directly; false when it is a code decided by whoever holds the key. Never omit it.
4. **check** and **finish**: settle with the dataset (as `location`), `saw` (per rule: the source, the shape it answered with, the counts), the proposed rule, the path answer, `new_type` when you proposed one, `held` (the shapes and your reading: `none`, `same_kind`, `second_kind` or `mixed`), `map_needed` (true when identifiers of the rule's kind are held), and one sentence that names the source the rule reads and the shape it saw. When a map is needed the sentence says so with the word map; when a held shape is unlike the rule's the sentence says a second kind of identifier is on this dataset.

## The rules

- Shapes and counts only. A code, a personal number or a path segment as a value never enters your words or the result.
- A rule the probe refused is not a rule; probe again with one it takes.
- The probe reads the sample once and traces every rule over it; you never ask it to read again for the same rules.
- Held identifiers of the rule's kind need a map, not a rule change. Say so; you never file a map, reveal a held identifier or code one.
- A re-digest under a changed rule, a map and a new identifier type are a person's acts. You propose; you never queue them.

## The run's inputs

The desk starts a run with one message that names the dataset (`dataset: <name>`), and may add the candidate the person has in mind (`candidate: a path segment`, `candidate: PatientName`). A message with no dataset is answered with the datasets the sources door lists, and no probe.
