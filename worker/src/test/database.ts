import { createPrisma, type PrismaClient } from "@seepwatch/db";

// The same test database the API's tests use, never the development one.
export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://seepwatch:seepwatch@127.0.0.1:5432/seepwatch_test";

export const prisma: PrismaClient = createPrisma(TEST_DATABASE_URL);

export async function resetDatabase() {
  // Everything hangs off users except the feeds' progress, which belongs to no one.
  await prisma.$executeRawUnsafe("TRUNCATE TABLE users, feed_states CASCADE");
}

export async function makeOwner(email = "ada@example.com") {
  return prisma.user.create({ data: { email, passwordHash: "not-a-real-hash" } });
}
