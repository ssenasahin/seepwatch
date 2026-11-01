// Proving a domain or a GitHub organization belongs to whoever added it. Without
// this, anyone could watch someone else's domain and collect their leaks.
import { randomBytes } from "node:crypto";
import { resolveTxt as dnsResolveTxt } from "node:dns/promises";

// Where the token goes: a TXT record on a name of its own, so it doesn't crowd the
// domain's SPF and other records, and a file in the organization's .github repository,
// which only its members can write to.
export const DNS_LABEL = "_seepwatch";
export const GITHUB_REPO = ".github";
export const GITHUB_FILE = "seepwatch-verify.txt";
const TOKEN_PREFIX = "seepwatch-verify=";

export function newVerifyToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
}

export function dnsRecordName(domain: string): string {
  return `${DNS_LABEL}.${domain}`;
}

// One answer per TXT record, each as the strings DNS split it into.
export type ResolveTxt = (name: string) => Promise<string[][]>;

export const resolveTxt: ResolveTxt = (name) => dnsResolveTxt(name);

// Reads a file from an organization's .github repository: its text, or null when it
// isn't there. Throws when GitHub can't be asked at all.
export type FetchGithubFile = (org: string, path: string) => Promise<string | null>;

export function githubFileFetcher(token?: string): FetchGithubFile {
  return async (org, path) => {
    const url = `https://api.github.com/repos/${encodeURIComponent(org)}/${GITHUB_REPO}/contents/${path}`;
    const res = await fetch(url, {
      headers: {
        accept: "application/vnd.github.raw+json",
        "user-agent": "Seepwatch",
        "x-github-api-version": "2022-11-28",
        ...(token && { authorization: `Bearer ${token}` }),
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    // Enough for a token; a huge file is no proof of anything.
    return (await res.text()).slice(0, 1000);
  };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verifyDomain(
  domain: string,
  token: string,
  resolve: ResolveTxt = resolveTxt,
): Promise<VerifyResult> {
  const name = dnsRecordName(domain);
  let records: string[][];
  try {
    records = await resolve(name);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { ok: false, reason: `No TXT record at ${name} yet. DNS changes can take a while.` };
    }
    return { ok: false, reason: `Couldn't look up ${name}. Try again in a minute.` };
  }
  // A long TXT value can come back split into several strings; they form one value.
  if (records.some((parts) => parts.join("").trim() === token)) return { ok: true };
  return { ok: false, reason: `${name} has TXT records, but none of them is the token.` };
}

export async function verifyGithubOrg(
  org: string,
  token: string,
  fetchFile: FetchGithubFile,
): Promise<VerifyResult> {
  const where = `${org}/${GITHUB_REPO}/${GITHUB_FILE}`;
  let text: string | null;
  try {
    text = await fetchFile(org, GITHUB_FILE);
  } catch {
    return { ok: false, reason: "Couldn't reach GitHub. Try again in a minute." };
  }
  if (text === null) return { ok: false, reason: `No file at ${where} yet.` };
  if (text.split(/\r?\n/).some((line) => line.trim() === token)) return { ok: true };
  return { ok: false, reason: `${where} exists, but doesn't contain the token.` };
}
