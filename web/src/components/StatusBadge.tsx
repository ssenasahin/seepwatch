import { Check, Clock, Pause, TriangleAlert, Wrench, X, type LucideIcon } from "lucide-react";

export type Status = "up" | "down" | "degraded" | "maintenance" | "paused" | "pending";

const META: Record<Status, { label: string; Icon: LucideIcon }> = {
  up: { label: "Operational", Icon: Check },
  down: { label: "Down", Icon: X },
  degraded: { label: "Degraded", Icon: TriangleAlert },
  maintenance: { label: "Maintenance", Icon: Wrench },
  paused: { label: "Paused", Icon: Pause },
  pending: { label: "Pending", Icon: Clock },
};

// `label` renames the state where the default word would mislead, like an incident
// that's over: green and checked, but "Resolved", not "Operational".
export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  const { label: defaultLabel, Icon } = META[status];
  return (
    <span className={`badge badge-${status}`}>
      <Icon size={13} strokeWidth={2.5} aria-hidden />
      {label ?? defaultLabel}
    </span>
  );
}
