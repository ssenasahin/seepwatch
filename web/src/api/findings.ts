import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

// Secrets the scanners found. Only a masked form ever reaches the browser.

export interface FindingLocation {
  source: "GITHUB_COMMIT" | "GITHUB_CODE";
  url: string;
  repository: string;
  path: string;
  commitSha: string | null;
  line: number | null;
  context: string;
  committedAt: string | null;
  seenAt: string;
}

export interface Finding {
  id: string;
  detector: string;
  detectorLabel: string;
  masked: string;
  firstSeenAt: string;
  lastSeenAt: string;
  watch: { id: string; kind: string; value: string; label: string | null } | null;
  locationCount: number;
  locations: FindingLocation[];
}

export const findingKeys = { all: ["findings"] as const };

// The newest page; enough for the overview until the findings page arrives.
export function useFindings() {
  return useQuery({
    queryKey: findingKeys.all,
    queryFn: () =>
      api<{ findings: Finding[]; next: string | null }>("/findings").then((r) => r.findings),
  });
}
