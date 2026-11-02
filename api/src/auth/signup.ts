import { randomBytes } from "node:crypto";
import { emailLayout, escapeHtml, Prisma } from "@seepwatch/db";
import { Router } from "express";
import { z } from "zod";
import { HttpError, validate } from "../http.js";
import { hashPassword, passwordProblem } from "./password.js";
import { authLimiter, emailField, issueSession, type AuthDeps } from "./shared.js";
import { sha256 } from "./tokens.js";

// Long enough for an email that lands while its owner is away from their desk.
const SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;
const LINK_INVALID = "This link has expired or was already used. Sign up again for a new one.";
export const CHECK_INBOX =
  "Check your inbox: the link to finish creating your account is on its way.";

const credentials = z.object({
  email: emailField,
  password: z.string().min(1).max(256),
});

// Signing up proves nothing yet: it emails a link, and the account exists only once
// that link is used. The answer is the same whether the address is new or already
// has an account, which then gets a note instead, so the form can't be used to find
// out who uses Seepwatch.
export function signupRoutes(deps: AuthDeps) {
  const { env, prisma, mailer } = deps;
  const router = Router();
  const limiter = authLimiter(env.AUTH_RATE_LIMIT_PER_MINUTE);

  router.post("/register", limiter, async (req, res) => {
    const body = validate(credentials, req.body);
    // About the password, not the address, so saying it gives nothing away.
    const problem = passwordProblem(body.password, body.email);
    if (problem) throw new HttpError(400, "Choose a stronger password", { password: [problem] });

    // Hashed either way, so a known address doesn't answer measurably faster.
    const passwordHash = await hashPassword(body.password);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });

    let mail;
    if (existing) {
      mail = alreadyEmail(body.email, `${env.WEB_ORIGIN}/sign-in`);
    } else {
      const token = randomBytes(32).toString("base64url");
      // Signing up again replaces the link still waiting in the inbox.
      await prisma.pendingSignup.upsert({
        where: { email: body.email },
        create: {
          email: body.email,
          passwordHash,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + SIGNUP_TTL_MS),
        },
        update: {
          passwordHash,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + SIGNUP_TTL_MS),
        },
      });
      mail = verifyEmail(body.email, `${env.WEB_ORIGIN}/verify-email?token=${token}`);
    }
    // Not awaited, for the same reason as the hash.
    void mailer.send(mail).catch((error) => {
      console.error("Could not send the sign-up email", error);
    });
    res.status(202).json({ message: CHECK_INBOX });
  });

  // The link's page posts here. Opening the link alone does nothing: mail scanners
  // open every link they see.
  router.post("/verify-email", limiter, async (req, res) => {
    const { token } = validate(z.object({ token: z.string().min(20).max(100) }), req.body);
    const pending = await prisma.pendingSignup.findUnique({ where: { tokenHash: sha256(token) } });
    if (!pending || pending.expiresAt <= new Date()) throw new HttpError(400, LINK_INVALID);

    // Claimed by deleting it, so a link used twice at once makes one account.
    const { count } = await prisma.pendingSignup.deleteMany({
      where: { id: pending.id, tokenHash: pending.tokenHash },
    });
    if (count === 0) throw new HttpError(400, LINK_INVALID);

    let user;
    try {
      user = await prisma.user.create({
        data: { email: pending.email, passwordHash: pending.passwordHash },
      });
    } catch (error) {
      // Made some other way since (an admin, say). Only the inbox's owner gets here.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new HttpError(409, "This address already has an account. Sign in instead.");
      }
      throw error;
    }
    res.status(201).json(await issueSession(deps, req, res, user, false));
  });

  return router;
}

const button = (link: string, label: string) =>
  `<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#f5a524;color:#1b1204;font-weight:600;text-decoration:none">${label}</a></p>`;
const paragraph = (text: string, color = "#c9cdd2") =>
  `<p style="margin:0 0 24px;line-height:1.6;color:${color}">${escapeHtml(text)}</p>`;

export function verifyEmail(to: string, link: string) {
  const why = `Someone signed up for Seepwatch with ${to}.`;
  const ignore = "If it wasn't you, ignore this email; no account is made without the link.";
  return {
    to,
    subject: "Finish creating your Seepwatch account",
    text: `${why}\n\nOpen this link within 24 hours to finish:\n${link}\n\n${ignore}`,
    html: emailLayout(
      "Finish creating your account",
      paragraph(`${why} The link works once, for 24 hours.`) +
        button(link, "Finish creating my account") +
        paragraph(ignore, "#8b939d"),
    ),
  };
}

export function alreadyEmail(to: string, signInLink: string) {
  const why = `Someone tried to sign up for Seepwatch with ${to}, which already has an account.`;
  const next =
    "If it was you, sign in instead; the sign-in page can also reset a forgotten password. If it wasn't, nothing changed and you can ignore this.";
  return {
    to,
    subject: "You already have a Seepwatch account",
    text: `${why}\n\n${next}\n${signInLink}`,
    html: emailLayout(
      "You already have an account",
      paragraph(why) + button(signInLink, "Sign in") + paragraph(next, "#8b939d"),
    ),
  };
}
