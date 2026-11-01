import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useAdminUsers, type UserStatus } from "../../api/admin";
import { Alert, EmptyState, Segmented, SkeletonRows } from "../../components";
import { timeAgo } from "../../lib/format";
import { AccountState, useDebounced } from "./parts";
import "../pages.css";
import "./admin.css";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "locked", label: "Locked" },
  { value: "admins", label: "Admins" },
] as const;

export function AdminUsersPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<UserStatus>("all");
  const q = useDebounced(query.trim());
  // A page number belongs to one search and filter; a new one starts from page 1.
  const filters = `${status} ${q}`;
  const [paging, setPaging] = useState({ filters, page: 1 });
  const page = paging.filters === filters ? paging.page : 1;
  const setPage = (n: number) => setPaging({ filters, page: n });
  const users = useAdminUsers(q, status, page);

  const data = users.data;
  const first = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = data ? first + data.users.length - 1 : 0;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Users</h1>
          <p>Every account on this Seepwatch: find one, see what it runs, and step in if needed.</p>
        </div>
      </header>

      <div className="list-controls">
        <label className="search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            className="input"
            placeholder="Search by email"
            aria-label="Search users"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="segmented-wrap">
          <Segmented label="Show" options={FILTERS} value={status} onChange={setStatus} />
        </div>
      </div>

      {users.isPending && (
        <section className="card card-body">
          <SkeletonRows rows={6} height={36} />
        </section>
      )}
      {users.isError && <Alert tone="error">Couldn't load users.</Alert>}

      {data && (
        <section className={`card${users.isPlaceholderData ? " is-refreshing" : ""}`}>
          {data.users.length === 0 ? (
            <EmptyState icon={Users} title="No one matches">
              Try part of the address, or another filter.
            </EmptyState>
          ) : (
            <>
              <div className="table-scroll">
                <table className="checks">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>State</th>
                      <th>Plan</th>
                      <th className="num">Watches</th>
                      <th>Two-factor</th>
                      <th>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <Link to={`/admin/users/${u.id}`} className="admin-user-link">
                            {u.email}
                          </Link>
                          {u.role === "SUPER_ADMIN" && <span className="role-tag">Admin</span>}
                        </td>
                        <td>
                          <AccountState user={u} />
                        </td>
                        <td>{u.plan?.name ?? <span className="muted">Default</span>}</td>
                        <td className="num">{u.watches}</td>
                        <td>{u.twoFactor ? "On" : <span className="muted">Off</span>}</td>
                        <td className="muted">{timeAgo(u.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pager">
                <span className="muted">
                  {first}–{last} of {data.total}
                </span>
                <div className="row">
                  <button
                    className="btn btn-sm"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft size={14} aria-hidden /> Newer
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={last >= data.total}
                    onClick={() => setPage(page + 1)}
                  >
                    Older <ChevronRight size={14} aria-hidden />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
