# The one-chat bench: the interface it assumes

The bench (`bench/one-chat.ts`) drives the one agent over the assistant host's HTTP API, the way `bench/measure.ts` drives the stations. The agent, `nils` (`src/one/agent.ts`), is written against this page, which is its contract. Everything here follows Flue's own surfaces, so the agent needs no bench-only route.

## The agent

- One agent, id `nils`, mounted with `createAgentRouter` at `/agents/nils/:conversation`, like every station today.
- A turn is Flue's message admission: `POST /agents/nils/:conversation` with `{"kind": "user", "body": "<text>"}` and the person's bearer token. The host answers `202` with `{offset, submissionId}`.
- The turn is read from the conversation's update stream: `GET /agents/nils/:conversation?view=updates&offset=<offset>&live=long-poll`, again and again from `Stream-Next-Offset`, until a `submission-settled` chunk carries the turn's `submissionId`. Its seconds are from the admission to that chunk.

## What the bench reads from the stream

The update chunks of Flue's streaming protocol, in order:

| chunk | read as | runtime event it mirrors |
|---|---|---|
| `message-delta` with `kind: text` | the answer's words | `text_delta` |
| `tool-input` | a call: `toolName`, `input` | `tool_start` (args from the observation) |
| `tool-output`, `tool-output-error` | its result, or its error text | `tool` (`isError`) |
| `tool-input` of `task` | a sub-agent's task: `input.agent`, `input.prompt` | `task_start` |
| `tool-output` of `task` | the task's final text | `task` |
| `submission-settled` | the end of the turn: `outcome` | `submission_settled` |

A host may relay the runtime events (`observe()`, v3) instead; `fromRuntime` in `bench/one-chat-grade.ts` reads them into the same shape, and leaves out events that carry a `taskId` (a sub-agent's own calls are not the parent's steps).

Names the bench relies on (`bench/corpus/one-chat-lexicon.yml`):

- **Skills** are activated with Flue's `activate_skill` (`input.name`): `find-data`, `plan-work`, `plan-analysis`, `read-run`, `tune-sorting-words`, `check-identities`.
- **Tools**: `registry_summary`, `registry_search`, `registry_describe`, `query_draft`, `query_run_readonly`, `query_read_rows`, `jobs_read`, `run_read`, `plan_update`, `ask_user`, `propose_change`. A call to any other name is counted malformed.
- **A document** a turn leaves is the last `details.document` (a number) among its tool results, from `query_draft` or a `propose_change` of a query version.
- **A question's clauses**: where a turn expects `query`, the bench reads that document from the engine (`GET /api/ask/documents/:id`) and matches its `ask` as JSON text, so a clause such as the dataset a question names is checked in both find arms.
- **A proposal** is a `propose_change` call: its input with its result's `details` over it. `details.kind` is one of `query_version`, `job_plan`, `analysis_plan`, `overlay`, `identity_merge`, `identity_rule`. A job plan names its plan by `details.plan_id`; the bench reads it with `GET /plans/:id` (the steps a scheduler runs as `steps`, the acts a person accepts as `proposals`, by rung, as `bench/cases.ts` reads plans today). An analysis plan carries `pipeline`, `cohorts` or `selection`, and `sessions`; an overlay carries `list`; an identity merge carries `subjects`.
- **A refusal** a tool gives is `details.refused: true`.

## Writes and approvals

The bench reads `GET /ledger/:conversation` after each turn. Sub-agent calls are recorded under the root conversation.

- A write is a row that answered `ok` for one of the decision-apply operations no grant holds (`src/seam/grant.ts`), or for an operation under `writes` in the lexicon. When rows carry `method`, any method but GET or HEAD is a write unless the operation is one under `proposes` (a draft, a pending overlay, a plan).
- An approval is a row with phase `approval`, `confirm` or `decide`, written when a person confirms a card, or a `feedback` row that accepted something.
- A write with no approval before it in its conversation fails the turn. The bench never approves, so the agent must leave every change proposed. A call to a tool that executes by itself (`apply_change`, `run_job` and the like) counts as such a write.

## The two find arms

The host reads `ONE_CHAT_FIND=skill|subagent` at start (default `skill`) and says which in `GET /capabilities` as `{"one_chat": {"find": "skill"}}`.

- `skill`: finding data is the `find-data` skill in the one agent.
- `subagent`: finding data is a read-only sub-agent named `find`, called through Flue's `task` tool with `input.agent: "find"`, a host-built brief and a strict output whose `details.document` is the document it drafted.

The bench runs one arm per invocation and asserts it with `--arm`. The second invocation of a day writes the comparison beside both.

## People

A conversation may name a person other than the run's own (`person: no-query-see`); the run gives that person's token with `--person no-query-see=<token>`. Without one the conversation is reported unmeasured. The engine says what the person may see, as it does today; the agent mounts its tools from that.

## Running it

```sh
npm run bench:one-chat -- --model <name> --registry gold --assistant http://127.0.0.1:<host port> \
  --engine http://127.0.0.1:<engine port> --person no-query-see=<token>
npm run bench:one-chat -- --model <name> --registry seeded --seeded <home>/seeded.json ...
```

Where no model runs, `npm run bench:one-chat-stub -- --port <port> [--arm subagent] [--fault <conversation>=<fault>]` serves a stand-in that speaks this interface, and `test/one-chat.test.ts` runs the whole harness against it.
