import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDatabase, signUp } from "../test/helpers.js";
import { resetPlans, signedInAdmin } from "../test/admin.js";

beforeEach(async () => {
  await resetDatabase();
  await resetPlans();
});
afterAll(async () => {
  await resetPlans();
  await prisma.$disconnect();
});

const slack = (name: string) => ({
  type: "SLACK",
  name,
  settings: { webhookUrl: "https://hooks.slack.com/services/T000/B000/abcdefghijklmnop" },
});
const small = { name: "Hobby", maxWatches: 1, maxChannels: 1, maxApiKeys: 1 };

describe("plans", () => {
  it("creates a plan and logs edits as a diff", async () => {
    const { app, as } = await signedInAdmin();
    const created = await as(request(app).post("/api/admin/plans")).send(small);
    expect(created.status).toBe(201);
    const hobby = created.body.plans.find((p: { name: string }) => p.name === "Hobby");

    await as(request(app).patch(`/api/admin/plans/${hobby.id}`)).send({
      maxWatches: 3,
      maxChannels: 1,
    });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "plan.update" } });
    expect(entry.detail).toEqual({ maxWatches: [1, 3] });

    // Saving without changes records nothing.
    await as(request(app).patch(`/api/admin/plans/${hobby.id}`)).send({ maxWatches: 3 });
    expect(await prisma.auditLog.count({ where: { action: "plan.update" } })).toBe(1);

    const taken = await as(request(app).post("/api/admin/plans")).send({ ...small, name: "Team" });
    expect(taken.status).toBe(409);
  });

  it("moves the default and won't delete the default plan", async () => {
    const { app, as } = await signedInAdmin();
    const { body } = await as(request(app).get("/api/admin/plans"));
    const free = body.plans.find((p: { name: string }) => p.name === "Free");
    const team = body.plans.find((p: { name: string }) => p.name === "Team");
    expect(free.users).toBe(1);

    expect((await as(request(app).delete(`/api/admin/plans/${free.id}`))).status).toBe(400);
    const moved = await as(request(app).post(`/api/admin/plans/${team.id}/default`));
    expect(moved.body.plans[0]).toMatchObject({ name: "Team", isDefault: true, users: 1 });
    expect(await prisma.plan.count({ where: { isDefault: true } })).toBe(1);

    expect((await as(request(app).delete(`/api/admin/plans/${free.id}`))).status).toBe(200);
  });

  it("holds an account to its plan's limits", async () => {
    const { app, as } = await signedInAdmin();
    const created = await as(request(app).post("/api/admin/plans")).send(small);
    const hobby = created.body.plans.find((p: { name: string }) => p.name === "Hobby");
    const { accessToken } = await signUp(app, "ada@example.com");
    const ada = await prisma.user.findUniqueOrThrow({ where: { email: "ada@example.com" } });

    const assigned = await as(request(app).patch(`/api/admin/users/${ada.id}`)).send({
      planId: hobby.id,
    });
    expect(assigned.body.user.limits).toMatchObject({ plan: "Hobby", maxChannels: 1 });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.plan" } });
    expect(entry.detail).toEqual({ from: "Default", to: "Hobby" });

    const add = (body: object) =>
      request(app).post("/api/channels").set("Authorization", `Bearer ${accessToken}`).send(body);
    expect((await add(slack("Ops"))).status).toBe(201);
    expect((await add(slack("Alerts"))).status).toBe(403);
  });
});
