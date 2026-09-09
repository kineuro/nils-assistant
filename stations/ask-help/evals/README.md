# ask-help evals

The fixtures that gate any change to this station: the 25 shapes and the three chains of `bench/corpus`, replayed through the recorded provider of `bench/gate`. Recordings land here as `<shape-id>.json` when `npm run bench:evals` runs live.

## The runs of 2026-09-09

`run-2026-09-09-local.json`: the local 27B (thinking off, temperature 0.2, a 64k context) on the reworked station: 10 of 18 by the strict hash, 14 of 18 the same answer (all 11 loop shapes, 3 of 7 held-out), a median of 46 seconds a shape, against 0 of 18 and every run ending by budget before the rework. `run-2026-09-09-minimax.json`: MiniMax M2.7 through the Anthropic shape on the same station, 7 of 18 strict, most misses ending by budget; a test of the remote provider shape, not the measure of the station. `run-2026-09-09.json` is the first run of the day, before the rework.
