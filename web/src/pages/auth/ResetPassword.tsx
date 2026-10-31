import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, ApiError } from "../../api/client";
import { AuthHeader } from "../../auth/AuthLayout";
import { Alert, TextField } from "../../components";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <>
        <AuthHeader title="This link is incomplete" />
        <Alert tone="error">
          The reset link is missing its token. Open the link from the email again, or request a new
          one.
        </Alert>
        <div className="auth-links">
          <Link to="/forgot-password">Request a new link</Link>
        </div>
      </>
    );
  }

  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await api("/auth/reset-password", {
        method: "POST",
        body: { token, password },
        auth: false,
      });
      navigate("/sign-in", {
        replace: true,
        state: { notice: "Password changed. Every device was signed out; sign in again." },
      });
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "Couldn't reach Seepwatch. Try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  const passwordError = error?.fieldError("password");

  return (
    <>
      <AuthHeader title="Choose a new password">
        Changing it signs you out on every device.
      </AuthHeader>
      <form className="auth-form" onSubmit={submit} noValidate>
        {error && !passwordError && (
          <Alert tone="error">
            {error.message}{" "}
            {error.status === 400 && <Link to="/forgot-password">Get a new link</Link>}
          </Alert>
        )}
        <TextField
          label="New password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus
          hint="At least 12 characters."
          error={passwordError}
        />
        <TextField
          label="Repeat it"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          error={mismatch ? "The passwords don't match yet." : undefined}
        />
        <button
          className="btn btn-primary btn-block"
          disabled={busy || !password || confirm !== password}
        >
          {busy ? "Saving…" : "Save new password"}
        </button>
      </form>
    </>
  );
}
