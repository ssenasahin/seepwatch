import { randomBytes } from "node:crypto";
import { emailLayout, escapeHtml, type PrismaClient } from "@seepwatch/db";
import { Router } from "express";
import { z } from "zod";
import { HttpError, validate } from "../http.js";
import { hashPassword, passwordProblem } from "./password.js";
import { authLimiter, emailField, type AuthDeps } from "./shared.js";
import { sha256 } from "./tokens.js";

const RESET_TTL_MS = 30 * 60 * 1000;
// A link an admin sends may sit in the inbox until the person sees it.
export const ADMIN_RESET_TTL_MS = 24 * 60 * 60 * 1000;
const LINK_INVALID = "This reset link has expired or was already used. Request a new one.";

// A new link replaces any older one still waiting in the inbox. Only its hash is kept.
export async function createResetLink(
  prisma: PrismaClient,
  webOrigin: string,
  userId: string,
  ttlMs = RESET_TTL_MS,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } }),
    prisma.passwordResetToken.create({
      data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) },
    }),
  ]);
  return `${webOrigin}/reset-password?token=${token}`;
}

export function resetRoutes({ env, prisma, mailer }: AuthDeps) {
  const router = Router();
  const limiter = authLimiter(env.AUTH_RATE_LIMIT_PER_MINUTE);

  router.post("/forgot-password", limiter, async (req, res) => {
    const { email } = validate(z.object({ email: emailField }), req.body);
    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      const link = await createResetLink(prisma, env.WEB_ORIGIN, user.id);
      // Sent without awaiting, so a slow mail server can't make known addresses
      // answer measurably slower than unknown ones.
      void mailer.send(resetEmail(user.email, link)).catch((error) => {
        console.error("Could not send the password reset email", error);
      });
    }

    // The same answer whether or not the account exists.
    res.status(202).json({
      message: "If an account exists for that email, a link to reset its password is on its way.",
    });
  });

  router.post("/reset-password", limiter, async (req, res) => {
    const body = validate(
      z.object({ token: z.string().min(20).max(100), password: z.string().max(256) }),
      req.body,
    );
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(body.token) },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new HttpError(400, LINK_INVALID);
    }

    const problem = passwordProblem(body.password, record.user.email);
    if (problem) throw new HttpError(400, "Choose a stronger password", { password: [problem] });

    // Claim the token first, conditionally, so a link clicked twice resets only once.
    const { count } = await prisma.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw new HttpError(400, LINK_INVALID);

    // Whoever knew the old password is signed out everywhere. Two-factor stays on:
    // a reset proves control of the inbox, not of the phone.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash: await hashPassword(body.password),
          failedLogins: 0,
          lockedUntil: null,
        },
      }),
      prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    res.status(204).end();
  });

  return router;
}

// Asked for by the person, or sent by an admin helping them back in.
export function resetEmail(to: string, link: string, byAdmin = false) {
  const why = byAdmin
    ? `A Seepwatch administrator sent you a link to set a new password for ${to}.`
    : `Someone asked to reset the password for ${to}.`;
  const lasts = byAdmin ? "24 hours" : "30 minutes";
  return {
    to,
    subject: "Reset your Seepwatch password",
    text: `${why}\n\nOpen this link within ${lasts} to choose a new one:\n${link}\n\nIf you didn't expect it, ignore this email; your password stays the same.`,
    html: emailLayout(
      "Reset your password",
      `<p style="margin:0 0 24px;line-height:1.6;color:#c9cdd2">${escapeHtml(why)} The link works once, for ${lasts}.</p>
      <p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#f5a524;color:#1b1204;font-weight:600;text-decoration:none">Choose a new password</a></p>
      <p style="margin:0;line-height:1.6;color:#8b939d">If you didn't expect it, ignore this email; your password stays the same.</p>`,
    ),
  };
}
