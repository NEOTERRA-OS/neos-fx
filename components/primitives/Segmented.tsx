"use client";
import React from "react";

/** NEOS segmented control: track sunken, active segment white + shadow, radius 7px.
 *  No yellow (yellow is reserved for the single CTA). */
export function Segmented<T extends string>({
  options, value, onChange, ariaLabel,
}: {
  options: { value: T; label: string; count?: number; divider?: boolean; tone?: "warning" | "brand" }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-control border border-nx-border p-[3px]"
      style={{ background: "var(--nx-surface-sunken)" }}
    >
      {options.map((o) => {
        const active = o.value === value;
        const toneColor = o.tone === "warning" ? "var(--nx-warning)" : o.tone === "brand" ? "var(--nx-brand-lift)" : null;
        return (
          <React.Fragment key={o.value}>
          {o.divider && <span aria-hidden style={{ width: 1, height: 16, background: "var(--nx-border)", margin: "0 2px" }} />}
          <button
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className="num inline-flex h-[26px] items-center gap-1.5 px-2.5 text-[12px] font-semibold transition-colors"
            style={{
              borderRadius: 7,
              background: active ? "var(--nx-surface)" : "transparent",
              color: toneColor ?? (active ? "var(--nx-green-ink)" : "var(--nx-text-secondary)"),
              boxShadow: active ? "var(--nx-el-segment)" : "none",
            }}
          >
            {o.label}
            {o.count != null && (
              <span className="text-[10px] font-bold" style={{ color: active ? "var(--nx-text-muted)" : "var(--nx-text-muted)", opacity: active ? 0.9 : 0.7 }}>{o.count}</span>
            )}
          </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
