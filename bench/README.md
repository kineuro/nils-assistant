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
