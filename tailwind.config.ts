import type { Config } from "tailwindcss";

/** NEOS tokens are CSS variables (see design/tokens.css); Tailwind maps them so
 *  utility classes stay theme-aware (light/dark flip only the variable values). */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "nx-green": "var(--nx-green)",
        "nx-green-map": "var(--nx-green-map)",
        "nx-green-soft": "var(--nx-green-soft)",
        "nx-brand-lift": "var(--nx-brand-lift)",
        "nx-yellow": "var(--nx-yellow)",
        "nx-yellow-split": "var(--nx-yellow-split)",
        "nx-app-bg": "var(--nx-app-bg)",
        "nx-surface": "var(--nx-surface)",
        "nx-surface-alt": "var(--nx-surface-alt)",
        "nx-surface-sunken": "var(--nx-surface-sunken)",
        "nx-elevated": "var(--nx-elevated)",
        "nx-border": "var(--nx-border)",
        "nx-border-btn": "var(--nx-border-btn)",
        "nx-border-divider": "var(--nx-border-divider)",
        "nx-border-card": "var(--nx-border-card)",
        "nx-text": "var(--nx-text)",
        "nx-text-secondary": "var(--nx-text-secondary)",
        "nx-text-muted": "var(--nx-text-muted)",
        "nx-success": "var(--nx-success)",
        "nx-success-strong": "var(--nx-success-strong)",
        "nx-success-bg": "var(--nx-success-bg)",
        "nx-warning": "var(--nx-warning)",
        "nx-warning-amber": "var(--nx-warning-amber)",
        "nx-warning-bg": "var(--nx-warning-bg)",
        "nx-warning-text": "var(--nx-warning-text)",
        "nx-error": "var(--nx-error)",
        "nx-error-strong": "var(--nx-error-strong)",
        "nx-error-bg": "var(--nx-error-bg)",
        "nx-locate": "var(--nx-locate)",
        "nx-sidebar": "var(--nx-sidebar)",
      },
      fontFamily: {
        ui: ["'Google Sans Flex'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      borderRadius: {
        control: "var(--nx-r-control)", segment: "var(--nx-r-segment)",
        tile: "var(--nx-r-tile)", pop: "var(--nx-r-pop)", badge: "var(--nx-r-badge)", pill: "999px",
      },
      boxShadow: {
        "nx-card": "var(--nx-el-card)", "nx-segment": "var(--nx-el-segment)",
        "nx-pop": "var(--nx-el-pop)", "nx-drawer": "var(--nx-el-drawer)", "nx-modal": "var(--nx-el-modal)",
      },
    },
  },
  plugins: [],
};
export default config;
