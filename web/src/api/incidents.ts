import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./client";
import type { FindingLocation } from "./findings";

// Leaks and where each one stands, from the first alert until someone deals with it.

export type IncidentStatus =
  "OPEN" | "ACKNOWLEDGED" | "REVOKED" | "FALSE_POSITIVE" | "RISK_ACCEPTED";

export type IncidentFilter = "active" | "closed" | "all";

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
    firstSeenAt: string;
    lastSeenAt: string;
    watch: { id: string; kind: string; value: string; label: string | null } | null;
    locationCount: number;
    lastLocation: Pick<FindingLocation, "source" | "repository" | "path" | "line" | "url"> | null;
  };
}

export type IncidentEventType =
  | "OPENED"
  | "NOTIFIED"
  | "NOT_DELIVERED"
  | "ESCALATED"
  | "REMINDED"
  | "ACKNOWLEDGED"
  | "SEEN_AGAIN"
  | "REVOKED"
  | "FALSE_POSITIVE"
  | "RISK_ACCEPTED";

export interface IncidentEvent {
  id: string;
  type: IncidentEventType;
  at: string;
  detail: string | null;
}

export interface IncidentDetail {
  incident: Incident;
  locations: FindingLocation[];
  events: IncidentEvent[];
}

export type IncidentAction = "ACKNOWLEDGE" | "REVOKE" | "FALSE_POSITIVE" | "ACCEPT_RISK";

export const ACTIVE: IncidentStatus[] = ["OPEN", "ACKNOWLEDGED"];
export const isActive = (i: Pick<Incident, "status">) => ACTIVE.includes(i.status);

export const incidentKeys = {
  all: ["incidents"] as const,
  list: (filter: IncidentFilter) => ["incidents", "list", filter] as const,
  active: ["incidents", "list", "active", "count"] as const,
  one: (id: string) => ["incidents", "one", id] as const,
};

// Newest first, a page of 50 at a time. Refreshed every 30 seconds: alerts keep going
// out, and someone may respond from one.
export function useIncidents(filter: IncidentFilter) {
  return useInfiniteQuery({
    queryKey: incidentKeys.list(filter),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ status: filter });
      if (pageParam) params.set("before", pageParam);
      return api<{ incidents: Incident[]; next: string | null }>(`/incidents?${params}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.next ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

// The first page of active ones, for the overview.
export function useActiveIncidents() {
  return useQuery({
    queryKey: incidentKeys.active,
    queryFn: () =>
      api<{ incidents: Incident[]; next: string | null }>("/incidents?status=active").then(
        (r) => r.incidents,
      ),
  });
}

export function useIncident(id: string) {
  return useQuery({
    queryKey: incidentKeys.one(id),
    queryFn: () => api<IncidentDetail>(`/incidents/${id}`),
    refetchInterval: 30_000,
    retry: (count, err) => (err as { status?: number }).status !== 404 && count < 2,
  });
}

export function useIncidentAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { action: IncidentAction; reason?: string }) =>
      api<{ incident: Incident }>(`/incidents/${id}/actions`, { method: "POST", body }),
    // Lists, counts and the timeline all change.
    onSettled: () => queryClient.invalidateQueries({ queryKey: incidentKeys.all }),
  });
}
