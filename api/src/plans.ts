import type { PrismaClient } from "@seepwatch/db";
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
export async function limitsOf(prisma: PrismaClient, userId: string): Promise<Limits> {
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
    count: (p: PrismaClient, ownerId: string) => p.watch.count({ where: { ownerId } }),
    message: (n: number) => `Your plan allows up to ${n} watches`,
  },
  channels: {
    limit: (l: Limits) => l.maxChannels,
    count: (p: PrismaClient, ownerId: string) =>
      p.notificationChannel.count({ where: { ownerId } }),
    message: (n: number) => `Your plan allows up to ${n} channels`,
  },
  apiKeys: {
    limit: (l: Limits) => l.maxApiKeys,
    count: (p: PrismaClient, ownerId: string) =>
      p.apiKey.count({ where: { ownerId, revokedAt: null } }),
    message: (n: number) =>
      `Your plan allows up to ${n} active keys. Revoke one you no longer use.`,
  },
};

// Refuses to add one more of something once the plan's limit is reached.
export async function assertRoomFor(
  prisma: PrismaClient,
  userId: string,
  what: keyof typeof COUNTERS,
): Promise<Limits> {
  const limits = await limitsOf(prisma, userId);
  const counter = COUNTERS[what];
  const max = counter.limit(limits);
  if ((await counter.count(prisma, userId)) >= max) {
    throw new HttpError(403, counter.message(max));
  }
  return limits;
}
