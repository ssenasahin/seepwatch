import { decryptSecret, encryptSecret } from "@seepwatch/db";
import { Router } from "express";
import { z } from "zod";
import { HttpError, validate } from "../http.js";
import { isLocked } from "./lockout.js";
import { authOf, requireAuth } from "./middleware.js";
import { verifyPassword } from "./password.js";
import {
  authLimiter,
  clearFailedSignIns,
  issueSession,
  publicUser,
  recordFailedSignIn,
  type AuthDeps,
} from "./shared.js";
import { signAccessToken, verifyChallengeToken } from "./tokens.js";
import {
  checkTotp,
  generateBackupCodes,
  hashBackupCode,
  newTotpSecret,
  setupPayload,
} from "./two-factor.js";

const totpCode = z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your app");

const challengeBody = z
  .object({
    challengeToken: z.string().min(1).max(2000),
    code: totpCode.optional(),
    backupCode: z.string().min(8).max(20).optional(),
  })
  .refine((b) => Boolean(b.code) !== Boolean(b.backupCode), "Send either a code or a backup code");

const CODE_REJECTED = "That code didn't work";

export function twoFactorRoutes(deps: AuthDeps) {
  const { env, prisma, encryptionKey } = deps;
  const router = Router();
  const auth = requireAuth(prisma, env.JWT_SECRET);
  const limiter = authLimiter(env.AUTH_RATE_LIMIT_PER_MINUTE);

  // Step 1 of turning two-factor on: a new secret, stored encrypted but not yet active.
  router.post("/2fa/setup", auth, async (req, res) => {
    const { userId } = authOf(req);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) throw new HttpError(409, "Two-factor sign-in is already on");

    const secret = newTotpSecret();
    await prisma.user.update({
      where: { id: userId },
      data: { totpSecret: encryptSecret(secret, encryptionKey), totpLastStep: null },
    });
    res.json(await setupPayload(user.email, secret));
  });

  // Step 2: a correct code proves the app holds the secret, so two-factor turns on.
  // The password too: once on, two-factor can't be turned off, so whoever holds a
  // session alone (a borrowed laptop, a stolen token) must not be able to enrol
  // their own phone and lock the owner out.
  router.post("/2fa/verify", auth, limiter, async (req, res) => {
    const claims = authOf(req);
    const { code, password } = validate(
      z.object({ code: totpCode, password: z.string().min(1).max(256) }),
      req.body,
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { id: claims.userId } });
    if (user.totpEnabledAt) throw new HttpError(409, "Two-factor sign-in is already on");
    if (!user.totpSecret) throw new HttpError(400, "Start two-factor setup first");
    if (!(await verifyPassword(user.passwordHash, password))) {
      await recordFailedSignIn(prisma, user.id);
      throw new HttpError(400, "That password isn't right", {
        password: ["Enter the password you sign in with."],
      });
    }

    const step = await checkTotp(decryptSecret(user.totpSecret, encryptionKey), code, null);
    if (step === null) {
      throw new HttpError(400, "That code didn't match", {
        code: ["Check that the time on your phone is set automatically, then try the newest code."],
      });
    }

    const { codes, hashes } = generateBackupCodes();
    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { totpEnabledAt: new Date(), totpLastStep: step },
      }),
      prisma.backupCode.deleteMany({ where: { userId: user.id } }),
      prisma.backupCode.createMany({
        data: hashes.map((codeHash) => ({ userId: user.id, codeHash })),
      }),
      // This session just proved the second factor.
      prisma.session.update({ where: { id: claims.sessionId }, data: { mfa: true } }),
      // Every other one never did. Turning two-factor on is often how someone shuts
      // out a person who got their password; they mustn't keep a session.
      prisma.session.updateMany({
        where: { userId: user.id, id: { not: claims.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    const accessToken = await signAccessToken({ ...claims, mfa: true }, env.JWT_SECRET);
    // Backup codes are shown exactly once; only their hashes are kept.
    res.json({ backupCodes: codes, accessToken, user: publicUser(updated) });
  });

  // The second step of signing in, after a correct password.
  router.post("/2fa/challenge", limiter, async (req, res) => {
    const body = validate(challengeBody, req.body);

    let userId: string;
    try {
      userId = await verifyChallengeToken(body.challengeToken, env.JWT_SECRET);
    } catch {
      throw new HttpError(401, "This sign-in attempt has expired. Start again.");
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpEnabledAt || !user.totpSecret) {
      throw new HttpError(401, "This sign-in attempt has expired. Start again.");
    }
    // Six digits are guessable with enough tries, so wrong codes count toward the lock.
    if (isLocked(user.lockedUntil, new Date())) throw new HttpError(401, CODE_REJECTED);

    let accepted = false;
    if (body.code) {
      const secret = decryptSecret(user.totpSecret, encryptionKey);
      const step = await checkTotp(secret, body.code, user.totpLastStep);
      if (step !== null) {
        // Conditional on the old step, so two requests with the same code can't both win.
        const { count } = await prisma.user.updateMany({
          where: { id: user.id, totpLastStep: user.totpLastStep },
          data: { totpLastStep: step },
        });
        accepted = count === 1;
      }
    } else if (body.backupCode) {
      // Marking it used in the same statement that finds it makes each code single-use.
      const { count } = await prisma.backupCode.updateMany({
        where: { userId: user.id, codeHash: hashBackupCode(body.backupCode), usedAt: null },
        data: { usedAt: new Date() },
      });
      accepted = count === 1;
    }

    if (!accepted) {
      await recordFailedSignIn(prisma, user.id);
      throw new HttpError(401, CODE_REJECTED);
    }

    await clearFailedSignIns(prisma, user);
    res.json(await issueSession(deps, req, res, user, true));
  });

  return router;
}
