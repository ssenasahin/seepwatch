import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { adminKeys, useAdminUser, usePlans, type AdminUserDetail } from "../../api/admin";
import { ApiError, api } from "../../api/client";
import { useUser } from "../../auth/AuthProvider";
import { Alert, SelectField, SkeletonRows, TextField } from "../../components";
import { formatTime, timeAgo } from "../../lib/format";
import { AccountState } from "./parts";
import { AuditTable } from "./AuditTable";
import "../pages.css";
import "./admin.css";

export function AdminUserPage() {
  const { id = "" } = useParams();
  const detail = useAdminUser(id);

  return (
    <>
      <Link to="/admin/users" className="back-link">
        <ArrowLeft size={14} aria-hidden /> Users
      </Link>
      {detail.isPending && (
        <section className="card card-body">
          <SkeletonRows rows={4} height={40} />
        </section>
      )}
      {detail.isError && (
        <Alert tone="error">
          {detail.error instanceof ApiError && detail.error.status === 404
            ? "There's no account with this address."
            : "Couldn't load this account."}
        </Alert>
      )}
      {detail.data && <UserBody data={detail.data} />}
    </>
  );
}

function UserBody({ data: { user, history } }: { data: AdminUserDetail }) {
  const me = useUser();
  const queryClient = useQueryClient();
  const plans = usePlans();
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  // Every action answers with the account as it now is.
  const act = useMutation({
    mutationFn: (a: { path: string; method?: string; body?: unknown; done: string | null }) =>
      api<AdminUserDetail>(`/admin/users/${user.id}${a.path}`, {
        method: a.method ?? "POST",
        body: a.body,
      }).then((next) => ({ next, done: a.done })),
    onSuccess: async ({ next, done }) => {
      queryClient.setQueryData(adminKeys.user(user.id), next);
      setNotice(done);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onMutate: () => setNotice(null),
  });
  const error =
    act.error instanceof ApiError ? act.error.message : act.error && "Something went wrong";

  const isAdmin = user.role === "SUPER_ADMIN";

  return (
    <>
      <header className="page-header">
        <div className="detail-title">
          <h1 className="admin-email">{user.email}</h1>
          <div className="row admin-badges">
            <AccountState user={user} />
            {isAdmin && <span className="role-tag">Admin</span>}
            <span className="muted">Joined {formatTime(user.createdAt)}</span>
          </div>
        </div>
      </header>

      <div className="stack">
        {user.suspendedAt && (
          <Alert tone="error">
            Suspended {timeAgo(user.suspendedAt)}. They can't sign in or use API keys, and no alerts
            go out.
          </Alert>
        )}
        {user.lockedUntil && (
          <Alert tone="info">
            Locked after too many wrong passwords, until {formatTime(user.lockedUntil)}.
          </Alert>
        )}
        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <section className="card card-body">
          <dl className="facts">
            <div>
              <dt>Watches</dt>
              <dd>
                {user.watches} <span className="of">of {user.limits.maxWatches}</span>
              </dd>
            </div>
            <div>
              <dt>Channels</dt>
              <dd>
                {user.channels} <span className="of">of {user.limits.maxChannels}</span>
              </dd>
            </div>
            <div>
              <dt>API keys</dt>
              <dd>
                {user.apiKeys} <span className="of">of {user.limits.maxApiKeys}</span>
              </dd>
            </div>
            <div>
              <dt>Signed in on</dt>
              <dd>
                {user.liveSessions} {user.liveSessions === 1 ? "device" : "devices"}
              </dd>
            </div>
            <div>
              <dt>Last sign-in</dt>
              <dd>{user.lastSignInAt ? timeAgo(user.lastSignInAt) : "Never"}</dd>
            </div>
            <div>
              <dt>Two-factor</dt>
              <dd>{user.twoFactor ? "On" : "Off"}</dd>
            </div>
          </dl>
        </section>

        <section className="card card-body admin-actions">
          <div className="plan-select">
            <SelectField
              label="Plan"
              value={user.plan?.id ?? ""}
              disabled={!plans.data || act.isPending}
              hint={`Limits now come from ${user.limits.plan}.`}
              onChange={(e) => {
                const planId = e.target.value || null;
                const name = plans.data?.find((p) => p.id === planId)?.name ?? "the default plan";
                act.mutate({
                  path: "",
                  method: "PATCH",
                  body: { planId },
                  done: `Moved to ${name}.`,
                });
              }}
            >
              <option value="">Default plan</option>
              {plans.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
          </div>

          <h2 className="section-title">Access</h2>
          <div className="admin-action">
            <div>
              <strong>Password reset link</strong>
              <p className="muted">
                Emails a link that works for 24 hours. Their password stays as is until they use it.
              </p>
            </div>
            <button
              className="btn"
              disabled={act.isPending}
              onClick={() =>
                act.mutate({ path: "/reset-link", done: `Sent a reset link to ${user.email}.` })
              }
            >
              Send link
            </button>
          </div>
          {user.lockedUntil && (
            <div className="admin-action">
              <div>
                <strong>Unlock</strong>
                <p className="muted">Lets them try their password again right away.</p>
              </div>
              <button
                className="btn"
                disabled={act.isPending}
                onClick={() => act.mutate({ path: "/unlock", done: "Unlocked." })}
              >
                Unlock
              </button>
            </div>
          )}

          {user.suspendedAt ? (
            <div className="admin-action">
              <div>
                <strong>Reactivate</strong>
                <p className="muted">They can sign in again and their checks start back up.</p>
              </div>
              <button
                className="btn btn-primary"
                disabled={act.isPending}
                onClick={() => act.mutate({ path: "/reactivate", done: null })}
              >
                Reactivate
              </button>
            </div>
          ) : isAdmin || user.id === me.id ? (
            <p className="muted">Admin accounts can't be suspended.</p>
          ) : (
            <form
              className="admin-action"
              onSubmit={(e) => {
                e.preventDefault();
                if (confirm(`Suspend ${user.email}? They're signed out everywhere at once.`)) {
                  act.mutate({
                    path: "/suspend",
                    body: { reason: reason.trim() || undefined },
                    done: null,
                  });
                }
              }}
            >
              <div className="admin-action-grow">
                <strong>Suspend</strong>
                <p className="muted">
                  Signs them out, blocks sign-in and API keys, and pauses their checks and alerts.
                  Nothing is deleted.
                </p>
                <TextField
                  label="Reason"
                  placeholder="Unpaid invoice"
                  maxLength={200}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  hint="Kept in the audit log."
                />
              </div>
              <button className="btn btn-danger" disabled={act.isPending}>
                Suspend
              </button>
            </form>
          )}
        </section>

        <section className="card">
          <div className="card-body checks-head">
            <h2 className="section-title">Admin history</h2>
          </div>
          {history.length === 0 ? (
            <p className="card-body muted">No admin has changed this account.</p>
          ) : (
            <AuditTable entries={history} showTarget={false} />
          )}
        </section>
      </div>
    </>
  );
}
