import { Prisma, type PrismaClient } from "@seepwatch/db";
import { Router } from "express";
import { z } from "zod";
import { HttpError, validate } from "../http.js";
import { audit } from "./audit.js";
import { adminOf } from "./guard.js";

const limits = {
  maxWatches: z.int().min(1, "Allow at least 1").max(10_000),
  maxChannels: z.int().min(0).max(1000),
  maxApiKeys: z.int().min(0).max(1000),
};
const createSchema = z.object({
  name: z.string().trim().min(1, "Name the plan").max(50),
  ...limits,
});
const updateSchema = createSchema.partial();
const idParams = z.object({ id: z.uuid() });

const FIELDS = ["name", "maxWatches", "maxChannels", "maxApiKeys"] as const;

function isNameTaken(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
const NAME_TAKEN = new HttpError(409, "A plan with that name exists", {
  name: ["Pick another name"],
});

// Lowering a limit takes nothing away: accounts over it keep what they have and
// just can't add more until they're under it.
export function planAdminRouter(prisma: PrismaClient) {
  const router = Router();

  async function list() {
    const plans = await prisma.plan.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: { _count: { select: { users: true } } },
    });
    // The default plan also covers everyone who has no plan of their own.
    const unassigned = await prisma.user.count({ where: { planId: null } });
    return plans.map(({ _count, ...p }) => ({
      ...p,
      users: _count.users + (p.isDefault ? unassigned : 0),
    }));
  }

  async function findPlan(id: string) {
    const plan = await prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new HttpError(404, "No such plan");
    return plan;
  }

  router.get("/", async (_req, res) => {
    res.json({ plans: await list() });
  });

  router.post("/", async (req, res) => {
    const actor = adminOf(req);
    const input = validate(createSchema, req.body);
    try {
      await prisma.$transaction(async (tx) => {
        const plan = await tx.plan.create({ data: input });
        await audit(tx, actor, "plan.create", { id: plan.id, label: plan.name }, input);
      });
    } catch (err) {
      if (isNameTaken(err)) throw NAME_TAKEN;
      throw err;
    }
    res.status(201).json({ plans: await list() });
  });

  router.patch("/:id", async (req, res) => {
    const actor = adminOf(req);
    const { id } = validate(idParams, req.params);
    const input = validate(updateSchema, req.body);
    const plan = await findPlan(id);
    // Only what actually changed, as [before, after], so the log reads as a diff.
    const changes = Object.fromEntries(
      FIELDS.filter((f) => input[f] !== undefined && input[f] !== plan[f]).map((f) => [
        f,
        [plan[f], input[f]!],
      ]),
    );
    if (Object.keys(changes).length > 0) {
      try {
        await prisma.$transaction([
          prisma.plan.update({ where: { id }, data: input }),
          audit(prisma, actor, "plan.update", { id, label: input.name ?? plan.name }, changes),
        ]);
      } catch (err) {
        if (isNameTaken(err)) throw NAME_TAKEN;
        throw err;
      }
    }
    res.json({ plans: await list() });
  });

  router.post("/:id/default", async (req, res) => {
    const actor = adminOf(req);
    const { id } = validate(idParams, req.params);
    const plan = await findPlan(id);
    if (!plan.isDefault) {
      await prisma.$transaction([
        prisma.plan.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
        prisma.plan.update({ where: { id }, data: { isDefault: true } }),
        audit(prisma, actor, "plan.default", { id, label: plan.name }),
      ]);
    }
    res.json({ plans: await list() });
  });

  // Its accounts move to the default plan.
  router.delete("/:id", async (req, res) => {
    const actor = adminOf(req);
    const { id } = validate(idParams, req.params);
    const plan = await findPlan(id);
    if (plan.isDefault) {
      throw new HttpError(400, "Make another plan the default before deleting this one");
    }
    await prisma.$transaction([
      prisma.plan.delete({ where: { id } }),
      audit(prisma, actor, "plan.delete", { id, label: plan.name }),
    ]);
    res.json({ plans: await list() });
  });

  return router;
}
