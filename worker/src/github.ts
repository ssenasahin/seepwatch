// The few GitHub API calls the scanners make, behind an interface so tests can hand
// in a fake GitHub. Every URL is on api.github.com, so there's no address for anyone
// to steer and nothing for the SSRF guard to do.

export interface Repo {
  fullName: string;
  pushedAt: Date | null;
  fork: boolean;
  archived: boolean;
}

export interface Commit {
  sha: string;
  committedAt: Date;
}

export interface CommitFile {
  path: string;
  // The unified diff GitHub shows; missing for binary files and very large diffs.
  patch: string | null;
}

export interface CodeResult {
  repository: string;
  path: string;
  // The blob's commit, so links and file fetches are pinned to what was searched.
  ref: string;
}

export interface Gist {
  id: string;
  // The owner's login; null for an anonymous gist.
  owner: string | null;
  url: string;
  updatedAt: Date;
  files: { name: string; rawUrl: string; size: number }[];
}

export interface GithubApi {
  // Public repositories, most recently pushed first.
  orgRepos(org: string): Promise<Repo[]>;
  // Commits on the default branch after `since`, newest first.
  commitsSince(repo: string, since: Date, limit: number): Promise<Commit[]>;
  commitFiles(repo: string, sha: string): Promise<CommitFile[]>;
  // Needs a token: GitHub's code search refuses anonymous callers.
  searchCode(query: string, limit: number): Promise<CodeResult[]>;
  // A file's text, or null if it's gone or not text.
  fileText(repo: string, path: string, ref: string): Promise<string | null>;
  // Public gists created or updated after `since`, newest first.
  publicGists(since: Date, limit: number): Promise<Gist[]>;
  // A gist file's text, or null if it's gone, too big or not text.
  gistFileText(rawUrl: string): Promise<string | null>;
}

// Where gist files are served from. A raw URL anywhere else is refused: it came from
// GitHub's answer, but the scanner fetches nothing it can't name in advance.
const GIST_RAW_HOST = "gist.githubusercontent.com";

// GitHub's limit ran out. Scans stop where they are and pick up after `resetAt`.
export class RateLimitError extends Error {
  constructor(readonly resetAt: Date) {
    super(`GitHub's rate limit ran out; it resets at ${resetAt.toISOString()}`);
  }
}

export class GithubError extends Error {}

const API = "https://api.github.com";
const PER_PAGE = 100;
// Bigger files are skipped: generated bundles and datasets, not hand-edited config.
const MAX_FILE_BYTES = 512 * 1024;

export function httpGithub(token?: string): GithubApi {
  async function call(path: string, accept = "application/vnd.github+json"): Promise<Response> {
    const res = await fetch(`${API}${path}`, {
      headers: {
        accept,
        "user-agent": "Seepwatch",
        "x-github-api-version": "2022-11-28",
        ...(token && { authorization: `Bearer ${token}` }),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (
      (res.status === 403 || res.status === 429) &&
      res.headers.get("x-ratelimit-remaining") === "0"
    ) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      throw new RateLimitError(
        new Date(Number.isFinite(reset) ? reset * 1000 : Date.now() + 3600_000),
      );
    }
    // A secondary limit: GitHub asks us to wait a little.
    if (res.status === 403 || res.status === 429) {
      const after = Number(res.headers.get("retry-after"));
      if (Number.isFinite(after) && after > 0) {
        throw new RateLimitError(new Date(Date.now() + after * 1000));
      }
    }
    return res;
  }

  async function json<T>(path: string): Promise<T> {
    const res = await call(path);
    if (!res.ok) throw new GithubError(`GitHub answered ${res.status} for ${path.split("?")[0]}`);
    return (await res.json()) as T;
  }

  return {
    async orgRepos(org) {
      const repos: Repo[] = [];
      for (let page = 1; page <= 10; page++) {
        const batch = await json<
          { full_name: string; pushed_at: string | null; fork: boolean; archived: boolean }[]
        >(
          `/orgs/${encodeURIComponent(org)}/repos?type=public&sort=pushed&direction=desc&per_page=${PER_PAGE}&page=${page}`,
        );
        repos.push(
          ...batch.map((r) => ({
            fullName: r.full_name,
            pushedAt: r.pushed_at ? new Date(r.pushed_at) : null,
            fork: r.fork,
            archived: r.archived,
          })),
        );
        if (batch.length < PER_PAGE) break;
      }
      return repos;
    },

    async commitsSince(repo, since, limit) {
      const commits: Commit[] = [];
      for (let page = 1; commits.length < limit; page++) {
        const res = await call(
          `/repos/${repo}/commits?since=${since.toISOString()}&per_page=${PER_PAGE}&page=${page}`,
        );
        // An empty repository answers 409.
        if (res.status === 409) break;
        if (!res.ok) throw new GithubError(`GitHub answered ${res.status} for ${repo}'s commits`);
        const batch = (await res.json()) as {
          sha: string;
          commit: { committer: { date: string } };
        }[];
        commits.push(
          ...batch.map((c) => ({ sha: c.sha, committedAt: new Date(c.commit.committer.date) })),
        );
        if (batch.length < PER_PAGE) break;
      }
      return commits.slice(0, limit);
    },

    async commitFiles(repo, sha) {
      const commit = await json<{ files?: { filename: string; patch?: string }[] }>(
        `/repos/${repo}/commits/${sha}`,
      );
      return (commit.files ?? []).map((f) => ({ path: f.filename, patch: f.patch ?? null }));
    },

    async searchCode(query, limit) {
      if (!token) throw new GithubError("Code search needs GITHUB_TOKEN to be set");
      const found = await json<{
        items: { path: string; url: string; repository: { full_name: string } }[];
      }>(`/search/code?q=${encodeURIComponent(query)}&per_page=${Math.min(limit, PER_PAGE)}`);
      return found.items.map((item) => ({
        repository: item.repository.full_name,
        path: item.path,
        // The item's API URL carries the commit it was indexed at: ...?ref=<sha>
        ref: new URL(item.url).searchParams.get("ref") ?? "HEAD",
      }));
    },

    async fileText(repo, path, ref) {
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      const res = await call(
        `/repos/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
        "application/vnd.github.raw+json",
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new GithubError(`GitHub answered ${res.status} for ${repo}/${path}`);
      return readText(res);
    },

    async publicGists(since, limit) {
      const gists: Gist[] = [];
      for (let page = 1; gists.length < limit; page++) {
        const batch = await json<
          {
            id: string;
            html_url: string;
            updated_at: string;
            owner?: { login: string } | null;
            files: Record<string, { filename: string; raw_url: string; size: number }>;
          }[]
        >(`/gists/public?since=${since.toISOString()}&per_page=${PER_PAGE}&page=${page}`);
        gists.push(
          ...batch.map((g) => ({
            id: g.id,
            owner: g.owner?.login ?? null,
            url: g.html_url,
            updatedAt: new Date(g.updated_at),
            files: Object.values(g.files).map((f) => ({
              name: f.filename,
              rawUrl: f.raw_url,
              size: f.size,
            })),
          })),
        );
        if (batch.length < PER_PAGE) break;
      }
      return gists.slice(0, limit);
    },

    async gistFileText(rawUrl) {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || url.hostname !== GIST_RAW_HOST) return null;
      const res = await fetch(url, {
        headers: { "user-agent": "Seepwatch" },
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new GithubError(`GitHub answered ${res.status} for a gist file`);
      return readText(res);
    },
  };
}

// The body as text, unless it's too big or binary (a NUL byte gives that away).
async function readText(res: Response): Promise<string | null> {
  if (Number(res.headers.get("content-length") ?? 0) > MAX_FILE_BYTES) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES || bytes.includes(0)) return null;
  return new TextDecoder().decode(bytes);
}
