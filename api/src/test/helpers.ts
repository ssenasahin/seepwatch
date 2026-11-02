import {
  createPrisma,
  type FetchGithubFile,
  type Mail,
  type Mailer,
  type ResolveTxt,
  type Transport,
} from "@seepwatch/db";
import { generate } from "otplib";
import request, { type Response } from "supertest";
import { createApp } from "../app.js";
import type { SystemProbe } from "../admin/system.js";
import type { Env } from "../env.js";
import { TEST_DATABASE_URL } from "./database.js";

export const testEnv: Env = {
  NODE_ENV: "test",
  API_PORT: 0,
  DATABASE_URL: TEST_DATABASE_URL,
  WEB_ORIGIN: "http://localhost:5173",
  REDIS_URL: "redis://127.0.0.1:6379",
  JWT_SECRET: "test-secret-that-is-at-least-thirty-two-characters",
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: 1025,
  MAIL_FROM: "Seepwatch <test@seepwatch.local>",
  TRUST_PROXY: 0,
  AUTH_RATE_LIMIT_PER_MINUTE: 1000,
  GITHUB_TOKEN: undefined,
};

export const prisma = createPrisma(TEST_DATABASE_URL);

// Collects outgoing email instead of sending it.
export const outbox: Mail[] = [];
const memoryMailer: Mailer = {
  async send(mail) {
    outbox.push(mail);
  },
};

// Every table hangs off users, so truncating it with CASCADE empties them all.
export async function resetDatabase(): Promise<void> {
  outbox.length = 0;
  deliveries.length = 0;
  for (const name of Object.keys(txtRecords)) delete txtRecords[name];
  for (const path of Object.keys(githubFiles)) delete githubFiles[path];
  deliveryAnswer.status = 200;
  await prisma.$executeRawUnsafe("TRUNCATE TABLE users, pending_signups CASCADE");
}

// Alerts to Slack, Telegram and webhooks, caught on the way out. Tests set the answer.
export const deliveries: { url: string; body: string; headers: Record<string, string> }[] = [];
export const deliveryAnswer = { status: 200 };
const memoryTransport: Transport = async (url, body, headers) => {
  deliveries.push({ url, body, headers });
  return { status: deliveryAnswer.status, text: deliveryAnswer.status === 200 ? "ok" : "" };
};

// Fake DNS for the SSRF tests. Any name not listed here doesn't exist.
export const dnsRecords: Record<string, string[]> = {
  "example.com": ["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"],
  "status.example.org": ["203.0.114.10"],
  "api.example.com": ["93.184.215.20"],
  "intranet.example.com": ["10.0.0.12"],
  "sneaky.example.com": ["93.184.215.14", "127.0.0.1"],
  localhost: ["127.0.0.1", "::1"],
};

async function fakeResolve(hostname: string): Promise<string[]> {
  const addresses = dnsRecords[hostname];
  if (!addresses)
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
  return addresses;
}

// Fake TXT records for domain verification, by name. A missing name doesn't exist.
export const txtRecords: Record<string, string[][]> = {};
const fakeResolveTxt: ResolveTxt = async (name) => {
  const records = txtRecords[name];
  if (!records) throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: "ENOTFOUND" });
  return records;
};

// Fake files in organizations' .github repositories, keyed "org/path".
export const githubFiles: Record<string, string> = {};
const fakeGithubFile: FetchGithubFile = async (org, path) => githubFiles[`${org}/${path}`] ?? null;

export function makeApp(env: Partial<Env> = {}, system?: SystemProbe) {
  return createApp({
    env: { ...testEnv, ...env },
    prisma,
    mailer: memoryMailer,
    resolveHost: fakeResolve,
    channelTransport: memoryTransport,
    resolveTxt: fakeResolveTxt,
    fetchGithubFile: fakeGithubFile,
    system,
  });
}

// Pulls the refresh cookie out of a response, as a browser would store it.
export function refreshCookie(res: Response): string | undefined {
  const header = res.headers["set-cookie"] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith("seepwatch_refresh="));
}

export function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0]!;
}

export const GOOD_PASSWORD = "amber-lantern-over-the-harbour";

// The token in the last sign-up link mailed to `email`.
export function signupToken(email: string): string {
  const mail = outbox.findLast((m) => m.to === email && m.text.includes("/verify-email?token="));
  if (!mail) throw new Error(`No sign-up link was mailed to ${email}`);
  return /verify-email\?token=([\w-]+)/.exec(mail.text)![1]!;
}

// Signs up and follows the emailed link, as a new user would.
export async function signUp(app: ReturnType<typeof makeApp>, email = "ada@example.com") {
  const registered = await request(app)
    .post("/api/auth/register")
    .send({ email, password: GOOD_PASSWORD });
  if (registered.status !== 202) throw new Error(`Sign-up answered ${registered.status}`);
  // The email goes out without being awaited.
  await new Promise((done) => setImmediate(done));
  const res = await request(app)
    .post("/api/auth/verify-email")
    .send({ token: signupToken(email.trim().toLowerCase()) });
  if (res.status !== 201) throw new Error(`Verifying answered ${res.status}`);
  return { accessToken: res.body.accessToken as string, cookie: cookiePair(refreshCookie(res)!) };
}

// Turns two-factor on for a signed-in user and returns what the app would hold.
export async function enableTwoFactor(app: ReturnType<typeof makeApp>, accessToken: string) {
  const setup = await request(app)
    .post("/api/auth/2fa/setup")
    .set("Authorization", `Bearer ${accessToken}`);
  const secret = setup.body.secret as string;
  const verified = await request(app)
    .post("/api/auth/2fa/verify")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ code: await generate({ secret }), password: GOOD_PASSWORD });
  return {
    secret,
    backupCodes: verified.body.backupCodes as string[],
    accessToken: verified.body.accessToken as string,
  };
}

// A valid code for the next 30-second step, which the last-used-step rule accepts.
export function nextCode(secret: string) {
  return generate({ secret, epoch: Math.floor(Date.now() / 1000) + 30 });
}
