import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

// Where alerts go, who they reach and in what order: channels, the team, escalation
// policies, and API keys.

export type ChannelType = "SLACK" | "TELEGRAM" | "WEBHOOK";

// Secret settings come back as null: sending null again keeps the stored value.
export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  settings: Record<string, string | null>;
  lastSentAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface TeamMember {
  userId: string;
  email: string;
  role: "OWNER" | "MEMBER";
  joinedAt: string;
}

export interface Team {
  team: { id: string; name: string };
  members: TeamMember[];
  invites: { id: string; email: string; expiresAt: string; createdAt: string }[];
  memberOf: { id: string; name: string; ownerEmail: string }[];
}

export type EscalationTarget =
  { kind: "member"; userId: string } | { kind: "channel"; channelId: string };

export interface EscalationStep {
  waitMinutes: number;
  targets: EscalationTarget[];
}

export interface EscalationPolicy {
  id: string;
  name: string;
  steps: EscalationStep[];
  watches: { id: string; kind: string; value: string; label: string | null }[];
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export const alertKeys = {
  channels: ["channels"] as const,
  team: ["team"] as const,
  policies: ["escalation-policies"] as const,
  apiKeys: ["api-keys"] as const,
};

export function useChannels() {
  return useQuery({
    queryKey: alertKeys.channels,
    queryFn: () => api<{ channels: Channel[] }>("/channels").then((r) => r.channels),
  });
}

export function useTeam() {
  return useQuery({ queryKey: alertKeys.team, queryFn: () => api<Team>("/team") });
}

export function usePolicies() {
  return useQuery({
    queryKey: alertKeys.policies,
    queryFn: () =>
      api<{ policies: EscalationPolicy[] }>("/escalation-policies").then((r) => r.policies),
  });
}

export function useApiKeys() {
  return useQuery({
    queryKey: alertKeys.apiKeys,
    queryFn: () => api<{ keys: ApiKey[] }>("/api-keys").then((r) => r.keys),
  });
}
