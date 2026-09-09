// SPDX-License-Identifier: AGPL-3.0-only
// Memory (Wave 4c section 9.9, D5): typed notes per subject, an index of
// five with a staleness caveat, deletion by subject, and institutional
// corrections that cannot carry a value.

import { describe, expect, it } from "vitest";
import { Notes, subjectOf } from "../src/host/notes.ts";

describe("the notes", () => {
  it("keeps typed notes per subject and indexes the newest five with a staleness caveat", () => {
    const n = new Notes(":memory:");
    const day = 24 * 60 * 60 * 1000;
    const now = 10 * day;
    for (let i = 0; i < 7; i++)
      n.add({
        subject: "anna",
        kind: "study",
        station: "ask-help",
        text: `document ${i}: count ${i}`,
        at: now - i * day,
      });
    n.add({ subject: "bo", kind: "person", station: "concierge", text: "prefers counts", at: now });
    expect(n.list("anna")).toHaveLength(7);
    const index = n.index("anna", now);
    expect(index).toHaveLength(5);
    expect(index[0]).toBe("study: document 0: count 0");
    expect(index[1]).toMatch(/may be stale/u);
    expect(() => n.add({ subject: "anna", kind: "wish" as never, station: "x", text: "x" })).toThrow(
      /one of/u,
    );
    expect(n.deleteSubject("anna")).toBe(7);
    expect(n.list("anna")).toEqual([]);
    expect(n.list("bo")).toHaveLength(1);
  });

  it("accepts a structural correction from a named person and refuses anything a value fits", () => {
    const n = new Notes(":memory:");
    const c = n.accept({
      station: "ask-help",
      axis: "membership",
      check: "declaration_full",
      accepted_by: "anna",
    });
    expect(c.id).toBe(1);
    expect(n.institutional("ask-help")).toHaveLength(1);
    expect(n.institutional("concierge")).toHaveLength(0);
    expect(() =>
      n.accept({ station: "ask-help", axis: "SYN0027", check: "no_sql", accepted_by: "anna" }),
    ).toThrow(/identifier/u);
    expect(() =>
      n.accept({ station: "ask-help", axis: "birth date 1984-01-10", check: "no_sql", accepted_by: "anna" }),
    ).toThrow(/identifier/u);
    expect(() =>
      n.accept({ station: "ask-help", axis: "membership", check: "no_sql", accepted_by: " " }),
    ).toThrow(/named person/u);
  });

  it("names the subject from a token's sub and no one from an opaque one", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "anna@lab" })).toString("base64url");
    expect(subjectOf(`x.${payload}.y`)).toBe("anna@lab");
    expect(subjectOf("a-desk-token-of-length-x")).toBe("anonymous");
    expect(subjectOf(null)).toBe("anonymous");
  });
});
