import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { ApiError } from "../../api/client";
import { AuthHeader } from "../../auth/AuthLayout";
import { useAuth } from "../../auth/AuthProvider";
import { Alert, TextField } from "../../components";
import { safeNext } from "../../lib/format";

export function SignInPage() {
  const { signIn, completeSignIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = () => navigate(safeNext(params.get("next")), { replace: true });

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach Seepwatch. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const result = await signIn(email, password);
      if (result.done) finish();
      else setChallengeToken(result.challengeToken);
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    if (!challengeToken) return;
    void run(async () => {
      await completeSignIn(challengeToken, useBackup ? { backupCode: code } : { code });
      finish();
    });
  };

  if (challengeToken) {
    return (
      <>
        <AuthHeader title="Two-factor sign-in">
          {useBackup
            ? "Enter one of the backup codes you saved when you set up two-factor."
            : "Enter the 6-digit code from your authenticator app."}
        </AuthHeader>
        <form className="auth-form" onSubmit={submitCode} noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          {useBackup ? (
            <TextField
              label="Backup code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="abcd-efgh"
              autoComplete="off"
              autoFocus
              mono
            />
          ) : (
            <TextField
              label="Code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              mono
              className="code-input"
            />
          )}
          <button className="btn btn-primary btn-block" disabled={busy || code.length < 6}>
            {busy ? "Checking…" : "Sign in"}
          </button>
        </form>
        <div className="auth-links">
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setUseBackup(!useBackup);
              setCode("");
              setError(null);
            }}
          >
            {useBackup ? "Use your authenticator app" : "Use a backup code"}
          </button>
          <button type="button" className="link-button" onClick={() => setChallengeToken(null)}>
            Start over
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthHeader title="Sign in">
        Welcome back. Seepwatch kept watching while you were away.
      </AuthHeader>
      <form className="auth-form" onSubmit={submitPassword} noValidate>
        {notice && !error && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoFocus
          required
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <button className="btn btn-primary btn-block" disabled={busy || !email || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <div className="auth-links">
        <Link to="/forgot-password">Forgot password?</Link>
        <span>
          New here? <Link to="/sign-up">Create an account</Link>
        </span>
      </div>
    </>
  );
}
