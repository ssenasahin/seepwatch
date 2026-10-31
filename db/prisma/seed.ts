// Fills a fresh database with a demo account and a few others for the admin panel.
// Watches, findings and incidents join it once the scanners exist.
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { createPrisma } from "../src/index.js";

const prisma = createPrisma();

const DEMO_EMAIL = "demo@seepwatch.dev";
const DAY = 24 * 60 * 60 * 1000;

// Other customers, so the admin pages have accounts to show: one on the Team plan,
// one suspended, one locked out. Their password is random and never printed, so
// nobody can sign in as them.
const OTHER_ACCOUNTS: {
  email: string;
  daysAgo: number;
  plan?: string;
  state?: "suspended" | "locked";
}[] = [
  { email: "maya@brightlane.example", daysAgo: 21, plan: "Team" },
  { email: "jon@oakhaven.example", daysAgo: 17, state: "suspended" },
  { email: "lena@quietpeak.example", daysAgo: 9, state: "locked" },
  { email: "sam@harborline.example", daysAgo: 3 },
];

async function seedOtherAccounts(now: number) {
  const team = await prisma.plan.findUnique({ where: { name: "Team" } });
  const passwordHash = await argon2.hash(randomBytes(24).toString("base64url"));
  for (const a of OTHER_ACCOUNTS) {
    const data = {
      planId: a.plan === "Team" ? (team?.id ?? null) : null,
      suspendedAt: a.state === "suspended" ? new Date(now - 2 * DAY) : null,
      failedLogins: a.state === "locked" ? 5 : 0,
      lockedUntil: a.state === "locked" ? new Date(now + 15 * 60_000) : null,
    };
    await prisma.user.upsert({
      where: { email: a.email },
      update: data,
      create: {
        email: a.email,
        passwordHash,
        createdAt: new Date(now - a.daysAgo * DAY),
        ...data,
      },
    });
  }
}

async function main() {
  // The demo password comes from the environment so no credential lives in the repo.
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) {
    throw new Error("Set SEED_DEMO_PASSWORD in .env before seeding.");
  }

  await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, passwordHash: await argon2.hash(password) },
  });
  await seedOtherAccounts(Date.now());

  console.log(`Seeded ${DEMO_EMAIL} plus ${OTHER_ACCOUNTS.length} other accounts.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
