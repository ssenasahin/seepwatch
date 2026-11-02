import type { PrismaClient } from "@seepwatch/db";
import { Router, type RequestHandler } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { authOf } from "../auth/middleware.js";
import { sha256 } from "../auth/tokens.js";
import { HttpError, validate } from "../http.js";
import { SUSPENDED } from "../auth/shared.js";
import { withRoomFor } from "../plans.js";

const KEY_PREFIX = "spw_sk_";
// Writing last_used_at on every request would turn reads into writes; once a minute
// is precise enough to tell a key in use from a forgotten one.
const TOUCH_EVERY_MS = 60_000;

const idParams = z.object({ id: z.uuid() });
const keyFields = {
  id: true,
  name: true,
  prefix: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

// Lets a request in with an API key instead of a session. The key acts as its
// owner, with ordinary rights only: no admin pages and no account settings, which
// aren't mounted behind it anyway.
export function requireApiKey(prisma: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get("authorization");
    const key = header?.startsWith("Bearer ") ? header.slice(7) : "";
    if (!key.startsWith(KEY_PREFIX)) {
      throw new HttpError(401, "Send an API key: Authorization: Bearer spw_sk_…");
    }
    const found = await prisma.apiKey.findUnique({
      where: { keyHash: sha256(key) },
      include: { owner: { select: { suspendedAt: true } } },
    });
    if (!found || found.revokedAt) throw new HttpError(401, "This API key is unknown or revoked");
    if (found.owner.suspendedAt) throw new HttpError(403, SUSPENDED);

    const now = new Date();
    if (!found.lastUsedAt || now.getTime() - found.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      await prisma.apiKey.update({ where: { id: found.id }, data: { lastUsedAt: now } });
    }
    req.auth = { userId: found.ownerId, sessionId: "", role: "USER", mfa: false };
    next();
  };
}

// For the routes a script has reason to use: a key if the request brings one, the
// signed-in session otherwise. Keys can't manage keys, the team or the account, so a
// leaked key can be revoked and stays revoked.
export function sessionOrApiKey(session: RequestHandler, apiKey: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const header = req.get("authorization") ?? "";
    return header.startsWith(`Bearer ${KEY_PREFIX}`)
      ? apiKey(req, res, next)
      : session(req, res, next);
  };
}

export function apiKeyRouter(prisma: PrismaClient, authenticate: RequestHandler) {
  const router = Router();
  router.use(authenticate);

  router.get("/", async (req, res) => {
    const { userId } = authOf(req);
    const keys = await prisma.apiKey.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "desc" },
      select: keyFields,
    });
    res.json({ keys });
  });

  router.post("/", async (req, res) => {
    const { userId } = authOf(req);
    const { name } = validate(
      z.object({ name: z.string().trim().min(1, "Name the key after what uses it").max(100) }),
      req.body,
    );
    const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const created = await withRoomFor(prisma, userId, "apiKeys", (tx) =>
      tx.apiKey.create({
        data: {
          ownerId: userId,
          name,
          keyHash: sha256(key),
          prefix: key.slice(0, KEY_PREFIX.length + 4),
        },
        select: keyFields,
      }),
    );
    // The only time the key itself leaves the server.
    res.status(201).json({ key: created, secret: key });
  });

  router.delete("/:id", async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const { count } = await prisma.apiKey.updateMany({
      where: { id, ownerId: userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new HttpError(404, "API key not found");
    res.status(204).end();
  });

  return router;
}
