// What a watch looks for, as the API stores it and the scanners read it. Shared so the
// two can never disagree about what a key pattern matches.

export type KeyCharset = "ALNUM" | "HEX" | "BASE64URL";

export interface KeyPattern {
  prefix: string;
  charset: KeyCharset;
  minLength: number;
  maxLength: number;
}

// Limits on a key pattern, so every one compiles to a small, linear-time expression.
export const KEY_PREFIX_MIN = 3;
export const KEY_PREFIX_MAX = 32;
export const KEY_LENGTH_MIN = 8;
export const KEY_LENGTH_MAX = 128;
// A prefix is what services put before a key: letters, digits, "_" and "-".
export const KEY_PREFIX = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const CHARSETS: Record<KeyCharset, string> = {
  ALNUM: "A-Za-z0-9",
  HEX: "0-9a-fA-F",
  BASE64URL: "A-Za-z0-9_-",
};

// The regular expression source for a key pattern. Built here from a fixed shape,
// never from text a user typed, so it has no nested repetition to backtrack on. The
// lookarounds keep "acme_live_" from matching inside "notacme_live_…", and a key
// from matching the first part of a longer token.
export function keyPatternSource({ prefix, charset, minLength, maxLength }: KeyPattern): string {
  const set = CHARSETS[charset];
  return `(?<![A-Za-z0-9_-])${escapeRegExp(prefix)}[${set}]{${minLength},${maxLength}}(?![${set}])`;
}

export function keyPatternRegExp(pattern: KeyPattern): RegExp {
  return new RegExp(keyPatternSource(pattern), "g");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

// A key pattern's problems, keyed by field like a form expects, or null if it's fine.
export function keyPatternProblems(p: KeyPattern): Record<string, string> | null {
  const problems: Record<string, string> = {};
  if (p.prefix.length < KEY_PREFIX_MIN || p.prefix.length > KEY_PREFIX_MAX) {
    problems.prefix = `Between ${KEY_PREFIX_MIN} and ${KEY_PREFIX_MAX} characters`;
  } else if (!KEY_PREFIX.test(p.prefix)) {
    problems.prefix = "Letters, digits, _ and - only, starting with a letter or digit";
  }
  if (p.minLength > p.maxLength) {
    problems.maxLength = "At least the shortest length";
  }
  return Object.keys(problems).length ? problems : null;
}
