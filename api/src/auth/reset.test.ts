import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GOOD_PASSWORD, makeApp, outbox, prisma, resetDatabase, signUp } from "../test/helpers.js";

const EMAIL = "ada@example.com";
const NEW_PASSWORD = "lighthouse-keeper-at-dawn";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

// Waits for the email that the route sends in the background.
async function lastResetToken(): Promise<string> {
  for (let i = 0; i < 50 && outbox.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  const match = /token=([A-Za-z0-9_-]+)/.exec(outbox.at(-1)!.text);
  return match![1]!;
}

describe("forgotten passwords", () => {
  it("answers the same for known and unknown addresses, and mails only the known one", async () => {
    const app = makeApp();
    await signUp(app, EMAIL);

    const known = await request(app).post("/api/auth/forgot-password").send({ email: EMAIL });
    const unknown = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody@example.com" });

    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    await lastResetToken();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe(EMAIL);
  });

  it("resets the password once, signs out every session and keeps only a hash of the token", async () => {
    const app = makeApp();
    const { cookie } = await signUp(app, EMAIL);
    await request(app).post("/api/auth/forgot-password").send({ email: EMAIL });
    const token = await lastResetToken();

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });
    const again = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: "another-long-passphrase" });

    expect(reset.status).toBe(204);
    expect(again.status).toBe(400);
    const stored = await prisma.passwordResetToken.findFirstOrThrow();
    expect(stored.tokenHash).not.toBe(token);

    const refresh = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    expect(refresh.status).toBe(401);
    const oldPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: GOOD_PASSWORD });
    const newPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: NEW_PASSWORD });
    expect(oldPassword.status).toBe(401);
    expect(newPassword.status).toBe(200);
  });

  it("refuses an expired link", async () => {
    const app = makeApp();
    await signUp(app, EMAIL);
    await request(app).post("/api/auth/forgot-password").send({ email: EMAIL });
    const token = await lastResetToken();
    await prisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, password: NEW_PASSWORD });

    expect(res.status).toBe(400);
  });

  it("applies the password rules to the new password", async () => {
    const app = makeApp();
    await signUp(app, EMAIL);
    await request(app).post("/api/auth/forgot-password").send({ email: EMAIL });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: await lastResetToken(), password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.details.password).toBeDefined();
  });
});
