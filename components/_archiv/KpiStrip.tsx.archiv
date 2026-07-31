"use client";
import React from "react";
import type { KpiSet } from "../../core/types";
import { fmtMoney, fmtPct, fmtFactor } from "../../design/format";

/** Full-width borderless strip (NOT a rounded card). KPI value = last non-zero period. */
function last(values: number[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== 0) return values[i];
  return values[values.length - 1] ?? 0;
}

export function KpiStrip({ kpis, currency, periodLabel }: { kpis: KpiSet; currency: "EUR" | "RON"; periodLabel?: string }) {
  const tiles = [
    { cap: "EBITDA-Marge", val: fmtPct(last(kpis.ebitdaMargin.values)), unit: "" },
    { cap: "Net Debt / EBITDA", val: fmtFactor(last(kpis.netDebtToEbitda.values)), unit: "x" },
    { cap: "DSCR", val: fmtFactor(last(kpis.dscr.values)), unit: "x" },
    { cap: "ICR", val: fmtFactor(last(kpis.icr.values)), unit: "x" },
    { cap: "ROIC", val: fmtPct(last(kpis.roic.values)), unit: "" },
    { cap: "FCF", val: fmtMoney(last(kpis.fcf.values), currency), unit: currency === "EUR" ? "€" : "RON" },
  ];
  return (
    <div
      className="flex w-full flex-wrap items-stretch gap-x-8 gap-y-3 border-b px-6 py-4"
      style={{ background: "var(--nx-surface)", borderColor: "var(--nx-border)" }}
    >
      <div className="flex flex-col justify-center pr-2">
        <div className="caption text-[9px] font-bold text-nx-text-muted" style={{ letterSpacing: ".08em" }}>KENN-<br />ZAHLEN</div>
        <div className="caption text-[9.5px] text-nx-text-muted">p.a.{periodLabel ? ` · ${periodLabel}` : ""}</div>
      </div>
      {tiles.map((t) => (
        <div key={t.cap} className="min-w-[120px]">
          <div className="caption text-[10.5px] font-bold text-nx-text-muted">{t.cap}</div>
          <div className="num text-[24px] font-bold leading-tight">
            {t.val}
            {t.unit && <span className="ml-1 text-[13px] font-normal text-nx-text-muted">{t.unit}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
