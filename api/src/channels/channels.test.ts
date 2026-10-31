import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  deliveries,
  deliveryAnswer,
  makeApp,
  prisma,
  resetDatabase,
  signUp,
} from "../test/helpers.js";

afterAll(() => prisma.$disconnect());
beforeEach(resetDatabase);

async function signedIn(email?: string) {
  const app = makeApp();
  const { accessToken } = await signUp(app, email);
  const as = (req: request.Test) => req.set("Authorization", `Bearer ${accessToken}`);
  return { app, as };
}

const SLACK_URL = "https://hooks.slack.com/services/T000/B000/abcdefghijklmnop";
const BOT_TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawq";

describe("channels", () => {
  it("stores settings encrypted and never sends secrets back", async () => {
    const { app, as } = await signedIn();
    const res = await as(request(app).post("/api/channels")).send({
      type: "TELEGRAM",
      name: "On-call chat",
      settings: { botToken: BOT_TOKEN, chatId: "-1001234567890" },
    });
    expect(res.status).toBe(201);
    expect(res.body.channel).toMatchObject({
      type: "TELEGRAM",
      enabled: true,
      settings: { botToken: null, chatId: "-1001234567890" },
      lastSentAt: null,
    });
    const row = await prisma.notificationChannel.findFirstOrThrow();
    expect(row.config).toMatch(/^v1:/);
    expect(row.config).not.toContain("AAHdq");

    const list = await as(request(app).get("/api/channels"));
    expect(JSON.stringify(list.body)).not.toContain("AAHdq");
  });

  it("shows a webhook's signing secret once", async () => {
    const { app, as } = await signedIn();
    const res = await as(request(app).post("/api/channels")).send({
      type: "WEBHOOK",
      name: "Pager",
      settings: { url: "https://example.com/hooks/seepwatch" },
    });
    expect(res.status).toBe(201);
    expect(res.body.signingSecret).toMatch(/^whsec_[\w-]{32}$/);
    expect(res.body.channel.settings).toEqual({
      url: "https://example.com/hooks/seepwatch",
      secret: null,
    });
  });

  it.each([
    ["SLACK", { webhookUrl: "https://evil.example.com/services/x" }, "settings.webhookUrl"],
    ["TELEGRAM", { botToken: "nope", chatId: "-100" }, "settings.botToken"],
    ["TELEGRAM", { botToken: BOT_TOKEN, chatId: "my chat" }, "settings.chatId"],
    ["WEBHOOK", { url: "http://intranet.example.com/hook" }, "settings.url"],
    ["WEBHOOK", { url: "ftp://example.com/hook" }, "settings.url"],
  ])("refuses bad %s settings", async (type, settings, field) => {
    const { app, as } = await signedIn();
    const res = await as(request(app).post("/api/channels")).send({ type, name: "x", settings });
    expect(res.status).toBe(400);
    expect(res.body.details[field]).toBeDefined();
  });

  it("keeps a secret through an edit that leaves it out", async () => {
    const { app, as } = await signedIn();
    const created = await as(request(app).post("/api/channels")).send({
      type: "TELEGRAM",
      name: "Chat",
      settings: { botToken: BOT_TOKEN, chatId: "-100" },
    });
    const id = created.body.channel.id as string;
    const edited = await as(request(app).patch(`/api/channels/${id}`)).send({
      name: "Ops chat",
      enabled: false,
      settings: { botToken: null, chatId: "-200" },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.channel).toMatchObject({ name: "Ops chat", enabled: false });

    await as(request(app).post(`/api/channels/${id}/test`));
    expect(deliveries[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    expect(JSON.parse(deliveries[0]!.body).chat_id).toBe("-200");
  });

  it("sends a test and remembers how it went", async () => {
    const { app, as } = await signedIn();
    const created = await as(request(app).post("/api/channels")).send({
      type: "SLACK",
      name: "#alerts",
      settings: { webhookUrl: SLACK_URL },
    });
    const id = created.body.channel.id as string;

    const ok = await as(request(app).post(`/api/channels/${id}/test`));
    expect(ok.body).toMatchObject({ ok: true, error: null });
    expect(ok.body.channel.lastSentAt).not.toBeNull();
    expect(deliveries[0]!.url).toBe(SLACK_URL);
    expect(JSON.parse(deliveries[0]!.body).text).toBe("Test alert from Seepwatch");

    deliveryAnswer.status = 403;
    const failed = await as(request(app).post(`/api/channels/${id}/test`));
    expect(failed.body).toMatchObject({ ok: false, error: "Slack answered HTTP 403" });
    expect(failed.body.channel.lastError).toBe("Slack answered HTTP 403");
  });

  it("keeps channels to their owner", async () => {
    const owner = await signedIn("owner@example.com");
    const created = await owner.as(request(owner.app).post("/api/channels")).send({
      type: "SLACK",
      name: "#alerts",
      settings: { webhookUrl: SLACK_URL },
    });
    const id = created.body.channel.id as string;

    const other = await signedIn("other@example.com");
    for (const req of [
      request(other.app).patch(`/api/channels/${id}`).send({ name: "mine" }),
      request(other.app).post(`/api/channels/${id}/test`),
      request(other.app).delete(`/api/channels/${id}`),
    ]) {
      expect((await other.as(req)).status).toBe(404);
    }
    expect((await other.as(request(other.app).get("/api/channels"))).body.channels).toEqual([]);
    expect(deliveries).toHaveLength(0);
  });
});
