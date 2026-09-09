// SPDX-License-Identifier: AGPL-3.0-only
// The verdict's result schema is JSON Schema in the manifest (contracts fix
// it); Flue's tools take Valibot. This turns the subset a result schema
// uses into Valibot, strictly: objects with required keys and no unknown
// ones, arrays with items, the primitive types, enums. Anything else is a
// manifest error at load, never a surprise at run time.

import * as v from "valibot";

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: (string | number)[];
  minItems?: number;
  minimum?: number;
  description?: string;
};

export function toValibot(s: JsonSchema, path = "result"): v.GenericSchema {
  if (s.enum) return v.picklist(s.enum.map(String)) as unknown as v.GenericSchema;
  const type = Array.isArray(s.type) ? s.type.filter((t) => t !== "null")[0] : s.type;
  const nullable = Array.isArray(s.type) && s.type.includes("null");
  let out: v.GenericSchema;
  switch (type) {
    case "object": {
      const entries: Record<string, v.GenericSchema> = {};
      const required = new Set(s.required ?? []);
      for (const [k, sub] of Object.entries(s.properties ?? {})) {
        const inner = toValibot(sub, `${path}.${k}`);
        entries[k] = required.has(k) ? inner : (v.optional(inner) as unknown as v.GenericSchema);
      }
      // an object that names no properties is an open map (the declaration block as describe answers it); one that names some is strict
      out = (Object.keys(entries).length === 0 && s.additionalProperties !== false
        ? v.record(v.string(), v.unknown())
        : v.strictObject(entries)) as unknown as v.GenericSchema;
      break;
    }
    case "array": {
      const item = s.items ? toValibot(s.items, `${path}[]`) : (v.unknown() as unknown as v.GenericSchema);
      out = (s.minItems
        ? v.pipe(v.array(item), v.minLength(s.minItems))
        : v.array(item)) as unknown as v.GenericSchema;
      break;
    }
    case "integer":
      out = v.pipe(v.number(), v.integer()) as unknown as v.GenericSchema;
      break;
    case "number":
      out = v.number() as unknown as v.GenericSchema;
      break;
    case "string":
      out = v.string() as unknown as v.GenericSchema;
      break;
    case "boolean":
      out = v.boolean() as unknown as v.GenericSchema;
      break;
    default:
      throw new Error(
        `${path}: the result schema uses ${String(type)}, which the station framework does not turn into a tool schema`,
      );
  }
  return nullable ? (v.nullable(out) as unknown as v.GenericSchema) : out;
}
