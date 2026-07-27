"use client";
import React from "react";
import type { ComputedModel } from "../../core/types";
import { fmtMoney, fmtPct, fmtFactor } from "../../design/format";
import { t } from "../../lib/i18n";

/** Einheitliches Kennzahlen-Band (auf ALLEN Screens): Ergebnis-Geldgrößen oben,
 *  Rendite- & Covenant-Ratios unten — EIN Band, headline = jüngstes Jahr. */
export function KpiBand({ annual, currency, periodLabel }: { annual: ComputedModel; currency: "EUR" | "RON"; periodLabel?: string }) {
  const i = annual.timeline.periodCount - 1;
  const p = annual.pnl, k = annual.kpis;
  const V = (li: { values: number[] }) => li.values[i] ?? 0;
  const cur = currency === "EUR" ? "€" : "RON";
  const ERR = "var(--nx-error)";

  const moneyCards = [
    { cap: t("Umsatz p.a."), val: fmtMoney(V(p.revenue) + V(p.subsidies), currency), u: cur, sub: `${t("inkl.")} ${fmtMoney(V(p.subsidies), currency)} ${cur} ${t("Subv.")}` },
    { cap: t("EBITDA"), val: fmtMoney(V(p.ebitda), currency), u: cur, sub: t("operatives Ergebnis") },
    { cap: t("EBIT"), val: fmtMoney(V(p.ebit), currency), u: cur, sub: t("nach Abschreibung") },
    { cap: t("Jahresüberschuss"), val: fmtMoney(V(p.netIncome), currency), u: cur, sub: t("nach Zins & Steuer") },
    { cap: t("Free Cash Flow"), val: fmtMoney(k.fcf.values[i] ?? 0, currency), u: cur, sub: "NI + AfA − CapEx" },
    { cap: t("ROIC"), val: fmtPct(k.roic.values[i] ?? 0), u: "", sub: t("EBIT / eing. Kapital") },
  ];
  const ratioTiles = [
    { cap: t("EBITDA-Marge"), val: fmtPct(k.ebitdaMargin.values[i] ?? 0), u: "" },
    { cap: t("Net Debt / EBITDA"), val: fmtFactor(k.netDebtToEbitda.values[i] ?? 0), u: "x" },
    { cap: t("DSCR"), val: fmtFactor(k.dscr.values[i] ?? 0), u: "x" },
    { cap: t("ICR"), val: fmtFactor(k.icr.values[i] ?? 0), u: "x" },
  ];

  return (
    <div className="rounded-tile border overflow-hidden" style={{ borderColor: "var(--nx-border)" }}>
      <div className="flex items-center justify-between px-4 py-1.5 border-b" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <span className="caption text-[9.5px] font-bold uppercase tracking-wide text-nx-text-muted">{t("Kennzahlen")}</span>
        <span className="caption text-[9.5px] text-nx-text-muted">p.a.{periodLabel ? ` · ${periodLabel}` : ""}</span>
      </div>
      {/* Ergebnis — Geldgrößen */}
      <div className="grid grid-cols-2 gap-px sm:grid-cols-3 xl:grid-cols-6" style={{ background: "var(--nx-border-divider)" }}>
        {moneyCards.map((c) => (
          <div key={c.cap} className="px-4 py-3" style={{ background: "var(--nx-surface)" }}>
            <div className="caption text-[10px] font-bold text-nx-text-muted">{c.cap}</div>
            <div className="num text-[19px] font-bold leading-tight" style={{ color: (c.val.startsWith("(") ? ERR : "var(--nx-text)") }}>
              {c.val}{c.u && <span className="ml-0.5 text-[11px] font-normal text-nx-text-muted">{c.u}</span>}
            </div>
            <div className="caption text-[9.5px] text-nx-text-muted">{c.sub}</div>
          </div>
        ))}
      </div>
      {/* Kennzahlen — Ratios (Rendite & Covenants), dezent abgesetzt */}
      <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)", borderTop: "1px solid var(--nx-border)" }}>
        {ratioTiles.map((t) => (
          <div key={t.cap} className="px-4 py-2" style={{ background: "var(--nx-surface-sunken)" }}>
            <div className="caption text-[10px] font-bold text-nx-text-muted">{t.cap}</div>
            <div className="num text-[16px] font-bold leading-tight" style={{ color: (t.val.startsWith("(") ? ERR : "var(--nx-text)") }}>
              {t.val}{t.u && <span className="ml-0.5 text-[11px] font-normal text-nx-text-muted">{t.u}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
