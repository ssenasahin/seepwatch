import type { Mailer, PrismaClient, User } from "@seepwatch/db";
import type { CookieOptions, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Env } from "../env.js";
import { HttpError } from "../http.js";
import {
  ACCOUNT_FAILURE_LIMIT,
  afterFailedSignIn,
  CODE_FAILURE_WEIGHT,
  isLocked,
  MAX_FAILED_SIGN_INS,
} from "./lockout.js";
import { createSession, type ClientInfo } from "./sessions.js";
import { signAccessToken } from "./tokens.js";

export interface AuthDeps {
  env: Env;
  prisma: PrismaClient;
  mailer: Mailer;
  encryptionKey: Buffer;
}

export const REFRESH_COOKIE = "seepwatch_refresh";

// One message for every sign-in failure, so it never reveals whether an account exists.
export const INVALID_CREDENTIALS = "Invalid email or password";

// Normalise first, then validate: pasted addresses often carry stray spaces.
export const emailField = z.string().trim().toLowerCase().pipe(z.email().max(254));

// The refresh cookie is only ever sent to /api/auth, never to the rest of the API,
// and never from another site (SameSite=Strict) or to page scripts (HttpOnly).
export function refreshCookieOptions(expires?: Date): CookieOptions {
  return { httpOnly: true, secure: true, sameSite: "strict", path: "/api/auth", expires };
}

export function authLimiter(perMinute: number) {
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "Too many attempts. Wait a minute and try again." });
    },
  });
}

export function clientOf(req: Request): ClientInfo {
  return { ip: req.ip, userAgent: req.get("user-agent") };
}

export const SUSPENDED = "This account is suspended. Contact your Seepwatch administrator.";

// Creates a session, sets its refresh cookie and returns the response body.
export async function issueSession(
  { env, prisma }: AuthDeps,
  req: Request,
  res: Response,
  user: User,
  mfa: boolean,
) {
  // Every way in passes through here, so a suspended account can't slip past.
  if (user.suspendedAt) throw new HttpError(403, SUSPENDED);
  const { session, refreshToken } = await createSession(prisma, user.id, clientOf(req), mfa);
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(session.expiresAt));
  const accessToken = await signAccessToken(
    { userId: user.id, sessionId: session.id, role: user.role, mfa },
    env.JWT_SECRET,
  );
  return { accessToken, user: publicUser(user) };
}

// req.ip is undefined only for a socket already gone; those share one bucket.
const addressOf = (ip: string | undefined) => ip ?? "unknown";

// Locked for this address, or as a whole.
export async function signInLocked(
  prisma: PrismaClient,
  user: User,
  ip: string | undefined,
  now = new Date(),
): Promise<boolean> {
  if (isLocked(user.lockedUntil, now)) return true;
  const throttle = await prisma.signInThrottle.findUnique({
    where: { userId_ip: { userId: user.id, ip: addressOf(ip) } },
  });
  return isLocked(throttle?.lockedUntil ?? null, now);
}

// A wrong password: locks this address out of the account on its fifth, and counts
// toward the account's own, much higher, limit. Incrementing in the database keeps
// the counts right under concurrent attempts.
export async function recordFailedPassword(
  prisma: PrismaClient,
  userId: string,
  ip: string | undefined,
): Promise<void> {
  const where = { userId_ip: { userId, ip: addressOf(ip) } };
  const { failures } = await prisma.signInThrottle.upsert({
    where,
    create: { userId, ip: addressOf(ip), failures: 1 },
    update: { failures: { increment: 1 } },
  });
  const next = afterFailedSignIn(failures, new Date(), MAX_FAILED_SIGN_INS);
  if (next.lockedUntil) await prisma.signInThrottle.update({ where, data: next });
  await countAgainstAccount(prisma, userId, 1);
}

// A wrong two-factor code or backup code.
export async function recordFailedCode(prisma: PrismaClient, userId: string): Promise<void> {
  await countAgainstAccount(prisma, userId, CODE_FAILURE_WEIGHT);
}

async function countAgainstAccount(prisma: PrismaClient, userId: string, by: number) {
  const { failedLogins } = await prisma.user.update({
    where: { id: userId },
    data: { failedLogins: { increment: by } },
    select: { failedLogins: true },
  });
  const next = afterFailedSignIn(failedLogins, new Date(), ACCOUNT_FAILURE_LIMIT);
  if (next.lockedUntil) {
    await prisma.user.update({
      where: { id: userId },
      data: { failedLogins: next.failures, lockedUntil: next.lockedUntil },
    });
  }
}

// After a sign-in that worked: this address starts clean, and so does the account.
// Other addresses keep their locks; the owner signing in says nothing about them.
export async function clearFailedSignIns(
  prisma: PrismaClient,
  user: User,
  ip: string | undefined,
): Promise<void> {
  await prisma.signInThrottle.deleteMany({ where: { userId: user.id, ip: addressOf(ip) } });
  if (user.failedLogins > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });
  }
}

// The only user fields that ever leave the API.
export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    twoFactorEnabled: user.totpEnabledAt !== null,
    createdAt: user.createdAt,
  };
}
