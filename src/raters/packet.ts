// SPDX-License-Identifier: AGPL-3.0-only
// The packet a rater reads (site participation, the model-first path): certificate 2's shape, built from the
// campaign's header door and the item's why door, as the 7b audit runner builds it (nils-design
// studies/2026-10-14-blind-audit/tools/audit_raters_7b.py, packet_from_doors and check_packet). A packet that
// holds an identifier key, or a personnummer-shaped text outside a number, is refused before anything is sent.

export class Refused extends Error {}

const IDENTIFIER_KEYS = new Set([
  "patient_name",
  "patients_name",
  "patient_id",
  "patient_birth_date",
  "patients_birth_date",
  "birth_date",
  "patient_address",
  "patients_address",
  "other_patient_ids",
  "other_patient_names",
  "personnummer",
  "patient_birth_name",
  "patient_mother_birth_name",
  "referring_physician_name",
  "accession_number",
  "institution_address",
  "patient_telephone_numbers",
]);
const PNR = /(?<!\d)(19|20)?\d{6}[-+]?\d{4}(?!\d)/u;
const NUMBER = /^[-+]?\d+(\.\d+)?([\\/][-+]?\d+(\.\d+)?)*$/u;

// the packet groups of certificate 2's packets (the shape prompt v3.4 describes), filled from the header door
const TEXTS = [
  "series_description",
  "protocol_name",
  "study_description",
  "body_part_examined",
  "contrast_bolus_agent",
];
const SEQUENCE = [
  "image_type",
  "scanning_sequence",
  "sequence_variant",
  "mr_acquisition_type",
  "sop_class_uid",
  "sequence_name",
  "scan_options",
  "photometric_interpretation",
  "samples_per_pixel",
  "angio_flag",
  "acquisition_contrast",
];
const PHYSICS = [
  "repetition_time",
  "echo_time",
  "inversion_time",
  "flip_angle",
  "echo_train_length",
  "echo_numbers",
  "number_of_averages",
  "percent_sampling",
  "percent_phase_fov",
  "phase_encoding_direction",
  "receive_coil_name",
  "transmit_coil_name",
  "imaged_nucleus",
  "number_of_temporal_positions",
  "temporal_positions_in_stack",
  "magnetic_field_strength",
  "field_strength_normalized",
  "diffusion_b_value",
  "dwi_b_values",
  "dwi_directions",
  "diffusion_directionality",
  "diffusion_directionality_all",
  "pixel_bandwidth",
  "manufacturer",
  "manufacturer_model_name",
  "software_version",
  "acquisition_matrix",
  "temporal_resolution",
];
const GEOMETRY = [
  "orientation",
  "n_instances",
  "n_slices",
  "number_of_frames",
  "slice_thickness",
  "spacing_between_slices",
  "rows",
  "columns",
  "pixel_spacing",
  "patient_position",
  "series_number",
  "stacks_in_series",
  "stack_index",
  "fov_x_mm",
  "fov_y_mm",
  "slice_centre_z_mm",
  "slice_span_mm",
  "split_reason",
];

const LEVELS: Record<string, number> = { stack: 0, series_mr: 1, series: 2, instance: 3, study: 4 };

export interface Packet {
  stack: unknown;
  header: Record<string, unknown>;
  session: unknown[];
}

function empty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Refuse a packet that holds an identifier key, or a personnummer-shaped text outside numbers. */
export function checkPacket(packet: unknown): void {
  const walk = (v: unknown, at: string): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        walk(x, `${at}${i}.`);
      });
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (IDENTIFIER_KEYS.has(k.toLowerCase()))
          throw new Refused(`the packet holds an identifier key at ${at}${k}`);
        walk(x, `${at}${k}.`);
      }
    } else if (typeof v === "string" && !NUMBER.test(v.trim()) && PNR.test(v)) {
      throw new Refused(`the packet holds a personnummer-shaped text at ${at.replace(/\.$/u, "")}`);
    }
  };
  walk(packet, "");
}

interface HeaderDoc {
  fields?: { column?: string; level?: string; value?: unknown }[];
  fingerprint?: Record<string, unknown>;
  session?: unknown;
  private?: unknown;
  private_withheld?: unknown;
}
interface WhyDoc {
  texts?: Record<string, unknown>;
  physics?: Record<string, unknown>;
  header?: Record<string, unknown>;
}

/**
 * Certificate 2's packet shape ({stack, header: {texts, sequence, physics, geometry, private}, session}) from the
 * campaign's header door (`fields`: column, level and value; where a column comes at several levels the stack's
 * value wins, then the MR series', the series', the instance's), with what the item's why door adds (`texts`,
 * `physics`, `header`) where the header has no value. On a campaign of purpose audit the header door adds
 * `fingerprint` (values that win over the columns of the same name) and `session` (the study's series in
 * acquisition order); where they are absent the packet is built from the columns alone and `session` is empty.
 * Returns the packet and the number of door columns it did not place.
 */
export function packetFromDoors(
  stack: unknown,
  header: HeaderDoc,
  why: WhyDoc | null = null,
): { packet: Packet; unplaced: number } {
  const by = new Map<string, unknown>();
  const rank = new Map<string, number>();
  for (const f of header.fields ?? []) {
    const col = f.column;
    if (!col || empty(f.value)) continue;
    const r = LEVELS[f.level ?? ""] ?? 9;
    if (!by.has(col) || r < (rank.get(col) ?? 9)) {
      by.set(col, f.value);
      rank.set(col, r);
    }
  }
  for (const group of ["texts", "physics", "header"] as const)
    for (const [col, val] of Object.entries(why?.[group] ?? {}))
      if (!by.has(col) && !empty(val)) by.set(col, val);
  if (header.fingerprint && typeof header.fingerprint === "object")
    for (const [col, val] of Object.entries(header.fingerprint)) if (!empty(val)) by.set(col, val);
  const placed = new Set<string>();
  const pick = (names: string[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const n of names)
      if (by.has(n)) {
        out[n] = by.get(n);
        placed.add(n);
      }
    return out;
  };
  const texts = pick(TEXTS);
  for (const [alt, name] of [
    ["text_series_description", "series_description"],
    ["text_protocol_name", "protocol_name"],
  ] as const)
    if (by.has(alt)) {
      placed.add(alt);
      if (!(name in texts)) texts[name] = by.get(alt);
    }
  const h: Record<string, unknown> = {
    texts,
    sequence: pick(SEQUENCE),
    physics: pick(PHYSICS),
    geometry: pick(GEOMETRY),
  };
  if (!empty(header.private)) h.private = header.private;
  if (!empty(header.private_withheld)) h.private_withheld = header.private_withheld;
  const packet: Packet = { stack, header: h, session: Array.isArray(header.session) ? header.session : [] };
  checkPacket(packet);
  return { packet, unplaced: [...by.keys()].filter((k) => !placed.has(k)).length };
}
