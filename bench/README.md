# The bench (Wave 4c §9.10)

Five parts, built before the first station. Only the fifth needs a model.

1. **The corpus, scrubbed and rebased** (`corpus/`). Twenty-five distinct question shapes and three refinement chains, paraphrased turn by turn from one researcher's traffic against the previous prototype, with every name, code, identifier, UID and path replaced; the private record holds the transformation under the corpus review rule. Each shape names the grain it asks at, the silent decisions it hides, and the failure words the prototype earned on it. The gold answers are re-derived against the synthetic registry the engine's gate already uses (`nils synth --seed 11 --subjects 48`, the MRI pack), as ask documents under `gold/`; `gold/expect.json` records each one's content hash, row count, the registry epoch and the pack version beside it, so a gold answer goes stale rather than red. `corpus/shapes.yml` says which shapes could not be rebased and why.
2. **The taxonomy, closed** (`taxonomy.ts`). The ten failure words the prototype's evaluator used, plus infrastructure failure, cohort name misresolution, default exclusion omission and identifier fan-out, plus a counted `other`; and the six silent decisions as a second axis.
3. **The gate, deterministic** (`gate/`). Fixtures replayed through a recorded provider, so the station test suite passes with no network at all; one fixture asserts a recovery path fired by reading the recorded transition, never the message text.
4. **The attribution order, once** (`attribution.ts`). Domain knowledge, tool description, prompt, control flow, tool behaviour, configuration, delegation: one table that generates both the code path a diagnosis walks and the prompt text a diagnoser reads.
5. **The discipline** (`manifest/`). Every edit to a prompt, a brief, a tool description or a check is a change manifest with a prediction, judged by the nine-state transition matrix (keep, partial, revert, inconclusive); a held-out split exists before the first loop and both numbers are reported on one screen; no judge on the gate; a person merges every harness edit.

## Running it

```sh
npm ci
npm test                                   # taxonomy, matrix, split, replay, the gold set's shape
NILS_URL=http://127.0.0.1:8437 npm run bench:gold      # re-derive gold/expect.json against a registry
KVASIR_URL=... KVASIR_TOKEN=... npm run bench:baseline # the one-shot baseline through Kvasir, recorded
```

The baseline is one shot: the model reads the engine's guide and the question, writes an ask document, the engine runs it, and the content hash is compared to the gold. The number published beside the prototype's 17.9 percent is that fraction on the rebased corpus; the provider's answers are recorded into `gate/fixtures/` so the number is reproducible from the repository alone.

## Measuring the stations (Wave 7a)

`bench/measure.ts` runs every station's questions through a running assistant host and its engine, scores each against its golds, and writes one dated result, `bench/results/stations-<date>-<model>.json`, with the table beside it as `.md` and each station's own file under `bench/results/stations-<date>-<model>/`. It runs the scripts above as children (ask-help on both corpora, the concierge through the chains, analysis-plan and run-read through `analyses.ts`), and keyword-tune, identity-check and the operator through their question sets. A station with no question set is reported unmeasured, with the reason.

The endpoints are arguments and default to this machine; another host is refused unless `--allow-remote` says it is the site's own. The model is the one the host serves; `--model` names it for the record.

The question sets of keyword-tune, identity-check and the operator are `stations/<id>/evals/cases.yml`, read by `bench/cases.ts`: a message a case, and what the run must leave in its result, in the plan the host keeps and in the conversation's ledger. A case may carry `gap`, what the station cannot do yet that the case expects; it is scored like the rest and listed beside the score.

concierge and ask-help are measured on the registry their golds were derived on:

```sh
npm run bench:measure -- --model <name> --assistant http://127.0.0.1:<host port> --engine http://127.0.0.1:<engine port> \
  --stations concierge,ask-help
```

The other five are measured on a registry of their own, since a third cohort changes the answers of the cohort inventory and the per-cohort counts: `bench/seed.ts` builds it from nothing in an empty directory (the synthetic registry; the cohort `nmosd` of nine synthetic subjects; the saved selections `ms-baseline@1` and `every-t1@2`; the starter catalog; the three planted runs of `bench/planted.ts` over a small synthetic DICOM tree, run through a stand-in container runtime; the batch `keyword-bench` with two made-up site words; five datasets that arrive identified, with their maps filed; the datasets `ds-sorted` and `ds-marked`, which arrive anonymised and are sorted with the rest while body part and post-contrast never run on them, the headers marking none of ds-sorted's scans as given contrast and three of ds-marked's eight; the location `inbox`; one stored question, all from `bench/fixtures.ts`). Serve it with the command `seeded.json` holds under `serve`, point a second host at it, and measure:

```sh
npm run bench:seed -- --home <empty dir> --nils <nils binary> --pack-dir <packs>
<the serve command of <empty dir>/seeded.json, with a port>
npm run bench:measure -- --model <name> --assistant http://127.0.0.1:<second host port> --engine http://127.0.0.1:<engine port> \
  --stations keyword-tune,analysis-plan,run-read,identity-check,operator --seeded <empty dir>/seeded.json
```

A second invocation of the same day and model adds its stations to the same result file.

### Offline, with the stub model

`bench/offline.ts` runs a station's question set through the station's own code, in this process, against the seeded engine, with the stub model of `bench/stub-model.ts` in place of a model: a provider with no network that follows the station's brief by a fixed policy and calls the station's tools. Each case is scored as the measure scores it. It says whether the engine's doors, the station's tools and checks and the cases agree, before a model is put to them; it measures no model. The stub has a policy for identity-check.

```sh
npm run bench:offline -- --engine http://127.0.0.1:<engine port> [--stations identity-check] [--out <file>]
```

## The one chat (Wave 7a, slice C3)

`bench/one-chat.ts` measures the one agent, `nils`, that replaces the stations' gears: forty-two multi-turn conversations in `corpus/one-chat.yml`, built from the chains, the authored shapes and the stations' cases, each run three times in a fresh conversation, graded on outcomes by `one-chat-grade.ts`: the right skill, the gold reached, no write without an approval, door phrases, engine words and steps after the answer at 0 (`corpus/one-chat-lexicon.yml`), refused and malformed calls and the seconds beside. It reports pass@1 and pass^3 per kind, and the two find arms (a skill, or a read-only sub-agent) side by side. The interface it drives is `ONE-CHAT.md`; where no model runs, `one-chat-stub.ts` stands in for it, and the test suite runs the harness against that.

`chains.ts` now scores each turn on its final verdict: a station that hands the work on settles first with no document, and the document comes in the delegate's verdict and the woken parent's (`turns.ts`).

## The baseline, 2026-09-09

The prototype's frozen gate passed 17.9 percent one shot on the best model of its day, against the live archive. On the rebased corpus (eighteen shapes with a gold answer, registry epoch 2, pack mri 0.1.1), one shot with the engine's guide, the worked examples and a catalog slice in the prompt, temperature 0:

| model | through | passed | loop split | held-out split | recording |
|---|---|---|---|---|---|
| the organisation's commercial model, Anthropic shape (reasoning on) | Kvasir, purpose `assistant.title` | 1 of 18 (5.6 percent) | 1/11 | 0/7 | `gate/baseline-minimax-m2.7-anthropic.json` |
| the local 27B model, thinking off by the chat template, 4,096 output tokens | Kvasir, the admitted `card0-fast` profile | 1 of 18 (5.6 percent) | 0/11 | 1/7 | `gate/baseline-qwen38-27b-fast.json` |

The failures are the grammar's, not the registry's: an unknown field copied from the prompt, a clause written as a string rather than `[op, {opts}, ...args]`, a missing options map, a wrapper object around the document. The local model with thinking on spent its whole output budget thinking (sixteen thousand tokens on the first shape) and was not scored. These are the numbers a station must beat, on both splits, before any harness edit counts.
