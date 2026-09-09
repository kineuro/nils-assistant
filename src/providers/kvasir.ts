// SPDX-License-Identifier: AGPL-3.0-only
// Kvasir as a pi provider (Wave 4c §8.2, §9.1): the door speaks
// pi-messages, so the models come from GET /v1/config and the stream is
// pi-ai's own pi-messages adapter, with no compatibility flag. One provider
// per station, because a provider's headers are fixed and a station names
// its purpose in x-kvasir-purpose; the key is the app's minted key, the
// machine path of §8.4, read from a file and never from a client.

import { createProvider, type Model, type Provider } from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/api/pi-messages";

export interface Catalog {
  baseUrl: string;
  models: {
    id: string;
    name: string;
    reasoning: boolean;
    input: ("text" | "image")[];
    cost: Model<"pi-messages">["cost"];
    contextWindow: number;
    maxTokens: number;
    locality?: string;
  }[];
  health?: { warming?: boolean };
}

export async function readCatalog(url: string, key: string, dial: typeof fetch = fetch): Promise<Catalog> {
  const r = await dial(`${url.replace(/\/+$/u, "")}/v1/config`, {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`Kvasir answered ${r.status} to /v1/config`);
  return (await r.json()) as Catalog;
}

/** The provider id a station's model specifier names: `kvasir-<station>/<model>`. */
export function providerId(station: string): string {
  return `kvasir-${station}`;
}

export function kvasirProvider(opts: {
  station: string;
  purpose: string;
  catalog: Catalog;
  key: string;
}): Provider<"pi-messages"> {
  const id = providerId(opts.station);
  const models: Model<"pi-messages">[] = opts.catalog.models.map((m) => ({
    id: m.id,
    name: m.name,
    api: "pi-messages",
    provider: id as never,
    baseUrl: opts.catalog.baseUrl,
    reasoning: m.reasoning,
    input: m.input,
    cost: m.cost,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
  }));
  return createProvider<"pi-messages">({
    id,
    name: `Kvasir for ${opts.station}`,
    baseUrl: opts.catalog.baseUrl,
    headers: { "x-kvasir-purpose": opts.purpose },
    auth: {
      apiKey: { name: "the app's minted Kvasir key", resolve: async () => ({ auth: { apiKey: opts.key } }) },
    },
    models,
    api: { stream, streamSimple },
  });
}
