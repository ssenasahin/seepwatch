import type { Mailer, Prisma, PrismaClient } from "@seepwatch/db";
import { Router } from "express";
import { z } from "zod";
import { ADMIN_RESET_TTL_MS, createResetLink, resetEmail } from "../auth/reset.js";
import { HttpError, validate } from "../http.js";
import { limitsOf } from "../plans.js";
import { audit, presentEntry } from "./audit.js";
import { adminOf } from "./guard.js";

export interface UserAdminDeps {
  prisma: PrismaClient;
  mailer: Mailer;
  webOrigin: string;
}

const PAGE = 25;

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["all", "active", "suspended", "locked", "admins"]).default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
const idParams = z.object({ id: z.uuid() });

const rowSelect = {
  id: true,
  email: true,
  role: true,
  createdAt: true,
  suspendedAt: true,
  lockedUntil: true,
  totpEnabledAt: true,
  plan: { select: { id: true, name: true } },
} as const;

type Row = Prisma.UserGetPayload<{ select: typeof rowSelect }>;

function presentRow(u: Row, now = new Date()) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt,
    suspendedAt: u.suspendedAt,
    // A lock that has run out is no lock: the next sign-in clears the counter anyway.
    lockedUntil: u.lockedUntil && u.lockedUntil > now ? u.lockedUntil : null,
    twoFactor: u.totpEnabledAt !== null,
    plan: u.plan,
  };
}

function statusFilter(status: z.infer<typeof listQuery>["status"]): Prisma.UserWhereInput {
  const now = new Date();
  switch (status) {
    case "active":
      return {
        suspendedAt: null,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      };
    case "suspended":
      return { suspendedAt: { not: null } };
    case "locked":
      return { lockedUntil: { gt: now } };
    case "admins":
      return { role: "SUPER_ADMIN" };
    default:
      return {};
  }
}

export function userAdminRouter({ prisma, mailer, webOrigin }: UserAdminDeps) {
  const router = Router();

  async function findUser(id: string) {
    const user = await prisma.user.findUnique({ where: { id }, select: rowSelect });
    if (!user) throw new HttpError(404, "No such user");
    return user;
  }

  async function detail(id: string) {
    const user = await findUser(id);
    const now = new Date();
    const [channels, apiKeys, liveSessions, lastSession, limits, history] = await Promise.all([
      prisma.notificationChannel.count({ where: { ownerId: id } }),
      prisma.apiKey.count({ where: { ownerId: id, revokedAt: null } }),
      prisma.session.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: now } } }),
      prisma.session.findFirst({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      limitsOf(prisma, id),
      prisma.auditLog.findMany({
        where: { targetId: id },
        orderBy: { id: "desc" },
        take: 20,
      }),
    ]);
    return {
      user: {
        ...presentRow(user, now),
        channels,
        apiKeys,
        liveSessions,
        lastSignInAt: lastSession?.createdAt ?? null,
        limits,
      },
      history: history.map(presentEntry),
    };
  }

  router.get("/", async (req, res) => {
    const { q, status, page } = validate(listQuery, req.query);
    const where: Prisma.UserWhereInput = {
      ...statusFilter(status),
      ...(q && { email: { contains: q, mode: "insensitive" } }),
    };
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: rowSelect,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * PAGE,
        take: PAGE,
      }),
    ]);
    res.json({ users: users.map((u) => presentRow(u)), total, page, pageSize: PAGE });
  });

  router.get("/:id", async (req, res) => {
    const { id } = validate(idParams, req.params);
    res.json(await detail(id));
  });

  // Suspending signs the person out everywhere and silences their alerts. Their data
  // stays, so reactivating picks up where they left off.
  router.post("/:id/suspend", async (req, res) => {
    const actor = adminOf(req);
    const { id } = validate(idParams, req.params);
    const { reason } = validate(
      z.object({ reason: z.string().trim().max(300).optional() }),
      req.body ?? {},
    );
    const user = await findUser(id);
    if (id === actor.id) throw new HttpError(400, "You can't suspend your own account");
    if (user.role === "SUPER_ADMIN") {
      throw new HttpError(400, "Admins can't be suspended here. Remove the role first.");
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      // Conditional, so two admins clicking at once write one record, not two.
      const { count } = await tx.user.updateMany({
        where: { id, suspendedAt: null },
        data: { suspendedAt: now },
      });
      if (count === 0) throw new HttpError(409, "This account is already suspended");
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      await audit(tx, actor, "user.suspend", { id, label: user.email }, reason ? { reason } : {});
    });

    res.json(await detail(id));
  });

  router.post("/:id/reactivate", async (req, res) => {
    const actor = adminOf(req);
    const { id } = validate(idParams, req.params);
    const user = await findUser(id);
    if (!user.suspendedAt) throw new HttpError(409, "This account isn't suspended");

    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { suspendedAt: null } }),
      audit(prisma, actor, "user.reactivate", { id, label: user.email }),
    ]);

    res.json(await detail(id));
  });

  router.post("/:id/reset-link", async (req, res) => {
    const actor = adminOf(req);
    const { id } = validate(idParams, req.params);
    const user = await findUser(id);

    const link = await createResetLink(prisma, webOrigin, id, ADMIN_RESET_TTL_MS);
    await audit(prisma, actor, "user.reset_link", { id, label: user.email });
    try {
      await mailer.send(resetEmail(user.email, link, true));
    } catch {
      throw new HttpError(502, "The link was made, but the email couldn't be sent. Try again.");
    }
    res.json(await detail(id));
  });

  router.post("/:id/unlock", async (req, res) => {
    const actor = adminOf(req);
    const { id } = validate(idParams, req.params);
    const user = await findUser(id);
    if (!user.lockedUntil || user.lockedUntil <= new Date()) {
      throw new HttpError(409, "This account isn't locked");
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } }),
      audit(prisma, actor, "user.unlock", { id, label: user.email }),
    ]);
    res.json(await detail(id));
  });

  // Null puts the account back on the default plan.
  router.patch("/:id", async (req, res) => {
    const actor = adminOf(req);
    const { id } = validate(idParams, req.params);
    const { planId } = validate(z.object({ planId: z.uuid().nullable() }), req.body);
    const user = await findUser(id);
    const plan = planId
      ? await prisma.plan.findUnique({ where: { id: planId }, select: { id: true, name: true } })
      : null;
    if (planId && !plan) throw new HttpError(400, "No such plan", { planId: ["Pick a plan"] });
    if ((user.plan?.id ?? null) === planId) {
      res.json(await detail(id));
      return;
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: { planId } }),
      audit(
        prisma,
        actor,
        "user.plan",
        { id, label: user.email },
        {
          from: user.plan?.name ?? "Default",
          to: plan?.name ?? "Default",
        },
      ),
    ]);
    res.json(await detail(id));
  });

  return router;
}
