import { resolvePublicHost, UnsafeTargetError, type ResolveHost } from "@seepwatch/db";
import { HttpError } from "../http.js";

// Parses a webhook URL and refuses anything that isn't on the public internet, so a
// channel can't be pointed at the server's own network. Returns the URL to store.
export async function checkWebhookUrl(target: string, resolve?: ResolveHost): Promise<string> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw urlError("Enter a full URL, starting with https://");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw urlError("Only http:// and https:// URLs can receive webhooks");
  }
  // Credentials in a URL would be stored with the rest of the config and shown back.
  if (url.username || url.password) {
    throw urlError("Remove the user name and password from the URL");
  }
  // The URL parser already turns tricks like http://2130706433 into 127.0.0.1.
  try {
    await resolvePublicHost(url.hostname, resolve);
  } catch (err) {
    if (err instanceof UnsafeTargetError) throw urlError(err.message);
    throw err;
  }
  return url.href;
}

function urlError(message: string) {
  return new HttpError(400, "Invalid request", { "settings.url": [message] });
}
