"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import {buildModelState, SKALIERUNG_TOTAL_HA} from "../../store/model";
import { computeModel } from "../../core/engine";
import { aggregateComputed } from "../../core/aggregate";
import { npv, irr } from "../../design/finance";
import { fmtMoney, fmtNumber, fmtPct } from "../../design/format";
import { t } from "../../lib/i18n";

function Num({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (n: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="flex items-center gap-2 text-[12px]">
      <span className="text-nx-text-secondary">{label}</span>
      <input type="number" step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="num rounded-control border px-2 text-right" style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600, height: 32, width: 84 }} />
      {suffix && <span className="text-[10.5px] text-nx-text-muted">{suffix}</span>}
    </label>
  );
}

/** DCF-Bewertung: Mehrjahres-Ramp (Stufe 1 → Ziel) auf Basis der Per-ha-Ökonomie des Kerns.
 *  FCFF, NPV @ WACC, Projekt-IRR, Terminal Value (Exit-Multiple) + Exit-Multiple-Sensitivität. */
export function BewertungView() {
  const domain = useModelStore((s) => s.domain);
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);

  const [exitM, setExitM] = React.useState(7);          // ×
  // ENTFERNT 31.07.2026: Start (4.000 ha), Ziel (20.000 ha), Ramp und Horizont. Vier
  //  Eingabefelder aus dem alten Gruppenmodell, die seit der Umstellung auf die Engine-
  //  Jahreswerte NICHTS mehr rechneten — man konnte 20.000 ha auf 50.000 stellen, und der
  //  Enterprise Value blieb auf den Cent gleich. Fläche und Horizont kommen aus dem
  //  Skalierungspfad (300 → 2.334 ha, acht Planjahre); der Exit-Multiple bleibt als einziger
  //  echter Regler stehen.

  // WACC (CAPM) — Inputs editierbar, WACC wird berechnet und speist den DCF.
  const [rf, setRf] = React.useState(3.0);              // risikofreier Zins (EUR) %
  const [erp, setErp] = React.useState(5.5);            // Equity Risk Premium %
  const [beta, setBeta] = React.useState(0.85);         // Beta (Agrar)
  const [crp, setCrp] = React.useState(2.25);           // Länderrisiko Rumänien %
  const [kd, setKd] = React.useState(5.0);              // Fremdkapitalzins (vor Steuer) %
  const [wE, setWE] = React.useState(45);               // Eigenkapital-Gewicht %

  // Peer-Multiples (Agribusiness / bewässerter Ackerbau + Verarbeitung) — editierbar
  const [pxEbLo, setPxEbLo] = React.useState(6);  const [pxEbHi, setPxEbHi] = React.useState(9);
  const [pxSaLo, setPxSaLo] = React.useState(1.2); const [pxSaHi, setPxSaHi] = React.useState(2.2);
  const [lboLo, setLboLo] = React.useState(5.5);  const [lboHi, setLboHi] = React.useState(7.5);

  const model = React.useMemo(() => {
    // KEINE Per-ha-Hochrechnung mehr. Die Ansicht baute aus einem Ein-Jahres-Lauf
    //  Kennzahlen JE HEKTAR und multiplizierte sie mit einem eigenen Flächen-Ramp von
    //  4.000 auf 20.000 ha — Flächen aus dem alten Gruppenmodell, die NEOTERRA nie erreicht
    //  (Zielzustand 2.334 ha). Ergebnis waren ein EBITDA von 425 Mio statt 9,6 Mio und ein
    //  Enterprise Value von 3,2 Mrd. Dazu kam ein zweiter Fehler: der Nenner war die
    //  300-ha-Startfläche, der Zähler die Achtjahressumme über 300 → 2.334 ha — jede
    //  Je-ha-Größe zusätzlich um Faktor 5,4 zu hoch.
    //  Jetzt: die Bewertung liest die JAHRESWERTE der Engine, dieselben Zahlen, die in GuV
    //  und Cashflow stehen. Kein zweiter Rechenweg, keine Flächenannahme.
    const cm = computeModel(buildModelState(domain, sc), sc, { outputGranularity: "month" });
    const an = aggregateComputed(cm, "year");
    const g = (o: any, k: string): number[] => o?.[k]?.values ?? [];
    const tax = readAssumption(domain, "tax.rate", sc) ?? 0.16;
    return {
      jahre: an.timeline.periodCount,
      ebitda: g(an.pnl, "ebitda"),
      ebit: g(an.pnl, "ebit"),
      afa: g(an.pnl, "depreciation"),
      capex: g(an.cashFlow, "capex").map((v) => Math.abs(v)),
      revenue: g(an.pnl, "revenue"),
      tax,
    };
  }, [domain, sc, tick]);

  // Net Debt (heute) aus dem echten Mehrjahres-Modell für die EV→Equity-Brücke.
  const fin = React.useMemo(() => {
    const cm: any = computeModel(buildModelState(domain, sc), sc, { outputGranularity: "month" });
    const g = (o: any, k: string) => (o?.[k]?.values) ?? [];
    const bs = cm.balanceSheet;
    const debt = g(bs, "debt"), rev = g(bs, "revolver"), cash = g(bs, "cash");
    const netDebtNow = (debt[0] ?? 0) + (rev[0] ?? 0) - (cash[0] ?? 0);
    let peakND = -Infinity; for (let p = 0; p < debt.length; p++) peakND = Math.max(peakND, (debt[p] ?? 0) + (rev[p] ?? 0) - (cash[p] ?? 0));
    return { netDebtNow, peakND };
  }, [domain, sc, tick]);

  // CAPM / WACC
  const wcalc = React.useMemo(() => {
    const ke = (rf + beta * erp + crp) / 100;                 // Cost of Equity
    const kdAfter = (kd / 100) * (1 - model.tax);             // Cost of Debt (nach Steuer)
    const we = Math.max(0, Math.min(1, wE / 100)), wd = 1 - we;
    const wacc = we * ke + wd * kdAfter;
    return { ke, kdAfter, wacc };
  }, [rf, erp, beta, crp, kd, wE, model.tax]);
  const wacc = wcalc.wacc * 100;                              // % für Anzeige/DCF

  const proj = React.useMemo(() => {
    const w = wacc / 100;
    const n = Math.max(1, model.jahre);
    const rows: { y: number; area: number; ebitda: number; afa: number; capex: number; fcff: number; disc: number }[] = [];
    const cf: number[] = [];
    // Jahr 0 ist im Modell das ERSTE Planjahr (2027) — es hat bereits Umsatz UND CAPEX.
    //  Ein künstliches t0 mit reiner Anfangsinvestition gibt es nicht mehr.
    for (let y = 0; y < n; y++) {
      const ebitda = model.ebitda[y] ?? 0;
      const ebit = model.ebit[y] ?? 0;
      const afa = model.afa[y] ?? 0;
      const capex = model.capex[y] ?? 0;
      const fcff = ebit * (1 - model.tax) + afa - capex;
      cf.push(fcff);
      rows.push({ y, area: SKALIERUNG_TOTAL_HA[Math.min(y, SKALIERUNG_TOTAL_HA.length - 1)] ?? 0,
                  ebitda, afa, capex, fcff, disc: fcff / Math.pow(1 + w, y) });
    }
    const last = n - 1;
    // Terminal Value auf dem EINGESCHWUNGENEN Endjahr (2034, 2.334 ha) — vorher war das
    //  Basisjahr das zehnte Jahr eines erfundenen Ramps bei 20.000 ha.
    const ebitdaFinal = model.ebitda[last] ?? 0;
    const salesFinal = model.revenue[last] ?? 0;
    const withTV = (m: number) => { const c = cf.slice(); c[last] += m * ebitdaFinal; return c; };
    const base = withTV(exitM);
    const npvBase = npv(base, w);
    const irrBase = irr(base);
    const tv = exitM * ebitdaFinal;
    const peak = cf.reduce((acc, _, i) => { const c = cf.slice(0, i + 1).reduce((a, b) => a + b, 0); return Math.min(acc, c); }, 0);
    const sens = [exitM - 2, exitM, exitM + 2].map((m) => { const c = withTV(m); return { m, npv: npv(c, w), irr: irr(c) }; });
    const totalCapex = rows.reduce((a, r) => a + r.capex, 0);
    const horizon = last;

    // Investoren-Kennzahlen
    const pvOps = rows.reduce((a, r) => a + r.disc, 0) + tv / Math.pow(1 + w, horizon); // Enterprise Value (Ops)
    const ev = pvOps;
    const equityValue = ev - fin.netDebtNow;
    const entryEbitda = model.ebitda[0] ?? 0;
    const entrySales = model.revenue[0] ?? 0;
    const evEbitda = entryEbitda > 0 ? ev / entryEbitda : 0;
    const evSales = entrySales > 0 ? ev / entrySales : 0;
    const nopatFinal = (model.ebit[last] ?? 0) * (1 - model.tax);
    const roic = totalCapex > 0 ? nopatFinal / totalCapex : 0;
    const ebitdaMargin = salesFinal > 0 ? ebitdaFinal / salesFinal : 0;
    const fcffFinal = rows[rows.length - 1]?.fcff ?? 0;
    const fcfConv = ebitdaFinal > 0 ? fcffFinal / ebitdaFinal : 0;
    // Money-Multiple (cash-on-cash, undiskontiert) & Payback
    let inflow = tv, outflow = 0;
    for (const r of rows) { if (r.fcff >= 0) inflow += r.fcff; else outflow += -r.fcff; }
    const moic = outflow > 0 ? inflow / outflow : 0;
    let cum = 0, payback = -1;
    for (const r of rows) { cum += r.fcff; if (payback < 0 && cum >= 0 && r.y > 0) payback = r.y; }

    return { rows, npvBase, irrBase, tv, ebitdaFinal, salesFinal, peak, sens, totalCapex,
      ev, equityValue, evEbitda, evSales, roic, ebitdaMargin, fcfConv, moic, payback, netDebtNow: fin.netDebtNow };
  }, [model, wacc, exitM, fin.netDebtNow]);

  // Football-Field (EV-Spannen je Methode) + Break-even
  const fball = React.useMemo(() => {
    const eb = proj.ebitdaFinal, sa = proj.salesFinal, nd = proj.netDebtNow, ev = proj.ev;
    const methods = [
      { name: "DCF (WACC " + fmtNumber(wacc, 1) + " %)", lo: ev * 0.9, hi: ev * 1.1 },
      { name: `Trading EV/EBITDA (${pxEbLo}–${pxEbHi}×)`, lo: pxEbLo * eb, hi: pxEbHi * eb },
      { name: `${t("Trading EV/Umsatz")} (${pxSaLo}–${pxSaHi}×)`, lo: pxSaLo * sa, hi: pxSaHi * sa },
      { name: `Precedent / LBO (${lboLo}–${lboHi}×)`, lo: lboLo * eb, hi: lboHi * eb },
    ];
    const allLo = Math.min(...methods.map((m) => m.lo)), allHi = Math.max(...methods.map((m) => m.hi));
    // Break-even: Equity-Value = EV − Net Debt = 0
    const k = eb > 0 ? ev / eb : 0;                       // impliziter EV/EBITDA aus DCF
    const ebBreak = k > 0 ? nd / k : 0;
    const dEb = eb - ebBreak;
    const priceHaircut = sa > 0 ? dEb / sa : 0;           // Preisrückgang bis Equity 0
    const ebitdaHaircut = eb > 0 ? dEb / eb : 0;
    const exitMultBreak = eb > 0 ? nd / eb : 0;           // Exit-Multiple, bei dem Equity 0
    return { methods, allLo, allHi, nd, priceHaircut, ebitdaHaircut, exitMultBreak, k };
  }, [proj, wacc, pxEbLo, pxEbHi, pxSaLo, pxSaHi, lboLo, lboHi]);

  const kpi = (cap: string, val: string, tone?: string) => (
    <div className="min-w-[130px]"><div className="caption text-[10.5px] font-bold text-nx-text-muted">{cap}</div>
      <div className="num text-[22px] font-bold leading-tight" style={{ color: tone }}>{val}</div></div>
  );

  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="mr-2 text-[14px] font-semibold">{t("DCF-Bewertung")}</h2>
          <span className="flex items-center gap-2 text-[12px]"><span className="text-nx-text-secondary">WACC</span><b className="num" style={{ color: "var(--nx-brand-lift)" }}>{fmtNumber(wacc, 2)} %</b><span className="text-[10px] text-nx-text-muted">{t("(berechnet ↓)")}</span></span>
          <Num label={t("Exit-Multiple")} value={exitM} onChange={setExitM} suffix="× EBITDA" />
          <span className="text-[11px] text-nx-text-muted">
            {t("Fläche und Horizont kommen aus dem Skalierungspfad")} — {fmtNumber(SKALIERUNG_TOTAL_HA[0] ?? 0, 0)} → {fmtNumber(SKALIERUNG_TOTAL_HA[SKALIERUNG_TOTAL_HA.length - 1] ?? 0, 0)} ha, {model.jahre} {t("Planjahre")}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3 px-6 py-4">
          {kpi("NPV @ " + fmtNumber(wacc, 1) + "%", fmtMoney(proj.npvBase) + " €", proj.npvBase >= 0 ? "var(--nx-success)" : "var(--nx-error)")}
          {kpi(t("Projekt-IRR"), isFinite(proj.irrBase) ? fmtPct(proj.irrBase) : "n/a")}
          {kpi("Terminal Value", fmtMoney(proj.tv) + " €")}
          {kpi("Σ CAPEX", fmtMoney(proj.totalCapex) + " €")}
          {kpi("Peak-Funding", fmtMoney(proj.peak) + " €", "var(--nx-warning)")}
        </div>
      </section>

      {/* Investoren-Kennzahlen */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}><h2 className="text-[14px] font-semibold">{t("Investoren-Kennzahlen")}</h2></div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-5" style={{ background: "var(--nx-border-divider)" }}>
          {[
            ["Enterprise Value (EV)", fmtMoney(proj.ev) + " €", t("PV der FCFF + TV")],
            [t("− Net Debt (heute)"), fmtMoney(proj.netDebtNow) + " €", t("Brücke EV → Equity")],
            ["Equity Value", fmtMoney(proj.equityValue) + " €", t("für Shareholder"), proj.equityValue >= 0 ? "var(--nx-success)" : "var(--nx-error)"],
            ["EV / EBITDA (Entry)", fmtNumber(proj.evEbitda, 1) + "×", t("Einstiegs-Multiple")],
            [t("EV / Umsatz (Entry)"), fmtNumber(proj.evSales, 1) + "×", "Sales-Multiple"],
            ["Money-Multiple (MoIC)", fmtNumber(proj.moic, 2) + "×", "cash-on-cash"],
            ["Payback", proj.payback > 0 ? proj.payback + " J." : t("> Horizont"), t("kumul. FCFF ≥ 0")],
            ["ROIC (Steady State)", fmtPct(proj.roic), "NOPAT / Invested Cap."],
            [t("EBITDA-Marge"), fmtPct(proj.ebitdaMargin), t("am Zielzustand")],
            ["FCF-Conversion", fmtPct(proj.fcfConv), "FCFF / EBITDA"],
          ].map(([k, v, s, tone], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[15px] font-semibold" style={{ color: (tone as string) ?? "var(--nx-text)" }}>{v}</div>
              <div className="caption text-[9.5px] text-nx-text-muted">{s}</div>
            </div>
          ))}
        </div>
      </section>

      {/* WACC / CAPM */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("WACC — Kapitalkosten (CAPM)")}</h2>
          <span className="num text-[13px]">WACC = <b style={{ color: "var(--nx-brand-lift)" }}>{fmtNumber(wacc, 2)} %</b></span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border-divider)" }}>
          <Num label={t("Risikofrei (rf)")} value={rf} onChange={setRf} step={0.1} suffix="%" />
          <Num label="Equity Risk Premium" value={erp} onChange={setErp} step={0.1} suffix="%" />
          <Num label="Beta (β)" value={beta} onChange={setBeta} step={0.05} suffix="" />
          <Num label={t("Länderrisiko RO")} value={crp} onChange={setCrp} step={0.25} suffix="%" />
          <Num label={t("FK-Zins (vor St.)")} value={kd} onChange={setKd} step={0.1} suffix="%" />
          <Num label={t("EK-Gewicht")} value={wE} onChange={setWE} step={5} suffix="%" />
        </div>
        <div className="grid grid-cols-1 gap-px sm:grid-cols-3" style={{ background: "var(--nx-border-divider)" }}>
          {[
            ["Cost of Equity (Ke)", fmtPct(wcalc.ke), t("rf + β·ERP + Länderrisiko")],
            [t("Cost of Debt (nach St.)"), fmtPct(wcalc.kdAfter), `kd · (1 − ${fmtNumber(model.tax * 100, 0)} % ${t("Steuer")})`],
            ["WACC", fmtNumber(wacc, 2) + " %", `${wE} % ${t("EK")} · ${100 - wE} % ${t("FK")}`],
          ].map(([k, v, s], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[15px] font-semibold" style={{ color: i === 2 ? "var(--nx-brand-lift)" : "var(--nx-text)" }}>{v}</div>
              <div className="caption text-[9.5px] text-nx-text-muted">{s}</div>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 text-[11px] text-nx-text-muted">
          <b>Ke</b>{" "}{t("= risikofreier Zins + β × Equity Risk Premium + Länderrisikoprämie (Rumänien).")}{" "}<b>WACC</b>{" "}{t("= EK-Gewicht × Ke + FK-Gewicht × FK-Zins × (1 − Steuersatz). Der berechnete WACC speist direkt den DCF oben. Steuersatz kommt aus dem Modell (")}{fmtNumber(model.tax * 100, 0)} %).
        </div>
      </section>

      {/* Football-Field + Peer-Multiples */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Football-Field — Bewertungsspannen (Enterprise Value)")}</h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <span className="flex items-center gap-1">EV/EBITDA<input type="number" step={0.5} value={pxEbLo} onChange={(e) => setPxEbLo(Number(e.target.value))} className="num rounded-control border px-1 text-right" style={{ width: 46, height: 26, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />–<input type="number" step={0.5} value={pxEbHi} onChange={(e) => setPxEbHi(Number(e.target.value))} className="num rounded-control border px-1 text-right" style={{ width: 46, height: 26, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />×</span>
            <span className="flex items-center gap-1">{t("EV/Umsatz")}<input type="number" step={0.1} value={pxSaLo} onChange={(e) => setPxSaLo(Number(e.target.value))} className="num rounded-control border px-1 text-right" style={{ width: 46, height: 26, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />–<input type="number" step={0.1} value={pxSaHi} onChange={(e) => setPxSaHi(Number(e.target.value))} className="num rounded-control border px-1 text-right" style={{ width: 46, height: 26, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />×</span>
            <span className="flex items-center gap-1">LBO<input type="number" step={0.5} value={lboLo} onChange={(e) => setLboLo(Number(e.target.value))} className="num rounded-control border px-1 text-right" style={{ width: 46, height: 26, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />–<input type="number" step={0.5} value={lboHi} onChange={(e) => setLboHi(Number(e.target.value))} className="num rounded-control border px-1 text-right" style={{ width: 46, height: 26, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />×</span>
          </div>
        </div>
        <div className="px-4 py-3">
          {fball.methods.map((m, i) => {
            const span = fball.allHi - fball.allLo || 1;
            const left = ((m.lo - fball.allLo) / span) * 100, width = Math.max(1, ((m.hi - m.lo) / span) * 100);
            const mid = (m.lo + m.hi) / 2;
            return (
              <div key={i} className="flex items-center gap-3 py-1.5 text-[12px]">
                <div className="w-[230px] shrink-0 text-nx-text-secondary">{m.name}</div>
                <div className="relative h-6 flex-1">
                  <div className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded" style={{ left: `${left}%`, width: `${width}%`, background: "var(--nx-series)", opacity: 0.85 }} />
                  <div className="absolute top-0 flex h-full items-center text-[10px] num text-nx-text-muted" style={{ left: `calc(${left}% - 2px)`, transform: "translateX(-100%)" }}>{fmtMoney(m.lo)}</div>
                  <div className="absolute top-0 flex h-full items-center text-[10px] num text-nx-text-muted" style={{ left: `calc(${left + width}% + 4px)` }}>{fmtMoney(m.hi)}</div>
                </div>
                <div className="num w-[110px] shrink-0 text-right font-semibold">{fmtMoney(mid)}</div>
              </div>
            );
          })}
          <div className="mt-1 text-[11px] text-nx-text-muted">{t("Mittelwert je Methode rechts. Equity Value = EV − Net Debt (")}{fmtMoney(fball.nd)}{t(" €). Peer-Set: bewässerter Ackerbau + Verarbeitung (editierbar).")}</div>
        </div>
      </section>

      {/* Break-even / Downside */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}><h2 className="text-[14px] font-semibold">{t("Break-even & Downside — wann kippt der Equity-Value?")}</h2></div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)" }}>
          {[
            [t("Preis-Puffer bis Equity = 0"), fmtPct(fball.priceHaircut), t("Preisrückgang (alle Kulturen)")],
            [t("EBITDA-Puffer bis Equity = 0"), fmtPct(fball.ebitdaHaircut), t("EBITDA-Rückgang")],
            [t("Exit-Multiple-Boden"), fmtNumber(fball.exitMultBreak, 1) + "×", t("darunter Equity negativ")],
            [t("Impliziter EV/EBITDA (DCF)"), fmtNumber(fball.k, 1) + "×", t("aus DCF abgeleitet")],
          ].map(([k, v, s], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[16px] font-semibold" style={{ color: i < 2 ? (Number(String(v).replace(/[^\d.-]/g, "")) > 20 ? "var(--nx-success)" : "var(--nx-warning)") : "var(--nx-text)" }}>{v}</div>
              <div className="caption text-[9.5px] text-nx-text-muted">{s}</div>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 text-[11px] text-nx-text-muted">
          {t("Der Equity-Value fällt auf null, wenn die Verkaufspreise um ")}<b>{fmtPct(fball.priceHaircut)}</b>{t(" sinken (bzw. EBITDA um ")}{fmtPct(fball.ebitdaHaircut)}{t(") oder das Exit-Multiple unter ")}<b>{fmtNumber(fball.exitMultBreak, 1)}×</b>{t(" fällt — der Puffer misst die Downside-Resistenz für die Eigenkapitalgeber.")}
        </div>
      </section>

      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}><h2 className="text-[14px] font-semibold">{t("Projektion (FCFF)")}</h2></div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12.5px]">
            <thead><tr className="caption text-[10.5px] text-nx-text-muted">
              <th className="px-2 py-1.5 text-right">{t("Jahr")}</th><th className="px-2 py-1.5 text-right">{t("Fläche ha")}</th>
              <th className="px-2 py-1.5 text-right">EBITDA</th><th className="px-2 py-1.5 text-right">{t("AfA")}</th>
              <th className="px-2 py-1.5 text-right">CAPEX</th><th className="px-2 py-1.5 text-right">FCFF</th>
              <th className="px-2 py-1.5 text-right">{t("disk. FCFF")}</th></tr></thead>
            <tbody>
              {proj.rows.map((r) => (
                <tr key={r.y} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="num px-2 py-1.5 text-right">{r.y}</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-secondary">{fmtNumber(r.area, 0)}</td>
                  <td className="num px-2 py-1.5 text-right">{r.y === 0 ? "–" : fmtMoney(r.ebitda)}</td>
                  <td className="num px-2 py-1.5 text-right">{r.y === 0 ? "–" : fmtMoney(r.afa)}</td>
                  <td className="num px-2 py-1.5 text-right" style={{ color: r.capex > 0 ? "var(--nx-error)" : undefined }}>{r.capex > 0 ? "(" + fmtMoney(r.capex) + ")" : "–"}</td>
                  <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: r.fcff < 0 ? "var(--nx-error)" : "var(--nx-text)" }}>{r.fcff < 0 ? "(" + fmtMoney(-r.fcff) + ")" : fmtMoney(r.fcff)}</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-secondary">{r.disc < 0 ? "(" + fmtMoney(-r.disc) + ")" : fmtMoney(r.disc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}><h2 className="text-[14px] font-semibold">{t("Exit-Multiple-Sensitivität")}</h2></div>
        <div className="px-4 py-2">
          <table className="w-full text-[12.5px]">
            <thead><tr className="caption text-[10.5px] text-nx-text-muted"><th className="px-2 py-1.5 text-left">{t("Exit-Multiple")}</th><th className="px-2 py-1.5 text-right">Terminal Value</th><th className="px-2 py-1.5 text-right">NPV @ {wacc}%</th><th className="px-2 py-1.5 text-right">{t("Projekt-IRR")}</th></tr></thead>
            <tbody>
              {proj.sens.map((s) => (
                <tr key={s.m} style={{ borderTop: "1px solid var(--nx-border-divider)", fontWeight: s.m === exitM ? 700 : 400 }}>
                  <td className="num px-2 py-1.5">{s.m}× EBITDA</td>
                  <td className="num px-2 py-1.5 text-right">{fmtMoney(s.m * proj.ebitdaFinal)} €</td>
                  <td className="num px-2 py-1.5 text-right" style={{ color: s.npv >= 0 ? "var(--nx-success)" : "var(--nx-error)" }}>{fmtMoney(s.npv)} €</td>
                  <td className="num px-2 py-1.5 text-right">{isFinite(s.irr) ? fmtPct(s.irr) : "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Investoren-DCF auf den JAHRESWERTEN der Engine — dieselben Zahlen wie in GuV und Cashflow, kein zweiter Rechenweg und keine eigene Flächenannahme. FCFF = EBIT×(1−Steuer) + AfA − CAPEX, diskontiert mit dem oben berechneten WACC; Terminal Value als Exit-Multiple auf dem EBITDA des eingeschwungenen Endjahres.")}
        </div>
      </section>
    </div>
  );
}
