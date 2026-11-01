import {
  ACK_REMINDER_MS,
  OPEN_REMINDER_MS,
  sealConfig,
  verifyRespond,
  type Mail,
  type Mailer,
  type Transport,
} from "@seepwatch/db";
import { beforeEach, describe, expect, it } from "vitest";
import { dueIncidents, runRound, type AlertDeps } from "./alerts.js";
import { prisma, makeOwner, resetDatabase } from "./test/database.js";

const KEY = Buffer.alloc(32, 7);
const NOW = new Date("2026-11-01T12:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);

let outbox: Mail[];
let posts: { url: string; body: string }[];
let answer: number;
let failMail: string | null;

const mailer: Mailer = {
  async send(mail) {
    if (mail.to === failMail) throw new Error("mailbox full");
    outbox.push(mail);
  },
};
const transport: Transport = async (url, body) => {
  posts.push({ url, body });
  return { status: answer, text: answer === 200 ? "ok" : "" };
};
const deps: AlertDeps = {
  prisma,
  mailer,
  webOrigin: "https://app.seepwatch.dev",
  encryptionKey: KEY,
  transport,
  wait: async () => {},
};

let owner: { id: string; email: string };
beforeEach(async () => {
  await resetDatabase();
  outbox = [];
  posts = [];
  answer = 200;
  failMail = null;
  owner = await makeOwner();
});

async function slackChannel(name: string) {
  return prisma.notificationChannel.create({
    data: {
      ownerId: owner.id,
      type: "SLACK",
      name,
      config: sealConfig({ webhookUrl: `https://hooks.slack.com/services/${name}` }, KEY),
    },
  });
}

// A leak found by an organization watch, due for its first alert at NOW.
async function incident(options: { policyId?: string } = {}) {
  const watch = await prisma.watch.create({
    data: {
      ownerId: owner.id,
      kind: "GITHUB_ORG",
      value: "acme",
      verifiedAt: NOW,
      escalationPolicyId: options.policyId ?? null,
    },
  });
  const finding = await prisma.finding.create({
    data: {
      ownerId: owner.id,
      watchId: watch.id,
      detector: "aws-access-key",
      fingerprint: "fp",
      masked: "AKIA…MNOP",
      locations: {
        create: {
          source: "GITHUB_COMMIT",
          url: "https://github.com/acme/api/blob/abc/.env#L3",
          repository: "acme/api",
          path: ".env",
          line: 3,
          context: "K=AKIA…MNOP",
        },
      },
    },
  });
  return prisma.incident.create({
    data: { ownerId: owner.id, findingId: finding.id, openedAt: NOW, nextAlertAt: NOW },
  });
}

// A team with a member, and a policy: the member at once, then a Slack channel
// after 10 minutes.
async function policy() {
  const member = await makeOwner("grace@example.com");
  const team = await prisma.team.create({
    data: {
      ownerId: owner.id,
      name: "Acme",
      members: { create: { userId: member.id } },
    },
  });
  const channel = await slackChannel("security");
  return prisma.escalationPolicy.create({
    data: {
      teamId: team.id,
      name: "Security on call",
      steps: [
        { waitMinutes: 0, targets: [{ kind: "member", userId: member.id }] },
        { waitMinutes: 10, targets: [{ kind: "channel", channelId: channel.id }] },
      ],
    },
  });
}

const reload = (id: string) => prisma.incident.findUniqueOrThrow({ where: { id } });
const events = async (id: string) =>
  (await prisma.incidentEvent.findMany({ where: { incidentId: id }, orderBy: { id: "asc" } })).map(
    (e) => e.type,
  );

describe("runRound without a policy", () => {
  it("alerts the owner and every channel, then waits an hour", async () => {
    await slackChannel("alerts");
    const i = await incident();

    expect(await runRound(deps, i.id, NOW)).toBe(true);

    expect(outbox.map((m) => m.to)).toEqual(["ada@example.com"]);
    expect(outbox[0]!.subject).toBe("Leaked: AWS access key in acme/api");
    expect(outbox[0]!.text).toContain("AKIA…MNOP");
    expect(outbox[0]!.text).toContain("acme/api: .env, line 3");
    expect(posts).toHaveLength(1);
    expect(await events(i.id)).toEqual(["NOTIFIED", "NOTIFIED"]);
    expect(await reload(i.id)).toMatchObject({ round: 1, nextAlertAt: later(OPEN_REMINDER_MS) });
  });

  it("signs a respond link for each recipient", async () => {
    const i = await incident();
    await runRound(deps, i.id, NOW);
    const link = /https:\S+\/respond\/\S+/.exec(outbox[0]!.text)![0];
    const url = new URL(link);
    expect(url.pathname).toBe(`/respond/${i.id}`);
    expect(url.searchParams.get("by")).toBe(`u:${owner.id}`);
    expect(verifyRespond(KEY, i.id, `u:${owner.id}`, url.searchParams.get("sig")!)).toBe(true);
  });

  it("does nothing before the round is due, or twice for the same round", async () => {
    const i = await incident();
    expect(await runRound(deps, i.id, new Date(NOW.getTime() - 1000))).toBe(false);
    const [a, b] = await Promise.all([runRound(deps, i.id, NOW), runRound(deps, i.id, NOW)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(outbox).toHaveLength(1);
  });

  it("keeps reminding every hour while nobody responds", async () => {
    const i = await incident();
    await runRound(deps, i.id, NOW);
    await runRound(deps, i.id, later(OPEN_REMINDER_MS));
    expect(outbox[1]!.subject).toBe("Nobody is on it: AWS access key in acme/api");
    expect(await events(i.id)).toEqual(["NOTIFIED", "REMINDED", "NOTIFIED"]);
    expect((await reload(i.id)).round).toBe(2);
  });

  it("reminds every four hours once acknowledged", async () => {
    const i = await incident();
    await runRound(deps, i.id, NOW);
    await prisma.incident.update({
      where: { id: i.id },
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedAt: NOW,
        acknowledgedBy: "ada@example.com",
        nextAlertAt: later(ACK_REMINDER_MS),
      },
    });
    await runRound(deps, i.id, later(ACK_REMINDER_MS));
    expect(outbox[1]!.subject).toBe("Not revoked yet: AWS access key in acme/api");
    expect(outbox[1]!.text).toContain("On it: ada@example.com");
    expect((await reload(i.id)).nextAlertAt).toEqual(later(2 * ACK_REMINDER_MS));
  });

  it("says how it ended, without a respond link, and stops", async () => {
    const i = await incident();
    await runRound(deps, i.id, NOW);
    await prisma.incident.update({
      where: { id: i.id },
      data: { status: "REVOKED", closedAt: NOW, closedBy: "ada@example.com", nextAlertAt: NOW },
    });
    expect(await runRound(deps, i.id, NOW)).toBe(true);
    expect(outbox[1]!.subject).toBe("Revoked: AWS access key in acme/api");
    expect(outbox[1]!.text).not.toContain("/respond/");
    expect(await reload(i.id)).toMatchObject({ round: 1, nextAlertAt: null });
    expect(await dueIncidents(prisma, later(10 * ACK_REMINDER_MS))).toEqual([]);
  });

  it("records a failed delivery and still reaches everyone else", async () => {
    await slackChannel("alerts");
    answer = 404;
    const i = await incident();
    await runRound(deps, i.id, NOW);
    expect(outbox).toHaveLength(1);
    expect(await events(i.id)).toEqual(["NOTIFIED", "NOT_DELIVERED"]);
    const channel = await prisma.notificationChannel.findFirstOrThrow();
    expect(channel.lastError).toMatch(/Slack/);
  });
});

describe("runRound with a policy", () => {
  it("walks the steps, then reminds everyone alerted", async () => {
    const p = await policy();
    const i = await incident({ policyId: p.id });

    await runRound(deps, i.id, NOW);
    expect(outbox.map((m) => m.to)).toEqual(["grace@example.com"]);
    expect(outbox[0]!.text).toContain("within 10 min");
    expect(posts).toHaveLength(0);
    expect((await reload(i.id)).nextAlertAt).toEqual(later(10 * 60_000));

    await runRound(deps, i.id, later(10 * 60_000));
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]!.body).text).toBe("Still open: AWS access key in acme/api");
    expect(await events(i.id)).toEqual(["NOTIFIED", "ESCALATED", "NOTIFIED"]);

    const third = later(10 * 60_000 + OPEN_REMINDER_MS);
    expect((await reload(i.id)).nextAlertAt).toEqual(third);
    await runRound(deps, i.id, third);
    expect(outbox.map((m) => m.to)).toEqual(["grace@example.com", "grace@example.com"]);
    expect(posts).toHaveLength(2);
  });

  it("doesn't escalate past someone who acknowledged", async () => {
    const p = await policy();
    const i = await incident({ policyId: p.id });
    await runRound(deps, i.id, NOW);
    await prisma.incident.update({
      where: { id: i.id },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: NOW, acknowledgedBy: "grace@example.com" },
    });
    await runRound(deps, i.id, later(10 * 60_000));
    // The reminder goes to step one only; the channel in step two never hears of it.
    expect(posts).toHaveLength(0);
    expect(outbox.map((m) => m.subject)).toEqual([
      "Leaked: AWS access key in acme/api",
      "Not revoked yet: AWS access key in acme/api",
    ]);
  });
});

describe("dueIncidents", () => {
  it("skips suspended owners until they're let back in", async () => {
    const i = await incident();
    expect(await dueIncidents(prisma, NOW)).toEqual([i.id]);
    await prisma.user.update({ where: { id: owner.id }, data: { suspendedAt: NOW } });
    expect(await dueIncidents(prisma, NOW)).toEqual([]);
  });
});
