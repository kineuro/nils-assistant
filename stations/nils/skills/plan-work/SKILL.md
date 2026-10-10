---
name: plan-work
description: Turn an instruction to do something to the registry (digest, bring in, classify, fingerprint, rebuild, erase, release) into a plan the person approves once. Use for any instruction to act, now or at a time.
---
# Planning work

You turn an instruction into a plan of steps. You run nothing: the person approves the plan on its card, the host then runs the steps that can be undone under their own standing permission, and the acts that cannot be undone wait for them one by one.

## The steps

One verb per act, with its arguments, nothing else:

- `digest` {place, path?}: walk a source place and digest what it holds. `place` is a place's name, such as `inbox`; never a path of the computer.
- `bring_in` {dataset}: bring in what is new in a dataset (pseudonymise, digest, fingerprint and classify, each after the one before).
- `pseudonymize` {dataset, name?, held?}: pseudonymise a dataset's originals and nothing more.
- `classify` {pack?}: classify every stack; leave `pack` out for the default.
- `fingerprint` {}: fingerprint every stack that has no fingerprint yet.
- `rebuild` {}: rebuild the sessions.
- `run` {document}: run a stored question as a job.
- `adopt` {overlay}, `release` {name, out} or {nothing: true}, `handover` {release, out}, `promote` {handle, cohort}, `erase` {what}, `rule` {rule}: these cannot be undone. Name them anyway; they become acts the person accepts one by one.

## When

Each step has `when`: `"now"`, `{"on_event": "batch_landed"}` for "when the batch lands", `{"on_event": "job_finished"}` for a step after "then", `{"after_job": id}`, or `{"at": "2026-10-10T02:00:00Z"}` for a time (UTC, the date of the coming night when the person says tonight).

## The loop

1. Read only what you need: `registry_describe` with what batches or documents, `jobs_read` for what is running.
2. **`propose_change`** once, `kind: job_plan`, with `instruction` (the person's words), `steps` in order, and `sentence`: the plan in their words, one short clause per step.
3. Answer in one or two sentences: what will happen and when, and that nothing runs until they approve it.

## Worked examples

- "Digest what is in the inbox." → `steps: [{verb: digest, args: {place: inbox}, when: now}]`
- "Fingerprint every stack that has none yet, then classify everything with the default pack." → `steps: [{verb: fingerprint, args: {}, when: now}, {verb: classify, args: {}, when: {on_event: job_finished}}]`
- "Erase subject SYN0005 and everything derived from it." → `steps: [{verb: erase, args: {what: "subject SYN0005"}, when: now}]`; it cannot be undone, so it waits for the person as an act to accept.
- "Rebuild the sessions tonight at 02:00 UTC." → `steps: [{verb: rebuild, args: {}, when: {at: "<tonight>T02:00:00Z"}}]`

Never promise a result, never say it has run.
