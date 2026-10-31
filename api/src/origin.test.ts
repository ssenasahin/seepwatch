import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { makeApp, prisma, testEnv } from "./test/helpers.js";

afterAll(() => prisma.$disconnect());

const attempt = { email: "ada@example.com", password: "wrong-password-here" };

describe("cross-site request protection", () => {
  it("refuses a POST from another site's page", async () => {
    const res = await request(makeApp())
      .post("/api/auth/login")
      .set("Origin", "https://evil.example")
      .send(attempt);

    expect(res.status).toBe(403);
  });

  it("refuses a POST the browser marks as cross-site, even without an Origin", async () => {
    const res = await request(makeApp())
      .post("/api/auth/logout")
      .set("Sec-Fetch-Site", "cross-site");

    expect(res.status).toBe(403);
  });

  it("lets our own web app through", async () => {
    const res = await request(makeApp())
      .post("/api/auth/login")
      .set("Origin", testEnv.WEB_ORIGIN)
      .set("Sec-Fetch-Site", "same-origin")
      .send(attempt);

    // Past the guard: the answer is about the credentials, not the origin.
    expect(res.status).toBe(401);
  });

  it("lets non-browser clients through", async () => {
    const res = await request(makeApp()).post("/api/auth/login").send(attempt);
    expect(res.status).toBe(401);
  });

  it("allows credentialed CORS only for our own origin", async () => {
    const ours = await request(makeApp()).get("/api/health").set("Origin", testEnv.WEB_ORIGIN);
    const theirs = await request(makeApp())
      .get("/api/health")
      .set("Origin", "https://evil.example");

    expect(ours.headers["access-control-allow-origin"]).toBe(testEnv.WEB_ORIGIN);
    expect(ours.headers["access-control-allow-credentials"]).toBe("true");
    expect(theirs.headers["access-control-allow-origin"]).not.toBe("https://evil.example");
  });
});
