# nils-assistant

**The assistant of NILS**: it turns a question asked in words into one the NILS engine answers, and offers what it proposes as a change a person accepts or rejects. It never decides anything on its own.

It is part of [NILS](https://github.com/kineuro/nils). The desk hands it the signed-in person's token, so it reaches the engine with that person's own permissions, and it reaches a model only through [Kvasir](https://github.com/kineuro/kvasir), the gateway.

> **Pre-alpha.** The assistant installs and runs, and its interfaces still change between releases.

## Install

The NILS setup wizard installs the assistant and its gateway: choose "Everything" at the first step.

```sh
curl -fsSL https://nils.kineuro.se/get | sh
```

It needs a model to talk to: a model server on the machine or another one you reach, or a commercial provider. The wizard reads the graphics card and says what it can serve.

## Documentation

**[kineuro.se/nils/docs](https://kineuro.se/nils/docs/)**

- [What the assistant is made of](https://kineuro.se/nils/docs/assistant/what-it-is/)
- [The model and the gateway](https://kineuro.se/nils/docs/assistant/kvasir/)
- [Install the assistant](https://kineuro.se/nils/docs/assistant/install/) and [connect the desk](https://kineuro.se/nils/docs/assistant/connect/), without the wizard

## The parts of NILS

| Repository | Part |
|---|---|
| [kineuro/nils](https://github.com/kineuro/nils) | The engine: the registry, the rule packs, the `nils` command and the setup wizard. Everything else talks to it. |
| [kineuro/nils-desk](https://github.com/kineuro/nils-desk) | The desk: the web application over the engine, and where people sign in. |
| **kineuro/nils-assistant** | The assistant: turns a question in words into one the engine answers. |
| [kineuro/kvasir](https://github.com/kineuro/kvasir) | The model gateway: every call the assistant makes to a model goes through it. |

## Building from source

```sh
npm ci && npm run build && npm test
node bin/serve.mjs    # listens on 127.0.0.1, PORT and HOST to change it
```

| | |
|---|---|
| `stations/` | The stations: each one decision point, with its brief, the tools it may call and its budget. |
| `src/` | The service: the host, the seam to the engine, the station framework. |
| [`bench/`](bench/README.md) | The bench that measures the stations before and after every change. |
| [`docs/teaching.md`](docs/teaching.md) | How corrections become a better model, with every gate kept. |

## License

AGPL-3.0-only, under the same [contributor license agreement](CLA.md) as the engine. See [CONTRIBUTING.md](CONTRIBUTING.md).
