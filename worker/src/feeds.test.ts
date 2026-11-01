import { fingerprintKey } from "@seepwatch/db";
import { beforeEach, describe, expect, it } from "vitest";
import { FIRST_READ_MS, gistFeed, pastebinFeed, readFeed, type Fetch } from "./feeds.js";
import { prisma, makeOwner, resetDatabase } from "./test/database.js";
import { AWS, AWS_2, FakeGithub } from "./test/fake-github.js";

const NOW = new Date("2026-11-01T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

let github: FakeGithub;
const deps = () => ({ prisma, github, fingerprintKey: fingerprintKey(Buffer.alloc(32, 7)) });

async function domainWatch(email: string, value: string, verified = true) {
  const owner = await makeOwner(email);
  return prisma.watch.create({
    data: { ownerId: owner.id, kind: "DOMAIN", value, verifiedAt: verified ? NOW : null },
  });
}

// A public gist with one file, posted `ago` minutes before NOW.
function gist(id: string, ago: number, content: string, owner: string | null = "someone") {
  const rawUrl = `https://gist.githubusercontent.com/${owner ?? "anonymous"}/${id}/raw/deploy.sh`;
  github.gists.push({
    id,
    owner,
    url: `https://gist.github.com/${owner ?? ""}/${id}`,
    updatedAt: minutesAgo(ago),
    files: [{ name: "deploy.sh", rawUrl, size: content.length }],
  });
  github.gistTexts.set(rawUrl, content);
}

beforeEach(async () => {
  await resetDatabase();
  github = new FakeGithub();
});

describe("the gist feed", () => {
  it("records keys near a watched domain and opens an incident", async () => {
    const watch = await domainWatch("ada@example.com", "acme.dev");
    gist("g1", 10, ["# deploy", "curl https://api.acme.dev \\", `  -H "key: ${AWS}"`].join("\n"));

    const result = await readFeed(deps(), gistFeed(github), NOW);

    expect(result).toMatchObject({ read: 1, error: null });
    expect(result.newFindings).toHaveLength(1);
    const location = await prisma.findingLocation.findFirstOrThrow({ include: { finding: true } });
    expect(location).toMatchObject({
      source: "GIST",
      repository: "someone/g1",
      path: "deploy.sh",
      line: 3,
      url: "https://gist.github.com/someone/g1#file-deploy-sh-L3",
      commitSha: null,
    });
    expect(location.finding.watchId).toBe(watch.id);
    expect(await prisma.incident.count()).toBe(1);
    const state = await prisma.feedState.findUniqueOrThrow({ where: { source: "GIST" } });
    expect(state).toMatchObject({ cursor: minutesAgo(10), lastRead: 1, lastError: null });
  });

  it("gives each owner the leaks near their own domain", async () => {
    await domainWatch("ada@example.com", "acme.dev");
    await domainWatch("grace@example.com", "globex.io");
    const filler = Array.from({ length: 20 }, (_, i) => `# ${i}`);
    gist("g1", 5, ["acme.dev", `A=${AWS}`, ...filler, "globex.io", `B=${AWS_2}`].join("\n"));

    await readFeed(deps(), gistFeed(github), NOW);

    const findings = await prisma.finding.findMany({ include: { owner: true } });
    expect(findings.map((f) => f.owner.email).sort()).toEqual([
      "ada@example.com",
      "grace@example.com",
    ]);
  });

  it("ignores posts that don't mention a watched value, or keys far from it", async () => {
    await domainWatch("ada@example.com", "acme.dev");
    gist("g1", 5, `KEY=${AWS}`);
    const filler = Array.from({ length: 20 }, (_, i) => `# ${i}`);
    gist("g2", 4, ["see acme.dev", ...filler, `KEY=${AWS}`].join("\n"));
    const result = await readFeed(deps(), gistFeed(github), NOW);
    expect(result).toMatchObject({ read: 2, newFindings: [] });
  });

  it("doesn't read for domains nobody has proven", async () => {
    await domainWatch("ada@example.com", "acme.dev", false);
    gist("g1", 5, `acme.dev KEY=${AWS}`);
    const result = await readFeed(deps(), gistFeed(github), NOW);
    expect(result.read).toBe(0);
    expect(github.calls).toBe(0);
    const state = await prisma.feedState.findUniqueOrThrow({ where: { source: "GIST" } });
    expect(state.cursor).toEqual(NOW);
  });

  it("starts an hour back, then continues where it stopped", async () => {
    await domainWatch("ada@example.com", "acme.dev");
    gist("old", FIRST_READ_MS / 60_000 + 5, `acme.dev KEY=${AWS}`);
    gist("g1", 30, "nothing here");
    expect((await readFeed(deps(), gistFeed(github), NOW)).read).toBe(1);

    gist("g2", 1, `acme.dev KEY=${AWS_2}`, null);
    const next = await readFeed(deps(), gistFeed(github), NOW);
    // From the cursor on, inclusive: g1 again, and the new one.
    expect(next.read).toBe(2);
    expect(next.newFindings).toHaveLength(1);
    const location = await prisma.findingLocation.findFirstOrThrow();
    expect(location.repository).toBe("anonymous/g2");
  });

  it("says when more gists arrived than one run reads", async () => {
    await domainWatch("ada@example.com", "acme.dev");
    for (let i = 0; i < 301; i++) gist(`g${i}`, 50 - i / 10, "nothing");
    const result = await readFeed(deps(), gistFeed(github), NOW);
    expect(result.read).toBe(300);
    expect(result.error).toBe("More posts arrived than one run reads; the oldest weren't read.");
  });
});

describe("the Pastebin feed", () => {
  // Pastebin's scraping API as the tests describe it.
  function pastebin(list: string | object[], items: Record<string, string> = {}): Fetch {
    return async (url) => {
      const key = new URL(url).searchParams.get("i");
      const body = key ? items[key] : typeof list === "string" ? list : JSON.stringify(list);
      return { status: body === undefined ? 404 : 200, text: async () => body ?? "" };
    };
  }
  const paste = (key: string, ago: number, title = "") => ({
    key,
    date: String(minutesAgo(ago).getTime() / 1000),
    size: "100",
    title,
    full_url: `https://pastebin.com/${key}`,
  });

  it("records keys in a paste that mentions a watched address", async () => {
    await domainWatch("ada@example.com", "acme.dev");
    const feed = pastebinFeed(
      pastebin([paste("Ab12Cd34", 3, "creds")], {
        Ab12Cd34: `user: ops@acme.dev\naws: ${AWS}`,
      }),
    );
    const result = await readFeed(deps(), feed, NOW);
    expect(result.newFindings).toHaveLength(1);
    expect(await prisma.findingLocation.findFirstOrThrow()).toMatchObject({
      source: "PASTEBIN",
      repository: "Ab12Cd34",
      path: "creds",
      url: "https://pastebin.com/Ab12Cd34",
      line: 2,
    });
  });

  it("records Pastebin's refusal as the feed's error", async () => {
    await domainWatch("ada@example.com", "acme.dev");
    const feed = pastebinFeed(
      pastebin(
        "YOUR IP: 203.0.113.9 DOES NOT HAVE ACCESS. VISIT: https://pastebin.com/doc_scraping_api TO GET ACCESS!",
      ),
    );
    const result = await readFeed(deps(), feed, NOW);
    expect(result.error).toMatch(/^Pastebin refused the scraping API: YOUR IP/);
    const state = await prisma.feedState.findUniqueOrThrow({ where: { source: "PASTEBIN" } });
    expect(state.lastError).toBe(result.error);
  });
});
