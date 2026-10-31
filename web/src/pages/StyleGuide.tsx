import { Plus, Radar } from "lucide-react";
import { EmptyState, SkeletonRows, StatusBadge, type Status } from "../components";
import "./pages.css";

const COLOURS: { group: string; tokens: string[] }[] = [
  { group: "Surfaces", tokens: ["--bg", "--surface", "--raised", "--line", "--line-strong"] },
  { group: "Text", tokens: ["--text", "--muted", "--faint"] },
  { group: "Accent", tokens: ["--accent", "--accent-hover", "--accent-soft"] },
  { group: "Status", tokens: ["--good", "--bad", "--warn", "--info"] },
];

const TYPE: { token: string; sample: string; mono?: boolean }[] = [
  { token: "--text-2xl", sample: "Every leak, at a glance" },
  { token: "--text-xl", sample: "Findings this week" },
  { token: "--text-lg", sample: "Nightly backup missed its window" },
  { token: "--text-base", sample: "The job usually pings within 4 minutes of starting." },
  { token: "--text-sm", sample: "Checked 2 min ago from Frankfurt" },
  { token: "--text-xs", sample: "LAST 24 HOURS" },
  { token: "--font-mono", sample: "GET https://api.example.com/health · 200 · 142 ms", mono: true },
];

const STATUSES: Status[] = ["up", "down", "degraded", "maintenance", "paused", "pending"];

export function StyleGuidePage() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Style guide</h1>
          <p>Every token and component the screens are built from.</p>
        </div>
      </header>

      <div className="stack">
        <section className="card card-body">
          <h2 className="section-title">Colour</h2>
          {COLOURS.map(({ group, tokens }) => (
            <div className="swatch-group" key={group}>
              <h4>{group}</h4>
              <div className="swatches">
                {tokens.map((token) => (
                  <div className="swatch" key={token}>
                    <div className="swatch-chip" style={{ background: `var(${token})` }} />
                    <div className="swatch-name">{token}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="card card-body">
          <h2 className="section-title">Type</h2>
          {TYPE.map(({ token, sample, mono }) => (
            <div className="type-row" key={token}>
              <code className="muted">{token}</code>
              <span
                style={
                  mono
                    ? { fontFamily: `var(${token})`, fontSize: "var(--text-sm)" }
                    : { fontSize: `var(${token})` }
                }
              >
                {sample}
              </span>
            </div>
          ))}
        </section>

        <section className="card card-body">
          <h2 className="section-title">Buttons</h2>
          <div className="row">
            <button className="btn btn-primary">
              <Plus size={16} aria-hidden /> Add watch
            </button>
            <button className="btn">Test now</button>
            <button className="btn btn-ghost">Cancel</button>
            <button className="btn btn-danger">Delete watch</button>
            <button className="btn btn-sm">Small</button>
            <button className="btn btn-primary" disabled>
              Saving…
            </button>
          </div>
        </section>

        <section className="card card-body">
          <h2 className="section-title">Status</h2>
          <div className="row">
            {STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
          <p className="muted" style={{ marginTop: "var(--space-3)", fontSize: "var(--text-sm)" }}>
            Status is never colour alone: every badge carries an icon and a word.
          </p>
        </section>

        <section className="card card-body">
          <h2 className="section-title">Fields</h2>
          <div className="fields-grid">
            <label className="field">
              <span className="field-label">Name</span>
              <input className="input" defaultValue="Billing API" />
            </label>
            <label className="field">
              <span className="field-label">URL</span>
              <input className="input input-mono" defaultValue="https://api.example.com/health" />
              <span className="field-hint">Checked with a GET request.</span>
            </label>
            <label className="field">
              <span className="field-label">Interval</span>
              <input className="input input-mono" defaultValue="10" aria-invalid="true" />
              <span className="field-error">Choose between 30 and 300 seconds.</span>
            </label>
          </div>
        </section>

        <section className="card">
          <div className="card-body" style={{ paddingBottom: 0 }}>
            <h2 className="section-title">Empty state</h2>
          </div>
          <EmptyState
            icon={Radar}
            title="No watches yet"
            action={
              <button className="btn btn-primary">
                <Plus size={16} aria-hidden /> Add watch
              </button>
            }
          >
            Add a website, API or cron job and Seepwatch will start checking it within a minute.
          </EmptyState>
        </section>

        <section className="card card-body">
          <h2 className="section-title">Loading</h2>
          <SkeletonRows rows={3} />
        </section>
      </div>
    </>
  );
}
