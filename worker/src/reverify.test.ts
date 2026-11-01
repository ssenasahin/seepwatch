import { beforeEach, describe, expect, it } from "vitest";
import { MAX_VERIFY_FAILURES, reverifyWatches } from "./reverify.js";
import { prisma, makeOwner, resetDatabase } from "./test/database.js";

const TOKEN = "seepwatch-verify=abc";
const DAY = 86_400_000;
let records: Record<string, string[][]>;
let files: Record<string, string>;

const deps = () => ({
  prisma,
  resolveTxt: async (name: string) => {
    const found = records[name];
    if (!found) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return found;
  },
  fetchGithubFile: async (org: string) => files[org] ?? null,
});

let ownerId: string;
beforeEach(async () => {
  await resetDatabase();
  records = {};
  files = {};
  ownerId = (await makeOwner()).id;
});

function proven(
  kind: "DOMAIN" | "GITHUB_ORG",
  value: string,
  lastVerifyAt = new Date(Date.now() - 2 * DAY),
) {
  return prisma.watch.create({
    data: { ownerId, kind, value, verifyToken: TOKEN, verifiedAt: lastVerifyAt, lastVerifyAt },
  });
}

describe("reverifyWatches", () => {
  it("keeps watches whose proof is still there, and forgets earlier misses", async () => {
    const domain = await proven("DOMAIN", "acme.dev");
    const org = await proven("GITHUB_ORG", "acme");
    await prisma.watch.update({ where: { id: domain.id }, data: { verifyFailures: 2 } });
    records["_seepwatch.acme.dev"] = [[TOKEN]];
    files.acme = `${TOKEN}\n`;

    expect(await reverifyWatches(deps())).toEqual({ checked: 2, revoked: 0 });
    for (const id of [domain.id, org.id]) {
      const after = await prisma.watch.findUniqueOrThrow({ where: { id } });
      expect(after).toMatchObject({ verifyFailures: 0, lastVerifyError: null });
      expect(after.verifiedAt).not.toBeNull();
    }
  });

  it("takes the verification away after three missing days in a row", async () => {
    const domain = await proven("DOMAIN", "acme.dev");
    let now = Date.now();
    for (let day = 1; day <= MAX_VERIFY_FAILURES; day++) {
      const { revoked } = await reverifyWatches(deps(), new Date(now));
      const after = await prisma.watch.findUniqueOrThrow({ where: { id: domain.id } });
      if (day < MAX_VERIFY_FAILURES) {
        expect(revoked).toBe(0);
        expect(after.verifyFailures).toBe(day);
        expect(after.verifiedAt).not.toBeNull();
        expect(after.lastVerifyError).toMatch(/No TXT record/);
      } else {
        expect(revoked).toBe(1);
        expect(after.verifiedAt).toBeNull();
        expect(after.lastVerifyError).toMatch(/scanning stopped/);
      }
      now += DAY;
    }
  });

  it("leaves watches checked within the day alone", async () => {
    await proven("DOMAIN", "acme.dev", new Date(Date.now() - 3_600_000));
    expect(await reverifyWatches(deps())).toEqual({ checked: 0, revoked: 0 });
  });
});
