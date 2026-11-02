import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeApp, prisma, resetDatabase, signUp } from "../test/helpers.js";

afterAll(() => prisma.$disconnect());
beforeEach(resetDatabase);

async function withKey() {
  const app = makeApp();
  const { accessToken } = await signUp(app);
  const created = await request(app)
    .post("/api/api-keys")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "Script" });
  expect(created.status).toBe(201);
  const key = created.body.secret as string;
  const as = (req: request.Test, k = key) => req.set("Authorization", `Bearer ${k}`);
  return { app, accessToken, key, keyId: created.body.key.id as string, as };
}

describe("API keys", () => {
  it("read watches, findings and incidents", async () => {
    const { app, as } = await withKey();
    for (const path of ["/api/watches", "/api/findings", "/api/incidents"]) {
      const res = await as(request(app).get(path));
      expect(res.status, path).toBe(200);
    }
    const added = await as(request(app).post("/api/watches")).send({
      kind: "GITHUB_ORG",
      value: "acme",
    });
    expect(added.status).toBe(201);
  });

  it("can't manage keys, the team or the account", async () => {
    const { app, as } = await withKey();
    for (const [method, path] of [
      ["get", "/api/api-keys"],
      ["post", "/api/api-keys"],
      ["get", "/api/team"],
      ["get", "/api/channels"],
      ["get", "/api/auth/me"],
      ["get", "/api/auth/sessions"],
      ["get", "/api/admin/users"],
    ] as const) {
      const res = await as(request(app)[method](path));
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("stop working once revoked", async () => {
    const { app, accessToken, keyId, as } = await withKey();
    await request(app)
      .delete(`/api/api-keys/${keyId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    const res = await as(request(app).get("/api/incidents"));
    expect(res.status).toBe(401);
  });

  it("refuse a key that was never issued", async () => {
    const { app, as } = await withKey();
    const res = await as(request(app).get("/api/incidents"), `spw_sk_${"A".repeat(43)}`);
    expect(res.status).toBe(401);
  });
});
