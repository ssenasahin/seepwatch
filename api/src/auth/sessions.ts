import type { PrismaClient } from "@seepwatch/db";
import {
  formatRefreshToken,
  hashesMatch,
  newRefreshSecret,
  REFRESH_TOKEN_TTL_MS,
  sha256,
} from "./tokens.js";

export interface ClientInfo {
  ip: string | undefined;
  userAgent: string | undefined;
}

export async function createSession(
  prisma: PrismaClient,
  userId: string,
  client: ClientInfo,
  mfa: boolean,
) {
  const { secret, hash } = newRefreshSecret();
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hash,
      mfa,
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, 512),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  return { session, refreshToken: formatRefreshToken(session.id, secret) };
}

export type RotateResult =
  | {
      kind: "rotated";
      session: Awaited<ReturnType<typeof createSession>>["session"];
      refreshToken: string;
    }
  | { kind: "invalid" }
  | { kind: "reused"; userId: string };

// Swaps the session's refresh secret for a new one. Presenting the secret that was
// just rotated away means two parties hold this session's token: one of them stole
// it. We cannot tell which, so every session of that user is ended. Any other wrong
// secret is only refused: knowing a session's id (it's in the access token) must not
// be enough to sign someone out everywhere.
export async function rotateSession(
  prisma: PrismaClient,
  sessionId: string,
  secret: string,
  client: ClientInfo,
): Promise<RotateResult> {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return { kind: "invalid" };
  }

  const presentedHash = sha256(secret);
  if (!hashesMatch(presentedHash, session.refreshTokenHash)) {
    if (session.previousTokenHash && hashesMatch(presentedHash, session.previousTokenHash)) {
      await revokeAllSessions(prisma, session.userId);
      return { kind: "reused", userId: session.userId };
    }
    return { kind: "invalid" };
  }

  const next = newRefreshSecret();
  // Matching on the old hash makes the swap atomic: if two requests race with the
  // same token, only one wins and the other is treated as invalid.
  const { count } = await prisma.session.updateMany({
    where: { id: sessionId, refreshTokenHash: presentedHash, revokedAt: null },
    data: {
      refreshTokenHash: next.hash,
      previousTokenHash: presentedHash,
      lastUsedAt: new Date(),
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, 512),
    },
  });
  if (count === 0) return { kind: "invalid" };

  const updated = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
  return {
    kind: "rotated",
    session: updated,
    refreshToken: formatRefreshToken(sessionId, next.secret),
  };
}

export async function revokeSession(prisma: PrismaClient, sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
