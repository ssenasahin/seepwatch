import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

// Who an escalation step reaches: a team member by email, or one of the owner's channels.
export type EscalationTarget =
  { kind: "member"; userId: string } | { kind: "channel"; channelId: string };

export interface EscalationStep {
  // How long after the previous step this one fires, if nobody has acknowledged.
  // The first step's is 0: it's who hears about the leak at once.
  waitMinutes: number;
  targets: EscalationTarget[];
}

export const MAX_ESCALATION_STEPS = 5;

// escalation_policies.steps, read back. The API wrote it, so it's trusted to have
// this shape; anything else reads as no steps rather than throwing mid-incident.
export function readSteps(json: unknown): EscalationStep[] {
  return Array.isArray(json) ? (json as EscalationStep[]) : [];
}

// Links in alerts are signed with a key of their own, derived from the encryption
// key, so the two can't be confused. A link names who it was sent to ("u:<user id>"
// or "c:<channel id>"), which the timeline then shows as who acted.
function linkKey(encryptionKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", encryptionKey, "", "seepwatch incident links", 32));
}

export function signRespond(encryptionKey: Buffer, incidentId: string, by: string): string {
  return createHmac("sha256", linkKey(encryptionKey))
    .update(`${incidentId}:${by}`)
    .digest("base64url");
}

export function verifyRespond(
  encryptionKey: Buffer,
  incidentId: string,
  by: string,
  sig: string,
): boolean {
  const expected = Buffer.from(signRespond(encryptionKey, incidentId, by));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Opens a page with two buttons, "I'm on it" and "Revoked". The link itself changes
// nothing: mail scanners open every link they see.
export function respondLink(
  webOrigin: string,
  encryptionKey: Buffer,
  incidentId: string,
  by: string,
) {
  const sig = signRespond(encryptionKey, incidentId, by);
  return `${webOrigin}/respond/${incidentId}?by=${encodeURIComponent(by)}&sig=${sig}`;
}
