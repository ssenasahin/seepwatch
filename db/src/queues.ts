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

// One watch to scan.
export const SCANS_QUEUE = "scans";

export interface ScanJob {
  watchId: string;
}

// Alert rounds that are due. A repeating job looks for them every half minute; the
// API never adds to it, it only moves an incident's next_alert_at.
export const ALERTS_QUEUE = "alerts";
