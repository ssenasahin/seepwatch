import { Siren } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useIncidents, type Incident, type IncidentFilter } from "../../api/incidents";
import { Alert, EmptyState, Segmented, SkeletonRows } from "../../components";
import { formatTime, timeAgo } from "../../lib/format";
import { IncidentBadge, LocationLink } from "./parts";
import "../pages.css";
import "./incidents.css";

const FILTERS = [
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
] as const;

const EMPTY: Record<IncidentFilter, string> = {
  active:
    "Nothing leaked is waiting on anyone. Seepwatch opens an incident here the moment it finds a secret.",
  closed: "No leak has been closed yet.",
  all: "When Seepwatch finds a secret, it opens an incident here and keeps alerting until someone marks it revoked.",
};

// Every leak, newest first, with where it stands.
export function IncidentsPage() {
  const [filter, setFilter] = useState<IncidentFilter>("active");
  const incidents = useIncidents(filter);
  const rows = incidents.data?.pages.flatMap((p) => p.incidents) ?? [];

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Leaks</h1>
          <p>Every secret Seepwatch found, where it was, and who is dealing with it.</p>
        </div>
      </header>

      <div className="list-controls">
        <Segmented label="Show" options={FILTERS} value={filter} onChange={setFilter} />
      </div>

      {incidents.isPending && (
        <section className="card card-body">
          <SkeletonRows rows={5} height={36} />
        </section>
      )}

      {incidents.isError && (
        <Alert tone="error">
          Couldn't load leaks.{" "}
          <button className="link-button" onClick={() => void incidents.refetch()}>
            Try again
          </button>
        </Alert>
      )}

      {incidents.data && (
        <section className={`card${incidents.isPlaceholderData ? " is-refreshing" : ""}`}>
          {rows.length === 0 ? (
            <EmptyState icon={Siren} title="No leaks">
              {EMPTY[filter]}
            </EmptyState>
          ) : (
            <>
              <div className="table-scroll">
                <table className="checks incidents">
                  <thead>
                    <tr>
                      <th>State</th>
                      <th>Secret</th>
                      <th>Where</th>
                      <th>Found</th>
                      <th>Who</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((i) => (
                      <IncidentRow key={i.id} incident={i} />
                    ))}
                  </tbody>
                </table>
              </div>
              {incidents.hasNextPage && (
                <div className="pager">
                  <span className="muted">{rows.length} leaks</span>
                  <button
                    className="btn btn-sm"
                    disabled={incidents.isFetchingNextPage}
                    onClick={() => void incidents.fetchNextPage()}
                  >
                    {incidents.isFetchingNextPage ? "Loading…" : "Load older"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}

// Who's on it, or how it ended.
function who(i: Incident): string {
  if (i.closedBy) return i.closedBy;
  if (i.acknowledgedBy) return i.acknowledgedBy;
  return i.alertsSent > 0 ? "Nobody yet" : "Alerting…";
}

function IncidentRow({ incident: i }: { incident: Incident }) {
  const where = i.finding.lastLocation;
  return (
    <tr>
      <td>
        <IncidentBadge status={i.status} />
      </td>
      <td>
        <Link to={`/incidents/${i.id}`} className="incident-secret">
          {i.finding.detectorLabel}
        </Link>
        <div className="mono muted">{i.finding.masked}</div>
      </td>
      <td>
        {where ? <LocationLink where={where} source={where.source} /> : "—"}
        {i.finding.locationCount > 1 && (
          <div className="muted">and {i.finding.locationCount - 1} more places</div>
        )}
      </td>
      <td>
        <span className="mono">{formatTime(i.openedAt)}</span>
        <div className="muted">{timeAgo(i.openedAt)}</div>
      </td>
      <td className={i.status === "OPEN" && i.alertsSent > 0 ? "is-bad" : undefined}>{who(i)}</td>
    </tr>
  );
}
