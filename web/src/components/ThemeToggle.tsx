import { useState } from "react";
import { applyTheme, savedTheme, type Theme } from "../theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
    </button>
  );
}
