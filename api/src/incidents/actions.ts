import {
  ACK_REMINDER_MS,
  nextStatus,
  type Action,
  type IncidentEventType,
  type PrismaClient,
} from "@seepwatch/db";
import { HttpError } from "../http.js";

const EVENT: Record<Action, IncidentEventType> = {
  ACKNOWLEDGE: "ACKNOWLEDGED",
  REVOKE: "REVOKED",
  FALSE_POSITIVE: "FALSE_POSITIVE",
  ACCEPT_RISK: "RISK_ACCEPTED",
};

const ALREADY: Record<string, string> = {
  ACKNOWLEDGED: "Someone is already on it",
  REVOKED: "It's already marked revoked",
  FALSE_POSITIVE: "It's already closed as a false positive",
  RISK_ACCEPTED: "It's already closed as an accepted risk",
};

// Moves an incident on, once. `by` says who in words, for the timeline and the alerts.
// The worker does the telling: acknowledging pushes the next round out to a reminder,
// closing makes one last round due now, so everyone alerted hears how it ended.
export async function applyAction(
  prisma: PrismaClient,
  incidentId: string,
  action: Action,
  by: string,
  reason: string | null = null,
) {
  const incident = await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } });
  const status = nextStatus(incident.status, action);
  if (!status) throw new HttpError(409, ALREADY[incident.status] ?? "That can't be done now");

  const now = new Date();
  const data =
    action === "ACKNOWLEDGE"
      ? {
          status,
          acknowledgedAt: now,
          acknowledgedBy: by,
          nextAlertAt: new Date(now.getTime() + ACK_REMINDER_MS),
        }
      : {
          status,
          closedAt: now,
          closedBy: by,
          closeReason: reason,
          // Nobody heard of it yet: nobody needs to hear it's over.
          nextAlertAt: incident.round > 0 ? now : null,
        };

  // Only from the status it was read in: two people pressing at once don't both win.
  const { count } = await prisma.incident.updateMany({
    where: { id: incidentId, status: incident.status },
    data,
  });
  if (count === 0) throw new HttpError(409, "Someone else just changed it. Reload and try again.");

  await prisma.incidentEvent.create({
    data: {
      incidentId,
      type: EVENT[action],
      at: now,
      detail: reason ? `By ${by}: ${reason}` : `By ${by}`,
    },
  });
}
