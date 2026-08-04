"use client";
import React from "react";
import { useModelStore, selectComputedMonthly } from "../../store/modelStore";
import { fmtMoney } from "../../design/format";
import { t } from "../../lib/i18n";

/* USt/TVA STAND BIS 04.08.2026 HIER MIT DRIN. Die Liquiditätsansicht ist eine
 * reine Ausgabe — bis auf den eingebetteten USt-Editor ganz unten, der Sätze,
 * Behandlung je Kultur und Erstattungs-Timing ändert. Wer eine Eingabe suchte,
 * fand sie unter einer Überschrift, die „Liquiditätsplanung" hiess; wer die
 * Ausgabe las, scrollte an Eingabefeldern vorbei. Jetzt ist die USt eine eigene
 * Menüzeile („USt / TVA"), und diese Ansicht gibt nur noch aus. */

/** Liquiditätsplanung — monatlich & fortlaufend über den gesamten Planungshorizont.
 *  Rollierende Kassen-/Linienplanung: Anfangskasse → operativer/investiver/USt-/Finanzierungs-
 *  Cashflow → Revolver-Bewegung → Endkasse; plus Revolver-Inanspruchnahme, freie Linie und
 *  verfügbare Gesamt-Liquidität je Monat. Deckt Saison-Swing, CAPEX-/Avans-/USt-Spitzen ab. */
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export function LiquiditaetView() {
  const { domain } = useModelStore();
  const cm = useModelStore(selectComputedMonthly);
  const n = cm.timeline.periodCount;
  const cf = cm.cashFlow, bs = cm.balanceSheet;
  const limit = domain.revolver.limit;
  const startMonth = parseInt(cm.timeline.startDate.slice(5, 7), 10) - 1;
  const startYear = parseInt(cm.timeline.startDate.slice(0, 4), 10);

  const draw = cf.debtDrawdowns.values, repay = cf.debtRepayments.values; // repay already negative
  const finEx = draw.map((d, i) => d + repay[i]); // Draw − Tilgung (ohne Revolver/Zins; Zins steckt im CFO)
  const revMove = cf.revolverMovement.values;
  const closing = cf.closingCash.values;
  const revolver = bs.revolver.values;
  const opening = closing.map((_, i) => (i === 0 ? 0 : closing[i - 1]));
  const preRev = opening.map((o, i) => o + cf.cfo.values[i] + cf.cfi.values[i] + (cf.vatCashFlow?.values[i] ?? 0) + finEx[i]);
  const free = revolver.map((r) => Math.max(0, limit - r));
  const avail = closing.map((c, i) => c + free[i]);
  const minAvail = Math.min(...avail);
  const minAvailIdx = avail.indexOf(minAvail);
  const peakRev = Math.max(...revolver);

  const monLabel = (i: number) => {
    const m = (startMonth + i) % 12;
    const yr = startYear + Math.floor((startMonth + i) / 12);
    return { m: t(MON[m]), yr, isJan: m === 0 };
  };

  // agg: Jahressummen-Semantik — Flüsse summieren, Bestände = Jahresendwert, Anfangskasse = Jahresanfang.
  const rows: { label: string; vals: number[]; emph?: boolean; sub?: boolean; sign?: boolean; agg: "sum" | "end" | "start" }[] = [
    { label: t("Anfangskasse"), vals: opening, sub: true, agg: "start" },
    { label: t("Operativer Cashflow"), vals: cf.cfo.values, sign: true, agg: "sum" },
    { label: t("Investiver Cashflow (CapEx/Verkauf)"), vals: cf.cfi.values, sign: true, agg: "sum" },
    { label: t("USt/TVA-Timing"), vals: cf.vatCashFlow?.values ?? new Array(n).fill(0), sign: true, agg: "sum" },
    { label: t("Finanzierung (Draw − Tilgung)"), vals: finEx, sign: true, agg: "sum" },
    { label: t("Δ vor Revolver"), vals: preRev.map((v, i) => v - opening[i]), emph: true, sign: true, agg: "sum" },
    { label: t("Revolver-Bewegung"), vals: revMove, sign: true, agg: "sum" },
    { label: t("Endkasse"), vals: closing, emph: true, agg: "end" },
    { label: t("Revolver in Anspruch"), vals: revolver, agg: "end" },
    { label: t("Freie Kreditlinie"), vals: free, agg: "end" },
    { label: t("Verfügbare Liquidität"), vals: avail, emph: true, agg: "end" },
  ];

  // Spalten: Monate + Σ-Jahresspalte nach jedem Dezember (bzw. am Horizont-Ende).
  type LCol = { kind: "m"; i: number } | { kind: "sum"; year: number; idx: number[] };
  const lcols: LCol[] = [];
  for (let i = 0; i < n; i++) {
    lcols.push({ kind: "m", i });
    const isYearEnd = i === n - 1 || monLabel(i + 1).isJan;
    if (isYearEnd) {
      const yr = monLabel(i).yr;
      lcols.push({ kind: "sum", year: yr, idx: Array.from({ length: n }, (_, j) => j).filter((j) => monLabel(j).yr === yr) });
    }
  }
  const aggVal = (r: (typeof rows)[number], idx: number[]) =>
    r.agg === "sum" ? idx.reduce((s, j) => s + (r.vals[j] ?? 0), 0)
      : r.agg === "start" ? (r.vals[idx[0]] ?? 0)
      : (r.vals[idx[idx.length - 1]] ?? 0);
  const sumBg = "var(--nx-surface-sunken)";

  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Liquiditätsplanung — monatlich & fortlaufend")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">{n}{t(" Monate · Kreditlinie ")}{fmtMoney(limit)} €</span>
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-3" style={{ background: "var(--nx-border-divider)" }}>
          {[
            [t("Min. verfügbare Liquidität"), fmtMoney(minAvail) + " €", `${monLabel(minAvailIdx).m} ${monLabel(minAvailIdx).yr}`],
            [t("Peak Revolver-Inanspruchnahme"), fmtMoney(peakRev) + " €", `${t("von ")}${fmtMoney(limit)}${t(" € Linie")}`],
            [t("Freie Linie am Tiefpunkt"), fmtMoney(limit - peakRev) + " €", t("Puffer")],
          ].map(([k, v, s], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[13px] font-semibold" style={{ color: (i === 0 && minAvail < 0) ? "var(--nx-error)" : "var(--nx-text)" }}>{v}</div>
              <div className="caption text-[9.5px] text-nx-text-muted">{s}</div>
            </div>
          ))}
        </div>
      </section>

      <LiquidityChart closing={closing} avail={avail} revolver={revolver} limit={limit} monLabel={monLabel} n={n} />

      <section className="rounded-tile border overflow-hidden" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="overflow-x-auto">
          <table className="border-collapse text-[11.5px]" style={{ minWidth: "100%" }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[210px] px-3 py-2 text-left caption text-[10px] text-nx-text-muted"
                  style={{ background: "var(--nx-surface)", borderBottom: "1px solid var(--nx-border)" }}>{t("Position (€)")}</th>
                {lcols.map((c, k) => {
                  if (c.kind === "sum") return (
                    <th key={k} className="num px-2 py-2 text-right caption text-[9.5px] font-bold"
                      style={{ background: sumBg, color: "var(--nx-green-ink)", borderBottom: "1px solid var(--nx-border)", borderLeft: "1px solid var(--nx-border)", minWidth: 86 }}>
                      Σ {c.year}
                    </th>
                  );
                  const l = monLabel(c.i);
                  return (
                    <th key={k} className="num px-2 py-2 text-right caption text-[9.5px] text-nx-text-muted"
                      style={{ borderBottom: "1px solid var(--nx-border)", borderLeft: l.isJan ? "1px solid var(--nx-border)" : "none", minWidth: 70 }}>
                      {l.m}<br /><span className="text-[8.5px]">{l.isJan ? l.yr : ""}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} style={{ background: ri % 2 ? "var(--nx-surface-alt)" : "var(--nx-surface)" }}>
                  <th scope="row" className="sticky left-0 z-10 px-3 py-1.5 text-left font-normal"
                    style={{ background: ri % 2 ? "var(--nx-surface-alt)" : "var(--nx-surface)", borderBottom: "1px solid var(--nx-border-divider)",
                      fontWeight: r.emph ? 700 : 400, color: r.sub ? "var(--nx-text-muted)" : "var(--nx-text)" }}>{r.label}</th>
                  {lcols.map((c, k) => {
                    const isSum = c.kind === "sum";
                    const v = isSum ? aggVal(r, c.idx) : r.vals[c.i];
                    const l = isSum ? null : monLabel(c.i);
                    const neg = v < 0;
                    return (
                      <td key={k} className="num px-2 py-1.5 text-right"
                        style={{ borderBottom: "1px solid var(--nx-border-divider)",
                          borderLeft: isSum || l?.isJan ? "1px solid var(--nx-border)" : "none",
                          background: isSum ? sumBg : undefined,
                          fontWeight: isSum || r.emph ? 700 : 400, color: neg ? "var(--nx-error)" : "var(--nx-text)" }}>
                        {v === 0 ? "–" : neg ? `(${fmtMoney(-v)})` : fmtMoney(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="px-1 text-[11px] text-nx-text-muted">
        {t("Fortlaufend über ")}{n}{t(" Monate: Anfangskasse → operativer + investiver + USt- + Finanzierungs-Cashflow → Revolver gleicht Lücken bis zur Linie aus → Endkasse. „Verfügbare Liquidität\" = Endkasse + freie Kreditlinie; der Tiefpunkt zeigt den maximalen Finanzierungsbedarf (Saison-Swing, CAPEX-/Avans-/USt-Spitzen).")}
      </div>
    </div>
  );
}

/** Liquiditätsverlauf — SVG-Flächen/Linien-Chart: verfügbare Liquidität, Endkasse,
 *  Revolver-Inanspruchnahme, Kreditlinie (Referenz). Jahres-Gitter an Januar-Grenzen. */
function LiquidityChart({ closing, avail, revolver, limit, monLabel, n }: {
  closing: number[]; avail: number[]; revolver: number[]; limit: number; n: number;
  monLabel: (i: number) => { m: string; yr: number; isJan: boolean };
}) {
  // FESTE CSS-Höhe + preserveAspectRatio="none": das SVG streckt sich nur horizontal,
  //  Beschriftungen liegen als HTML darüber (skalieren NIE mit der Containerbreite).
  const W = 1000, H = 240, ml = 0, mr = 0, mt = 10, mb = 22;
  const iw = W - ml - mr, ih = H - mt - mb;
  const CH = 260; // CSS-Pixel-Höhe des Charts
  const yMax = Math.max(limit, ...avail, ...revolver, 1) * 1.06;
  const x = (i: number) => ml + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  const y = (v: number) => mt + ih - Math.max(0, v) / yMax * ih;
  const area = (vals: number[]) => `M${x(0)},${y(0)} ` + vals.map((v, i) => `L${x(i)},${y(v)}`).join(" ") + ` L${x(n - 1)},${y(0)} Z`;
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const grid = Array.from({ length: 4 }, (_, k) => (k + 1) / 4 * yMax);
  const jans = Array.from({ length: n }, (_, i) => i).filter((i) => monLabel(i).isJan);
  const fmtMio = (v: number) => (v / 100 / 1e6).toFixed(0) + " M€";

  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Liquiditätsverlauf")}</h3>
        <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-nx-text-muted">
          <Lg c="var(--nx-success)" t={t("Verfügbare Liquidität")} fill /><Lg c="var(--nx-text)" t={t("Endkasse")} />
          <Lg c="var(--nx-warning)" t={t("Revolver in Anspruch")} fill /><Lg c="var(--nx-error)" t={t("Kreditlinie")} dash />
        </div>
      </div>
      <div className="px-3 py-2">
        <div className="relative" style={{ height: CH }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none" role="img" aria-label={t("Liquiditätsverlauf")} style={{ display: "block" }}>
            {grid.map((g, k) => (
              <line key={k} x1={ml} x2={W - mr} y1={y(g)} y2={y(g)} stroke="var(--nx-border-divider)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {jans.map((i) => (
              <line key={i} x1={x(i)} x2={x(i)} y1={mt} y2={mt + ih} stroke="var(--nx-border-divider)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            ))}
            {/* verfügbare Liquidität (Fläche) */}
            <path d={area(avail)} fill="var(--nx-success)" fillOpacity={0.13} stroke="none" />
            {/* Revolver (Fläche) */}
            <path d={area(revolver)} fill="var(--nx-warning)" fillOpacity={0.16} stroke="none" />
            {/* Kreditlinie */}
            <line x1={ml} x2={W - mr} y1={y(limit)} y2={y(limit)} stroke="var(--nx-error)" strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
            {/* Revolver-Linie */}
            <path d={line(revolver)} fill="none" stroke="var(--nx-warning)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            {/* verfügbare Liquidität Linie */}
            <path d={line(avail)} fill="none" stroke="var(--nx-success)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            {/* Endkasse */}
            <path d={line(closing)} fill="none" stroke="var(--nx-text)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <line x1={ml} x2={W - mr} y1={y(0)} y2={y(0)} stroke="var(--nx-border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </svg>
          {/* Y-Achsen-Labels (HTML — feste Schriftgröße) */}
          {grid.map((g, k) => (
            <span key={k} className="num absolute text-[9.5px] text-nx-text-muted" style={{ left: 4, top: `calc(${(y(g) / H) * 100}% - 15px)` }}>{fmtMio(g)}</span>
          ))}
          {/* Jahres-Labels an Januar-Grenzen (HTML) */}
          {jans.map((i) => (
            <span key={i} className="num absolute text-[9.5px] text-nx-text-muted" style={{ left: `calc(${(x(i) / W) * 100}% + 3px)`, bottom: 0 }}>{monLabel(i).yr}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Lg({ c, t, fill, dash }: { c: string; t: string; fill?: boolean; dash?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span style={{ width: 14, height: fill ? 9 : 0, borderTop: fill ? "none" : (dash ? `2px dashed ${c}` : `2px solid ${c}`), background: fill ? c : "transparent", opacity: fill ? 0.5 : 1, display: "inline-block", borderRadius: fill ? 2 : 0 }} />
      {t}
    </span>
  );
}
