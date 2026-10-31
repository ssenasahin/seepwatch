import type { Mailer, PrismaClient, User } from "@seepwatch/db";
import type { CookieOptions, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Env } from "../env.js";
import { HttpError } from "../http.js";
import { afterFailedSignIn } from "./lockout.js";
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

// Counts a failed password or code, locking the account on the fifth in a row.
// Incrementing in the database keeps the count right under concurrent attempts.
export async function recordFailedSignIn(prisma: PrismaClient, userId: string): Promise<void> {
  const { failedLogins } = await prisma.user.update({
    where: { id: userId },
    data: { failedLogins: { increment: 1 } },
    select: { failedLogins: true },
  });
  const next = afterFailedSignIn(failedLogins, new Date());
  if (next.lockedUntil) {
    await prisma.user.update({ where: { id: userId }, data: next });
  }
}

export async function clearFailedSignIns(prisma: PrismaClient, user: User): Promise<void> {
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
