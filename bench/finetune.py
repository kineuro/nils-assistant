# SPDX-License-Identifier: AGPL-3.0-only
# The fine-tune runner (Wave 5 section 9.5): a LoRA of `steps` steps on a
# curated set against the base model when torch, transformers and peft are
# importable and the base is a local model path; otherwise a dry run that
# records the recipe and the set's digest, makes no adapter, and says so.
# The last line on stdout is always one JSON object, the outcome.
#
#   python3 bench/finetune.py <set.jsonl> '<recipe json>' <out dir>

import hashlib
import json
import os
import sys


def main() -> int:
    set_path, recipe_text, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    recipe = json.loads(recipe_text)
    with open(set_path, "rb") as f:
        raw = f.read()
    set_digest = hashlib.sha256(raw).hexdigest()
    lines = [json.loads(l) for l in raw.decode("utf8").splitlines() if l.strip()]
    texts = [f"{l.get('correction', '')}\n{l.get('why') or ''}".strip() for l in lines]
    base = str(recipe.get("base", ""))
    steps = int(recipe.get("steps", 20))
    outcome = {"dry": True, "base": base, "steps": 0, "adapter": None, "set_digest": set_digest, "note": ""}
    try:
        import torch  # noqa: F401
        from peft import LoraConfig, get_peft_model
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except Exception as e:  # noqa: BLE001
        outcome["note"] = f"dry: torch, transformers or peft is not importable here ({type(e).__name__}); the recipe and the set are recorded, no adapter was made"
        print(json.dumps(outcome))
        return 0
    if not os.path.isdir(base) or not texts:
        outcome["note"] = "dry: the base is not a local model directory, or the set is empty; no adapter was made"
        print(json.dumps(outcome))
        return 0
    tok = AutoTokenizer.from_pretrained(base)
    model = AutoModelForCausalLM.from_pretrained(base, torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32)
    model = get_peft_model(model, LoraConfig(r=int(recipe.get("rank", 8)), lora_alpha=16, task_type="CAUSAL_LM"))
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=float(recipe.get("lr", 1e-4)))
    model.train()
    loss_value = None
    for step in range(steps):
        batch = tok(texts[step % len(texts)], return_tensors="pt", truncation=True, max_length=512).to(device)
        out = model(**batch, labels=batch["input_ids"])
        out.loss.backward()
        opt.step()
        opt.zero_grad()
        loss_value = float(out.loss)
    os.makedirs(out_dir, exist_ok=True)
    model.save_pretrained(out_dir)
    outcome.update({"dry": False, "steps": steps, "adapter": out_dir, "note": f"lora of {steps} steps, final loss {loss_value:.4f}"})
    print(json.dumps(outcome))
    return 0


if __name__ == "__main__":
    sys.exit(main())
