import { describe, expect, it } from "vitest";
import { renderAlert, type IncidentFacts } from "./notify.js";

const facts = (where: IncidentFacts["where"]): IncidentFacts => ({
  id: "i1",
  status: "OPEN",
  openedAt: new Date("2026-11-01T12:00:00Z"),
  acknowledgedAt: null,
  acknowledgedBy: null,
  closedBy: null,
  closeReason: null,
  finding: { id: "f1", detector: "aws-access-key", label: "AWS access key", masked: "AKIA…MNOP" },
  where,
  places: 1,
  watch: "acme.dev",
});

const render = (where: IncidentFacts["where"]) =>
  renderAlert("new", facts(where), "https://app.seepwatch.dev", null, null);

describe("renderAlert", () => {
  it("names a repository, a gist or a paste", () => {
    const base = { path: "deploy.sh", line: 3, url: "https://example.org/x" };
    expect(render({ ...base, source: "GITHUB_COMMIT", repository: "acme/api" }).mail.subject).toBe(
      "Leaked: AWS access key in acme/api",
    );
    expect(render({ ...base, source: "GIST", repository: "someone/1f2e" }).mail.subject).toBe(
      "Leaked: AWS access key in a gist by someone",
    );
    expect(render({ ...base, source: "GIST", repository: "anonymous/1f2e" }).mail.text).toContain(
      "Where: an anonymous gist: deploy.sh, line 3",
    );
    expect(render({ ...base, source: "PASTEBIN", repository: "Ab12Cd34" }).mail.subject).toBe(
      "Leaked: AWS access key in Pastebin paste Ab12Cd34",
    );
  });

  it("escapes what came from outside in the HTML", () => {
    const { mail } = render({
      source: "PASTEBIN",
      repository: "Ab12Cd34",
      path: "<script>alert(1)</script>",
      line: 1,
      url: "https://pastebin.com/Ab12Cd34",
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});
