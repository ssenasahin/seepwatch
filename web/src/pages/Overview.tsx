import { Radar } from "lucide-react";
import { Link } from "react-router";
import { EmptyState } from "../components";

// The home page until watches exist: what to set up first, so the first leak found
// reaches someone.
export function OverviewPage() {
  return (
    <>
      <header className="page-header">
        <h1>Overview</h1>
      </header>
      <section className="card">
        <EmptyState
          icon={Radar}
          title="Nothing is being watched yet"
          action={
            <Link to="/channels" className="btn btn-primary">
              Set up a channel
            </Link>
          }
        >
          Seepwatch will scan GitHub and paste sites for your domains, addresses and keys. While the
          scanners are being built, set up where alerts go: a channel, your team and an escalation
          policy.
        </EmptyState>
      </section>
    </>
  );
}
