export type Theme = "dark" | "light";

const KEY = "seepwatch.theme";

// Storage can be unavailable (private windows, blocked site data); dark is the fallback.
export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // The choice still applies for this visit.
  }
}
