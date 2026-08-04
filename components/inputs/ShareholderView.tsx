"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import { buildModelState, START_YEAR } from "../../store/model";
import { computeModel } from "../../core/engine";
import {irr} from "../../design/finance";
import { fmtMoney, fmtNumber, fmtPct } from "../../design/format";
import { t } from "../../lib/i18n";
import { X } from "lucide-react";

const MIO = 1e8; // CENT je Mio €
function Num({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (n: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="flex items-center gap-2 text-[12px]">
      <span className="text-nx-text-secondary">{label}</span>
      <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="num rounded-control border px-2 text-right" style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600, height: 32, width: 84 }} />
      {suffix && <span className="text-[10.5px] text-nx-text-muted">{suffix}</span>}
    </label>
  );
}

/** Equity & Ausschüttung — Holding-Layer als FCFE: OpCo-Cash → Kapitaldienst → €-Mindestliquidität →
 *  Sweep als Dividende + Shareholder-Loan-Zins/Tilgung → Besteuerung in der deutschen Holding-GmbH
 *  (§ 8b KStG auf die Dividende, voller Satz auf den Zinsertrag) → Netto an Shareholder.
 *  Equity-IRR (levered, nach Schuldendienst) vs. Projekt-IRR (unlevered). */
export function ShareholderView() {
  const domain = useModelStore((s) => s.domain);
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);

  const [floor, setFloor] = React.useState(15);      // Mindestliquidität Mio €
  const [e0, setE0] = React.useState(60);            // Eigenkapital-Ticket Mio €
  const [shPct, setShPct] = React.useState(60);      // Anteil Shareholder Loan am EK %
  const [shRate, setShRate] = React.useState(6);     // SH-Loan-Zins %
  const [exitMult, setExitMult] = React.useState(7); // Exit-Multiple × EBITDA
  const [roWht, setRoWht] = React.useState(0);       // RO Quellensteuer Dividende % (0 via EU-Richtlinie)
  // DEUTSCHE HOLDING-GMBH statt Zypern (Entscheidung 30.07.2026). Der Zinsertrag aus dem
  // Gesellschafterdarlehen ist in der GmbH VOLL steuerpflichtig — rd. 29,8 % aus
  // Körperschaftsteuer, Solidaritätszuschlag und Gewerbesteuer. Vorher standen hier 12,5 %
  // zyprische KSt; das ist seit der Strukturentscheidung schlicht der falsche Satz und
  // schönte den Netto-Zufluss an die Gesellschafter um 17,3 Prozentpunkte.
  const [holdTax, setHoldTax] = React.useState(29.8);

  // Cap-Table — Finanzierungsrunden (Pre-/Post-Money, Verwässerung). Beträge Mio €.
  const [rounds, setRounds] = React.useState<{ id: string; name: string; pre: number; inv: number }[]>([
    { id: "seed", name: t("Gründung / Seed"), pre: 30, inv: 30 },
    { id: "a", name: "Series A", pre: 120, inv: 40 },
  ]);

  const A = React.useMemo(() => {
    const cm: any = computeModel(buildModelState(domain, sc), sc, { outputGranularity: "month" });
    const g = (o: any, k: string) => (o?.[k]?.values) ?? [];
    const pnl = cm.incomeStatement ?? cm.pnl, bs = cm.balanceSheet, cf = cm.cashFlow;
    const ebitda = g(pnl, "ebitda"), ebit = g(pnl, "ebit"), dep = g(pnl, "depreciation"), interest = g(pnl, "interest"), ni = g(pnl, "netIncome");
    const cfo = g(cf, "cfo"), cfi = g(cf, "cfi"), draw = g(cf, "debtDrawdowns"), repay = g(cf, "debtRepayments");
    const debt = g(bs, "debt"), revol = g(bs, "revolver"), cash = g(bs, "cash"), eq = g(bs, "totalEquity");
    const n = ebitda.length, nY = Math.ceil(n / 12);
    const tax = readAssumption(domain, "tax.rate", sc) ?? 0.16;
    const sum = (a: number[], y: number) => { let s = 0; for (let m = 0; m < 12; m++) s += a[y * 12 + m] ?? 0; return s; };
    const ye = (a: number[], y: number) => a[Math.min(n - 1, y * 12 + 11)] ?? 0;
    const rows = [];
    for (let y = 0; y < nY; y++) {
      const ebitdaY = sum(ebitda, y), ebitY = sum(ebit, y), depY = sum(dep, y), intY = sum(interest, y), niY = sum(ni, y);
      const cfoY = sum(cfo, y), cfiY = sum(cfi, y), drawY = sum(draw, y), repayY = sum(repay, y);
      const fcfe = cfoY + cfiY + drawY + repayY;                      // nach Kapitaldienst (Term-Debt), vor Revolver/Dividende
      const fcff = (ebitdaY - depY) * (1 - tax) + depY + cfiY;        // unlevered (cfiY negativ = Capex)
      const netDebt = ye(debt, y) + ye(revol, y) - ye(cash, y);
      const icr = intY !== 0 ? ebitY / Math.abs(intY) : Infinity;
      const roe = ye(eq, y) > 0 ? niY / ye(eq, y) : 0;
      // Der ECHTE Revolver der Engine, monatlich: die Augustspitze ist die Zahl, die zaehlt.
      //  Eine Jahresendbetrachtung zeigt 0, weil der Revolver bis Dezember zurueckgefuehrt ist —
      //  und laesst Ausschuettungen plausibel aussehen, die es nicht sind.
      let revPeak = 0;
      for (let m = 0; m < 12; m++) revPeak = Math.max(revPeak, Math.abs(revol[y * 12 + m] ?? 0));
      const dscrY = g(cm.kpis, "dscr")[Math.min(n - 1, y * 12 + 11)] ?? 0;
      const levY = ebitdaY > 0 ? netDebt / ebitdaY : Infinity;
      const kasseY = ye(cash, y);
      rows.push({ y, ebitdaY, ebitY, intY, niY, fcfe, fcff, netDebt, icr, roe, revPeak, dscrY, levY, kasseY });
    }
    return { rows, tax, nY };
  }, [domain, sc, tick]);

  const proj = React.useMemo(() => {
    const e0C = e0 * MIO;
    const shLoan0 = e0C * (shPct / 100);
    const nY = A.rows.length, exitY = nY - 1;
    // Revolver-bewusster Wasserfall: negativer FCFE = Aufbau-Funding (Revolver/Fremdkapital),
    // positiver FCFE tilgt erst den Revolver, dann SH-Zins → SH-Tilgung (Exit) → Dividende (Floor bleibt).
    let revolverBal = 0, shBal = shLoan0, distCum = 0, divCum = 0;
    const rows = A.rows.map((r, i) => {
      let net = r.fcfe, draw = 0, shInt = 0, shRepay = 0, dividend = 0;
      // COVENANT-SPERRE. Die Ansicht schuettete bisher jeden positiven Rest-FCFE aus, ohne
      //  DSCR oder Verschuldungsgrad anzusehen — obwohl die Engine beides liefert. In fuenf
      //  von acht Planjahren lag der Leverage ueber der Grenze und es floss trotzdem Geld
      //  nach oben. Kein Kreditvertrag laesst das zu.
      const covOk = r.dscrY >= 1.10 && r.levY <= 3.5;
      // MINDESTLIQUIDITAET. Der Regler stand da, wurde angezeigt und im Fliesstext erklaert —
      //  aber nirgends im Wasserfall benutzt. Jetzt sperrt er tatsaechlich: ausgeschuettet
      //  wird nur, was NACH dem Puffer und NACH Rueckfuehrung der Revolver-Spitze uebrig ist.
      const floorC = floor * MIO;
      if (net < 0) { draw = -net; revolverBal += draw; }
      else {
        const rr = Math.min(revolverBal, net); revolverBal -= rr; net -= rr;   // Revolver zuerst tilgen
        shInt = Math.min(net, shBal * (shRate / 100)); net -= shInt;           // SH-Loan-Zins
        if (i === exitY) { shRepay = Math.min(shBal, net); shBal -= shRepay; net -= shRepay; }
        // Ausschuettbar ist der Rest abzueglich Mindestliquiditaet; und nur, wenn die
        //  Covenants im selben Jahr halten und die Saison-Spitze des Revolvers gedeckt ist.
        const puffer = Math.max(0, r.kasseY - floorC);
        dividend = covOk ? Math.max(0, Math.min(net, puffer)) : 0;
        net -= dividend;
        if (dividend < net) revolverBal = Math.max(0, revolverBal);            // Rest bleibt im Betrieb
      }
      // § 8b KStG: Beteiligungserträge zu 95 % steuerfrei, die restlichen 5 % gelten als
      // nicht abziehbare Betriebsausgabe → effektive Belastung 5 % × Holding-Satz ≈ 1,5 %.
      // Das ist NICHT null, wie es die Zypern-Fassung unterstellte.
      const divNet = dividend * (1 - roWht / 100) * (1 - 0.05 * holdTax / 100);
      // Zinsen fallen NICHT unter die Mutter-Tochter-Richtlinie (die gilt für Dividenden),
      // sondern unter die Zins-/Lizenzrichtlinie — die RO-Dividenden-Quellensteuer gehört
      // hier nicht angewandt. Voll steuerpflichtig in der Holding.
      const intNet = shInt * (1 - holdTax / 100);
      const netToSh = divNet + intNet + shRepay;
      distCum += shInt + shRepay + dividend; divCum += dividend;
      return { ...r, shInt, shRepay, dividend, draw, revolverBal, netToSh };
    });
    // Exit-Equity-Value = Enterprise (Exit-Multiple × EBITDA) − Third-Party Net Debt (Residualwert für 100%-Eigner)
    const exitEbitda = A.rows[exitY]?.ebitdaY ?? 0;
    const exitNetDebt = A.rows[exitY]?.netDebt ?? 0;
    const exitEquity = Math.max(0, exitMult * exitEbitda - exitNetDebt);
    const eqCf = [-e0C, ...rows.map((r, i) => r.netToSh + (i === exitY ? exitEquity : 0))];
    const equityIrr = irr(eqCf);
    const totalIn = rows.reduce((a, r) => a + r.netToSh, 0) + exitEquity;
    const moic = e0C > 0 ? totalIn / e0C : 0;
    const dpi = e0C > 0 ? divCum / e0C : 0;
    const projCf = A.rows.map((r, i) => r.fcff + (i === exitY ? exitMult * exitEbitda : 0));
    const projectIrr = irr(projCf);
    return { rows, exitEquity, equityIrr, projectIrr, moic, dpi, divCum, distCum, e0C, exitEbitda, exitNetDebt };
  }, [A, floor, e0, shPct, shRate, exitMult, roWht, holdTax]);

  // Cap-Table: Ownership-Waterfall über die Runden
  const cap = React.useMemo(() => {
    let own: { holder: string; pct: number }[] = [{ holder: "Gründer / Management", pct: 1 }];
    const steps = rounds.map((r) => {
      const post = r.pre + r.inv;
      const newPct = post > 0 ? r.inv / post : 0;
      const dil = post > 0 ? r.pre / post : 1;
      own = own.map((h) => ({ ...h, pct: h.pct * dil }));
      const existing = own.find((h) => h.holder === r.name);
      if (existing) existing.pct += newPct; else own.push({ holder: r.name, pct: newPct });
      const founders = own.find((h) => h.holder.startsWith("Gründer"))?.pct ?? 0;
      return { name: r.name, pre: r.pre, inv: r.inv, post, newPct, foundersAfter: founders };
    });
    return { steps, finalOwn: own };
  }, [rounds]);
  const OWN_COL = ["#026634", "#009A17", "#95C11F", "#E8AB30", "#E8621A", "#C2A278"];

  const yr = (y: number) => START_YEAR + y;
  const kpi = (cap: string, val: string, tone?: string, sub?: string) => (
    <div className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
      <div className="caption text-[10px] text-nx-text-muted">{cap}</div>
      <div className="num text-[17px] font-bold leading-tight" style={{ color: tone ?? "var(--nx-text)" }}>{val}</div>
      {sub && <div className="caption text-[9.5px] text-nx-text-muted">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Struktur + Inputs */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Equity & Ausschüttung — Holding-Layer (FCFE)")}</h2>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border-divider)" }}>
          <Num label={t("Mindestliquidität")} value={floor} onChange={setFloor} suffix="Mio €" />
          <Num label={t("Eigenkapital-Ticket")} value={e0} onChange={setE0} step={5} suffix="Mio €" />
          <Num label={t("davon Shareholder Loan")} value={shPct} onChange={setShPct} step={5} suffix="%" />
          <Num label={t("SH-Loan-Zins")} value={shRate} onChange={setShRate} step={0.5} suffix="%" />
          <Num label={t("Exit-Multiple")} value={exitMult} onChange={setExitMult} suffix="× EBITDA" />
          <Num label={t("RO-Quellensteuer Div.")} value={roWht} onChange={setRoWht} step={1} suffix="%" />
          <Num label={t("DE-Holding KSt+GewSt")} value={holdTax} onChange={setHoldTax} step={0.5} suffix="%" />
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-6" style={{ background: "var(--nx-border-divider)" }}>
          {kpi("Equity-IRR (levered)", isFinite(proj.equityIrr) ? fmtPct(proj.equityIrr) : "n/a", proj.equityIrr >= 0.15 ? "var(--nx-success)" : "var(--nx-text)", t("nach Schuldendienst"))}
          {kpi(t("Projekt-IRR (unlevered)"), isFinite(proj.projectIrr) ? fmtPct(proj.projectIrr) : "n/a", undefined, t("FCFF-Basis"))}
          {kpi("Equity MoIC", fmtNumber(proj.moic, 2) + "×", undefined, "cash-on-cash")}
          {kpi(t("DPI (Ausschüttung/EK)"), fmtNumber(proj.dpi, 2) + "×", undefined, t("laufende Divid."))}
          {kpi("Exit-Equity-Value", fmtMoney(proj.exitEquity) + " €", undefined, `${exitMult}× EBITDA − Net Debt`)}
          {kpi("Σ Upstream Holding", fmtMoney(proj.distCum) + " €", "var(--nx-brand-lift)", t("Div.+Zins+Tilgung"))}
        </div>
        <div className="px-4 py-2 text-[11px] text-nx-text-muted">
          <b>{t("Struktur:")}</b>{t(" OpCo (RO) erwirtschaftet FCFE → Mindestliquidität ")}{floor}{t(" Mio € bleibt, Überschuss wird hochgeschleust: zuerst Shareholder-Loan-Zins (bei OpCo abzugsfähig), dann SH-Tilgung (Exit), dann Dividende. RO-Quellensteuer ")}{roWht}{t(" % (EU-Mutter-Tochter-Richtlinie → i.d.R. 0 %). Deutsche Holding-GmbH: Dividende nach ")}<b>{t("§ 8b KStG")}</b>{t(" zu 95 % steuerfrei → effektiv 5 % × ")}{holdTax}{t(" %; Zinsertrag voll steuerpflichtig mit ")}{holdTax}{t(" %. Equity-IRR = Rendite auf das eingesetzte EK inkl. Zeichnung (t0), laufender Ausschüttung und Exit-Erlös.")}
        </div>
      </section>

      {/* Ausschüttungs-Wasserfall */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}><h2 className="text-[14px] font-semibold">{t("Ausschüttungs-Wasserfall & FCFE (je Jahr)")}</h2></div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead><tr className="caption text-[10px] text-nx-text-muted">
              <th className="px-2 py-1.5 text-right">{t("Jahr")}</th><th className="px-2 py-1.5 text-right">EBITDA</th>
              <th className="px-2 py-1.5 text-right">FCFE</th><th className="px-2 py-1.5 text-right">{t("Aufbau-Funding")}</th>
              <th className="px-2 py-1.5 text-right">{t("Revolver-Saldo")}</th>
              <th className="px-2 py-1.5 text-right">{t("SH-Zins")}</th><th className="px-2 py-1.5 text-right">{t("SH-Tilgung")}</th>
              <th className="px-2 py-1.5 text-right">{t("Dividende")}</th>
              <th className="px-2 py-1.5 text-right">{t("Netto → Shareholder")}</th></tr></thead>
            <tbody>
              {proj.rows.map((r) => (
                <tr key={r.y} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="num px-2 py-1.5 text-right">{yr(r.y)}</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-secondary">{fmtMoney(r.ebitdaY)}</td>
                  <td className="num px-2 py-1.5 text-right" style={{ color: r.fcfe < 0 ? "var(--nx-error)" : "var(--nx-text)" }}>{r.fcfe < 0 ? "(" + fmtMoney(-r.fcfe) + ")" : fmtMoney(r.fcfe)}</td>
                  <td className="num px-2 py-1.5 text-right" style={{ color: r.draw > 0 ? "var(--nx-warning)" : "var(--nx-text-muted)" }}>{r.draw > 0 ? fmtMoney(r.draw) : "–"}</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtMoney(r.revolverBal)}</td>
                  <td className="num px-2 py-1.5 text-right">{r.shInt > 0 ? fmtMoney(r.shInt) : "–"}</td>
                  <td className="num px-2 py-1.5 text-right">{r.shRepay > 0 ? fmtMoney(r.shRepay) : "–"}</td>
                  <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: r.dividend > 0 ? "var(--nx-success)" : "var(--nx-text-muted)" }}>{r.dividend > 0 ? fmtMoney(r.dividend) : "–"}</td>
                  <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{fmtMoney(r.netToSh)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("FCFE = operativer + investiver Cashflow + Netto-Term-Debt (nach Kapitaldienst, vor Revolver). Negativer FCFE in der Aufbauphase = Kapitalbedarf (EK-Nachschuss / bereits über Fremdkapital gedeckt). Ausschüttung erst, wenn der Puffer über ")}{floor}{t(" Mio € liegt.")}
        </div>
      </section>

      {/* Coverage / ROE über die Zeit */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}><h2 className="text-[14px] font-semibold">{t("Deckung & Rendite im Zeitverlauf")}</h2></div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead><tr className="caption text-[10px] text-nx-text-muted">
              <th className="px-2 py-1.5 text-left">{t("Kennzahl")}</th>{proj.rows.map((r) => <th key={r.y} className="px-2 py-1.5 text-right">{yr(r.y)}</th>)}</tr></thead>
            <tbody>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-nx-text-secondary">{t("ICR (EBIT/Zins)")}</td>
                {proj.rows.map((r) => <td key={r.y} className="num px-2 py-1.5 text-right" style={{ color: r.icr >= 2 ? "var(--nx-success)" : r.icr >= 1 ? "var(--nx-warning)" : "var(--nx-error)" }}>{isFinite(r.icr) ? fmtNumber(r.icr, 1) + "×" : "∞"}</td>)}
              </tr>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-nx-text-secondary">{t("ROE (NI/EK)")}</td>
                {proj.rows.map((r) => <td key={r.y} className="num px-2 py-1.5 text-right">{fmtNumber(r.roe * 100, 1)} %</td>)}
              </tr>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-nx-text-secondary">Net Debt</td>
                {proj.rows.map((r) => <td key={r.y} className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtMoney(r.netDebt)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Cap-Table / Ownership */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Cap-Table & Ownership — Verwässerung über die Runden")}</h2>
          <button className="rounded-control border px-3 text-[12px] font-semibold" style={{ height: 32, borderColor: "var(--nx-brand-lift)", color: "var(--nx-brand-lift)", background: "var(--nx-surface)" }}
            onClick={() => setRounds((r) => [...r, { id: "r" + (r.length + 1), name: t("Runde ") + (r.length + 1), pre: 200, inv: 50 }])}>{t("+ Runde")}</button>
        </div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead><tr className="caption text-[10px] text-nx-text-muted">
              <th className="px-2 py-1.5 text-left">{t("Runde")}</th><th className="px-2 py-1.5 text-right">Pre-Money</th>
              <th className="px-2 py-1.5 text-right">Investment</th><th className="px-2 py-1.5 text-right">Post-Money</th>
              <th className="px-2 py-1.5 text-right">{t("Neuer Anteil")}</th><th className="px-2 py-1.5 text-right">{t("Gründer danach")}</th><th /></tr></thead>
            <tbody>
              {rounds.map((r, i) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5"><input value={r.name} onChange={(e) => setRounds((a) => a.map((x) => x.id === r.id ? { ...x, name: e.target.value } : x))} className="rounded-control border px-2 text-[12px]" style={{ height: 28, width: 150, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} /></td>
                  <td className="px-2 py-1.5 text-right"><input type="number" value={r.pre} onChange={(e) => setRounds((a) => a.map((x) => x.id === r.id ? { ...x, pre: Number(e.target.value) } : x))} className="num rounded-control border px-1 text-right" style={{ width: 72, height: 28, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} /></td>
                  <td className="px-2 py-1.5 text-right"><input type="number" value={r.inv} onChange={(e) => setRounds((a) => a.map((x) => x.id === r.id ? { ...x, inv: Number(e.target.value) } : x))} className="num rounded-control border px-1 text-right" style={{ width: 72, height: 28, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} /></td>
                  <td className="num px-2 py-1.5 text-right font-semibold">{fmtNumber(cap.steps[i].post, 0)}</td>
                  <td className="num px-2 py-1.5 text-right">{fmtNumber(cap.steps[i].newPct * 100, 1)} %</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-secondary">{fmtNumber(cap.steps[i].foundersAfter * 100, 1)} %</td>
                  <td className="px-2 py-1.5 text-right"><button className="text-[12px] text-nx-error" onClick={() => setRounds((a) => a.filter((x) => x.id !== r.id))}><X size={13} strokeWidth={2.5} aria-hidden /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Ownership-Bar + Exit-Verteilung */}
        <div className="px-4 py-3 border-t" style={{ borderColor: "var(--nx-border-divider)" }}>
          <div className="mb-1 caption text-[10px] text-nx-text-muted">{t("Ownership nach letzter Runde · Exit-Equity ")}{fmtMoney(proj.exitEquity)} €</div>
          <div className="flex h-7 w-full overflow-hidden rounded-control" style={{ background: "var(--nx-surface-sunken)" }}>
            {cap.finalOwn.map((h, i) => <div key={i} style={{ width: `${h.pct * 100}%`, background: OWN_COL[i % OWN_COL.length] }} title={`${h.holder} ${fmtNumber(h.pct * 100, 1)} %`} />)}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
            {cap.finalOwn.map((h, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                <span style={{ width: 10, height: 10, borderRadius: 3, background: OWN_COL[i % OWN_COL.length] }} />
                {t(h.holder)} <b className="num">{fmtNumber(h.pct * 100, 1)} %</b>
                <span className="text-nx-text-muted num">→ Exit {fmtMoney(h.pct * proj.exitEquity)} €</span>
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
