import { Prisma, type User } from "@seepwatch/db";
import { Router } from "express";
import { z } from "zod";
import { HttpError, validate } from "../http.js";
import { isLocked } from "./lockout.js";
import { authOf, requireAuth } from "./middleware.js";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from "./password.js";
import { resetRoutes } from "./reset.js";
import { sessionRoutes } from "./session-routes.js";
import { revokeSession, rotateSession } from "./sessions.js";
import {
  authLimiter,
  clearFailedSignIns,
  clientOf,
  emailField,
  INVALID_CREDENTIALS,
  issueSession,
  SUSPENDED,
  publicUser,
  recordFailedSignIn,
  REFRESH_COOKIE,
  refreshCookieOptions,
  type AuthDeps,
} from "./shared.js";
import { parseRefreshToken, signAccessToken, signChallengeToken } from "./tokens.js";
import { twoFactorRoutes } from "./two-factor-routes.js";

const credentials = z.object({
  email: emailField,
  password: z.string().min(1).max(256),
});

export function authRouter(deps: AuthDeps) {
  const { env, prisma } = deps;
  const router = Router();
  const limiter = authLimiter(env.AUTH_RATE_LIMIT_PER_MINUTE);

  router.post("/register", limiter, async (req, res) => {
    const body = validate(credentials, req.body);
    const problem = passwordProblem(body.password, body.email);
    if (problem) throw new HttpError(400, "Choose a stronger password", { password: [problem] });

    let user: User;
    try {
      user = await prisma.user.create({
        data: { email: body.email, passwordHash: await hashPassword(body.password) },
      });
    } catch (error) {
      // P2002: unique constraint, the email is taken.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "An account with this email already exists");
      }
      throw error;
    }

    res.status(201).json(await issueSession(deps, req, res, user, false));
  });

  router.post("/login", limiter, async (req, res) => {
    const body = validate(credentials, req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    // Unknown and locked accounts still pay for a full password check, so neither
    // the message nor the response time distinguishes them from a wrong password.
    if (!user || isLocked(user.lockedUntil, new Date())) {
      await burnPasswordCheck(body.password);
      throw new HttpError(401, INVALID_CREDENTIALS);
    }

    if (!(await verifyPassword(user.passwordHash, body.password))) {
      await recordFailedSignIn(prisma, user.id);
      throw new HttpError(401, INVALID_CREDENTIALS);
    }
    // Said only after the right password, so it reveals nothing to a guesser, and
    // before two-factor, so the user isn't asked for a code that leads nowhere.
    if (user.suspendedAt) throw new HttpError(403, SUSPENDED);

    // The password was right, but with two-factor on it only earns a short-lived
    // ticket to the second step; no session exists until a code is checked.
    if (user.totpEnabledAt) {
      res.json({
        twoFactorRequired: true,
        challengeToken: await signChallengeToken(user.id, env.JWT_SECRET),
      });
      return;
    }

    await clearFailedSignIns(prisma, user);
    res.json(await issueSession(deps, req, res, user, false));
  });

  router.post("/refresh", async (req, res) => {
    const parsed = parseRefreshToken(req.cookies?.[REFRESH_COOKIE]);
    if (!parsed) throw new HttpError(401, "Sign in to continue");

    const result = await rotateSession(prisma, parsed.sessionId, parsed.secret, clientOf(req));
    if (result.kind !== "rotated") {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      throw new HttpError(401, "Your session has ended. Sign in again.");
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.session.userId } });
    if (user.suspendedAt) {
      await revokeSession(prisma, result.session.id);
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      throw new HttpError(403, SUSPENDED);
    }
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions(result.session.expiresAt));
    const accessToken = await signAccessToken(
      { userId: user.id, sessionId: result.session.id, role: user.role, mfa: result.session.mfa },
      env.JWT_SECRET,
    );
    res.json({ accessToken, user: publicUser(user) });
  });

  // Works without an access token, which may already have expired: the refresh
  // cookie identifies the session to end.
  router.post("/logout", async (req, res) => {
    const parsed = parseRefreshToken(req.cookies?.[REFRESH_COOKIE]);
    if (parsed) await revokeSession(prisma, parsed.sessionId);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    res.status(204).end();
  });

  router.get("/me", requireAuth(prisma, env.JWT_SECRET), async (req, res) => {
    const { userId } = authOf(req);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    res.json({ user: publicUser(user) });
  });

  router.use(twoFactorRoutes(deps));
  router.use(resetRoutes(deps));
  router.use(sessionRoutes(deps));

  return router;
}
