"use client";
import React from "react";
import { STAGE_SEMANTICS } from "../../store/model";
import { t } from "../../lib/i18n";

/** Stufen-Semantik als Legende/Einstieg: 1 (Ackerbau) · 1a (+Wertkulturen) · 2b (+Beregnung) ·
 *  3c (+Fläche&Beregnung). onlySels grenzt auf einzelne Stufen ein (z. B. ["1","1a"]).
 *  floating: ohne Karte/Hintergrund — Inhalt schwebt direkt auf dem Seitenhintergrund. */
export function StageSemanticsCard({ onlySels, title, floating }: { onlySels?: string[]; title?: string; floating?: boolean }) {
  const items = onlySels ? STAGE_SEMANTICS.filter((s) => onlySels.includes(s.sel)) : STAGE_SEMANTICS;

  if (floating) {
    return (
      <section>
        <div className="pb-2 caption text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--nx-text-muted)" }}>
          {title ?? t("Stufen-Semantik · der Buchstabe kodiert die zusätzliche Stellschraube")}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, minmax(0, 1fr))` }}>
          {items.map((st, idx) => (
            <div key={st.sel} className={idx === 0 ? "pr-4" : "px-4"} style={{ borderLeft: idx === 0 ? "none" : "1px solid var(--nx-border)" }}>
              <div className="flex items-baseline gap-2">
                <span className="num text-[16px] font-bold" style={{ color: st.sel === "1" ? "var(--nx-warning)" : "var(--nx-brand-lift)" }}>{st.sel}</span>
                <span className="text-[11.5px] font-semibold">{t(st.short)}</span>
              </div>
              <div className="caption text-[10px] text-nx-text-muted mt-0.5 leading-snug">{t(st.desc)}</div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="px-4 py-2.5 border-b caption text-[10.5px] font-semibold uppercase tracking-wide" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-muted)" }}>
        {title ?? t("Stufen-Semantik · der Buchstabe kodiert die zusätzliche Stellschraube")}
      </div>
      <div className="grid grid-cols-1 gap-px sm:grid-cols-2" style={{ background: "var(--nx-border-divider)", gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, minmax(0, 1fr))` }}>
        {items.map((st) => (
          <div key={st.sel} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
            <div className="flex items-baseline gap-2">
              <span className="num text-[16px] font-bold" style={{ color: st.sel === "1" ? "var(--nx-warning)" : "var(--nx-brand-lift)" }}>{st.sel}</span>
              <span className="text-[11.5px] font-semibold">{t(st.short)}</span>
            </div>
            <div className="caption text-[10px] text-nx-text-muted mt-0.5 leading-snug">{t(st.desc)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
