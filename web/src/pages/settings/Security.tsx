import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, type SessionBody } from "../../api/client";
import { useAuth, useUser } from "../../auth/AuthProvider";
import { Alert, SkeletonRows, TextField } from "../../components";
import { describeDevice, timeAgo } from "../../lib/format";
import "../pages.css";
import "./settings.css";

export function SecurityPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Security</h1>
          <p>Two-factor sign-in and the devices signed in to your account.</p>
        </div>
      </header>
      <div className="stack">
        <TwoFactorCard />
        <SessionsCard />
      </div>
    </>
  );
}

interface Setup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

function TwoFactorCard() {
  const user = useUser();
  const { updateSession } = useAuth();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const start = useMutation({
    mutationFn: () => api<Setup>("/auth/2fa/setup", { method: "POST" }),
    onSuccess: setSetup,
  });

  const verify = useMutation({
    mutationFn: () =>
      api<SessionBody & { backupCodes: string[] }>("/auth/2fa/verify", {
        method: "POST",
        body: { code, password },
      }),
    onSuccess: (body) => {
      setBackupCodes(body.backupCodes);
      setSetup(null);
      setPassword("");
      updateSession(body);
    },
  });

  // Shown once, right after turning two-factor on, until the user confirms they saved them.
  if (backupCodes) {
    return <BackupCodes codes={backupCodes} onDone={() => setBackupCodes(null)} />;
  }

  if (user.twoFactorEnabled) {
    return (
      <section className="card card-body security-row">
        <span className="security-icon security-icon-on">
          <ShieldCheck size={20} aria-hidden />
        </span>
        <div>
          <h2 className="security-title">Two-factor sign-in is on</h2>
          <p className="muted">
            Every sign-in asks for a code from your authenticator app, or one of your backup codes.
          </p>
        </div>
      </section>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    verify.mutate();
  };

  return (
    <section className="card card-body">
      <div className="security-row">
        <span className="security-icon">
          <Smartphone size={20} aria-hidden />
        </span>
        <div>
          <h2 className="security-title">Two-factor sign-in</h2>
          <p className="muted">
            A password alone can leak. With two-factor on, signing in also needs a code from an app
            on your phone, such as 1Password, Google Authenticator or Authy.
          </p>
        </div>
      </div>

      {user.role === "SUPER_ADMIN" && (
        <div className="security-notice">
          <Alert tone="info">
            Admin accounts must use two-factor sign-in. Set it up to continue to the rest of
            Seepwatch.
          </Alert>
        </div>
      )}

      {!setup ? (
        <div className="security-actions">
          {start.error && <Alert tone="error">{start.error.message}</Alert>}
          <button
            className="btn btn-primary"
            onClick={() => start.mutate()}
            disabled={start.isPending}
          >
            {start.isPending ? "Preparing…" : "Set up two-factor sign-in"}
          </button>
        </div>
      ) : (
        <div className="totp-setup">
          <ol className="totp-steps">
            <li>
              <strong>Scan this code</strong> with your authenticator app.
              <img
                src={setup.qrDataUrl}
                alt="QR code for your authenticator app"
                width={180}
                height={180}
                className="totp-qr"
              />
              <span className="muted">Can't scan it? Enter this key instead:</span>
              <code className="totp-secret">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
            </li>
            <li>
              <strong>Enter the 6-digit code</strong> the app shows for Seepwatch.
              <form className="totp-verify" onSubmit={submit} noValidate>
                <TextField
                  label="Code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  mono
                  className="code-input"
                  error={
                    verify.error instanceof ApiError
                      ? (verify.error.fieldError("code") ??
                        (verify.error.fieldError("password") ? undefined : verify.error.message))
                      : undefined
                  }
                />
                <TextField
                  label="Your password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  error={
                    verify.error instanceof ApiError
                      ? verify.error.fieldError("password")
                      : undefined
                  }
                />
                <button
                  className="btn btn-primary"
                  disabled={code.length < 6 || !password || verify.isPending}
                >
                  {verify.isPending ? "Checking…" : "Turn on two-factor"}
                </button>
              </form>
            </li>
          </ol>
        </div>
      )}
    </section>
  );
}

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  const download = () => {
    const blob = new Blob([`Seepwatch backup codes\n\n${text}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: "seepwatch-backup-codes.txt",
    });
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="card card-body">
      <h2 className="security-title">Save your backup codes</h2>
      <p className="muted">
        If you lose your phone, each of these codes signs you in once. This is the only time they're
        shown; Seepwatch keeps only a fingerprint of each.
      </p>
      <ul className="backup-grid">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <div className="row">
        <button
          className="btn"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => setCopied(true));
          }}
        >
          <Copy size={15} aria-hidden /> {copied ? "Copied" : "Copy"}
        </button>
        <button className="btn" onClick={download}>
          <Download size={15} aria-hidden /> Download
        </button>
      </div>
      <label className="backup-confirm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I've stored these codes somewhere safe
      </label>
      <button className="btn btn-primary" disabled={!saved} onClick={onDone}>
        Done
      </button>
    </section>
  );
}

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const { signOutEverywhere } = useAuth();
  const navigate = useNavigate();

  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<{ sessions: SessionRow[] }>("/auth/sessions").then((r) => r.sessions),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });

  const everywhere = useMutation({
    mutationFn: signOutEverywhere,
    onSuccess: () =>
      navigate("/sign-in", { replace: true, state: { notice: "Signed out on every device." } }),
  });

  return (
    <section className="card">
      <div className="card-body sessions-head">
        <div>
          <h2 className="security-title">Where you're signed in</h2>
          <p className="muted">Sign out any device you don't recognise.</p>
        </div>
        <button
          className="btn btn-danger"
          onClick={() => everywhere.mutate()}
          disabled={everywhere.isPending}
        >
          <LogOut size={15} aria-hidden /> Sign out everywhere
        </button>
      </div>

      {sessions.isPending && (
        <div className="card-body">
          <SkeletonRows rows={2} height={48} />
        </div>
      )}
      {sessions.isError && (
        <div className="card-body">
          <Alert tone="error">
            Couldn't load your sessions.{" "}
            <button className="link-button" onClick={() => void sessions.refetch()}>
              Try again
            </button>
          </Alert>
        </div>
      )}
      {sessions.data && (
        <ul className="session-list">
          {sessions.data.map((s) => (
            <li key={s.id} className="session-row">
              <div>
                <div className="session-device">
                  {describeDevice(s.userAgent)}
                  {s.current && <span className="badge badge-up">This device</span>}
                </div>
                <div className="session-meta">
                  <span className="mono">{s.ip ?? "unknown IP"}</span>
                  <span>·</span>
                  <span>{s.current ? "Active now" : `Last active ${timeAgo(s.lastUsedAt)}`}</span>
                  <span>·</span>
                  <span>Signed in {timeAgo(s.createdAt)}</span>
                </div>
              </div>
              {!s.current && (
                <button
                  className="btn btn-sm"
                  onClick={() => revoke.mutate(s.id)}
                  disabled={revoke.isPending && revoke.variables === s.id}
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
