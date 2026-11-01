import type { KeyPattern } from "@seepwatch/db";
import type { GithubApi } from "./github.js";
import { hitsNearMention, mentionPattern } from "./match.js";
import { recordHits, type RecordDeps } from "./record.js";
import { describeError, type ScanResult } from "./scan-org.js";

// Code search allows 10 requests a minute, and each result is another request for the
// file. A scan reads this many files; the next one, hours later, reads them again and
// whatever GitHub has indexed since.
export const SEARCH_RESULTS = 30;

export interface SearchScanDeps extends RecordDeps {
  github: GithubApi;
}

export interface SearchWatch {
  id: string;
  ownerId: string;
  kind: "DOMAIN" | "EMAIL";
  value: string;
}

// Finds public files that mention the domain or address and records the secrets
// written near those mentions.
export async function scanSearch(
  deps: SearchScanDeps,
  watch: SearchWatch,
  keyPatterns: KeyPattern[],
  now = new Date(),
): Promise<ScanResult> {
  const newFindings: string[] = [];
  const seenAgain: string[] = [];
  const mention = mentionPattern(watch.value);
  try {
    const results = await deps.github.searchCode(`"${watch.value}"`, SEARCH_RESULTS);
    for (const result of results) {
      const text = await deps.github.fileText(result.repository, result.path, result.ref);
      if (text === null) continue;
      const lines = text.split(/\r?\n/);
      // Empty too when GitHub matched words the file doesn't hold together, like
      // "example" and "com".
      const hits = hitsNearMention(lines, mention, keyPatterns);
      if (hits.length === 0) continue;
      const recorded = await recordHits(
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
      );
      newFindings.push(...recorded.created);
      seenAgain.push(...recorded.seenAgain);
    }
    return { newFindings, seenAgain, cursor: now, error: null };
  } catch (err) {
    return { newFindings, seenAgain, cursor: now, error: describeError(err) };
  }
}
