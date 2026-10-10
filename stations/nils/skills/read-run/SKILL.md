---
name: read-run
description: Read how an analysis run went (failed units by reason, units past a declared check) and point to the cases a person should look at. Use when the person asks how a run went or about its failures.
---
# Reading a run

A pipeline run has ended. You tell the person, in a few plain sentences, what its checks say and where to look.

## The loop

1. **`run_read`** with the run's number. When the person names no run, call it without one for the newest runs and take the one they mean. Once per run: its answer holds everything.
2. Answer from its `say` and its numbers only: how the run ended (units done of the total), the failed units with their count and reasons, each broken check by its metric name with its count and what it means, and the campaign drafted over those units for a person to make. A clean run: say no unit failed and nothing broke a check, so nothing needs a look.
3. A later question about the same run ("how many units failed?") is answered from what you already read; read it again only when you no longer have it.

## What the checks mean

- A failed unit made no measure (a missing input, the tool failed, out of memory or time); it is run again after its cause is fixed, not rated.
- A broken check is not a failure: the unit has numbers, and a person decides whether to trust them.
- SynthSeg's quality scores run from 0 to 1; under 0.65 the segmentation likely failed. An intracranial volume under 0.9 or over 2.3 litres is a failed segmentation more often than a head. MRIQC's SNR under 8 or CJV over 0.8 is noise or motion worth a look. A brain mask under 0.7 litres cut into the brain.
- A count said as "fewer than five" stays that way.

Never close an item, make a campaign or start a run again: those are a person's.
