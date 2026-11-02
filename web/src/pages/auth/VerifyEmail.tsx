import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, ApiError, type SessionBody } from "../../api/client";
import { AuthHeader } from "../../auth/AuthLayout";
import { useAuth } from "../../auth/AuthProvider";
import { Alert } from "../../components";

// Where the sign-up email's link leads. Opening it changes nothing, since mail
// scanners open every link; the button makes the account and signs it in.
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { updateSession } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <>
        <AuthHeader title="This link is incomplete" />
        <Alert tone="error">
          The link is missing its token. Open it from the email again, or sign up again for a new
          one.
        </Alert>
        <div className="auth-links">
          <Link to="/sign-up">Sign up again</Link>
        </div>
      </>
    );
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      updateSession(
        await api<SessionBody>("/auth/verify-email", {
          method: "POST",
          body: { token },
          auth: false,
        }),
      );
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err : new ApiError(0, "Couldn't reach Seepwatch. Try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AuthHeader title="Finish creating your account">
        Your address is confirmed as soon as you continue.
      </AuthHeader>
      {error && (
        <Alert tone="error">
          {error.message} {error.status === 400 && <Link to="/sign-up">Sign up again</Link>}
          {error.status === 409 && <Link to="/sign-in">Sign in</Link>}
        </Alert>
      )}
      <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void finish()}>
        {busy ? "Creating account…" : "Create my account"}
      </button>
    </>
  );
}
