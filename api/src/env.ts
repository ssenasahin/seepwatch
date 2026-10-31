import { z } from "zod";

// Validate configuration once at startup, so a missing variable stops the process
// with a clear message instead of failing later on the first request that needs it.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url(),
  WEB_ORIGIN: z.url(),
  // Where the job queues live; the worker reads the same ones.
  REDIS_URL: z.url().default("redis://127.0.0.1:6379"),
  // Signs access tokens. Anyone holding it can mint a token for any user.
  JWT_SECRET: z.string().min(32, "must be at least 32 characters"),
  // Encrypts TOTP secrets and channel tokens at rest. Losing it makes them unreadable.
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded"),
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("Seepwatch <alerts@seepwatch.local>"),
  // How many reverse proxies sit in front of the API; needed to read the client's real IP.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${problems.join("\n")}`);
  }
  return result.data;
}
