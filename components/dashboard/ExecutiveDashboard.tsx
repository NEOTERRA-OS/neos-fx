"use client";
import React from "react";
import { useModelStore, selectComputedAnnual, selectComputedMonthly } from "../../store/modelStore";
import { deriveContribution, effectiveGrowth, deriveCropAreasMY, deriveMassnahmenChecks, setCropPathHa, rampCropPath, VALUE_CROP_IDS, START_YEAR } from "../../store/model";
import { useModelStore as useStore, readAssumption } from "../../store/modelStore";
import { cropName, cropColor, cropYield, cropLoss } from "../inputs/cropCalc";
import { NumberInput } from "../inputs/NumberInput";
import { CheckPanel } from "../statements/CheckPanel";
import { fmtMoney, fmtNumber, fmtPct, fmtFactor } from "../../design/format";
import type { ComputedModel } from "../../core/types";
import { t } from "../../lib/i18n";

/** Executive Dashboard — visuelle Essenz für CFO/Investor: Ergebnis-Band, P&L-Wasserfall,
 *  Saison-Kurve (EBITDA + Liquidität), Umsatz/Deckungsbeitrag nach Kultur, Covenant-Ampel.
 *  Rechnet auf der Jahres-Aggregation (headline) + Monatsraster (Saison), horizont-agnostisch. */

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTHS_LANG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
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
      <LiquiditaetJeJahr monthly={monthly} annual={annual} />

      {/* ENTFERNT 31.07.2026: Ergebnisbeitrag je Kultur. Die Anbaustruktur-Tabelle oben zeigt
          Deckungsbeitrag je Kultur bereits absolut, je Hektar und in Prozent — und das fuer
          jedes Planjahr statt nur fuer eines. Die Vollkosten-Sicht bleibt als eigene Ansicht
          "Contribution" erreichbar. */}

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

/** LIQUIDITÄT JE PLANJAHR — als Tabelle, nicht als Kurve.
 *
 *  Die Kurve über 96 Monate war unbrauchbar: die Skala spannte von −44 Mio bis +44 Mio, in der
 *  die eigentliche Bewegung verschwand. Schlimmer noch, zwei der drei Kennzahlen waren dieselbe
 *  Zahl — „tiefster Punkt" und „höchste Revolver-Nutzung" sind rechnerisch identisch, weil die
 *  freien Mittel nach Revolver genau dann am tiefsten stehen, wenn der Revolver voll gezogen ist.
 *
 *  Was man wirklich braucht, sind je Jahr vier Zahlen: wie viel Geld operativ hereinkommt, was
 *  investiert wird, wie tief der Revolver im Jahr maximal gezogen werden muss (der Betrag, über
 *  den mit der Bank verhandelt wird) und in welchem Monat das passiert. Der Monat ist die
 *  eigentliche Information — der Spitzenbedarf liegt regelmäßig vor der Ernte. */
function LiquiditaetJeJahr({ monthly, annual }: { monthly: ComputedModel; annual: ComputedModel }) {
  const g = (o: any, k: string): number[] => o?.[k]?.values ?? [];
  const cash = g(monthly.balanceSheet, "cash");
  const revol = g(monthly.balanceSheet, "revolver");
  const n = cash.length;
  if (!n) return null;
  const jahre = Math.max(1, Math.round(n / 12));
  const seg = (a: number[], y: number) => a.slice(y * 12, y * 12 + 12);
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

  const zeilen = Array.from({ length: jahre }, (_, y) => {
    const r = seg(revol, y), c = seg(cash, y);
    const peakRev = Math.max(0, ...r);
    const peakMon = r.indexOf(peakRev);
    return {
      jahr: START_YEAR + y,
      cfo: sum(seg(g(monthly.cashFlow, "cfo"), y)),
      capex: sum(seg(g(monthly.cashFlow, "capex"), y)),
      cff: sum(seg(g(monthly.cashFlow, "cff"), y)),
      // Freier Cashflow = operativ − Investitionen. Er erklärt die Revolver-Bewegung; die
      //  "tiefste Kasse" wäre strukturell immer 0, weil der Revolver genau bis dahin auffüllt.
      fcf: sum(seg(g(monthly.cashFlow, "cfo"), y)) + sum(seg(g(monthly.cashFlow, "capex"), y)),
      peakRev, peakMon,
      endCash: c[c.length - 1] ?? 0,
    };
  });
  const maxRev = Math.max(1, ...zeilen.map((z) => z.peakRev));
  const th = "caption text-[9.5px] text-nx-text-muted px-2 py-1.5";

  return (
    <Tile title={t("Liquidität je Planjahr")}
          hint={t("Spitzen-Revolver = der Betrag, über den mit der Bank verhandelt wird — inklusive Monat, in dem er anfällt")}>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead><tr>
            <th className={th + " text-left"}>{t("Jahr")}</th>
            <th className={th + " text-right"}>{t("Operativer CF")}</th>
            <th className={th + " text-right"}>{t("Investitionen")}</th>
            <th className={th + " text-right"}>{t("Finanzierung")}</th>
            <th className={th + " text-right"}>{t("Freier Cashflow")}</th>
            <th className={th + " text-right"}>{t("Spitzen-Revolver")}</th>
            <th className={th + " text-left"}>{t("Spitze im Monat")}</th>
            <th className={th} style={{ width: 120 }} />
            <th className={th + " text-right"}>{t("Kasse Jahresende")}</th>
          </tr></thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={z.jahr} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 font-semibold">{z.jahr}</td>
                <td className="num px-2 py-1.5 text-right" style={{ color: z.cfo < 0 ? "var(--nx-error)" : "var(--nx-text)" }}>{fmtMoney(z.cfo)}</td>
                <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtMoney(z.capex)}</td>
                <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtMoney(z.cff)}</td>
                <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: z.fcf < 0 ? "var(--nx-error)" : "var(--nx-success)" }}>{fmtMoney(z.fcf)}</td>
                <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: z.peakRev > 0 ? "var(--nx-warning)" : "var(--nx-text-muted)" }}>
                  {z.peakRev > 0 ? fmtMoney(z.peakRev) : "–"}
                </td>
                <td className="px-2 py-1.5 text-[11px] text-nx-text-muted">{z.peakRev > 0 ? MONTHS_LANG[z.peakMon] : "–"}</td>
                <td className="px-2 py-1.5">
                  <div style={{ height: 7, borderRadius: 3, background: "var(--nx-app-bg)" }}>
                    <div style={{ width: `${(z.peakRev / maxRev) * 100}%`, height: 7, borderRadius: 3, background: "var(--nx-warn, #C9A227)" }} />
                  </div>
                </td>
                <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{fmtMoney(z.endCash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[11px] text-nx-text-muted">
        {t("Freier Cashflow = operativ − Investitionen; solange er negativ ist, wächst die Revolver-Linie. Der Spitzen-Revolver ist der Betrag, der zur Verfügung stehen muss — und der Monat sagt, wann: in JEDEM Planjahr im August, also vor der Ernte, wenn Betriebsmittel, Pacht und Löhne bezahlt sind, aber noch nichts verkauft wurde. Genau das ist das Argument für eine Saisonlinie statt eines Festkredits.")}
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
  const P1 = (v: number) => fmtNumber(v * 100, 1) + " %";
  const X = (v: number) => fmtNumber(v, 2);
  const V = (li: any, y: number): number => li?.values?.[y] ?? 0;
  const umsatz = (y: number) => V(p.revenue, y) + V(p.subsidies, y);

  /** Zeilentypen: „geld" zeigt Mio € mit Vorjahresvergleich, „quote" eine Kennzahl in %,
   *  „ratio" einen Faktor mit Covenant-Schwelle. Der Vorjahresvergleich steht NUR bei den
   *  Geldgrößen — bei Margen und Covenants ist die absolute Höhe die Aussage, nicht die
   *  Veränderung. */
  type Zeile = {
    label: string; hint?: string; kind: "geld" | "quote" | "ratio" | "trenner";
    val?: (y: number) => number; fmt?: (v: number) => string;
    stark?: boolean; grenze?: (v: number) => boolean;
  };
  const rows: Zeile[] = [
    { label: t("Umsatz inkl. Subventionen"), kind: "geld", val: umsatz, fmt: M, stark: true },
    { label: t("davon Subventionen"), kind: "geld", val: (y) => V(p.subsidies, y), fmt: M },
    { label: "—", kind: "trenner" },
    { label: "EBITDA", kind: "geld", val: (y) => V(p.ebitda, y), fmt: M, stark: true },
    { label: t("EBITDA-Marge"), hint: t("EBITDA / Umsatz"), kind: "quote",
      val: (y) => (umsatz(y) ? V(p.ebitda, y) / umsatz(y) : 0), fmt: P1 },
    { label: "EBIT", kind: "geld", val: (y) => V(p.ebit, y), fmt: M },
    { label: t("Jahresergebnis"), kind: "geld", val: (y) => V(p.netIncome, y), fmt: M, stark: true },
    { label: t("Umsatzrendite"), hint: t("Jahresergebnis / Umsatz"), kind: "quote",
      val: (y) => (umsatz(y) ? V(p.netIncome, y) / umsatz(y) : 0), fmt: P1 },
    { label: "—", kind: "trenner" },
    { label: t("Free Cash Flow"), hint: "NI + AfA − CapEx", kind: "geld", val: (y) => V(k.fcf, y), fmt: M },
    { label: "DSCR", hint: t("Covenant ≥ 1,10"), kind: "ratio", val: (y) => V(k.dscr, y), fmt: X,
      grenze: (v) => v < 1.1 },
    { label: t("Net Debt / EBITDA"), hint: t("Covenant ≤ 3,50"), kind: "ratio",
      val: (y) => V(k.netDebtToEbitda, y), fmt: (v) => fmtNumber(v, 1), grenze: (v) => v > 3.5 },
  ];

  /** Veränderung zum Vorjahr in Prozent. Null im ersten Planjahr (kein Vorjahr) und dort,
   *  wo das Vorjahr 0 oder negativ war — eine Wachstumsrate auf einem Verlust ist keine
   *  Information, sondern eine Zahl, die groß aussieht und nichts bedeutet. */
  const yoy = (r: Zeile, y: number): number | null => {
    if (y === 0 || !r.val) return null;
    const v = r.val(y), pv = r.val(y - 1);
    if (!isFinite(v) || !isFinite(pv) || pv <= 0) return null;
    return (v - pv) / pv;
  };
  const Pfeil = ({ d }: { d: number }) => (
    <span style={{ color: d >= 0 ? "var(--nx-success)" : "var(--nx-error)" }}>
      {d >= 0 ? "▲" : "▼"} {fmtNumber(Math.abs(d) * 100, 0)} %
    </span>
  );
  /** Balkenlänge relativ zum größten Absolutwert der Zeile — macht den Verlauf sichtbar,
   *  ohne ein zweites Diagramm daneben zu stellen. */
  const maxOf = (r: Zeile) => {
    if (!r.val) return 0;
    let m = 0; for (let y = 0; y < years; y++) m = Math.max(m, Math.abs(r.val(y)));
    return m || 1;
  };

  return (
    <section className="rounded-tile border" style={TBL_CARD}>
      <div className="border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
        <h3 className="text-[13px] font-semibold">{t("Ergebnis je Planjahr")}</h3>
        <p className="mt-0.5 text-[11px] text-nx-text-muted">
          {t("Aktives Szenario, Geldgrößen in Mio €. Unter jedem Wert die Veränderung zum Vorjahr; Balken zeigen den Verlauf innerhalb der Zeile. Rot markiert Covenant-Verletzungen: DSCR < 1,10 bzw. Net Debt / EBITDA > 3,50.")}
        </p>
      </div>
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <th className={TBL_TH + " text-left"} style={{ minWidth: 190 }}>{t("Position")}</th>
              {Array.from({ length: years }, (_, y) => (
                <th key={y} className={TBL_TH + " text-right"}>{START_YEAR + y}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              if (r.kind === "trenner") return <tr key={"t" + i}><td colSpan={years + 1} style={{ height: 6 }} /></tr>;
              const mx = maxOf(r);
              return (
                <tr key={r.label} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className={"px-3 py-1.5 " + (r.stark ? "font-semibold" : "")}>
                    {r.label}
                    {r.hint && <div className="text-[9.5px] text-nx-text-muted">{r.hint}</div>}
                  </td>
                  {Array.from({ length: years }, (_, y) => {
                    const v = r.val ? r.val(y) : 0;
                    const d = yoy(r, y);
                    const verletzt = r.grenze?.(v) ?? false;
                    const farbe = verletzt ? "var(--nx-error)"
                      : r.kind === "quote" ? (v < 0 ? "var(--nx-error)" : "var(--nx-brand-lift)")
                      : v < 0 ? "var(--nx-error)" : "var(--nx-text)";
                    return (
                      <td key={y} className="px-3 py-1.5 text-right align-top">
                        <div className={"num " + (r.stark ? "font-semibold text-[13px]" : "")} style={{ color: farbe }}>
                          {r.fmt ? r.fmt(v) : v}
                        </div>
                        {r.kind === "geld" && (
                          <>
                            <div className="num text-[9.5px] leading-tight" style={{ minHeight: 12 }}>
                              {d === null ? <span className="text-nx-text-muted">·</span> : <Pfeil d={d} />}
                            </div>
                            <div className="mt-0.5 ml-auto" style={{ width: 44, height: 3, background: "var(--nx-border-divider)", borderRadius: 2, overflow: "hidden" }}>
                              <div style={{
                                width: `${Math.min(100, (Math.abs(v) / mx) * 100)}%`, height: "100%",
                                background: v < 0 ? "var(--nx-error)" : r.stark ? "var(--nx-brand-lift)" : "var(--nx-text-muted)",
                              }} />
                            </div>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
