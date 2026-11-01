import { describe, expect, it } from "vitest";
import { keyPatternProblems, keyPatternRegExp, type KeyPattern } from "./watches.js";

const acme: KeyPattern = { prefix: "acme_live_", charset: "ALNUM", minLength: 24, maxLength: 32 };
const matches = (pattern: KeyPattern, text: string) =>
  [...text.matchAll(keyPatternRegExp(pattern))].map((m) => m[0]);

describe("key patterns", () => {
  it("finds a key with the prefix and the right length", () => {
    const key = `acme_live_${"a1B2".repeat(7)}`;
    expect(matches(acme, `const KEY = "${key}";`)).toEqual([key]);
  });

  it("ignores keys that are too short or too long", () => {
    expect(matches(acme, `acme_live_${"a".repeat(23)}`)).toEqual([]);
    expect(matches(acme, `acme_live_${"a".repeat(33)}`)).toEqual([]);
  });

  it("doesn't match inside a longer word", () => {
    expect(matches(acme, `notacme_live_${"a".repeat(24)}`)).toEqual([]);
  });

  it("keeps to its character set", () => {
    const hex: KeyPattern = { prefix: "tok-", charset: "HEX", minLength: 8, maxLength: 8 };
    expect(matches(hex, "tok-deadBEEF tok-deadbeeg")).toEqual(["tok-deadBEEF"]);
  });

  it("treats the prefix as text, not as an expression", () => {
    const dashed: KeyPattern = { prefix: "a-b", charset: "ALNUM", minLength: 8, maxLength: 8 };
    expect(matches(dashed, "a-b12345678 axb12345678")).toEqual(["a-b12345678"]);
  });

  it("refuses prefixes it can't match safely", () => {
    expect(keyPatternProblems({ ...acme, prefix: "ab" })?.prefix).toBeDefined();
    expect(keyPatternProblems({ ...acme, prefix: "acme.live" })?.prefix).toBeDefined();
    expect(keyPatternProblems({ ...acme, prefix: "_acme" })?.prefix).toBeDefined();
    expect(keyPatternProblems({ ...acme, minLength: 40 })?.maxLength).toBeDefined();
    expect(keyPatternProblems(acme)).toBeNull();
  });
});
