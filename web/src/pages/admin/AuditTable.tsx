import { Link } from "react-router";
import { ACTIONS, describeDetail, type AuditEntry } from "../../api/admin";
import { formatTime, timeAgo } from "../../lib/format";

// Entries newest first. `showTarget` is off on a user's own page, where every entry
// is about them.
export function AuditTable({
  entries,
  showTarget = true,
}: {
  entries: AuditEntry[];
  showTarget?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table className="checks audit">
        <thead>
          <tr>
            <th>When</th>
            <th>Admin</th>
            <th>Action</th>
            {showTarget && <th>On</th>}
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>
                <span className="mono">{formatTime(e.createdAt)}</span>
                <div className="audit-sub">{timeAgo(e.createdAt)}</div>
              </td>
              <td>
                {e.actorEmail}
                <div className="audit-sub mono">{e.ip ?? "no IP"}</div>
              </td>
              <td>{ACTIONS[e.action] ?? e.action}</td>
              {showTarget && (
                <td>
                  {e.targetId && e.action.startsWith("user.") ? (
                    <Link to={`/admin/users/${e.targetId}`}>{e.target}</Link>
                  ) : (
                    (e.target ?? "—")
                  )}
                </td>
              )}
              <td className="check-error">{describeDetail(e) ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
