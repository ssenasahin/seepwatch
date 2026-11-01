import {
  verifyDomain,
  verifyGithubOrg,
  type FetchGithubFile,
  type PrismaClient,
  type ResolveTxt,
} from "@seepwatch/db";

// A domain can expire and be bought by someone else; an organization can be handed
// over. Each proven watch is checked again once a day, and after this many failures
// in a row it stops being scanned until its owner proves it again. One bad day of DNS
// shouldn't be enough.
export const REVERIFY_EVERY_MS = 24 * 60 * 60 * 1000;
export const MAX_VERIFY_FAILURES = 3;

export interface ReverifyDeps {
  prisma: PrismaClient;
  resolveTxt: ResolveTxt;
  fetchGithubFile: FetchGithubFile;
}

export async function reverifyWatches(
  { prisma, resolveTxt, fetchGithubFile }: ReverifyDeps,
  now = new Date(),
): Promise<{ checked: number; revoked: number }> {
  const watches = await prisma.watch.findMany({
    where: {
      kind: { in: ["DOMAIN", "GITHUB_ORG"] },
      verifiedAt: { not: null },
      verifyToken: { not: null },
      // An hour's slack, so the daily job doesn't skip a watch checked at 03:00:05.
      OR: [
        { lastVerifyAt: null },
        { lastVerifyAt: { lte: new Date(now.getTime() - REVERIFY_EVERY_MS + 3_600_000) } },
      ],
    },
  });

  let revoked = 0;
  for (const watch of watches) {
    const result =
      watch.kind === "DOMAIN"
        ? await verifyDomain(watch.value, watch.verifyToken!, resolveTxt)
        : await verifyGithubOrg(watch.value, watch.verifyToken!, fetchGithubFile);
    if (result.ok) {
      await prisma.watch.update({
        where: { id: watch.id },
        data: { lastVerifyAt: now, lastVerifyError: null, verifyFailures: 0 },
      });
      continue;
    }
    const failures = watch.verifyFailures + 1;
    const lost = failures >= MAX_VERIFY_FAILURES;
    if (lost) revoked++;
    await prisma.watch.update({
      where: { id: watch.id },
      data: {
        lastVerifyAt: now,
        verifyFailures: lost ? 0 : failures,
        lastVerifyError: lost
          ? `The proof was missing ${MAX_VERIFY_FAILURES} days in a row, so scanning stopped. ${result.reason}`
          : result.reason,
        ...(lost && { verifiedAt: null }),
      },
    });
  }
  return { checked: watches.length, revoked };
}
