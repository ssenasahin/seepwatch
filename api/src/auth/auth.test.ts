import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  cookiePair,
  GOOD_PASSWORD,
  makeApp,
  outbox,
  prisma,
  refreshCookie,
  resetDatabase,
  signupToken,
} from "../test/helpers.js";
import { ACCOUNT_FAILURE_LIMIT } from "./lockout.js";

const EMAIL = "ada@example.com";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const signUpRequest = (app = makeApp(), email = EMAIL, password = GOOD_PASSWORD) =>
  request(app).post("/api/auth/register").send({ email, password });

// The sign-up mail goes out without being awaited.
const mailSent = () => new Promise((done) => setImmediate(done));

const verify = (app: ReturnType<typeof makeApp>, token: string) =>
  request(app).post("/api/auth/verify-email").send({ token });

// Signs up and follows the emailed link: the response that signs the new user in.
async function register(app = makeApp(), email = EMAIL, password = GOOD_PASSWORD) {
  expect((await signUpRequest(app, email, password)).status).toBe(202);
  await mailSent();
  return verify(app, signupToken(email));
}

describe("signing up", () => {
  it("makes no account until the emailed link is used", async () => {
    const app = makeApp();
    const res = await signUpRequest(app);
    expect(res.status).toBe(202);
    expect(res.body.accessToken).toBeUndefined();
    expect(refreshCookie(res)).toBeUndefined();
    expect(await prisma.user.count()).toBe(0);

    await mailSent();
    expect(outbox.at(-1)).toMatchObject({
      to: EMAIL,
      subject: "Finish creating your Seepwatch account",
    });
  });

  it("creates the account from the link, signs it in and sets a locked-down refresh cookie", async () => {
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

  it("works once, and not after a day", async () => {
    const app = makeApp();
    await signUpRequest(app);
    await mailSent();
    const token = signupToken(EMAIL);
    expect((await verify(app, token)).status).toBe(201);
    expect((await verify(app, token)).status).toBe(400);

    await signUpRequest(app, "grace@example.com");
    await mailSent();
    await prisma.pendingSignup.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await verify(app, signupToken("grace@example.com"))).status).toBe(400);
    expect(await prisma.user.count()).toBe(1);
  });

  it("answers the same for an address that already has an account, and tells its owner", async () => {
    await register();
    outbox.length = 0;
    const fresh = await signUpRequest(makeApp(), "grace@example.com");
    // Case and spaces don't make it a different address.
    const taken = await signUpRequest(makeApp(), "  ADA@Example.com ");

    expect(taken.status).toBe(202);
    expect(taken.body).toEqual(fresh.body);
    await mailSent();
    const toAda = outbox.filter((m) => m.to === EMAIL);
    expect(toAda).toHaveLength(1);
    expect(toAda[0]!.subject).toBe("You already have a Seepwatch account");
    expect(toAda[0]!.text).not.toContain("verify-email");
    expect(await prisma.user.count()).toBe(1);
  });

  it("keeps only a hash of the link, and the password hashed", async () => {
    await signUpRequest();
    await mailSent();
    const pending = await prisma.pendingSignup.findFirstOrThrow();
    expect(pending.tokenHash).not.toContain(signupToken(EMAIL));
    expect(pending.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it("stores an argon2id hash, never the password", async () => {
    await register();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(GOOD_PASSWORD);
  });

  it("refuses weak passwords and says why", async () => {
    const res = await signUpRequest(makeApp(), EMAIL, "123456123456");
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

  it("locks the address out after five failures, even against the right password", async () => {
    await register();
    const app = makeApp({ TRUST_PROXY: 1 });
    const from = (ip: string, password: string) =>
      request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", ip)
        .send({ email: EMAIL, password });
    for (let i = 0; i < 5; i++) await from("203.0.113.9", "wrong-guess");

    const res = await from("203.0.113.9", GOOD_PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
    const throttle = await prisma.signInThrottle.findFirstOrThrow({ where: { ip: "203.0.113.9" } });
    expect(throttle.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);

    // The owner, somewhere else, isn't locked out by a stranger's guesses.
    expect((await from("198.51.100.4", GOOD_PASSWORD)).status).toBe(200);
  });

  it("locks the whole account only after failures from many addresses", async () => {
    await register();
    const app = makeApp({ TRUST_PROXY: 1, AUTH_RATE_LIMIT_PER_MINUTE: 1000 });
    for (let i = 0; i < ACCOUNT_FAILURE_LIMIT; i++) {
      await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `203.0.113.${i % 25}`)
        .send({ email: EMAIL, password: "wrong-guess" });
    }
    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "198.51.100.4")
      .send({ email: EMAIL, password: GOOD_PASSWORD });
    expect(res.status).toBe(401);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.lockedUntil).not.toBeNull();
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

  it("only refuses a made-up token for a real session, ending nothing", async () => {
    const app = makeApp();
    const cookie = cookiePair(refreshCookie(await register(app))!);
    // The session id is no secret: it's inside every access token.
    const [name, value] = cookie.split("=") as [string, string];
    const guessed = `${name}=${value.split(".")[0]}.${"A".repeat(43)}`;

    const res = await request(app).post("/api/auth/refresh").set("Cookie", guessed);
    expect(res.status).toBe(401);
    expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(1);
    const real = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    expect(real.status).toBe(200);
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
