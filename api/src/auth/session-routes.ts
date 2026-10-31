import { Router } from "express";
import { z } from "zod";
import { HttpError, validate } from "../http.js";
import { authOf, requireAuth } from "./middleware.js";
import { revokeAllSessions } from "./sessions.js";
import { REFRESH_COOKIE, refreshCookieOptions, type AuthDeps } from "./shared.js";

export function sessionRoutes({ env, prisma }: AuthDeps) {
  const router = Router();
  const auth = requireAuth(prisma, env.JWT_SECRET);

  // Every device currently signed in to this account.
  router.get("/sessions", auth, async (req, res) => {
    const { userId, sessionId } = authOf(req);
    const sessions = await prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastUsedAt: true },
    });
    res.json({ sessions: sessions.map((s) => ({ ...s, current: s.id === sessionId })) });
  });

  router.delete("/sessions/:id", auth, async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(z.object({ id: z.uuid() }), req.params);
    // Filtering by owner as well as id: someone else's session id simply isn't found.
    const { count } = await prisma.session.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new HttpError(404, "Session not found");
    res.status(204).end();
  });

  router.post("/logout-all", auth, async (req, res) => {
    const { userId } = authOf(req);
    await revokeAllSessions(prisma, userId);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    res.status(204).end();
  });

  return router;
}
