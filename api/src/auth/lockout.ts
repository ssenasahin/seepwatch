export const MAX_FAILED_SIGN_INS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil > now;
}

// Given the failure count after this attempt, decide whether the account locks.
// Locking resets the count, so the next window starts fresh once the lock expires.
export function afterFailedSignIn(
  failedLogins: number,
  now: Date,
): { failedLogins: number; lockedUntil: Date | null } {
  if (failedLogins >= MAX_FAILED_SIGN_INS) {
    return { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_DURATION_MS) };
  }
  return { failedLogins, lockedUntil: null };
}
