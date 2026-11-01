import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

// What Seepwatch looks for, and the proof that each thing is the owner's.

export type WatchKind = "DOMAIN" | "EMAIL" | "GITHUB_ORG" | "KEY_PATTERN";
export type KeyCharset = "ALNUM" | "HEX" | "BASE64URL";

interface Checked {
  verifiedAt: string | null;
  lastVerifyAt: string | null;
  lastVerifyError: string | null;
}

export type Verification =
  | ({ method: "dns"; record: { type: "TXT"; name: string; value: string } } & Checked)
  | ({ method: "github"; file: { repository: string; path: string; content: string } } & Checked)
  | ({ method: "domain"; domain: string | null } & Checked)
  | { method: "none" };

export interface Watch {
  id: string;
  kind: WatchKind;
  value: string;
  label: string | null;
  enabled: boolean;
  keyPattern: { charset: KeyCharset; minLength: number; maxLength: number } | null;
  verification: Verification;
  escalationPolicy: { id: string; name: string } | null;
  // Null until the first scan. Key patterns aren't scanned on their own.
  lastScanAt: string | null;
  lastScanError: string | null;
  createdAt: string;
}

export const watchKeys = { all: ["watches"] as const };

export function useWatches() {
  return useQuery({
    queryKey: watchKeys.all,
    queryFn: () => api<{ watches: Watch[] }>("/watches").then((r) => r.watches),
  });
}

// Whether scans may use it: proven, or needing no proof.
export function isVerified(watch: Watch): boolean {
  return watch.verification.method === "none" || watch.verification.verifiedAt !== null;
}
