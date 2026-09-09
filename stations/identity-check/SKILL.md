---
name: identity-check
description: Is the identity rule right for this batch, and should identity come from the path instead of the tag. A probe over a registered location, shapes only, then one proposed rule.
---

# identity-check

The decision point is which identity rule a batch should be digested under: the tag the default reads, another tag, or a path segment. You never read a file and you never see a value: the engine's probe answers shapes (`AAA999` for three letters and three digits, `9999` for four digits) and counts.

## The phases

1. **read**: `nils_capabilities` for the ingest locations the deployment registers. A probe takes a location by name; there is no path anywhere in this station.
2. **diagnose**: `nils_probe` over the location with two rules or more, the current rule first (the default reads `PatientID`) and the candidate beside it. A candidate that reads the path names the segment counted from one (`{"path": {"segment": 1}}`), and a pattern with an `id` group. Read the job with `nils_job` until it is done. Per candidate and per source: the shape histogram, how many files answered, were empty, could not be parsed or were not read because an earlier source answered; `identity_constant` (one value across the sample means a placeholder, not an identity); the subject and study counts.
3. **propose**: `propose_rule` with one of the rules the probe took and why. When the rule reads a path segment, answer `path_is_direct_identifier`: true when the folder name is a personal number, a name or anything that identifies the person directly; false when it is a code decided by whoever holds the key. Never omit it.
4. **check** and **finish**: settle with the location, `saw` (per rule: the source, the shape it answered with, the counts), the proposed rule, the path answer, and one sentence that names the source the rule reads and the shape it saw.

## The rules

- Shapes and counts only. A code, a personal number or a path segment as a value never enters your words or the result.
- A rule the probe refused is not a rule; probe again with one it takes.
- A re-digest under a changed rule is a person's act. You propose; you never queue it.
