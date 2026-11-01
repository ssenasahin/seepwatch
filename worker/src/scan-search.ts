import { detect, KEY_PATTERN_DETECTOR, type KeyPattern } from "@seepwatch/db";
import type { GithubApi } from "./github.js";
import { recordHits, type RecordDeps } from "./record.js";
import { describeError, type ScanResult } from "./scan-org.js";

// Code search allows 10 requests a minute, and each result is another request for the
// file. A scan reads this many files; the next one, hours later, reads them again and
// whatever GitHub has indexed since.
export const SEARCH_RESULTS = 30;
// A key counts only this close to a mention of the watched domain or address. Without
// the limit, every key in any file that mentions example.com once would be "yours".
export const NEAR_LINES = 10;

export interface SearchScanDeps extends RecordDeps {
  github: GithubApi;
}

export interface SearchWatch {
  id: string;
  ownerId: string;
  kind: "DOMAIN" | "EMAIL";
  value: string;
}

// The domain or address as a whole word: "example.com" but not "notexample.com".
// Subdomains count, since "api.example.com" has a dot before "example.com".
function mentionPattern(value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9-])${escaped}(?![a-z0-9-])`, "i");
}

// Finds public files that mention the domain or address and records the secrets
// written near those mentions. The owner's own key patterns count anywhere in such a
// file: they're specific enough that a match is theirs.
export async function scanSearch(
  deps: SearchScanDeps,
  watch: SearchWatch,
  keyPatterns: KeyPattern[],
  now = new Date(),
): Promise<ScanResult> {
  const newFindings: string[] = [];
  const mention = mentionPattern(watch.value);
  try {
    const results = await deps.github.searchCode(`"${watch.value}"`, SEARCH_RESULTS);
    for (const result of results) {
      const text = await deps.github.fileText(result.repository, result.path, result.ref);
      if (text === null) continue;
      const lines = text.split(/\r?\n/);
      const mentions = lines.flatMap((line, i) => (mention.test(line) ? [i] : []));
      // GitHub matched words the file doesn't hold together, like "example" and "com".
      if (mentions.length === 0) continue;
      const near = (i: number) => mentions.some((m) => Math.abs(m - i) <= NEAR_LINES);
      const hits = detect(lines, keyPatterns).filter(
        (h) => h.detector === KEY_PATTERN_DETECTOR || near(h.lineIndex),
      );
      if (hits.length === 0) continue;
      newFindings.push(
        ...(await recordHits(
          deps,
          {
            ownerId: watch.ownerId,
            watchId: watch.id,
            source: "GITHUB_CODE",
            repository: result.repository,
            path: result.path,
            ref: result.ref,
            committedAt: null,
            lines,
          },
          hits,
        )),
      );
    }
    return { newFindings, cursor: now, error: null };
  } catch (err) {
    return { newFindings, cursor: now, error: describeError(err) };
  }
}
