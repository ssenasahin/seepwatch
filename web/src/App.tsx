import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout, type RouteHandle } from "./app/Layout";
import { AuthLayout } from "./auth/AuthLayout";
import { RedirectIfSignedIn, RequireAdmin, RequireAuth, SECURITY_PATH } from "./auth/guards";
import { ForgotPasswordPage } from "./pages/auth/ForgotPassword";
import { ResetPasswordPage } from "./pages/auth/ResetPassword";
import { SignInPage } from "./pages/auth/SignIn";
import { SignUpPage } from "./pages/auth/SignUp";
import { NotFoundPage } from "./pages/NotFound";
import { OverviewPage } from "./pages/Overview";
import { SecurityPage } from "./pages/settings/Security";

const title = (t: string): RouteHandle => ({ title: t });

// Pages most visits never open load on demand, keeping the first download small:
// the design pages bring the brand assets.
const styleGuide = async () => ({
  Component: (await import("./pages/StyleGuide")).StyleGuidePage,
});
const brand = async () => ({ Component: (await import("./pages/Brand")).BrandPage });
const channels = async () => ({
  Component: (await import("./pages/alerts/Channels")).ChannelsPage,
});
const escalation = async () => ({
  Component: (await import("./pages/alerts/Escalation")).EscalationPage,
});
const team = async () => ({ Component: (await import("./pages/alerts/Team")).TeamPage });
const invite = async () => ({ Component: (await import("./pages/alerts/Invite")).InvitePage });
const apiKeys = async () => ({
  Component: (await import("./pages/settings/ApiKeys")).ApiKeysPage,
});

const adminUsers = async () => ({
  Component: (await import("./pages/admin/AdminUsers")).AdminUsersPage,
});
const adminUser = async () => ({
  Component: (await import("./pages/admin/AdminUser")).AdminUserPage,
});
const systemHealth = async () => ({
  Component: (await import("./pages/admin/SystemHealth")).SystemHealthPage,
});
const auditLog = async () => ({
  Component: (await import("./pages/admin/AuditLog")).AuditLogPage,
});
const plans = async () => ({ Component: (await import("./pages/admin/Plans")).PlansPage });

const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      {
        element: <RedirectIfSignedIn />,
        children: [
          { path: "/sign-in", element: <SignInPage />, handle: title("Sign in") },
          { path: "/sign-up", element: <SignUpPage />, handle: title("Create account") },
        ],
      },
      {
        path: "/forgot-password",
        element: <ForgotPasswordPage />,
        handle: title("Reset password"),
      },
      { path: "/reset-password", element: <ResetPasswordPage />, handle: title("New password") },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: "/", element: <OverviewPage />, handle: title("Overview") },
          { path: "/channels", lazy: channels, handle: title("Channels") },
          { path: "/escalation", lazy: escalation, handle: title("Escalation") },
          { path: "/team", lazy: team, handle: title("Team") },
          { path: "/invites/:token", lazy: invite, handle: title("Team invite") },
          { path: SECURITY_PATH, element: <SecurityPage />, handle: title("Security") },
          { path: "/settings/api-keys", lazy: apiKeys, handle: title("API keys") },
          { path: "/styleguide", lazy: styleGuide, handle: title("Style guide") },
          { path: "/brand", lazy: brand, handle: title("Brand") },
          {
            element: <RequireAdmin />,
            children: [
              { path: "/admin/users", lazy: adminUsers, handle: title("Users") },
              { path: "/admin/users/:id", lazy: adminUser, handle: title("User") },
              { path: "/admin/system", lazy: systemHealth, handle: title("System health") },
              { path: "/admin/audit", lazy: auditLog, handle: title("Audit log") },
              { path: "/admin/plans", lazy: plans, handle: title("Plans") },
            ],
          },
          { path: "*", element: <NotFoundPage />, handle: title("Not found") },
        ],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
