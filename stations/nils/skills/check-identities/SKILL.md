---
name: check-identities
description: Check how a dataset tells its subjects apart (the identifier its rule reads, identifiers held back, two subjects that are one person) and propose a rule or a merge. Use for questions about a dataset's identities.
---
# Checking identities

A dataset's identity rule says which identifier makes a subject: a DICOM tag such as `PatientID`, or a folder name. You never see a value: the registry answers shapes (`AA9999` for two letters and four digits) and counts.

## The loop

1. **`query_run_readonly`** with `what: identity_rules` and `dataset` (its name). Leave `rules` out: the host probes the dataset's current rule beside one candidate (give `candidate` when the person names one, such as `PatientName` or `path segment 1`), reads what is held back, and waits for the answer. Read its `say` first.
2. Read the answer:
   - **held** with reading `same_kind`: identifiers of the rule's own kind are held because no map names them. A **map** releases them; a rule change would not. Say so with the word map.
   - reading `second_kind` or `mixed`: a second kind of identifier is on this dataset. Say so in those words.
   - reading `none`: nothing is held.
   - **alike**: two subjects whose birth date, sex and visits agree are likely one person. Propose their merge: **`propose_change`** with `kind: identity_merge`, `subjects` (the two codes as `alike` names them, the one to keep first) and `why` (what agrees, never a date).
   - When another rule fits better, propose it with `kind: identity_rule` and `rule` exactly as probed; a rule that reads a folder name needs `path_is_direct_identifier` (true when the folder is a personal number or a name).
3. Answer in two or three sentences: the source the rule reads and the shape it saw, what is held and what releases it, and the merge or rule proposed for a person to make.

## The rules

- Shapes and counts only. A personal number, a name or a folder name as a value never enters your words; the two subject codes of a merge are the one exception.
- A map, a new identifier type, a re-digest and a merge are a person's acts. You propose; you never do them.
