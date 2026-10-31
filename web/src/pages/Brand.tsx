import { Download } from "lucide-react";
import "./pages.css";

const ASSETS = [
  { file: "seepwatch-logo-dark.svg", label: "Logo, dark", bg: "on-dark" },
  { file: "seepwatch-logo-light.svg", label: "Logo, light", bg: "on-light" },
  { file: "seepwatch-mark-dark.svg", label: "Mark, dark", bg: "on-dark" },
  { file: "seepwatch-mark-light.svg", label: "Mark, light", bg: "on-light" },
  { file: "seepwatch-app-icon.svg", label: "App icon", bg: "on-light" },
];

const FAVICONS = [
  { src: "/favicon-16.png", size: 16 },
  { src: "/favicon-32.png", size: 32 },
  { src: "/apple-touch-icon.png", size: 180, shown: 72 },
  { src: "/icon-512.png", size: 512, shown: 96 },
];

const PALETTE = [
  { hex: "#F5A524", name: "Lantern amber", role: "The only accent, on dark" },
  { hex: "#C97A00", name: "Amber, deep", role: "The mark's pulse on light" },
  { hex: "#9E5F00", name: "Amber, ink", role: "Links and buttons on light" },
  { hex: "#0B0D10", name: "Night", role: "Page background" },
  { hex: "#E8EAED", name: "Paper", role: "Text and the mark on dark" },
  { hex: "#3FB950", name: "Operational", role: "Status: up" },
  { hex: "#F25F5C", name: "Down", role: "Status: down" },
  { hex: "#F0803C", name: "Degraded", role: "Status: slow or failing rules" },
  { hex: "#5B9DF5", name: "Maintenance", role: "Status: planned work" },
];

const RULES = [
  ["Accent", "Amber is the only brand colour. Everything else stays neutral."],
  ["Clear space", "Leave at least the height of the lantern's ring around the logo."],
  ["Small sizes", "Below 24 px use the mark alone, never the full logo."],
  ["Status", "Green, red and orange belong to status. Never use them for decoration."],
  ["Voice", "Say what happened, then what to do. No exclamation marks, no emoji."],
];

export function BrandPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Brand</h1>
          <p>The Seepwatch name, mark, colours and type in one place.</p>
        </div>
      </header>

      <div className="stack">
        <section className="card brand-hero">
          <figure className="on-dark">
            <img src="/brand/seepwatch-logo-dark.svg" alt="Seepwatch logo on a dark background" />
          </figure>
          <figure className="on-light">
            <img src="/brand/seepwatch-logo-light.svg" alt="Seepwatch logo on a light background" />
          </figure>
        </section>

        <section className="card card-body">
          <h2 className="section-title">Tagline</h2>
          <p className="tagline">Find your leaked secrets before someone else does.</p>
          <p className="muted" style={{ marginTop: "var(--space-2)" }}>
            A lantern is what you carry when nobody else is watching. Inside ours, a pulse: the
            product keeps checking so your team does not have to.
          </p>
        </section>

        <section className="card card-body">
          <h2 className="section-title">Files</h2>
          <div className="asset-grid">
            {ASSETS.map((a) => (
              <div className="asset" key={a.file}>
                <div className={`asset-preview ${a.bg}`}>
                  <img src={`/brand/${a.file}`} alt="" style={{ maxWidth: "70%", maxHeight: 64 }} />
                </div>
                <div className="asset-meta">
                  <span>{a.label}</span>
                  <a href={`/brand/${a.file}`} download aria-label={`Download ${a.label}`}>
                    <Download size={14} aria-hidden />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card card-body">
          <h2 className="section-title">Favicon and app icons</h2>
          <div className="favicons">
            {FAVICONS.map((f) => (
              <figure key={f.size}>
                <img
                  src={f.src}
                  width={f.shown ?? f.size}
                  height={f.shown ?? f.size}
                  alt={`${f.size} pixel icon`}
                />
                <figcaption className="mono">
                  {f.size}×{f.size}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="card card-body">
          <h2 className="section-title">Colour</h2>
          <div className="palette">
            {PALETTE.map((c) => (
              <div className="palette-item" key={c.hex}>
                <span className="palette-chip" style={{ background: c.hex }} />
                <span>
                  {c.name} <code className="muted">{c.hex}</code>
                  <small>{c.role}</small>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="card card-body">
          <h2 className="section-title">Type</h2>
          <div className="type-row">
            <span className="muted">Inter</span>
            <span style={{ fontSize: "var(--text-xl)", fontWeight: 600 }}>
              Interface text, headings and the logo
            </span>
          </div>
          <div className="type-row">
            <span className="muted">JetBrains Mono</span>
            <code>https://api.example.com · 99.98% · 142 ms · 0 */6 * * *</code>
          </div>
        </section>

        <section className="card card-body">
          <h2 className="section-title">Usage</h2>
          <table className="rules">
            <tbody>
              {RULES.map(([topic, rule]) => (
                <tr key={topic}>
                  <th scope="row">{topic}</th>
                  <td>{rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
