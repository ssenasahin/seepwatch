import { ALERTS_QUEUE, prisma, redisConnection, SCANS_QUEUE, smtpMailer } from "@seepwatch/db";
import { Queue } from "bullmq";
import { queueProbe } from "./admin/system.js";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const mailer = smtpMailer({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  user: env.SMTP_USER,
  pass: env.SMTP_PASS,
  from: env.MAIL_FROM,
});
const redis = redisConnection(env.REDIS_URL, { failFast: true });
// Without a listener, a lost Redis connection would crash the process.
redis.on("error", (err) => console.error("redis:", err.message));
// Only read here, for the admin panel's queue figures; the worker fills them.
const scans = new Queue(SCANS_QUEUE, { connection: redis });
const alerts = new Queue(ALERTS_QUEUE, { connection: redis });
const app = createApp({
  env,
  prisma,
  mailer,
  system: queueProbe([scans, alerts], redis),
});

const server = app.listen(env.API_PORT, () => {
  console.log(`seepwatch api listening on http://localhost:${env.API_PORT}`);
});

// Finish in-flight requests and close database connections before exiting.
function shutdown() {
  server.close(() => {
    void Promise.all([scans.close(), alerts.close(), prisma.$disconnect()])
      .then(() => redis.quit())
      .then(() => process.exit(0));
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
