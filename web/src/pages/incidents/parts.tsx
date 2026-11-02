import type { FindingLocation } from "../../api/findings";
import type { IncidentStatus } from "../../api/incidents";
import { StatusBadge, type Status } from "../../components";

const BADGES: Record<IncidentStatus, { status: Status; label: string }> = {
  OPEN: { status: "down", label: "Open" },
  ACKNOWLEDGED: { status: "degraded", label: "On it" },
  REVOKED: { status: "up", label: "Revoked" },
  FALSE_POSITIVE: { status: "paused", label: "False positive" },
  RISK_ACCEPTED: { status: "maintenance", label: "Risk accepted" },
};

export function IncidentBadge({ status }: { status: IncidentStatus }) {
  const { status: tone, label } = BADGES[status];
  return <StatusBadge status={tone} label={label} />;
}

export const SOURCES: Record<FindingLocation["source"], string> = {
  GITHUB_COMMIT: "Commit",
  GITHUB_CODE: "Code search",
  GIST: "Gist",
  PASTEBIN: "Pastebin",
};

// Where a secret was found, in a few words: "acme/api", "gist by ada", "Pastebin Ab12".
export function placeOf(where: { repository: string }, source?: FindingLocation["source"]) {
  if (source === "GIST") {
    const owner = where.repository.split("/")[0];
    return owner === "anonymous" ? "anonymous gist" : `gist by ${owner}`;
  }
  if (source === "PASTEBIN") return `Pastebin ${where.repository}`;
  return where.repository;
}

export function LocationLink({
  where,
  source,
}: {
  where: Pick<FindingLocation, "repository" | "path" | "line" | "url">;
  source?: FindingLocation["source"];
}) {
  return (
    <a href={where.url} target="_blank" rel="noreferrer" className="location-link">
      {placeOf(where, source)}
      <span className="muted">
        {" "}
        {where.path}
        {where.line ? `:${where.line}` : ""}
      </span>
    </a>
  );
}
