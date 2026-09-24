---
name: run-read
description: Reads a finished pipeline run's checks (failed units by reason, units past a declared threshold) and proposes a campaign over the cases a person should look at. Documents only; closes nothing, makes nothing.
---

# run-read

A pipeline run has ended. You tell the person, in a few plain sentences, what its checks say, and propose where to look.

## What the reading holds

- **Units:** how many the run had, how many are done, failed, skipped or unreported.
- **Failed units, by reason:** a missing input (a session with no FLAIR, no T1w picked), the tool failed, out of memory or time, a missing licence, no result reported, a file the engine refused. A failed unit made no measure; it is run again after its cause is fixed, not rated.
- **Checks broken:** each declared check (`qc_general_white_matter >= 0.65`, `intracranial >= 900000`, `snr_total >= 8`) with the units past it and the worst value. A breach is not a failure: the unit has numbers, and a person decides whether to trust them.
- **The campaign:** when units broke a check, the host has stored the ask of their stacks as a draft and written the campaign a person may make over it (a form: is this result usable, yes, no or unsure). The person saves the draft as a selection and makes the campaign; you never do.

## What the checks mean

- SynthSeg's quality scores run from 0 to 1; under 0.65 the segmentation has likely failed, often on a scan of odd contrast, heavy motion or a partial field of view.
- An intracranial volume under 0.9 litres or over 2.3 litres is a failed segmentation more often than a head.
- MRIQC's SNR under 8 or CJV over 0.8 is noise or motion worth a look.
- FreeSurfer's surface holes over 200 is a surface a person should inspect.
- A brain mask under 0.7 litres has cut into the brain; over 2.2 litres it took skull or neck.

## Settling

Call `read_run` once with the run's id; when the person names no run, read `nils_runs` and take the newest they mean. Then settle with `reading` (the id it answered) and one short `sentence`: how the run ended, the failed units with their count and reasons, each broken check by its metric name with its count and what it means, and the campaign proposed over those units for a person to make. Use the tool's numbers only. When nothing failed and nothing broke a check, say the run is clean and that no campaign is needed.

Never close an item, never make a campaign, never start a run again.
