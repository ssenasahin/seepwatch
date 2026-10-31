import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  cookiePair,
  GOOD_PASSWORD,
  makeApp,
  prisma,
  refreshCookie,
  resetDatabase,
} from "../test/helpers.js";

const EMAIL = "ada@example.com";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function register(app = makeApp(), email = EMAIL, password = GOOD_PASSWORD) {
  return request(app).post("/api/auth/register").send({ email, password });
}

describe("POST /api/auth/register", () => {
  it("creates the account, signs it in and sets a locked-down refresh cookie", async () => {
    const res = await register();

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: EMAIL, role: "USER", twoFactorEnabled: false });
    expect(res.body.user.passwordHash).toBeUndefined();

    const cookie = refreshCookie(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
  });

  it("stores an argon2id hash, never the password", async () => {
    await register();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(GOOD_PASSWORD);
  });

  it("normalises the email, so case and spaces never create a second account", async () => {
    await register();
    const res = await register(makeApp(), "  ADA@Example.com ");
    expect(res.status).toBe(409);
  });

  it("refuses weak passwords and says why", async () => {
    const res = await register(makeApp(), EMAIL, "123456123456");
    expect(res.status).toBe(400);
    expect(res.body.details.password[0]).toMatch(/commonly used/);
  });
});

describe("POST /api/auth/login", () => {
  it("signs in with the right password", async () => {
    await register();
    const res = await request(makeApp())
      .post("/api/auth/login")
      .send({ email: EMAIL, password: GOOD_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(refreshCookie(res)).toBeDefined();
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    await register();
    const app = makeApp();

    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: "not-the-password" });
    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "not-the-password" });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error).toBe("Invalid email or password");
  });

  it("locks the account after five failures, even against the right password", async () => {
    await register();
    const app = makeApp();
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/auth/login").send({ email: EMAIL, password: "wrong-guess" });
    }

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: GOOD_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });

  it("lets the user back in once the lock expires", async () => {
    await register();
    await prisma.user.update({
      where: { email: EMAIL },
      data: { lockedUntil: new Date(Date.now() - 1000), failedLogins: 3 },
    });

    const res = await request(makeApp())
      .post("/api/auth/login")
      .send({ email: EMAIL, password: GOOD_PASSWORD });

    expect(res.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user).toMatchObject({ failedLogins: 0, lockedUntil: null });
  });

  it("rate limits sign-in attempts per IP", async () => {
    const app = makeApp({ AUTH_RATE_LIMIT_PER_MINUTE: 3 });
    const attempt = () =>
      request(app).post("/api/auth/login").send({ email: EMAIL, password: "wrong-guess" });

    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });
});

describe("sessions and refresh tokens", () => {
  it("rotates the refresh token on every use", async () => {
    const app = makeApp();
    const first = cookiePair(refreshCookie(await register(app))!);

    const res = await request(app).post("/api/auth/refresh").set("Cookie", first);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    const second = cookiePair(refreshCookie(res)!);
    expect(second).not.toBe(first);
  });

  it("ends every session when a rotated-away token is used again", async () => {
    const app = makeApp();
    const signedUp = await register(app);
    const stolen = cookiePair(refreshCookie(signedUp)!);
    const otherDevice = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: GOOD_PASSWORD });

    // The real user refreshes; the thief later replays the old token.
    await request(app).post("/api/auth/refresh").set("Cookie", stolen);
    const replay = await request(app).post("/api/auth/refresh").set("Cookie", stolen);

    expect(replay.status).toBe(401);
    const live = await prisma.session.count({ where: { revokedAt: null } });
    expect(live).toBe(0);
    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${otherDevice.body.accessToken}`);
    expect(me.status).toBe(401);
  });

  it("stores only a hash of the refresh token", async () => {
    const cookie = cookiePair(refreshCookie(await register())!);
    const secret = cookie.split(".")[1]!;
    const session = await prisma.session.findFirstOrThrow();
    expect(session.refreshTokenHash).not.toContain(secret);
  });

  it("signs out: the refresh token stops working and the cookie is cleared", async () => {
    const app = makeApp();
    const cookie = cookiePair(refreshCookie(await register(app))!);

    const out = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(out.status).toBe(204);
    expect(refreshCookie(out)).toMatch(/seepwatch_refresh=;/);

    const res = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/auth/me", () => {
  it("needs an access token", async () => {
    const res = await request(makeApp()).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects a forged token", async () => {
    const { body } = await register();
    const [header, payload] = body.accessToken.split(".");
    const forged = `${header}.${payload}.c2lnbmVkLWJ5LXNvbWVvbmUtZWxzZQ`;

    const res = await request(makeApp())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it("returns the signed-in user", async () => {
    const { body } = await register();
    const res = await request(makeApp())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(EMAIL);
  });
});
