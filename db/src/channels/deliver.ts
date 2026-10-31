import type { ChannelType } from "../generated/prisma/client.js";
import { decryptSecret, encryptSecret } from "../crypto.js";
import { sendSlack } from "./slack.js";
import { sendTelegram } from "./telegram.js";
import { guardedTransport } from "./transport.js";
import type {
  AlertMessage,
  ConfigOf,
  SlackConfig,
  TelegramConfig,
  Transport,
  WebhookConfig,
} from "./types.js";
import { sendWebhook } from "./webhook.js";

// A channel's settings are stored encrypted as a whole: they hold tokens and secrets.
export function sealConfig(config: ConfigOf[ChannelType], key: Buffer): string {
  return encryptSecret(JSON.stringify(config), key);
}

export function openConfig<T extends ChannelType>(sealed: string, key: Buffer): ConfigOf[T] {
  return JSON.parse(decryptSecret(sealed, key)) as ConfigOf[T];
}

export interface DeliverOptions {
  transport?: Transport;
  // How long the webhook adapter waits between tries; tests make it instant.
  wait?: (ms: number) => Promise<void>;
}

// Every channel type behind one call: the caller doesn't care how Slack differs
// from a webhook. Throws DeliveryError with a reason to show if it didn't arrive.
export async function deliver(
  channel: { type: ChannelType; config: string },
  message: AlertMessage,
  key: Buffer,
  { transport = guardedTransport(), wait }: DeliverOptions = {},
): Promise<void> {
  const config = openConfig(channel.config, key);
  switch (channel.type) {
    case "SLACK":
      return sendSlack(config as SlackConfig, message, transport);
    case "TELEGRAM":
      return sendTelegram(config as TelegramConfig, message, transport);
    case "WEBHOOK":
      return sendWebhook(config as WebhookConfig, message, transport, wait);
  }
}
