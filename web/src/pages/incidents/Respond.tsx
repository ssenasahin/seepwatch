import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { api } from "../../api/client";
import { AuthHeader } from "../../auth/AuthLayout";
import { Alert, SkeletonRows } from "../../components";
import { formatTime } from "../../lib/format";
import "./incidents.css";

type Status = "OPEN" | "ACKNOWLEDGED" | "REVOKED" | "FALSE_POSITIVE" | "RISK_ACCEPTED";

interface Summary {
  status: Status;
  openedAt: string;
  acknowledgedBy: string | null;
  closedBy: string | null;
  finding: {
    detectorLabel: string;
    masked: string;
    lastLocation: { repository: string; path: string; line: number | null; url: string } | null;
    locationCount: number;
  };
}

const ENDED: Partial<Record<Status, string>> = {
  REVOKED: "marked it revoked",
  FALSE_POSITIVE: "closed it as a false positive",
  RISK_ACCEPTED: "closed it as an accepted risk",
};

// Where an alert's link leads. Opening it changes nothing: mail scanners open every
// link. The buttons do, signed by the link, with no sign-in needed.
export function RespondPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const by = params.get("by") ?? "";
  const exp = params.get("exp") ?? "";
  const sig = params.get("sig") ?? "";
  const query = new URLSearchParams({ by, exp, sig }).toString();
  // From the address bar: encoded, so it can't walk the request to another API path.
  const path = `/respond/${encodeURIComponent(id)}`;

  const preview = useQuery({
    queryKey: ["respond", id, by],
    queryFn: () => api<{ incident: Summary; as: string }>(`${path}?${query}`, { auth: false }),
    retry: false,
  });
  const respond = useMutation({
    mutationFn: (action: "ACKNOWLEDGE" | "REVOKE") =>
      api<{ incident: Summary }>(path, {
        method: "POST",
        body: { by, exp, sig, action },
        auth: false,
      }),
  });

  if (preview.isPending) return <SkeletonRows rows={3} height={32} />;
  if (preview.isError) {
    return (
      <>
        <AuthHeader title="Can't use this link" />
        <Alert tone="error">{preview.error.message}</Alert>
      </>
    );
  }

  const incident = respond.data?.incident ?? preview.data.incident;
  const { finding } = incident;
  const where = finding.lastLocation;
  const ended = ENDED[incident.status];

  if (ended) {
    return (
      <>
        <AuthHeader title={`The leaked ${finding.detectorLabel} is dealt with`} />
        <Alert tone="success">
          {incident.closedBy ?? "Someone"} {ended}. Seepwatch won't alert anyone about it again.
        </Alert>
      </>
    );
  }

  return (
    <>
      <AuthHeader title={`A ${finding.detectorLabel} was leaked`}>
        Found {formatTime(incident.openedAt)}
        {where && (
          <>
            {" in "}
            <a href={where.url} target="_blank" rel="noreferrer">
              {where.repository}/{where.path}
              {where.line ? `:${where.line}` : ""}
            </a>
          </>
        )}
        {finding.locationCount > 1 && ` and ${finding.locationCount - 1} more places`}.
      </AuthHeader>
      <p className="mono respond-secret">{finding.masked}</p>

      {incident.status === "ACKNOWLEDGED" ? (
        <Alert tone="info">
          {incident.acknowledgedBy} is on it. Reminders keep going out until it's marked revoked.
        </Alert>
      ) : (
        <p className="muted">
          "I'm on it" tells everyone alerted that someone is handling it and stops it from
          escalating further. Reminders continue until the key is revoked.
        </p>
      )}
      <p className="muted">
        Mark it revoked only once the key no longer works: rotating it without revoking the old one
        leaves the leak open. Either shows as {preview.data.as}.
      </p>

      {respond.error && <Alert tone="error">{respond.error.message}</Alert>}
      <div className="respond-actions">
        {incident.status === "OPEN" && (
          <button
            className="btn btn-block"
            onClick={() => respond.mutate("ACKNOWLEDGE")}
            disabled={respond.isPending}
          >
            I'm on it
          </button>
        )}
        <button
          className="btn btn-primary btn-block"
          onClick={() => respond.mutate("REVOKE")}
          disabled={respond.isPending}
        >
          It's revoked
        </button>
      </div>
    </>
  );
}
