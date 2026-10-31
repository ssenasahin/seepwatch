import { useQuery } from "@tanstack/react-query";

export interface Health {
  status: "ok" | "degraded";
  database: "up" | "down";
  latencyMs: number;
}

async function fetchHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  // A 503 still carries a useful body; only a missing or non-JSON body is a failure.
  return (await res.json()) as Health;
}

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: fetchHealth, refetchInterval: 30_000 });
}
