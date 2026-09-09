// SPDX-License-Identifier: AGPL-3.0-only
// The redactor (Wave 4c §9.7): a context rule and a store rule. The seam
// refuses a document that projects identifiers, a handle whose provenance
// records classes above the station's content class, and any linkage path;
// every store write passes through one redactor; a provider error reaches
// the store as a classified code only. Under R9 a local backend may see what
// the person may see: the boundary here is the class and the egress.

export type ContentClass = "catalog" | "rows" | "identifiers";

const ORDER: ContentClass[] = ["catalog", "rows", "identifiers"];

export function above(found: ContentClass, declared: ContentClass): boolean {
  return ORDER.indexOf(found) > ORDER.indexOf(declared);
}

/** The classes a handle's disclosure sentence or suppression record names. */
export function classesOf(handle: {
  disclosure?: string;
  suppression?: { classes?: string[] };
}): ContentClass {
  const classes = handle.suppression?.classes ?? [];
  if (classes.includes("identifying") || /identif/iu.test(handle.disclosure ?? "")) return "identifiers";
  if (
    classes.includes("quasi_identifying") ||
    classes.includes("sensitive") ||
    /quasi|sensitive/iu.test(handle.disclosure ?? "")
  )
    return "rows";
  return "catalog";
}

/** The context rule: what a station may put in front of a model. */
export function admitDocument(
  document: unknown,
  declared: ContentClass,
): { ok: true } | { ok: false; why: string } {
  const out = (document as { out?: { identifiers?: unknown[] } } | null)?.out;
  if (Array.isArray(out?.identifiers) && out.identifiers.length > 0 && declared !== "identifiers") {
    return {
      ok: false,
      why: "the document projects identifiers, which this station's content class does not carry",
    };
  }
  return { ok: true };
}

export function admitHandle(
  handle: { disclosure?: string; suppression?: { classes?: string[] } },
  declared: ContentClass,
): { ok: true } | { ok: false; why: string } {
  const found = classesOf(handle);
  if (above(found, declared))
    return {
      ok: false,
      why: `the handle's provenance records ${found} fields, above this station's ${declared}`,
    };
  return { ok: true };
}

export function admitPath(path: string): { ok: true } | { ok: false; why: string } {
  if (/\/api\/linkage|\/api\/ask\/values\b|\/api\/custody/u.test(path))
    return { ok: false, why: "a linkage path is never dialled from a station" };
  return { ok: true };
}

/**
 * The store rule: the one function every write to the assistant's store
 * passes through. It removes what looks like an identifier value from free
 * text (a personal number, a DICOM UID, a long digit run) and replaces a
 * provider's error body with a classified code.
 */
export function redactText(text: string): string {
  return text
    .replace(/\b\d{8}-?\d{4}\b/gu, "[personal number]")
    .replace(/\b\d+(?:\.\d+){5,}\b/gu, "[uid]")
    .replace(/\b\d{9,}\b/gu, "[digits]");
}

export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map(redactValue) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactValue(v)]),
    ) as T;
  }
  return value;
}

/** A provider error, classified: the code reaches the store, the body never. */
export function classifyProviderError(
  status: number | null,
  message: string,
): "provider_refused" | "provider_error" | "token_unavailable" {
  if (status === 401 || status === 403) return "token_unavailable";
  if (status === 400 || status === 422 || /refused/iu.test(message)) return "provider_refused";
  return "provider_error";
}
