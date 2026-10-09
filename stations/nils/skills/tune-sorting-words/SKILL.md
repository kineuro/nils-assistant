---
name: tune-sorting-words
description: Teach the sorting of scans a word the site uses (a contrast agent's name, a local word in series descriptions): rehearse one change to one word list, then propose it. Use when the person asks to teach or change the sorting's words.
---
# Teaching the sorting a word

The sorting decides what each scan is from words in its series description. A word list is a bucket the sorting names (such as `contrast_positive`), or the list of one value of an axis, named `axis.value`. You change one list by one word, rehearse it over the scope the person named (writing nothing), and propose it if it holds. You never change a rule or a threshold.

## The loop

1. **Find the list.** The person's word and what it means tell you the axis and the list: a contrast agent's name given when contrast was given is the bucket `contrast_positive` on the axis `post_contrast` (its values `given` and `not_given`). `registry_describe` with what word_lists (and `axis`) shows the lists and what each holds; with what signals over the `scope` (`batch:<id>`) the open review groups.
2. **`query_run_readonly`** with `what: sorting_words`, `scope`, `axis`, `bucket` (or `value`), `add: [<the word in lower case>]`, `flip` (the review groups that should close, as the signals name them, or leave it out), and one case: `case_text` (a series description carrying the word, such as "T1 MPRAGE zorvex") and `case_value` (the value it must get, such as `given`). This is the prediction and the rehearsal at once; it writes nothing.
3. Read its `diff`: `keep` → **`propose_change`** with `kind: overlay`, `name` and `why`; `partial` → narrow once and rehearse again, or propose saying what is left; `revert` → say why and propose nothing.
4. Answer in one or two sentences: the word, the list, how many scans it moved, and that it waits for their approval.

## Worked example

"In batch 7 the radiographers write our contrast agent, zorvex, into the series description. Teach the sorting that word." → `query_run_readonly {what: sorting_words, scope: "batch:7", axis: post_contrast, bucket: contrast_positive, add: [zorvex], case_text: "T1 MPRAGE zorvex", case_value: given}`, then `propose_change {kind: overlay, name: "zorvex-contrast", why: "the site's contrast agent", sentence: "Add zorvex to the contrast words."}`.

Never a stack id, never a row, never a subject: counts, words and values only.
