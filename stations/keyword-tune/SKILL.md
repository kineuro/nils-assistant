---
name: keyword-tune
description: One word list of one axis of one pack tuned against the classifier's own signals, a bucket or the list of one axis value: survey, hypothesise with a prediction, rehearse through try, read the diff, propose an overlay.
---

# keyword-tune

The decision point is one change to one word list of one axis, and whether the classifier's own signals bear it out. A list is a bucket the pack names, or the word list of one axis value, named `axis.value`; every such list is the site's to grow through an overlay. You never edit a rule, a flag, a physics threshold or the order values are tried in: those stay the pack's.

## The phases

1. **survey**: `nils_signals` over the scope you were given (`batch:<id>`, `origin:<name>` or `pack:<version>`). Read per axis the tiers (how many stacks a keyword decided, how many stayed at the default, how many went to a vote), the same by value where the engine reports it, the open review items by group key, the shadowed keywords (a term found in the text and cited nowhere, which can never match), the unused overlay terms, and the terms a person's decisions overrode most. `nils_review` for the open items and their members. `nils_pack` for the axis you settle on: what each value's list holds, and the buckets. Find the one list where a term would settle the most. The signals carry no text: a term comes from the person's own words (a site's agent name, a localizer word), from the shadowed keywords, or from the terms a person's decisions overrode. Never guess a term a list already holds; read the list.
2. **hypothesise**: write it with `hypothesis`: the axis, the list (`bucket` for a bucket the pack names, or `value` for the axis value whose list changes, one of the two), the terms to add or remove, the review groups that should flip (their group keys exactly as the signals show them), and the axis values that must not regress (`axis=value`). This is a prediction and it comes before any rehearsal; the check reads the clock.
3. **rehearse**: `nils_try` with the scope, a sample, and one case: a series description that carries the term and the axis value it must get. The overlay is built from the hypothesis, the list under `buckets` or under `lists` as `axis.value`; the rehearsal writes nothing.
4. **check**: read the diff the rehearsal answered. `keep`: the predicted groups close, nothing else moves, propose it with `nils_propose`. `partial`: go back to hypothesise once, narrow the change, rehearse again. `revert`: something that must not regress moved, or another axis moved; say so and settle without a proposal.
5. **finish**: settle with the axis, the list (the bucket's name, or `axis.value`), the overlay, the prediction, the rehearsal's moves and review counts, the diff, and the proposal (overlay id and review item) or null.

## The rules

- One change per run, to one list. A second hypothesis replaces the first.
- Never a stack id, never a row of a result, never a subject. Counts, group keys, terms and axis values only.
- The proposal is a person's to adopt; you never adopt. A review decision you suggest is for a group the rehearsal closed, never for a single stack.

## The run's inputs

The desk starts a run with one message that names the scope (`scope: batch:<id>`, `origin:<name>` or `pack:<version>`) and may name the list to tune (`list: <axis>.<value>` or a bucket's name) and the term in the person's words (`term: <word>`). A message with no scope is answered with what a scope is, and no rehearsal.
