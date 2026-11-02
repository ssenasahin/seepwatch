import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  githubFiles,
  makeApp,
  prisma,
  resetDatabase,
  signUp,
  txtRecords,
} from "../test/helpers.js";

afterAll(() => prisma.$disconnect());
beforeEach(resetDatabase);

async function signedIn(email = "ada@example.com") {
  const app = makeApp();
  const { accessToken } = await signUp(app, email);
  const as = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  const { id: userId } = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { app, as, userId };
}

type Session = Awaited<ReturnType<typeof signedIn>>;

const add = (s: Session, body: object) => s.as(request(s.app).post("/api/watches")).send(body);
const verify = (s: Session, id: string) => s.as(request(s.app).post(`/api/watches/${id}/verify`));

// Adds a domain and publishes its token, as the owner would in their DNS.
async function verifiedDomain(s: Session, domain = "example.com") {
  const res = await add(s, { kind: "DOMAIN", value: domain });
  const { record } = res.body.watch.verification;
  txtRecords[record.name] = [[record.value]];
  expect((await verify(s, res.body.watch.id)).body.verified).toBe(true);
  return res.body.watch.id as string;
}

describe("domain watches", () => {
  it("are stored lowercased, with a TXT record to publish", async () => {
    const s = await signedIn();
    const res = await add(s, { kind: "DOMAIN", value: "https://Example.COM/careers" });
    expect(res.status).toBe(201);
    expect(res.body.watch).toMatchObject({
      kind: "DOMAIN",
      value: "example.com",
      verification: {
        method: "dns",
        record: { type: "TXT", name: "_seepwatch.example.com" },
        verifiedAt: null,
      },
    });
    expect(res.body.watch.verification.record.value).toMatch(/^seepwatch-verify=/);
  });

  it("refuse what isn't a domain", async () => {
    const s = await signedIn();
    for (const value of ["localhost", "10.0.0.1", "exa mple.com", "example.123"]) {
      const res = await add(s, { kind: "DOMAIN", value });
      expect(res.status).toBe(400);
      expect(res.body.details.value).toBeDefined();
    }
  });

  it("verify only once the token is published", async () => {
    const s = await signedIn();
    const res = await add(s, { kind: "DOMAIN", value: "example.com" });
    const { id, verification } = res.body.watch;

    const early = await verify(s, id);
    expect(early.body.verified).toBe(false);
    expect(early.body.watch.verification.lastVerifyError).toMatch(/No TXT record/);

    txtRecords["_seepwatch.example.com"] = [["v=spf1 -all"]];
    const wrong = await verify(s, id);
    expect(wrong.body.watch.verification.lastVerifyError).toMatch(/none of them is the token/);

    txtRecords["_seepwatch.example.com"] = [["v=spf1 -all"], [verification.record.value]];
    const done = await verify(s, id);
    expect(done.body.verified).toBe(true);
    expect(done.body.watch.verification.verifiedAt).not.toBeNull();
    expect(done.body.watch.verification.lastVerifyError).toBeNull();
  });

  it("can't be verified with another account's token", async () => {
    const ada = await signedIn();
    const mallory = await signedIn("mallory@example.org");
    const theirs = await add(mallory, { kind: "DOMAIN", value: "example.com" });
    await verifiedDomain(ada);
    // Ada's record is published; Mallory's token was never put anywhere.
    expect((await verify(mallory, theirs.body.watch.id)).body.verified).toBe(false);
  });

  it("aren't added twice", async () => {
    const s = await signedIn();
    await add(s, { kind: "DOMAIN", value: "example.com" });
    const again = await add(s, { kind: "DOMAIN", value: "EXAMPLE.com." });
    expect(again.status).toBe(400);
    expect(again.body.details.value).toEqual(["You're already watching this"]);
  });
});

describe("address watches", () => {
  it("need a verified domain first", async () => {
    const s = await signedIn();
    const none = await add(s, { kind: "EMAIL", value: "ops@example.com" });
    expect(none.status).toBe(400);
    expect(none.body.details.value[0]).toMatch(/Add and verify example.com/);

    await add(s, { kind: "DOMAIN", value: "example.com" });
    const pending = await add(s, { kind: "EMAIL", value: "ops@example.com" });
    expect(pending.body.details.value[0]).toMatch(/Verify example.com first/);
  });

  it("are covered by their domain or a parent of it", async () => {
    const s = await signedIn();
    await verifiedDomain(s);
    const res = await add(s, { kind: "EMAIL", value: "Ops@Mail.Example.com" });
    expect(res.status).toBe(201);
    expect(res.body.watch).toMatchObject({
      value: "ops@mail.example.com",
      verification: { method: "domain", domain: "example.com" },
    });
    expect(res.body.watch.verification.verifiedAt).not.toBeNull();

    const elsewhere = await add(s, { kind: "EMAIL", value: "ops@example.org" });
    expect(elsewhere.status).toBe(400);
  });

  it("go when their domain goes", async () => {
    const s = await signedIn();
    const domainId = await verifiedDomain(s);
    await add(s, { kind: "EMAIL", value: "ops@example.com" });
    const removed = await s.as(request(s.app).delete(`/api/watches/${domainId}`));
    expect(removed.status).toBe(204);
    expect(await prisma.watch.count()).toBe(0);
  });
});

describe("GitHub organization watches", () => {
  it("verify through a file in the organization's .github repository", async () => {
    const s = await signedIn();
    const res = await add(s, { kind: "GITHUB_ORG", value: "https://github.com/Acme-Corp" });
    expect(res.body.watch).toMatchObject({
      value: "acme-corp",
      verification: {
        method: "github",
        file: { repository: "acme-corp/.github", path: "seepwatch-verify.txt" },
      },
    });
    const { id, verification } = res.body.watch;
    expect((await verify(s, id)).body.watch.verification.lastVerifyError).toMatch(/No file/);

    githubFiles["acme-corp/seepwatch-verify.txt"] = `${verification.file.content}\n`;
    expect((await verify(s, id)).body.verified).toBe(true);
  });

  it("refuse names GitHub wouldn't allow", async () => {
    const s = await signedIn();
    for (const value of ["-acme", "acme--corp", "a".repeat(40), "acme_corp"]) {
      expect((await add(s, { kind: "GITHUB_ORG", value })).status).toBe(400);
    }
  });
});

describe("key pattern watches", () => {
  const pattern = { charset: "ALNUM", minLength: 24, maxLength: 40 };

  it("keep their prefix as typed and need no verification", async () => {
    const s = await signedIn();
    const res = await add(s, { kind: "KEY_PATTERN", value: "Acme_live_", keyPattern: pattern });
    expect(res.status).toBe(201);
    expect(res.body.watch).toMatchObject({
      value: "Acme_live_",
      keyPattern: pattern,
      verification: { method: "none" },
    });
    expect((await verify(s, res.body.watch.id)).status).toBe(400);
  });

  it("refuse shapes that can't be matched safely", async () => {
    const s = await signedIn();
    const dotted = await add(s, { kind: "KEY_PATTERN", value: "acme.live", keyPattern: pattern });
    expect(dotted.body.details.value).toBeDefined();
    const backwards = await add(s, {
      kind: "KEY_PATTERN",
      value: "acme_",
      keyPattern: { ...pattern, minLength: 40, maxLength: 24 },
    });
    expect(backwards.body.details["keyPattern.maxLength"]).toBeDefined();
    const tiny = await add(s, {
      kind: "KEY_PATTERN",
      value: "acme_",
      keyPattern: { ...pattern, minLength: 4 },
    });
    expect(tiny.body.details["keyPattern.minLength"]).toBeDefined();
  });
});

describe("watches", () => {
  it("belong to their owner", async () => {
    const ada = await signedIn();
    const grace = await signedIn("grace@example.org");
    const { body } = await add(ada, { kind: "DOMAIN", value: "example.com" });
    const id = body.watch.id;

    expect((await grace.as(request(grace.app).get("/api/watches"))).body.watches).toEqual([]);
    expect((await verify(grace, id)).status).toBe(404);
    expect((await grace.as(request(grace.app).patch(`/api/watches/${id}`)).send({})).status).toBe(
      404,
    );
    expect((await grace.as(request(grace.app).delete(`/api/watches/${id}`))).status).toBe(404);
  });

  it("take a label, a pause and an escalation policy of the owner's own", async () => {
    const ada = await signedIn();
    const grace = await signedIn("grace@example.org");
    const { body } = await add(ada, { kind: "DOMAIN", value: "example.com" });
    const policy = await ada.as(request(ada.app).post("/api/escalation-policies")).send({
      name: "On call",
      steps: [{ waitMinutes: 0, targets: [{ kind: "member", userId: ada.userId }] }],
    });
    const gracePolicy = await grace.as(request(grace.app).post("/api/escalation-policies")).send({
      name: "Theirs",
      steps: [{ waitMinutes: 0, targets: [{ kind: "member", userId: grace.userId }] }],
    });

    const patch = (data: object) =>
      ada.as(request(ada.app).patch(`/api/watches/${body.watch.id}`)).send(data);
    const updated = await patch({
      label: "Main site",
      enabled: false,
      escalationPolicyId: policy.body.policy.id,
    });
    expect(updated.body.watch).toMatchObject({
      label: "Main site",
      enabled: false,
      escalationPolicy: { name: "On call" },
    });
    const policies = await ada.as(request(ada.app).get("/api/escalation-policies"));
    expect(policies.body.policies[0].watches).toEqual([
      expect.objectContaining({ value: "example.com", label: "Main site" }),
    ]);

    expect((await patch({ escalationPolicyId: gracePolicy.body.policy.id })).status).toBe(400);
    expect((await patch({ escalationPolicyId: null, label: "" })).body.watch).toMatchObject({
      escalationPolicy: null,
      label: null,
    });
  });

  it("are limited by the plan", async () => {
    const s = await signedIn();
    const plan = await prisma.plan.create({
      data: { name: "Tiny", maxWatches: 1, maxChannels: 1, maxApiKeys: 1 },
    });
    await prisma.user.update({ where: { id: s.userId }, data: { planId: plan.id } });
    expect((await add(s, { kind: "DOMAIN", value: "example.com" })).status).toBe(201);
    const second = await add(s, { kind: "GITHUB_ORG", value: "acme" });
    expect(second.status).toBe(403);
    expect(second.body.error).toBe("Your plan allows up to 1 watches");
    await prisma.user.update({ where: { id: s.userId }, data: { planId: null } });
    await prisma.plan.delete({ where: { id: plan.id } });
  });

  it("stay limited when many are added at once", async () => {
    const s = await signedIn();
    const plan = await prisma.plan.create({
      data: { name: "Tiny", maxWatches: 2, maxChannels: 1, maxApiKeys: 1 },
    });
    await prisma.user.update({ where: { id: s.userId }, data: { planId: plan.id } });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => add(s, { kind: "GITHUB_ORG", value: `org-${i}` })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await prisma.watch.count({ where: { ownerId: s.userId } })).toBe(2);
    await prisma.user.update({ where: { id: s.userId }, data: { planId: null } });
    await prisma.plan.delete({ where: { id: plan.id } });
  });
});
