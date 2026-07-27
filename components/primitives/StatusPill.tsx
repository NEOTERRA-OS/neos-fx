import React from "react";

type Tone = "success" | "warning" | "error";
const TONE: Record<Tone, { bg: string; fg: string; icon: string }> = {
  success: { bg: "var(--nx-success-bg)", fg: "var(--nx-success)", icon: "✓" },
  warning: { bg: "var(--nx-warning-bg)", fg: "var(--nx-warning-text)", icon: "!" },
  error: { bg: "var(--nx-error-bg)", fg: "var(--nx-error)", icon: "✕" },
};

/** NEOS status pill: radius 999px, ALWAYS icon + label (colour never alone).
 *  Theme-aware backgrounds via tokens (§8). */
export function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  const t = TONE[tone];
  return (
    <span
      className="num inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold"
      style={{ background: t.bg, color: t.fg }}
    >
      <span aria-hidden>{t.icon}</span>
      {label}
    </span>
  );
}
