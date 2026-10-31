import type { PrismaClient, redisConnection } from "@seepwatch/db";
import type { Queue } from "bullmq";
import { Router } from "express";

type Redis = ReturnType<typeof redisConnection>;

export interface QueueStat {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  // Worker processes connected to this queue right now.
  workers: number;
}

// What the API can learn about the queues and Redis, behind an interface so tests
// don't need a Redis server.
export interface SystemProbe {
  queues(): Promise<QueueStat[]>;
  redisMemoryBytes(): Promise<number | null>;
}

export const noProbe: SystemProbe = {
  queues: async () => [],
  redisMemoryBytes: async () => null,
};

export function queueProbe(queues: Queue[], redis: Redis): SystemProbe {
  return {
    queues: () =>
      Promise.all(
        queues.map(async (q) => {
          const [counts, workers] = await Promise.all([
            q.getJobCounts("waiting", "prioritized", "active", "delayed", "failed"),
            q.getWorkersCount(),
          ]);
          return {
            name: q.name,
            waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0),
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            failed: counts.failed ?? 0,
            workers,
          };
        }),
      ),
    async redisMemoryBytes() {
      const info = await redis.info("memory");
      const match = /^used_memory:(\d+)/m.exec(info);
      return match ? Number(match[1]) : null;
    },
  };
}

export function systemRouter(prisma: PrismaClient, probe: SystemProbe) {
  const router = Router();

  router.get("/health", async (_req, res) => {
    const [queues, redisBytes, [{ bytes }], tables, users, liveSessions] = await Promise.all([
      // A probe that fails (Redis down) shouldn't hide the rest of the page.
      probe.queues().catch(() => null),
      probe.redisMemoryBytes().catch(() => null),
      prisma.$queryRaw<[{ bytes: bigint }]>`SELECT pg_database_size(current_database()) AS bytes`,
      prisma.$queryRaw<{ name: string; bytes: bigint }[]>`
        SELECT relname AS name, pg_total_relation_size(relid) AS bytes
        FROM pg_catalog.pg_statio_user_tables
        ORDER BY bytes DESC
        LIMIT 6`,
      prisma.user.count(),
      prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);

    res.json({
      generatedAt: new Date(),
      queues,
      // Unknown, not zero, while no queue exists for a worker to connect to.
      workers: queues?.length ? Math.max(0, ...queues.map((q) => q.workers)) : null,
      database: {
        bytes: Number(bytes),
        tables: tables.map((t) => ({ name: t.name, bytes: Number(t.bytes) })),
      },
      redis: { bytes: redisBytes },
      users,
      liveSessions,
    });
  });

  return router;
}
