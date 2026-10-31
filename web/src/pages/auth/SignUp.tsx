import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError } from "../../api/client";
import { AuthHeader } from "../../auth/AuthLayout";
import { useAuth } from "../../auth/AuthProvider";
import { Alert, TextField } from "../../components";

export function SignUpPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signUp(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "Couldn't reach Seepwatch. Try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  const passwordError = error?.fieldError("password");
  const emailError = error?.fieldError("email");

  return (
    <>
      <AuthHeader title="Create your account">
        Start watching your sites, APIs and cron jobs in a couple of minutes.
      </AuthHeader>
      <form className="auth-form" onSubmit={submit} noValidate>
        {error && !passwordError && !emailError && <Alert tone="error">{error.message}</Alert>}
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoFocus
          error={emailError}
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          hint="At least 12 characters. A few unrelated words make a strong one."
          error={passwordError}
        />
        <button className="btn btn-primary btn-block" disabled={busy || !email || !password}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <div className="auth-links">
        <span>
          Already have an account? <Link to="/sign-in">Sign in</Link>
        </span>
      </div>
    </>
  );
}
