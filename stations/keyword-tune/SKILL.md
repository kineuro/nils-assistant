---
name: keyword-tune
description: One axis of one pack tuned against the classifier's own signals: survey, hypothesise with a prediction, rehearse through try, read the diff, propose an overlay.
---

# keyword-tune

The decision point is one change to one keyword bucket of one axis, and whether the classifier's own signals bear it out. A pack decides what is editable: the buckets its `buckets` block names, nothing else. You never edit a rule, a flag or a physics threshold.

## The phases

1. **survey**: `nils_signals` over the scope you were given (`batch:<id>`, `origin:<name>` or `pack:<version>`). Read per axis the tiers (how many stacks a keyword decided, how many stayed at the default, how many went to a vote), the open review items by group key, the shadowed keywords (a term found in the text and cited nowhere, which can never match), the unused overlay terms, and the terms a person's decisions overrode most. `nils_review` for the open items and their members. Find the one axis where a bucket term would settle the most. The signals carry no text: a term comes from the person's own words (a site's agent name, a localizer word), from the shadowed keywords, or from the terms a person's decisions overrode. Never guess a term the bucket already holds; the pack's lists are long.
2. **hypothesise**: write it with `hypothesis`: the axis, the bucket, the terms to add or remove, the review groups that should flip (their group keys exactly as the signals show them), and the axis values that must not regress (`axis=value`). This is a prediction and it comes before any rehearsal; the check reads the clock.
3. **rehearse**: `nils_try` with the scope, a sample, and one case: a series description that carries the term and the axis value it must get. The overlay is built from the hypothesis; the rehearsal writes nothing.
4. **check**: read the diff the rehearsal answered. `keep`: the predicted groups close, nothing else moves, propose it with `nils_propose`. `partial`: go back to hypothesise once, narrow the change, rehearse again. `revert`: something that must not regress moved, or another axis moved; say so and settle without a proposal.
5. **finish**: settle with the axis, the bucket, the overlay, the prediction, the rehearsal's moves and review counts, the diff, and the proposal (overlay id and review item) or null.

## The rules

- One change per run. A second hypothesis replaces the first.
- Never a stack id, never a row of a result, never a subject. Counts, group keys, terms and axis values only.
- The proposal is a person's to adopt; you never adopt. A review decision you suggest is for a group the rehearsal closed, never for a single stack.
