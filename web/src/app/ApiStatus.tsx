import { useHealth } from "../api/health";

// A quiet indicator in the sidebar: is the API this page talks to reachable?
export function ApiStatus() {
  const health = useHealth();

  let tone = "pending";
  let text = "Checking API…";
  if (health.isError) {
    tone = "down";
    text = "API unreachable";
  } else if (health.data?.status === "ok") {
    tone = "up";
    text = "API operational";
  } else if (health.data) {
    tone = "degraded";
    text = "Database unreachable";
  }

  return (
    <div className="api-status" role="status">
      <span className={`api-dot api-dot-${tone}`} aria-hidden />
      <span>{text}</span>
      {health.data?.status === "ok" && (
        <span className="mono muted">{health.data.latencyMs} ms</span>
      )}
    </div>
  );
}
