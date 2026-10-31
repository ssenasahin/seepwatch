import { emailLayout, escapeHtml, readSteps, type Mailer, type PrismaClient } from "@seepwatch/db";
import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { authOf } from "../auth/middleware.js";
import { emailField } from "../auth/shared.js";
import { sha256 } from "../auth/tokens.js";
import { HttpError, validate } from "../http.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_TEAM_SIZE = 25;
const INVITE_INVALID = "This invite has expired or was already used. Ask for a new one.";

const tokenParams = z.object({ token: z.string().min(20).max(100) });
const idParams = z.object({ id: z.uuid() });

// The caller's own team, made with them as its owner the first time it's needed.
export async function ownTeam(prisma: PrismaClient, userId: string) {
  const existing = await prisma.team.findUnique({ where: { ownerId: userId } });
  if (existing) return existing;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  // Two first requests at once: the unique owner id lets only one create it.
  return prisma.team
    .create({
      data: {
        ownerId: userId,
        name: `${user.email.split("@")[0]}'s team`,
        members: { create: { userId, role: "OWNER" } },
      },
    })
    .catch(() => prisma.team.findUniqueOrThrow({ where: { ownerId: userId } }));
}

export interface TeamDeps {
  prisma: PrismaClient;
  mailer: Mailer;
  authenticate: RequestHandler;
  webOrigin: string;
}

export function teamRouter({ prisma, mailer, authenticate, webOrigin }: TeamDeps) {
  const router = Router();
  router.use(authenticate);

  // Each invite is an email to someone who didn't ask for it.
  const inviteLimit = rateLimit({
    windowMs: 60 * 60_000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => authOf(req).userId,
    message: { error: "That's a lot of invites for one hour. Try again later." },
  });

  async function describeTeam(userId: string) {
    const team = await ownTeam(prisma, userId);
    const [members, invites, memberOf] = await Promise.all([
      prisma.teamMember.findMany({
        where: { teamId: team.id },
        orderBy: { createdAt: "asc" },
        select: { role: true, createdAt: true, user: { select: { id: true, email: true } } },
      }),
      prisma.teamInvite.findMany({
        where: { teamId: team.id, acceptedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true, expiresAt: true, createdAt: true },
      }),
      // Other people's teams this user joined: they may be alerted for those.
      prisma.teamMember.findMany({
        where: { userId, role: "MEMBER" },
        select: { team: { select: { id: true, name: true, owner: { select: { email: true } } } } },
      }),
    ]);
    return {
      team: { id: team.id, name: team.name },
      members: members.map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        role: m.role,
        joinedAt: m.createdAt,
      })),
      invites,
      memberOf: memberOf.map(({ team }) => ({
        id: team.id,
        name: team.name,
        ownerEmail: team.owner.email,
      })),
    };
  }

  router.get("/", async (req, res) => {
    res.json(await describeTeam(authOf(req).userId));
  });

  router.patch("/", async (req, res) => {
    const { userId } = authOf(req);
    const { name } = validate(
      z.object({ name: z.string().trim().min(1, "Give the team a name").max(100) }),
      req.body,
    );
    const team = await ownTeam(prisma, userId);
    await prisma.team.update({ where: { id: team.id }, data: { name } });
    res.json(await describeTeam(userId));
  });

  router.post("/invites", inviteLimit, async (req, res) => {
    const { userId } = authOf(req);
    const { email } = validate(z.object({ email: emailField }), req.body);
    const team = await ownTeam(prisma, userId);
    const inviter = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const already = await prisma.teamMember.findFirst({
      where: { teamId: team.id, user: { email } },
    });
    if (already) {
      throw new HttpError(400, "Invalid request", { email: ["Already on your team"] });
    }
    const size = await prisma.teamMember.count({ where: { teamId: team.id } });
    if (size >= MAX_TEAM_SIZE) {
      throw new HttpError(403, `A team can have up to ${MAX_TEAM_SIZE} people`);
    }

    const token = randomBytes(32).toString("base64url");
    // A new invite to the same address replaces one still waiting in their inbox.
    await prisma.$transaction([
      prisma.teamInvite.deleteMany({ where: { teamId: team.id, email, acceptedAt: null } }),
      prisma.teamInvite.create({
        data: {
          teamId: team.id,
          email,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      }),
    ]);
    await mailer.send(
      inviteEmail(email, inviter.email, team.name, `${webOrigin}/invites/${token}`),
    );
    res.status(201).json(await describeTeam(userId));
  });

  router.delete("/invites/:id", async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const team = await ownTeam(prisma, userId);
    const { count } = await prisma.teamInvite.deleteMany({ where: { id, teamId: team.id } });
    if (count === 0) throw new HttpError(404, "Invite not found");
    res.status(204).end();
  });

  // Removing someone also takes them out of every escalation step, so the policies
  // say who they really reach.
  router.delete("/members/:id", async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const team = await ownTeam(prisma, userId);
    if (id === userId) throw new HttpError(400, "You can't remove yourself from your own team");
    const { count } = await prisma.teamMember.deleteMany({
      where: { teamId: team.id, userId: id },
    });
    if (count === 0) throw new HttpError(404, "Member not found");
    await dropFromPolicies(prisma, team.id, id);
    res.status(204).end();
  });

  // Leaving someone else's team.
  router.delete("/memberships/:id", async (req, res) => {
    const { userId } = authOf(req);
    const { id } = validate(idParams, req.params);
    const { count } = await prisma.teamMember.deleteMany({
      where: { teamId: id, userId, role: "MEMBER" },
    });
    if (count === 0) throw new HttpError(404, "You aren't on that team");
    await dropFromPolicies(prisma, id, userId);
    res.status(204).end();
  });

  // What an invite link leads to, so the page can say whose team it is.
  router.get("/invites/:token", async (req, res) => {
    const { token } = validate(tokenParams, req.params);
    const invite = await findInvite(prisma, token);
    res.json({
      email: invite.email,
      team: invite.team.name,
      invitedBy: invite.team.owner.email,
    });
  });

  router.post("/invites/:token/accept", async (req, res) => {
    const { userId } = authOf(req);
    const { token } = validate(tokenParams, req.params);
    const invite = await findInvite(prisma, token);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // The invite is for an address, and only its owner may take it up: otherwise a
    // forwarded link would put a stranger on the alert list.
    if (user.email !== invite.email) {
      throw new HttpError(
        403,
        `This invite is for ${invite.email}. Sign in with that address to accept it.`,
      );
    }
    if (invite.team.ownerId === userId) throw new HttpError(400, "That's your own team");

    await prisma.$transaction([
      prisma.teamInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
      prisma.teamMember.upsert({
        where: { teamId_userId: { teamId: invite.teamId, userId } },
        create: { teamId: invite.teamId, userId, role: "MEMBER" },
        update: {},
      }),
    ]);
    res.json({ team: { id: invite.teamId, name: invite.team.name } });
  });

  return router;
}

async function findInvite(prisma: PrismaClient, token: string) {
  const invite = await prisma.teamInvite.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      team: { select: { name: true, ownerId: true, owner: { select: { email: true } } } },
    },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) {
    throw new HttpError(404, INVITE_INVALID);
  }
  return invite;
}

async function dropFromPolicies(prisma: PrismaClient, teamId: string, userId: string) {
  const policies = await prisma.escalationPolicy.findMany({ where: { teamId } });
  for (const policy of policies) {
    const steps = readSteps(policy.steps).map((step) => ({
      ...step,
      targets: step.targets.filter((t) => !(t.kind === "member" && t.userId === userId)),
    }));
    await prisma.escalationPolicy.update({ where: { id: policy.id }, data: { steps } });
  }
}

function inviteEmail(to: string, from: string, team: string, link: string) {
  return {
    to,
    subject: `${from} invited you to their Seepwatch team`,
    text: `${from} invited you to join "${team}" on Seepwatch, so their outage alerts can reach you.\n\nAccept within 7 days:\n${link}\n\nYou'll need a Seepwatch account with this address (${to}). If you weren't expecting this, ignore it: nothing is sent to you unless you accept.`,
    html: emailLayout(
      "You're invited to a team",
      `<p style="margin:0 0 24px;line-height:1.6;color:#c9cdd2">${escapeHtml(from)} invited you to join <strong>${escapeHtml(team)}</strong> on Seepwatch, so their outage alerts can reach you.</p>
      <p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#f5a524;color:#1b1204;font-weight:600;text-decoration:none">Accept the invite</a></p>
      <p style="margin:0;line-height:1.6;color:#8b939d">The link works for 7 days, with a Seepwatch account for ${escapeHtml(to)}. If you weren't expecting this, ignore it: nothing is sent to you unless you accept.</p>`,
    ),
  };
}
