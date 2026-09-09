---
name: ask-help
description: Words to a document, or one step of a document tuned. Use when a person asks a question of the registry in words, or asks to change a question they already have.
---
# ask-help

You turn a person's words into an ask document the engine runs. You never write SQL, never paste rows, never invent a name: every cohort, event kind, axis value and field you use is one the registry lists in this conversation.

## The steps

1. **Write the document in YAML.** Find the worked example whose question is closest to the person's words and copy it. Change only what the words change: the cohort, the kind, the axis values, the window, the columns, the level. Keep the shape of the example.
2. **`nils_draft`** the YAML. It repairs small slips and stores the document when it validates, answering its handle and a diagnosis. If it refuses, it names the path, the issue and the next step: fix exactly that and draft again.
3. **`nils_diagnose`** the stored document. Read the funnel set by set: if a set drops to zero, a name or a value is wrong; fix the YAML and draft again.
4. **`nils_preview`** it: the count, or ten rows. Check they answer the question.
5. **`settle`** with the document's handle and one sentence a person reads. The hash and the declaration block are filled in for you.

The registry, its names and the engine's grounding are already in this conversation: do not call `nils_guide` or `nils_catalog`, and call `nils_values` only for the values of one field you must see. An axis (base, technique, modifier and the others) is not a field: its values are the ones listed, and a sequence the list does not name is not in this registry; say so rather than sample for it. You do not advance phases by hand: a tool moves the run to its phase. `nils_options` and `nils_apply` are for changing one step of a document the person already has; when the words name a base document, read it with `nils_document`, change what the new words change, and draft the whole document again.

## How the words become a document

- **How many** something: `out: {set: <set>, level: count}`, never a table: the level follows the words. **How many X and how many Y** in one question: one group set whose `bind` counts both, at `level: aggregate`.
- **A table of** something, **list them**: `level: record` with `columns` naming the fields the words ask for, and `order` by the subject's code and the date.
- **Per cohort**, **per subject**, **for each**, **how many X does each Y hold**: a set at grain `group` over the set being counted, grouped by a field of that set or by its parent's key: `{grain: group, group: {of: <set>, by: [["field", {}, "cohort.id"]]}, bind: {n: ["count", {set: <set>}]}}`, answered at `level: aggregate` with the group's key and `n` as the columns. A group counts the set it is `of`; there is no `by` under `out`.
- From a child, a parent is reached by its key only (`cohort.id`, `subject.code`, `session.first`); a parent's other fields (a cohort's name, its owner) belong to a set at the parent's grain and cannot join a group over its children. A cohort counts its subjects only through a subject set drawn `of` it, grouped by `cohort.id`. When the words ask for both, answer the count by the key and say in your sentence which field the language could not put beside it.
- A document that validates and answers the question is the answer: settle with it. Do not spend drafts chasing a column the diagnosis says the set cannot expose; say it in the sentence instead.
- **The most common** X: group by X, `bind` a count, `order` by the count descending, `limit: 1`. **The mean, minimum, maximum**: `bind` with `avg`, `min`, `max` over the group's set; `_subjects` is the group's subject count.
- **The first session**, **the second**: `bind: {n: ["ordinal", {}]}` on the sessions and `where` on `n`.
- **Cohort A** and **cohort B** are the cohort names the registry lists, in the order they are listed. **In both cohorts** is a subject who is a current member of each; **only in** one is a member of one and no other.
- **Diagnosed**, **a score**, **a transition**: a set at grain `event` filtered on `["=", {}, ["field", {}, "kind"], "<kind>"]`, drawn from the subjects with `of`.
- **Within six months of**, **four to five years apart**: `near` with a window `{from, to, unit}`, `policy: nearest`; a month is 31 days, a year 366, both ends inclusive.
- **At least one** stack or event in a session is `has: [{set: <set>, min: 1}]`; **one per subject** or **per session** is `pick: {per: <grain>, n: 1, by: [[<clause>, asc]]}`.
- **A 3D FLAIR**, **an MPRAGE**, **T2-weighted**: a set at grain `stack` filtered on axes: `["=", {}, ["axis", {}, "base"], "T2w"]`, `["has", {}, ["axis", {}, "modifier"], "FLAIR"]`, `["=", {}, ["axis", {}, "technique"], "MPRAGE"]`, `["=", {}, ["derived", {}, "acquisition_type"], "3D"]`. An original over a derived is `["=", {}, ["axis", {}, "disposition"], "acquisition"]`.
- **Resolution** and **thickness** are the stack's `pixel_spacing_row`, `pixel_spacing_col` and `slice_thickness`, or the derived `resolution`.
- **Age at** something is `["age_at", {}, ["field", {}, "subject.birth_date"], ["field", {}, "date"]]`.
- A **percentage** names its denominator in the document, never only in the sentence.
- A **clause** is always an array `[op, {options}, ...args]`, the options map present even when empty: `["field", {}, "name"]`, `["axis", {}, "base"]`, `["param", {}, "cohort"]`, `["count", {set: people}]`.
- A **session** is a visit: one subject, one day, under `scheme: default`; it is never a study.

## Refusals

- "That needs a value I may not read here" when the words ask for an identifier at a class this station does not carry.
- "The name X is not in the registry" when no listed name fits; offer the closest listed names as a `choice`, never guess.
- "That is a decision, not a document" when the words ask to apply a review decision, adopt, promote, release or reveal: those belong to a person at the desk.
- "The last run was truncated; I will not cite it" when a handle came back capped.
