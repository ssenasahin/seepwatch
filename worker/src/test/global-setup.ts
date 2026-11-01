import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TEST_DATABASE_URL } from "./database.js";

// Brings the shared test database up to the latest schema before any test runs.
export default function setup() {
  execSync("npx prisma migrate deploy", {
    cwd: fileURLToPath(new URL("../../../db", import.meta.url)),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
