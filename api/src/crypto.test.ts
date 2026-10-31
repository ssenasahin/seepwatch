import { decryptSecret, encryptSecret } from "@seepwatch/db";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

const key = randomBytes(32);

describe("field encryption", () => {
  it("round-trips a secret", () => {
    const stored = encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(stored, key)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("uses a fresh IV, so equal secrets encrypt differently", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("refuses a value that was tampered with", () => {
    const stored = encryptSecret("JBSWY3DPEHPK3PXP", key);
    const bytes = Buffer.from(stored.slice(3), "base64url");
    bytes[bytes.length - 1]! ^= 1;
    expect(() => decryptSecret(`v1:${bytes.toString("base64url")}`, key)).toThrow();
  });

  it("refuses to decrypt with the wrong key", () => {
    const stored = encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow();
  });
});
