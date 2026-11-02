import type { Prisma, PrismaClient } from "@seepwatch/db";
import { HttpError } from "./http.js";

export interface Limits {
  plan: string;
  maxWatches: number;
  maxChannels: number;
  maxApiKeys: number;
}

// Used only if the plans table has no default, which the migration makes unlikely.
export const BUILT_IN_LIMITS: Limits = {
  plan: "Built-in",
  maxWatches: 10,
  maxChannels: 20,
  maxApiKeys: 10,
};

const limitFields = {
  name: true,
  maxWatches: true,
  maxChannels: true,
  maxApiKeys: true,
} as const;

// The account's own plan if an admin gave it one, otherwise the default plan.
type Db = Prisma.TransactionClient;

export async function limitsOf(prisma: Db, userId: string): Promise<Limits> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: { select: limitFields } },
  });
  const plan =
    user?.plan ??
    (await prisma.plan.findFirst({ where: { isDefault: true }, select: limitFields }));
  if (!plan) return BUILT_IN_LIMITS;
  const { name, ...limits } = plan;
  return { plan: name, ...limits };
}

const COUNTERS = {
  watches: {
    limit: (l: Limits) => l.maxWatches,
    count: (p: Db, ownerId: string) => p.watch.count({ where: { ownerId } }),
    message: (n: number) => `Your plan allows up to ${n} watches`,
  },
  channels: {
    limit: (l: Limits) => l.maxChannels,
    count: (p: Db, ownerId: string) => p.notificationChannel.count({ where: { ownerId } }),
    message: (n: number) => `Your plan allows up to ${n} channels`,
  },
  apiKeys: {
    limit: (l: Limits) => l.maxApiKeys,
    count: (p: Db, ownerId: string) => p.apiKey.count({ where: { ownerId, revokedAt: null } }),
    message: (n: number) =>
      `Your plan allows up to ${n} active keys. Revoke one you no longer use.`,
  },
};

// Adds one more of something, unless the plan's limit is reached. Counting and
// adding happen in one transaction, holding a lock on this owner's count, so twenty
// requests at once can't all see room for one more.
export async function withRoomFor<T>(
  prisma: PrismaClient,
  userId: string,
  what: keyof typeof COUNTERS,
  add: (tx: Db) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${what}:${userId}`}))`;
    const counter = COUNTERS[what];
    const max = counter.limit(await limitsOf(tx, userId));
    if ((await counter.count(tx, userId)) >= max) {
      throw new HttpError(403, counter.message(max));
    }
    return add(tx);
  });
}
