// Redis connections for the BullMQ queues. The scan and notification queues arrive
// with the scanners; for now only the connection helper lives here.
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
