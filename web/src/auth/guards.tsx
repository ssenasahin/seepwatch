import { Navigate, Outlet, useLocation } from "react-router";
import { LanternMark } from "../brand/Logo";
import { NotFoundPage } from "../pages/NotFound";
import { useAuth } from "./AuthProvider";
import "./auth.css";

export const SECURITY_PATH = "/settings/security";

// Shown for the moment it takes the refresh cookie to restore a session.
function Restoring() {
  return (
    <div className="restoring" role="status" aria-label="Loading">
      <LanternMark size={40} />
    </div>
  );
}

// Wraps every screen that needs a signed-in user.
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === "loading") return <Restoring />;
  if (state.status === "signedOut") {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/sign-in?next=${next}`} replace />;
  }
  // Admins can't use the app until two-factor is on; the security page is the way out.
  if (
    state.user.role === "SUPER_ADMIN" &&
    !state.user.twoFactorEnabled &&
    location.pathname !== SECURITY_PATH
  ) {
    return <Navigate to={SECURITY_PATH} replace />;
  }
  return <Outlet />;
}

// Sign-in and sign-up have nothing to offer someone already signed in.
export function RedirectIfSignedIn() {
  const { state } = useAuth();
  if (state.status === "loading") return <Restoring />;
  if (state.status === "signedIn") return <Navigate to="/" replace />;
  return <Outlet />;
}

// The admin pages, for super admins only. Anyone else sees the same page as for an
// address that doesn't exist, rather than learning the panel is there.
export function RequireAdmin() {
  const { state } = useAuth();
  if (state.status !== "signedIn" || state.user.role !== "SUPER_ADMIN") return <NotFoundPage />;
  return <Outlet />;
}
