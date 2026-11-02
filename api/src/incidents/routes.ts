import {
  detectorLabel,
  isClosed,
  needsReason,
  verifyRespond,
  type FindingSource,
  type IncidentStatus,
  type PrismaClient,
} from "@seepwatch/db";
import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authOf } from "../auth/middleware.js";
import { HttpError, validate } from "../http.js";
import { applyAction } from "./actions.js";

const PAGE_SIZE = 50;

const listQuery = z.object({
  status: z.enum(["active", "closed", "all"]).default("all"),
  // The openedAt of the last incident on the previous page.
  before: z.iso.datetime().optional(),
});
const idParams = z.object({ id: z.uuid() });
const actionBody = z
  .object({
    action: z.enum(["ACKNOWLEDGE", "REVOKE", "FALSE_POSITIVE", "ACCEPT_RISK"]),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((b) => !needsReason(b.action) || (b.reason ?? "").length > 0, {
    message: "Say why, so whoever reads this later knows",
    path: ["reason"],
  });
// From an alert, only the two things a link promises.
const signed = z.object({
  by: z.string().regex(/^[uc]:[0-9a-f-]{36}$/),
  exp: z.coerce.number().int().positive(),
  sig: z.string().min(20).max(100),
});
const respondBody = signed.extend({ action: z.enum(["ACKNOWLEDGE", "REVOKE"]) });

const ACTIVE: IncidentStatus[] = ["OPEN", "ACKNOWLEDGED"];

const incidentInclude = {
  finding: {
    select: {
      id: true,
      detector: true,
      masked: true,
      firstSeenAt: true,
      lastSeenAt: true,
      watch: { select: { id: true, kind: true, value: true, label: true } },
      locations: {
        orderBy: { seenAt: "desc" as const },
        take: 1,
        select: { source: true, repository: true, path: true, line: true, url: true },
      },
      _count: { select: { locations: true } },
    },
  },
};

type Loaded = {
  id: string;
  status: IncidentStatus;
  openedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  closedAt: Date | null;
  closedBy: string | null;
  closeReason: string | null;
  round: number;
  nextAlertAt: Date | null;
  finding: {
    id: string;
    detector: string;
    masked: string;
    firstSeenAt: Date;
    lastSeenAt: Date;
    watch: { id: string; kind: string; value: string; label: string | null } | null;
    locations: {
      source: FindingSource;
      repository: string;
      path: string;
      line: number | null;
      url: string;
    }[];
    _count: { locations: number };
  };
};

function present(i: Loaded) {
  const { locations, _count, ...finding } = i.finding;
  return {
    id: i.id,
    status: i.status,
    openedAt: i.openedAt,
    acknowledgedAt: i.acknowledgedAt,
    acknowledgedBy: i.acknowledgedBy,
    closedAt: i.closedAt,
    closedBy: i.closedBy,
    closeReason: i.closeReason,
    alertsSent: i.round,
    // Null once closed. The last round, telling everyone how it ended, isn't shown.
    nextAlertAt: isClosed(i.status) ? null : i.nextAlertAt,
    finding: {
      ...finding,
      detectorLabel: detectorLabel(finding.detector),
      lastLocation: locations[0] ?? null,
      locationCount: _count.locations,
    },
  };
}

export function incidentRouter(prisma: PrismaClient, authenticate: RequestHandler) {
  const router = Router();
  router.use(authenticate);

  // Newest first, a page at a time; "active" is everything not yet closed.
  router.get("/", async (req, res) => {
    const { userId } = authOf(req);
    const { status, before } = validate(listQuery, req.query);
    const incidents = await prisma.incident.findMany({
      where: {
        ownerId: userId,
        ...(status === "active" && { status: { in: ACTIVE } }),
        ...(status === "closed" && { status: { notIn: ACTIVE } }),
        ...(before && { openedAt: { lt: new Date(before) } }),
      },
      include: incidentInclude,
      orderBy: { openedAt: "desc" },
      take: PAGE_SIZE + 1,
    });
    const page = incidents.slice(0, PAGE_SIZE);
    res.json({
      incidents: page.map(present),
      next: incidents.length > PAGE_SIZE ? page.at(-1)!.openedAt.toISOString() : null,
    });
  });

  async function findOwned(id: string, ownerId: string) {
    const incident = await prisma.incident.findFirst({
      where: { id, ownerId },
      include: incidentInclude,
    });
    if (!incident) throw new HttpError(404, "Incident not found");
    return incident;
  }

  // One incident, every place its secret was seen, and its timeline, oldest first.
  router.get("/:id", async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const incident = await findOwned(id, userId);
    const [locations, events] = await Promise.all([
      prisma.findingLocation.findMany({
        where: { findingId: incident.finding.id },
        orderBy: { seenAt: "desc" },
        select: {
          source: true,
          url: true,
          repository: true,
          path: true,
          commitSha: true,
          line: true,
          context: true,
          committedAt: true,
          seenAt: true,
        },
      }),
      prisma.incidentEvent.findMany({
        where: { incidentId: id },
        orderBy: [{ at: "asc" }, { id: "asc" }],
        select: { id: true, type: true, at: true, detail: true },
      }),
    ]);
    res.json({
      incident: present(incident),
      locations,
      events: events.map((e) => ({ ...e, id: e.id.toString() })),
    });
  });

  router.post("/:id/actions", async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const { action, reason } = validate(actionBody, req.body);
    await findOwned(id, userId);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await applyAction(prisma, id, action, user.email, reason ?? null);
    res.json({ incident: present(await findOwned(id, userId)) });
  });

  return router;
}

// Responding from an alert: no sign-in, the link's signature is the proof. The link
// opens a page; the action is a POST from that page, so a mail scanner that follows
// every link can't mark a leak revoked.
export function respondRouter(prisma: PrismaClient, encryptionKey: Buffer) {
  const router = Router();
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests. Wait a minute and try again." },
    }),
  );

  async function check(id: string, { by, exp, sig }: z.infer<typeof signed>) {
    if (!verifyRespond(encryptionKey, id, by, exp, sig)) {
      throw new HttpError(
        404,
        "This link isn't valid, or has run out. Use one from a newer alert.",
      );
    }
    const incident = await prisma.incident.findUnique({ where: { id }, include: incidentInclude });
    if (!incident) throw new HttpError(404, "This incident no longer exists");
    // Signed when it was sent, so it says nothing about now: someone removed from the
    // team, or a channel since deleted, keeps the link but loses the say.
    if (!(await stillReaches(incident.ownerId, by))) {
      throw new HttpError(404, "This link was sent to someone no longer on the team");
    }
    return incident;
  }

  async function stillReaches(ownerId: string, by: string) {
    const id = by.slice(2);
    if (by.startsWith("c:")) {
      return (await prisma.notificationChannel.count({ where: { id, ownerId } })) > 0;
    }
    if (id === ownerId) return true;
    const member = await prisma.teamMember.count({ where: { userId: id, team: { ownerId } } });
    return member > 0;
  }

  // Who the link was sent to, in words for the timeline.
  async function whoIs(by: string) {
    const id = by.slice(2);
    if (by.startsWith("u:")) {
      const user = await prisma.user.findUnique({ where: { id }, select: { email: true } });
      return user?.email ?? "a former team member";
    }
    const channel = await prisma.notificationChannel.findUnique({
      where: { id },
      select: { name: true },
    });
    return channel ? `someone in "${channel.name}"` : "someone in a deleted channel";
  }

  // Enough to recognise the leak; nothing about the account behind it.
  function summary(i: Loaded) {
    const { finding, ...rest } = present(i);
    return {
      status: rest.status,
      openedAt: rest.openedAt,
      acknowledgedBy: rest.acknowledgedBy,
      closedBy: rest.closedBy,
      finding: {
        detectorLabel: finding.detectorLabel,
        masked: finding.masked,
        lastLocation: finding.lastLocation,
        locationCount: finding.locationCount,
      },
    };
  }

  router.get("/:id", async (req, res) => {
    const { id } = validate(idParams, req.params);
    const link = validate(signed, req.query);
    const incident = await check(id, link);
    res.json({ incident: summary(incident), as: await whoIs(link.by) });
  });

  router.post("/:id", async (req, res) => {
    const { id } = validate(idParams, req.params);
    const { action, ...link } = validate(respondBody, req.body);
    await check(id, link);
    await applyAction(prisma, id, action, await whoIs(link.by));
    res.json({ incident: summary(await check(id, link)) });
  });

  return router;
}
