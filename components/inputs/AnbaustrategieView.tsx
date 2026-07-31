"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { deriveContribution, deriveCapex, buildModelState, CROP_COLOR, VALUE_CROP_IDS } from "../../store/model";
import { deriveOptimalRotation } from "../../store/anbauAdvisor";
import { computeModel } from "../../core/engine";
import { NumberInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import { Circle, Minus, Sparkles, ArrowRight, Check, TriangleAlert, Sun } from "lucide-react";

const LABEL: Record<string, string> = {
  weizen: "Winterweizen", gerste_zw: "Wintergerste", winterraps: "Winterraps", soja_luzerne: "Soja / Luzerne",
  mais: "Körnermais", tomate: "Industrietomate", kartoffel_pommes: "Kartoffel Pommes", kartoffel_chips: "Kartoffel Chips", zwiebel_moehre: "Zwiebel / Möhre",
  suesskartoffel: "Süßkartoffel", knoblauch: "Knoblauch", knollensellerie: "Knollensellerie",
};
// Nutzungsklassen: Wertkulturen & Mais/Soja NUR beregnet; Cash Crops beregnet oder trocken.
const IRRIGATED_ONLY = new Set([...VALUE_CROP_IDS, "mais", "soja_luzerne"]);
// Optimale Fruchtfolgen (Anteil der Fläche = Slot in der Rotation).
const ROT_VOLL = [ // beregnete Vollrotation (6-Feld): Wert + Arable + Getreide-Break
  { crop: "weizen", s: 1 / 6 }, { crop: "tomate", s: 1 / 6 }, { crop: "mais", s: 1 / 6 },
  { crop: "kartoffel_pommes", s: 1 / 6 }, { crop: "soja_luzerne", s: 1 / 6 }, { crop: "zwiebel_moehre", s: 1 / 6 },
];
const ROT_VALUE = [ // nur Wertkulturen (idealisiert, Break-Bedarf s. Hinweis)
  { crop: "tomate", s: 0.25 }, { crop: "kartoffel_pommes", s: 0.25 }, { crop: "kartoffel_chips", s: 0.25 }, { crop: "zwiebel_moehre", s: 0.25 },
];
const ROT_CASH = [ // Cash-Crop-Rotation (trocken tauglich)
  { crop: "weizen", s: 1 / 3 }, { crop: "winterraps", s: 1 / 3 }, { crop: "gerste_zw", s: 1 / 3 },
];
// Maschinen-Kategorie → bediente Kulturen (für CAPEX-/Kosten-Zuordnung je Szenario).
const MACHINE_CROPS: { cat: string; crops: string[] }[] = [
  { cat: "Zugmaschinen", crops: ["alle"] },
  { cat: "Bodenbearbeitung", crops: ["alle"] },
  { cat: "Aussaat & Pflanzung", crops: ["Getreide/Ölsaat", "Mais", "Kartoffel", "Tomate"] },
  { cat: "Düngung", crops: ["alle"] },
  { cat: "Pflanzenschutz", crops: ["alle + Kartoffel-Sikkation"] },
  { cat: "Ernte — Mähdrescher", crops: ["Getreide/Ölsaat/Soja/Mais"] },
  { cat: "Ernte — Tomaten-Vollernter", crops: ["Tomate"] },
  { cat: "Ernte — ROPA Wurzelernter", crops: ["Kartoffel"] },
  { cat: "Ernte — Gemüse-Erntekette", crops: ["Zwiebel/Möhre"] },
];

export function AnbaustrategieView() {
  const domain = useModelStore((s) => s.domain);
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);
  const [totalHa, setTotalHa] = React.useState(10000);
  const [irrHa, setIrrHa] = React.useState(4000);
  const nonIrr = Math.max(0, totalHa - irrHa);

  const eco = React.useMemo(() => {
    const c = deriveContribution(domain, sc);
    const by = new Map(c.crops.map((x) => [x.cropId, x]));
    const dbIrr = (id: string) => by.get(id)?.contribPerHaCent ?? 0;                 // CENT/ha beregnet
    const revIrr = (id: string) => { const x = by.get(id); return x && x.areaHa > 0 ? (x.revenueCent + x.subsidyCent) / x.areaHa : 0; };
    // Trockenrotation entfallen — Rain-fed-DB als Näherung 55 % des beregneten DB, falls doch angefragt.
    const dbDry = (id: string) => Math.round(dbIrr(id) * 0.55);
    return { dbIrr, revIrr, dbDry };
  }, [domain, sc, tick]);

  // Szenario-Rechnung: Summe Fläche×DB/ha (+ Umsatz analog)
  const calc = (alloc: { crop: string; ha: number; db: number; rev: number }[]) => {
    const db = alloc.reduce((a, x) => a + x.ha * x.db, 0);
    const rev = alloc.reduce((a, x) => a + x.ha * x.rev, 0);
    const ha = alloc.reduce((a, x) => a + x.ha, 0);
    return { db, rev, ha, dbPerHa: ha > 0 ? db / ha : 0 };
  };
  const allocIrr = (rot: { crop: string; s: number }[], ha: number) => rot.map((r) => ({ crop: r.crop, ha: ha * r.s, db: eco.dbIrr(r.crop), rev: eco.revIrr(r.crop) }));
  const allocDry = (rot: { crop: string; s: number }[], ha: number) => rot.map((r) => ({ crop: r.crop, ha: ha * r.s, db: eco.dbDry(r.crop), rev: eco.revIrr(r.crop) * 0.6 }));

  const scenA = calc(allocIrr(ROT_VALUE, irrHa));                                     // nur Wertkulturen (beregnet)
  const scenB = calc([...allocIrr(ROT_CASH, irrHa), ...allocDry(ROT_CASH, nonIrr)]);  // nur Cash Crops (volle Fläche)
  const scenC = calc([...allocIrr(ROT_VOLL, irrHa), ...allocDry(ROT_CASH, nonIrr)]);  // gemischt
  const scenarios = [
    { id: "a", name: t("a) Nur Wertkulturen"), sub: `${fmtNumber(irrHa, 0)} ${t("ha beregnet · nicht-beregnet brach")}`, k: scenA, rot: ROT_VALUE, dry: null },
    { id: "b", name: t("b) Nur Cash Crops (volle Fläche)"), sub: `${fmtNumber(totalHa, 0)} ${t("ha gesamt")}`, k: scenB, rot: ROT_CASH, dry: ROT_CASH },
    { id: "c", name: t("c) Gemischt (Voll-Rotation + Cash Crops)"), sub: `${fmtNumber(irrHa, 0)} ${t("beregnet")} + ${fmtNumber(nonIrr, 0)} ${t("trocken")}`, k: scenC, rot: ROT_VOLL, dry: ROT_CASH },
  ];
  const maxDb = Math.max(1, ...scenarios.map((s) => s.k.db));

  // ECHTE Engine-Rechnung je Strategie: Anbauplan (beregneter Block) auf die Rotation tauschen,
  //  Stufe „Status Quo" (kein Ramp), volles Modell rechnen → Jahr-1-Umsatz/EBITDA + Maschinen-CAPEX.
  const engine = React.useMemo(() => {
    const buildPlan = (rot: { crop: string; s: number }[]) => {
      const by = new Map<string, number>();
      for (const r of rot) by.set(r.crop, (by.get(r.crop) ?? 0) + irrHa * r.s);
      return [...by].filter(([, ha]) => ha > 0).map(([crop, ha], i) => {
        const cat = domain.catalog.find((c) => c.cropId === crop);
        return { id: `strat-${i}-${crop}`, cropId: crop, areaHa: Math.round(ha),
          plantingPeriod: cat?.plantingPeriod ?? 3, harvestPeriods: (cat?.harvestPeriods ?? [8]).slice() };
      });
    };
    const run = (rot: { crop: string; s: number }[]) => {
      try {
        const dom: any = { ...domain, anbauplan: buildPlan(rot), growth: domain.growth ? { ...domain.growth, stage: "s1" } : domain.growth };
        const st = buildModelState(dom, sc);
        const c = computeModel(st, sc);
        const y1 = (a: number[]) => a.slice(0, 12).reduce((x, y) => x + y, 0);
        const machCapex = deriveCapex(dom, sc).filter((d: any) => d.assetClass === "machinery").reduce((x: number, d: any) => x + d.amount, 0);
        const rev = y1(c.pnl.revenue.values), ebitda = y1(c.pnl.ebitda.values);
        return { rev, ebitda, machCapex, margin: rev > 0 ? ebitda / rev : 0, ok: c.checks.every((k: any) => k.passed || k.severity !== "error") };
      } catch { return { rev: 0, ebitda: 0, machCapex: 0, margin: 0, ok: false }; }
    };
    return { a: run(ROT_VALUE), b: run(ROT_CASH), c: run(ROT_VOLL) };
  }, [domain, sc, irrHa, tick]);
  const engById: Record<string, typeof engine.a> = { a: engine.a, b: engine.b, c: engine.c };

  return (
    <div className="space-y-4">
      {/* Fläche */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Anbaustrategie & Fruchtfolge — Szenarien-Simulator")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">{t("Heute 10.000 ha · 4.000 beregnet → Ausbau auf 10.000 beregnet")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <label className="flex items-center gap-2 text-[12px]"><span className="text-nx-text-secondary">{t("Gesamtfläche")}</span><NumberInput value={totalHa} width={80} suffix="ha" onCommit={(n) => setTotalHa(Math.max(0, Math.round(n)))} /></label>
          <label className="flex items-center gap-2 text-[12px]"><span className="text-nx-text-secondary">{t("davon beregnet")}</span><NumberInput value={irrHa} width={80} suffix="ha" onCommit={(n) => setIrrHa(Math.max(0, Math.min(totalHa, Math.round(n))))} /></label>
          <input type="range" min={4000} max={totalHa} step={500} value={Math.min(irrHa, totalHa)} onChange={(e) => setIrrHa(Number(e.target.value))} style={{ width: 220 }} />
          <span className="text-[12px] text-nx-text-muted">{t("unberegnet")} <b className="num">{fmtNumber(nonIrr, 0)} ha</b> {t("· Beregnungsgrad")} {fmtNumber(totalHa > 0 ? irrHa / totalHa * 100 : 0, 0)} %</span>
        </div>
      </section>

      {/* Rotations-Optimierer (deterministisch, DB-maximal je Pool) */}
      <RotationsOptimizerPanel />

      {/* Szenario-Vergleich */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}><h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Ergebnis-Vergleich (Deckungsbeitrag p.a.)")}</h3></div>
        <div className="px-4 py-3 space-y-2.5">
          {scenarios.map((s) => (
            <div key={s.id} className="flex items-center gap-3 text-[12px]">
              <div className="w-[280px] shrink-0"><div className="font-semibold">{s.name}</div><div className="caption text-[10px] text-nx-text-muted">{s.sub}</div></div>
              <div className="relative h-7 flex-1 rounded-control overflow-hidden" style={{ background: "var(--nx-surface-sunken)" }}>
                <div className="absolute inset-y-0 left-0 rounded-control" style={{ width: `${Math.max(2, s.k.db / maxDb * 100)}%`, background: "var(--nx-series)" }} />
              </div>
              <div className="w-[168px] shrink-0 text-right leading-tight">
                <div className="num text-[13px] font-semibold" style={{ color: "var(--nx-text)" }}>{fmtMoney(s.k.db)} {t("€ DB")}</div>
                <div className="num text-[10px] text-nx-text-muted">{fmtMoney(s.k.dbPerHa)} €/ha · {fmtNumber(s.k.ha, 0)} ha</div>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Wertkulturen (Tomate/Kartoffel/Zwiebel-Möhre) sowie Mais & Soja laufen")} <b>{t("nur auf beregneter Fläche")}</b>{t(". Cash Crops (Weizen/Raps/Gerste) auch trocken (Rain-fed-DB aus der Trockenrotation). DB je ha aus dem Modell (Contribution).")}
        </div>
      </section>

      {/* ECHTE Engine-Rechnung je Szenario (Anbauplan getauscht, volles Modell) */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Voll durchgerechnet je Szenario (Engine · beregneter Block, Status Quo)")}</h3>
        </div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead><tr className="caption text-[10px] text-nx-text-muted">
              <th className="px-2 py-1.5 text-left">{t("Szenario")}</th>
              <th className="px-2 py-1.5 text-right">{t("Umsatz p.a.")}</th>
              <th className="px-2 py-1.5 text-right">EBITDA p.a.</th>
              <th className="px-2 py-1.5 text-right">{t("EBITDA-Marge")}</th>
              <th className="px-2 py-1.5 text-right">{t("Maschinen-CAPEX (Park)")}</th>
              <th className="px-2 py-1.5 text-right">EBITDA / CAPEX</th>
            </tr></thead>
            <tbody>
              {scenarios.map((s) => { const e = engById[s.id]; return (
                <tr key={s.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5 font-medium">{s.name}</td>
                  <td className="num px-2 py-1.5 text-right">{fmtMoney(e.rev)} €</td>
                  <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{fmtMoney(e.ebitda)} €</td>
                  <td className="num px-2 py-1.5 text-right">{fmtNumber(e.margin * 100, 0)} %</td>
                  <td className="num px-2 py-1.5 text-right" style={{ color: "var(--nx-locate)" }}>{fmtMoney(e.machCapex)} €</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">{e.machCapex > 0 ? fmtNumber(e.ebitda / e.machCapex, 2) + "×" : "–"}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Jedes Szenario tauscht den Anbauplan des beregneten Blocks auf die jeweilige Rotation und rechnet das")} <b>{t("volle Modell")}</b>{t(" (Umsatz × Ertrag × Preis, Betriebsmittel + Maschinenkosten, Schlagkraft-Sizing → Maschinen-CAPEX). Basis = Status Quo (heutige Fläche, kein Ramp), aktives Preis-Szenario. So siehst du direkt, dass Wertkulturen den höchsten Umsatz/EBITDA, aber auch den höchsten Spezialtechnik-CAPEX tragen.")}
        </div>
      </section>

      {/* Fruchtfolgen + Visualisierung (3 Mockup-Alternativen) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RotationCard title={t("Beregnete Vollrotation (optimal)")} rot={ROT_VOLL} db={eco.dbIrr} note={t("Wert + Mais/Soja + Getreide-Break; Solanaceae (Tomate/Kartoffel) max. 1-in-3–4 Jahre, Soja als N-Fixierer.")} />
        <RotationCard title={t("Unberegnete Cash-Crop-Rotation (optimal)")} rot={ROT_CASH} db={eco.dbDry} note={t("Winterweizen → Winterraps (Ölsaat-Break) → Wintergerste; trockentolerant, Raps als Vorfrucht für Weizen.")} />
      </div>

      {/* Maschinen → Crop-Zuordnung */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}><h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Maschinen → Crop-Zuordnung (CAPEX/Kosten je Szenario)")}</h3></div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead><tr className="caption text-[10px] text-nx-text-muted">
              <th className="px-2 py-1.5 text-left">{t("Maschinen-Kategorie")}</th><th className="px-2 py-1.5 text-left">{t("bediente Kulturen")}</th>
              <th className="px-2 py-1.5 text-center">{t("a) Wert")}</th><th className="px-2 py-1.5 text-center">{t("b) Cash")}</th><th className="px-2 py-1.5 text-center">{t("c) Gemischt")}</th></tr></thead>
            <tbody>
              {MACHINE_CROPS.map((m) => {
                const isValueMach = /Tomaten|ROPA|Kartoffel/.test(m.cat + m.crops.join());
                const isCerealMach = /Mähdrescher/.test(m.cat);
                const need = (scen: "a" | "b" | "c") => scen === "a" ? (isValueMach || !isCerealMach) : scen === "b" ? !isValueMach : true;
                const cell = (on: boolean) => <td className="px-2 py-1.5 text-center" style={{ color: on ? "var(--nx-success)" : "var(--nx-text-muted)" }}>{on ? <Circle size={9} fill="currentColor" strokeWidth={0} className="inline-block align-middle" aria-hidden /> : <Minus size={12} strokeWidth={2.5} className="inline-block align-middle" aria-hidden />}</td>;
                return (
                  <tr key={m.cat} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                    <td className="px-2 py-1.5">{t(m.cat)}</td>
                    <td className="px-2 py-1.5 text-[11px] text-nx-text-secondary">{m.crops.join(", ")}</td>
                    {cell(need("a"))}{cell(need("b"))}{cell(need("c"))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
{t("Zuordnung: bei")} <b>{t("nur Cash Crops")}</b>{t(" entfallen Tomaten-/Kartoffel-/Gemüse-Erntetechnik (CAPEX-Ersparnis), Mähdrescher-Flotte skaliert auf die volle Fläche; bei")} <b>{t("nur Wertkulturen")}</b>{t(" entfällt die große Mähdrescher-Flotte. Die CAPEX-Wirkung je Szenario ist oben („Voll durchgerechnet je Szenario\") bereits real aus dem Schlagkraft-Sizing gerechnet.")}
        </div>
      </section>
    </div>
  );
}

/** Rotations-Optimierer — DB-maximale Trockenrotation unter Anbaupausen; Sonnenblume-Verdikt;
 *  Ist↔Empfohlen mit ΔDB und „Übernehmen" (schreibt die Trockeneinträge des Anbauplans). */
function RotationsOptimizerPanel() {
  const domain = useModelStore((s) => s.domain);
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);
  const patch = useModelStore((s) => s.patch);
  const readOnly = useModelStore((s) => s.readOnly);
  const opt = React.useMemo(() => deriveOptimalRotation(domain, sc), [domain, sc, tick]);
  const dry = opt.pools.find((p) => p.pool === "dryland");
  const sf = opt.sunflower;

  const applyDryland = () => {
    if (!dry || readOnly) return;
    patch((d) => {
      d.anbauplan = d.anbauplan.filter((a) => a.pool !== "dryland");
      for (const r of dry.recommended) {
        if (r.ha <= 0) continue;
        const cat = d.catalog.find((c) => c.cropId === r.cropId);
        d.anbauplan.push({
          id: `ab-${r.cropId}`, cropId: r.cropId, areaHa: r.ha,
          plantingPeriod: cat?.plantingPeriod ?? 3, harvestPeriods: (cat?.harvestPeriods ?? [8]).slice(),
          pool: "dryland",
        });
      }
    });
  };

  const border = "var(--nx-border)";
  const uplift = dry?.upliftCent ?? 0;
  const alreadyOptimal = !dry || uplift <= dry.currentDbCent * 0.001; // < 0,1 % Rest → praktisch optimal

  return (
    <section className="rounded-tile border" style={{ borderColor: border, background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: border }}>
        <h2 className="text-[14px] font-semibold inline-flex items-center gap-2">
          <Sparkles size={15} className="inline-block" style={{ color: "var(--nx-brand-lift)" }} aria-hidden />
          {t("Rotations-Optimierer (Trockenrotation)")}
        </h2>
        <span className="caption text-[10.5px] text-nx-text-muted">{t("DB-maximal unter Anbaupausen · deterministisch")}</span>
      </div>

      {/* Sonnenblume-Verdikt */}
      {sf.available && (
        <div className="px-4 py-3 border-b flex flex-wrap items-center gap-x-4 gap-y-1.5" style={{ borderColor: "var(--nx-border-divider)" }}>
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: sf.attractive ? "var(--nx-success)" : "var(--nx-text)" }}>
            {sf.attractive ? <Check size={14} aria-hidden /> : <TriangleAlert size={14} aria-hidden />}
            <Sun size={13} aria-hidden /> {t("Sonnenblume")}: {sf.attractive ? t("wirtschaftlich attraktiv") : t("kein Vorteil")}
          </span>
          <span className="num text-[12px] text-nx-text-secondary">{t("DB")} <b>{fmtMoney(sf.dbPerHaCent)} €/ha</b></span>
          {sf.attractive && <span className="num text-[12px]" style={{ color: "var(--nx-success)" }}>+{fmtMoney(sf.deltaPerHaCent)} €/ha {t("vs.")} {(SHORT2[sf.bestAlternativeId] ?? sf.bestAlternativeId)}</span>}
          <span className="text-[11px] text-nx-text-muted flex-1 min-w-[240px]">{t(sf.note)}</span>
        </div>
      )}

      {dry && (
        <>
          {/* Ist ↔ Empfohlen */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
            <RotColumn title={t("Ist-Rotation")} rows={dry.current} area={dry.areaHa} totalCent={dry.currentDbCent} muted />
            <div className="border-t md:border-t-0 md:border-l" style={{ borderColor: "var(--nx-border-divider)" }}>
              <RotColumn title={t("Optimierte Rotation")} rows={dry.recommended} area={dry.areaHa} totalCent={dry.recommendedDbCent} highlight />
            </div>
          </div>

          {/* ΔDB + Übernehmen */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t" style={{ borderColor: border }}>
            <div className="text-[12px]">
              {alreadyOptimal ? (
                <span className="inline-flex items-center gap-1.5" style={{ color: "var(--nx-success)" }}><Check size={14} aria-hidden /> {t("Die aktuelle Trockenrotation ist bereits DB-optimal.")}</span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <ArrowRight size={14} style={{ color: "var(--nx-brand-lift)" }} aria-hidden />
                  {t("Mehr-Deckungsbeitrag")} <b className="num text-[13px]" style={{ color: "var(--nx-success)" }}>+{fmtMoney(uplift)} € / Jahr</b>
                  <span className="text-nx-text-muted">({fmtMoney(dry.currentDbCent)} → {fmtMoney(dry.recommendedDbCent)} €)</span>
                </span>
              )}
            </div>
            <button
              onClick={applyDryland}
              disabled={readOnly || alreadyOptimal}
              className="rounded-control px-3 py-1.5 text-[12px] font-semibold transition-opacity"
              style={{ background: readOnly || alreadyOptimal ? "var(--nx-surface-sunken)" : "var(--nx-brand-lift)", color: readOnly || alreadyOptimal ? "var(--nx-text-muted)" : "#fff", cursor: readOnly || alreadyOptimal ? "default" : "pointer", opacity: readOnly || alreadyOptimal ? 0.6 : 1 }}
              title={readOnly ? t("Betrachter-Modus: Änderungen gesperrt") : t("Übernimmt die optimierte Trockenrotation in den Anbauplan")}
            >
              {t("In Anbauplan übernehmen")}
            </button>
          </div>

          {/* Bindende Schranken */}
          {dry.binding.length > 0 && (
            <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: border }}>
              <b>{t("Bindende Anbaupausen:")}</b> {dry.binding.join(" · ")}. {t("Die Ölsaaten (Raps + Sonnenblume) teilen sich als Sclerotinia-Wirte einen Break-Slot; Getreide ist auf 2/3 der Trockenfläche begrenzt.")}
            </div>
          )}
        </>
      )}
      {!dry && (
        <div className="px-4 py-3 text-[12px] text-nx-text-muted">{t("Keine Trockenrotation im aktuellen Anbauplan — der Optimierer greift auf der unberegneten Fläche.")}</div>
      )}
    </section>
  );
}

/** Eine Rotations-Spalte (Ist oder Empfohlen) mit Balken je Kultur und Summe. */
function RotColumn({ title, rows, area, totalCent, muted, highlight }: {
  title: string; rows: { cropId: string; name: string; ha: number; sharePct: number; dbPerHaCent: number }[];
  area: number; totalCent: number; muted?: boolean; highlight?: boolean;
}) {
  const maxShare = Math.max(0.01, ...rows.map((r) => r.sharePct));
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[12.5px] font-semibold" style={{ color: highlight ? "var(--nx-brand-lift)" : "var(--nx-text-secondary)" }}>{title}</h3>
        <span className="num text-[11px] text-nx-text-muted">{fmtNumber(area, 0)} ha</span>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.cropId} className="flex items-center gap-2 text-[12px]">
            <span style={{ width: 9, height: 9, borderRadius: 2, background: CROP_COLOR[r.cropId] ?? "var(--nx-border)", flex: "0 0 auto", opacity: muted ? 0.7 : 1 }} />
            <span className="w-[150px] shrink-0 truncate">{t(r.name)}</span>
            <div className="relative h-4 flex-1 rounded-sm overflow-hidden" style={{ background: "var(--nx-surface-sunken)" }}>
              <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(r.sharePct / maxShare) * 100}%`, background: highlight ? "var(--nx-success)" : "var(--nx-series)", opacity: muted ? 0.55 : 0.9 }} />
            </div>
            <span className="num w-[40px] shrink-0 text-right text-nx-text-muted">{fmtNumber(r.sharePct * 100, 0)}%</span>
            <span className="num w-[62px] shrink-0 text-right">{fmtNumber(r.ha, 0)} ha</span>
            <span className="num w-[64px] shrink-0 text-right text-[11px] text-nx-text-muted">{fmtMoney(r.dbPerHaCent)}/ha</span>
          </div>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t flex items-center justify-between text-[12px]" style={{ borderColor: "var(--nx-border-divider)" }}>
        <span className="font-semibold">{t("Σ Deckungsbeitrag")}</span>
        <span className="num font-semibold" style={{ color: highlight ? "var(--nx-success)" : "var(--nx-text)" }}>{fmtMoney(totalCent)} €</span>
      </div>
    </div>
  );
}

const SHORT2: Record<string, string> = {
  weizen_dry: "Weizen (tr.)", gerste_dry: "Gerste (tr.)", raps_dry: "Raps (tr.)", sonnenblume: "Sonnenblume",
};

const SHORT: Record<string, string> = {
  weizen: "Weizen", gerste_zw: "Gerste", winterraps: "Raps", soja_luzerne: "Soja", mais: "Mais",
  tomate: "Tomate", kartoffel_pommes: "Kartoffel", kartoffel_chips: "Kartoffel", zwiebel_moehre: "Zwiebel/Möhre",
};
/** Rotations-Ring — Standardvisualisierung: farbige Slots im Kreis, Kultur-Labels außen, Flusspfeil. */
function RotationCard({ title, rot, db, note }: { title: string; rot: { crop: string; s: number }[]; db: (id: string) => number; note: string }) {
  const n = rot.length;
  const col = (id: string) => CROP_COLOR[id] ?? "var(--nx-border)";
  // Breite viewBox mit horizontalem Freiraum, damit die Außen-Labels nicht abschneiden.
  const W = 480, H = 300, cx = 240, cy = 150, R = 104, Ri = 60;
  const gap = 0.03; // Radiant-Lücke zwischen Slots
  const totalDb = rot.reduce((s, r) => s + r.s * db(r.crop), 0);

  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <span className="num text-[11px] text-nx-text-muted">{t("Ø DB")} <b style={{ color: "var(--nx-brand-lift)" }}>{fmtMoney(totalDb)} €/ha</b></span>
      </div>
      <div className="px-2 py-3">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} style={{ overflow: "visible" }}>
          <defs><marker id="rot-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M1,1 L7,4 L1,7 Z" fill="var(--nx-text-muted)" /></marker></defs>
          {rot.map((r, i) => {
            const a0 = (i / n) * 2 * Math.PI - Math.PI / 2 + gap, a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2 - gap;
            const P = (a: number, rad: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
            const large = a1 - a0 > Math.PI ? 1 : 0;
            const d = `M${P(a0, Ri)} L${P(a0, R)} A${R},${R} 0 ${large} 1 ${P(a1, R)} L${P(a1, Ri)} A${Ri},${Ri} 0 ${large} 0 ${P(a0, Ri)} Z`;
            const am = ((i + 0.5) / n) * 2 * Math.PI - Math.PI / 2;
            const ca = Math.cos(am);
            const mx = cx + (R + 12) * ca, my = cy + (R + 12) * Math.sin(am);
            const anchor = ca > 0.15 ? "start" : ca < -0.15 ? "end" : "middle";
            const numx = cx + (R + Ri) / 2 * ca, numy = cy + (R + Ri) / 2 * Math.sin(am);
            return (
              <g key={i}>
                <path d={d} fill={col(r.crop)} stroke="var(--nx-surface)" strokeWidth={2} />
                <text x={numx} y={numy + 3.5} fontSize={11} fill="#1a1a1a" textAnchor="middle" fontWeight={700}>{i + 1}</text>
                <text x={mx} y={my + 1} fontSize={11} fill="var(--nx-text)" textAnchor={anchor} fontWeight={600}>{i + 1}. {SHORT[r.crop] ?? r.crop}</text>
                <text x={mx} y={my + 14} fontSize={9.5} fill="var(--nx-text-muted)" textAnchor={anchor} className="num">{fmtMoney(db(r.crop))} €/ha</text>
              </g>
            );
          })}
          {(() => { const rr = Ri - 10, aS = -Math.PI / 2, aE = Math.PI; const p = (a: number) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
            return <path d={`M${p(aS)} A${rr},${rr} 0 1 1 ${p(aE)}`} fill="none" stroke="var(--nx-border-divider)" strokeWidth={1.5} strokeDasharray="3 4" markerEnd="url(#rot-arrow)" />; })()}
          <text x={cx} y={cy - 3} fontSize={22} fill="var(--nx-text)" textAnchor="middle" fontWeight={700}>{n}</text>
          <text x={cx} y={cy + 13} fontSize={9} fill="var(--nx-text-muted)" textAnchor="middle">{t("Felder · Jahre")}</text>
        </svg>
      </div>
      <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>{note}</div>
    </section>
  );
}
