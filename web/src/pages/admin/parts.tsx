import { useEffect, useState } from "react";
import type { AdminUserRow } from "../../api/admin";
import { StatusBadge } from "../../components";

export function AccountState({
  user,
}: {
  user: Pick<AdminUserRow, "suspendedAt" | "lockedUntil">;
}) {
  if (user.suspendedAt) return <StatusBadge status="down" label="Suspended" />;
  if (user.lockedUntil) return <StatusBadge status="degraded" label="Locked" />;
  return <StatusBadge status="up" label="Active" />;
}

// Waits for typing to stop before searching, so each keystroke isn't a request.
export function useDebounced(value: string, ms = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
