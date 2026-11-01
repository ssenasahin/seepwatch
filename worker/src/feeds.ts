// Gists and pastes can't be searched for a domain the way code can. Instead each
// source is read as a feed of new public posts, every post once, and matched against
// every watched domain and address at the same time.
import type { FindingSource, KeyPattern } from "@seepwatch/db";
import { describeError } from "./scan-org.js";
import type { GithubApi } from "./github.js";
import { noteSeenAgain, openIncidents } from "./incidents.js";
import { hitsNearMention, mentionPattern } from "./match.js";
import { recordHits, type RecordDeps } from "./record.js";
import { ownerKeyPatterns, scannable } from "./scan.js";

// One file of a post, with what a location needs: who posted it, what it's called,
// and a link to a line.
export interface FeedFile {
  repository: string;
  path: string;
  link: (line: number) => string;
  read(): Promise<string | null>;
}

export interface FeedPost {
  createdAt: Date;
  files: FeedFile[];
}

export interface Feed {
  source: Extract<FindingSource, "GIST" | "PASTEBIN">;
  // Posts from `since` on, oldest first. `complete` is false when there were more
  // than one run reads; the oldest of them were dropped.
  postsSince(since: Date): Promise<{ posts: FeedPost[]; complete: boolean }>;
}

// A new gist arrives every few seconds. Reading the newest 300 every 5 minutes keeps
// up with that, and costs 3 API requests; the files themselves come from GitHub's raw
// host, outside the API's limit.
const GIST_POSTS = 300;
const GIST_FILES = 10;
const MAX_FILE_BYTES = 512 * 1024;

// GitHub's anchor for a gist file: "#file-" and the name with everything that isn't a
// letter or digit turned into dashes.
const gistAnchor = (name: string) => `file-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;

export function gistFeed(github: GithubApi): Feed {
  return {
    source: "GIST",
    async postsSince(since) {
      const gists = await github.publicGists(since, GIST_POSTS);
      const posts = gists.reverse().map((gist) => ({
        createdAt: gist.updatedAt,
        files: gist.files
          .filter((f) => f.size <= MAX_FILE_BYTES)
          .slice(0, GIST_FILES)
          .map((f) => ({
            repository: `${gist.owner ?? "anonymous"}/${gist.id}`,
            path: f.name,
            link: (line: number) => `${gist.url}#${gistAnchor(f.name)}-L${line}`,
            read: () => github.gistFileText(f.rawUrl),
          })),
      }));
      return { posts, complete: gists.length < GIST_POSTS };
    },
  };
}

// Pastebin's scraping API: the only sanctioned way to read new pastes. It needs a
// lifetime Pro account and answers only the IP address registered with it, so it's
// off unless PASTEBIN_SCRAPING is set.
const PASTEBIN = "https://scrape.pastebin.com";
const PASTEBIN_POSTS = 250;

export type Fetch = (url: string) => Promise<{ status: number; text(): Promise<string> }>;

const httpFetch: Fetch = (url) =>
  fetch(url, {
    headers: { "user-agent": "Seepwatch" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });

export function pastebinFeed(get: Fetch = httpFetch): Feed {
  return {
    source: "PASTEBIN",
    async postsSince(since) {
      const res = await get(`${PASTEBIN}/api_scraping.php?limit=${PASTEBIN_POSTS}`);
      const body = await res.text();
      // A refusal comes back as a sentence, not JSON: "YOUR IP: … DOES NOT HAVE ACCESS".
      if (res.status !== 200 || !body.trimStart().startsWith("[")) {
        throw new Error(`Pastebin refused the scraping API: ${body.slice(0, 120).trim()}`);
      }
      const pastes = JSON.parse(body) as {
        key: string;
        date: string;
        size: string;
        title: string;
        full_url: string;
      }[];
      const fresh = pastes
        .map((p) => ({ ...p, at: new Date(Number(p.date) * 1000) }))
        .filter((p) => p.at >= since && Number(p.size) <= MAX_FILE_BYTES)
        .sort((a, b) => a.at.getTime() - b.at.getTime());
      const posts = fresh.map((p) => ({
        createdAt: p.at,
        files: [
          {
            repository: p.key,
            path: p.title || "paste",
            // Pastebin has no line anchors.
            link: () => p.full_url,
            read: async () => {
              const item = await get(
                `${PASTEBIN}/api_scrape_item.php?i=${encodeURIComponent(p.key)}`,
              );
              return item.status === 200 ? item.text() : null;
            },
          },
        ],
      }));
      // The list holds the newest pastes only; if even the oldest is new to us, some
      // before it were missed.
      const oldest = pastes.reduce(
        (min, p) => Math.min(min, Number(p.date) * 1000),
        Number.POSITIVE_INFINITY,
      );
      return { posts, complete: pastes.length < PASTEBIN_POSTS || oldest < since.getTime() };
    },
  };
}

// The first run of a feed starts this far back.
export const FIRST_READ_MS = 60 * 60 * 1000;

interface Watched {
  id: string;
  ownerId: string;
  value: string;
  mention: RegExp;
  keyPatterns: KeyPattern[];
}

// Every domain and address being watched, with its owner's key patterns.
async function watchedValues(prisma: RecordDeps["prisma"]): Promise<Watched[]> {
  const watches = await prisma.watch.findMany({
    where: { AND: [scannable, { kind: { in: ["DOMAIN", "EMAIL"] } }] },
    select: { id: true, ownerId: true, value: true },
  });
  const patterns = new Map<string, KeyPattern[]>();
  for (const ownerId of new Set(watches.map((w) => w.ownerId))) {
    patterns.set(ownerId, await ownerKeyPatterns(prisma, ownerId));
  }
  return watches.map((w) => ({
    ...w,
    mention: mentionPattern(w.value),
    keyPatterns: patterns.get(w.ownerId)!,
  }));
}

export interface FeedResult {
  read: number;
  newFindings: string[];
  error: string | null;
}

// Reads one feed from where it stopped, records what it finds, and opens incidents
// for new findings. The feed's state says how far it got and why it stopped short.
export async function readFeed(
  deps: RecordDeps,
  feed: Feed,
  now = new Date(),
): Promise<FeedResult> {
  const { prisma } = deps;
  const state = await prisma.feedState.findUnique({ where: { source: feed.source } });
  let cursor = state?.cursor ?? new Date(now.getTime() - FIRST_READ_MS);
  const newFindings: string[] = [];
  const seenAgain: string[] = [];
  let read = 0;
  let error: string | null = null;

  const watched = await watchedValues(prisma);
  try {
    // Nobody to read for: skip the requests, but keep up so a first watch doesn't
    // start with a backlog.
    if (watched.length === 0) {
      cursor = now;
    } else {
      const { posts, complete } = await feed.postsSince(cursor);
      for (const post of posts) {
        for (const file of post.files) {
          const text = await file.read();
          if (text === null) continue;
          const lower = text.toLowerCase();
          let lines: string[] | null = null;
          for (const w of watched) {
            // A plain substring test first: most posts mention none of the values.
            if (!lower.includes(w.value)) continue;
            lines ??= text.split(/\r?\n/);
            const hits = hitsNearMention(lines, w.mention, w.keyPatterns);
            if (hits.length === 0) continue;
            const recorded = await recordHits(
              deps,
              {
                ownerId: w.ownerId,
                watchId: w.id,
                source: feed.source,
                repository: file.repository,
                path: file.path,
                ref: "",
                committedAt: post.createdAt,
                lines,
                link: file.link,
              },
              hits,
            );
            newFindings.push(...recorded.created);
            seenAgain.push(...recorded.seenAgain);
          }
        }
        read++;
        cursor = post.createdAt;
      }
      if (!complete) error = "More posts arrived than one run reads; the oldest weren't read.";
    }
  } catch (err) {
    error = describeError(err);
  }

  await prisma.feedState.upsert({
    where: { source: feed.source },
    create: { source: feed.source, cursor, lastRunAt: now, lastRead: read, lastError: error },
    update: { cursor, lastRunAt: now, lastRead: read, lastError: error },
  });
  await openIncidents(prisma, newFindings, now);
  await noteSeenAgain(prisma, seenAgain, now);
  return { read, newFindings, error };
}
