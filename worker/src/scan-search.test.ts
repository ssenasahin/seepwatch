import { fingerprintKey } from "@seepwatch/db";
import { beforeEach, describe, expect, it } from "vitest";
import { GithubError } from "./github.js";
import { NEAR_LINES, scanSearch, type SearchWatch } from "./scan-search.js";
import { prisma, makeOwner, resetDatabase } from "./test/database.js";
import { AWS, AWS_2, FakeGithub, sha, STRIPE } from "./test/fake-github.js";

let github: FakeGithub;
let watch: SearchWatch;
const deps = () => ({ prisma, github, fingerprintKey: fingerprintKey(Buffer.alloc(32, 7)) });

// A search result whose file holds these lines.
function file(path: string, lines: string[]) {
  github.search.push({ repository: "someone/blog", path, ref: sha(9) });
  github.texts.set(`someone/blog/${path}@${sha(9)}`, lines.join("\n"));
}

const filler = () => Array.from({ length: NEAR_LINES + 5 }, (_, i) => `// line ${i}`);

beforeEach(async () => {
  await resetDatabase();
  github = new FakeGithub();
  const owner = await makeOwner();
  const domain = await prisma.watch.create({
    data: { ownerId: owner.id, kind: "DOMAIN", value: "acme.dev", verifiedAt: new Date() },
  });
  watch = { id: domain.id, ownerId: owner.id, kind: "DOMAIN", value: "acme.dev" };
});

describe("scanSearch", () => {
  it("records keys written near a mention of the domain", async () => {
    file("deploy.sh", ["#!/bin/sh", "curl https://api.acme.dev/upload \\", `  -H "key: ${AWS}"`]);

    const result = await scanSearch(deps(), watch, []);

    expect(result.error).toBeNull();
    expect(result.newFindings).toHaveLength(1);
    const location = await prisma.findingLocation.findFirstOrThrow();
    expect(location).toMatchObject({
      source: "GITHUB_CODE",
      repository: "someone/blog",
      path: "deploy.sh",
      line: 3,
      commitSha: sha(9),
    });
    expect(location.context).toContain("api.acme.dev");
    expect(location.context).not.toContain(AWS);
  });

  it("leaves keys far from any mention alone", async () => {
    file("notes.md", ["contact: ops@acme.dev", ...filler(), `aws = ${AWS}`]);
    const result = await scanSearch(deps(), watch, []);
    expect(result.newFindings).toEqual([]);
  });

  it("counts the owner's key patterns anywhere in the file", async () => {
    const key = "acme_live_" + "Q".repeat(24);
    file("notes.md", ["see acme.dev", ...filler(), `token = ${key}`, `aws = ${AWS}`]);
    const result = await scanSearch(deps(), watch, [
      { prefix: "acme_live_", charset: "ALNUM", minLength: 20, maxLength: 30 },
    ]);
    expect(result.newFindings).toHaveLength(1);
    expect((await prisma.finding.findFirstOrThrow()).detector).toBe("key-pattern");
  });

  it("needs the domain itself, not a longer name that contains it", async () => {
    file("a.env", ["HOST=notacme.dev", `KEY=${AWS}`]);
    file("b.env", ["HOST=acme.dev-staging.example.org", `KEY=${AWS_2}`]);
    const result = await scanSearch(deps(), watch, []);
    expect(result.newFindings).toEqual([]);
  });

  it("counts subdomains, whatever their case", async () => {
    file("a.env", ["HOST=Billing.ACME.dev", `KEY=${STRIPE}`]);
    const result = await scanSearch(deps(), watch, []);
    expect(result.newFindings).toHaveLength(1);
  });

  it("skips files that are gone or not text", async () => {
    github.search.push({ repository: "someone/blog", path: "logo.png", ref: sha(9) });
    const result = await scanSearch(deps(), watch, []);
    expect(result).toMatchObject({ newFindings: [], error: null });
  });

  it("reports why it couldn't search", async () => {
    github.failFrom = {
      call: 1,
      error: new GithubError("Code search needs GITHUB_TOKEN to be set"),
    };
    const result = await scanSearch(deps(), watch, []);
    expect(result.error).toBe("Code search needs GITHUB_TOKEN to be set");
  });
});
