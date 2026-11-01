import { Radar } from "lucide-react";
import { Link } from "react-router";
import { useChannels } from "../api/alerts";
import { isVerified, useWatches } from "../api/watches";
import { Alert, EmptyState, SkeletonRows } from "../components";

// The home page until findings exist: what is watched, what still needs proof, and
// whether a leak would reach anyone.
export function OverviewPage() {
  const watches = useWatches();
  const channels = useChannels();

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
          <Alert tone="info">
            The scanners are still being built, so nothing has been searched yet. Findings will show
            up here.
          </Alert>
        </div>
      )}
    </>
  );
}
