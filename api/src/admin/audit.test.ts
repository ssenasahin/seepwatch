import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeApp, prisma, resetDatabase } from "../test/helpers.js";
import type { SystemProbe } from "./system.js";
import { signedInAdmin } from "../test/admin.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe("the audit log", () => {
  it("filters, searches and pages back through older entries", async () => {
    const { app, as, id } = await signedInAdmin();
    await prisma.auditLog.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        actorId: id,
        actorEmail: "root@example.com",
        action: i % 2 ? "user.unlock" : "user.reset_link",
        target: `user${i}@example.com`,
        ip: "203.0.113.7",
      })),
    });

    const first = await as(request(app).get("/api/admin/audit-logs"));
    expect(first.body.entries).toHaveLength(50);
    expect(typeof first.body.entries[0].id).toBe("string");
    const older = await as(
      request(app).get("/api/admin/audit-logs").query({ before: first.body.next }),
    );
    expect(older.body.entries).toHaveLength(10);
    expect(older.body.next).toBeNull();

    const unlocks = await as(
      request(app).get("/api/admin/audit-logs").query({ action: "user.unlock" }),
    );
    expect(unlocks.body.entries).toHaveLength(30);
    const one = await as(request(app).get("/api/admin/audit-logs").query({ q: "USER17@" }));
    expect(one.body.entries.map((e: { target: string }) => e.target)).toEqual([
      "user17@example.com",
    ]);
  });

  it("can't be edited or deleted, even straight in the database", async () => {
    const { id } = await signedInAdmin();
    const entry = await prisma.auditLog.create({
      data: { actorId: id, actorEmail: "root@example.com", action: "user.unlock" },
    });
    await expect(
      prisma.auditLog.update({ where: { id: entry.id }, data: { action: "user.suspend" } }),
    ).rejects.toThrow(/cannot be changed/);
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow(/cannot be changed/);

    // Deleting the admin keeps the entry and who it was.
    await prisma.user.delete({ where: { id } });
    const kept = await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } });
    expect(kept).toMatchObject({ actorId: null, actorEmail: "root@example.com" });
  });
});

describe("system health", () => {
  it("reports database size, Redis and the queues", async () => {
    const probe: SystemProbe = {
      queues: async () => [
        { name: "scans", waiting: 2, active: 1, delayed: 40, failed: 0, workers: 1 },
      ],
      redisMemoryBytes: async () => 1_048_576,
    };
    const { app, as } = await signedInAdmin(makeApp({}, probe));
    const res = await as(request(app).get("/api/admin/system/health"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      workers: 1,
      redis: { bytes: 1_048_576 },
      users: 1,
    });
    expect(res.body.database.bytes).toBeGreaterThan(0);
  });

  it("still answers without a queue probe", async () => {
    const { app, as } = await signedInAdmin();
    const res = await as(request(app).get("/api/admin/system/health"));
    expect(res.status).toBe(200);
    expect(res.body.queues).toEqual([]);
  });
});
