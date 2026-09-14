// SPDX-License-Identifier: AGPL-3.0-only
// Kvasir as a pi provider (Wave 4c §8.2, §9.1): the door speaks
// pi-messages, so the models come from GET /v1/config and the stream is
// pi-ai's own pi-messages adapter, with no compatibility flag. One provider
// per station, because a provider's headers are fixed and a station names
// its purpose in x-kvasir-purpose; the key is the app's minted key, the
// machine path of §8.4, read from a file and never from a client. pi's model
// registry merges a model's own headers into a call, never its provider's, so
// the purpose is put into every call's options here, whichever way the call
// reaches the provider; before, Kvasir filed every station's calls under the
// key's first purpose. Where a person streams, the call also carries that
// person's token in x-kvasir-person, so a subscription they signed in to
// applies to their streams alone and the call is filed under them (record 23).
// Kvasir holds the models an admin adds, so the catalog is read again while
// the host runs.

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

/** A call's options with the station's purpose, and the person's token where a person streams, among their headers, the headers the call already has kept. */
function withHeaders(options: unknown, purpose: string, person: string | null): never {
  const o = (options ?? {}) as { headers?: unknown };
  const had =
    o.headers instanceof Headers
      ? Object.fromEntries(o.headers.entries())
      : ((o.headers as Record<string, string> | undefined) ?? {});
  return {
    ...o,
    headers: { ...had, "x-kvasir-purpose": purpose, ...(person ? { "x-kvasir-person": person } : {}) },
  } as never;
}

export function kvasirProvider(opts: {
  station: string;
  purpose: string;
  catalog: Catalog;
  key: string;
  /** The token of the person a call streams for, read as the call is made; null where nobody does. */
  person?: () => string | null;
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
  const headers = (options: unknown) => withHeaders(options, opts.purpose, opts.person?.() ?? null);
  return createProvider<"pi-messages">({
    id,
    name: `Kvasir for ${opts.station}`,
    baseUrl: opts.catalog.baseUrl,
    headers: { "x-kvasir-purpose": opts.purpose },
    auth: {
      apiKey: { name: "the app's minted Kvasir key", resolve: async () => ({ auth: { apiKey: opts.key } }) },
    },
    models,
    api: {
      stream: (model, context, options) => stream(model as never, context, headers(options)),
      streamSimple: (model, context, options) => streamSimple(model as never, context, headers(options)),
    },
  });
}

/** What a model Kvasir does not list is taken to hold: a window a served model has, and no reasoning asked of it. */
const UNLISTED = { contextWindow: 128_000, maxTokens: 16_384 };

/**
 * The catalog the host serves from: Kvasir's, or where Kvasir lists no model, the model the host names, under its
 * own name. Kvasir never lists the models of a ChatGPT subscription, so where a subscription serves the purposes
 * the catalog is empty, and a station still names a model, which Kvasir sets aside for the policy's (record 23).
 */
export function servedCatalog(catalog: Catalog, named: string): Catalog {
  if (catalog.models.length > 0) return catalog;
  return {
    ...catalog,
    models: [
      {
        id: named,
        name: named,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        ...UNLISTED,
      },
    ],
  };
}

/** What the host reads of a catalog, so a change to it is noticed and nothing else is. */
export function catalogKey(catalog: Catalog): string {
  return JSON.stringify(
    catalog.models.map((m) => [m.id, m.contextWindow, m.maxTokens, m.reasoning, m.locality ?? null]),
  );
}

/**
 * Kvasir's catalog read again every `every` milliseconds (record 23): a model an admin adds to Kvasir or removes
 * reaches the stations without the host starting again. `apply` runs only when the models listed changed, and a
 * read that fails keeps what the host has and is said once until a read works again.
 */
export function watchCatalog(o: {
  read: () => Promise<Catalog>;
  apply: (catalog: Catalog) => void;
  had: Catalog;
  every: number;
  say?: (line: string) => void;
}): { tick: () => Promise<void>; stop: () => void } {
  let key = catalogKey(o.had);
  let failing = false;
  const tick = async () => {
    let next: Catalog;
    try {
      next = await o.read();
    } catch (e) {
      if (!failing)
        o.say?.(`Kvasir's catalog was not read again: ${e instanceof Error ? e.message : String(e)}`);
      failing = true;
      return;
    }
    failing = false;
    const now = catalogKey(next);
    if (now === key) return;
    key = now;
    o.apply(next);
  };
  const timer = setInterval(() => void tick(), o.every);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
