import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  GOOD_PASSWORD,
  makeApp,
  outbox,
  prisma,
  refreshCookie,
  cookiePair,
  resetDatabase,
  signUp,
} from "../test/helpers.js";
import { signedInAdmin } from "../test/admin.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function customer(app: ReturnType<typeof makeApp>, email = "ada@example.com") {
  const session = await signUp(app, email);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { ...session, id: user.id, email };
}

const ADMIN_ROUTES: [string, string][] = [
  ["get", "/api/admin/users"],
  ["get", "/api/admin/users/00000000-0000-4000-8000-000000000000"],
  ["post", "/api/admin/users/00000000-0000-4000-8000-000000000000/suspend"],
  ["post", "/api/admin/users/00000000-0000-4000-8000-000000000000/reactivate"],
  ["post", "/api/admin/users/00000000-0000-4000-8000-000000000000/reset-link"],
  ["post", "/api/admin/users/00000000-0000-4000-8000-000000000000/unlock"],
  ["patch", "/api/admin/users/00000000-0000-4000-8000-000000000000"],
  ["get", "/api/admin/plans"],
  ["post", "/api/admin/plans"],
  ["patch", "/api/admin/plans/00000000-0000-4000-8000-000000000000"],
  ["delete", "/api/admin/plans/00000000-0000-4000-8000-000000000000"],
  ["get", "/api/admin/system/health"],
  ["get", "/api/admin/audit-logs"],
];

describe("every admin endpoint", () => {
  it("turns away ordinary users, whatever the method", async () => {
    const app = makeApp();
    const { accessToken } = await customer(app);
    for (const [method, path] of ADMIN_ROUTES) {
      const req = (request(app) as unknown as Record<string, (p: string) => request.Test>)[method]!;
      const res = await req(path).set("Authorization", `Bearer ${accessToken}`).send({});
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("turns away API keys, even an admin's", async () => {
    const { as } = await signedInAdmin();
    const app = makeApp();
    const { body } = await as(request(app).post("/api/api-keys")).send({ name: "Script" });
    const res = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${body.secret}`);
    expect(res.status).toBe(401);
  });
});

describe("finding users", () => {
  it("searches by email and filters by state", async () => {
    const { app, as } = await signedInAdmin();
    await customer(app, "ada@example.com");
    const grace = await customer(app, "grace@example.org");
    await prisma.user.update({ where: { id: grace.id }, data: { suspendedAt: new Date() } });

    const found = await as(request(app).get("/api/admin/users").query({ q: "EXAMPLE.ORG" }));
    expect(found.body.users.map((u: { email: string }) => u.email)).toEqual(["grace@example.org"]);

    const suspended = await as(request(app).get("/api/admin/users").query({ status: "suspended" }));
    expect(suspended.body.total).toBe(1);

    const detail = await as(request(app).get(`/api/admin/users/${grace.id}`));
    expect(detail.body.user).toMatchObject({
      email: "grace@example.org",
      twoFactor: false,
      limits: { plan: "Free", maxWatches: 10 },
    });
  });
});

describe("suspending an account", () => {
  it("signs it out and keeps it out, on the record", async () => {
    const { app, as, id: adminId } = await signedInAdmin();
    const ada = await customer(app);

    const res = await as(request(app).post(`/api/admin/users/${ada.id}/suspend`)).send({
      reason: "Unpaid invoice",
    });
    expect(res.status).toBe(200);
    expect(res.body.user.suspendedAt).not.toBeNull();

    // The old session, a new sign-in and a refresh all fail.
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${ada.accessToken}`);
    expect(me.status).toBe(401);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: ada.email, password: GOOD_PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error).toMatch(/suspended/);
    const refresh = await request(app).post("/api/auth/refresh").set("Cookie", ada.cookie);
    expect(refresh.status).toBe(401);

    const [entry] = await prisma.auditLog.findMany({ where: { action: "user.suspend" } });
    expect(entry).toMatchObject({
      actorId: adminId,
      actorEmail: "root@example.com",
      targetId: ada.id,
      target: ada.email,
      detail: { reason: "Unpaid invoice" },
    });
    expect(entry!.ip).toBeTruthy();

    // A second click changes nothing and records nothing.
    const again = await as(request(app).post(`/api/admin/users/${ada.id}/suspend`));
    expect(again.status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: "user.suspend" } })).toBe(1);
  });

  it("lets the account back in on reactivation", async () => {
    const { app, as } = await signedInAdmin();
    const ada = await customer(app);
    await as(request(app).post(`/api/admin/users/${ada.id}/suspend`));

    const res = await as(request(app).post(`/api/admin/users/${ada.id}/reactivate`));
    expect(res.status).toBe(200);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: ada.email, password: GOOD_PASSWORD });
    expect(login.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "user.reactivate" } })).toBe(1);
  });

  it("won't suspend the admin themselves or another admin", async () => {
    const { app, as, id } = await signedInAdmin();
    expect((await as(request(app).post(`/api/admin/users/${id}/suspend`))).status).toBe(400);
    const other = await customer(app, "ops@example.com");
    await prisma.user.update({ where: { id: other.id }, data: { role: "SUPER_ADMIN" } });
    expect((await as(request(app).post(`/api/admin/users/${other.id}/suspend`))).status).toBe(400);
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

describe("helping someone back in", () => {
  it("emails a reset link that works for a day", async () => {
    const { app, as } = await signedInAdmin();
    const ada = await customer(app);
    outbox.length = 0;

    const res = await as(request(app).post(`/api/admin/users/${ada.id}/reset-link`));
    expect(res.status).toBe(200);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.text).toMatch(/administrator sent you a link/);
    expect(outbox[0]!.text).toMatch(/24 hours/);

    const token = /token=([A-Za-z0-9_-]+)/.exec(outbox[0]!.text)![1];
    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "a-brand-new-lantern-by-the-sea" });
    expect(reset.status).toBe(204);
    expect(await prisma.auditLog.count({ where: { action: "user.reset_link" } })).toBe(1);
  });

  it("unlocks an account locked by failed sign-ins", async () => {
    const { app, as } = await signedInAdmin();
    const ada = await customer(app);
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/auth/login").send({ email: ada.email, password: "wrong" });
    }
    const locked = await request(app)
      .post("/api/auth/login")
      .send({ email: ada.email, password: GOOD_PASSWORD });
    expect(locked.status).toBe(401);

    expect((await as(request(app).post(`/api/admin/users/${ada.id}/unlock`))).status).toBe(200);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: ada.email, password: GOOD_PASSWORD });
    expect(login.status).toBe(200);
    expect(refreshCookie(login)).toBeDefined();
    expect(cookiePair(refreshCookie(login)!)).toMatch(/^seepwatch_refresh=/);
    expect(await prisma.auditLog.count({ where: { action: "user.unlock" } })).toBe(1);
  });
});
