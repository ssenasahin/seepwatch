import type { PrismaClient } from "@seepwatch/db";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { testEnv } from "./test/helpers.js";

// The health check is tested with a fake database probe, so it needs no Postgres.
function appWith(checkDatabase: () => Promise<void>) {
  return createApp({
    env: testEnv,
    prisma: {} as PrismaClient,
    mailer: { send: async () => {} },
    checkDatabase,
  });
}

describe("GET /api/health", () => {
  it("reports ok when the database answers", async () => {
    const res = await request(appWith(async () => {})).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", database: "up" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const app = appWith(async () => {
      throw new Error("connection refused");
    });

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "degraded", database: "down" });
  });

  it("sends security headers", async () => {
    const res = await request(appWith(async () => {})).get("/api/health");

    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
