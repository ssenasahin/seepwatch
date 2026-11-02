import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encrypts sensitive columns (TOTP secrets, channel tokens) before they reach the
// database. AES-256-GCM also authenticates: a tampered value fails to decrypt
// instead of decrypting to garbage.
//
// Stored format: "v1:" + base64url(iv | auth tag | ciphertext). The version
// prefix leaves room to rotate the algorithm or key later.

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

// Too few different characters (or bytes) to have come from a random generator:
// "aaaa…", "changeme" repeated, an all-zero key. Random 32 bytes have about 30
// distinct values, and a random 32-character string about 25.
export const MIN_DISTINCT = 12;
export function looksMadeUp(value: Uint8Array | string): boolean {
  return (
    new Set<string | number>(typeof value === "string" ? value : [...value]).size < MIN_DISTINCT
  );
}

export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString("base64url")}`;
}

export function decryptSecret(stored: string, key: Buffer): string {
  const [version, payload] = stored.split(":");
  if (version !== VERSION || !payload) {
    throw new Error("Unrecognised encrypted value");
  }
  const raw = Buffer.from(payload, "base64url");
  // A cut-short value would otherwise be checked against a cut-short tag.
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error("Unrecognised encrypted value");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
