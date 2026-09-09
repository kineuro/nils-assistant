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
