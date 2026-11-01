// The rules of an incident's life, shared by the API (which moves it) and the worker
// (which alerts about it). Pure on purpose: no database, no clock, no queue, so every
// rule can be pinned down by a unit test.
import type { IncidentStatus } from "./generated/prisma/client.js";

// An unacknowledged leak is repeated every hour once the policy's steps run out.
export const OPEN_REMINDER_MS = 60 * 60 * 1000;
// Acknowledged is not fixed. Whoever is on it hears again until it's revoked.
export const ACK_REMINDER_MS = 4 * 60 * 60 * 1000;

export const CLOSED: readonly IncidentStatus[] = ["REVOKED", "FALSE_POSITIVE", "RISK_ACCEPTED"];
export const isClosed = (status: IncidentStatus) => CLOSED.includes(status);

export type Action = "ACKNOWLEDGE" | "REVOKE" | "FALSE_POSITIVE" | "ACCEPT_RISK";

const TARGET: Record<Action, IncidentStatus> = {
  ACKNOWLEDGE: "ACKNOWLEDGED",
  REVOKE: "REVOKED",
  FALSE_POSITIVE: "FALSE_POSITIVE",
  ACCEPT_RISK: "RISK_ACCEPTED",
};

// Where an action takes an incident, or null if it can't be taken from here. A
// closed incident stays closed; acknowledging twice changes nothing.
export function nextStatus(current: IncidentStatus, action: Action): IncidentStatus | null {
  if (isClosed(current)) return null;
  if (action === "ACKNOWLEDGE" && current !== "OPEN") return null;
  return TARGET[action];
}

// Closing without revoking needs a reason someone can read later.
export const needsReason = (action: Action) =>
  action === "FALSE_POSITIVE" || action === "ACCEPT_RISK";

// Who hears a round: the people of some of the policy's steps (by index), everyone
// the owner set up (no policy), or nobody.
export type Audience = { steps: number[] } | "everyone" | "nobody";

export type RoundKind =
  // The first alert about a new leak.
  | "new"
  // The next step of the policy, because nobody acknowledged it.
  | "escalated"
  // Nobody acknowledged it and the steps ran out: everyone alerted hears again.
  | "unacknowledged"
  // Someone is on it but hasn't revoked it.
  | "acknowledged"
  // It's over: everyone alerted hears how it ended.
  | "closed";

export interface Round {
  kind: RoundKind;
  audience: Audience;
  // When the round after this one is due, from now. Null: no more rounds.
  nextInMs: number | null;
}

const stepsUpTo = (n: number): Audience =>
  n > 0 ? { steps: Array.from({ length: n }, (_, i) => i) } : "nobody";

// What round `round` (0 is the first alert) of an incident in `status` does.
// `stepWaits` is each policy step's wait in minutes, or empty without a policy.
export function planRound(status: IncidentStatus, round: number, stepWaits: number[]): Round {
  const n = stepWaits.length;
  // Everyone alerted in rounds before this one.
  const alerted: Audience =
    n === 0 ? (round > 0 ? "everyone" : "nobody") : stepsUpTo(Math.min(round, n));

  if (isClosed(status)) return { kind: "closed", audience: alerted, nextInMs: null };
  if (status === "ACKNOWLEDGED") {
    return { kind: "acknowledged", audience: alerted, nextInMs: ACK_REMINDER_MS };
  }

  if (n === 0) {
    return round === 0
      ? { kind: "new", audience: "everyone", nextInMs: OPEN_REMINDER_MS }
      : { kind: "unacknowledged", audience: "everyone", nextInMs: OPEN_REMINDER_MS };
  }
  if (round < n) {
    const nextWait = stepWaits[round + 1];
    return {
      kind: round === 0 ? "new" : "escalated",
      audience: { steps: [round] },
      nextInMs: nextWait === undefined ? OPEN_REMINDER_MS : nextWait * 60_000,
    };
  }
  return { kind: "unacknowledged", audience: alerted, nextInMs: OPEN_REMINDER_MS };
}
