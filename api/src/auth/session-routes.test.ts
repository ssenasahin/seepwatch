import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GOOD_PASSWORD, makeApp, prisma, resetDatabase, signUp } from "../test/helpers.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe("active sessions", () => {
  it("lists every signed-in device and marks the current one", async () => {
    const app = makeApp();
    const laptop = await signUp(app);
    await request(app)
      .post("/api/auth/login")
      .set("User-Agent", "Phone")
      .send({ email: "ada@example.com", password: GOOD_PASSWORD });

    const res = await request(app)
      .get("/api/auth/sessions")
      .set("Authorization", `Bearer ${laptop.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect(res.body.sessions[0]).not.toHaveProperty("refreshTokenHash");
  });

  it("signs out another device", async () => {
    const app = makeApp();
    const laptop = await signUp(app);
    const phone = await request(app)
      .post("/api/auth/login")
      .send({ email: "ada@example.com", password: GOOD_PASSWORD });
    const phoneSession = await prisma.session.findFirstOrThrow({ orderBy: { createdAt: "desc" } });

    const res = await request(app)
      .delete(`/api/auth/sessions/${phoneSession.id}`)
      .set("Authorization", `Bearer ${laptop.accessToken}`);

    expect(res.status).toBe(204);
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${phone.body.accessToken}`);
    expect(me.status).toBe(401);
  });

  it("can't touch someone else's session", async () => {
    const app = makeApp();
    const ada = await signUp(app, "ada@example.com");
    await signUp(app, "grace@example.com");
    const grace = await prisma.session.findFirstOrThrow({
      where: { user: { email: "grace@example.com" } },
    });

    const res = await request(app)
      .delete(`/api/auth/sessions/${grace.id}`)
      .set("Authorization", `Bearer ${ada.accessToken}`);

    expect(res.status).toBe(404);
    const still = await prisma.session.findUniqueOrThrow({ where: { id: grace.id } });
    expect(still.revokedAt).toBeNull();
  });

  it("signs out everywhere at once", async () => {
    const app = makeApp();
    const laptop = await signUp(app);

    const res = await request(app)
      .post("/api/auth/logout-all")
      .set("Authorization", `Bearer ${laptop.accessToken}`);

    expect(res.status).toBe(204);
    const refresh = await request(app).post("/api/auth/refresh").set("Cookie", laptop.cookie);
    expect(refresh.status).toBe(401);
  });
});
