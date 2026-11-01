import { describe, expect, it } from "vitest";
import {
  detect,
  fingerprint,
  fingerprintKey,
  mask,
  redactedContext,
  type Hit,
} from "./detectors.js";

// Shaped like real keys, but made up. None of them work anywhere. They're put
// together from pieces so no complete key-shaped string sits in the source, where
// GitHub's push protection would rightly stop it.
const k = (...parts: string[]) => parts.join("");
const AWS = k("AK", "IA", "ABCDEFGHIJKLMNOP");
const GITHUB = k("gh", "p_", "a1B2c3D4e5".repeat(3), "abcdef");
const STRIPE = k("sk", "_live_", "x9Y8z7W6v5".repeat(3));
const GOOGLE = k("AI", "za", "Sy0123456789_abcdefghijklmnopqrstuv");
const SLACK = k("xo", "xb-", "123456789012-abcdefABCDEF");
const BEGIN = (kind = "") => k("-----BEGIN ", kind, "PRIVATE ", "KEY-----");
const END = (kind = "") => k("-----END ", kind, "PRIVATE ", "KEY-----");

const ids = (hits: Hit[]) => hits.map((h) => h.detector);

describe("detect", () => {
  it("finds each built-in kind of key", () => {
    const lines = [
      `aws_access_key_id = ${AWS}`,
      `GITHUB_TOKEN=${GITHUB}`,
      `stripe.api_key = "${STRIPE}"`,
      `const maps = '${GOOGLE}';`,
      `SLACK_BOT_TOKEN: ${SLACK}`,
    ];
    expect(ids(detect(lines))).toEqual([
      "aws-access-key",
      "github-token",
      "stripe-live-key",
      "google-api-key",
      "slack-token",
    ]);
    expect(detect(lines)[0]).toMatchObject({ secret: AWS, lineIndex: 0, start: 20 });
  });

  it("ignores test keys and keys inside longer words", () => {
    expect(detect([k("sk", "_test_", "a".repeat(30)), `X${AWS}`])).toEqual([]);
  });

  it("takes a private key up to its footer", () => {
    const lines = [
      "key: |",
      `  ${BEGIN("RSA ")}`,
      "  MIIEowIBAAKCAQEA1234",
      "  abcd5678",
      `  ${END("RSA ")}`,
      "other: value",
    ];
    const [hit] = detect(lines);
    expect(hit!.detector).toBe("private-key");
    expect(hit!.secret.split("\n")).toHaveLength(4);
    expect(mask(hit!.secret)).toBe(`${BEGIN("RSA ")} …5678`);
  });

  it("runs the owner's key patterns too", () => {
    const pattern = { prefix: "acme_", charset: "HEX" as const, minLength: 16, maxLength: 16 };
    const hits = detect(["token = acme_0123456789abcdef"], [pattern]);
    expect(hits).toMatchObject([{ detector: "key-pattern", secret: "acme_0123456789abcdef" }]);
  });

  it("finishes quickly on hostile input", () => {
    const started = Date.now();
    detect([k("AK", "IA").repeat(4000), k("xo", "xb-").repeat(3000), "-".repeat(19_000)]);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("what is kept", () => {
  it("masks all but a few characters", () => {
    expect(mask(AWS)).toBe("AKIA…MNOP");
    expect(mask("short-key")).toBe("sh…");
  });

  it("fingerprints the same secret the same way, and only with the key", () => {
    const key = fingerprintKey(Buffer.alloc(32, 1));
    const other = fingerprintKey(Buffer.alloc(32, 2));
    expect(fingerprint(key, AWS)).toBe(fingerprint(key, AWS));
    expect(fingerprint(key, AWS)).not.toBe(fingerprint(other, AWS));
    expect(fingerprint(key, AWS)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("shows the lines around a hit with every secret in them masked", () => {
    const lines = ["# config", `AWS_KEY=${AWS}`, `GH=${GITHUB}`, "debug = false", "x", "y"];
    const hits = detect(lines);
    const context = redactedContext(lines, hits, 1);
    expect(context).toBe(`# config\nAWS_KEY=AKIA…MNOP\nGH=ghp_…cdef\ndebug = false`);
    expect(context).not.toContain(AWS);
    expect(context).not.toContain(GITHUB);
  });

  it("never shows a private key's body", () => {
    const lines = [BEGIN(), "c2VjcmV0", END()];
    const context = redactedContext(lines, detect(lines), 0);
    expect(context).not.toContain("c2VjcmV0");
    expect(context).toContain("[private key redacted]");
  });
});
