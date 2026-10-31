import { MAX_ESCALATION_STEPS, readSteps, type PrismaClient } from "@seepwatch/db";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { authOf } from "../auth/middleware.js";
import { HttpError, validate } from "../http.js";
import { ownTeam } from "../team/routes.js";

const target = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("member"), userId: z.uuid() }),
  z.object({ kind: z.literal("channel"), channelId: z.uuid() }),
]);

const step = z.object({
  waitMinutes: z
    .int()
    .min(0)
    .max(24 * 60, "A day at most"),
  targets: z.array(target).min(1, "Pick at least one person or channel").max(10),
});

const policySchema = z.object({
  name: z.string().trim().min(1, "Give the policy a name").max(100),
  steps: z
    .array(step)
    .min(1, "Add at least one step")
    .max(MAX_ESCALATION_STEPS, `${MAX_ESCALATION_STEPS} steps at most`)
    // The first step is who hears at once; every later one waits for a reason.
    .superRefine((steps, ctx) => {
      steps.forEach((s, i) => {
        if (i > 0 && s.waitMinutes < 1) {
          ctx.addIssue({
            code: "custom",
            path: [i, "waitMinutes"],
            message: "Wait at least a minute",
          });
        }
      });
    })
    .transform((steps) => steps.map((s, i) => (i === 0 ? { ...s, waitMinutes: 0 } : s))),
});

const idParams = z.object({ id: z.uuid() });

export function escalationRouter(prisma: PrismaClient, authenticate: RequestHandler) {
  const router = Router();
  router.use(authenticate);

  // Every target must be on the caller's team or one of their channels.
  async function checkTargets(teamId: string, ownerId: string, steps: z.infer<typeof step>[]) {
    const [members, channels] = await Promise.all([
      prisma.teamMember.findMany({ where: { teamId }, select: { userId: true } }),
      prisma.notificationChannel.findMany({ where: { ownerId }, select: { id: true } }),
    ]);
    const memberIds = new Set(members.map((m) => m.userId));
    const channelIds = new Set(channels.map((c) => c.id));
    steps.forEach((s, i) =>
      s.targets.forEach((t, j) => {
        const known = t.kind === "member" ? memberIds.has(t.userId) : channelIds.has(t.channelId);
        if (!known) {
          throw new HttpError(400, "Invalid request", {
            [`steps.${i}.targets.${j}`]: ["Not on your team or among your channels"],
          });
        }
      }),
    );
  }

  async function findOwned(id: string, teamId: string) {
    const policy = await prisma.escalationPolicy.findFirst({ where: { id, teamId } });
    if (!policy) throw new HttpError(404, "Escalation policy not found");
    return policy;
  }

  const present = (policy: {
    id: string;
    name: string;
    steps: unknown;
    createdAt: Date;
    updatedAt: Date;
  }) => ({
    id: policy.id,
    name: policy.name,
    steps: readSteps(policy.steps),
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  });

  router.get("/", async (req, res) => {
    const { userId } = authOf(req);
    const team = await ownTeam(prisma, userId);
    const policies = await prisma.escalationPolicy.findMany({
      where: { teamId: team.id },
      orderBy: { createdAt: "asc" },
    });
    res.json({ policies: policies.map(present) });
  });

  router.post("/", async (req, res) => {
    const { userId } = authOf(req);
    const input = validate(policySchema, req.body);
    const team = await ownTeam(prisma, userId);
    await checkTargets(team.id, userId, input.steps);
    const policy = await prisma.escalationPolicy.create({ data: { teamId: team.id, ...input } });
    res.status(201).json({ policy: present(policy) });
  });

  router.put("/:id", async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const input = validate(policySchema, req.body);
    const team = await ownTeam(prisma, userId);
    await findOwned(id, team.id);
    await checkTargets(team.id, userId, input.steps);
    const policy = await prisma.escalationPolicy.update({
      where: { id },
      data: input,
    });
    res.json({ policy: present(policy) });
  });

  router.delete("/:id", async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const team = await ownTeam(prisma, userId);
    await findOwned(id, team.id);
    await prisma.escalationPolicy.delete({ where: { id } });
    res.status(204).end();
  });

  return router;
}
