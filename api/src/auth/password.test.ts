import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "./password.js";

describe("passwordProblem", () => {
  it("accepts a long, varied passphrase", () => {
    expect(passwordProblem("amber-lantern-over-the-harbour")).toBeNull();
  });

  it("rejects anything shorter than 12 characters", () => {
    expect(passwordProblem("Sh0rt&sweet")).toMatch(/at least 12/);
  });

  it("rejects long passwords that are on the common list", () => {
    expect(passwordProblem("123456123456")).toMatch(/commonly used/);
  });

  it("checks the common list case-insensitively", () => {
    expect(passwordProblem("QWERTYUIOPASDFGHJKL")).toMatch(/commonly used/);
  });

  it("rejects passwords built from the email address", () => {
    expect(passwordProblem("sena.sahin-2026!", "sena.sahin@example.com")).toMatch(/email/);
  });

  it("rejects long passwords made of very few characters", () => {
    expect(passwordProblem("abababababababab")).toMatch(/variety/);
  });
});

describe("hashPassword", () => {
  it("produces an argon2id hash that verifies only the original password", async () => {
    const hash = await hashPassword("amber-lantern-over-the-harbour");

    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "amber-lantern-over-the-harbour")).toBe(true);
    expect(await verifyPassword(hash, "amber-lantern-over-the-harbor")).toBe(false);
  });

  it("salts every hash, so equal passwords never share a hash", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same-password-twice"),
      hashPassword("same-password-twice"),
    ]);
    expect(a).not.toBe(b);
  });
});
