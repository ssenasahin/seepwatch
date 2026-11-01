import type { ChannelType } from "../generated/prisma/client.js";
import type { RoundKind } from "../incidents.js";

// What every channel is told, whatever it looks like once it arrives.
export interface AlertMessage {
  // Which round of an incident this is, or a test of the channel.
  kind: RoundKind | "test";
  // One line that works as a push notification on its own: "Leaked: AWS access key".
  title: string;
  // The secret, masked, and what kind it is. Null for a test.
  finding: { id: string; detector: string; label: string; masked: string } | null;
  // Label and value pairs: where it was found, since when, who's on it.
  fields: [string, string][];
  // A sentence of context under the fields, if there's something to add.
  note: string | null;
  // The incident in the dashboard.
  link: string;
  // A signed link to a page with "I'm on it" and "Revoked", while the leak is open.
  respondLink: string | null;
  incidentId: string | null;
  at: Date;
}

export interface SlackConfig {
  webhookUrl: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface WebhookConfig {
  url: string;
  // Signs each delivery, so the receiver can tell it came from Seepwatch.
  secret: string;
}

export type ChannelConfig = SlackConfig | TelegramConfig | WebhookConfig;

export interface ConfigOf {
  SLACK: SlackConfig;
  TELEGRAM: TelegramConfig;
  WEBHOOK: WebhookConfig;
}

// The settings that are secret, per type: never sent back to the browser.
export const SECRET_FIELDS: { [T in ChannelType]: (keyof ConfigOf[T])[] } = {
  SLACK: ["webhookUrl"],
  TELEGRAM: ["botToken"],
  WEBHOOK: ["secret"],
};

// One HTTP POST. Swappable so tests can see what would be sent without sending it.
export type Transport = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<{ status: number; text: string }>;

// A delivery that failed, with a reason fit to show in the dashboard.
export class DeliveryError extends Error {}
