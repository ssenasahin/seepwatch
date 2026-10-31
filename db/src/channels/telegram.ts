import { escapeHtml } from "../mailer.js";
import { DeliveryError, type AlertMessage, type TelegramConfig, type Transport } from "./types.js";

const DOT: Record<AlertMessage["kind"], string> = {
  down: "🔴",
  up: "🟢",
  degraded: "🟡",
  test: "👋",
};

// Telegram's HTML mode understands a handful of tags; values are escaped like email.
export function telegramText(message: AlertMessage): string {
  const lines = [
    `${DOT[message.kind]} <b>${escapeHtml(message.title)}</b>`,
    "",
    ...message.fields.map(([label, value]) => `<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`),
    ...(message.note ? ["", `<i>${escapeHtml(message.note)}</i>`] : []),
    "",
    `<a href="${escapeHtml(message.link)}">Open in Seepwatch</a>`,
    ...(message.ackLink ? [`<a href="${escapeHtml(message.ackLink)}">Acknowledge</a>`] : []),
  ];
  return lines.join("\n");
}

export async function sendTelegram(
  config: TelegramConfig,
  message: AlertMessage,
  transport: Transport,
) {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const body = JSON.stringify({
    chat_id: config.chatId,
    text: telegramText(message),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
  let res;
  try {
    res = await transport(url, body, { "content-type": "application/json" });
  } catch (err) {
    // The token is part of the URL; keep it out of anything stored or shown.
    const reason = err instanceof Error ? err.message : String(err);
    throw new DeliveryError(reason.replaceAll(config.botToken, "…"));
  }
  if (res.status >= 200 && res.status < 300) return;

  // The Bot API explains itself in JSON: {"ok":false,"description":"..."}.
  let description = "";
  try {
    description = String((JSON.parse(res.text) as { description?: string }).description ?? "");
  } catch {
    // Not JSON; the status code will have to do.
  }
  if (res.status === 401) throw new DeliveryError("Telegram rejected the bot token");
  if (/chat not found/i.test(description)) {
    throw new DeliveryError("Telegram can't find that chat. Send the bot a message first");
  }
  throw new DeliveryError(
    `Telegram answered HTTP ${res.status}${description ? `: ${description}` : ""}`,
  );
}
