import {
  deliver,
  DeliveryError,
  openConfig,
  sealConfig,
  SECRET_FIELDS,
  type AlertMessage,
  type ChannelType,
  type ConfigOf,
  type NotificationChannel,
  type PrismaClient,
  type ResolveHost,
  type Transport,
} from "@seepwatch/db";
import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { authOf } from "../auth/middleware.js";
import { HttpError, validate } from "../http.js";
import { assertRoomFor } from "../plans.js";
import { checkWebhookUrl } from "./webhook-url.js";

// A secret left out (null) on an edit keeps the stored one, as with API headers.
const keep = z.string().trim().nullable().optional();

const slack = z.object({
  webhookUrl: keep.refine(
    (v) => v == null || /^https:\/\/hooks\.slack(-gov)?\.com\/services\/\S+$/.test(v),
    "Paste the Incoming Webhook URL Slack gave you: https://hooks.slack.com/services/…",
  ),
});
const telegram = z.object({
  // The token BotFather hands out: digits, a colon, then 35 or so characters.
  botToken: keep.refine(
    (v) => v == null || /^\d{5,}:[\w-]{30,}$/.test(v),
    "That doesn't look like a bot token from @BotFather",
  ),
  chatId: z
    .string()
    .trim()
    .regex(/^(-?\d{1,20}|@\w{5,32})$/, "A numeric chat id like -1001234567890, or @channelname"),
});
const webhook = z.object({
  url: z.string().trim().min(1, "Enter the URL to post to").max(2048),
});

const SETTINGS = { SLACK: slack, TELEGRAM: telegram, WEBHOOK: webhook };

const name = z.string().trim().min(1, "Give the channel a name").max(100);
const createSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SLACK"), name, settings: slack }),
  z.object({ type: z.literal("TELEGRAM"), name, settings: telegram }),
  z.object({ type: z.literal("WEBHOOK"), name, settings: webhook }),
]);
const updateSchema = z.object({
  name: name.optional(),
  enabled: z.boolean().optional(),
  // Checked against the channel's own type once it's loaded.
  settings: z.record(z.string(), z.unknown()).optional(),
});
const idParams = z.object({ id: z.uuid() });

export interface ChannelDeps {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  encryptionKey: Buffer;
  // Where the test message's link points.
  webOrigin: string;
  resolveHost?: ResolveHost;
  // How deliveries leave; tests catch them instead.
  transport?: Transport;
}

export function channelRouter({
  prisma,
  authenticate,
  encryptionKey,
  webOrigin,
  resolveHost,
  transport,
}: ChannelDeps) {
  const router = Router();
  router.use(authenticate);

  // Each test is a real message to someone's Slack or server.
  const testLimit = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => authOf(req).userId,
    message: { error: "That's a lot of test messages. Wait a minute and try again." },
  });

  // The channel as the browser sees it: settings without their secrets.
  function present(channel: NotificationChannel) {
    const config = openConfig(channel.config, encryptionKey) as unknown as Record<string, string>;
    const secret = SECRET_FIELDS[channel.type] as string[];
    const settings = Object.fromEntries(
      Object.entries(config).map(([k, v]) => [k, secret.includes(k) ? null : v]),
    );
    return {
      id: channel.id,
      type: channel.type,
      name: channel.name,
      enabled: channel.enabled,
      settings,
      lastSentAt: channel.lastSentAt,
      lastError: channel.lastError,
      createdAt: channel.createdAt,
    };
  }

  async function findOwned(id: string, ownerId: string) {
    const channel = await prisma.notificationChannel.findFirst({ where: { id, ownerId } });
    if (!channel) throw new HttpError(404, "Channel not found");
    return channel;
  }

  // Merges what was sent with what's stored, and checks the result is complete.
  async function settle<T extends ChannelType>(
    type: T,
    given: Record<string, unknown>,
    stored: Partial<ConfigOf[T]> = {},
  ): Promise<ConfigOf[T]> {
    const merged: Record<string, unknown> = { ...stored };
    for (const [k, v] of Object.entries(given)) if (v != null) merged[k] = v;
    for (const field of SECRET_FIELDS[type] as string[]) {
      if (type === "WEBHOOK") continue;
      if (!merged[field]) throw fieldError(field, "Enter a value");
    }
    if (type === "WEBHOOK") {
      merged.url = await checkWebhookUrl(String(merged.url), resolveHost);
      // The signing secret is ours to make, once; the owner copies it to their receiver.
      merged.secret ??= `whsec_${randomBytes(24).toString("base64url")}`;
    }
    return merged as unknown as ConfigOf[T];
  }

  router.get("/", async (req, res) => {
    const { userId } = authOf(req);
    const channels = await prisma.notificationChannel.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "asc" },
    });
    res.json({ channels: channels.map(present) });
  });

  router.post("/", async (req, res) => {
    const { userId } = authOf(req);
    const input = validate(createSchema, req.body);
    await assertRoomFor(prisma, userId, "channels");
    const config = await settle(input.type, input.settings);
    const channel = await prisma.notificationChannel.create({
      data: {
        ownerId: userId,
        type: input.type,
        name: input.name,
        config: sealConfig(config, encryptionKey),
      },
    });
    // The only time a webhook's signing secret leaves the server.
    const signingSecret =
      input.type === "WEBHOOK" ? (config as ConfigOf["WEBHOOK"]).secret : undefined;
    res.status(201).json({ channel: present(channel), signingSecret });
  });

  router.patch("/:id", async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const input = validate(updateSchema, req.body);
    const current = await findOwned(id, userId);

    let config: string | undefined;
    if (input.settings) {
      // Wrapped, so problems are keyed "settings.chatId" like on create.
      const { settings: given } = validate(z.object({ settings: SETTINGS[current.type] }), input);
      const stored = openConfig(current.config, encryptionKey);
      config = sealConfig(await settle(current.type, given, stored), encryptionKey);
    }
    const channel = await prisma.notificationChannel.update({
      where: { id },
      data: { name: input.name, enabled: input.enabled, config },
    });
    res.json({ channel: present(channel) });
  });

  router.delete("/:id", async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const { count } = await prisma.notificationChannel.deleteMany({
      where: { id, ownerId: userId },
    });
    if (count === 0) throw new HttpError(404, "Channel not found");
    res.status(204).end();
  });

  // Sends a harmless message and reports whether it arrived, so a typo in a token
  // shows up now rather than during an outage.
  router.post("/:id/test", testLimit, async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const channel = await findOwned(id, userId);
    const message: AlertMessage = {
      kind: "test",
      title: "Test alert from Seepwatch",
      finding: null,
      fields: [["Channel", channel.name]],
      note: "If you can read this, Seepwatch's alerts will reach you here.",
      link: `${webOrigin}/channels`,
      respondLink: null,
      incidentId: null,
      at: new Date(),
    };

    let error: string | null = null;
    try {
      await deliver(channel, message, encryptionKey, { transport });
    } catch (err) {
      if (!(err instanceof DeliveryError)) throw err;
      error = err.message;
    }
    const updated = await prisma.notificationChannel.update({
      where: { id },
      data: { lastSentAt: new Date(), lastError: error },
    });
    res.json({ ok: error === null, error, channel: present(updated) });
  });

  return router;
}

function fieldError(field: string, message: string) {
  return new HttpError(400, "Invalid request", { [`settings.${field}`]: [message] });
}
