"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import { buildModelState, buildAnbauplan, STAGES, type Domain } from "../../store/model";
import { computeModel } from "../../core/engine";
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
  const [startHa, setStartHa] = React.useState(4000);
  const [endHa, setEndHa] = React.useState(20000);
  const [rampY, setRampY] = React.useState(8);
  const [horizon, setHorizon] = React.useState(10);

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
    // Basis: Stufe 1 (4.000 ha) → Per-ha-Kennzahlen (Cent)
    const d1: Domain = structuredClone(domain);
    d1.stage = 1; d1.anbauplan = buildAnbauplan(1);
    const cm = computeModel(buildModelState(d1, sc), sc, { outputGranularity: "month" });
    const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
    const area1 = STAGES["1"].beregneteFlaecheHa;
    // JAHRES-Per-ha (Cent): Summe über den Horizont ÷ Anzahl Jahre ÷ Fläche — NICHT kumuliert
    //  (sonst 8×-Überhöhung, wird in proj als Jahresrate × Fläche verwendet).
    const yrs = Math.max(1, cm.timeline.periodCount / 12);
    const ebitdaPerHa = sum(cm.pnl.ebitda.values) / yrs / area1;
    const ebitPerHa = sum(cm.pnl.ebit.values) / yrs / area1;
    const afaPerHa = sum(cm.pnl.depreciation.values) / yrs / area1;
    const capexPerHa = Math.abs(sum(cm.cashFlow.capex.values)) / yrs / area1;
    const revPerHa = sum(cm.pnl.revenue.values) / yrs / area1;
    const tax = readAssumption(domain, "tax.rate", sc) ?? 0.16;
    return { ebitdaPerHa, ebitPerHa, afaPerHa, capexPerHa, revPerHa, tax };
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
    const areaAt = (y: number) => y <= 0 ? startHa : Math.min(startHa + (endHa - startHa) * (y / rampY), endHa);
    const rows: { y: number; area: number; ebitda: number; afa: number; capex: number; fcff: number; disc: number }[] = [];
    const cf: number[] = [];
    // t0: Aufbau der Startflotte
    const initCapex = model.capexPerHa * startHa;
    cf.push(-initCapex);
    rows.push({ y: 0, area: startHa, ebitda: 0, afa: 0, capex: initCapex, fcff: -initCapex, disc: -initCapex });
    let prevArea = startHa;
    for (let y = 1; y <= horizon; y++) {
      const area = areaAt(y);
      const ebitda = model.ebitdaPerHa * area;
      const ebit = model.ebitPerHa * area;
      const afa = model.afaPerHa * area;
      const incrCapex = model.capexPerHa * Math.max(0, area - prevArea);
      const fcff = ebit * (1 - model.tax) + afa - incrCapex;
      prevArea = area;
      cf.push(fcff);
      rows.push({ y, area, ebitda, afa, capex: incrCapex, fcff, disc: fcff / Math.pow(1 + w, y) });
    }
    const ebitdaFinal = model.ebitdaPerHa * areaAt(horizon);
    const salesFinal = model.revPerHa * areaAt(horizon);
    const withTV = (m: number) => { const c = cf.slice(); c[horizon] += m * ebitdaFinal; return c; };
    const base = withTV(exitM);
    const npvBase = npv(base, w);
    const irrBase = irr(base);
    const tv = exitM * ebitdaFinal;
    const peak = cf.reduce((acc, _, i) => { const c = cf.slice(0, i + 1).reduce((a, b) => a + b, 0); return Math.min(acc, c); }, 0);
    const sens = [5, 7, 9].map((m) => { const c = withTV(m); return { m, npv: npv(c, w), irr: irr(c) }; });
    const totalCapex = rows.reduce((a, r) => a + r.capex, 0);

    // Investoren-Kennzahlen
    const pvOps = rows.filter((r) => r.y >= 1).reduce((a, r) => a + r.disc, 0) + tv / Math.pow(1 + w, horizon); // Enterprise Value (Ops)
    const ev = pvOps;
    const equityValue = ev - fin.netDebtNow;
    const entryEbitda = model.ebitdaPerHa * areaAt(1);
    const entrySales = model.revPerHa * areaAt(1);
    const evEbitda = entryEbitda > 0 ? ev / entryEbitda : 0;
    const evSales = entrySales > 0 ? ev / entrySales : 0;
    const nopatFinal = model.ebitPerHa * (1 - model.tax) * areaAt(horizon);
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
  }, [model, wacc, exitM, startHa, endHa, rampY, horizon, fin.netDebtNow]);

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
          <Num label={t("Start")} value={startHa} onChange={setStartHa} step={1000} suffix="ha" />
          <Num label={t("Ziel")} value={endHa} onChange={setEndHa} step={1000} suffix="ha" />
          <Num label={t("Ramp")} value={rampY} onChange={setRampY} suffix="J" />
          <Num label={t("Horizont")} value={horizon} onChange={setHorizon} suffix="J" />
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
          {t("Vereinfachter Investoren-DCF: Per-ha-Ökonomie aus dem Kern (Stufe 1) × Flächen-Ramp; FCFF = EBIT×(1−Steuer) + AfA − CAPEX. Kompendium-Skalierung (Blended-BE ~2.585 €/ha konstant). Für die volle 3-Statement-Bewertung liefert der Kern `computeValuation` (mehrjährige Konfiguration A).")}
        </div>
      </section>
    </div>
  );
}
