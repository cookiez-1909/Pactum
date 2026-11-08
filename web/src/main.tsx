import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { applyTheme, savedTheme } from "./theme";

// Sets the theme before rendering, so the page does not flash on load.
applyTheme(savedTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
