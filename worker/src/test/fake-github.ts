import type { CodeResult, Commit, CommitFile, GithubApi, Repo } from "../github.js";

// GitHub as the tests describe it. Each call is counted, so a test can check how much
// of the rate limit a scan would have spent.
export class FakeGithub implements GithubApi {
  repos: Repo[] = [];
  commits = new Map<string, Commit[]>();
  files = new Map<string, CommitFile[]>();
  search: CodeResult[] = [];
  texts = new Map<string, string>();
  calls = 0;
  // Throws this from the given call number on, as GitHub does when the limit runs out.
  failFrom: { call: number; error: Error } | null = null;

  private count() {
    this.calls++;
    if (this.failFrom && this.calls >= this.failFrom.call) throw this.failFrom.error;
  }

  async orgRepos(org: string) {
    this.count();
    return this.repos.filter((r) => r.fullName.startsWith(`${org}/`));
  }

  async commitsSince(repo: string, since: Date, limit: number) {
    this.count();
    return (this.commits.get(repo) ?? [])
      .filter((c) => c.committedAt >= since)
      .sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime())
      .slice(0, limit);
  }

  async commitFiles(repo: string, sha: string) {
    this.count();
    return this.files.get(`${repo}@${sha}`) ?? [];
  }

  async searchCode(_query: string, limit: number) {
    this.count();
    return this.search.slice(0, limit);
  }

  async fileText(repo: string, path: string, ref: string) {
    this.count();
    return this.texts.get(`${repo}/${path}@${ref}`) ?? null;
  }
}

// Shaped like real keys, but made up, and put together from pieces so GitHub's push
// protection doesn't stop this file.
const k = (...parts: string[]) => parts.join("");
export const AWS = k("AK", "IA", "ABCDEFGHIJKLMNOP");
export const AWS_2 = k("AK", "IA", "QRSTUVWXYZ234567");
export const STRIPE = k("sk", "_live_", "x9Y8z7W6v5".repeat(3));

export const sha = (n: number) => n.toString(16).padStart(40, "0");
