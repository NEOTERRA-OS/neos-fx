"use client";
import React from "react";
import type { LineItem, Timeline, Unit } from "../../core/types";
import { fmtMoney, fmtNumber, fmtPct } from "../../design/format";
import { t } from "../../lib/i18n";

export type GridRow = {
  item: LineItem;
  level?: number;      // indentation depth (hierarchy)
  emphasis?: boolean;  // summary/total row → bold
};

function fmtByUnit(v: number, unit: Unit, currency: "EUR" | "RON"): string {
  switch (unit) {
    case "money":
    case "money_per_ha":
    case "money_per_tonne":
      return fmtMoney(v, currency);
    case "rate":
      return fmtPct(v);
    default:
      return fmtNumber(v, unit === "tonne_per_ha" ? 1 : 0);
  }
}

/** Stock-Zeilen (Bilanz, Endkasse): Jahresspalte = Periodenend-Wert, NICHT Summe
 *  (identische Semantik wie core/aggregate.ts). */
function isStock(key: string): boolean {
  return key.startsWith("bs.") || key === "cf.closing";
}

type Col = { kind: "period"; i: number } | { kind: "sum"; year: number; idx: number[] };

/** Periods = columns, positions = rows. Frozen first column + header. Numbers are
 *  typography: mono+tnum, right-aligned, negative in real minus, zero as "–".
 *  Value colour follows finance semantics (negative = critical).
 *  Bei Monats-/Quartalsansicht wird nach jedem Jahresblock eine Σ-Jahresspalte
 *  eingeschoben (Flows = Summe · Stocks = Jahresendwert · Raten = „–"). */
export function PeriodGrid({
  title, timeline, rows, currency,
}: { title: string; timeline: Timeline; rows: GridRow[]; currency: "EUR" | "RON" }) {
  const periods = timeline.periods;
  const g = periods[0]?.granularity;
  const sub = g === "month" || g === "quarter";
  const y0 = parseInt(timeline.startDate.slice(0, 4), 10) || 2027;
  const m0 = parseInt(timeline.startDate.slice(5, 7), 10) || 1;
  const yearOf = (i: number) => y0 + Math.floor((m0 - 1 + i * (g === "quarter" ? 3 : 1)) / 12);
  const cols: Col[] = [];
  periods.forEach((p, i) => {
    cols.push({ kind: "period", i });
    if (sub && (i === periods.length - 1 || yearOf(i + 1) !== yearOf(i))) {
      cols.push({ kind: "sum", year: yearOf(i), idx: periods.map((_, j) => j).filter((j) => yearOf(j) === yearOf(i)) });
    }
  });
  const sumStyle = { background: "var(--nx-surface-sunken)", borderLeft: "1px solid var(--nx-border)" } as const;
  return (
    <section
      className="overflow-hidden rounded-tile border"
      style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <span className="caption text-[10.5px] text-nx-text-muted">
          {t("Werte in")} {currency === "EUR" ? "€" : "RON"} {t("· read-only")}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr style={{ background: "var(--nx-surface)" }}>
              <th
                className="caption sticky left-0 z-10 min-w-[240px] px-4 py-2 text-left text-[10.5px] font-semibold text-nx-text-muted"
                style={{ background: "var(--nx-surface)", borderBottom: "1px solid var(--nx-border)" }}
              >
                {t("Position")}
              </th>
              {cols.map((c, k) =>
                c.kind === "period" ? (
                  <th
                    key={k}
                    className="num px-3 py-2 text-right text-[10.5px] font-semibold text-nx-text-muted"
                    style={{ borderBottom: "1px solid var(--nx-border)", minWidth: 96 }}
                  >
                    {periods[c.i].label}
                  </th>
                ) : (
                  <th
                    key={k}
                    className="num px-3 py-2 text-right text-[10.5px] font-bold"
                    style={{ ...sumStyle, borderBottom: "1px solid var(--nx-border)", minWidth: 104, color: "var(--nx-green-ink)" }}
                  >
                    Σ {c.year}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.item.key} style={{ background: i % 2 ? "var(--nx-surface-alt)" : "var(--nx-surface)" }}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 px-4 py-1.5 text-left font-normal"
                  style={{
                    background: i % 2 ? "var(--nx-surface-alt)" : "var(--nx-surface)",
                    borderBottom: "1px solid var(--nx-border-divider)",
                    paddingLeft: 16 + (r.level ?? 0) * 16,
                    fontWeight: r.emphasis ? 700 : 400,
                    color: "var(--nx-text)",
                  }}
                  title={r.item.formula}
                >
                  {r.item.label}
                </th>
                {cols.map((c, k) => {
                  const isSum = c.kind === "sum";
                  let v: number | null;
                  if (isSum) {
                    // Raten/Quoten haben keine sinnvolle Jahressumme.
                    if (r.item.unit === "rate") v = null;
                    else if (isStock(r.item.key)) v = r.item.values[c.idx[c.idx.length - 1]] ?? 0;
                    else v = c.idx.reduce((s, j) => s + (r.item.values[j] ?? 0), 0);
                  } else {
                    v = r.item.values[c.i] ?? 0;
                  }
                  const neg = (v ?? 0) < 0;
                  return (
                    <td
                      key={k}
                      className="num px-3 py-1.5 text-right"
                      style={{
                        ...(isSum ? sumStyle : null),
                        borderBottom: "1px solid var(--nx-border-divider)",
                        fontWeight: isSum || r.emphasis ? 700 : 400,
                        color: neg ? "var(--nx-error)" : "var(--nx-text)",
                      }}
                    >
                      {v === null ? "–" : neg ? `(${fmtByUnit(-v, r.item.unit, currency)})` : fmtByUnit(v, r.item.unit, currency)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
