import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "Zq3vN8xLp2Rk7TmW5yHc9Ub4Jd6Fg1Ae0Ks",
  ENCRYPTION_KEY: Buffer.from(Array.from({ length: 32 }, (_, i) => i * 7)).toString("base64"),
};

describe("loadEnv", () => {
  it("accepts secrets that look generated", () => {
    expect(loadEnv(base).JWT_SECRET).toBe(base.JWT_SECRET);
  });

  it("refuses secrets that were typed, not generated", () => {
    expect(() => loadEnv({ ...base, JWT_SECRET: "a".repeat(40) })).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({ ...base, JWT_SECRET: "changeme".repeat(5) })).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({ ...base, ENCRYPTION_KEY: Buffer.alloc(32).toString("base64") })).toThrow(
      /ENCRYPTION_KEY/,
    );
  });
});
