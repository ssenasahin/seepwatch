import { describe, expect, it } from "vitest";
import { afterFailedSignIn, isLocked, LOCK_DURATION_MS, MAX_FAILED_SIGN_INS } from "./lockout.js";

const now = new Date("2026-10-27T10:00:00Z");

describe("afterFailedSignIn", () => {
  it("keeps counting below the limit", () => {
    expect(afterFailedSignIn(MAX_FAILED_SIGN_INS - 1, now)).toEqual({
      failedLogins: MAX_FAILED_SIGN_INS - 1,
      lockedUntil: null,
    });
  });

  it("locks for 15 minutes on the fifth failure and resets the count", () => {
    const next = afterFailedSignIn(MAX_FAILED_SIGN_INS, now);
    expect(next.failedLogins).toBe(0);
    expect(next.lockedUntil?.getTime()).toBe(now.getTime() + LOCK_DURATION_MS);
  });
});

describe("isLocked", () => {
  it("is locked until the moment the lock expires", () => {
    const until = new Date(now.getTime() + 1000);
    expect(isLocked(until, now)).toBe(true);
    expect(isLocked(until, new Date(now.getTime() + 1000))).toBe(false);
  });

  it("is unlocked when no lock was ever set", () => {
    expect(isLocked(null, now)).toBe(false);
  });
});
