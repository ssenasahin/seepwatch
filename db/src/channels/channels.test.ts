import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deliver, sealConfig } from "./deliver.js";
import { slackPayload } from "./slack.js";
import { telegramText } from "./telegram.js";
import { guardedTransport } from "./transport.js";
import { DeliveryError, type AlertMessage, type Transport } from "./types.js";
import { signWebhook, webhookBody } from "./webhook.js";

const key = Buffer.alloc(32, 7);

const down: AlertMessage = {
  kind: "down",
  title: "Down: Orders <API>",
  monitor: { id: "m1", name: "Orders <API>", target: "https://api.example.com" },
  fields: [
    ["Cause", "HTTP 503 & worse"],
    ["Since", "2026-10-27 14:00 UTC"],
  ],
  note: null,
  link: "https://app.seepwatch.dev/incidents/i1",
  ackLink: "https://app.seepwatch.dev/ack/i1?by=u1&sig=abc",
  incidentId: "i1",
  at: new Date("2026-10-27T14:00:00Z"),
};

// Records what would be posted, and answers as told.
function recording(answer = { status: 200, text: "ok" }) {
  const sent: { url: string; body: string; headers: Record<string, string> }[] = [];
  const transport: Transport = async (url, body, headers) => {
    sent.push({ url, body, headers });
    return answer;
  };
  return { sent, transport };
}

describe("Slack", () => {
  it("escapes what users typed, and offers to acknowledge", () => {
    const payload = JSON.stringify(slackPayload(down));
    expect(payload).toContain("Orders &lt;API&gt;");
    expect(payload).toContain("HTTP 503 &amp; worse");
    expect(payload).toContain("Acknowledge");
  });

  it("posts to the webhook URL", async () => {
    const { sent, transport } = recording();
    const channel = {
      type: "SLACK" as const,
      config: sealConfig({ webhookUrl: "https://hooks.slack.com/services/T/B/x" }, key),
    };
    await deliver(channel, down, key, { transport });
    expect(sent[0]!.url).toBe("https://hooks.slack.com/services/T/B/x");
    expect(JSON.parse(sent[0]!.body).text).toBe("Down: Orders <API>");
  });

  it("says when the webhook is gone", async () => {
    const { transport } = recording({ status: 404, text: "no_service" });
    const channel = {
      type: "SLACK" as const,
      config: sealConfig({ webhookUrl: "https://hooks.slack.com/x" }, key),
    };
    await expect(deliver(channel, down, key, { transport })).rejects.toThrow(/removed/);
  });
});

describe("Telegram", () => {
  it("writes escaped HTML", () => {
    const text = telegramText(down);
    expect(text).toContain("<b>Down: Orders &lt;API&gt;</b>");
    expect(text).toContain(
      '<a href="https://app.seepwatch.dev/ack/i1?by=u1&amp;sig=abc">Acknowledge</a>',
    );
  });

  it("explains a chat the bot can't reach", async () => {
    const { sent, transport } = recording({
      status: 400,
      text: '{"ok":false,"description":"Bad Request: chat not found"}',
    });
    const channel = {
      type: "TELEGRAM" as const,
      config: sealConfig({ botToken: "123:abc", chatId: "-100" }, key),
    };
    await expect(deliver(channel, down, key, { transport })).rejects.toThrow(
      /Send the bot a message/,
    );
    expect(sent[0]!.url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(JSON.parse(sent[0]!.body)).toMatchObject({ chat_id: "-100", parse_mode: "HTML" });
  });

  it("keeps the token out of connection errors", async () => {
    const transport: Transport = async (url) => {
      throw new Error(`connect failed for ${url}`);
    };
    const channel = {
      type: "TELEGRAM" as const,
      config: sealConfig({ botToken: "123:secret", chatId: "1" }, key),
    };
    const error = await deliver(channel, down, key, { transport }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(DeliveryError);
    expect((error as Error).message).not.toContain("123:secret");
  });
});

describe("webhooks", () => {
  const channel = {
    type: "WEBHOOK" as const,
    config: sealConfig({ url: "https://hooks.example.com/in", secret: "whsec" }, key),
  };

  it("signs the timestamp and the body", async () => {
    const { sent, transport } = recording();
    await deliver(channel, down, key, { transport });
    const { body, headers } = sent[0]!;
    const timestamp = headers["x-seepwatch-timestamp"]!;
    expect(headers["x-seepwatch-signature"]).toBe(signWebhook("whsec", timestamp, body));
    expect(JSON.parse(body)).toEqual(JSON.parse(JSON.stringify(webhookBody(down))));
    expect(JSON.parse(body)).toMatchObject({
      event: "monitor.down",
      details: { Cause: "HTTP 503 & worse" },
    });
  });

  it("tries three times, waiting longer each time", async () => {
    const { sent, transport } = recording({ status: 500, text: "" });
    const waits: number[] = [];
    const wait = async (ms: number) => void waits.push(ms);
    await expect(deliver(channel, down, key, { transport, wait })).rejects.toThrow(
      "Failed after 3 tries: HTTP 500",
    );
    expect(sent).toHaveLength(3);
    expect(waits).toEqual([1000, 2000]);
  });

  it("stops trying once one gets through", async () => {
    let calls = 0;
    const transport: Transport = async () => ({ status: ++calls < 2 ? 502 : 204, text: "" });
    await deliver(channel, down, key, { transport, wait: async () => {} });
    expect(calls).toBe(2);
  });
});

describe("guardedTransport", () => {
  let server: Server;
  let port: number;
  let seen: { headers: IncomingHttpHeaders; body: string } | null = null;
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen = { headers: req.headers, body };
        res.writeHead(req.url === "/redirect" ? 302 : 200, { location: "http://169.254.169.254/" });
        res.end("fine");
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  it("posts through the guard's chosen address", async () => {
    const transport = guardedTransport(async () => ["127.0.0.1"]);
    const res = await transport(`http://hooks.example.com:${port}/in`, '{"a":1}', {
      "x-test": "1",
    });
    expect(res).toEqual({ status: 200, text: "fine" });
    expect(seen).toMatchObject({ body: '{"a":1}', headers: { "x-test": "1" } });
  });

  it("doesn't follow redirects", async () => {
    const transport = guardedTransport(async () => ["127.0.0.1"]);
    const res = await transport(`http://hooks.example.com:${port}/redirect`, "{}", {});
    expect(res.status).toBe(302);
  });

  it("refuses private addresses", async () => {
    const transport = guardedTransport();
    await expect(transport("http://127.0.0.1:9/in", "{}", {})).rejects.toThrow(
      /private or reserved/,
    );
  });
});
