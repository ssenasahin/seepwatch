import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../../api/client";
import { AuthHeader } from "../../auth/AuthLayout";
import { Alert, TextField } from "../../components";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/forgot-password", { method: "POST", body: { email }, auth: false });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach Seepwatch. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <>
        <AuthHeader title="Check your inbox" />
        {/* Deliberately vague: the page never confirms whether the address has an account. */}
        <Alert tone="success">
          If an account exists for <strong>{email}</strong>, a link to reset its password is on its
          way. It works once, for 30 minutes.
        </Alert>
        <div className="auth-links">
          <Link to="/sign-in">Back to sign in</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthHeader title="Reset your password">
        Enter your email and we'll send you a link to choose a new password.
      </AuthHeader>
      <form className="auth-form" onSubmit={submit} noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoFocus
        />
        <button className="btn btn-primary btn-block" disabled={busy || !email}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <div className="auth-links">
        <Link to="/sign-in">Back to sign in</Link>
      </div>
    </>
  );
}
