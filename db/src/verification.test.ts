import { describe, expect, it } from "vitest";
import {
  dnsRecordName,
  newVerifyToken,
  verifyDomain,
  verifyGithubOrg,
  type FetchGithubFile,
  type ResolveTxt,
} from "./verification.js";

const token = newVerifyToken();
const notFound = (code: string) => Object.assign(new Error(code), { code });

describe("domain verification", () => {
  it("looks for the token on its own name", async () => {
    const asked: string[] = [];
    const resolve: ResolveTxt = async (name) => {
      asked.push(name);
      return [["v=spf1 -all"], [token]];
    };
    expect(await verifyDomain("example.com", token, resolve)).toEqual({ ok: true });
    expect(asked).toEqual([dnsRecordName("example.com")]);
    expect(asked[0]).toBe("_seepwatch.example.com");
  });

  it("joins a value DNS split into several strings", async () => {
    const resolve: ResolveTxt = async () => [[token.slice(0, 10), token.slice(10)]];
    expect(await verifyDomain("example.com", token, resolve)).toEqual({ ok: true });
  });

  it("says why it failed", async () => {
    const missing: ResolveTxt = async () => {
      throw notFound("ENOTFOUND");
    };
    const wrong: ResolveTxt = async () => [["seepwatch-verify=someone-else"]];
    const broken: ResolveTxt = async () => {
      throw notFound("ESERVFAIL");
    };
    expect(await verifyDomain("example.com", token, missing)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/No TXT record/),
    });
    expect(await verifyDomain("example.com", token, wrong)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/none of them is the token/),
    });
    expect(await verifyDomain("example.com", token, broken)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/Couldn't look up/),
    });
  });

  it("makes a different token every time", () => {
    expect(newVerifyToken()).not.toBe(newVerifyToken());
    expect(token).toMatch(/^seepwatch-verify=[\w-]{32}$/);
  });
});

describe("GitHub organization verification", () => {
  it("accepts the token on any line of the file", async () => {
    const fetchFile: FetchGithubFile = async (org, path) => {
      expect([org, path]).toEqual(["acme", "seepwatch-verify.txt"]);
      return `# Seepwatch\r\n${token}\n`;
    };
    expect(await verifyGithubOrg("acme", token, fetchFile)).toEqual({ ok: true });
  });

  it("says when the file is missing, wrong or unreachable", async () => {
    expect(await verifyGithubOrg("acme", token, async () => null)).toMatchObject({
      ok: false,
      reason: "No file at acme/.github/seepwatch-verify.txt yet.",
    });
    expect(await verifyGithubOrg("acme", token, async () => "hello")).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/doesn't contain the token/),
    });
    const down: FetchGithubFile = async () => {
      throw new Error("GitHub answered 503");
    };
    expect(await verifyGithubOrg("acme", token, down)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/Couldn't reach GitHub/),
    });
  });
});
