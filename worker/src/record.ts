import {
  detect,
  fingerprint,
  mask,
  Prisma,
  redactedContext,
  type FindingSource,
  type Hit,
  type KeyPattern,
  type PrismaClient,
} from "@seepwatch/db";

export interface RecordDeps {
  prisma: PrismaClient;
  // From fingerprintKey(ENCRYPTION_KEY).
  fingerprintKey: Buffer;
}

// One file, as one scan saw it: where it is, and its lines.
export interface Sighting {
  ownerId: string;
  watchId: string;
  source: FindingSource;
  repository: string;
  path: string;
  // The commit the lines are from; links point at it, not at a branch that moves.
  ref: string;
  committedAt: Date | null;
  lines: string[];
  // Each line's number in the file, when the lines aren't the whole file (a patch).
  numbers?: number[];
  // A link to a line, for sources that aren't files in a repository (gists, pastes).
  link?: (line: number) => string;
  // The owner's key patterns. The context stored with a hit masks every secret on
  // its lines, including ones the scan didn't count as this watch's.
  keyPatterns: KeyPattern[];
}

const isDuplicate = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

export interface Recorded {
  // Findings seen for the first time: each opens an incident.
  created: string[];
  // Known findings that turned up somewhere new: their incidents' timelines say so.
  seenAgain: string[];
}

// Stores what the hits found. A secret already known to this owner gets a new
// location, not a new finding.
export async function recordHits(
  { prisma, fingerprintKey }: RecordDeps,
  sighting: Sighting,
  hits: Hit[],
): Promise<Recorded> {
  const created: string[] = [];
  const seenAgain: string[] = [];
  const seen = new Set<string>();
  // Everything that looks like a secret, not only the hits passed in: a key the scan
  // filtered out (too far from a mention, on an unchanged line of a patch) can still
  // sit on the lines shown around one it kept.
  let everything: Hit[] | null = null;
  for (const hit of hits) {
    const fp = fingerprint(fingerprintKey, hit.secret);
    // The same key twice in one file is one location: the first.
    if (seen.has(fp)) continue;
    seen.add(fp);

    const now = new Date();
    let findingId: string;
    try {
      const finding = await prisma.finding.create({
        data: {
          ownerId: sighting.ownerId,
          watchId: sighting.watchId,
          detector: hit.detector,
          fingerprint: fp,
          masked: mask(hit.secret),
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });
      findingId = finding.id;
      created.push(finding.id);
    } catch (err) {
      // Known already, or another scan recorded it a moment ago.
      if (!isDuplicate(err)) throw err;
      const finding = await prisma.finding.update({
        where: { ownerId_fingerprint: { ownerId: sighting.ownerId, fingerprint: fp } },
        data: { lastSeenAt: now },
      });
      findingId = finding.id;
    }

    const line = sighting.numbers?.[hit.lineIndex] ?? hit.lineIndex + 1;
    const { count } = await prisma.findingLocation.createMany({
      data: {
        findingId,
        source: sighting.source,
        url:
          sighting.link?.(line) ??
          `https://github.com/${sighting.repository}/blob/${sighting.ref}/${encodePath(sighting.path)}#L${line}`,
        repository: sighting.repository,
        path: sighting.path,
        commitSha: /^[0-9a-f]{40}$/.test(sighting.ref) ? sighting.ref : null,
        line,
        context: redactedContext(
          sighting.lines,
          (everything ??= [...hits, ...detect(sighting.lines, sighting.keyPatterns)]),
          hit.lineIndex,
        ),
        committedAt: sighting.committedAt,
      },
      // Seen here before: the location is already on record.
      skipDuplicates: true,
    });
    if (count > 0 && !created.includes(findingId)) seenAgain.push(findingId);
  }
  return { created, seenAgain };
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
