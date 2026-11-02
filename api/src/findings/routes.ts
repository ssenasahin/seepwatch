import { detectorLabel, type PrismaClient } from "@seepwatch/db";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { authOf } from "../auth/middleware.js";
import { HttpError, validate } from "../http.js";

const PAGE_SIZE = 50;
// The list shows where each secret turned up most recently; the full list is one
// click away on the finding itself.
const LOCATIONS_IN_LIST = 3;

const listQuery = z.object({
  // The firstSeenAt of the last finding on the previous page.
  before: z.iso.datetime().optional(),
  watchId: z.uuid().optional(),
});
const idParams = z.object({ id: z.uuid() });

const locationFields = {
  source: true,
  url: true,
  repository: true,
  path: true,
  commitSha: true,
  line: true,
  context: true,
  committedAt: true,
  seenAt: true,
} as const;

type Row = {
  id: string;
  detector: string;
  masked: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  watch: { id: string; kind: string; value: string; label: string | null } | null;
  locations: Record<keyof typeof locationFields, unknown>[];
  _count: { locations: number };
  incident: { id: string; status: string } | null;
};

// What a finding looks like to its owner. The fingerprint stays in the database: it
// identifies the secret to us and is of no use to anyone reading the page.
function present(f: Row) {
  return {
    id: f.id,
    detector: f.detector,
    detectorLabel: detectorLabel(f.detector),
    masked: f.masked,
    firstSeenAt: f.firstSeenAt,
    lastSeenAt: f.lastSeenAt,
    watch: f.watch,
    locationCount: f._count.locations,
    // The incident it opened, where it's dealt with.
    incident: f.incident,
    locations: f.locations,
  };
}

export function findingRouter(prisma: PrismaClient, authenticate: RequestHandler) {
  const router = Router();
  router.use(authenticate);

  const include = (locations: number | undefined) => ({
    watch: { select: { id: true, kind: true, value: true, label: true } },
    locations: { select: locationFields, orderBy: { seenAt: "desc" as const }, take: locations },
    _count: { select: { locations: true } },
    incident: { select: { id: true, status: true } },
  });

  // Newest first, a page at a time.
  router.get("/", async (req, res) => {
    const { userId } = authOf(req);
    const query = validate(listQuery, req.query);
    const findings = await prisma.finding.findMany({
      where: {
        ownerId: userId,
        ...(query.watchId && { watchId: query.watchId }),
        ...(query.before && { firstSeenAt: { lt: new Date(query.before) } }),
      },
      include: include(LOCATIONS_IN_LIST),
      orderBy: { firstSeenAt: "desc" },
      take: PAGE_SIZE + 1,
    });
    const page = findings.slice(0, PAGE_SIZE);
    res.json({
      findings: page.map(present),
      next: findings.length > PAGE_SIZE ? page.at(-1)!.firstSeenAt.toISOString() : null,
    });
  });

  router.get("/:id", async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const finding = await prisma.finding.findFirst({
      where: { id, ownerId: userId },
      include: include(undefined),
    });
    if (!finding) throw new HttpError(404, "Finding not found");
    res.json({ finding: present(finding) });
  });

  return router;
}
