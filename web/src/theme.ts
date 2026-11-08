// Light and dark modes. The choice is saved only in this browser; if it cannot be saved, the default is used.
export type Theme = "dark" | "light";
const KEY = "pactum-theme";

export function savedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // If it cannot be saved, the choice is only lost on reload.
  }
}
