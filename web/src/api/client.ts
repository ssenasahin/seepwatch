// The one place the web app talks to the API. It keeps the access token in memory
// (never in storage, where an injected script could read it), attaches it to every
// request, and quietly swaps an expired one for a fresh one using the refresh cookie.

export interface User {
  id: string;
  email: string;
  role: "USER" | "SUPER_ADMIN";
  twoFactorEnabled: boolean;
  createdAt: string;
}

export interface SessionBody {
  accessToken: string;
  user: User;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }

  // The first message the API gave for one form field, if any.
  fieldError(field: string): string | undefined {
    const messages = this.details?.[field];
    return Array.isArray(messages) && typeof messages[0] === "string" ? messages[0] : undefined;
  }
}

let accessToken: string | null = null;
let sessionEnded: () => void = () => {};

export function setAccessToken(token: string | null) {
  accessToken = token;
}

// Called when a refresh fails mid-use, so the app can show the sign-in screen.
export function onSessionEnded(callback: () => void) {
  sessionEnded = callback;
}

let refreshing: Promise<SessionBody | null> | null = null;

// Every caller that needs a refresh at the same moment shares one request.
export function refreshSession(): Promise<SessionBody | null> {
  refreshing ??= acrossTabs(async () => {
    const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" });
    if (!res.ok) {
      accessToken = null;
      return null;
    }
    const body = (await res.json()) as SessionBody;
    accessToken = body.accessToken;
    return body;
  }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

// Open tabs share one refresh cookie, and the API treats a token used twice as
// stolen. Holding a lock makes tabs refresh one after another, each sending the
// cookie the previous refresh just set, instead of racing with the same token.
function acrossTabs<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    // The lock API types the result as a nested promise; awaiting flattens it.
    return navigator.locks.request("seepwatch-refresh", work) as Promise<T>;
  }
  return work();
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  // Public endpoints (sign-in, sign-up, resets) never trigger a refresh.
  auth?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = options;

  const send = () =>
    fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(auth && accessToken && { Authorization: `Bearer ${accessToken}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res = await send();
  if (res.status === 401 && auth) {
    // The access token expired (they last 15 minutes): get a new one and try once more.
    if (await refreshSession()) {
      res = await send();
    } else {
      sessionEnded();
    }
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof data.error === "string" ? data.error : "Something went wrong",
      data.details as Record<string, unknown> | undefined,
    );
  }
  return data as T;
}
