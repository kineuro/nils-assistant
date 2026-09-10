# nils-assistant

**The assistant of NILS.** Stations on Flue, each one decision point with a manifest, a brief, a grant and a budget; the one seam through which any of them reaches the engine; and the bench that measures them before and after every change (`kineuro/nils`, `docs/specs/wave4c-the-assistant.md`, §9).

> **Pre-alpha.** Built in the open as part of Wave 4c of NILS v1. Flue is pinned exact (2.0.3) and with it the pi-ai version Flue pins (0.83.0), the same pin as Kvasir.

## Where things are

| | |
|---|---|
| [`kineuro/nils`](https://github.com/kineuro/nils) | The engine, the design record, the specification (§9) and the contracts (`contracts/suite/v1/station.schema.json`) this service is built against. |
| [`bench/`](bench/README.md) | The bench of §9.10: the corpus, the taxonomy, the deterministic gate, the attribution order, the change manifests, the baseline. Built before the first station. |
| `src/` | The service: the host, the seam, the station framework, the stations (D2 onwards). |
| `test/` | Vitest, with no network. |

## License

AGPL-3.0-only, under the same [Contributor License Agreement](CLA.md) as the engine.

## Teaching (Wave 5 section 9.5)

The loop of section 9.9 made visible with its gates kept. `GET /teaching/corrections` lists what the group corrected: proposals rejected with their reasons, review decisions by a person that overturned a station or the pack; identifiers, names, counts and the person's words, never a row. A reviewer curates them into a set (`POST /teaching/sets`), a JSONL file under the teaching directory. An operator starts a fine-tune as a job on a set (`POST /teaching/sets/{id}/fine-tune` with a recipe of base, method lora, steps, rank, lr): `bench/finetune.py` runs a LoRA when torch, transformers and peft are importable and the base is a local model, and records a dry outcome with the recipe and the set's digest when they are not; either way the job registers a candidate in Kvasir's lifecycle with its recipe and appears in the inbox. `GET /teaching/candidates` shows every candidate with the admission suite and the bench beside each other; `POST /teaching/candidates/{id}/admit` runs Kvasir's suite, `.../bench` runs the bench (the recorded numbers of the base model until the candidate is served, marked dry), and `.../promote` is refused with a sentence until both gates are green, then sends Kvasir's promote with the proposal. `ASSISTANT_TEACHING`, `ASSISTANT_TEACHING_DIR`, `ASSISTANT_BENCH_THRESHOLD` (the share of the bench a candidate must pass, 1 by default) and `ASSISTANT_TEACHING_BACKEND` configure it. Kvasir is dialled with the person's own token, so the lifecycle's admin rule holds.
