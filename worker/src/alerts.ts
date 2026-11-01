import {
  deliver,
  DeliveryError,
  detectorLabel,
  isClosed,
  OPEN_REMINDER_MS,
  ACK_REMINDER_MS,
  planRound,
  readSteps,
  respondLink,
  type Audience,
  type EscalationStep,
  type IncidentEventType,
  type Mailer,
  type NotificationChannel,
  type PrismaClient,
  type Round,
  type Transport,
} from "@seepwatch/db";
import { renderAlert, type IncidentFacts, type Rendered } from "./notify.js";

export interface AlertDeps {
  prisma: PrismaClient;
  mailer: Mailer;
  webOrigin: string;
  // Opens channel settings and signs respond links.
  encryptionKey: Buffer;
  transport?: Transport;
  // Waits between delivery retries; tests make it instant.
  wait?: (ms: number) => Promise<void>;
}

// Someone or something to alert. `by` names them in respond links and dedupes:
// "u:<user id>" or "c:<channel id>".
type Recipient =
  | { kind: "email"; by: string; email: string }
  | { kind: "channel"; by: string; channel: NotificationChannel };

const CHANNEL_WORDS = { SLACK: "Slack", TELEGRAM: "Telegram", WEBHOOK: "the webhook" };
const describe = (r: Recipient) =>
  r.kind === "email" ? r.email : `${CHANNEL_WORDS[r.channel.type]} "${r.channel.name}"`;

// "hour", "4 hours".
const every = (ms: number) => {
  const hours = Math.round(ms / 3_600_000);
  return hours === 1 ? "hour" : `${hours} hours`;
};

// Incidents whose next round is due, oldest first. A suspended owner's wait: they're
// alerted again once an admin lets them back in.
export async function dueIncidents(prisma: PrismaClient, now = new Date()): Promise<string[]> {
  const due = await prisma.incident.findMany({
    where: { nextAlertAt: { lte: now }, owner: { suspendedAt: null } },
    select: { id: true },
    orderBy: { nextAlertAt: "asc" },
    take: 100,
  });
  return due.map((i) => i.id);
}

function loadIncident(prisma: PrismaClient, id: string) {
  return prisma.incident.findUnique({
    where: { id },
    include: {
      owner: { select: { email: true, suspendedAt: true } },
      finding: {
        include: {
          locations: { orderBy: { seenAt: "desc" }, take: 1 },
          _count: { select: { locations: true } },
          watch: {
            select: {
              value: true,
              escalationPolicy: { select: { name: true, steps: true, teamId: true } },
            },
          },
        },
      },
    },
  });
}

// Sends one round of an incident, if it's due and no other run took it first.
// Returns whether this run sent it.
export async function runRound(deps: AlertDeps, incidentId: string, now = new Date()) {
  const { prisma } = deps;
  const incident = await loadIncident(prisma, incidentId);
  if (!incident?.nextAlertAt || incident.nextAlertAt > now) return false;
  if (incident.owner.suspendedAt) return false;

  const policy = incident.finding.watch?.escalationPolicy ?? null;
  const steps = readSteps(policy?.steps);
  const plan = planRound(
    incident.status,
    incident.round,
    steps.map((s) => s.waitMinutes),
  );

  // Claims the round: of two runs that loaded the same incident, one moves it on.
  const closed = isClosed(incident.status);
  const { count } = await prisma.incident.updateMany({
    where: { id: incident.id, round: incident.round, nextAlertAt: incident.nextAlertAt },
    data: {
      round: closed ? incident.round : incident.round + 1,
      nextAlertAt: plan.nextInMs === null ? null : new Date(now.getTime() + plan.nextInMs),
    },
  });
  if (count === 0) return false;

  if (plan.kind === "escalated") {
    const step = steps[incident.round]!;
    await event(
      prisma,
      incident.id,
      "ESCALATED",
      `Nobody responded within ${step.waitMinutes} min; alerting step ${incident.round + 1} of "${policy!.name}"`,
    );
  } else if (plan.kind === "unacknowledged" || plan.kind === "acknowledged") {
    await event(
      prisma,
      incident.id,
      "REMINDED",
      plan.kind === "unacknowledged"
        ? "Nobody has said they're on it; reminding everyone alerted"
        : "Not revoked yet; reminding everyone alerted",
    );
  }

  const recipients = await audienceOf(
    prisma,
    incident.ownerId,
    incident.owner.email,
    policy,
    steps,
    plan.audience,
  );
  const location = incident.finding.locations[0];
  const facts: IncidentFacts = {
    id: incident.id,
    status: incident.status,
    openedAt: incident.openedAt,
    acknowledgedAt: incident.acknowledgedAt,
    acknowledgedBy: incident.acknowledgedBy,
    closedBy: incident.closedBy,
    closeReason: incident.closeReason,
    finding: {
      id: incident.finding.id,
      detector: incident.finding.detector,
      label: detectorLabel(incident.finding.detector),
      masked: incident.finding.masked,
    },
    where: location
      ? {
          repository: location.repository,
          path: location.path,
          line: location.line,
          url: location.url,
        }
      : null,
    places: incident.finding._count.locations,
    watch: incident.finding.watch?.value ?? null,
  };
  const note = noteFor(plan, steps, incident.round);
  await sendAll(
    deps,
    recipients,
    (r) =>
      renderAlert(
        plan.kind,
        facts,
        deps.webOrigin,
        closed ? null : respondLink(deps.webOrigin, deps.encryptionKey, incident.id, r.by),
        note,
      ),
    incident.id,
  );
  return true;
}

// What happens next, in a sentence under the alert.
function noteFor(plan: Round, steps: EscalationStep[], round: number): string | null {
  const untilAck = `Seepwatch repeats this every ${every(OPEN_REMINDER_MS)} until someone says they're on it.`;
  const untilRevoked = `Reminders go out every ${every(ACK_REMINDER_MS)} until it's marked revoked.`;
  switch (plan.kind) {
    case "new":
    case "escalated": {
      const next = steps[round + 1];
      if (next) {
        return `If nobody responds within ${next.waitMinutes} min, Seepwatch alerts the next people on call.`;
      }
      return steps.length > 0 && plan.kind === "escalated"
        ? `This is the last step of the escalation policy. ${untilAck}`
        : untilAck;
    }
    case "unacknowledged":
      return untilAck;
    case "acknowledged":
      return untilRevoked;
    case "closed":
      return "No more alerts will be sent about it.";
  }
}

async function audienceOf(
  prisma: PrismaClient,
  ownerId: string,
  ownerEmail: string,
  policy: { teamId: string } | null,
  steps: EscalationStep[],
  audience: Audience,
): Promise<Recipient[]> {
  if (audience === "nobody") return [];
  if (audience === "everyone" || !policy) return everyone(prisma, ownerId, ownerEmail);
  const picked = audience.steps.flatMap((i) => (steps[i] ? [steps[i]] : []));
  const lists = await Promise.all(
    picked.map((step) => stepRecipients(prisma, ownerId, policy.teamId, step)),
  );
  return unique(lists.flat());
}

// Without a policy: the owner by email, and every channel they haven't switched off.
async function everyone(prisma: PrismaClient, ownerId: string, ownerEmail: string) {
  const channels = await prisma.notificationChannel.findMany({
    where: { ownerId, enabled: true },
    orderBy: { createdAt: "asc" },
  });
  return [
    { kind: "email", by: `u:${ownerId}`, email: ownerEmail } as Recipient,
    ...channels.map((channel): Recipient => ({ kind: "channel", by: `c:${channel.id}`, channel })),
  ];
}

// One step's targets, as they are now: a member who left the team, or a channel that
// was deleted or switched off since the policy was written, is skipped.
async function stepRecipients(
  prisma: PrismaClient,
  ownerId: string,
  teamId: string,
  step: EscalationStep,
): Promise<Recipient[]> {
  const userIds = step.targets.flatMap((t) => (t.kind === "member" ? [t.userId] : []));
  const channelIds = step.targets.flatMap((t) => (t.kind === "channel" ? [t.channelId] : []));
  const [members, channels] = await Promise.all([
    prisma.teamMember.findMany({
      where: { teamId, userId: { in: userIds } },
      select: { user: { select: { id: true, email: true } } },
    }),
    prisma.notificationChannel.findMany({
      where: { id: { in: channelIds }, ownerId, enabled: true },
    }),
  ]);
  return [
    ...members.map(({ user }): Recipient => ({
      kind: "email",
      by: `u:${user.id}`,
      email: user.email,
    })),
    ...channels.map((channel): Recipient => ({ kind: "channel", by: `c:${channel.id}`, channel })),
  ];
}

function unique(recipients: Recipient[]) {
  const seen = new Set<string>();
  return recipients.filter((r) => !seen.has(r.by) && seen.add(r.by));
}

// Sends one alert to each recipient. A failure is recorded and doesn't stop the rest:
// retrying the whole round would alert everyone who did get it a second time.
async function sendAll(
  deps: AlertDeps,
  recipients: Recipient[],
  build: (r: Recipient) => Rendered,
  incidentId: string,
) {
  const { prisma, mailer, encryptionKey, transport, wait = sleep } = deps;
  for (const recipient of recipients) {
    const { mail, message } = build(recipient);
    let problem: string | null = null;
    try {
      if (recipient.kind === "email") {
        await withRetries(() => mailer.send({ to: recipient.email, ...mail }), wait);
      } else {
        await deliver(recipient.channel, message, encryptionKey, { transport, wait });
      }
    } catch (err) {
      problem = err instanceof DeliveryError ? err.message : `Couldn't send: ${String(err)}`;
      console.error(`alert to ${describe(recipient)} failed:`, problem);
    }

    if (recipient.kind === "channel") {
      await prisma.notificationChannel.updateMany({
        where: { id: recipient.channel.id },
        data: { lastSentAt: new Date(), lastError: problem },
      });
    }
    const how =
      recipient.kind === "email" ? `Emailed ${recipient.email}` : `Sent to ${describe(recipient)}`;
    await event(
      prisma,
      incidentId,
      problem ? "NOT_DELIVERED" : "NOTIFIED",
      problem ? `Couldn't reach ${describe(recipient)}: ${problem}` : how,
    );
  }
}

// Email gets the same patience as webhooks: three tries, a mail server hiccup is common.
async function withRetries(send: () => Promise<void>, wait: (ms: number) => Promise<void>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      if (attempt === 3) throw err;
      await wait(1000 * 2 ** (attempt - 1));
    }
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function event(prisma: PrismaClient, incidentId: string, type: IncidentEventType, detail: string) {
  return prisma.incidentEvent.create({ data: { incidentId, type, detail } });
}
