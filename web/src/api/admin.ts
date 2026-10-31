import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "./client";

// The admin panel: every account, the plans that limit them, the health of the
// system and the record of what admins did.

export type UserStatus = "all" | "active" | "suspended" | "locked" | "admins";

export interface AdminUserRow {
  id: string;
  email: string;
  role: "USER" | "SUPER_ADMIN";
  createdAt: string;
  suspendedAt: string | null;
  lockedUntil: string | null;
  twoFactor: boolean;
  plan: { id: string; name: string } | null;
}

export interface Limits {
  plan: string;
  maxWatches: number;
  maxChannels: number;
  maxApiKeys: number;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorEmail: string;
  action: string;
  targetId: string | null;
  target: string | null;
  ip: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminUserDetail {
  user: AdminUserRow & {
    channels: number;
    apiKeys: number;
    liveSessions: number;
    lastSignInAt: string | null;
    limits: Limits;
  };
  history: AuditEntry[];
}

export interface Plan extends Omit<Limits, "plan"> {
  id: string;
  name: string;
  isDefault: boolean;
  users: number;
  createdAt: string;
}

export interface QueueStat {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  workers: number;
}

export interface SystemHealth {
  generatedAt: string;
  queues: QueueStat[] | null;
  workers: number | null;
  database: { bytes: number; tables: { name: string; bytes: number }[] };
  redis: { bytes: number | null };
  users: number;
  liveSessions: number;
}

export const adminKeys = {
  all: ["admin"] as const,
  users: (q: string, status: UserStatus, page: number) =>
    ["admin", "users", q, status, page] as const,
  user: (id: string) => ["admin", "user", id] as const,
  plans: ["admin", "plans"] as const,
  health: ["admin", "health"] as const,
  audit: (action: string, q: string) => ["admin", "audit", action, q] as const,
};

export function useAdminUsers(q: string, status: UserStatus, page: number) {
  const params = new URLSearchParams({ status, page: String(page) });
  if (q) params.set("q", q);
  return useQuery({
    queryKey: adminKeys.users(q, status, page),
    queryFn: () =>
      api<{ users: AdminUserRow[]; total: number; page: number; pageSize: number }>(
        `/admin/users?${params}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useAdminUser(id: string) {
  return useQuery({
    queryKey: adminKeys.user(id),
    queryFn: () => api<AdminUserDetail>(`/admin/users/${id}`),
  });
}

export function usePlans() {
  return useQuery({
    queryKey: adminKeys.plans,
    queryFn: () => api<{ plans: Plan[] }>("/admin/plans").then((r) => r.plans),
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: adminKeys.health,
    queryFn: () => api<SystemHealth>("/admin/system/health"),
    refetchInterval: 10_000,
  });
}

export function useAuditLog(action: string, q: string) {
  return useInfiniteQuery({
    queryKey: adminKeys.audit(action, q),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (action) params.set("action", action);
      if (q) params.set("q", q);
      if (pageParam) params.set("before", pageParam);
      return api<{ entries: AuditEntry[]; next: string | null }>(`/admin/audit-logs?${params}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.next ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export const ACTIONS: Record<string, string> = {
  "user.suspend": "Suspended an account",
  "user.reactivate": "Reactivated an account",
  "user.reset_link": "Sent a password reset link",
  "user.unlock": "Unlocked an account",
  "user.plan": "Changed an account's plan",
  "plan.create": "Created a plan",
  "plan.update": "Changed a plan",
  "plan.default": "Made a plan the default",
  "plan.delete": "Deleted a plan",
  "admin.create": "Created an admin",
};

const FIELD_NAMES: Record<string, string> = {
  name: "name",
  maxWatches: "watches",
  maxChannels: "channels",
  maxApiKeys: "API keys",
};

const LIMIT_FIELDS = ["maxWatches", "maxChannels", "maxApiKeys"];

// The detail column in words: "Unpaid invoice", "Free → Team", "watches 10 → 50".
export function describeDetail(entry: AuditEntry): string | null {
  const d = entry.detail;
  if (!d) return null;
  if (typeof d.reason === "string") return d.reason;
  if ("from" in d && "to" in d) return `${String(d.from)} → ${String(d.to)}`;
  // The database returns JSON keys sorted, so put them back in the form's order.
  if (entry.action === "plan.create") {
    return LIMIT_FIELDS.filter((f) => f in d)
      .map((f) => `${FIELD_NAMES[f]} ${String(d[f])}`)
      .join(", ");
  }
  if (entry.action === "plan.update") {
    return Object.entries(d)
      .map(([field, change]) => {
        const [before, after] = change as [unknown, unknown];
        return `${FIELD_NAMES[field] ?? field} ${String(before)} → ${String(after)}`;
      })
      .join(", ");
  }
  if (entry.action === "admin.create") return d.promoted ? "Promoted an existing account" : null;
  return null;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
