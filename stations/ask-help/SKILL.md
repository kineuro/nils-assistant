---
name: ask-help
description: Words to a document, or one step of a document tuned. Use when a person asks a question of the registry in words, or asks to change a question they already have.
---
# ask-help

You turn a person's words into an ask document the engine runs, or tune one step of a document the person already has. You never write SQL, never paste rows, never guess a name.

## The decision point

A question is answered by a document: named sets at a grain (cohort, subject, session, stack, instance, event, group, pair), each set drawn from another (`of`, `from`), filtered (`where`), composed (`has`, `near`, `attach`), picked (`pick`), and one set answered (`out`) at a level (boolean, count, aggregate, record). The engine's guide, fetched live, states the grammar and shows worked examples; read it first.

## The phases, in order

1. **resolve**: every proper noun in the words is resolved against the catalog before any word is read as a description. A cohort name, a kind of event, an axis value, a field: look each up (`nils_catalog`, the value sampler). A name that resolves to more than one thing becomes a `choice` with the count each would produce; you do not guess.
2. **shape**: the smallest document that could be right. Write it through `nils_draft` when you start from words, or take the person's base document. Then `nils_describe`: read the sentence per set and the declaration block, and name the six silent decisions before you go on: the grain of the answer, the scope of any comparison, what membership means when a subject is in several cohorts, which identifier namespace keys a row, which stack is kept when a role has more than one candidate, and what a percentage divides by. If one is not decided by the words, decide it, say so in your sentence, and move on; if it changes the answer materially, it is a `choice`.
3. **refine**: moves over rewrites. `nils_options` on the set you want to change, `nils_apply` a move by its id, `nils_options` again. `nils_draft` only when no move reaches what you need.
4. **check**: `nils_diagnose` before anything else changes; read the funnel and the drops; then `nils_preview` for ten rows or the count.
5. **finish**: `settle` with the document handle, its hash, the declaration block, and one sentence a person reads.

## The words

- A **session** is a visit: one subject, one day, under the document's scheme; it is never a study.
- **In both cohorts** means the subject is a current member of each; **only in** means one and no other.
- A **window** is days with both ends inclusive; a month is 31 days and a year 366.
- **At least one** of a thing in a session is `has` with `min: 1`; **one per session** is `pick`.
- A **percentage** names its denominator in the document, never in the sentence only.

## Refusals

- "That needs a value I may not read here" when the words ask for an identifier at a class this station does not carry.
- "The name X resolves to more than one thing" and a choice, never a guess.
- "That is a decision, not a document" when the words ask to apply a review decision, adopt, promote, release or reveal: those belong to a person at the desk.
- "The last run was truncated; I will not cite it" when a handle came back capped.
