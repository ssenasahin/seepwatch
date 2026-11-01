import { Prisma, type PrismaClient } from "@seepwatch/db";

// Opens an incident for each new finding, due for its first alert now. The alert
// itself goes out on the alerts queue's next tick, within half a minute.
export async function openIncidents(
  prisma: PrismaClient,
  findingIds: string[],
  now = new Date(),
): Promise<number> {
  let opened = 0;
  for (const findingId of findingIds) {
    const finding = await prisma.finding.findUnique({
      where: { id: findingId },
      select: {
        ownerId: true,
        locations: { select: { repository: true, path: true }, take: 1 },
      },
    });
    if (!finding) continue;
    const where = finding.locations[0];
    try {
      await prisma.incident.create({
        data: {
          ownerId: finding.ownerId,
          findingId,
          openedAt: now,
          nextAlertAt: now,
          events: {
            create: {
              type: "OPENED",
              at: now,
              detail: where ? `Found in ${where.repository}/${where.path}` : null,
            },
          },
        },
      });
      opened++;
    } catch (err) {
      // A retried scan job got here first. One finding, one incident.
      const duplicate = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!duplicate) throw err;
    }
  }
  return opened;
}

// A known secret turned up somewhere else. Its incident's timeline notes it; no one
// is alerted for it, because the incident's own rounds already keep everyone on it,
// and a closed one stays closed: a revoked key is harmless wherever it's copied.
export async function noteSeenAgain(
  prisma: PrismaClient,
  findingIds: string[],
  now = new Date(),
): Promise<void> {
  for (const findingId of new Set(findingIds)) {
    const incident = await prisma.incident.findUnique({
      where: { findingId },
      select: { id: true, finding: { select: { _count: { select: { locations: true } } } } },
    });
    if (!incident) continue;
    await prisma.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: "SEEN_AGAIN",
        at: now,
        detail: `Seen in a new place; ${incident.finding._count.locations} places in all`,
      },
    });
  }
}
