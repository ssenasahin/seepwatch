import { detect, KEY_PATTERN_DETECTOR, type Hit, type KeyPattern } from "@seepwatch/db";

// A key counts only this close to a mention of the watched domain or address. Without
// the limit, every key in any file that mentions example.com once would be "yours".
export const NEAR_LINES = 10;

// The domain or address as a whole word: "example.com" but not "notexample.com".
// Subdomains count, since "api.example.com" has a dot before "example.com".
export function mentionPattern(value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9-])${escaped}(?![a-z0-9-])`, "i");
}

// The secrets in a text that belong to whoever watches `mention`: those written near
// a mention of it, and anywhere in it, the owner's own key patterns, which are
// specific enough that a match is theirs. A text that never mentions it has none.
export function hitsNearMention(
  lines: string[],
  mention: RegExp,
  keyPatterns: KeyPattern[],
): Hit[] {
  const mentions = lines.flatMap((line, i) => (mention.test(line) ? [i] : []));
  if (mentions.length === 0) return [];
  const near = (i: number) => mentions.some((m) => Math.abs(m - i) <= NEAR_LINES);
  return detect(lines, keyPatterns).filter(
    (h) => h.detector === KEY_PATTERN_DETECTOR || near(h.lineIndex),
  );
}
