# ask-help evals

The fixtures that gate any change to this station: the 25 shapes and the three chains of `bench/corpus`, replayed through the recorded provider of `bench/gate`. Recordings land here as `<shape-id>.json` when `npm run bench:evals` runs live.

## The runs of 2026-09-09

`run-2026-09-09-local.json`: the local 27B (thinking off, temperature 0.2, a 64k context) on the reworked station: 10 of 18 by the strict hash, 14 of 18 the same answer (all 11 loop shapes, 3 of 7 held-out), a median of 46 seconds a shape, against 0 of 18 and every run ending by budget before the rework. `run-2026-09-09-minimax.json`: MiniMax M2.7 through the Anthropic shape on the same station, 7 of 18 strict, most misses ending by budget; a test of the remote provider shape, not the measure of the station. `run-2026-09-09.json` is the first run of the day, before the rework.

`chains-2026-09-09-local.json`: the three chains on the local 27B, scored as the bar says: chain A reached the gold's answer at the second correction where the researcher gave five, chains B and C at the opening with none where the researcher gave five and four; every follow-up turn (eight, seven and one) left a document. `stability-2026-09-09-local.json`: the composition question five times, five of five the gold's answer, one number, one scheme digest, about half a minute each.
