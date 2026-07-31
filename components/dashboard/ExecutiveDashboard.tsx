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

      {/* ENTFERNT 31.07.2026: P&L-Wasserfall, Covenant-Ampel, Saison-Kurve und Kulturmix.
          Wasserfall und Ampel zeigten nur das jüngste Jahr — die Ergebnistabelle oben zeigt
          alle acht inklusive DSCR und Net Debt/EBITDA mit roter Markierung. Kulturmix und
          Deckungsbeitrag je Kultur stecken jetzt in der Anbaustruktur-Tabelle.
          An ihre Stelle tritt der Liquiditätsverlauf — die Frage, die das Anlaufjahr
          entscheidet, ist nicht „wie sieht die GuV aus", sondern „reicht das Geld". */}
      <Liquiditaetsverlauf monthly={monthly} annual={annual} />

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

/** ANBAUSTRUKTUR, PRODUKTION UND ERGEBNISBEITRAG — je Kultur, für JEDES Planjahr.
 *
 *  Führt zusammen, was vorher auf drei Stellen verteilt war: Flächen und Mengen standen hier
 *  (nur für das letzte Jahr), der Deckungsbeitrag je Kultur im Contribution-Chart, der
 *  Flächenanteil noch einmal im Kulturmix. Wer wissen wollte, was eine Kultur in einem
 *  bestimmten Jahr beiträgt, musste zwischen drei Grafiken springen.
 *
 *  Deckungsbeitrag = Erlös + Förderung − Direktkosten (Agronomie + Maschinen-Betrieb), je ha
 *  aus der Contribution-Rechnung und mit der Fläche des gewählten Jahres skaliert. Preis- und
 *  Kosteninflation der Folgejahre ist darin NICHT enthalten — die Tabelle zeigt die Struktur
 *  zu heutigen Preisen, nicht den inflationierten Jahresabschluss. */
function CropStructureProd({ domain, scenarioId, yearIndex, yearLabel }: { domain: any; scenarioId: string; yearIndex: number; yearLabel: string }) {
  const my = deriveCropAreasMY(domain);
  const [jahr, setJahr] = React.useState<number | null>(null);
  const yi = Math.min(jahr ?? yearIndex, my.years - 1);
  const contrib = React.useMemo(() => deriveContribution(domain, scenarioId), [domain, scenarioId]);
  const perHa = React.useMemo(() => {
    const m: Record<string, { db: number; rev: number; cogs: number }> = {};
    for (const c of contrib.crops) {
      if (c.areaHa <= 0) continue;
      m[c.cropId] = {
        db: c.contribPerHaCent,
        rev: (c.revenueCent + c.subsidyCent) / c.areaHa,
        cogs: c.cogsCent / c.areaHa,
      };
    }
    return m;
  }, [contrib]);

  const rows = Object.entries(my.areas).map(([cropId, curve]) => {
    const ha = (curve as number[])[yi] ?? 0;
    const y = cropYield(domain, cropId, scenarioId), loss = cropLoss(domain, cropId, scenarioId);
    const p = perHa[cropId];
    const dbAbs = (p?.db ?? 0) * ha;
    const revAbs = (p?.rev ?? 0) * ha;
    return { cropId, name: cropName(cropId), color: cropColor(cropId), ha,
      yieldTHa: y, tonnes: ha * y * (1 - loss),
      dbPerHa: p?.db ?? 0, dbAbs, revAbs, dbPct: revAbs > 0 ? dbAbs / revAbs : 0 };
  }).filter((r) => r.ha > 0.5 && VALUE_CROP_IDS.includes(r.cropId)).sort((a, b) => b.dbAbs - a.dbAbs);

  const totHa = rows.reduce((s, r) => s + r.ha, 0) || 1;
  const totT = rows.reduce((s, r) => s + r.tonnes, 0);
  const totDb = rows.reduce((s, r) => s + r.dbAbs, 0);
  const totRev = rows.reduce((s, r) => s + r.revAbs, 0);
  const maxDb = Math.max(1, ...rows.map((r) => Math.abs(r.dbAbs)));
  const f0 = (v: number) => fmtNumber(v, 0);
  const th = "caption text-[9.5px] text-nx-text-muted px-1 py-1";

  return (
    <Tile title={t("Anbaustruktur, Produktion & Ergebnisbeitrag")}
          hint={`${f0(totHa)} ha · ${f0(totT)} t ${t("netto")} · ${t("DB")} ${fmtMoney(totDb)} €`}>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span className="caption mr-1 text-[10px] text-nx-text-muted">{t("Planjahr")}</span>
        {Array.from({ length: my.years }, (_, y) => (
          <button key={y} onClick={() => setJahr(y)} className="rounded-control px-2 text-[11px] font-semibold"
            style={{ height: 24, border: "1px solid var(--nx-border)",
              background: y === yi ? "var(--nx-green)" : "var(--nx-surface)",
              color: y === yi ? "#fff" : "var(--nx-text-secondary)" }}>
            {START_YEAR + y}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead><tr>
            <th className={th + " text-left"}>{t("Kultur")}</th>
            <th className={th + " text-right"}>{t("Fläche")}</th>
            <th className={th + " text-right"}>{t("Anteil")}</th>
            <th className={th + " text-right"}>{t("Ertrag")}</th>
            <th className={th + " text-right"}>{t("Produktion")}</th>
            <th className={th + " text-right"}>{t("Erlös + Förd.")}</th>
            <th className={th + " text-right"}>{t("DB €/ha")}</th>
            <th className={th + " text-right"}>{t("DB absolut")}</th>
            <th className={th + " text-right"}>{t("DB %")}</th>
            <th className={th} style={{ width: 90 }} />
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cropId} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-1 py-1">
                  <span className="inline-flex items-center gap-1.5">
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, display: "inline-block" }} />
                    {r.name}
                  </span>
                </td>
                <td className="num px-1 py-1 text-right">{f0(r.ha)} ha</td>
                <td className="num px-1 py-1 text-right text-nx-text-muted">{fmtNumber(r.ha / totHa * 100, 0)} %</td>
                <td className="num px-1 py-1 text-right text-nx-text-muted">{fmtNumber(r.yieldTHa, 1)} t/ha</td>
                <td className="num px-1 py-1 text-right">{f0(r.tonnes)} t</td>
                <td className="num px-1 py-1 text-right text-nx-text-muted">{fmtMoney(r.revAbs)}</td>
                <td className="num px-1 py-1 text-right">{fmtMoney(r.dbPerHa)}</td>
                <td className="num px-1 py-1 text-right font-semibold"
                    style={{ color: r.dbAbs >= 0 ? "var(--nx-text)" : "var(--nx-error)" }}>{fmtMoney(r.dbAbs)}</td>
                <td className="num px-1 py-1 text-right font-semibold"
                    style={{ color: r.dbPct >= 0.4 ? "var(--nx-success)" : r.dbPct >= 0 ? "var(--nx-warning)" : "var(--nx-error)" }}>
                  {fmtNumber(r.dbPct * 100, 1)} %
                </td>
                <td className="px-1 py-1">
                  <div style={{ height: 7, borderRadius: 3, background: "var(--nx-app-bg)" }}>
                    <div style={{ width: `${Math.max(0, r.dbAbs / maxDb) * 100}%`, height: 7, borderRadius: 3, background: GRAD }} />
                  </div>
                </td>
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
              <td className="num px-1 py-1.5 text-right font-semibold">{fmtMoney(totRev)}</td>
              <td />
              <td className="num px-1 py-1.5 text-right font-semibold">{fmtMoney(totDb)}</td>
              <td className="num px-1 py-1.5 text-right font-semibold">{fmtNumber(totRev > 0 ? totDb / totRev * 100 : 0, 1)} %</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </Tile>
  );
}

/** LIQUIDITÄTSVERLAUF — Kasse und Revolver über den gesamten Horizont, Monat für Monat.
 *
 *  Ersetzt Wasserfall und Covenant-Ampel im Dashboard. Die Frage, an der das Anlaufjahr hängt,
 *  ist nicht „wie sieht die GuV aus", sondern „reicht das Geld" — und die beantwortet nur der
 *  Monatsverlauf: der Jahresabschluss kann komfortabel aussehen, während im August vor der
 *  Ernte die Linie gezogen ist. Markiert sind der tiefste Punkt und die höchste
 *  Revolver-Inanspruchnahme; beides sind Verhandlungsgrößen gegenüber der Bank. */
function Liquiditaetsverlauf({ monthly, annual }: { monthly: ComputedModel; annual: ComputedModel }) {
  const cash: number[] = (monthly.balanceSheet as any).cash?.values ?? [];
  const rev: number[] = (monthly.balanceSheet as any).revolver?.values ?? [];
  const n = cash.length;
  if (!n) return null;
  const netto = cash.map((c, i) => c - (rev[i] ?? 0));      // frei verfügbar nach Revolver
  const minIdx = netto.reduce((m, v, i) => (v < netto[m] ? i : m), 0);
  const peakIdx = rev.reduce((m, v, i) => (v > (rev[m] ?? 0) ? i : m), 0);
  const lo = Math.min(0, ...netto), hi = Math.max(0, ...netto, ...rev);
  const spanne = hi - lo || 1;
  const W = 1000, H = 150;
  const x = (i: number) => (i / Math.max(1, n - 1)) * W;
  const y = (v: number) => H - ((v - lo) / spanne) * H;
  const pfad = (a: number[]) => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const jahre = Math.round(n / 12);
  const M = (c: number) => fmtMoney(c) + " €";

  return (
    <Tile title={t("Liquiditätsverlauf")} hint={t("Freie Mittel nach Revolver (Linie) · Revolver-Inanspruchnahme (Fläche) — Monatsraster über alle Planjahre")}>
      <div className="grid grid-cols-2 gap-px sm:grid-cols-3" style={{ background: "var(--nx-border-divider)", marginBottom: 10 }}>
        {[
          [t("Tiefster Punkt"), M(netto[minIdx]), `${START_YEAR + Math.floor(minIdx / 12)} · ${MONTHS[minIdx % 12]}`, netto[minIdx] < 0 ? "var(--nx-error)" : "var(--nx-text)"],
          [t("Höchste Revolver-Nutzung"), M(rev[peakIdx] ?? 0), `${START_YEAR + Math.floor(peakIdx / 12)} · ${MONTHS[peakIdx % 12]}`, "var(--nx-warning)"],
          [t("Kasse am Ende"), M(cash[n - 1] ?? 0), `${START_YEAR + jahre - 1}`, "var(--nx-brand-lift)"],
        ].map(([l, v, h, c], idx) => (
          <div key={idx} className="px-3 py-2" style={{ background: "var(--nx-surface)" }}>
            <div className="caption text-[10px] text-nx-text-muted">{l as string}</div>
            <div className="num text-[14px] font-semibold" style={{ color: c as string }}>{v as string}</div>
            <div className="text-[10.5px] text-nx-text-muted">{h as string}</div>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} width="100%" height={168} preserveAspectRatio="none" role="img">
        <SeriesDefs />
        {Array.from({ length: jahre + 1 }, (_, j) => (
          <line key={j} x1={x(j * 12)} y1={0} x2={x(j * 12)} y2={H} stroke="var(--nx-border-divider)" strokeWidth={1} />
        ))}
        <line x1={0} y1={y(0)} x2={W} y2={y(0)} stroke="var(--nx-text-muted)" strokeWidth={1} strokeDasharray="3 3" />
        <path d={`${pfad(rev)} L${W},${y(0)} L0,${y(0)} Z`} fill="var(--nx-warn, #C9A227)" opacity={0.22} />
        <path d={pfad(netto)} fill="none" stroke="url(#nxSeriesH)" strokeWidth={2} />
        <circle cx={x(minIdx)} cy={y(netto[minIdx])} r={4} fill={netto[minIdx] < 0 ? "var(--nx-error)" : "var(--nx-success)"} />
        {Array.from({ length: jahre }, (_, j) => (
          <text key={j} x={x(j * 12 + 6)} y={H + 13} textAnchor="middle" fontSize={10} fill="var(--nx-text-muted)">{START_YEAR + j}</text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-[10.5px] text-nx-text-muted">
        <span className="inline-flex items-center gap-1.5"><span style={{ width: 14, height: 3, background: GRAD, display: "inline-block" }} />{t("Freie Mittel nach Revolver")}</span>
        <span className="inline-flex items-center gap-1.5"><span style={{ width: 14, height: 8, background: "var(--nx-warn, #C9A227)", opacity: 0.35, display: "inline-block" }} />{t("Revolver-Inanspruchnahme")}</span>
      </div>
    </Tile>
  );
}
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
