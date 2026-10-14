---
name: tune-sorting-words
description: Teach the sorting of scans a word the site uses (a contrast agent's name, a local word in series descriptions): rehearse one change to one word list as a typed rule change, then propose it. Use when the person asks to teach or change the sorting's words.
---
# Teaching the sorting a word

The sorting decides what each scan is from words in its series description. A word list is a bucket the sorting names (such as `contrast_positive`), or the list of one value of an axis, named `axis.value`. You change one list by one word as a typed rule change (`add_words` or `remove_words`, each with its scope, its reason and its evidence), rehearse what it does to the sorting (writing nothing), and propose it if it holds. An operator adopts it on the Rules page; you never change a rule or a threshold yourself.

## The scope

- The scans the person named: a dataset (`dataset:NAME`), a site (`site:NAME`), a scanner maker (`origin:NAME`) or a batch (`batch:ID`). The change then applies to those scans alone, at every sort, and to no other.
- `pack`: every site's sorting, shipped as a rules release. Only when the person says the word holds everywhere.

## The loop

1. **Find the list.** The person's word and what it means tell you the axis and the list: a contrast agent's name given when contrast was given is the bucket `contrast_positive` on the axis `post_contrast` (its values `given` and `not_given`). `registry_describe` with what word_lists (and `axis`) shows the lists and what each holds; with what signals over a `batch:<id>` scope the open review groups.
2. **`query_run_readonly`** with `what: sorting_words`, `scope`, `axis`, `bucket` (or `value`), `add: [<the word in lower case>]`, `flip` (the review groups that should close, as the signals name them, or leave it out), `why` (the person's reason in a few words), and one case: `case_text` (a series description carrying the word, such as "T1 MPRAGE zorvex") and `case_value` (the value it must get, such as `given`). This is the prediction and the rehearsal at once: the change's effect report over the whole registry, how many scans move and from what to what, and what it fixes and breaks among the answers people gave. It writes nothing.
3. Read its `diff`: `keep` → **`propose_change`** with `kind: overlay`, `name` and `why`; `partial` → narrow once and rehearse again, or propose saying what is left (a change that breaks an answer people gave is never `keep`); `revert` → say why and propose nothing.
4. Answer in one or two sentences: the word, the list, how many scans it moved, what it fixes and breaks, and that it waits for an operator to adopt it on the Rules page.

## Worked example

"In the dataset partner-2026 the radiographers write our contrast agent, zorvex, into the series description. Teach the sorting that word." → `query_run_readonly {what: sorting_words, scope: "dataset:partner-2026", axis: post_contrast, bucket: contrast_positive, add: [zorvex], why: "the site's contrast agent", case_text: "T1 MPRAGE zorvex", case_value: given}`, then `propose_change {kind: overlay, name: "zorvex-contrast", why: "the site's contrast agent", sentence: "Add zorvex to the contrast words for partner-2026."}`.

Never a stack id, never a row, never a subject: counts, words and values only.
