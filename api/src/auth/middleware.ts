import type { PrismaClient } from "@seepwatch/db";
import type { RequestHandler } from "express";
import { HttpError } from "../http.js";
import { verifyAccessToken, type AccessClaims } from "./tokens.js";

declare module "express-serve-static-core" {
  interface Request {
    auth?: AccessClaims;
  }
}

// Accepts a request only with a valid access token whose session is still live.
// Checking the session on every request makes "sign out everywhere" immediate,
// instead of waiting up to 15 minutes for outstanding tokens to expire.
export function requireAuth(prisma: PrismaClient, jwtSecret: string): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) throw new HttpError(401, "Sign in to continue");

    let claims: AccessClaims;
    try {
      claims = await verifyAccessToken(token, jwtSecret);
    } catch {
      throw new HttpError(401, "Your session has expired");
    }

    const session = await prisma.session.findUnique({
      where: { id: claims.sessionId },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    if (
      !session ||
      session.userId !== claims.userId ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      throw new HttpError(401, "Your session has ended");
    }

    req.auth = claims;
    next();
  };
}

// Narrows req.auth for handlers mounted behind requireAuth.
export function authOf(req: { auth?: AccessClaims }): AccessClaims {
  if (!req.auth) throw new HttpError(401, "Sign in to continue");
  return req.auth;
}
