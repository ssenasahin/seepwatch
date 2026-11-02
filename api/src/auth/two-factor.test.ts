import { generate } from "otplib";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  enableTwoFactor,
  GOOD_PASSWORD,
  makeApp,
  nextCode,
  prisma,
  resetDatabase,
  signUp,
} from "../test/helpers.js";

const EMAIL = "ada@example.com";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function signInWithPassword(app: ReturnType<typeof makeApp>) {
  return request(app).post("/api/auth/login").send({ email: EMAIL, password: GOOD_PASSWORD });
}

describe("turning two-factor on", () => {
  it("returns a QR code and stores the secret encrypted", async () => {
    const app = makeApp();
    const { accessToken } = await signUp(app);

    const res = await request(app)
      .post("/api/auth/2fa/setup")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Seepwatch/);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.totpSecret).toMatch(/^v1:/);
    expect(user.totpSecret).not.toContain(res.body.secret);
    expect(user.totpEnabledAt).toBeNull();
  });

  it("turns on after a correct code and hands out ten single-use backup codes", async () => {
    const app = makeApp();
    const { accessToken } = await signUp(app);

    const { backupCodes } = await enableTwoFactor(app, accessToken);

    expect(backupCodes).toHaveLength(10);
    expect(new Set(backupCodes).size).toBe(10);
    const stored = await prisma.backupCode.findMany();
    expect(stored.map((c) => c.codeHash)).not.toContain(backupCodes[0]);
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(me.body.user.twoFactorEnabled).toBe(true);
  });

  it("needs the password too, so a session alone can't enrol another phone", async () => {
    const app = makeApp();
    const { accessToken } = await signUp(app);
    const setup = await request(app)
      .post("/api/auth/2fa/setup")
      .set("Authorization", `Bearer ${accessToken}`);
    const code = await generate({ secret: setup.body.secret as string });

    for (const body of [{ code }, { code, password: "not-the-password" }]) {
      const res = await request(app)
        .post("/api/auth/2fa/verify")
        .set("Authorization", `Bearer ${accessToken}`)
        .send(body);
      expect(res.status).toBe(400);
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.totpEnabledAt).toBeNull();
    expect(user.failedLogins).toBe(1);
  });

  it("ends every other session when it turns on", async () => {
    const app = makeApp();
    const { accessToken } = await signUp(app);
    // Someone else signed in with the same password, on another device.
    const other = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: GOOD_PASSWORD });

    const { accessToken: upgraded } = await enableTwoFactor(app, accessToken);

    const theirs = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${other.body.accessToken as string}`);
    expect(theirs.status).toBe(401);
    const mine = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${upgraded}`);
    expect(mine.status).toBe(200);
  });

  it("stays off after a wrong code", async () => {
    const app = makeApp();
    const { accessToken } = await signUp(app);
    await request(app).post("/api/auth/2fa/setup").set("Authorization", `Bearer ${accessToken}`);

    const res = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: "000000", password: GOOD_PASSWORD });

    expect(res.status).toBe(400);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.totpEnabledAt).toBeNull();
  });
});

describe("signing in with two-factor on", () => {
  it("asks for a code instead of creating a session", async () => {
    const app = makeApp();
    const { accessToken } = await signUp(app);
    await enableTwoFactor(app, accessToken);
    const sessionsBefore = await prisma.session.count();

    const res = await signInWithPassword(app);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ twoFactorRequired: true, challengeToken: expect.any(String) });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(await prisma.session.count()).toBe(sessionsBefore);
  });

  it("signs in with a code, as a session that passed the second factor", async () => {
    const app = makeApp();
    const { secret } = await enableTwoFactor(app, (await signUp(app)).accessToken);
    const { challengeToken } = (await signInWithPassword(app)).body;

    const res = await request(app)
      .post("/api/auth/2fa/challenge")
      .send({ challengeToken, code: await nextCode(secret) });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    const newest = await prisma.session.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(newest.mfa).toBe(true);
  });

  it("refuses a code that was already used", async () => {
    const app = makeApp();
    const { secret } = await enableTwoFactor(app, (await signUp(app)).accessToken);
    const code = await nextCode(secret);

    const first = (await signInWithPassword(app)).body.challengeToken;
    await request(app).post("/api/auth/2fa/challenge").send({ challengeToken: first, code });
    const second = (await signInWithPassword(app)).body.challengeToken;
    const replay = await request(app)
      .post("/api/auth/2fa/challenge")
      .send({ challengeToken: second, code });

    expect(replay.status).toBe(401);
  });

  it("accepts each backup code once, in any case or spacing", async () => {
    const app = makeApp();
    const { backupCodes } = await enableTwoFactor(app, (await signUp(app)).accessToken);
    const typed = backupCodes[0]!.toUpperCase().replace("-", " ");

    const first = await request(app)
      .post("/api/auth/2fa/challenge")
      .send({
        challengeToken: (await signInWithPassword(app)).body.challengeToken,
        backupCode: typed,
      });
    const again = await request(app)
      .post("/api/auth/2fa/challenge")
      .send({
        challengeToken: (await signInWithPassword(app)).body.challengeToken,
        backupCode: typed,
      });

    expect(first.status).toBe(200);
    expect(again.status).toBe(401);
  });

  it("does not accept a challenge token as an access token", async () => {
    const app = makeApp();
    await enableTwoFactor(app, (await signUp(app)).accessToken);
    const { challengeToken } = (await signInWithPassword(app)).body;

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${challengeToken}`);

    expect(res.status).toBe(401);
  });

  it("locks the account after five wrong codes", async () => {
    const app = makeApp();
    const { secret } = await enableTwoFactor(app, (await signUp(app)).accessToken);
    const { challengeToken } = (await signInWithPassword(app)).body;

    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/auth/2fa/challenge").send({ challengeToken, code: "123456" });
    }
    const res = await request(app)
      .post("/api/auth/2fa/challenge")
      .send({ challengeToken, code: await nextCode(secret) });

    expect(res.status).toBe(401);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.lockedUntil).not.toBeNull();
  });
});
