import { createHmac } from "node:crypto";
import { DeliveryError, type AlertMessage, type Transport, type WebhookConfig } from "./types.js";

export const SIGNATURE_HEADER = "x-seepwatch-signature";
export const TIMESTAMP_HEADER = "x-seepwatch-timestamp";

// Three tries in all, waiting longer after each failure.
const ATTEMPTS = 3;
const FIRST_WAIT_MS = 1_000;

// The body a receiver gets: the event and the facts, with no presentation.
export function webhookBody(message: AlertMessage) {
  return {
    // "leak.new", "leak.escalated", "leak.unacknowledged", "leak.acknowledged",
    // "leak.closed", or "test".
    event: message.kind === "test" ? "test" : `leak.${message.kind}`,
    title: message.title,
    // Masked: the secret itself never leaves Seepwatch, because Seepwatch never has it.
    finding: message.finding,
    incidentId: message.incidentId,
    details: Object.fromEntries(message.fields),
    link: message.link,
    respondLink: message.respondLink,
    sentAt: message.at.toISOString(),
  };
}

// HMAC-SHA256 over "timestamp.body". The timestamp is signed too, so a captured
// delivery can't be replayed later with a fresh one; receivers should reject old ones.
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export async function sendWebhook(
  config: WebhookConfig,
  message: AlertMessage,
  transport: Transport,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  const body = JSON.stringify(webhookBody(message));
  let problem = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    // Signed afresh each try: the timestamp says when this attempt was sent.
    const timestamp = String(Math.floor(Date.now() / 1000));
    try {
      const res = await transport(config.url, body, {
        "content-type": "application/json",
        [TIMESTAMP_HEADER]: timestamp,
        [SIGNATURE_HEADER]: signWebhook(config.secret, timestamp, body),
      });
      if (res.status >= 200 && res.status < 300) return;
      problem = `HTTP ${res.status}`;
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
    if (attempt < ATTEMPTS) await wait(FIRST_WAIT_MS * 2 ** (attempt - 1));
  }
  throw new DeliveryError(`Failed after ${ATTEMPTS} tries: ${problem}`);
}
