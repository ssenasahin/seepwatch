import { formatBytes, useSystemHealth, type SystemHealth } from "../../api/admin";
import { Alert, SkeletonRows } from "../../components";
import { timeAgo } from "../../lib/format";
import "../pages.css";
import "./admin.css";

const QUEUE_NAMES: Record<string, string> = {
  scans: "Scans",
  notifications: "Alerts",
  escalations: "Escalations",
};

// Refreshed every 10 seconds.
export function SystemHealthPage() {
  const health = useSystemHealth();

  return (
    <>
      <header className="page-header">
        <div>
          <h1>System health</h1>
          <p>
            Whether the scanners keep running: the workers, their queues and how much the data takes
            up.
          </p>
        </div>
        {health.data && (
          <span className="muted">
            Updated {timeAgo(health.data.generatedAt, health.dataUpdatedAt)}
          </span>
        )}
      </header>

      {health.isPending && (
        <section className="card card-body">
          <SkeletonRows rows={4} height={48} />
        </section>
      )}
      {health.isError && <Alert tone="error">Couldn't load system health.</Alert>}
      {health.data && <HealthBody health={health.data} />}
    </>
  );
}

function HealthBody({ health: h }: { health: SystemHealth }) {
  const backlog = h.queues?.reduce((sum, q) => sum + q.waiting, 0) ?? 0;

  return (
    <div className="stack">
      {h.queues === null && (
        <Alert tone="error">
          Redis isn't answering, so the queues can't be read. Scans are probably not running.
        </Alert>
      )}
      {h.workers === 0 && (
        <Alert tone="error">
          No worker is connected. Start one with <code className="mono">npm run worker</code>.
        </Alert>
      )}

      <div className="tiles admin-tiles">
        <div className="tile">
          <div className="tile-label">Workers</div>
          <div className="tile-value">{h.workers ?? "—"}</div>
          <div className="tile-note">{backlog} jobs waiting</div>
        </div>
        <div className="tile">
          <div className="tile-label">Database</div>
          <div className="tile-value">{formatBytes(h.database.bytes)}</div>
          <div className="tile-note">PostgreSQL</div>
        </div>
        <div className="tile">
          <div className="tile-label">Redis memory</div>
          <div className="tile-value">{formatBytes(h.redis.bytes)}</div>
          <div className="tile-note">Queues and schedules</div>
        </div>
        <div className="tile">
          <div className="tile-label">Accounts</div>
          <div className="tile-value">{h.users}</div>
          <div className="tile-note">{h.liveSessions} signed-in sessions</div>
        </div>
      </div>

      {h.queues && h.queues.length > 0 && (
        <section className="card">
          <div className="card-body checks-head">
            <h2 className="section-title">Queues</h2>
          </div>
          <div className="table-scroll">
            <table className="checks">
              <thead>
                <tr>
                  <th>Queue</th>
                  <th className="num">Waiting</th>
                  <th className="num">Running</th>
                  <th className="num">Scheduled</th>
                  <th className="num">Failed</th>
                  <th className="num">Workers</th>
                </tr>
              </thead>
              <tbody>
                {h.queues.map((q) => (
                  <tr key={q.name}>
                    <td>{QUEUE_NAMES[q.name] ?? q.name}</td>
                    <td className="num">{q.waiting}</td>
                    <td className="num">{q.active}</td>
                    <td className="num">{q.delayed}</td>
                    <td className={`num${q.failed ? " is-bad" : ""}`}>{q.failed}</td>
                    <td className={`num${q.workers ? "" : " is-bad"}`}>{q.workers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-body checks-head">
          <h2 className="section-title">Largest tables</h2>
        </div>
        <div className="table-scroll">
          <table className="checks">
            <tbody>
              {h.database.tables.map((t) => (
                <tr key={t.name}>
                  <td className="mono">{t.name}</td>
                  <td className="num">{formatBytes(t.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
