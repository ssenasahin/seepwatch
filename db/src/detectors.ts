// What a leaked secret looks like. Every expression here is a fixed prefix and one
// bounded character class, so none of them can backtrack on hostile input, however
// long the line.
import { createHmac, hkdfSync } from "node:crypto";
import { keyPatternRegExp, type KeyPattern } from "./watches.js";

export interface Detector {
  id: string;
  label: string;
  pattern: RegExp;
}

export const DETECTORS: readonly Detector[] = [
  {
    id: "aws-access-key",
    label: "AWS access key",
    pattern: /(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/g,
  },
  {
    id: "github-token",
    label: "GitHub token",
    pattern:
      /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,251}|github_pat_[A-Za-z0-9_]{82})(?![A-Za-z0-9_])/g,
  },
  {
    id: "slack-token",
    label: "Slack token",
    pattern: /(?<![A-Za-z0-9-])xox[abposr]-[A-Za-z0-9-]{10,250}(?![A-Za-z0-9-])/g,
  },
  {
    id: "slack-webhook",
    label: "Slack webhook URL",
    pattern:
      /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{6,12}\/B[A-Z0-9]{6,12}\/[A-Za-z0-9]{20,32}/g,
  },
  {
    id: "stripe-live-key",
    label: "Stripe live key",
    pattern: /(?<![A-Za-z0-9_])(?:sk|rk)_live_[A-Za-z0-9]{24,99}(?![A-Za-z0-9])/g,
  },
  {
    id: "google-api-key",
    label: "Google API key",
    pattern: /(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g,
  },
  {
    id: "private-key",
    label: "Private key",
    pattern: /-----BEGIN (?:[A-Z]{2,10} )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
];

export const KEY_PATTERN_DETECTOR = "key-pattern";

const LABELS = new Map(DETECTORS.map((d) => [d.id, d.label]));
export function detectorLabel(id: string): string {
  return id === KEY_PATTERN_DETECTOR ? "Your key pattern" : (LABELS.get(id) ?? id);
}

export interface Hit {
  detector: string;
  // The secret itself. It lives only in memory: stored, it would make Seepwatch's
  // database the best place to steal keys from.
  secret: string;
  // Which of the given lines it's on, counted from 0, and where on that line.
  lineIndex: number;
  start: number;
  end: number;
}

// A private key's header is what's distinctive, but two keys share the same header;
// the key is the block up to its footer. A block cut off by the end of the text (a
// patch shows only part of a file) is still a leak, of whatever made it out.
const PRIVATE_KEY_LINES = 120;
function privateKeyBlock(lines: string[], from: number): string {
  const block: string[] = [];
  for (let i = from; i < lines.length && i < from + PRIVATE_KEY_LINES; i++) {
    block.push(lines[i]!.trim());
    if (i > from && /-----END [A-Z ]*PRIVATE KEY/.test(lines[i]!)) break;
  }
  return block.join("\n");
}

// Minified files can put a megabyte on one line; nobody pastes a key there by hand.
const MAX_LINE = 20_000;

// Every secret in the lines, by the built-in detectors and the owner's key patterns.
// A secret seen twice in the same lines is reported twice; recording dedupes.
export function detect(lines: string[], keyPatterns: KeyPattern[] = []): Hit[] {
  const custom = keyPatterns.map((p) => ({
    id: KEY_PATTERN_DETECTOR,
    pattern: keyPatternRegExp(p),
  }));
  const hits: Hit[] = [];
  lines.forEach((line, lineIndex) => {
    if (line.length > MAX_LINE) return;
    for (const { id, pattern } of [...DETECTORS, ...custom]) {
      for (const m of line.matchAll(pattern)) {
        const start = m.index;
        hits.push({
          detector: id,
          secret: id === "private-key" ? privateKeyBlock(lines, lineIndex) : m[0],
          lineIndex,
          start,
          end: start + m[0].length,
        });
      }
    }
  });
  return hits;
}

// Enough to recognise which key it was, not enough to use it.
export function mask(secret: string): string {
  if (secret.startsWith("-----BEGIN")) {
    const header = secret.split("\n", 1)[0]!;
    const body = secret.replace(/-----[A-Z ]+-----/g, "").replace(/\s/g, "");
    return body.length >= 8 ? `${header} …${body.slice(-4)}` : header;
  }
  if (secret.length <= 12) return `${secret.slice(0, 2)}…`;
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

// The same secret gives the same fingerprint, so a key found in a second place joins
// the first finding. Keyed, so the fingerprints can't be checked against guesses by
// someone who only has the database.
export function fingerprintKey(encryptionKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", encryptionKey, "", "seepwatch finding fingerprints", 32));
}

export function fingerprint(key: Buffer, secret: string): string {
  return createHmac("sha256", key).update(secret).digest("hex");
}

const CONTEXT_LINES = 2;
const CONTEXT_WIDTH = 200;

// The lines around a hit, as the owner will see them: every secret on them masked,
// and each line cut to a readable width.
export function redactedContext(lines: string[], hits: Hit[], lineIndex: number): string {
  const from = Math.max(0, lineIndex - CONTEXT_LINES);
  const to = Math.min(lines.length, lineIndex + CONTEXT_LINES + 1);
  const out: string[] = [];
  for (let i = from; i < to; i++) {
    let line = lines[i]!;
    // detect() never looked inside it, so nothing on it is known to be safe to show.
    if (line.length > MAX_LINE) {
      out.push("[long line omitted]");
      continue;
    }
    // Right to left, so earlier positions stay valid as the line changes length.
    for (const s of spans(
      line,
      hits.filter((h) => h.lineIndex === i),
    ).reverse()) {
      const shown = s.privateKey
        ? "-----BEGIN PRIVATE KEY----- …"
        : mask(line.slice(s.start, s.end));
      line = line.slice(0, s.start) + shown + line.slice(s.end);
    }
    // Inside a private key block, the body lines are the key itself.
    if (insidePrivateKey(lines, hits, i)) line = "[private key redacted]";
    out.push(line.length > CONTEXT_WIDTH ? `${line.slice(0, CONTEXT_WIDTH)}…` : line);
  }
  return out.join("\n");
}

interface Span {
  start: number;
  end: number;
  privateKey: boolean;
}

// What to hide on one line, overlaps merged so no part of a secret survives a
// replacement shifting the line under another.
function spans(line: string, hits: Hit[]): Span[] {
  const raw = hits
    .map((h) => {
      if (h.detector !== "private-key") return { start: h.start, end: h.end, privateKey: false };
      // A key written on one line ("-----BEGIN…-----\nMIIE…", as in a service
      // account file) carries its body after the header: hide up to its end marker.
      const endMarker = /-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/.exec(line.slice(h.end));
      const end = endMarker ? h.end + endMarker.index + endMarker[0].length : line.length;
      return { start: h.start, end, privateKey: true };
    })
    .sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const s of raw) {
    const last = merged.at(-1);
    if (last && s.start < last.end) {
      last.end = Math.max(last.end, s.end);
      last.privateKey ||= s.privateKey;
    } else merged.push({ ...s });
  }
  return merged;
}

function insidePrivateKey(lines: string[], hits: Hit[], i: number): boolean {
  return hits.some((h) => {
    if (h.detector !== "private-key" || i <= h.lineIndex) return false;
    const blockLines = h.secret.split("\n").length;
    return i < h.lineIndex + blockLines;
  });
}
