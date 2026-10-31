import { randomInt } from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { sha256 } from "./tokens.js";

export function newTotpSecret(): string {
  return generateSecret();
}

// What an authenticator app needs: the otpauth:// link, as text and as a QR code.
export async function setupPayload(email: string, secret: string) {
  const otpauthUrl = generateURI({ issuer: "Seepwatch", label: email, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
  return { secret, otpauthUrl, qrDataUrl };
}

// Returns the time step the code belongs to, or null if it is wrong. A 30 second
// tolerance absorbs clock drift on the phone; codes at or before the last accepted
// step are refused, so a code seen over someone's shoulder cannot be replayed.
export async function checkTotp(
  secret: string,
  code: string,
  lastStep: number | null,
): Promise<number | null> {
  try {
    const result = await verify({
      secret,
      token: code,
      epochTolerance: 30,
      afterTimeStep: lastStep ?? undefined,
    });
    // otplib's shared result type covers HOTP too; TOTP results also carry timeStep.
    return result.valid && "timeStep" in result && typeof result.timeStep === "number"
      ? result.timeStep
      : null;
  } catch {
    return null;
  }
}

// No 0/o, 1/l/i: backup codes get read off paper and typed by hand.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const BACKUP_CODE_COUNT = 10;

export function generateBackupCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const chars = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]);
    return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
  });
  return { codes, hashes: codes.map(hashBackupCode) };
}

// Ignores case, spaces and dashes, so "ABCD EFGH" matches "abcd-efgh".
export function hashBackupCode(input: string): string {
  return sha256(input.toLowerCase().replace(/[^a-z0-9]/g, ""));
}
