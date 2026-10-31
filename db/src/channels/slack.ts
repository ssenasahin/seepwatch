import { DeliveryError, type AlertMessage, type SlackConfig, type Transport } from "./types.js";

const EMOJI: Record<AlertMessage["kind"], string> = {
  down: ":red_circle:",
  up: ":large_green_circle:",
  degraded: ":large_yellow_circle:",
  test: ":wave:",
};

// Slack's mrkdwn treats these three as markup; everything else is shown as typed.
export function escapeSlack(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// A Block Kit message: the title, the fields side by side, then buttons.
export function slackPayload(message: AlertMessage) {
  const buttons = [
    { type: "button", text: { type: "plain_text", text: "Open in Seepwatch" }, url: message.link },
    ...(message.ackLink
      ? [
          {
            type: "button",
            style: "primary",
            text: { type: "plain_text", text: "Acknowledge" },
            url: message.ackLink,
          },
        ]
      : []),
  ];
  return {
    // Shown in notifications and by clients that can't draw blocks.
    text: message.title,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `${EMOJI[message.kind]} *${escapeSlack(message.title)}*` },
      },
      ...(message.fields.length > 0
        ? [
            {
              type: "section",
              fields: message.fields.map(([label, value]) => ({
                type: "mrkdwn",
                text: `*${escapeSlack(label)}*\n${escapeSlack(value)}`,
              })),
            },
          ]
        : []),
      ...(message.note
        ? [{ type: "context", elements: [{ type: "mrkdwn", text: escapeSlack(message.note) }] }]
        : []),
      { type: "actions", elements: buttons },
    ],
  };
}

// Posts to an Incoming Webhook, which answers a plain "ok" or a short error code.
export async function sendSlack(config: SlackConfig, message: AlertMessage, transport: Transport) {
  const res = await transport(config.webhookUrl, JSON.stringify(slackPayload(message)), {
    "content-type": "application/json",
  });
  if (res.status === 404 || res.text === "no_service") {
    throw new DeliveryError("Slack doesn't know this webhook. It may have been removed");
  }
  if (res.status < 200 || res.status >= 300) {
    throw new DeliveryError(`Slack answered HTTP ${res.status}${res.text ? `: ${res.text}` : ""}`);
  }
}
