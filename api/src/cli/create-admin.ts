// Creates the platform's super admin, or promotes an existing account.
// Run with `npm run admin:create`. The password is typed at a hidden prompt and
// never passes through a file, an environment variable or the shell history.
import { prisma } from "@seepwatch/db";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { z } from "zod";
import { hashPassword, passwordProblem } from "../auth/password.js";
import { revokeAllSessions } from "../auth/sessions.js";

// Made from a shell on the server, not by a signed-in admin, so the log says so.
const recordCreation = (id: string, email: string, promoted: boolean) =>
  prisma.auditLog.create({
    data: {
      actorEmail: "command line (npm run admin:create)",
      action: "admin.create",
      targetId: id,
      target: email,
      detail: { promoted },
    },
  });

async function main() {
  const email = z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email())
    .parse(await askVisible("Admin email: "));

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: "SUPER_ADMIN" } });
    // Old sessions carry the old role; ending them makes the change clean.
    await revokeAllSessions(prisma, existing.id);
    await recordCreation(existing.id, email, true);
    console.log(`\n${email} is now a super admin. Sign in again to pick up the new role.`);
  } else {
    const password = await askHidden("Password (at least 12 characters): ");
    const problem = passwordProblem(password, email);
    if (problem) throw new Error(problem);
    if ((await askHidden("Repeat the password: ")) !== password) {
      throw new Error("The passwords didn't match.");
    }
    const created = await prisma.user.create({
      data: { email, passwordHash: await hashPassword(password), role: "SUPER_ADMIN" },
    });
    await recordCreation(created.id, email, false);
    console.log(`\nCreated super admin ${email}.`);
  }
  console.log("Sign in and turn on two-factor sign-in before opening the admin panel.");
}

// When input is piped, one reader must serve every question: a reader per question
// would buffer all the piped lines into the first one and leave the rest empty.
let pipedLines: AsyncIterator<string> | undefined;

async function askVisible(question: string): Promise<string> {
  if (!stdin.isTTY) {
    stdout.write(question);
    pipedLines ??= createInterface({ input: stdin })[Symbol.asyncIterator]();
    const { value } = await pipedLines.next();
    stdout.write("\n");
    return typeof value === "string" ? value : "";
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

// Reads a line in raw mode, echoing nothing, so the password never appears on screen.
function askHidden(question: string): Promise<string> {
  if (!stdin.isTTY) return askVisible(question);
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          // Ctrl+C
          stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
