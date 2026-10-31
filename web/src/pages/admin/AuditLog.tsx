import { ScrollText, Search } from "lucide-react";
import { useState } from "react";
import { ACTIONS, useAuditLog } from "../../api/admin";
import { Alert, EmptyState, SelectField, SkeletonRows } from "../../components";
import { useDebounced } from "./parts";
import { AuditTable } from "./AuditTable";
import "../pages.css";
import "./admin.css";

// Everything an admin did, who did it, when and from where. Entries can't be edited
// or deleted, not even straight in the database.
export function AuditLogPage() {
  const [action, setAction] = useState("");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim());
  const log = useAuditLog(action, q);
  const entries = log.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Audit log</h1>
          <p>Every admin action, kept for good: it can't be edited or deleted.</p>
        </div>
      </header>

      <div className="list-controls">
        <label className="search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            className="input"
            placeholder="Search by admin or account"
            aria-label="Search the audit log"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <SelectField label="Action" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {Object.entries(ACTIONS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
      </div>

      {log.isPending && (
        <section className="card card-body">
          <SkeletonRows rows={6} height={36} />
        </section>
      )}
      {log.isError && <Alert tone="error">Couldn't load the audit log.</Alert>}

      {log.data && (
        <section className={`card${log.isPlaceholderData ? " is-refreshing" : ""}`}>
          {entries.length === 0 ? (
            <EmptyState icon={ScrollText} title="Nothing recorded">
              {action || q
                ? "No entry matches."
                : "Suspending an account, sending a reset link or changing a plan shows up here."}
            </EmptyState>
          ) : (
            <>
              <AuditTable entries={entries} />
              {log.hasNextPage && (
                <div className="pager">
                  <span className="muted">{entries.length} entries</span>
                  <button
                    className="btn btn-sm"
                    disabled={log.isFetchingNextPage}
                    onClick={() => void log.fetchNextPage()}
                  >
                    {log.isFetchingNextPage ? "Loading…" : "Load older"}
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
