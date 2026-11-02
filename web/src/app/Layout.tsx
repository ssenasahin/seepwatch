import {
  Activity,
  BellRing,
  Eye,
  Gauge,
  KeyRound,
  ListOrdered,
  LogOut,
  Moon,
  Palette,
  Radar,
  ScrollText,
  Shapes,
  ShieldCheck,
  Siren,
  Sun,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useMatches } from "react-router";
import { useAuth, useUser } from "../auth/AuthProvider";
import { SECURITY_PATH } from "../auth/guards";
import { Logo } from "../brand/Logo";
import { ApiStatus } from "./ApiStatus";
import { applyTheme, readTheme, type Theme } from "./theme";
import "./layout.css";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  // Other paths that belong to this section, so it stays highlighted on them.
  owns?: string[];
}

interface NavSection {
  heading: string;
  items: NavItem[];
  adminOnly?: boolean;
}

const NAV: NavSection[] = [
  {
    heading: "Watch",
    items: [
      { to: "/", label: "Overview", icon: Radar },
      { to: "/incidents", label: "Leaks", icon: Siren },
      { to: "/watches", label: "Watches", icon: Eye },
    ],
  },
  {
    heading: "Alerts",
    items: [
      { to: "/channels", label: "Channels", icon: BellRing },
      { to: "/escalation", label: "Escalation", icon: ListOrdered },
      { to: "/team", label: "Team", icon: Users, owns: ["/invites/"] },
    ],
  },
  {
    heading: "Account",
    items: [
      { to: SECURITY_PATH, label: "Security", icon: ShieldCheck },
      { to: "/settings/api-keys", label: "API keys", icon: KeyRound },
    ],
  },
  {
    heading: "Admin",
    adminOnly: true,
    items: [
      { to: "/admin/users", label: "Users", icon: UserCog },
      { to: "/admin/system", label: "System health", icon: Activity },
      { to: "/admin/audit", label: "Audit log", icon: ScrollText },
      { to: "/admin/plans", label: "Plans", icon: Gauge },
    ],
  },
  {
    heading: "Design",
    items: [
      { to: "/styleguide", label: "Style guide", icon: Palette },
      { to: "/brand", label: "Brand", icon: Shapes },
    ],
  },
];

export interface RouteHandle {
  title: string;
}

export function Layout() {
  const title = usePageTitle();
  const scrolled = useScrolled();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const { pathname } = useLocation();
  const isAdmin = useUser().role === "SUPER_ADMIN";

  useEffect(() => applyTheme(theme), [theme]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="sidebar-logo" aria-label="Seepwatch home">
          <Logo size={24} />
        </NavLink>

        <nav className="nav" aria-label="Main">
          {NAV.filter((s) => isAdmin || !s.adminOnly).map((section) => (
            <div className="nav-section" key={section.heading}>
              <span className="nav-heading">{section.heading}</span>
              {section.items.map(({ to, label, icon: Icon, owns }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  className={({ isActive }) =>
                    isActive || owns?.some((path) => pathname.startsWith(path))
                      ? "nav-link active"
                      : "nav-link"
                  }
                >
                  <Icon size={16} aria-hidden />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <ApiStatus />
          <UserMenu />
        </div>
      </aside>

      <div className="main">
        <header className="topbar" data-scrolled={scrolled}>
          <div className="topbar-inner">
            <span className="topbar-title">{title}</span>
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function usePageTitle(): string {
  const matches = useMatches();
  const handle = matches.at(-1)?.handle as RouteHandle | undefined;
  const title = handle?.title ?? "Seepwatch";

  useEffect(() => {
    document.title = title === "Seepwatch" ? title : `${title} · Seepwatch`;
  }, [title]);

  return title;
}

function UserMenu() {
  const user = useUser();
  const { signOut } = useAuth();
  return (
    <div className="user-menu">
      <span className="user-email" title={user.email}>
        {user.email}
      </span>
      <button
        className="btn btn-ghost btn-icon btn-sm"
        onClick={() => void signOut()}
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut size={15} />
      </button>
    </div>
  );
}

// The top bar turns frosted only once content scrolls underneath it.
function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scrolled;
}
