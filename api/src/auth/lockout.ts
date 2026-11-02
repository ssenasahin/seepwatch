// Wrong passwords from one address before that address is locked out of the account.
// Locking per address means a stranger guessing from theirs can't lock the owner out.
export const MAX_FAILED_SIGN_INS = 5;
// Wrong passwords from everywhere before the account itself locks: only a guesser
// spread over many addresses gets there.
export const ACCOUNT_FAILURE_LIMIT = 50;
// A wrong two-factor code costs this much of that, so five lock the account.
// Whoever is entering codes already has the password, and six digits are guessable.
export const CODE_FAILURE_WEIGHT = ACCOUNT_FAILURE_LIMIT / MAX_FAILED_SIGN_INS;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil > now;
}

// Given the failure count after this attempt, decide whether to lock. Locking resets
// the count, so the next window starts fresh once the lock expires.
export function afterFailedSignIn(
  failures: number,
  now: Date,
  limit: number,
): { failures: number; lockedUntil: Date | null } {
  if (failures >= limit) {
    return { failures: 0, lockedUntil: new Date(now.getTime() + LOCK_DURATION_MS) };
  }
  return { failures, lockedUntil: null };
}
