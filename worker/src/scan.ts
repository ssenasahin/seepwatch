import type { KeyPattern, Prisma, PrismaClient, ScanJob } from "@seepwatch/db";
import type { GithubApi } from "./github.js";
import { noteSeenAgain, openIncidents } from "./incidents.js";
import type { RecordDeps } from "./record.js";
import { scanOrg, type ScanResult } from "./scan-org.js";
import { scanSearch } from "./scan-search.js";

// How often each kind of watch is scanned. Organizations are read commit by commit, so
// a short interval means short scans. Code search is slow to index and tightly
// rate-limited, so searching more often would find nothing new.
export const ORG_EVERY_MS = 15 * 60 * 1000;
export const SEARCH_EVERY_MS = 6 * 60 * 60 * 1000;

export interface ScanDeps extends RecordDeps {
  github: GithubApi;
}

// Scans only what its owner proved is theirs, and only while it's switched on. An
// address counts as proven when its domain is.
const scannable = {
  enabled: true,
  owner: { suspendedAt: null },
  OR: [
    { kind: "GITHUB_ORG", verifiedAt: { not: null } },
    { kind: "DOMAIN", verifiedAt: { not: null } },
    { kind: "EMAIL", domainWatch: { verifiedAt: { not: null } } },
  ],
} satisfies Prisma.WatchWhereInput;

async function ownerKeyPatterns(prisma: PrismaClient, ownerId: string): Promise<KeyPattern[]> {
  const rows = await prisma.watch.findMany({
    where: { ownerId, kind: "KEY_PATTERN", enabled: true },
    select: { value: true, keyCharset: true, keyMinLength: true, keyMaxLength: true },
  });
  return rows.flatMap((r) =>
    r.keyCharset && r.keyMinLength !== null && r.keyMaxLength !== null
      ? [
          {
            prefix: r.value,
            charset: r.keyCharset,
            minLength: r.keyMinLength,
            maxLength: r.keyMaxLength,
          },
        ]
      : [],
  );
}

// One scan of one watch. A watch that stopped qualifying since it was queued (paused,
// deleted, verification lost) is skipped quietly.
export async function runScan(deps: ScanDeps, { watchId }: ScanJob): Promise<ScanResult | null> {
  const { prisma } = deps;
  const watch = await prisma.watch.findFirst({ where: { id: watchId, ...scannable } });
  if (!watch || watch.kind === "KEY_PATTERN") return null;

  const keyPatterns = await ownerKeyPatterns(prisma, watch.ownerId);
  const result =
    watch.kind === "GITHUB_ORG"
      ? await scanOrg(deps, watch, keyPatterns)
      : await scanSearch(deps, { ...watch, kind: watch.kind }, keyPatterns);

  await prisma.watch.update({
    where: { id: watch.id },
    data: {
      lastScanAt: new Date(),
      lastScanError: result.error,
      ...(watch.kind === "GITHUB_ORG" && { scanCursor: result.cursor }),
    },
  });
  await openIncidents(prisma, result.newFindings);
  await noteSeenAgain(prisma, result.seenAgain);
  return result;
}

// The watches whose next scan is due: never scanned, or last scanned an interval ago.
export async function dueWatches(prisma: PrismaClient, now = new Date()): Promise<string[]> {
  const due = (kinds: ("GITHUB_ORG" | "DOMAIN" | "EMAIL")[], everyMs: number) =>
    prisma.watch.findMany({
      where: {
        AND: [
          scannable,
          { kind: { in: kinds } },
          {
            OR: [
              { lastScanAt: null },
              // A little slack, so a scan that ran a few seconds late isn't skipped.
              { lastScanAt: { lte: new Date(now.getTime() - everyMs + 60_000) } },
            ],
          },
        ],
      },
      select: { id: true },
      orderBy: { lastScanAt: { sort: "asc", nulls: "first" } },
    });
  const [orgs, searches] = await Promise.all([
    due(["GITHUB_ORG"], ORG_EVERY_MS),
    due(["DOMAIN", "EMAIL"], SEARCH_EVERY_MS),
  ]);
  return [...orgs, ...searches].map((w) => w.id);
}

// The job id is the watch's, so a watch waiting in the queue isn't queued twice.
export const scanJobId = (watchId: string) => `scan-${watchId}`;
