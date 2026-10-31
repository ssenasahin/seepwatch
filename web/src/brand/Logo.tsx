import "./logo.css";

// The Seepwatch mark drawn inline, so it inherits the current text colour and the
// theme's accent. Geometry matches public/brand/*.svg exactly.

interface MarkProps {
  size?: number;
  // Draws the pulse in the text colour too, for one-colour contexts.
  mono?: boolean;
  title?: string;
}

export function LanternMark({ size = 24, mono = false, title }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <g
        transform="translate(0 1.4)"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="16" cy="3.6" r="1.9" />
        <path d="M10.5 9 13 6h6l2.5 3" />
        <rect x="7" y="9" width="18" height="15.5" rx="3.5" />
        <path d="M10 27.5h12" />
        <polyline
          points="9.8,16.75 12.4,16.75 14.3,12.6 17.4,20.9 19.3,16.75 22.2,16.75"
          strokeWidth={2.4}
          style={mono ? undefined : { stroke: "var(--accent)" }}
        />
      </g>
    </svg>
  );
}

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span className="logo" style={{ fontSize: size * 0.72 }}>
      <LanternMark size={size} />
      <span className="logo-word">Seepwatch</span>
    </span>
  );
}
