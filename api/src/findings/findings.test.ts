import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeApp, prisma, resetDatabase, signUp } from "../test/helpers.js";

afterAll(() => prisma.$disconnect());
beforeEach(resetDatabase);

async function signedIn(email = "ada@example.com") {
  const app = makeApp();
  const { accessToken } = await signUp(app, email);
  const as = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  const { id: userId } = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { app, as, userId };
}

// What a scan would have stored: the worker writes findings, the API only reads them.
async function finding(ownerId: string, n: number, firstSeenAt: Date, locations = 1) {
  const watch = await prisma.watch.upsert({
    where: { ownerId_kind_value: { ownerId, kind: "GITHUB_ORG", value: "acme" } },
    create: { ownerId, kind: "GITHUB_ORG", value: "acme", verifiedAt: new Date() },
    update: {},
  });
  return prisma.finding.create({
    data: {
      ownerId,
      watchId: watch.id,
      detector: "aws-access-key",
      fingerprint: `fp-${n}`,
      masked: "AKIA…MNOP",
      firstSeenAt,
      lastSeenAt: firstSeenAt,
      locations: {
        create: Array.from({ length: locations }, (_, i) => ({
          source: "GITHUB_COMMIT" as const,
          url: `https://github.com/acme/api/blob/${"0".repeat(40)}/f${n}-${i}.env#L1`,
          repository: "acme/api",
          path: `f${n}-${i}.env`,
          commitSha: "0".repeat(40),
          line: 1,
          context: "K=AKIA…MNOP",
          seenAt: new Date(firstSeenAt.getTime() + i * 1000),
        })),
      },
    },
  });
}

describe("GET /api/findings", () => {
  it("lists the owner's findings, newest first, without fingerprints", async () => {
    const s = await signedIn();
    await finding(s.userId, 1, new Date("2026-10-01T00:00:00Z"));
    await finding(s.userId, 2, new Date("2026-10-02T00:00:00Z"), 5);

    const res = await s.as(request(s.app).get("/api/findings"));

    expect(res.status).toBe(200);
    expect(res.body.next).toBeNull();
    expect(res.body.findings).toHaveLength(2);
    const [newest] = res.body.findings;
    expect(newest).toMatchObject({
      detector: "aws-access-key",
      detectorLabel: "AWS access key",
      masked: "AKIA…MNOP",
      watch: { kind: "GITHUB_ORG", value: "acme" },
      locationCount: 5,
      // The worker opens it; this test stored the finding alone.
      incident: null,
    });
    // A few recent locations in the list, most recent first.
    expect(newest.locations).toHaveLength(3);
    expect(newest.locations[0].path).toBe("f2-4.env");
    expect(JSON.stringify(res.body)).not.toContain("fp-");
  });

  it("pages through older findings", async () => {
    const s = await signedIn();
    const start = Date.parse("2026-10-01T00:00:00Z");
    for (let n = 0; n < 52; n++) await finding(s.userId, n, new Date(start + n * 60_000));

    const first = await s.as(request(s.app).get("/api/findings"));
    expect(first.body.findings).toHaveLength(50);
    expect(first.body.next).not.toBeNull();

    const second = await s.as(
      request(s.app).get("/api/findings").query({ before: first.body.next }),
    );
    expect(second.body.findings).toHaveLength(2);
    expect(second.body.next).toBeNull();
  });

  it("shows nobody else's findings", async () => {
    const owner = await signedIn("ada@example.com");
    const other = await signedIn("grace@example.com");
    const theirs = await finding(owner.userId, 1, new Date());

    const list = await other.as(request(other.app).get("/api/findings"));
    expect(list.body.findings).toEqual([]);
    const one = await other.as(request(other.app).get(`/api/findings/${theirs.id}`));
    expect(one.status).toBe(404);
  });

  it("returns every location of one finding", async () => {
    const s = await signedIn();
    const f = await finding(s.userId, 1, new Date(), 5);
    const res = await s.as(request(s.app).get(`/api/findings/${f.id}`));
    expect(res.status).toBe(200);
    expect(res.body.finding.locations).toHaveLength(5);
  });

  it("needs a session", async () => {
    const res = await request(makeApp()).get("/api/findings");
    expect(res.status).toBe(401);
  });
});
