// Runs the scanners and the daily re-verification. Incidents and alerts come next;
// for now a new finding is logged and waits on the findings page.
import {
  fingerprintKey,
  githubFileFetcher,
  parseEncryptionKey,
  prisma,
  redisConnection,
  resolveTxt,
  SCANS_QUEUE,
  type ScanJob,
} from "@seepwatch/db";
import { Queue, Worker } from "bullmq";
import { loadEnv } from "./env.js";
import { httpGithub } from "./github.js";
import { reverifyWatches } from "./reverify.js";
import { dueWatches, runScan, scanJobId, type ScanDeps } from "./scan.js";

// Clock-driven jobs: finding due watches, and re-verifying proven ones.
const MAINTENANCE_QUEUE = "maintenance";
const ENQUEUE_EVERY_MS = 60_000;

const env = loadEnv();
const connection = redisConnection(env.REDIS_URL);
connection.on("error", (err) => console.error("redis:", err.message));

const scans = new Queue<ScanJob>(SCANS_QUEUE, { connection });
const maintenance = new Queue(MAINTENANCE_QUEUE, { connection });

const scanDeps: ScanDeps = {
  prisma,
  github: httpGithub(env.GITHUB_TOKEN),
  fingerprintKey: fingerprintKey(parseEncryptionKey(env.ENCRYPTION_KEY)),
  onNewFindings: async (ids) => {
    console.log(`${ids.length} new findings`);
  },
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

for (const worker of [scanWorker, maintenanceWorker]) {
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
  await Promise.all([scanWorker.close(), maintenanceWorker.close()]);
  await Promise.all([scans.close(), maintenance.close(), prisma.$disconnect()]);
  await connection.quit();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
