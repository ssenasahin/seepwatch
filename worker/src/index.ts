// Runs the scanners, opens incidents and sends alerts. None of them exist yet: this is
// the process they will live in, with its Redis connection and shutdown in place.
import { prisma, redisConnection } from "@seepwatch/db";
import { loadEnv } from "./env.js";

const env = loadEnv();
const connection = redisConnection(env.REDIS_URL);
connection.on("error", (err) => console.error("redis:", err.message));

console.log("seepwatch worker running, with no scanners yet");

// Close Redis and database connections before exiting.
async function shutdown() {
  await prisma.$disconnect();
  await connection.quit();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
