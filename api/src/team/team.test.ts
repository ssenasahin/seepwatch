import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeApp, outbox, prisma, resetDatabase, signUp } from "../test/helpers.js";

afterAll(() => prisma.$disconnect());
beforeEach(resetDatabase);

async function signedIn(email: string) {
  const app = makeApp();
  const { accessToken } = await signUp(app, email);
  const as = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  const { id: userId } = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { app, as, userId };
}

// Ada invites Grace, and Grace accepts.
async function twoPersonTeam() {
  const ada = await signedIn("ada@example.com");
  const grace = await signedIn("grace@example.com");
  await ada.as(request(ada.app).post("/api/team/invites")).send({ email: "Grace@Example.com" });
  const token = /\/invites\/([\w-]+)/.exec(outbox.at(-1)!.text)![1]!;
  const accepted = await grace.as(request(grace.app).post(`/api/team/invites/${token}/accept`));
  expect(accepted.status).toBe(200);
  return { ada, grace };
}

describe("team", () => {
  it("is made on first visit, with its owner in it", async () => {
    const ada = await signedIn("ada@example.com");
    const res = await ada.as(request(ada.app).get("/api/team"));
    expect(res.body.team.name).toBe("ada's team");
    expect(res.body.members).toEqual([
      expect.objectContaining({ email: "ada@example.com", role: "OWNER" }),
    ]);
  });

  it("invites by email and stores only the token's hash", async () => {
    const ada = await signedIn("ada@example.com");
    const res = await ada
      .as(request(ada.app).post("/api/team/invites"))
      .send({ email: "grace@example.com" });
    expect(res.status).toBe(201);
    expect(res.body.invites).toEqual([expect.objectContaining({ email: "grace@example.com" })]);
    const mail = outbox.at(-1)!;
    expect(mail).toMatchObject({
      to: "grace@example.com",
      subject: "ada@example.com invited you to their Seepwatch team",
    });
    const token = /\/invites\/([\w-]+)/.exec(mail.text)![1]!;
    const stored = await prisma.teamInvite.findFirstOrThrow();
    expect(stored.tokenHash).not.toContain(token);
  });

  it("lets only the invited address accept", async () => {
    const ada = await signedIn("ada@example.com");
    await ada.as(request(ada.app).post("/api/team/invites")).send({ email: "grace@example.com" });
    const token = /\/invites\/([\w-]+)/.exec(outbox.at(-1)!.text)![1]!;

    const mallory = await signedIn("mallory@example.com");
    const preview = await mallory.as(request(mallory.app).get(`/api/team/invites/${token}`));
    expect(preview.body).toEqual({
      email: "grace@example.com",
      team: "ada's team",
      invitedBy: "ada@example.com",
    });
    const stolen = await mallory.as(request(mallory.app).post(`/api/team/invites/${token}/accept`));
    expect(stolen.status).toBe(403);
    expect(stolen.body.error).toMatch(/for grace@example.com/);
  });

  it("adds the member, and the link works only once", async () => {
    const { ada, grace } = await twoPersonTeam();
    const team = await ada.as(request(ada.app).get("/api/team"));
    expect(team.body.members.map((m: { email: string }) => m.email)).toEqual([
      "ada@example.com",
      "grace@example.com",
    ]);
    expect(team.body.invites).toEqual([]);
    const mine = await grace.as(request(grace.app).get("/api/team"));
    expect(mine.body.memberOf).toEqual([
      expect.objectContaining({ name: "ada's team", ownerEmail: "ada@example.com" }),
    ]);

    const token = /\/invites\/([\w-]+)/.exec(outbox.at(-1)!.text)![1]!;
    const again = await grace.as(request(grace.app).post(`/api/team/invites/${token}/accept`));
    expect(again.status).toBe(404);
  });

  it("removes a member from the team and from its policies", async () => {
    const { ada, grace } = await twoPersonTeam();
    const policy = await ada.as(request(ada.app).post("/api/escalation-policies")).send({
      name: "On call",
      steps: [
        { waitMinutes: 0, targets: [{ kind: "member", userId: ada.userId }] },
        {
          waitMinutes: 15,
          targets: [
            { kind: "member", userId: grace.userId },
            { kind: "member", userId: ada.userId },
          ],
        },
      ],
    });
    expect(policy.status).toBe(201);

    const removed = await ada.as(request(ada.app).delete(`/api/team/members/${grace.userId}`));
    expect(removed.status).toBe(204);
    const policies = await ada.as(request(ada.app).get("/api/escalation-policies"));
    expect(policies.body.policies[0].steps[1].targets).toEqual([
      { kind: "member", userId: ada.userId },
    ]);
  });
});

describe("escalation policies", () => {
  it("accepts only people on the team and the owner's channels", async () => {
    const ada = await signedIn("ada@example.com");
    const stranger = await signedIn("stranger@example.com");
    const res = await ada.as(request(ada.app).post("/api/escalation-policies")).send({
      name: "On call",
      steps: [{ waitMinutes: 0, targets: [{ kind: "member", userId: stranger.userId }] }],
    });
    expect(res.status).toBe(400);
    expect(res.body.details["steps.0.targets.0"]).toEqual([
      "Not on your team or among your channels",
    ]);
  });

  it("makes later steps wait at least a minute", async () => {
    const ada = await signedIn("ada@example.com");
    const target = [{ kind: "member", userId: ada.userId }];
    const res = await ada.as(request(ada.app).post("/api/escalation-policies")).send({
      name: "On call",
      steps: [
        { waitMinutes: 5, targets: target },
        { waitMinutes: 0, targets: target },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.details["steps.1.waitMinutes"]).toBeDefined();
  });
});
