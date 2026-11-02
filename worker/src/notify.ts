import {
  emailLayout,
  escapeHtml,
  type AlertMessage,
  type FindingSource,
  type IncidentStatus,
  type Mail,
  type RoundKind,
} from "@seepwatch/db";

// What an alert says about one incident, whoever it goes to.
export interface IncidentFacts {
  id: string;
  status: IncidentStatus;
  openedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  closedBy: string | null;
  closeReason: string | null;
  finding: {
    id: string;
    detector: string;
    // "AWS access key".
    label: string;
    masked: string;
  };
  // The most recent place it was seen, and how many there are.
  where: {
    source: FindingSource;
    repository: string;
    path: string;
    line: number | null;
    url: string;
  } | null;
  places: number;
  // The domain, address or organization whose scan found it.
  watch: string | null;
}

export const formatUtc = (date: Date) => date.toISOString().replace("T", " ").slice(0, 16) + " UTC";

// Where a secret was found, in words: a repository, a gist, a paste.
function placeOf(where: NonNullable<IncidentFacts["where"]>): string {
  switch (where.source) {
    case "GIST": {
      const owner = where.repository.split("/")[0];
      return owner === "anonymous" ? "an anonymous gist" : `a gist by ${owner}`;
    }
    case "PASTEBIN":
      return `Pastebin paste ${where.repository}`;
    default:
      return where.repository;
  }
}

const ENDINGS: Partial<Record<IncidentStatus, string>> = {
  REVOKED: "Revoked",
  FALSE_POSITIVE: "False positive",
  RISK_ACCEPTED: "Risk accepted",
};

function subject(kind: RoundKind, facts: IncidentFacts): string {
  const what = facts.finding.label + (facts.where ? ` in ${placeOf(facts.where)}` : "");
  switch (kind) {
    case "new":
      return `Leaked: ${what}`;
    case "escalated":
      return `Still open: ${what}`;
    case "unacknowledged":
      return `Nobody is on it: ${what}`;
    case "acknowledged":
      return `Not revoked yet: ${what}`;
    case "closed":
      return `${ENDINGS[facts.status] ?? "Closed"}: ${what}`;
  }
}

function headline(kind: RoundKind, facts: IncidentFacts): string {
  switch (kind) {
    case "new":
      return `A ${facts.finding.label} was published`;
    case "escalated":
      return `Nobody has responded to a leaked ${facts.finding.label}`;
    case "unacknowledged":
      return `A leaked ${facts.finding.label} is still unanswered`;
    case "acknowledged":
      return `A leaked ${facts.finding.label} hasn't been revoked yet`;
    case "closed":
      return `${ENDINGS[facts.status] ?? "Closed"}: the leaked ${facts.finding.label}`;
  }
}

// Where a leak was is named by whoever leaked it: a gist's file name, a paste's
// title. Slack, Telegram and mail apps turn any address in it into a link, which
// would sit in a real Seepwatch alert ("rotate it at https://…"). Broken the way
// security tools break them, it still reads but can't be clicked.
export function defang(text: string): string {
  return text.replace(/\b([a-z][a-z0-9+.-]*):\/\//gi, "$1[:]//").replace(/\bwww\./gi, "www[.]");
}

function fields(kind: RoundKind, facts: IncidentFacts): [string, string][] {
  const rows: [string, string][] = [["Secret", facts.finding.masked]];
  if (facts.where) {
    const line = facts.where.line ? `, line ${facts.where.line}` : "";
    rows.push(["Where", defang(`${placeOf(facts.where)}: ${facts.where.path}${line}`)]);
  }
  if (facts.places > 1) rows.push(["Places", `${facts.places} in all`]);
  if (facts.watch) rows.push(["Watch", facts.watch]);
  rows.push(["Found", formatUtc(facts.openedAt)]);
  if (facts.acknowledgedBy && facts.acknowledgedAt) {
    rows.push(["On it", `${facts.acknowledgedBy}, since ${formatUtc(facts.acknowledgedAt)}`]);
  }
  if (kind === "closed") {
    if (facts.closedBy) rows.push(["Closed by", facts.closedBy]);
    if (facts.closeReason) rows.push(["Reason", facts.closeReason]);
  }
  return rows;
}

export interface Rendered {
  mail: Omit<Mail, "to">;
  message: AlertMessage;
}

// One alert, as an email and as a message for Slack, Telegram and webhooks.
// `respondLink` is signed for the one recipient; `note` says what happens next.
export function renderAlert(
  kind: RoundKind,
  facts: IncidentFacts,
  webOrigin: string,
  respondLink: string | null,
  note: string | null,
): Rendered {
  const link = `${webOrigin}/incidents/${facts.id}`;
  const title = subject(kind, facts);
  const rows = fields(kind, facts);
  const color = kind === "closed" ? "#12b76a" : kind === "acknowledged" ? "#f5a524" : "#f04438";

  const text = [
    `${headline(kind, facts)}.`,
    ``,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(facts.where ? [``, `See it: ${facts.where.url}`] : []),
    ...(note ? [``, note] : []),
    ``,
    ...(respondLink ? [`I'm on it, or it's revoked: ${respondLink}`] : []),
    `Open in Seepwatch: ${link}`,
  ].join("\n");

  const html = emailLayout(
    `<span style="color:${color}">●</span> ${escapeHtml(headline(kind, facts))}`,
    `<table style="border-collapse:collapse;font-size:14px">` +
      rows.map(([label, value]) => row(escapeHtml(label), escapeHtml(value))).join("") +
      `</table>` +
      (facts.where
        ? `<p style="margin:16px 0 0;font-size:14px"><a href="${escapeHtml(facts.where.url)}" style="color:#f5a524">See where it was found</a></p>`
        : "") +
      (note
        ? `<p style="margin:20px 0 0;color:#8b939d;font-size:14px">${escapeHtml(note)}</p>`
        : "") +
      (respondLink ? button(respondLink, "I'm on it / Revoked") : "") +
      button(link, "Open in Seepwatch", true),
  );

  return {
    mail: { subject: title, text, html },
    message: {
      kind,
      title,
      finding: {
        id: facts.finding.id,
        detector: facts.finding.detector,
        label: facts.finding.label,
        masked: facts.finding.masked,
      },
      fields: rows,
      note,
      link,
      respondLink,
      incidentId: facts.id,
      at: new Date(),
    },
  };
}

const row = (label: string, value: string) =>
  `<tr><td style="padding:6px 16px 6px 0;color:#8b939d;white-space:nowrap">${label}</td>` +
  `<td style="padding:6px 0;font-family:'JetBrains Mono',Consolas,monospace;word-break:break-all">${value}</td></tr>`;

const button = (href: string, label: string, quiet = false) =>
  `<p style="margin:${quiet ? 12 : 28}px 0 0"><a href="${escapeHtml(href)}" style="display:inline-block;` +
  (quiet
    ? `color:#e8eaed;border:1px solid #2a2f36;`
    : `background:#f5a524;color:#0b0d10;font-weight:600;`) +
  `text-decoration:none;padding:10px 18px;border-radius:8px">${label}</a></p>`;
