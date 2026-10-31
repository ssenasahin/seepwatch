import { Compass } from "lucide-react";
import { Link } from "react-router";
import { EmptyState } from "../components";

export function NotFoundPage() {
  return (
    <section className="card" style={{ marginTop: "var(--space-6)" }}>
      <EmptyState
        icon={Compass}
        title="Nothing lives at this address"
        action={
          <Link to="/" className="btn">
            Back to the overview
          </Link>
        }
      >
        The page may have moved, or the link may be mistyped.
      </EmptyState>
    </section>
  );
}
