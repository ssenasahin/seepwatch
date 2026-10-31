import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

// Who an escalation step reaches: a team member by email, or one of the owner's channels.
export type EscalationTarget =
  { kind: "member"; userId: string } | { kind: "channel"; channelId: string };

export interface EscalationStep {
  // How long after the previous step this one fires, if nobody has acknowledged.
  // The first step's is 0: it's who hears about the outage at once.
  waitMinutes: number;
  targets: EscalationTarget[];
}

export const MAX_ESCALATION_STEPS = 5;

// escalation_policies.steps, read back. The API wrote it, so it's trusted to have
// this shape; anything else reads as no steps rather than throwing mid-outage.
export function readSteps(json: unknown): EscalationStep[] {
  return Array.isArray(json) ? (json as EscalationStep[]) : [];
}

export const ESCALATIONS_QUEUE = "escalations";

// "Step n of this incident's policy is due." Delayed by that step's wait.
export interface EscalationJob {
  incidentId: string;
  step: number;
}

// One job per incident and step, so a retried notification can't schedule it twice,
// and acknowledging can find and cancel it by name.
export function escalationJobId(incidentId: string, step: number): string {
  return `escalate-${incidentId}-${step}`;
}

// Cancels the steps still waiting when someone acknowledges.
export interface EscalationCanceller {
  cancel(incidentId: string): Promise<void>;
}

export function queueEscalationCanceller(queue: {
  remove(jobId: string): Promise<unknown>;
}): EscalationCanceller {
  return {
    async cancel(incidentId) {
      for (let step = 1; step < MAX_ESCALATION_STEPS; step++) {
        await queue.remove(escalationJobId(incidentId, step));
      }
    },
  };
}

// Acknowledge links are signed with a key of their own, derived from the encryption
// key, so the two can't be confused. A link names who it was sent to ("u:<user id>"
// or "c:<channel id>"), which the timeline then shows as who acknowledged.
function ackKey(encryptionKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", encryptionKey, "", "seepwatch acknowledge links", 32));
}

export function signAck(encryptionKey: Buffer, incidentId: string, by: string): string {
  return createHmac("sha256", ackKey(encryptionKey))
    .update(`${incidentId}:${by}`)
    .digest("base64url");
}

export function verifyAck(
  encryptionKey: Buffer,
  incidentId: string,
  by: string,
  sig: string,
): boolean {
  const expected = Buffer.from(signAck(encryptionKey, incidentId, by));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function ackLink(webOrigin: string, encryptionKey: Buffer, incidentId: string, by: string) {
  const sig = signAck(encryptionKey, incidentId, by);
  return `${webOrigin}/ack/${incidentId}?by=${encodeURIComponent(by)}&sig=${sig}`;
}
