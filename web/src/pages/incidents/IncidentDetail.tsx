import {
  ArrowLeft,
  BellRing,
  CheckCircle2,
  CircleAlert,
  CircleSlash,
  Copy,
  Hand,
  Megaphone,
  Repeat,
  ShieldOff,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { ApiError } from "../../api/client";
import {
  isActive,
  useIncident,
  useIncidentAction,
  type Incident,
  type IncidentDetail,
  type IncidentEventType,
} from "../../api/incidents";
import { Alert, Segmented, SkeletonRows } from "../../components";
import { formatTime, timeAgo } from "../../lib/format";
import { NotFoundPage } from "../NotFound";
import { IncidentBadge, LocationLink, SOURCES } from "./parts";
import "../pages.css";
import "./incidents.css";

const EVENTS: Record<IncidentEventType, { label: string; icon: LucideIcon; tone: string }> = {
  OPENED: { label: "Found", icon: CircleAlert, tone: "bad" },
  NOTIFIED: { label: "Alerted", icon: BellRing, tone: "muted" },
  NOT_DELIVERED: { label: "Alert didn't arrive", icon: TriangleAlert, tone: "warn" },
  ESCALATED: { label: "Escalated", icon: Megaphone, tone: "warn" },
  REMINDED: { label: "Reminded", icon: Repeat, tone: "muted" },
  ACKNOWLEDGED: { label: "Someone's on it", icon: Hand, tone: "info" },
  SEEN_AGAIN: { label: "Seen somewhere else", icon: Copy, tone: "warn" },
  REVOKED: { label: "Revoked", icon: CheckCircle2, tone: "good" },
  FALSE_POSITIVE: { label: "False positive", icon: CircleSlash, tone: "muted" },
  RISK_ACCEPTED: { label: "Risk accepted", icon: ShieldOff, tone: "muted" },
};

const ENDINGS = {
  REVOKED: "marked it revoked",
  FALSE_POSITIVE: "closed it as a false positive",
  RISK_ACCEPTED: "closed it as an accepted risk",
} as const;

export function IncidentDetailPage() {
  const { id = "" } = useParams();
  const incident = useIncident(id);

  if (incident.error instanceof ApiError && incident.error.status === 404) return <NotFoundPage />;
  return (
    <>
      <Link to="/incidents" className="back-link">
        <ArrowLeft size={14} aria-hidden /> Leaks
      </Link>
      {incident.isPending && (
        <section className="card card-body">
          <SkeletonRows rows={4} height={40} />
        </section>
      )}
      {incident.isError && <Alert tone="error">Couldn't load this leak.</Alert>}
      {incident.data && <IncidentBody detail={incident.data} />}
    </>
  );
}

function IncidentBody({ detail: { incident: i, locations, events } }: { detail: IncidentDetail }) {
  const act = useIncidentAction(i.id);
  const [closing, setClosing] = useState(false);
  const active = isActive(i);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>
            {i.finding.detectorLabel} <IncidentBadge status={i.status} />
          </h1>
          <p className="mono">{i.finding.masked}</p>
        </div>
        {active && (
          <div className="incident-actions">
            {i.status === "OPEN" && (
              <button
                className="btn"
                onClick={() => act.mutate({ action: "ACKNOWLEDGE" })}
                disabled={act.isPending}
              >
                <Hand size={16} aria-hidden /> I'm on it
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={() => {
                if (confirm("Mark it revoked only once the key no longer works. Is it?")) {
                  act.mutate({ action: "REVOKE" });
                }
              }}
              disabled={act.isPending}
            >
              <CheckCircle2 size={16} aria-hidden /> It's revoked
            </button>
            <button className="btn btn-ghost" onClick={() => setClosing((c) => !c)}>
              Close another way
            </button>
          </div>
        )}
      </header>

      <div className="stack">
        {act.error && !closing && <Alert tone="error">{act.error.message}</Alert>}
        <StatusNote incident={i} />
        {active && closing && <CloseForm incident={i} onDone={() => setClosing(false)} />}

        <dl className="card card-body facts">
          <div>
            <dt>Found</dt>
            <dd className="mono">{formatTime(i.openedAt)}</dd>
          </div>
          <div>
            <dt>Watch</dt>
            <dd>
              {i.finding.watch ? (i.finding.watch.label ?? i.finding.watch.value) : "Deleted"}
            </dd>
          </div>
          <div>
            <dt>Alert rounds</dt>
            <dd>{i.alertsSent}</dd>
          </div>
          <div>
            <dt>{active ? "Next alert" : "Closed"}</dt>
            <dd>
              {active
                ? i.nextAlertAt
                  ? timeAgo(i.nextAlertAt)
                  : "None"
                : i.closedAt
                  ? timeAgo(i.closedAt)
                  : "—"}
            </dd>
          </div>
        </dl>

        <section className="card">
          <div className="card-body checks-head">
            <h2 className="section-title">
              Where it was found{locations.length > 1 ? ` (${locations.length} places)` : ""}
            </h2>
          </div>
          <ul className="location-list">
            {locations.map((l) => (
              <li key={l.url} className="location">
                <div className="location-head">
                  <span className="location-source">{SOURCES[l.source]}</span>
                  <LocationLink where={l} source={l.source} />
                  <span className="muted">
                    {l.committedAt ? `committed ${timeAgo(l.committedAt)}, ` : ""}seen{" "}
                    {timeAgo(l.seenAt)}
                  </span>
                </div>
                {/* Every secret in these lines is masked before it's stored. */}
                <pre className="location-context">{l.context}</pre>
              </li>
            ))}
          </ul>
        </section>

        <section className="card card-body">
          <h2 className="section-title">Timeline</h2>
          <ol className="timeline">
            {events.map((e) => {
              const { label, icon: Icon, tone } = EVENTS[e.type];
              return (
                <li key={e.id} className={`timeline-item tone-${tone}`}>
                  <span className="timeline-dot">
                    <Icon size={14} aria-hidden />
                  </span>
                  <div className="timeline-body">
                    <div className="timeline-head">
                      <strong>{label}</strong>
                      <time className="mono" dateTime={e.at}>
                        {formatTime(e.at)}
                      </time>
                    </div>
                    {e.detail && <p className="timeline-detail">{e.detail}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </>
  );
}

// What happens next, or how it ended.
function StatusNote({ incident: i }: { incident: Incident }) {
  if (i.status === "OPEN") {
    return (
      <Alert tone="error">
        Nobody has said they're on it. Seepwatch keeps alerting, along the watch's escalation policy
        and then every hour, until someone does. Rotate the key, revoke the old one, then mark it
        revoked.
      </Alert>
    );
  }
  if (i.status === "ACKNOWLEDGED") {
    return (
      <Alert tone="info">
        {i.acknowledgedBy} is on it, since {timeAgo(i.acknowledgedAt!)}. Reminders go out every 4
        hours until it's marked revoked.
      </Alert>
    );
  }
  const ending = ENDINGS[i.status as keyof typeof ENDINGS];
  return (
    <Alert tone="success">
      {i.closedBy} {ending}
      {i.closedAt ? ` ${timeAgo(i.closedAt)}` : ""}.{i.closeReason ? ` "${i.closeReason}"` : ""} No
      more alerts go out about it.
    </Alert>
  );
}

const CLOSE_AS = [
  { value: "FALSE_POSITIVE", label: "False positive" },
  { value: "ACCEPT_RISK", label: "Accept the risk" },
] as const;

// Closing without revoking: a reason is required, so whoever reads this later knows.
function CloseForm({ incident: i, onDone }: { incident: Incident; onDone: () => void }) {
  const act = useIncidentAction(i.id);
  const [action, setAction] = useState<(typeof CLOSE_AS)[number]["value"]>("FALSE_POSITIVE");
  const [reason, setReason] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    act.mutate({ action, reason }, { onSuccess: onDone });
  }

  return (
    <form className="card card-body close-form" onSubmit={submit}>
      <Segmented label="Close as" options={CLOSE_AS} value={action} onChange={setAction} small />
      <p className="muted">
        {action === "FALSE_POSITIVE"
          ? "It isn't a real secret: a placeholder, an example, a test value."
          : "It's real but harmless enough to leave: a key with no access, say."}
      </p>
      <label className="field">
        <span className="field-label">Why</span>
        <textarea
          className="input"
          rows={3}
          maxLength={500}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {act.error && <Alert tone="error">{act.error.message}</Alert>}
      <div>
        <button className="btn btn-primary" disabled={act.isPending || !reason.trim()}>
          {act.isPending ? "Closing…" : "Close it"}
        </button>
      </div>
    </form>
  );
}
