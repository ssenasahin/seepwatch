import type { PrismaClient } from "@seepwatch/db";
import type { Request, RequestHandler } from "express";
import { authOf, requireAuth } from "../auth/middleware.js";
import { HttpError } from "../http.js";

// Who is acting, as the audit log records it.
export interface Actor {
  id: string;
  email: string;
  ip: string | null;
}

declare module "express-serve-static-core" {
  interface Request {
    admin?: Actor;
  }
}

// Admin endpoints sit behind their own guard, on top of normal sign-in:
// the role is re-read from the database, so a demotion takes effect at once
// rather than when the access token expires, and the session must have passed
// a second factor.
export function requireAdmin(prisma: PrismaClient, jwtSecret: string): RequestHandler[] {
  const checkAdmin: RequestHandler = async (req, _res, next) => {
    const { userId, mfa } = authOf(req);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, email: true, suspendedAt: true },
    });
    if (user?.role !== "SUPER_ADMIN" || user.suspendedAt) {
      throw new HttpError(403, "You don't have access to this");
    }
    if (!mfa) {
      throw new HttpError(403, "Turn on two-factor sign-in to use the admin panel", {
        code: "two_factor_required",
      });
    }
    req.admin = { id: userId, email: user.email, ip: req.ip ?? null };
    next();
  };
  return [requireAuth(prisma, jwtSecret), checkAdmin];
}

// Narrows req.admin for handlers mounted behind requireAdmin.
export function adminOf(req: Request): Actor {
  if (!req.admin) throw new HttpError(403, "You don't have access to this");
  return req.admin;
}
