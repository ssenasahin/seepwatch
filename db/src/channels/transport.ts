import { Agent, request } from "undici";
import {
  guardedLookup,
  resolvePublicHost,
  UnsafeTargetError,
  USER_AGENT,
  type Resolve,
} from "../network.js";
import { DeliveryError, type Transport } from "./types.js";

const TIMEOUT_MS = 10_000;
// Enough of an error page to explain itself, not enough to store someone's HTML.
const MAX_TEXT = 2_000;

// Posts through the SSRF guard: a webhook URL is whatever its owner typed, and must
// not be a way to reach our own network. Redirects aren't followed, for the same
// reason, and the guard runs inside the connection's DNS lookup too, so the address
// connected to is the one that was checked.
export function guardedTransport(resolve: Resolve = (host) => resolvePublicHost(host)): Transport {
  return async (url, body, headers) => {
    const agent = new Agent({ connect: { lookup: guardedLookup(resolve) } });
    try {
      await resolve(new URL(url).hostname);
      const res = await request(url, {
        method: "POST",
        body,
        headers: { "user-agent": USER_AGENT, ...headers },
        dispatcher: agent,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = (await res.body.text()).slice(0, MAX_TEXT);
      return { status: res.statusCode, text };
    } catch (err) {
      throw new DeliveryError(describe(err));
    } finally {
      void agent.destroy();
    }
  };
}

function describe(err: unknown): string {
  if (err instanceof UnsafeTargetError) return err.message;
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return `No answer within ${TIMEOUT_MS / 1000} s`;
  }
  const code =
    (err as { cause?: { code?: string }; code?: string }).cause?.code ??
    (err as { code?: string }).code;
  if (code === "ENOTFOUND") return "Host not found";
  if (code === "ECONNREFUSED") return "Connection refused";
  return `Couldn't connect: ${err instanceof Error ? err.message : String(err)}`;
}
