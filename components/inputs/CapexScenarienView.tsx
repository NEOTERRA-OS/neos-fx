"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { buildModelState, deriveCapex, machineFleetCount } from "../../store/model";
import { computeModel } from "../../core/engine";
import { fmtMoney, fmtNumber } from "../../design/format";
import { Segmented } from "../primitives/Segmented";
import { TramlineEconomics, computeTramline } from "./TramlineEconomics";
import { ScenarioView, SCENARIO_TABS, type ScenarioTab } from "./ScenarioView";
import { BodenprobenahmeView } from "./BodenprobenahmeView";
import { SpritzenView } from "./SpritzenView";
import { t } from "../../lib/i18n";

// EINE flache Tab-Struktur: Technik-Vergleich · alle Rechner-Szenarien · Bodenprobenahme.
type CapexTab = "technik" | ScenarioTab | "boden";
const RECHNER_TABS = new Set<string>(SCENARIO_TABS.map((t) => t.id));

/** CAPEX-Szenarien — technikseitige Investitionsvarianten live gegeneinander gerechnet.
 *  Erste Karte: Spritz- & Düngertechnik 36 m (Bestand) vs. 48 m (Paket). Beide Varianten
 *  laufen durch das volle Modell (buildModelState + computeModel + deriveCapex), sodass
 *  CAPEX-Delta UND EBITDA-Effekt (−25 % Spritz-€/ha bei 48 m) konsistent sichtbar werden. */
export function CapexScenarienView() {
  const domain = useModelStore((s) => s.domain);
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);
  const patch = useModelStore((s) => s.patch);
  const [tab, setTab] = React.useState<CapexTab>("technik");

  const activeBoom48 = React.useMemo(() => {
    const a = domain.assumptions["farm.boom48"];
    const prof = a?.scenarioProfiles?.[sc] ?? a?.scenarioProfiles?.[domain.baseScenarioId];
    return prof && prof.kind === "constant" ? Math.round((prof as any).value) === 1 : false;
  }, [domain, sc, tick]);

  const sim = React.useMemo(() => {
    const run = (boom48: 0 | 1) => {
      const dom: any = structuredClone(domain);
      const setC = (k: string, v: number) => { if (dom.assumptions[k]) dom.assumptions[k].scenarioProfiles[sc] = { kind: "constant", value: v }; };
      setC("farm.boom48", boom48);
      setC("spray.boom_m", boom48 ? 48 : 36);
      const ms: any = buildModelState(dom, sc);
      const cm: any = computeModel(ms, sc);
      const dc = deriveCapex(dom, sc);
      const amt = (ids: string[]) => dc.filter((d) => ids.includes(d.machineId)).reduce((s, d) => s + d.amount, 0);
      const cnt = (id: string) => { const m = dom.machineCatalog.find((x: any) => x.id === id); return m ? machineFleetCount(dom, m, sc) : 0; };
      const cap = ms.capex ?? [];
      const machTotal = cap.filter((c: any) => c.assetClass === "machinery").reduce((s: number, c: any) => s + c.amount, 0);
      const capTotal = cap.reduce((s: number, c: any) => s + c.amount, 0);
      const y1 = (a: number[]) => a.slice(0, 12).reduce((x, y) => x + y, 0);
      const all = (a: number[]) => a.reduce((x, y) => x + y, 0);
      return {
        boomM: boom48 ? 48 : 36,
        sprayCnt: cnt("spray_gz") + cnt("spray_sf"),
        streuerCnt: cnt("streuer") + cnt("streuer_rauch") + cnt("streuer_xeric"),
        streuerModell: boom48 ? "HORSCH Leeb Xeric 14 FS · 48 m" : "Bredal K135 · 36 m (2×)",
        retrofitCapex: amt(["boom48_retrofit"]),
        streuerSwapCapex: amt(["streuer_xeric"]),
        machTotal, capTotal,
        ebitdaY1: y1(cm.pnl.ebitda.values),
        ebitdaSum: all(cm.pnl.ebitda.values),
        revY1: y1(cm.pnl.revenue.values),
        ok: cm.checks.every((k: any) => k.passed || k.severity !== "error"),
      };
    };
    return { base: run(0), b48: run(1) };
  }, [domain, sc, tick]);

  const { base, b48 } = sim;
  const incrCapex = b48.retrofitCapex + b48.streuerSwapCapex; // Mehr-CAPEX 48m t0
  const dOpexY1 = b48.ebitdaY1 - base.ebitdaY1;                // Betriebskosten-Vorteil p.a. (−25 % Spritz-€/ha)
  const dEbitdaSum = b48.ebitdaSum - base.ebitdaSum;
  const dCapTotal = b48.capTotal - base.capTotal;
  // Fahrgassen-Ertragsvorteil (der eigentliche Hebel bei Kartoffel/Tomate) — additiv zum Opex-Effekt.
  const tramBenefit = domain.tramline ? computeTramline(domain.tramline).benefitTotal : 0;
  const dEbitdaY1 = dOpexY1 + tramBenefit;                     // Gesamt-Vorteil p.a.
  const payback = dEbitdaY1 > 0 ? incrCapex / dEbitdaY1 : Infinity; // Jahre (auf Gesamt-Vorteil)

  const adopt = (boom48: boolean) => patch((d) => {
    const setC = (k: string, v: number) => { if (d.assumptions[k]) d.assumptions[k].scenarioProfiles[d.baseScenarioId] = { kind: "constant", value: v }; };
    setC("farm.boom48", boom48 ? 1 : 0);
    setC("spray.boom_m", boom48 ? 48 : 36);
  });

  const border = "var(--nx-border)", surface = "var(--nx-surface)";
  const Money = ({ c }: { c: number }) => <span className="num">{fmtMoney(c, "EUR")} €</span>;

  // Vergleichszeile: Label · 36m · 48m · Δ
  const Row = ({ label, a, b, delta, hint, strong }: { label: string; a: React.ReactNode; b: React.ReactNode; delta?: React.ReactNode; hint?: string; strong?: boolean }) => (
    <tr style={{ borderTop: `1px solid ${border}` }} className={strong ? "font-semibold" : ""}>
      <td className="px-3 py-1.5 text-[12px] text-nx-text-secondary">{label}{hint && <span className="block caption text-[10px] text-nx-text-muted">{hint}</span>}</td>
      <td className="px-3 py-1.5 text-[12px] text-right num">{a}</td>
      <td className="px-3 py-1.5 text-[12px] text-right num" style={{ background: "color-mix(in srgb, var(--nsb-accent) 8%, transparent)" }}>{b}</td>
      <td className="px-3 py-1.5 text-[12px] text-right num text-nx-text-muted">{delta}</td>
    </tr>
  );

  return (
    <div className="space-y-4">
      {/* Tab-Leiste */}
      <div className="rounded-tile border" style={{ borderColor: border, background: surface }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: border }}>
          <h2 className="text-[14px] font-semibold">{t("CAPEX Szenarien")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">{t("Aktiv im Modell:")} <b>{activeBoom48 ? t("48-m-Paket") : t("36 m (Bestand)")}</b> · {t("Szenario")} {sc}</span>
        </div>
        <div className="overflow-x-auto px-4 py-3">
          <Segmented ariaLabel={t("CAPEX-Szenarien-Ansicht")} value={tab} onChange={(v) => setTab(v as CapexTab)}
            options={[
              { value: "technik", label: t("Spritz-/Düngertechnik") },
              ...SCENARIO_TABS.map((st) => ({ value: st.id, label: t(st.label) })),
              { value: "boden", label: t("Bodenprobenahme (Make-or-Buy)") },
            ]} />
        </div>
      </div>

      {RECHNER_TABS.has(tab) ? (
        <div className="space-y-4">
          <div className="rounded-tile border px-4 py-3" style={{ borderColor: border, background: surface }}>
            <h2 className="text-[14px] font-semibold">{t("CAPEX-Szenarien-Rechner")}</h2>
            <p className="mt-1 text-[12px] text-nx-text-secondary">
              {t("Treiberbasierte Entscheidungsszenarien (Make-or-Buy, Technik-Vergleiche). Alle Eingaben sind Stellhebel; Vollkosten (AfA + Zins + Versicherung fix; Diesel + Reparatur variabel; Personal) und Stückzahl rechnen live. Die gewählten Optionen speisen das Modell (z. B. Transport →")} <span className="num">opex.transport</span> {t("+ LKW-CAPEX).")}
            </p>
          </div>
          <ScenarioView tab={tab as ScenarioTab} />
        </div>
      ) : tab === "boden" ? <BodenprobenahmeView />
        : <div className="space-y-4">
      {/* Spritz-/Düngertechnik: erst Mischpark-/Sizing-Deep-Dive, dann der 36-vs-48-m-Investitionsvergleich. */}
      <SpritzenView />
      <section className="rounded-tile border" style={{ borderColor: border, background: surface }}>
        <div className="px-4 py-2.5 border-b caption text-[10.5px] font-semibold uppercase tracking-wide" style={{ borderColor: border, color: "var(--nx-brand-lift)" }}>{t("Investitionsvergleich · 36 m (Bestand) vs. 48 m (Paket)")}</div>
        <p className="px-4 py-2.5 text-[11.5px] text-nx-text-secondary leading-relaxed">
          {t("Das 48-m-Paket rüstet die Spritzgestänge (PT/TD) auf 48 m um, ergänzt ein Fahrgassen-Terminal und tauscht den Düngerstreuer auf einen HORSCH Leeb Xeric 14 FS (48 m). Breitere Arbeitsbreite → weniger Überfahrten/Std pro ha (−25 % Spritz-€/ha) und tendenziell weniger Maschinen im Spritzfenster — gegen einmalige Umrüst-CAPEX. Beide Varianten sind hier voll durchgerechnet (CAPEX, Flotte und EBITDA konsistent).")}
        </p>
      </section>

      <section className="rounded-tile border overflow-hidden" style={{ borderColor: border, background: surface }}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-nx-text-muted uppercase tracking-wide">{t("Kennzahl")}</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold text-nx-text-muted uppercase tracking-wide">{t("36 m (Bestand)")}</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide" style={{ background: "color-mix(in srgb, var(--nsb-accent) 14%, transparent)" }}>{t("48 m (Paket)")}</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold text-nx-text-muted uppercase tracking-wide">Δ</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={4} className="px-3 pt-2 pb-1 text-[10.5px] font-semibold text-nx-text-muted uppercase tracking-wide">{t("Betriebsparameter")}</td></tr>
            <Row label={t("Arbeitsbreite Spritze")} a="36 m" b="48 m" delta="+12 m" />
            <Row label={t("Anzahl Feldspritzen")} a={fmtNumber(base.sprayCnt, 0)} b={fmtNumber(b48.sprayCnt, 0)} delta={b48.sprayCnt - base.sprayCnt === 0 ? "±0" : fmtNumber(b48.sprayCnt - base.sprayCnt, 0)} />
            <Row label={t("Arbeitsbreite Streuer")} a="36 m" b="48 m" delta="+12 m" />
            <Row label={t("Anzahl Düngerstreuer")} a={fmtNumber(base.streuerCnt, 0)} b={fmtNumber(b48.streuerCnt, 0)} delta={b48.streuerCnt - base.streuerCnt === 0 ? "±0" : fmtNumber(b48.streuerCnt - base.streuerCnt, 0)} />
            <Row label={t("Streuer-Modell")} a={<span className="text-[10.5px]">Bredal K135 (2×)</span>} b={<span className="text-[10.5px]">Leeb Xeric 14 FS</span>} />

            <tr><td colSpan={4} className="px-3 pt-3 pb-1 text-[10.5px] font-semibold text-nx-text-muted uppercase tracking-wide">{t("Einmal-CAPEX (t0, inkrementell)")}</td></tr>
            <Row label={t("48-m-Umrüstpaket")} hint={t("Gestänge PT/TD + Fahrgassen-Terminal")} a={<Money c={0} />} b={<Money c={b48.retrofitCapex} />} delta={<Money c={b48.retrofitCapex} />} />
            <Row label={t("Streuer-Swap Leeb Xeric")} a={<Money c={0} />} b={<Money c={b48.streuerSwapCapex} />} delta={<Money c={b48.streuerSwapCapex} />} />
            <Row label={t("Σ Mehr-CAPEX Technik")} strong a={<Money c={0} />} b={<Money c={incrCapex} />} delta={<Money c={incrCapex} />} />

            <tr><td colSpan={4} className="px-3 pt-3 pb-1 text-[10.5px] font-semibold text-nx-text-muted uppercase tracking-wide">{t("Gesamtmodell (Mehrjahres-Ramp)")}</td></tr>
            <Row label={t("Σ Maschinen-CAPEX")} a={<Money c={base.machTotal} />} b={<Money c={b48.machTotal} />} delta={<Money c={b48.machTotal - base.machTotal} />} />
            <Row label={t("Σ CAPEX gesamt")} a={<Money c={base.capTotal} />} b={<Money c={b48.capTotal} />} delta={<Money c={dCapTotal} />} />
            <Row label={t("EBITDA Jahr 1")} a={<Money c={base.ebitdaY1} />} b={<Money c={b48.ebitdaY1} />} delta={<Money c={dEbitdaY1} />} />
            <Row label={t("Σ EBITDA (Horizont)")} strong a={<Money c={base.ebitdaSum} />} b={<Money c={b48.ebitdaSum} />} delta={<Money c={dEbitdaSum} />} />
          </tbody>
        </table>
      </section>

      {/* Verdikt */}
      <section className="rounded-tile border" style={{ borderColor: border, background: surface }}>
        <div className="px-4 py-3 grid gap-4 sm:grid-cols-4">
          <div>
            <div className="caption text-[10.5px] text-nx-text-muted uppercase tracking-wide">{t("Mehr-CAPEX 48 m")}</div>
            <div className="text-[18px] font-semibold num"><Money c={incrCapex} /></div>
          </div>
          <div>
            <div className="caption text-[10.5px] text-nx-text-muted uppercase tracking-wide">{t("Betriebskosten-Vorteil p.a.")}</div>
            <div className="text-[18px] font-semibold num" style={{ color: dOpexY1 >= 0 ? "var(--nx-pos, #2E7D32)" : "var(--nx-neg, #C62828)" }}>{dOpexY1 >= 0 ? "+" : ""}<Money c={dOpexY1} /></div>
          </div>
          <div>
            <div className="caption text-[10.5px] text-nx-text-muted uppercase tracking-wide">{t("Fahrgassen-Vorteil p.a.")}</div>
            <div className="text-[18px] font-semibold num" style={{ color: "var(--nx-pos, #2E7D32)" }}>+<Money c={tramBenefit} /></div>
          </div>
          <div>
            <div className="caption text-[10.5px] text-nx-text-muted uppercase tracking-wide">{t("Amortisation (gesamt)")}</div>
            <div className="text-[18px] font-semibold num">{isFinite(payback) ? `${fmtNumber(payback, 1)} ${t("J.")}` : "—"}</div>
          </div>
        </div>
        <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
          <button onClick={() => adopt(false)} className="px-3 py-1.5 rounded-md text-[12px] border" style={{ borderColor: border, background: !activeBoom48 ? "color-mix(in srgb, var(--nsb-accent) 22%, transparent)" : "transparent", fontWeight: !activeBoom48 ? 600 : 400 }}>
            {t("36 m übernehmen")}{!activeBoom48 ? " ✓" : ""}
          </button>
          <button onClick={() => adopt(true)} className="px-3 py-1.5 rounded-md text-[12px] border" style={{ borderColor: border, background: activeBoom48 ? "color-mix(in srgb, var(--nsb-accent) 22%, transparent)" : "transparent", fontWeight: activeBoom48 ? 600 : 400 }}>
            {t("48 m übernehmen")}{activeBoom48 ? " ✓" : ""}
          </button>
          <span className="caption text-[10.5px] text-nx-text-muted ml-auto">{t("Übernahme setzt")} <code>farm.boom48</code> + <code>spray.boom_m</code> {t("im Modell (wirkt auf Dashboard/Bilanz/Cashflow).")}</span>
        </div>
      </section>

      {/* Fahrgassen-Ökonomie + Cash-Crop-Schlagkraft — Detailrechnung zum 48-m-Case */}
      <TramlineEconomics />
        </div>}
    </div>
  );
}
