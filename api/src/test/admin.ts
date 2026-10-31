import type request from "supertest";
import { enableTwoFactor, makeApp, prisma, signUp } from "./helpers.js";

// A super admin with two-factor on, and a way to send requests as them.
export async function signedInAdmin(app = makeApp(), email = "root@example.com") {
  const { accessToken } = await signUp(app, email);
  await prisma.user.update({ where: { email }, data: { role: "SUPER_ADMIN" } });
  const admin = await enableTwoFactor(app, accessToken);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const as = (test: request.Test) => test.set("Authorization", `Bearer ${admin.accessToken}`);
  return { app, as, id: user.id };
}

// Back to the plans the migration creates, since plans outlive the users table.
export async function resetPlans() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE plans CASCADE`);
  await prisma.plan.createMany({
    data: [
      { name: "Free", maxWatches: 10, maxChannels: 20, maxApiKeys: 10, isDefault: true },
      { name: "Team", maxWatches: 50, maxChannels: 50, maxApiKeys: 25 },
    ],
  });
}
