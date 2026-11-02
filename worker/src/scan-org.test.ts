import { fingerprintKey } from "@seepwatch/db";
import { beforeEach, describe, expect, it } from "vitest";
import { RateLimitError } from "./github.js";
import { COMMITS_PER_REPO, COMMITS_PER_SCAN, FIRST_SCAN_DAYS, scanOrg } from "./scan-org.js";
import { prisma, makeOwner, resetDatabase } from "./test/database.js";
import { AWS, AWS_2, FakeGithub, sha, STRIPE } from "./test/fake-github.js";

const NOW = new Date("2026-11-01T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

let github: FakeGithub;
let watch: { id: string; ownerId: string; value: string; scanCursor: Date | null };
const deps = () => ({ prisma, github, fingerprintKey: fingerprintKey(Buffer.alloc(32, 7)) });

function repo(name: string, extra: { fork?: boolean; archived?: boolean } = {}) {
  github.repos.push({
    fullName: `acme/${name}`,
    pushedAt: hoursAgo(1),
    fork: extra.fork ?? false,
    archived: extra.archived ?? false,
  });
}

function commit(repoName: string, n: number, at: Date, files: Record<string, string> = {}) {
  const repoFull = `acme/${repoName}`;
  github.commits.set(repoFull, [
    ...(github.commits.get(repoFull) ?? []),
    { sha: sha(n), committedAt: at },
  ]);
  github.files.set(
    `${repoFull}@${sha(n)}`,
    Object.entries(files).map(([path, patch]) => ({ path, patch })),
  );
}

beforeEach(async () => {
  await resetDatabase();
  github = new FakeGithub();
  const owner = await makeOwner();
  watch = await prisma.watch.create({
    data: { ownerId: owner.id, kind: "GITHUB_ORG", value: "acme", verifiedAt: NOW },
  });
});

describe("scanOrg", () => {
  it("records keys a commit added, linked to the commit and line", async () => {
    repo("api");
    commit("api", 1, hoursAgo(2), {
      "config/prod.env": `@@ -4,2 +4,3 @@\n HOST=api.acme.dev\n+AWS_KEY=${AWS}\n PORT=443`,
    });

    const result = await scanOrg(deps(), watch, [], NOW);

    expect(result.error).toBeNull();
    expect(result.newFindings).toHaveLength(1);
    const finding = await prisma.finding.findFirstOrThrow({ include: { locations: true } });
    expect(finding).toMatchObject({ detector: "aws-access-key", watchId: watch.id });
    expect(finding.masked).not.toContain(AWS);
    expect(finding.locations).toEqual([
      expect.objectContaining({
        source: "GITHUB_COMMIT",
        repository: "acme/api",
        path: "config/prod.env",
        commitSha: sha(1),
        line: 5,
        url: `https://github.com/acme/api/blob/${sha(1)}/config/prod.env#L5`,
      }),
    ]);
    // Nothing anywhere holds the key itself.
    const stored = JSON.stringify(finding, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    expect(stored).not.toContain(AWS);
  });

  it("ignores keys that were only context or removed", async () => {
    repo("api");
    commit("api", 1, hoursAgo(2), {
      ".env": `@@ -1,2 +1,2 @@\n AWS_KEY=${AWS}\n-OLD=${AWS_2}\n+OLD=gone`,
    });
    const result = await scanOrg(deps(), watch, [], NOW);
    expect(result.newFindings).toEqual([]);
    expect(await prisma.finding.count()).toBe(0);
  });

  it("masks a key on an unchanged line next to a new one", async () => {
    repo("api");
    commit("api", 1, hoursAgo(2), {
      ".env": `@@ -1,1 +1,2 @@\n AWS_KEY=${AWS}\n+STRIPE=${STRIPE}`,
    });
    const result = await scanOrg(deps(), watch, [], NOW);
    expect(result.newFindings).toHaveLength(1);
    const location = await prisma.findingLocation.findFirstOrThrow();
    expect(location.context).toContain("AWS_KEY=AKIA…");
    expect(location.context).not.toContain(AWS);
  });

  it("adds a location, not a finding, when a known key turns up again", async () => {
    repo("api");
    repo("web");
    commit("api", 1, hoursAgo(3), { "a.env": `@@ -0,0 +1 @@\n+K=${AWS}` });
    commit("web", 2, hoursAgo(2), { "b.env": `@@ -0,0 +1 @@\n+K=${AWS}` });

    const first = await scanOrg(deps(), watch, [], NOW);
    expect(first.newFindings).toHaveLength(1);
    expect(await prisma.finding.count()).toBe(1);
    expect(await prisma.findingLocation.count()).toBe(2);

    // Read again: nothing new, and no duplicate locations.
    const again = await scanOrg(deps(), { ...watch, scanCursor: null }, [], NOW);
    expect(again.newFindings).toEqual([]);
    expect(await prisma.findingLocation.count()).toBe(2);
  });

  it("finds the owner's own key patterns", async () => {
    repo("api");
    const key = "acme_live_" + "Q".repeat(24);
    commit("api", 1, hoursAgo(2), { "x.ts": `@@ -0,0 +1 @@\n+const k = "${key}";` });
    const result = await scanOrg(
      deps(),
      watch,
      [{ prefix: "acme_live_", charset: "ALNUM", minLength: 20, maxLength: 30 }],
      NOW,
    );
    expect(result.newFindings).toHaveLength(1);
    expect((await prisma.finding.findFirstOrThrow()).detector).toBe("key-pattern");
  });

  it("skips forks and archived repositories", async () => {
    repo("fork", { fork: true });
    repo("old", { archived: true });
    commit("fork", 1, hoursAgo(2), { a: `@@ -0,0 +1 @@\n+${AWS}` });
    commit("old", 2, hoursAgo(2), { a: `@@ -0,0 +1 @@\n+${AWS}` });
    await scanOrg(deps(), watch, [], NOW);
    expect(await prisma.finding.count()).toBe(0);
  });

  it("looks back 30 days the first time, then from the cursor", async () => {
    repo("api");
    commit("api", 1, hoursAgo(24 * (FIRST_SCAN_DAYS + 1)), { a: `@@ -0,0 +1 @@\n+${AWS}` });
    commit("api", 2, hoursAgo(5), { b: `@@ -0,0 +1 @@\n+${AWS_2}` });

    const first = await scanOrg(deps(), watch, [], NOW);
    expect(first.newFindings).toHaveLength(1);
    expect(first.cursor).toEqual(NOW);

    const later = await scanOrg(deps(), { ...watch, scanCursor: hoursAgo(4) }, [], NOW);
    expect(later.newFindings).toEqual([]);
    // Repositories, commits and one commit's files; then repositories and commits.
    expect(github.calls).toBe(3 + 2);
  });

  it("stops after a batch of commits and continues from the last one read", async () => {
    const names = ["a", "b", "c"];
    names.forEach((name) => repo(name));
    // Spread over three repositories, so the oldest-first order has to be merged.
    for (let n = 1; n <= COMMITS_PER_SCAN + 10; n++) {
      commit(names[n % 3]!, n, hoursAgo(300 - n));
    }
    const result = await scanOrg(deps(), watch, [], NOW);
    expect(result.error).toBeNull();
    expect(result.cursor).toEqual(hoursAgo(300 - COMMITS_PER_SCAN));
  });

  it("says so when a repository had more new commits than it reads", async () => {
    repo("busy");
    for (let n = 1; n <= COMMITS_PER_REPO + 1; n++) commit("busy", n, hoursAgo(600 - n));
    const result = await scanOrg(deps(), watch, [], NOW);
    expect(result.error).toBe(
      `acme/busy had more than ${COMMITS_PER_REPO} new commits; the oldest weren't read.`,
    );
  });

  it("keeps what it read when the rate limit runs out", async () => {
    repo("api");
    commit("api", 1, hoursAgo(3), { a: `@@ -0,0 +1 @@\n+${AWS}` });
    commit("api", 2, hoursAgo(2), { b: `@@ -0,0 +1 @@\n+${AWS_2}` });
    // Repos, commits, the first commit's files; the second commit's files fail.
    github.failFrom = { call: 4, error: new RateLimitError(new Date("2026-11-01T13:05:00Z")) };

    const result = await scanOrg(deps(), watch, [], NOW);

    expect(result.newFindings).toHaveLength(1);
    expect(result.cursor).toEqual(hoursAgo(3));
    expect(result.error).toBe("GitHub's rate limit ran out. Scanning continues after 13:05 UTC.");
  });
});
