# Teaching

How what people correct becomes a better model, with every gate kept. It is not yet on the [documentation site](https://kineuro.se/nils/docs/assistant/what-it-is/), which covers installing and connecting the assistant.

The loop made visible with its gates kept. `GET /teaching/corrections` lists what the group corrected: proposals rejected with their reasons, review decisions by a person that overturned a station or the pack; identifiers, names, counts and the person's words, never a row. A reviewer curates them into a set (`POST /teaching/sets`), a JSONL file under the teaching directory.

An operator starts a fine-tune as a job on a set (`POST /teaching/sets/{id}/fine-tune` with a recipe of base, method lora, steps, rank, lr): `bench/finetune.py` runs a LoRA when torch, transformers and peft are importable and the base is a local model, and records a dry outcome with the recipe and the set's digest when they are not; either way the job registers a candidate in Kvasir's lifecycle with its recipe and appears in the inbox.

`GET /teaching/candidates` shows every candidate with the admission suite and the bench beside each other; `POST /teaching/candidates/{id}/admit` runs Kvasir's suite, `.../bench` runs the bench (the recorded numbers of the base model until the candidate is served, marked dry), and `.../promote` is refused with a sentence until both gates are green, then sends Kvasir's promote with the proposal.

`ASSISTANT_TEACHING`, `ASSISTANT_TEACHING_DIR`, `ASSISTANT_BENCH_THRESHOLD` (the share of the bench a candidate must pass, 1 by default) and `ASSISTANT_TEACHING_BACKEND` configure it. Kvasir is dialled with the person's own token, so the lifecycle's admin rule holds.
