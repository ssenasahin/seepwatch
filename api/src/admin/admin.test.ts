import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { enableTwoFactor, makeApp, prisma, resetDatabase, signUp } from "../test/helpers.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function makeAdmin(email: string) {
  await prisma.user.update({ where: { email }, data: { role: "SUPER_ADMIN" } });
}

describe("the admin guard", () => {
  it("turns away signed-out visitors", async () => {
    const res = await request(makeApp()).get("/api/admin/overview");
    expect(res.status).toBe(401);
  });

  it("turns away ordinary users", async () => {
    const app = makeApp();
    const { accessToken } = await signUp(app);

    const res = await request(app)
      .get("/api/admin/overview")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
  });

  it("turns away an admin whose session skipped two-factor", async () => {
    const app = makeApp();
    const { accessToken } = await signUp(app, "root@example.com");
    await makeAdmin("root@example.com");

    const res = await request(app)
      .get("/api/admin/overview")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.details.code).toBe("two_factor_required");
  });

  it("lets an admin in once two-factor is on", async () => {
    const app = makeApp();
    const { accessToken } = await signUp(app, "root@example.com");
    await makeAdmin("root@example.com");
    const withTwoFactor = await enableTwoFactor(app, accessToken);

    const res = await request(app)
      .get("/api/admin/overview")
      .set("Authorization", `Bearer ${withTwoFactor.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ users: 1 });
  });

  it("notices a demotion immediately, without waiting for the token to expire", async () => {
    const app = makeApp();
    const { accessToken } = await signUp(app, "root@example.com");
    await makeAdmin("root@example.com");
    const admin = await enableTwoFactor(app, accessToken);
    await prisma.user.update({ where: { email: "root@example.com" }, data: { role: "USER" } });

    const res = await request(app)
      .get("/api/admin/overview")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(403);
  });
});
