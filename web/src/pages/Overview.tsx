import { ExternalLink, Radar } from "lucide-react";
import { Link } from "react-router";
import { useChannels } from "../api/alerts";
import { useFindings, type Finding } from "../api/findings";
import { useActiveIncidents } from "../api/incidents";
import { isVerified, useWatches } from "../api/watches";
import { Alert, EmptyState, SkeletonRows } from "../components";
import { timeAgo } from "../lib/format";
import "./alerts/alerts.css";

const RECENT = 5;

// The home page: what is watched, what still needs proof, whether a leak would reach
// anyone, and the latest leaks found.
export function OverviewPage() {
  const watches = useWatches();
  const channels = useChannels();
  const findings = useFindings();
  const incidents = useActiveIncidents();
  const unanswered = incidents.data?.filter((i) => i.status === "OPEN").length ?? 0;

  return (
    <>
      <header className="page-header">
        <h1>Overview</h1>
      </header>

      {watches.isPending && (
        <section className="card card-body">
          <SkeletonRows rows={2} height={48} />
        </section>
      )}
      {watches.isError && <Alert tone="error">Couldn't load your watches.</Alert>}

      {watches.data && watches.data.length === 0 && (
        <section className="card">
          <EmptyState
            icon={Radar}
            title="Nothing is being watched yet"
            action={
              <Link to="/watches" className="btn btn-primary">
                Add your domain
              </Link>
            }
          >
            Seepwatch scans GitHub and paste sites for your domains, addresses and keys. Start with
            your domain and prove it's yours.
          </EmptyState>
        </section>
      )}

      {watches.data && watches.data.length > 0 && (
        <div className="stack">
          <div className="tiles">
            <div className="tile">
              <div className="tile-label">Active leaks</div>
              <div className="tile-value">{incidents.data?.length ?? "—"}</div>
              <div className="tile-note">
                {unanswered > 0 ? `${unanswered} with nobody on it` : "Until each is revoked"}
              </div>
            </div>
            <div className="tile">
              <div className="tile-label">Watched</div>
              <div className="tile-value">
                {watches.data.filter((w) => w.enabled && isVerified(w)).length}
              </div>
              <div className="tile-note">of {watches.data.length} watches</div>
            </div>
            <div className="tile">
              <div className="tile-label">Waiting for proof</div>
              <div className="tile-value">{watches.data.filter((w) => !isVerified(w)).length}</div>
              <div className="tile-note">
                <Link to="/watches">Verify on the Watches page</Link>
              </div>
            </div>
            <div className="tile">
              <div className="tile-label">Channels</div>
              <div className="tile-value">
                {channels.data?.filter((c) => c.enabled).length ?? "—"}
              </div>
              <div className="tile-note">
                <Link to="/channels">Besides your email</Link>
              </div>
            </div>
          </div>
          <RecentFindings findings={findings.data} failed={findings.isError} />
        </div>
      )}
    </>
  );
}

function RecentFindings({ findings, failed }: { findings?: Finding[]; failed: boolean }) {
  if (failed) return <Alert tone="error">Couldn't load findings.</Alert>;
  if (!findings) return null;
  if (findings.length === 0) {
    return (
      <Alert tone="info">
        No leaks found so far. Organizations are scanned every 15 minutes and domains every 6 hours,
        once they're verified.
      </Alert>
    );
  }
  return (
    <section className="card">
      <div className="card-body">
        <h2 className="section-title">Latest findings</h2>
      </div>
      <ul className="item-list">
        {findings.slice(0, RECENT).map((f) => {
          const where = f.locations[0];
          return (
            <li key={f.id} className="item-row">
              <div className="item-main">
                <div className="item-title">
                  <span>{f.detectorLabel}</span>
                  <code className="mono">{f.masked}</code>
                </div>
                <div className="item-meta">
                  {where && (
                    <a href={where.url} target="_blank" rel="noreferrer">
                      {where.repository}/{where.path}
                      {where.line ? `:${where.line}` : ""} <ExternalLink size={12} aria-hidden />
                    </a>
                  )}
                  {f.locationCount > 1 && <span>and {f.locationCount - 1} more places</span>}
                  <span>found {timeAgo(f.firstSeenAt)}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
