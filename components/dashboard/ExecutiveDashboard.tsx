"use client";
import React from "react";
import { useModelStore, selectComputedAnnual, selectComputedMonthly } from "../../store/modelStore";
import { deriveContribution, effectiveGrowth, deriveCropAreasMY, deriveMassnahmenChecks, START_YEAR } from "../../store/model";
import { useModelStore as useStore, readAssumption } from "../../store/modelStore";
import { cropName, cropColor, cropYield, cropLoss } from "../inputs/cropCalc";
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
      {/* Stufen-Board — der Ramp greifbar: Meilensteine nebeneinander statt nur Zieljahr */}
      <StufenBoard domain={sdomain} annual={annual} scenarioId={scenarioId} />

      {/* Skalierungspfad + Ergebnisband als Tabellen — untereinander (Wunsch 31.07.2026).
          Beides sind die Zahlen, die im Gespräch tatsächlich gebraucht werden. */}
      <SkalierungspfadTabelle domain={domain} />
      <ErgebnisTabelle annual={annual} />

      {/* Financial Evolution — alle Jahre, nicht nur das Zieljahr */}
      <FinancialEvolution annual={annual} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Waterfall annual={annual} idx={i} yearLabel={yearLabel} />
        <Covenants k={k} idx={i} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SeasonCurve monthly={monthly} />
        <CropMix contrib={contrib} />
      </div>

      <CropStructureProd domain={sdomain} scenarioId={scenarioId} yearIndex={i} yearLabel={yearLabel} />

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

/** Financial Evolution — Umsatz/EBITDA/Jahresüberschuss über ALLE Jahre (gruppierte Säulen)
 *  + FCF als Linie. Pixel-Koordinaten (feste Höhe, kein Riesen-Scaling) + Hover-Tooltip je Balken/Punkt. */
function FinancialEvolution({ annual }: { annual: ComputedModel }) {
  const n = annual.timeline.periodCount;
  const years = annual.timeline.periods.map((p) => p.label);
  const v = (li: { values: number[] }, i: number) => li.values[i] ?? 0;
  const rev = (i: number) => v(annual.pnl.revenue, i) + v(annual.pnl.subsidies, i);
  const ebitda = (i: number) => v(annual.pnl.ebitda, i);
  const ni = (i: number) => v(annual.pnl.netIncome, i);
  const fcf = (i: number) => annual.kpis.fcf.values[i] ?? 0;
  // Farblich klar getrennt: Umsatz = Emerald-Verlauf · EBITDA = Blau (Locate) ·
  //  Jahresüberschuss = Brand-Lift. FCF-Linie dadurch NEUTRAL (gestrichelt), damit Blau eindeutig EBITDA ist.
  const series = [
    { key: t("Umsatz"), col: "url(#nxSeriesV)", leg: "var(--nx-series)", get: rev },
    { key: "EBITDA", col: "var(--nx-locate)", leg: "var(--nx-locate)", get: ebitda },
    { key: t("Jahresüberschuss"), col: "var(--nx-brand-lift)", leg: "var(--nx-brand-lift)", get: ni },
  ];
  const FCF_COL = "var(--nx-text-secondary)";
  const [tip, setTip] = React.useState<{ x: number; y: number; text: string } | null>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const M = (c: number) => `${fmtNumber(c / 1e8, 1)} M€`;
  const show = (e: React.MouseEvent, text: string) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text });
  };

  // Pixel-Geometrie: feste Höhe, Breite responsiv via viewBox-Breite 1000.
  const W = 1000, H = 190, padX = 10, padB = 8, padT = 8;
  const maxV = Math.max(1, ...Array.from({ length: n }, (_, i) => rev(i)));
  const minV = Math.min(0, ...Array.from({ length: n }, (_, i) => Math.min(ni(i), fcf(i))));
  const span = maxV - minV || 1;
  const yOf = (val: number) => padT + (1 - (val - minV) / span) * (H - padT - padB);
  const zeroY = yOf(0);
  const groupW = (W - padX * 2) / n;
  const barW = Math.min(26, (groupW - 18) / series.length);
  const fcfPts = Array.from({ length: n }, (_, i) => `${padX + groupW * (i + 0.5)},${yOf(fcf(i))}`).join(" ");

  return (
    <Tile title="Financial Evolution" hint={t("Umsatz · EBITDA · Jahresüberschuss (Säulen) + Free Cash Flow (Linie) — alle Jahre")}>
      <div ref={boxRef} className="relative" onMouseLeave={() => setTip(null)}>
        {/* preserveAspectRatio="none" + feste Höhe: Balken spannen IMMER die volle Breite →
             Jahreslabels (HTML-Flex darunter) bleiben auf jeder Bildschirmbreite bündig. */}
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" height={H + 10} preserveAspectRatio="none" style={{ display: "block" }}>
          <SeriesDefs />
          <line x1={padX} x2={W - padX} y1={zeroY} y2={zeroY} stroke="var(--nx-border)" strokeWidth={1} />
          {Array.from({ length: n }, (_, i) => (
            <g key={i}>
              {series.map((s, si) => {
                const val = s.get(i);
                const y0 = Math.min(yOf(val), zeroY), h = Math.max(2, Math.abs(yOf(val) - zeroY));
                const x = padX + groupW * i + (groupW - series.length * barW) / 2 + si * barW;
                return (
                  <rect key={s.key} x={x} y={y0} width={barW - 3} height={h} rx={3}
                    fill={val < 0 ? "var(--nx-error)" : s.col}
                    style={{ cursor: "pointer" }}
                    onMouseMove={(e) => show(e, `${years[i]} · ${s.key}: ${M(val)}`)}
                    onMouseLeave={() => setTip(null)} />
                );
              })}
            </g>
          ))}
          <polyline points={fcfPts} fill="none" stroke={FCF_COL} strokeWidth={2.5} strokeDasharray="6 4" opacity={0.95} style={{ pointerEvents: "none" }} />
          {Array.from({ length: n }, (_, i) => (
            <circle key={i} cx={padX + groupW * (i + 0.5)} cy={yOf(fcf(i))} r={4.5} fill={FCF_COL}
              style={{ cursor: "pointer" }} opacity={0.9}
              onMouseMove={(e) => show(e, `${years[i]} · FCF: ${M(fcf(i))}`)}
              onMouseLeave={() => setTip(null)} />
          ))}
        </svg>
        {/* Jahreslabels als HTML (feste Schriftgröße — skaliert nicht mit dem SVG) */}
        <div className="flex" style={{ padding: `0 ${padX / W * 100}%` }}>
          {years.map((y) => <span key={y} className="num flex-1 text-center text-[10.5px] text-nx-text-muted">{y}</span>)}
        </div>
        {tip && (
          <div className="pointer-events-none absolute z-10 rounded-md border px-2.5 py-1.5 num text-[11.5px] font-semibold"
            style={{ left: Math.min(tip.x + 12, (boxRef.current?.clientWidth ?? 300) - 150), top: Math.max(0, tip.y - 34),
              background: "var(--nx-elevated)", borderColor: "var(--nx-border)", color: "var(--nx-text)", boxShadow: "var(--nx-el-pop)" }}>
            {tip.text}
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 caption text-[10px] text-nx-text-muted">
        {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1"><span style={{ width: 10, height: 6, background: s.leg, display: "inline-block", borderRadius: 1 }} /> {s.key}</span>)}
        <span className="inline-flex items-center gap-1"><span style={{ width: 12, height: 0, borderTop: `2px dashed ${FCF_COL}`, display: "inline-block" }} /> FCF</span>
      </div>
      <div className="overflow-x-auto mt-2">
        <table className="w-full text-[11px]">
          <thead><tr>
            <th className="caption text-[9px] text-nx-text-muted text-left px-1 py-0.5">€</th>
            {years.map((y) => <th key={y} className="caption text-[9px] text-nx-text-muted text-right px-1 py-0.5">{y}</th>)}
          </tr></thead>
          <tbody>
            {([[t("Umsatz"), rev], ["EBITDA", ebitda], [t("JÜ"), ni], ["FCF", fcf]] as [string, (i: number) => number][]).map(([label, fn]) => (
              <tr key={label} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-1 py-0.5 text-nx-text-secondary">{label}</td>
                {years.map((_, i) => { const val = fn(i); return (
                  <td key={i} className="num px-1 py-0.5 text-right" style={{ color: val < 0 ? "var(--nx-error)" : "var(--nx-text)" }}>{fmtNumber(val / 1e8, 1)} M</td>
                ); })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Tile>
  );
}

/** Meilenstein-Board des Skalierungspfads: Fläche, Kartoffel-/Tomatenmengen, Umsatz,
 *  EBITDA und Jahresüberschuss zu Start, Zielerreichung und letztem Planjahr. */
function StufenBoard({ domain, annual, scenarioId }: { domain: any; annual: ComputedModel; scenarioId: string }) {
  const my = deriveCropAreasMY(domain);
  const gEff = effectiveGrowth(domain.growth);
  // Meilensteine des Skalierungspfads: Start · das Jahr, in dem die Zielfläche erstmals
  //  erreicht ist · das letzte Planjahr. Die früheren Stufen-Zweige (s1/s1a/s2/s3b) sind
  //  entfallen — es gibt nur noch einen Pfad.
  const last = my.years - 1;
  const targetHa = my.irrHa[last] ?? 0;
  const yReach = my.irrHa.findIndex((v) => v >= targetHa - 1);
  const cand: { y: number; label: string }[] = [{ y: 0, label: t("Start") }];
  if (yReach > 0 && yReach < last) cand.push({ y: yReach, label: t("Zielfläche erreicht") });
  cand.push({ y: last, label: t("Letztes Planjahr") });
  const miles = cand.filter((m, i, a) => a.findIndex((x) => x.y === m.y) === i);

  const pv = (li: { values: number[] }, y: number) => li.values[Math.min(y, li.values.length - 1)] ?? 0;
  const yieldOf = (id: string) => readAssumption(domain, `yield.${id}`, scenarioId) ?? 0;
  const kartHa = (y: number) => (my.areas["kartoffel_pommes"]?.[y] ?? 0) + (my.areas["kartoffel_chips"]?.[y] ?? 0);
  const kartT = (y: number) => (my.areas["kartoffel_pommes"]?.[y] ?? 0) * yieldOf("kartoffel_pommes") + (my.areas["kartoffel_chips"]?.[y] ?? 0) * yieldOf("kartoffel_chips");
  const tomT = (y: number) => (my.areas["tomate"]?.[y] ?? 0) * yieldOf("tomate");
  const f0 = (v: number) => fmtNumber(v, 0);

  // Trockenrotation, Gesamtfläche und Beregnungsgrad sind entfallen: im Solo-Modell ist die
  //  gesamte Betriebsfläche beregnet, die drei Zeilen zeigten nur noch 0 ha bzw. konstant 100 %.
  const shownRows: { label: string; val: (y: number) => string | React.ReactNode }[] = [
    { label: t("Betriebsfläche"), val: (y) => `${f0(my.irrHa[y])} ha` },
    { label: t("Kartoffel (PRIO 1)"), val: (y) => `${f0(kartHa(y))} ha · ${f0(kartT(y))} t` },
    { label: t("Industrietomate"), val: (y) => `${f0(my.areas["tomate"]?.[y] ?? 0)} ha · ${f0(tomT(y))} t` },
    { label: t("Umsatz p.a."), val: (y) => fmtMoney(pv(annual.pnl.revenue, y) + pv(annual.pnl.subsidies, y)) + " €" },
    { label: "EBITDA", val: (y) => fmtMoney(pv(annual.pnl.ebitda, y)) + " €" },
    { label: t("Jahresüberschuss"), val: (y) => fmtMoney(pv(annual.pnl.netIncome, y)) + " €" },
  ];

  return (
    <Tile title={t("Meilensteine des Skalierungspfads")} hint={t("Kultur-Politik: expliziter Skalierungspfad je Kultur (Kartoffel 300 → 1.000 ha bis 2031)")}>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead><tr>
            <th className="caption text-[9.5px] text-nx-text-muted text-left px-2 py-1">{t("Kennzahl")}</th>
            {miles.map((m) => (
              <th key={m.y} className="caption text-[9.5px] text-right px-2 py-1" style={{ color: "var(--nx-green-ink)" }}>{m.label} · {START_YEAR + m.y}</th>
            ))}
          </tr></thead>
          <tbody>
            {shownRows.map((r) => (
              <tr key={r.label} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-nx-text-secondary">{r.label}</td>
                {miles.map((m) => <td key={m.y} className="num px-2 py-1.5 text-right font-semibold">{r.val(m.y)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Tile>
  );
}

/** Anbaustruktur & Produktion — Fläche (ha), Anteil, Ertrag (t/ha) und Netto-Produktion (t) je Kultur
 *  für das angezeigte Jahr (beregneter Block + Trockenrotation). */
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
  }).filter((r) => r.ha > 0.5).sort((a, b) => b.ha - a.ha);
  const totHa = rows.reduce((s, r) => s + r.ha, 0) || 1;
  const totT = rows.reduce((s, r) => s + r.tonnes, 0);
  const maxHa = Math.max(1, ...rows.map((r) => r.ha));
  const f0 = (v: number) => fmtNumber(v, 0);
  return (
    <Tile title={t("Anbaustruktur & Produktion")} hint={`${t("Jahr")} ${yearLabel} · ${f0(totHa)} ha · ${f0(totT)} t ${t("netto")}`}>
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


/* --------------------------------------------------------------------------
 * SKALIERUNGSPFAD (ha je Kultur und Planjahr) + ERGEBNISBAND (Mio €).
 *  Zwei schlanke Tabellen untereinander — dieselben Zahlen wie im Skalierungsplan-
 *  Dokument, aber live aus dem Modell statt abgeschrieben.
 * ------------------------------------------------------------------------ */
const TBL_TH = "px-3 py-2 caption text-[10px] text-nx-text-muted";
const TBL_CARD: React.CSSProperties = { borderColor: "var(--nx-border)", background: "var(--nx-surface)", boxShadow: "var(--nx-el-card)" };

function SkalierungspfadTabelle({ domain }: { domain: any }) {
  const my = React.useMemo(() => deriveCropAreasMY(domain), [domain]);
  const years = my.years;
  // Zeilen in Anbauplan-Reihenfolge, Kartoffel-Zwischensumme direkt nach den beiden Sorten.
  const ids = React.useMemo(() => {
    const seen: string[] = [];
    for (const e of domain.anbauplan ?? []) if (!seen.includes(e.cropId)) seen.push(e.cropId);
    return seen.filter((id) => my.areas[id]);
  }, [domain, my]);
  const kart = ids.filter((id) => id.startsWith("kartoffel"));
  const at = (id: string, y: number) => Math.round(my.areas[id]?.[y] ?? 0);
  const sumAt = (list: string[], y: number) => list.reduce((s, id) => s + at(id, y), 0);
  const cell = (v: number) => (v > 0 ? fmtNumber(v, 0) : "–");

  const Row = ({ label, get, strong }: { label: string; get: (y: number) => number; strong?: boolean }) => (
    <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
      <td className={"px-3 py-1.5 " + (strong ? "font-semibold" : "")}
          style={{ color: strong ? "var(--nx-brand-lift)" : "var(--nx-text)" }}>{label}</td>
      {Array.from({ length: years }, (_, y) => (
        <td key={y} className={"num px-3 py-1.5 text-right " + (strong ? "font-semibold" : "")}
            style={{ color: strong ? "var(--nx-brand-lift)" : "var(--nx-text)" }}>{cell(get(y))}</td>
      ))}
    </tr>
  );

  return (
    <section className="rounded-tile border" style={TBL_CARD}>
      <div className="border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
        <h3 className="text-[13px] font-semibold">{t("Skalierungspfad der Kulturen (ha)")}</h3>
        <p className="mt-0.5 text-[11px] text-nx-text-muted">
          {t("Fläche je Kultur und Planjahr aus der Kultur-Skalierungspolitik. Σ Betriebsfläche = bewirtschaftete Fläche des Jahres.")}
        </p>
      </div>
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <th className={TBL_TH + " text-left"}>{t("Kultur")}</th>
              {Array.from({ length: years }, (_, y) => (
                <th key={y} className={TBL_TH + " text-right"}>{START_YEAR + y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => (
              <React.Fragment key={id}>
                <Row label={cropName(id)} get={(y) => at(id, y)} />
                {kart.length > 1 && id === kart[kart.length - 1] && (
                  <Row label={t("Kartoffel gesamt")} get={(y) => sumAt(kart, y)} strong />
                )}
              </React.Fragment>
            ))}
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-3 py-2 font-semibold">{t("Σ Betriebsfläche")}</td>
              {Array.from({ length: years }, (_, y) => (
                <td key={y} className="num px-3 py-2 text-right font-semibold">{fmtNumber(sumAt(ids, y), 0)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

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
