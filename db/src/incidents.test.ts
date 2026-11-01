import { describe, expect, it } from "vitest";
import { ACK_REMINDER_MS, nextStatus, OPEN_REMINDER_MS, planRound } from "./incidents.js";

describe("nextStatus", () => {
  it("acknowledges an open incident only", () => {
    expect(nextStatus("OPEN", "ACKNOWLEDGE")).toBe("ACKNOWLEDGED");
    expect(nextStatus("ACKNOWLEDGED", "ACKNOWLEDGE")).toBeNull();
  });

  it("closes an open or acknowledged incident, three ways", () => {
    for (const from of ["OPEN", "ACKNOWLEDGED"] as const) {
      expect(nextStatus(from, "REVOKE")).toBe("REVOKED");
      expect(nextStatus(from, "FALSE_POSITIVE")).toBe("FALSE_POSITIVE");
      expect(nextStatus(from, "ACCEPT_RISK")).toBe("RISK_ACCEPTED");
    }
  });

  it("never moves a closed incident", () => {
    for (const from of ["REVOKED", "FALSE_POSITIVE", "RISK_ACCEPTED"] as const) {
      for (const action of ["ACKNOWLEDGE", "REVOKE", "FALSE_POSITIVE", "ACCEPT_RISK"] as const) {
        expect(nextStatus(from, action)).toBeNull();
      }
    }
  });
});

describe("planRound", () => {
  // Step 0 at once, step 1 after 10 minutes, step 2 after 30 more.
  const policy = [0, 10, 30];

  it("walks the policy's steps while nobody acknowledges", () => {
    expect(planRound("OPEN", 0, policy)).toEqual({
      kind: "new",
      audience: { steps: [0] },
      nextInMs: 10 * 60_000,
    });
    expect(planRound("OPEN", 1, policy)).toEqual({
      kind: "escalated",
      audience: { steps: [1] },
      nextInMs: 30 * 60_000,
    });
    expect(planRound("OPEN", 2, policy)).toEqual({
      kind: "escalated",
      audience: { steps: [2] },
      nextInMs: OPEN_REMINDER_MS,
    });
  });

  it("keeps reminding everyone alerted once the steps run out", () => {
    for (const round of [3, 4, 50]) {
      expect(planRound("OPEN", round, policy)).toEqual({
        kind: "unacknowledged",
        audience: { steps: [0, 1, 2] },
        nextInMs: OPEN_REMINDER_MS,
      });
    }
  });

  it("stops escalating once acknowledged, but keeps reminding who was alerted", () => {
    expect(planRound("ACKNOWLEDGED", 2, policy)).toEqual({
      kind: "acknowledged",
      audience: { steps: [0, 1] },
      nextInMs: ACK_REMINDER_MS,
    });
  });

  it("tells everyone alerted how it ended, then stops", () => {
    expect(planRound("REVOKED", 1, policy)).toEqual({
      kind: "closed",
      audience: { steps: [0] },
      nextInMs: null,
    });
    // Closed before the first alert went out: nobody needs to hear about it.
    expect(planRound("FALSE_POSITIVE", 0, policy).audience).toBe("nobody");
  });

  it("alerts everyone at once without a policy, and repeats hourly", () => {
    expect(planRound("OPEN", 0, [])).toEqual({
      kind: "new",
      audience: "everyone",
      nextInMs: OPEN_REMINDER_MS,
    });
    expect(planRound("OPEN", 1, []).kind).toBe("unacknowledged");
    expect(planRound("ACKNOWLEDGED", 1, []).audience).toBe("everyone");
    expect(planRound("RISK_ACCEPTED", 0, []).audience).toBe("nobody");
    expect(planRound("RISK_ACCEPTED", 3, []).audience).toBe("everyone");
  });
});
