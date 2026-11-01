// Redis connections and the names of the BullMQ queues the API and the worker share.
import { Redis } from "ioredis";

// BullMQ wants a ready-made client in an ES module project. The worker waits out a
// Redis restart (maxRetriesPerRequest: null) rather than failing every job; the API
// fails fast instead, so a request never hangs on an unreachable Redis.
export function redisConnection(url: string, { failFast = false } = {}): Redis {
  return new Redis(
    url,
    failFast
      ? { maxRetriesPerRequest: 1, enableOfflineQueue: false }
      : { maxRetriesPerRequest: null },
  );
}

// One watch to scan, or (with no watch) the job that finds which watches are due.
export const SCANS_QUEUE = "scans";

export interface ScanJob {
  watchId: string;
}
