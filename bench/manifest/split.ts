// SPDX-License-Identifier: AGPL-3.0-only
// The held-out split, fixed before the first loop: a shape is held out by
// the hash of its id, so the split is the same on every machine and no
// choice of ours moves a task across it. Both numbers are always reported.

import { createHash } from "node:crypto";

export const HELD_OUT_SHARE = 3; // one in three

export function heldOut(id: string): boolean {
  const h = createHash("sha256").update(id).digest();
  return h[0] % HELD_OUT_SHARE === 0;
}

export function split<T extends { id: string }>(items: T[]): { loop: T[]; held_out: T[] } {
  return { loop: items.filter((i) => !heldOut(i.id)), held_out: items.filter((i) => heldOut(i.id)) };
}

/** Two numbers on one screen. */
export function report(
  passed: (id: string) => boolean,
  items: { id: string }[],
): { loop: { passed: number; of: number }; held_out: { passed: number; of: number } } {
  const s = split(items);
  const count = (xs: { id: string }[]) => ({ passed: xs.filter((x) => passed(x.id)).length, of: xs.length });
  return { loop: count(s.loop), held_out: count(s.held_out) };
}
