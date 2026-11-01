// Runs the scanners, the nightly re-verification and the alert rounds of incidents.
import {
  ALERTS_QUEUE,
  fingerprintKey,
  githubFileFetcher,
  parseEncryptionKey,
  prisma,
  redisConnection,
  resolveTxt,
  SCANS_QUEUE,
  smtpMailer,
  type ScanJob,
} from "@seepwatch/db";
import { Queue, Worker } from "bullmq";
import { dueIncidents, runRound, type AlertDeps } from "./alerts.js";
import { loadEnv } from "./env.js";
import { httpGithub } from "./github.js";
import { reverifyWatches } from "./reverify.js";
import { dueWatches, runScan, scanJobId, type ScanDeps } from "./scan.js";

// Clock-driven jobs: finding due watches, and re-verifying proven ones.
const MAINTENANCE_QUEUE = "maintenance";
const ENQUEUE_EVERY_MS = 60_000;
// Alerts are looked for twice a minute, so a new leak is never more than half a
// minute from its first alert.
const ALERTS_EVERY_MS = 30_000;

const env = loadEnv();
const connection = redisConnection(env.REDIS_URL);
connection.on("error", (err) => console.error("redis:", err.message));

const scans = new Queue<ScanJob>(SCANS_QUEUE, { connection });
const maintenance = new Queue(MAINTENANCE_QUEUE, { connection });
const alerts = new Queue(ALERTS_QUEUE, { connection });
const encryptionKey = parseEncryptionKey(env.ENCRYPTION_KEY);

const scanDeps: ScanDeps = {
  prisma,
  github: httpGithub(env.GITHUB_TOKEN),
  fingerprintKey: fingerprintKey(encryptionKey),
};

const alertDeps: AlertDeps = {
  prisma,
  mailer: smtpMailer({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM,
  }),
  webOrigin: env.WEB_ORIGIN,
  encryptionKey,
};

// Every minute: queue the watches whose turn has come.
await maintenance.upsertJobScheduler(
  "enqueue-scans",
  { every: ENQUEUE_EVERY_MS },
  { name: "enqueue-scans", opts: { removeOnComplete: true, removeOnFail: { count: 30 } } },
);
// Every night at 03:00, server time.
await maintenance.upsertJobScheduler(
  "reverify",
  { pattern: "0 3 * * *" },
  { name: "reverify", opts: { removeOnComplete: true, removeOnFail: { count: 30 } } },
);

await alerts.upsertJobScheduler(
  "send-due-alerts",
  { every: ALERTS_EVERY_MS },
  { name: "send-due-alerts", opts: { removeOnComplete: true, removeOnFail: { count: 30 } } },
);

const scanWorker = new Worker<ScanJob>(
  SCANS_QUEUE,
  async (job) => {
    const result = await runScan(scanDeps, job.data);
    if (result?.error) console.warn(`scan of ${job.data.watchId} stopped short: ${result.error}`);
  },
  { connection, concurrency: env.SCAN_CONCURRENCY },
);

const maintenanceWorker = new Worker(
  MAINTENANCE_QUEUE,
  async (job) => {
    if (job.name === "enqueue-scans") {
      const ids = await dueWatches(prisma);
      // A job id per watch: one still waiting or running isn't added again.
      await scans.addBulk(
        ids.map((watchId) => ({
          name: "scan",
          data: { watchId },
          opts: { jobId: scanJobId(watchId), removeOnComplete: true, removeOnFail: true },
        })),
      );
      return;
    }
    const { checked, revoked } = await reverifyWatches({
      prisma,
      resolveTxt,
      fetchGithubFile: githubFileFetcher(env.GITHUB_TOKEN),
    });
    console.log(`re-verified ${checked} watches; ${revoked} lost their verification`);
  },
  { connection },
);

// One run at a time: each round is claimed in the database, but sending them in
// order keeps the timeline readable.
const alertWorker = new Worker(
  ALERTS_QUEUE,
  async () => {
    let sent = 0;
    for (const id of await dueIncidents(prisma)) {
      if (await runRound(alertDeps, id)) sent++;
    }
    if (sent > 0) console.log(`sent ${sent} alert rounds`);
  },
  { connection },
);

for (const worker of [scanWorker, maintenanceWorker, alertWorker]) {
  worker.on("failed", (job, err) => {
    console.error(`${worker.name} job ${job?.id ?? "?"} failed:`, err.message);
  });
}

if (!env.GITHUB_TOKEN) {
  console.warn("GITHUB_TOKEN isn't set: organization scans will be slow and code search is off");
}
console.log(`seepwatch worker running ${env.SCAN_CONCURRENCY} scans at a time`);

// Let running scans finish, then close Redis and database connections.
async function shutdown() {
  await Promise.all([scanWorker.close(), maintenanceWorker.close(), alertWorker.close()]);
  await Promise.all([scans.close(), maintenance.close(), alerts.close(), prisma.$disconnect()]);
  await connection.quit();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
