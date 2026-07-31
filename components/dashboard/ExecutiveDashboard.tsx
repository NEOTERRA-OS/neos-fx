"use client";
import React from "react";
import { useModelStore, selectComputedAnnual, selectComputedMonthly } from "../../store/modelStore";
import { deriveContribution, effectiveGrowth, deriveCropAreasMY, deriveMassnahmenChecks, setCropPathHa, rampCropPath, VALUE_CROP_IDS, START_YEAR } from "../../store/model";
import { useModelStore as useStore, readAssumption } from "../../store/modelStore";
import { cropName, cropColor, cropYield, cropLoss } from "../inputs/cropCalc";
import { NumberInput } from "../inputs/NumberInput";
import { CheckPanel } from "../statements/CheckPanel";
import { ContributionView } from "../inputs/ContributionView";
import { fmtMoney, fmtNumber, fmtPct, fmtFactor } from "../../design/format";
import type { ComputedModel } from "../../core/types";
import { t } from "../../lib/i18n";

/** Executive Dashboard — visuelle Essenz für CFO/Investor: Ergebnis-Band, P&L-Wasserfall,
 *  Saison-Kurve (EBITDA + Liquidität), Umsatz/Deckungsbeitrag nach Kultur, Covenant-Ampel.
 *  Rechnet auf der Jahres-Aggregation (headline) + Monatsraster (Saison), horizont-agnostisch. */

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const BRAND = "var(--nx-brand-lift)";
const MUTED = "var(--nx-text-muted)";
const ERR = "var(--nx-error)";
// NEOS Design System — Datenserien-Verlauf (Balken/Säulen). Flaschengrün nie flach in Serien.
const GRAD = "var(--nx-series)";                 // linear-gradient(90deg,#026634,#009A17)
const LOCATE = "var(--nx-locate)";               // Sekundär-Linie (Revolver)
const SERIES_A = "#026634", SERIES_B = "#009A17";

/** SVG-Gradient-Defs (horizontal + vertikal) für Chart-Serien nach DS. */
function SeriesDefs() {
  return (
    <defs>
      <linearGradient id="nxSeriesH" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="var(--nx-series-a)" /><stop offset="1" stopColor="var(--nx-series-b)" />
      </linearGradient>
      <linearGradient id="nxSeriesV" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stopColor="var(--nx-series-a)" /><stop offset="1" stopColor="var(--nx-series-b)" />
      </linearGradient>
    </defs>
  );
}

const lastNonZero = (v: number[]) => { for (let i = v.length - 1; i >= 0; i--) if (v[i] !== 0) return v[i]; return v[v.length - 1] ?? 0; };
const sum = (v: number[]) => v.reduce((s, x) => s + x, 0);

export function ExecutiveDashboard() {
  const annual = useModelStore(selectComputedAnnual);
  const monthly = useModelStore(selectComputedMonthly);
  const domain = useModelStore((s) => s.domain);
  const scenarioId = useModelStore((s) => s.view.scenarioId);
  const currency = useModelStore((s) => s.view.currency);
  // Kultur-Karten laufen auf der EFFEKTIVEN Domäne (Stufe 1 = nur Ackerbau, sonst Scope) —
  //  damit Anbaustruktur/Contribution/Stufen-Board konsistent zur GuV sind (Dashboard „bei 1" komplett angepasst).
  const sdomain = domain;   // Solo-Modell: keine Scope-/Entity-Filterung mehr
  const contrib = React.useMemo(() => deriveContribution(sdomain, scenarioId), [sdomain, scenarioId]);

  const p = annual.pnl, k = annual.kpis, b = annual.balanceSheet;
  const i = annual.timeline.periodCount - 1; // jüngstes Jahr
  const V = (li: { values: number[] }) => li.values[i] ?? 0;
  const yearLabel = annual.timeline.periods[i]?.label ?? "";

  return (
    <div className="space-y-4">

      {/* Der Skalierungspfad ist in die ANBAUPLANUNG gewandert und dort mit dem Anbauplan zu
          einer Tabelle verschmolzen — eine Kultur, eine Zeile. Hier bleibt das Ergebnisband. */}
      <ErgebnisTabelle annual={annual} />

      {/* ENTFERNT 31.07.2026: Financial Evolution. Die Tabelle darüber zeigt Umsatz, EBITDA und
          Jahresergebnis bereits Jahr für Jahr — das Diagramm war dieselbe Zahl ein zweites Mal. */}

      {/* Direkt unter den Financials: WORAUS die Zahlen kommen. Die Anbaustruktur stand vorher
          weit unten — man las erst das Ergebnis und fand die Mengen drei Blöcke später. */}
      <CropStructureProd domain={sdomain} scenarioId={scenarioId} yearIndex={i} yearLabel={yearLabel} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Waterfall annual={annual} idx={i} yearLabel={yearLabel} />
        <Covenants k={k} idx={i} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SeasonCurve monthly={monthly} />
        <CropMix contrib={contrib} />
      </div>

      {/* Ergebnisbeitrag je Kultur (DB/Vollkosten-Toggle) — direkt unter der Anbaustruktur */}
      <ContributionView />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        <FundingBox annual={annual} monthly={monthly} idx={i} />
        <CheckPanel checks={[...annual.checks, ...deriveMassnahmenChecks(domain)]} />
      </div>
    </div>
  );
}

function Tile({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)", boxShadow: "var(--nx-el-card)" }}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {hint && <span className="caption text-[10px] text-nx-text-muted">{hint}</span>}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/* FinancialEvolution entfernt 31.07.2026 — doppelt zur Tabelle "Ergebnis je Planjahr". */

function CropStructureProd({ domain, scenarioId, yearIndex, yearLabel }: { domain: any; scenarioId: string; yearIndex: number; yearLabel: string }) {
  const my = deriveCropAreasMY(domain);
  const yi = Math.min(yearIndex, my.years - 1);
  // Pool-basiert & native: Trockenkulturen (pool:"dryland") sind bereits in my.areas — KEIN separater
  //  drylandRotation-Workaround mehr (sonst Doppelzählung: native + Workaround-Zeilen).
  const dryIds = new Set<string>((domain.anbauplan ?? []).filter((a: any) => a.pool === "dryland").map((a: any) => a.cropId));
  const rows = Object.entries(my.areas).map(([cropId, curve]) => {
    const ha = (curve as number[])[yi] ?? 0;
    const y = cropYield(domain, cropId, scenarioId), loss = cropLoss(domain, cropId, scenarioId);
    return { cropId, name: cropName(cropId), color: cropColor(cropId), ha,
      yieldTHa: y, lossPct: loss, tonnes: ha * y * (1 - loss), dry: dryIds.has(cropId) };
  // NUR WERTKULTUREN — gespeicherte Altstände können weiterhin Ackerbau- und Trockenkulturen
  //  im Anbauplan tragen; die gehören nicht in die Anbaustruktur des Wertkultur-Modells.
  }).filter((r) => r.ha > 0.5 && VALUE_CROP_IDS.includes(r.cropId)).sort((a, b) => b.ha - a.ha);
  const totHa = rows.reduce((s, r) => s + r.ha, 0) || 1;
  const totT = rows.reduce((s, r) => s + r.tonnes, 0);
  const maxHa = Math.max(1, ...rows.map((r) => r.ha));
  const f0 = (v: number) => fmtNumber(v, 0);
  return (
    <Tile title={t("Anbaustruktur & Produktion — Wertkulturen")} hint={`${t("Jahr")} ${yearLabel} · ${f0(totHa)} ha · ${f0(totT)} t ${t("netto")}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead><tr>
            <th className="caption text-[9.5px] text-nx-text-muted text-left px-1 py-1">{t("Kultur")}</th>
            <th className="caption text-[9.5px] text-nx-text-muted text-right px-1 py-1">{t("Fläche")}</th>
            <th className="caption text-[9.5px] text-nx-text-muted text-right px-1 py-1">{t("Anteil")}</th>
            <th className="caption text-[9.5px] text-nx-text-muted text-right px-1 py-1">{t("Ertrag")}</th>
            <th className="caption text-[9.5px] text-nx-text-muted text-right px-1 py-1">{t("Produktion")}</th>
          </tr></thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.cropId + idx} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-1 py-1">
                  <span className="inline-flex items-center gap-1.5">
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: r.color, display: "inline-block" }} />
                    {t(r.name)}{r.dry
                      ? <span className="caption text-[9px] text-nx-text-muted">{" · "}{t("trocken")}</span>
                      : <span className="caption text-[9px]" style={{ color: "var(--nx-locate)" }}>{" · "}{t("bewässert")}</span>}
                  </span>
                </td>
                <td className="num px-1 py-1 text-right">{f0(r.ha)} ha</td>
                <td className="num px-1 py-1 text-right">
                  <span className="inline-flex items-center gap-1 justify-end">
                    <span style={{ width: 34, height: 5, borderRadius: 3, background: "var(--nx-surface-sunken)", position: "relative", display: "inline-block" }}>
                      <span style={{ position: "absolute", left: 0, top: 0, height: 5, borderRadius: 3, width: `${r.ha / maxHa * 100}%`, background: r.color }} />
                    </span>
                    {fmtNumber(r.ha / totHa * 100, 0)} %
                  </span>
                </td>
                <td className="num px-1 py-1 text-right text-nx-text-muted">{fmtNumber(r.yieldTHa, 1)} t/ha</td>
                <td className="num px-1 py-1 text-right font-semibold">{f0(r.tonnes)} t</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-1 py-1.5 font-semibold">Σ {t("Gesamt")}</td>
              <td className="num px-1 py-1.5 text-right font-semibold">{f0(totHa)} ha</td>
              <td className="num px-1 py-1.5 text-right">100 %</td>
              <td />
              <td className="num px-1 py-1.5 text-right font-semibold">{f0(totT)} t</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Tile>
  );
}

/** P&L-Wasserfall: Umsatz → −COGS → Rohertrag → −OpEx → EBITDA → −AfA → EBIT → −Zins → −Steuer → JÜ. */
function Waterfall({ annual, idx, yearLabel }: { annual: ComputedModel; idx: number; yearLabel: string }) {
  const p = annual.pnl;
  const v = (li: { values: number[] }) => li.values[idx] ?? 0;
  const rev = v(p.revenue) + v(p.subsidies);
  const steps: { label: string; delta: number; kind: "start" | "up" | "down" | "total" }[] = [
    { label: t("Umsatz"), delta: rev, kind: "start" },
    { label: "− COGS", delta: -v(p.cogs), kind: "down" },
    { label: t("Rohertrag"), delta: 0, kind: "total" },
    { label: "− OpEx/SG&A", delta: -v(p.opex), kind: "down" },
    { label: "EBITDA", delta: 0, kind: "total" },
    { label: t("− Abschreibung"), delta: -v(p.depreciation), kind: "down" },
    { label: "EBIT", delta: 0, kind: "total" },
    { label: t("− Zins"), delta: -v(p.interest), kind: "down" },
    { label: t("− Steuer"), delta: -v(p.tax), kind: "down" },
    { label: t("Jahresüberschuss"), delta: 0, kind: "total" },
  ];
  // laufender Saldo
  let run = 0; const bars = steps.map((s) => {
    if (s.kind === "start") { run = s.delta; return { ...s, from: 0, to: run }; }
    if (s.kind === "total") { return { ...s, from: run, to: run }; }
    const from = run; run += s.delta; return { ...s, from, to: run };
  });
  const maxV = Math.max(1, ...bars.map((b) => Math.max(b.from, b.to)));
  const W = 100; // %
  return (
    <Tile title={t("P&L-Wasserfall")} hint={`${t("Jahr")} ${yearLabel} · € ${t("netto")}`}>
      <div className="space-y-1.5">
        {bars.map((bar, j) => {
          const isTotal = bar.kind === "total" || bar.kind === "start";
          const lo = Math.min(bar.from, bar.to), hi = Math.max(bar.from, bar.to);
          const left = (lo / maxV) * W, width = Math.max(0.6, ((hi - lo) / maxV) * W);
          const col = bar.kind === "down" ? ERR : GRAD;
          return (
            <div key={j} className="flex items-center gap-2">
              <div className="w-[120px] shrink-0 text-[11px]" style={{ fontWeight: isTotal ? 700 : 400, color: "var(--nx-text-secondary)" }}>{bar.label}</div>
              <div className="relative h-[18px] flex-1 rounded-sm" style={{ background: "var(--nx-app-bg)" }}>
                <div className="absolute top-0 h-full rounded-sm" style={{ left: `${left}%`, width: `${width}%`, background: col, opacity: isTotal ? 1 : 0.82 }} />
              </div>
              <div className="num w-[92px] shrink-0 text-right text-[11px]" style={{ fontWeight: isTotal ? 700 : 400, color: bar.to < 0 ? ERR : "var(--nx-text)" }}>
                {fmtMoney(bar.kind === "total" || bar.kind === "start" ? bar.to : bar.delta)}
              </div>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}

/** Covenant-Ampel: DSCR ≥1,25 · Net Debt/EBITDA ≤3,5 · ICR ≥2,0. */
function Covenants({ k, idx }: { k: ComputedModel["kpis"]; idx: number }) {
  const rows = [
    { label: t("DSCR (Kapitaldienstdeckung)"), val: k.dscr.values[idx] ?? 0, thr: 1.25, dir: "min" as const, fmt: fmtFactor, u: "x" },
    { label: "Net Debt / EBITDA", val: k.netDebtToEbitda.values[idx] ?? 0, thr: 3.5, dir: "max" as const, fmt: fmtFactor, u: "x" },
    { label: t("Zinsdeckung (ICR)"), val: k.icr.values[idx] ?? 0, thr: 2.0, dir: "min" as const, fmt: fmtFactor, u: "x" },
  ];
  return (
    <Tile title={t("Covenant-Ampel")} hint={t("Kreditauflagen (jüngstes Jahr)")}>
      <div className="space-y-3">
        {rows.map((r) => {
          const ok = r.dir === "min" ? r.val >= r.thr : r.val <= r.thr;
          const col = ok ? BRAND : ERR;
          const barBg = ok ? GRAD : ERR;
          const ratio = r.dir === "min" ? Math.min(1.5, r.val / r.thr) : Math.min(1.5, r.thr / Math.max(0.01, r.val));
          return (
            <div key={r.label}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11.5px] text-nx-text-secondary">{r.label}</span>
                <span className="num text-[13px] font-bold" style={{ color: col }}>
                  {r.fmt(r.val)}{r.u} <span className="text-[10px] font-normal text-nx-text-muted">{r.dir === "min" ? "≥" : "≤"} {r.fmt(r.thr)}{r.u}</span>
                </span>
              </div>
              <div className="relative h-[8px] w-full rounded-full" style={{ background: "var(--nx-app-bg)" }}>
                <div className="absolute top-0 h-full rounded-full" style={{ width: `${Math.min(100, (ratio / 1.5) * 100)}%`, background: barBg, opacity: 0.9 }} />
                <div className="absolute top-[-2px] h-[12px] w-[2px]" style={{ left: `${(1 / 1.5) * 100}%`, background: "var(--nx-text-muted)" }} title={t("Schwelle")} />
              </div>
            </div>
          );
        })}
        <div className="caption text-[10px] text-nx-text-muted">{t("Balken ggü. Schwelle (Marker). Grün = eingehalten, rot = verletzt.")}</div>
      </div>
    </Tile>
  );
}

/** Saison-Kurve: monatliches EBITDA (Balken) + Revolver-Inanspruchnahme (Linie/Fläche). */
function SeasonCurve({ monthly }: { monthly: ComputedModel }) {
  const eb = monthly.pnl.ebitda.values;
  const rev = monthly.balanceSheet.revolver?.values ?? [];
  const n = eb.length;
  const maxE = Math.max(1, ...eb.map(Math.abs));
  const maxR = Math.max(1, ...rev);
  const W = 560, H = 150, pad = 4, bw = (W - pad * 2) / n;
  const zeroY = H / 2;
  const ebY = (v: number) => zeroY - (v / maxE) * (H / 2 - 8);
  const revPts = rev.map((v, j) => `${pad + bw * (j + 0.5)},${H - (v / maxR) * (H - 16) - 4}`).join(" ");
  return (
    <Tile title={t("Saison-Kurve")} hint={t("EBITDA (Balken) · Revolver (Linie) — Monatsraster")}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <SeriesDefs />
        <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke="var(--nx-border)" strokeWidth={1} />
        {eb.map((v, j) => {
          const y = ebY(v), h = Math.abs(y - zeroY);
          return <rect key={j} x={pad + bw * j + 1.5} y={Math.min(y, zeroY)} width={Math.max(1, bw - 3)} height={Math.max(1, h)} fill={v < 0 ? ERR : "url(#nxSeriesV)"} opacity={0.9} rx={1} />;
        })}
        <polyline points={revPts} fill="none" stroke={LOCATE} strokeWidth={1.6} opacity={0.95} />
        {n <= 12 && MONTHS.slice(0, n).map((m, j) => (
          <text key={j} x={pad + bw * (j + 0.5)} y={H - 1} fontSize={7} textAnchor="middle" fill="var(--nx-text-muted)">{m}</text>
        ))}
      </svg>
      <div className="mt-1 flex gap-4 caption text-[10px] text-nx-text-muted">
        <span className="inline-flex items-center gap-1"><span style={{ width: 10, height: 6, background: GRAD, display: "inline-block", borderRadius: 1 }} /> {t("EBITDA/Monat")}</span>
        <span className="inline-flex items-center gap-1"><span style={{ width: 10, height: 2, background: LOCATE, display: "inline-block" }} /> {t("Revolver-Saldo")}</span>
      </div>
    </Tile>
  );
}

/** Umsatz & Deckungsbeitrag nach Kultur (horizontale Balken, sortiert). */
function CropMix({ contrib }: { contrib: ReturnType<typeof deriveContribution> }) {
  const rows = [...contrib.crops].sort((a, b) => b.revenueCent - a.revenueCent);
  const maxRev = Math.max(1, ...rows.map((r) => r.revenueCent));
  const marginOf = (r: any) => { const rev = r.revenueCent + (r.subsidyCent ?? 0); return rev > 0 ? r.contributionCent / rev : 0; };
  const maxMargin = Math.max(0.01, ...rows.map(marginOf));
  return (
    <Tile title={t("Umsatz & Deckungsbeitrag nach Kultur")} hint={t("Balkenfarbe = DB-Marge · €/Jahr")}>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const w = (r.revenueCent / maxRev) * 100;
          const margin = marginOf(r);
          const dbPos = r.contributionCent >= 0;
          // Farbabstufung nach DB-Marge: kräftiger emerald = höhere Marge; rot = negativ.
          //  Intensität über brightness() (hue-treu, volle Deckkraft) — KEIN Alpha, sonst scheint im
          //  Dark Mode der schwarze Track durch und das Emerald wirkt oliv/matt.
          const shade = Math.min(1, Math.max(0, margin / maxMargin));
          const bg = dbPos ? GRAD : ERR;
          const filt = dbPos ? `brightness(${(0.78 + 0.42 * shade).toFixed(2)})` : undefined;
          return (
            <div key={r.cropId} className="flex items-center gap-2">
              <div className="w-[128px] shrink-0 truncate text-[11px] text-nx-text-secondary" title={t(r.name)}>{t(r.name)}</div>
              <div className="relative h-[16px] flex-1 rounded-sm" style={{ background: "var(--nx-surface-sunken)" }}>
                <div className="absolute top-0 h-full rounded-sm" style={{ width: `${w}%`, background: bg, filter: filt }} />
              </div>
              <div className="num w-[86px] shrink-0 text-right text-[11px]">{fmtMoney(r.revenueCent)}</div>
              <div className="num w-[112px] shrink-0 text-right text-[10.5px]" style={{ color: dbPos ? "var(--nx-text-muted)" : ERR }} title={t("Deckungsbeitrag (€ · % vom Umsatz inkl. Förderung)")}>DB {fmtMoney(r.contributionCent)} · <b style={{ color: dbPos ? "var(--nx-brand-lift)" : ERR }}>{fmtPct(margin)}</b></div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-4 caption text-[10px] text-nx-text-muted">
        <span className="inline-flex items-center gap-1"><span style={{ width: 24, height: 6, background: GRAD, display: "inline-block", borderRadius: 1 }} /> {t("DB-Marge — kräftiger = höher")}</span>
        <span className="inline-flex items-center gap-1"><span style={{ width: 10, height: 6, background: ERR, display: "inline-block", borderRadius: 1 }} /> {t("negativ")}</span>
      </div>
    </Tile>
  );
}

/** Funding-Box: Investitionsvolumen, Peak-Finanzierungsbedarf, Verschuldung. */
function FundingBox({ annual, monthly, idx }: { annual: ComputedModel; monthly: ComputedModel; idx: number }) {
  const capex = Math.abs(sum(monthly.cashFlow.capex.values));
  const peakRevolver = Math.max(0, ...(monthly.balanceSheet.revolver?.values ?? [0]));
  const peakVat = Math.max(0, ...(monthly.balanceSheet.vatReceivable?.values ?? [0]));
  const debtEnd = (annual.balanceSheet.debt.values[idx] ?? 0) + (annual.balanceSheet.revolver.values[idx] ?? 0);
  const equity = annual.balanceSheet.totalEquity.values[idx] ?? 0;
  const gearing = equity + debtEnd > 0 ? debtEnd / (equity + debtEnd) : 0;
  const items = [
    { cap: t("Investitionsvolumen (CapEx)"), val: fmtMoney(capex) + " €" },
    { cap: t("Peak Revolver-Bedarf"), val: fmtMoney(peakRevolver) + " €" },
    { cap: t("Peak USt-Vorfinanzierung"), val: fmtMoney(peakVat) + " €" },
    { cap: t("Finanzverbindlichkeiten (Ende)"), val: fmtMoney(debtEnd) + " €" },
    { cap: t("Gearing (FK / (FK+EK))"), val: fmtPct(gearing) },
  ];
  return (
    <Tile title={t("Finanzierung & Funding")} hint={t("Kapitalbedarf im Jahresverlauf")}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.cap}>
            <div className="caption text-[10px] text-nx-text-muted">{it.cap}</div>
            <div className="num text-[15px] font-semibold">{it.val}</div>
          </div>
        ))}
      </div>
    </Tile>
  );
}


const TBL_TH = "px-3 py-2 caption text-[10px] text-nx-text-muted";
const TBL_CARD: React.CSSProperties = { borderColor: "var(--nx-border)", background: "var(--nx-surface)", boxShadow: "var(--nx-el-card)" };

/* SkalierungspfadTabelle entfernt 31.07.2026 — der Pfad steht jetzt in der Anbauplanung,
   verschmolzen mit dem Anbauplan (components/inputs/AnbauplanView.tsx). */

function ErgebnisTabelle({ annual }: { annual: ComputedModel }) {
  const years = annual.timeline.periodCount;
  const p: any = annual.pnl, k: any = annual.kpis;
  const M = (c: number) => fmtNumber(c / 100000000, 2);          // CENT → Mio €
  const rows: { label: string; vals: number[]; fmt: (v: number) => string; strong?: boolean }[] = [
    { label: t("Umsatz"), vals: p.revenue.values, fmt: M },
    { label: "EBITDA", vals: p.ebitda.values, fmt: M, strong: true },
    { label: t("Jahresergebnis"), vals: p.netIncome.values, fmt: M },
    { label: "DSCR", vals: k.dscr.values, fmt: (v: number) => fmtNumber(v, 2) },
    { label: t("Net Debt / EBITDA"), vals: k.netDebtToEbitda.values, fmt: (v: number) => fmtNumber(v, 1) },
  ];
  const tone = (label: string, v: number) =>
    label === "DSCR" ? (v < 1.1 ? "var(--nx-error)" : "var(--nx-text)")
    : label === t("Net Debt / EBITDA") ? (v > 3.5 ? "var(--nx-error)" : "var(--nx-text)")
    : v < 0 ? "var(--nx-error)" : "var(--nx-text)";

  return (
    <section className="rounded-tile border" style={TBL_CARD}>
      <div className="border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
        <h3 className="text-[13px] font-semibold">{t("Ergebnis je Planjahr (Mio €)")}</h3>
        <p className="mt-0.5 text-[11px] text-nx-text-muted">
          {t("Aktives Szenario. Rot markiert Covenant-Verletzungen: DSCR < 1,10 bzw. Net Debt / EBITDA > 3,5.")}
        </p>
      </div>
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <th className={TBL_TH + " text-left"}>{t("Position")}</th>
              {Array.from({ length: years }, (_, y) => (
                <th key={y} className={TBL_TH + " text-right"}>{START_YEAR + y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className={"px-3 py-1.5 " + (r.strong ? "font-semibold" : "")}>{r.label}</td>
                {Array.from({ length: years }, (_, y) => (
                  <td key={y} className={"num px-3 py-1.5 text-right " + (r.strong ? "font-semibold" : "")}
                      style={{ color: tone(r.label, r.vals[y] ?? 0) }}>
                    {r.fmt(r.vals[y] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
