import argon2 from "argon2";
import common from "./common-passwords.json" with { type: "json" };

export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;

// The NCSC's 100,000 most used passwords, keeping only those long enough to pass
// the length rule; shorter ones are already rejected by it.
const COMMON = new Set<string>(common);

// argon2id is memory-hard: guessing on GPUs costs memory as well as time.
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

// When the email is unknown we still run a full verify against this hash, so the
// response takes as long as a real wrong password and timing reveals nothing.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("seepwatch-timing-equaliser-not-a-real-password");
  await verifyPassword(await dummyHash, password);
}

// Returns why a new password is unacceptable, or null if it is fine.
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) {
    return "This password appears in lists of commonly used passwords.";
  }
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) {
    return "Don't build your password from your email address.";
  }
  if (new Set(lower).size < 5) {
    return "Use a greater variety of characters.";
  }
  return null;
}
