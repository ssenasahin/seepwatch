import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

// Leaks and where each one stands. The pages for them come next; for now the
// overview counts the ones still active.

export type IncidentStatus =
  "OPEN" | "ACKNOWLEDGED" | "REVOKED" | "FALSE_POSITIVE" | "RISK_ACCEPTED";

export interface Incident {
  id: string;
  status: IncidentStatus;
  openedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
  closeReason: string | null;
  alertsSent: number;
  nextAlertAt: string | null;
  finding: {
    id: string;
    detector: string;
    detectorLabel: string;
    masked: string;
    locationCount: number;
    lastLocation: { repository: string; path: string; line: number | null; url: string } | null;
  };
}

export const incidentKeys = { active: ["incidents", "active"] as const };

export function useActiveIncidents() {
  return useQuery({
    queryKey: incidentKeys.active,
    queryFn: () =>
      api<{ incidents: Incident[]; next: string | null }>("/incidents?status=active").then(
        (r) => r.incidents,
      ),
  });
}
