import { looksMadeUp } from "@seepwatch/db";
import { z } from "zod";

const MADE_UP = "doesn't look random; generate one with the command in .env.example";

// Checked once at start-up, like the API's, so a typo stops the worker immediately.
const schema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().default("redis://127.0.0.1:6379"),
  // Links in alert emails point here.
  WEB_ORIGIN: z.url(),
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("Seepwatch <alerts@seepwatch.local>"),
  // The API's key, to open channel settings and sign links in alerts.
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded")
    .refine((v) => !looksMadeUp(Buffer.from(v, "base64")), MADE_UP),
  // Optional, but without it GitHub allows 60 requests an hour and code search none.
  GITHUB_TOKEN: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  // Watches scanned at once. GitHub's limits, not the CPU, are what this protects.
  SCAN_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  // Pastebin's scraping API answers only an IP address registered with a lifetime Pro
  // account. Set this to "true" on a machine that is.
  PASTEBIN_SCRAPING: z
    .enum(["true", "false", ""])
    .default("false")
    .transform((v) => v === "true"),
});

export type WorkerEnv = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${problems.join("\n")}`);
  }
  return result.data;
}
