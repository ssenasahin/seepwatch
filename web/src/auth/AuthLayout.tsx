import type { ReactNode } from "react";
import { Link, Outlet } from "react-router";
import { usePageTitle } from "../app/Layout";
import { Logo } from "../brand/Logo";
import "./auth.css";

// A quiet, centred frame for the screens before sign-in.
export function AuthLayout() {
  usePageTitle();
  return (
    <div className="auth-shell">
      <Link to="/sign-in" className="auth-logo" aria-label="Seepwatch">
        <Logo size={28} />
      </Link>
      <main className="auth-card card">
        <Outlet />
      </main>
      <p className="auth-footnote">Find your leaked secrets before someone else does.</p>
    </div>
  );
}

export function AuthHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="auth-header">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}
