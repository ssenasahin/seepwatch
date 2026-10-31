import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, UserMinus, Users, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { alertKeys, useTeam, type Team } from "../../api/alerts";
import { ApiError, api } from "../../api/client";
import { useUser } from "../../auth/AuthProvider";
import { Alert, SkeletonRows, TextField } from "../../components";
import { timeAgo } from "../../lib/format";
import "../pages.css";
import "../settings/settings.css";
import "./alerts.css";

export function TeamPage() {
  const team = useTeam();
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Team</h1>
          <p>
            The people escalation can reach. They get alerts by email once they accept an invite,
            and never before.
          </p>
        </div>
      </header>

      {team.isPending && (
        <section className="card card-body">
          <SkeletonRows rows={3} height={48} />
        </section>
      )}
      {team.isError && <Alert tone="error">Couldn't load your team.</Alert>}
      {team.data && <TeamCards team={team.data} />}
    </>
  );
}

function TeamCards({ team }: { team: Team }) {
  const user = useUser();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: alertKeys.team });
  const [email, setEmail] = useState("");

  const invite = useMutation({
    mutationFn: (email: string) => api<Team>("/team/invites", { method: "POST", body: { email } }),
    onSuccess: (data) => {
      queryClient.setQueryData(alertKeys.team, data);
      setEmail("");
    },
  });
  const cancelInvite = useMutation({
    mutationFn: (id: string) => api(`/team/invites/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api(`/team/members/${userId}`, { method: "DELETE" }),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: alertKeys.policies });
    },
  });
  const leave = useMutation({
    mutationFn: (teamId: string) => api(`/team/memberships/${teamId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    invite.mutate(email);
  };
  const inviteError = invite.error instanceof ApiError ? invite.error : null;

  return (
    <div className="stack">
      <section className="card">
        <div className="card-body card-head">
          <div>
            <h2 className="security-title">{team.team.name}</h2>
            <p className="muted">
              {team.members.length === 1 ? "Just you, so far." : `${team.members.length} people`}
            </p>
          </div>
        </div>
        <ul className="item-list">
          {team.members.map((m) => (
            <li key={m.userId} className="item-row">
              <span className="item-icon">
                <Users size={18} aria-hidden />
              </span>
              <div className="item-main">
                <div className="item-title">
                  {m.email}
                  {m.userId === user.id && <span className="badge badge-up">You</span>}
                </div>
                <div className="item-meta">
                  {m.role === "OWNER" ? "Owner" : `Joined ${timeAgo(m.joinedAt)}`}
                </div>
              </div>
              {m.role !== "OWNER" && (
                <div className="item-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      if (confirm(`Remove ${m.email}? They'll stop getting your alerts.`)) {
                        removeMember.mutate(m.userId);
                      }
                    }}
                  >
                    <UserMinus size={14} aria-hidden /> Remove
                  </button>
                </div>
              )}
            </li>
          ))}
          {team.invites.map((i) => (
            <li key={i.id} className="item-row">
              <span className="item-icon">
                <Mail size={18} aria-hidden />
              </span>
              <div className="item-main">
                <div className="item-title">
                  {i.email}
                  <span className="badge badge-pending">Invited</span>
                </div>
                <div className="item-meta">
                  Sent {timeAgo(i.createdAt)} · the link works until{" "}
                  {new Date(i.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <div className="item-actions">
                <button
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => cancelInvite.mutate(i.id)}
                  aria-label={`Cancel the invite to ${i.email}`}
                >
                  <X size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <form className="card-body inline-form" onSubmit={submit} noValidate>
          <div className="inline-form-row">
            <TextField
              label="Invite someone"
              type="email"
              placeholder="grace@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              hint="They need a Seepwatch account with this address to accept."
              error={
                inviteError ? (inviteError.fieldError("email") ?? inviteError.message) : undefined
              }
            />
            <button className="btn btn-primary" disabled={!email || invite.isPending}>
              {invite.isPending ? "Sending…" : "Send invite"}
            </button>
          </div>
          {invite.isSuccess && <Alert tone="success">Invite sent. It works for 7 days.</Alert>}
        </form>
      </section>

      {team.memberOf.length > 0 && (
        <section className="card">
          <div className="card-body">
            <h2 className="security-title">Teams you're on</h2>
            <p className="muted">Their owners' escalation policies may email you.</p>
          </div>
          <ul className="item-list">
            {team.memberOf.map((t) => (
              <li key={t.id} className="item-row">
                <div className="item-main">
                  <div className="item-title">{t.name}</div>
                  <div className="item-meta">Owned by {t.ownerEmail}</div>
                </div>
                <div className="item-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      if (confirm(`Leave ${t.name}? You'll stop getting its alerts.`))
                        leave.mutate(t.id);
                    }}
                  >
                    Leave
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
