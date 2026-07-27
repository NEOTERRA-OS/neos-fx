import React from "react";
import { Check, X, TriangleAlert, type LucideIcon } from "lucide-react";

type Tone = "success" | "warning" | "error";
const TONE: Record<Tone, { bg: string; fg: string; Icon: LucideIcon }> = {
  success: { bg: "var(--nx-success-bg)", fg: "var(--nx-success)", Icon: Check },
  warning: { bg: "var(--nx-warning-bg)", fg: "var(--nx-warning-text)", Icon: TriangleAlert },
  error: { bg: "var(--nx-error-bg)", fg: "var(--nx-error)", Icon: X },
};

/** NEOS status pill: radius 999px, ALWAYS icon + label (colour never alone).
 *  Icons: Lucide (Check / TriangleAlert / X). Theme-aware backgrounds via tokens (§8). */
export function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  const t = TONE[tone];
  return (
    <span
      className="num inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold"
      style={{ background: t.bg, color: t.fg }}
    >
      <t.Icon size={13} strokeWidth={2.5} aria-hidden />
      {label}
    </span>
  );
}
