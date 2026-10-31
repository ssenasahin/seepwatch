import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Link, useParams } from "react-router";
import { alertKeys } from "../../api/alerts";
import { api } from "../../api/client";
import { useUser } from "../../auth/AuthProvider";
import { Alert, SkeletonRows } from "../../components";
import "../pages.css";
import "../settings/settings.css";
import "./alerts.css";

interface Invite {
  email: string;
  team: string;
  invitedBy: string;
}

// Where an invite email's link leads. Signing in comes first (the route requires it),
// so the page can say plainly whether this account is the one invited.
export function InvitePage() {
  const { token = "" } = useParams();
  const user = useUser();
  const queryClient = useQueryClient();
  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api<Invite>(`/team/invites/${token}`),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () =>
      api<{ team: { name: string } }>(`/team/invites/${token}/accept`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: alertKeys.team }),
  });

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Team invite</h1>
        </div>
      </header>
      <section className="card card-body secret-once narrow-card">
        {invite.isPending && <SkeletonRows rows={2} height={32} />}
        {invite.isError && <Alert tone="error">{invite.error.message}</Alert>}
        {invite.data && !accept.isSuccess && (
          <>
            <div className="security-row">
              <span className="security-icon">
                <Users size={20} aria-hidden />
              </span>
              <div>
                <h2 className="security-title">Join {invite.data.team}</h2>
                <p className="muted">
                  {invite.data.invitedBy} wants their outage alerts to be able to reach you. You'll
                  only be emailed when one of their escalation policies names you.
                </p>
              </div>
            </div>
            {invite.data.email !== user.email ? (
              <Alert tone="error">
                This invite is for {invite.data.email}, and you're signed in as {user.email}. Sign
                in with the invited address to accept it.
              </Alert>
            ) : (
              <div className="row">
                <button
                  className="btn btn-primary"
                  onClick={() => accept.mutate()}
                  disabled={accept.isPending}
                >
                  {accept.isPending ? "Joining…" : "Accept and join"}
                </button>
                <Link to="/" className="btn btn-ghost">
                  Not now
                </Link>
              </div>
            )}
            {accept.error && <Alert tone="error">{accept.error.message}</Alert>}
          </>
        )}
        {accept.isSuccess && (
          <Alert tone="success">
            You're on {accept.data.team.name}. You can leave it any time from the{" "}
            <Link to="/team">Team</Link> page.
          </Alert>
        )}
      </section>
    </>
  );
}
