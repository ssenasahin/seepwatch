import { fingerprintKey } from "@seepwatch/db";
import { beforeEach, describe, expect, it } from "vitest";
import { dueWatches, ORG_EVERY_MS, runScan, SEARCH_EVERY_MS, type ScanDeps } from "./scan.js";
import { prisma, makeOwner, resetDatabase } from "./test/database.js";
import { AWS, FakeGithub, sha } from "./test/fake-github.js";

let github: FakeGithub;
let ownerId: string;
const deps = (): ScanDeps => ({
  prisma,
  github,
  fingerprintKey: fingerprintKey(Buffer.alloc(32, 7)),
});

const watch = (data: {
  kind: "DOMAIN" | "EMAIL" | "GITHUB_ORG";
  value: string;
  verifiedAt?: Date | null;
  domainWatchId?: string;
  enabled?: boolean;
  lastScanAt?: Date;
}) => prisma.watch.create({ data: { ownerId, ...data } });

beforeEach(async () => {
  await resetDatabase();
  github = new FakeGithub();
  ownerId = (await makeOwner()).id;
});

describe("runScan", () => {
  it("scans an organization, moves its cursor and opens an incident per new finding", async () => {
    const org = await watch({ kind: "GITHUB_ORG", value: "acme", verifiedAt: new Date() });
    github.repos.push({ fullName: "acme/api", pushedAt: new Date(), fork: false, archived: false });
    github.commits.set("acme/api", [{ sha: sha(1), committedAt: new Date(Date.now() - 60_000) }]);
    github.files.set(`acme/api@${sha(1)}`, [{ path: ".env", patch: `@@ -0,0 +1 @@\n+K=${AWS}` }]);

    await runScan(deps(), { watchId: org.id });

    const after = await prisma.watch.findUniqueOrThrow({ where: { id: org.id } });
    expect(after.lastScanAt).not.toBeNull();
    expect(after.scanCursor).not.toBeNull();
    expect(after.lastScanError).toBeNull();
    const incident = await prisma.incident.findFirstOrThrow({ include: { events: true } });
    expect(incident).toMatchObject({ ownerId, status: "OPEN", round: 0 });
    expect(incident.nextAlertAt).not.toBeNull();
    expect(incident.events).toEqual([
      expect.objectContaining({ type: "OPENED", detail: "Found in acme/api/.env" }),
    ]);
  });

  it("notes a known secret seen somewhere new on its incident", async () => {
    const org = await watch({ kind: "GITHUB_ORG", value: "acme", verifiedAt: new Date() });
    github.repos.push({ fullName: "acme/api", pushedAt: new Date(), fork: false, archived: false });
    github.commits.set("acme/api", [{ sha: sha(1), committedAt: new Date(Date.now() - 60_000) }]);
    github.files.set(`acme/api@${sha(1)}`, [{ path: "a.env", patch: `@@ -0,0 +1 @@\n+K=${AWS}` }]);
    await runScan(deps(), { watchId: org.id });

    github.repos[0]!.pushedAt = new Date(Date.now() + 1000);
    github.commits.set("acme/api", [{ sha: sha(2), committedAt: new Date(Date.now() + 1000) }]);
    github.files.set(`acme/api@${sha(2)}`, [{ path: "b.env", patch: `@@ -0,0 +1 @@\n+K=${AWS}` }]);
    await runScan(deps(), { watchId: org.id });

    expect(await prisma.incident.count()).toBe(1);
    const events = await prisma.incidentEvent.findMany({ orderBy: { id: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["OPENED", "SEEN_AGAIN"]);
    expect(events[1]!.detail).toContain("2 places");
  });

  it("records why a scan stopped short", async () => {
    const domain = await watch({ kind: "DOMAIN", value: "acme.dev", verifiedAt: new Date() });
    github.failFrom = { call: 1, error: new Error("GitHub answered 502 for /search/code") };
    await runScan(deps(), { watchId: domain.id });
    const after = await prisma.watch.findUniqueOrThrow({ where: { id: domain.id } });
    expect(after.lastScanError).toBe("GitHub answered 502 for /search/code");
    // Only organizations keep a cursor.
    expect(after.scanCursor).toBeNull();
  });

  it("skips what isn't proven or is paused, and suspended owners' watches", async () => {
    const unproven = await watch({ kind: "DOMAIN", value: "a.dev" });
    const paused = await watch({
      kind: "GITHUB_ORG",
      value: "b",
      verifiedAt: new Date(),
      enabled: false,
    });
    const unprovenDomain = await watch({ kind: "DOMAIN", value: "c.dev" });
    const address = await watch({
      kind: "EMAIL",
      value: "ops@c.dev",
      domainWatchId: unprovenDomain.id,
    });
    for (const w of [unproven, paused, address]) {
      expect(await runScan(deps(), { watchId: w.id })).toBeNull();
    }

    const fine = await watch({ kind: "GITHUB_ORG", value: "d", verifiedAt: new Date() });
    await prisma.user.update({ where: { id: ownerId }, data: { suspendedAt: new Date() } });
    expect(await runScan(deps(), { watchId: fine.id })).toBeNull();
    expect(github.calls).toBe(0);
  });

  it("scans an address once its domain is proven", async () => {
    const domain = await watch({ kind: "DOMAIN", value: "acme.dev", verifiedAt: new Date() });
    const address = await watch({
      kind: "EMAIL",
      value: "ops@acme.dev",
      domainWatchId: domain.id,
    });
    expect(await runScan(deps(), { watchId: address.id })).not.toBeNull();
  });
});

describe("dueWatches", () => {
  it("picks never-scanned watches and those whose interval has passed", async () => {
    const now = new Date();
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const fresh = await watch({ kind: "GITHUB_ORG", value: "a", verifiedAt: now });
    const orgDue = await watch({
      kind: "GITHUB_ORG",
      value: "b",
      verifiedAt: now,
      lastScanAt: ago(ORG_EVERY_MS),
    });
    await watch({
      kind: "GITHUB_ORG",
      value: "c",
      verifiedAt: now,
      lastScanAt: ago(ORG_EVERY_MS / 2),
    });
    // Searches wait six hours: an organization's interval isn't enough.
    await watch({ kind: "DOMAIN", value: "d.dev", verifiedAt: now, lastScanAt: ago(ORG_EVERY_MS) });
    const searchDue = await watch({
      kind: "DOMAIN",
      value: "e.dev",
      verifiedAt: now,
      lastScanAt: ago(SEARCH_EVERY_MS),
    });
    await watch({ kind: "DOMAIN", value: "f.dev" });

    expect((await dueWatches(prisma, now)).sort()).toEqual(
      [fresh.id, orgDue.id, searchDue.id].sort(),
    );
  });
});
