import { ACK_REMINDER_MS, respondLink } from "@seepwatch/db";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { makeApp, prisma, resetDatabase, signUp, testEnv } from "../test/helpers.js";

afterAll(() => prisma.$disconnect());
beforeEach(resetDatabase);

const KEY = Buffer.from(testEnv.ENCRYPTION_KEY, "base64");

async function signedIn(email = "ada@example.com") {
  const app = makeApp();
  const { accessToken } = await signUp(app, email);
  const as = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  const { id: userId } = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { app, as, userId };
}

// What the worker would have stored: a finding and its incident, alerted `round` times.
async function incident(ownerId: string, round = 1, n = 1) {
  const finding = await prisma.finding.create({
    data: {
      ownerId,
      detector: "aws-access-key",
      fingerprint: `fp-${n}`,
      masked: "AKIA…MNOP",
      locations: {
        create: {
          source: "GITHUB_COMMIT",
          url: `https://github.com/acme/api/blob/abc/f${n}.env#L1`,
          repository: "acme/api",
          path: `f${n}.env`,
          line: 1,
          context: "K=AKIA…MNOP",
        },
      },
    },
  });
  return prisma.incident.create({
    data: {
      ownerId,
      findingId: finding.id,
      round,
      openedAt: new Date(Date.UTC(2026, 9, 1) + n * 60_000),
      nextAlertAt: new Date(Date.now() + 60_000),
    },
  });
}

// The page behind an alert's link, as the browser would call it.
function linkParts(incidentId: string, by: string) {
  const url = new URL(respondLink(testEnv.WEB_ORIGIN, KEY, incidentId, by));
  return { by: url.searchParams.get("by")!, sig: url.searchParams.get("sig")! };
}

describe("GET /api/incidents", () => {
  it("lists the owner's incidents with their finding, filtered by status", async () => {
    const s = await signedIn();
    const open = await incident(s.userId, 1, 1);
    const closed = await incident(s.userId, 1, 2);
    await prisma.incident.update({
      where: { id: closed.id },
      data: { status: "REVOKED", closedAt: new Date(), nextAlertAt: null },
    });

    const all = await s.as(request(s.app).get("/api/incidents"));
    expect(all.body.incidents.map((i: { id: string }) => i.id)).toEqual([closed.id, open.id]);
    expect(all.body.incidents[1]).toMatchObject({
      status: "OPEN",
      alertsSent: 1,
      finding: {
        detectorLabel: "AWS access key",
        masked: "AKIA…MNOP",
        locationCount: 1,
        lastLocation: { source: "GITHUB_COMMIT", repository: "acme/api", path: "f1.env" },
      },
    });
    expect(JSON.stringify(all.body)).not.toContain("fp-");

    const active = await s.as(request(s.app).get("/api/incidents").query({ status: "active" }));
    expect(active.body.incidents.map((i: { id: string }) => i.id)).toEqual([open.id]);
  });

  it("shows nobody else's incidents", async () => {
    const owner = await signedIn("ada@example.com");
    const other = await signedIn("grace@example.com");
    const theirs = await incident(owner.userId);
    expect((await other.as(request(other.app).get("/api/incidents"))).body.incidents).toEqual([]);
    const one = await other.as(request(other.app).get(`/api/incidents/${theirs.id}`));
    expect(one.status).toBe(404);
  });

  it("returns one incident with its locations and timeline", async () => {
    const s = await signedIn();
    const i = await incident(s.userId);
    await prisma.incidentEvent.create({ data: { incidentId: i.id, type: "OPENED" } });
    const res = await s.as(request(s.app).get(`/api/incidents/${i.id}`));
    expect(res.status).toBe(200);
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.events).toEqual([expect.objectContaining({ type: "OPENED" })]);
  });
});

describe("POST /api/incidents/:id/actions", () => {
  const act = (s: Awaited<ReturnType<typeof signedIn>>, id: string, body: object) =>
    s.as(request(s.app).post(`/api/incidents/${id}/actions`)).send(body);

  it("acknowledges, moving the next alert to a reminder", async () => {
    const s = await signedIn();
    const i = await incident(s.userId);
    const before = Date.now();

    const res = await act(s, i.id, { action: "ACKNOWLEDGE" });

    expect(res.status).toBe(200);
    expect(res.body.incident).toMatchObject({
      status: "ACKNOWLEDGED",
      acknowledgedBy: "ada@example.com",
    });
    const next = new Date(res.body.incident.nextAlertAt).getTime();
    expect(next).toBeGreaterThanOrEqual(before + ACK_REMINDER_MS);
    expect((await act(s, i.id, { action: "ACKNOWLEDGE" })).status).toBe(409);
  });

  it("revokes, making one last round due to say it's over", async () => {
    const s = await signedIn();
    const i = await incident(s.userId);
    const res = await act(s, i.id, { action: "REVOKE" });
    expect(res.body.incident).toMatchObject({ status: "REVOKED", closedBy: "ada@example.com" });
    const stored = await prisma.incident.findUniqueOrThrow({ where: { id: i.id } });
    expect(stored.nextAlertAt!.getTime()).toBeLessThanOrEqual(Date.now());
    const events = await prisma.incidentEvent.findMany({ where: { incidentId: i.id } });
    expect(events).toEqual([
      expect.objectContaining({ type: "REVOKED", detail: "By ada@example.com" }),
    ]);
  });

  it("closes without alerting when nobody was alerted yet", async () => {
    const s = await signedIn();
    const i = await incident(s.userId, 0);
    await act(s, i.id, { action: "REVOKE" });
    const stored = await prisma.incident.findUniqueOrThrow({ where: { id: i.id } });
    expect(stored.nextAlertAt).toBeNull();
  });

  it("needs a reason for a false positive or an accepted risk", async () => {
    const s = await signedIn();
    const i = await incident(s.userId);
    const bare = await act(s, i.id, { action: "FALSE_POSITIVE" });
    expect(bare.status).toBe(400);
    expect(bare.body.details.reason).toBeDefined();

    const res = await act(s, i.id, {
      action: "ACCEPT_RISK",
      reason: "  Test account, no access  ",
    });
    expect(res.body.incident).toMatchObject({
      status: "RISK_ACCEPTED",
      closeReason: "Test account, no access",
    });
  });

  it("keeps a closed incident closed", async () => {
    const s = await signedIn();
    const i = await incident(s.userId);
    await act(s, i.id, { action: "REVOKE" });
    const again = await act(s, i.id, { action: "ACKNOWLEDGE" });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("It's already marked revoked");
  });

  it("refuses another user's incident", async () => {
    const owner = await signedIn("ada@example.com");
    const other = await signedIn("grace@example.com");
    const theirs = await incident(owner.userId);
    expect((await act(other, theirs.id, { action: "REVOKE" })).status).toBe(404);
  });
});

describe("/api/respond", () => {
  it("shows the leak to whoever holds a valid link, and lets them act on it", async () => {
    const s = await signedIn();
    const i = await incident(s.userId);
    const parts = linkParts(i.id, `u:${s.userId}`);
    const app = makeApp();

    const page = await request(app).get(`/api/respond/${i.id}`).query(parts);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({
      as: "ada@example.com",
      incident: { status: "OPEN", finding: { masked: "AKIA…MNOP" } },
    });
    // Enough to recognise the leak; nothing about the account or the timeline.
    expect(page.body.incident.closeReason).toBeUndefined();

    const ack = await request(app)
      .post(`/api/respond/${i.id}`)
      .send({ ...parts, action: "ACKNOWLEDGE" });
    expect(ack.body.incident).toMatchObject({
      status: "ACKNOWLEDGED",
      acknowledgedBy: "ada@example.com",
    });

    const revoke = await request(app)
      .post(`/api/respond/${i.id}`)
      .send({ ...parts, action: "REVOKE" });
    expect(revoke.body.incident.status).toBe("REVOKED");
  });

  it("names a channel by its name", async () => {
    const s = await signedIn();
    const i = await incident(s.userId);
    const channel = await prisma.notificationChannel.create({
      data: { ownerId: s.userId, type: "SLACK", name: "#security", config: "x" },
    });
    const parts = linkParts(i.id, `c:${channel.id}`);
    const res = await request(makeApp())
      .post(`/api/respond/${i.id}`)
      .send({ ...parts, action: "ACKNOWLEDGE" });
    expect(res.body.incident.acknowledgedBy).toBe('someone in "#security"');
  });

  it("refuses a forged or borrowed signature", async () => {
    const s = await signedIn();
    const mine = await incident(s.userId, 1, 1);
    const other = await incident(s.userId, 1, 2);
    const parts = linkParts(mine.id, `u:${s.userId}`);
    const app = makeApp();

    const borrowed = await request(app).get(`/api/respond/${other.id}`).query(parts);
    expect(borrowed.status).toBe(404);
    const forged = await request(app)
      .post(`/api/respond/${mine.id}`)
      .send({
        ...parts,
        sig: parts.sig.replace(/^./, (c) => (c === "A" ? "B" : "A")),
        action: "REVOKE",
      });
    expect(forged.status).toBe(404);
  });

  it("can't close as a false positive or an accepted risk", async () => {
    const s = await signedIn();
    const i = await incident(s.userId);
    const parts = linkParts(i.id, `u:${s.userId}`);
    const res = await request(makeApp())
      .post(`/api/respond/${i.id}`)
      .send({ ...parts, action: "FALSE_POSITIVE" });
    expect(res.status).toBe(400);
  });
});
