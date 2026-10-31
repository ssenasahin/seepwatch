import { Prisma, type PrismaClient } from "@seepwatch/db";
import { Router } from "express";
import { z } from "zod";
import { validate } from "../http.js";
import type { Actor } from "./guard.js";

// Every action an admin can take. The audit log filter offers exactly these.
export const AUDIT_ACTIONS = [
  "user.suspend",
  "user.reactivate",
  "user.reset_link",
  "user.unlock",
  "user.plan",
  "plan.create",
  "plan.update",
  "plan.default",
  "plan.delete",
  "admin.create",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// The row to add for one action. Returned unsent, so callers write it in the same
// transaction as the change it describes: no change without its record.
export function audit(
  prisma: Pick<PrismaClient, "auditLog">,
  actor: Actor,
  action: AuditAction,
  target: { id: string; label: string } | null,
  detail?: Prisma.InputJsonObject,
) {
  return prisma.auditLog.create({
    data: {
      actorId: actor.id,
      actorEmail: actor.email,
      action,
      targetId: target?.id ?? null,
      target: target?.label ?? null,
      ip: actor.ip,
      detail: detail ?? Prisma.JsonNull,
    },
  });
}

export function presentEntry(e: {
  id: bigint;
  actorEmail: string;
  action: string;
  targetId: string | null;
  target: string | null;
  ip: string | null;
  detail: Prisma.JsonValue;
  createdAt: Date;
}) {
  return { ...e, id: e.id.toString() };
}

const PAGE = 50;

const listQuery = z.object({
  action: z.enum(AUDIT_ACTIONS).optional(),
  // Matches the actor's or the target's email or name.
  q: z.string().trim().max(200).optional(),
  // The id of the last entry already shown: the next page starts below it.
  before: z
    .string()
    .regex(/^\d{1,19}$/)
    .optional(),
});

export function auditRouter(prisma: PrismaClient) {
  const router = Router();

  router.get("/", async (req, res) => {
    const { action, q, before } = validate(listQuery, req.query);
    const entries = await prisma.auditLog.findMany({
      where: {
        action,
        id: before ? { lt: BigInt(before) } : undefined,
        OR: q
          ? [
              { actorEmail: { contains: q, mode: "insensitive" } },
              { target: { contains: q, mode: "insensitive" } },
            ]
          : undefined,
      },
      orderBy: { id: "desc" },
      take: PAGE + 1,
    });
    const page = entries.slice(0, PAGE);
    res.json({
      entries: page.map(presentEntry),
      next: entries.length > PAGE ? page.at(-1)!.id.toString() : null,
    });
  });

  return router;
}
