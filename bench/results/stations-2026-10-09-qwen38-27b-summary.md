# The stations on the local 27B after Flue 2.2.2, 2026-10-09 (Wave 7a, U0 baseline)

The seven stations measured again after the upgrade to Flue 2.2.2 and pi-ai 0.87.1, set up as the run of 2026-10-08 was: the site's own 27B (`qwen38-27b`, thinking off by the chat template, temperature 0.2, 8,192 output tokens, 65,536 context) through a Kvasir of the bench's own whose only backend was the site's model server, behind the same guard (only the stations' purposes pass; the title purpose is refused). Assistant 1.0.0-alpha.27 from this branch; engine 1.0.0-alpha.79 development build (dev.9, where 2026-10-08 had dev.7); pack mri 1.0.1. The same two registries: the synthetic one the ask-help and concierge golds were derived on, and a fresh one from `bench/seed.ts`.

| station | 2026-10-08 | 2026-10-09 | after the stalled rerun | median seconds a question (10-08, 10-09) |
|---|---|---|---|---|
| concierge | 0 of 5 chains | 2 of 5 chains | | |
| ask-help | 46 of 54 (strict 43) | 42 of 54 (strict 41) | 49 of 54 (10-08: 50 of 54) | 27, 21 |
| keyword-tune | 7 of 11 | 7 of 11 | | 34, 54 |
| analysis-plan | 7 of 12 | 8 of 12 | | 21, 18 |
| run-read | 1 of 3 | 1 of 3 | | 15, 12 |
| identity-check | 1 of 11 | 1 of 11 | | 84, 82 |
| operator | 0 of 13 | 0 of 13 | | 45, 39 |

The upgrade changes no station's score beyond the run-to-run spread of one model at temperature 0.2. The misses have the same causes as on 2026-10-08: keyword-tune's refused overlay scopes and the loop stop, identity-check's refused dataset probes, the operator's two calls outside the grant (9 of its 13 cases), the concierge read on its first turn only.

## Read beside the table

- **ask-help.** Seven cases (shape-24, shape-25 and five authored) made no call before the bench stopped waiting: for about fifty minutes from 09:30 UTC every model call took about 200 seconds. Asked again after it (`ask-help/rerun-stalled/`), all seven pass: authored 36 of 36 (the bar), shapes 13 of 18. The shape misses: shape-03 (seven rows against one), shape-04, shape-11 and shape-12 (the right rows, a different answer), shape-18 (144 rows against 144, a different answer). On 2026-10-08 the shapes were 14 of 18.
- **The stall.** Two runs on the converters question (shape-11 and a concierge chain asking the same) called `search_conversations` with the same words about 480 times each, until their requests held about 970 messages and the card spent minutes on each call. `search_conversations`, like the memory tools, does not pass the station's budget or its loop detector (warn at 3, stop at 5), so nothing in the station stopped them. The stall of 2026-10-08 (00:22 to 00:38, about 240 seconds a call) had the same look. Not caused by the upgrade.
- **concierge.** Chains A and B now reach the gold's answer at the opening, with 2 and 4 corrections; C does not after 4; D and E reach 2 and 1 of 4 turns.

## The prompt, the tools and system messages on the wire

- Since pi 0.86 a provider is handed the transcript with the prompt and the tools in system messages, and pi-messages sends it as it is. The Kvasir in use runs pi 0.83, which reads only `systemPrompt` and `tools` and drops system messages, so after a bare upgrade the model would have had neither prompt nor tools. The Kvasir provider and the title call now send the transcript collapsed, as pi does for a model that takes no system message mid-conversation.
- Every request the bench's Kvasir sent to the model server was captured (7,059). Each has one system message, first, and the tool list. Flue's appended messages (the station's follow-up note, a delegate's report) arrive as user messages wrapped in `<signal type="...">` tags, never as system messages. None of the 7,059 had a system message after the first, and none was refused.
- The model server does refuse a system message that is not first: a request of system, user, assistant, system, user, or of user, system, user, answers 400 "System message must be at the beginning." (the Qwen chat template). So any later design that appends instructions must keep them out of the system role, or collapse them into the leading message, as the provider now does.
