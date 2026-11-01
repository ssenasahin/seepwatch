import { detect, type KeyPattern } from "@seepwatch/db";
import { RateLimitError, type Commit, type GithubApi } from "./github.js";
import { newFileLines } from "./patch.js";
import { recordHits, type RecordDeps } from "./record.js";

// A new organization watch looks this far back on its first scan.
export const FIRST_SCAN_DAYS = 30;
// Each commit costs a request; this many per scan keeps one busy organization from
// using the whole hour's allowance. The rest wait for the next scan.
export const COMMITS_PER_SCAN = 200;
// GitHub lists commits newest first, so a repository with more new commits than this
// loses its oldest ones. That takes a burst far beyond one scan interval; the scan
// says so rather than pretending it read everything.
export const COMMITS_PER_REPO = 300;

export interface OrgScanDeps extends RecordDeps {
  github: GithubApi;
}

export interface OrgWatch {
  id: string;
  ownerId: string;
  value: string;
  scanCursor: Date | null;
}

export interface ScanResult {
  newFindings: string[];
  // Known findings seen somewhere new.
  seenAgain: string[];
  // Where the next scan starts.
  cursor: Date;
  // Why it stopped short, if it did. What it read before stopping is kept.
  error: string | null;
}

// Reads the lines each new commit added to the organization's public repositories
// and records the secrets among them. Forks are skipped (their history is someone
// else's) and so are archived repositories, which can't be pushed to.
//
// Commits are found by their commit date. One made long before it was pushed, say on
// a branch rebased and pushed weeks later, can land behind the cursor and be missed.
export async function scanOrg(
  deps: OrgScanDeps,
  watch: OrgWatch,
  keyPatterns: KeyPattern[],
  now = new Date(),
): Promise<ScanResult> {
  const since = watch.scanCursor ?? new Date(now.getTime() - FIRST_SCAN_DAYS * 86_400_000);
  const newFindings: string[] = [];
  const seenAgain: string[] = [];
  let cursor = since;

  try {
    const repos = (await deps.github.orgRepos(watch.value)).filter(
      (r) => !r.fork && !r.archived && (r.pushedAt === null || r.pushedAt > since),
    );
    const queue: (Commit & { repo: string })[] = [];
    const overflowed: string[] = [];
    for (const repo of repos) {
      const commits = await deps.github.commitsSince(repo.fullName, since, COMMITS_PER_REPO);
      if (commits.length >= COMMITS_PER_REPO) overflowed.push(repo.fullName);
      queue.push(...commits.map((c) => ({ ...c, repo: repo.fullName })));
    }
    // Oldest first, so stopping early leaves a cursor nothing older hides behind.
    queue.sort((a, b) => a.committedAt.getTime() - b.committedAt.getTime());

    const batch = queue.slice(0, COMMITS_PER_SCAN);
    for (const commit of batch) {
      const files = await deps.github.commitFiles(commit.repo, commit.sha);
      for (const file of files) {
        if (!file.patch) continue;
        const lines = newFileLines(file.patch);
        const texts = lines.map((l) => l.text);
        const hits = detect(texts, keyPatterns).filter((h) => lines[h.lineIndex]!.added);
        if (hits.length === 0) continue;
        const recorded = await recordHits(
          deps,
          {
            ownerId: watch.ownerId,
            watchId: watch.id,
            source: "GITHUB_COMMIT",
            repository: commit.repo,
            path: file.path,
            ref: commit.sha,
            committedAt: commit.committedAt,
            lines: texts,
            numbers: lines.map((l) => l.number),
          },
          hits,
        );
        newFindings.push(...recorded.created);
        seenAgain.push(...recorded.seenAgain);
      }
      // `since` is inclusive, so the next scan reads this moment's commits again;
      // their locations are already recorded and change nothing.
      cursor = commit.committedAt;
    }
    // Everything read: the next scan starts from when this one did.
    if (batch.length === queue.length) cursor = now;
    const error =
      overflowed.length > 0
        ? `${overflowed.join(", ")} had more than ${COMMITS_PER_REPO} new commits; the oldest weren't read.`
        : null;
    return { newFindings, seenAgain, cursor, error };
  } catch (err) {
    return { newFindings, seenAgain, cursor, error: describeError(err) };
  }
}

export function describeError(err: unknown): string {
  if (err instanceof RateLimitError) {
    return `GitHub's rate limit ran out. Scanning continues after ${err.resetAt.toISOString().slice(11, 16)} UTC.`;
  }
  return err instanceof Error ? err.message : String(err);
}
