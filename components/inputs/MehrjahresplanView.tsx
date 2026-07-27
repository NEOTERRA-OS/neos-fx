"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { NumberInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { cropStructure, type CropRow } from "./cropCalc";
import { effectiveGrowth } from "../../store/model";
import { t } from "../../lib/i18n";

const START_YEAR = 2026;

/** Wachstum — EINE konsolidierte Sicht (über ha, keine Stufen):
 *  Akquiseprofil (Deals) → Flächen-Ramp (editierbar) → Wachstums-CAPEX (Beregnungsausbau + Zukauf
 *  je Deal, mit Finanzierung FK/EK). Alles fließt verdrahtet in Bilanz/Cashflow/Covenants. */
export function MehrjahresplanView() {
  const { domain, patch, view } = useModelStore();
  const sc = view.scenarioId;
  const g = domain.growth;
  if (!g) return <div className="text-[12px] text-nx-text-muted">{t("Kein Wachstumsplan konfiguriert.")}</div>;

  const stage = g.stage ?? "s3b";
  const isRamp = stage === "s3b"; // nur Stufe 3b: Flächen & Akquiseprofil editierbar
  // Effektive Flächenkurve nach aktiver Stufe (s1 flach, s2 Vollberegnung, s3b Ramp).
  const eg = effectiveGrowth(g) ?? g;
  const years = g.years;
  const irr = (y: number) => eg.areaByYear[y] ?? 0;
  const tot = (y: number) => eg.totalByYear?.[y] ?? irr(y);
  const dry = (y: number) => Math.max(0, tot(y) - irr(y));
  const irrCapex = g.irrigEurPerHaCent ?? 0;
  const startTot = g.startTotalHa ?? tot(0);
  const startIrr = g.startIrrigatedHa ?? irr(0);
  const dIrr = (y: number) => Math.max(0, irr(y) - (y > 0 ? irr(y - 1) : startIrr));

  const setIrr = (y: number, v: number) => patch((d) => { if (d.growth) d.growth.areaByYear[y] = Math.max(0, Math.round(v)); });
  const setTot = (y: number, v: number) => patch((d) => { if (d.growth) { const t = d.growth.totalByYear ?? d.growth.areaByYear.slice(); t[y] = Math.max(0, Math.round(v)); d.growth.totalByYear = t; } });
  const setG = (fn: (gp: any) => void) => patch((d) => { if (d.growth) fn(d.growth); });
  const setStage = (s: "s1" | "s2" | "s3b") => patch((d) => { if (d.growth) d.growth.stage = s; });
  const STAGES: { id: "s1" | "s2" | "s3b"; label: string; desc: string }[] = [
    { id: "s1", label: t("Stufe 1 · Status Quo"), desc: t("heute — kein Flächenwachstum, keine Beregnungserweiterung") },
    { id: "s2", label: t("Stufe 2 · Vollberegnung"), desc: t("gesamte Betriebsfläche unter Beregnung, kein Flächenzukauf") },
    { id: "s3b", label: t("Stufe 3b · Flächen-Ramp"), desc: t("Akquiseprofil — Zukauf & Beregnungsausbau bis Ziel") },
  ];

  // Akquiseprofil (Deals) — treiben Fläche + CAPEX
  const deals = g.acquisitions ?? [];
  const priceOf = (d: any) => d.totalHa * d.eurPerHaCent;
  const investOf = (d: any) => priceOf(d) + (d.dealType === "asset" ? d.machineValueCent : 0);
  const setDeals = (fn: (arr: any[]) => any[]) => patch((d) => { if (d.growth) d.growth.acquisitions = fn(d.growth.acquisitions ?? []); });
  const applyToRamp = () => patch((d) => {
    if (!d.growth) return;
    const st = d.growth.startTotalHa ?? startTot, si = d.growth.startIrrigatedHa ?? startIrr;
    const cum = (y: number, key: "totalHa" | "irrHa") => (d.growth!.acquisitions ?? []).filter((x) => x.year <= y).reduce((s, x) => s + (x as any)[key], 0);
    d.growth.totalByYear = Array.from({ length: years }, (_, y) => Math.round(st + cum(y, "totalHa")));
    d.growth.areaByYear = Array.from({ length: years }, (_, y) => Math.max(irr(y), Math.round(si + cum(y, "irrHa"))));
  });

  // CAPEX je Jahr — aus den STUFEN-effektiven Deals (in s1/s2 leer) + Beregnungsausbau.
  //  Editor zeigt weiterhin die Roh-Deals (gehören zu Stufe 3b); die Rechnung nutzt eg.
  const egDeals = eg.acquisitions ?? [];
  const dealsIn = (y: number) => egDeals.filter((d) => Math.round(d.year) === y);
  const assetLandY = (y: number) => dealsIn(y).filter((d) => d.dealType === "asset").reduce((s, d) => s + priceOf(d), 0);
  const leaseAbY = (y: number) => dealsIn(y).filter((d) => d.dealType === "lease").reduce((s, d) => s + priceOf(d), 0);
  const machineryY = (y: number) => dealsIn(y).filter((d) => d.dealType === "asset").reduce((s, d) => s + d.machineValueCent, 0);
  // Eigene Neu-Beregnung (ohne übernommene, bereits beregnete ha aus Deals) — keine Doppelzählung.
  const dealIrrIn = (y: number) => dealsIn(y).reduce((s, d) => s + (d.irrHa ?? 0), 0);
  const dOwnIrr = (y: number) => Math.max(0, dIrr(y) - dealIrrIn(y));
  const beregY = (y: number) => dOwnIrr(y) * irrCapex;
  const acqInvestY = (y: number) => assetLandY(y) + leaseAbY(y) + machineryY(y);
  const debtY = (y: number) => dealsIn(y).reduce((s, d) => s + investOf(d) * (d.debtShare ?? 0), 0);
  const totalCapexY = (y: number) => beregY(y) + acqInvestY(y);
  const eqY = (y: number) => acqInvestY(y) - debtY(y);
  const sum = (f: (y: number) => number) => { let s = 0; for (let y = 0; y < years; y++) s += f(y); return s; };
  const sumBereg = sum(beregY), sumAssetLand = sum(assetLandY), sumLeaseAb = sum(leaseAbY), sumMach = sum(machineryY);
  const sumCapex = sum(totalCapexY), sumDebt = sum(debtY), sumEq = sum(eqY);
  const leaseRentYr = deals.filter((d) => d.dealType === "lease").reduce((s, d) => s + d.totalHa * (d.leaseRentPerHaCent ?? 30000), 0);

  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";
  const Y = Array.from({ length: years }, (_, y) => y);
  const kpi: [string, string, string?][] = [
    [t("Heute"), `${fmtNumber(startTot, 0)} ha · ${fmtNumber(startIrr, 0)} ${t("beregnet")}`],
    [`${t("Ziel")} ${START_YEAR + years - 1}`, `${fmtNumber(tot(years - 1), 0)} ha · ${fmtNumber(irr(years - 1), 0)} ${t("beregnet")}`],
    [t("Σ Wachstums-CAPEX"), `${fmtMoney(sumCapex)} €`, "var(--nx-locate)"],
    [t("davon FK / EK"), `${fmtMoney(sumDebt)} / ${fmtMoney(sumEq + sumBereg)} €`, "var(--nx-brand-lift)"],
  ];

  return (
    <div className="space-y-4">
      {/* Wachstumsstufe — 3 Szenarien der Flächenstrategie (s1/s2/s3b) */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Wachstumsstufe (Szenario der Flächenstrategie)")}</h2>
          <p className="text-[11px] text-nx-text-muted mt-0.5">{t("Treibt Umsatz, OpEx, CAPEX, Finanzierung & Covenants im gesamten Modell — jede Stufe ist voll durchgerechnet.")}</p>
        </div>
        <div className="grid grid-cols-1 gap-px sm:grid-cols-3" style={{ background: "var(--nx-border-divider)" }}>
          {STAGES.map((s) => {
            const on = stage === s.id;
            return (
              <button key={s.id} onClick={() => setStage(s.id)} className="px-4 py-3 text-left"
                style={{ background: on ? "var(--nx-green)" : "var(--nx-surface)", color: on ? "#fff" : "var(--nx-text)" }}>
                <div className="text-[12.5px] font-semibold">{s.label}</div>
                <div className="text-[11px] mt-0.5" style={{ color: on ? "rgba(255,255,255,.82)" : "var(--nx-text-muted)" }}>{s.desc}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Akquiseprofil — Deals treiben Fläche & CAPEX (nur Stufe 3b relevant) */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Wachstum — Akquiseprofil, Fläche & Investitionsbedarf")}</h2>
          {isRamp && (
            <div className="flex items-center gap-2">
              <button className="rounded-control border px-2 text-[11px] font-semibold" style={{ height: 30, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }}
                onClick={() => setDeals((a) => [...a, { id: "d" + (a.length + 1) + "-" + a.reduce((s, x) => s + x.totalHa, 0), year: Math.min(years - 1, 3), name: "Übernahme " + (a.length + 1), dealType: "asset", totalHa: 3000, irrHa: 1500, eurPerHaCent: 250000, machineValueCent: 400000000, debtShare: 0.6 }])}>{t("+ Übernahme")}</button>
              <button className="rounded-control border px-2 text-[11px] font-semibold" style={{ height: 30, borderColor: "var(--nx-brand-lift)", color: "var(--nx-brand-lift)", background: "var(--nx-surface)" }} title={t("Fläche aus heute + Akquisitionen ableiten")} onClick={applyToRamp}>{t("↧ In Flächen-Ramp übernehmen")}</button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)" }}>
          {kpi.map(([k, v, c], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[13px] font-semibold" style={{ color: c ?? "var(--nx-text)" }}>{v}</div>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead><tr className="caption text-[10px] text-nx-text-muted">
              <th className="px-2 py-1.5 text-left">{t("Betrieb")}</th><th className="px-2 py-1.5 text-left">{t("Modus")}</th><th className="px-2 py-1.5 text-right">{t("Jahr")}</th>
              <th className="px-2 py-1.5 text-right">{t("ha gesamt")}</th><th className="px-2 py-1.5 text-right">{t("beregnet")}</th>
              <th className="px-2 py-1.5 text-right">€/ha</th><th className="px-2 py-1.5 text-right">{t("Preis")}</th>
              <th className="px-2 py-1.5 text-right">{t("Maschinen / Pacht")}</th><th className="px-2 py-1.5 text-right">{t("FK")}</th><th /></tr></thead>
            <tbody>
              {deals.map((d, i) => {
                const isLease = d.dealType === "lease";
                return (
                  <tr key={d.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                    <td className="px-2 py-1.5"><input value={d.name} onChange={(e) => setDeals((a) => a.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className="rounded-control border px-2 text-[12px]" style={{ height: 28, width: 130, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} /></td>
                    <td className="px-2 py-1.5">
                      <select value={d.dealType} onChange={(e) => setDeals((a) => a.map((x, j) => j === i ? { ...x, dealType: e.target.value, eurPerHaCent: e.target.value === "lease" ? 50000 : 250000, machineValueCent: e.target.value === "lease" ? 0 : x.machineValueCent } : x))}
                        className="rounded-control border px-1 text-[11px]" style={{ height: 28, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: isLease ? "var(--nx-warning)" : "var(--nx-locate)" }}>
                        <option value="lease">{t("Pacht-Übernahme")}</option><option value="asset">{t("Betriebskauf")}</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-right"><NumberInput value={d.year} width={44} onCommit={(n) => setDeals((a) => a.map((x, j) => j === i ? { ...x, year: Math.max(0, Math.min(years - 1, Math.round(n))) } : x))} /></td>
                    <td className="px-2 py-1.5 text-right"><NumberInput value={d.totalHa} width={66} onCommit={(n) => setDeals((a) => a.map((x, j) => j === i ? { ...x, totalHa: Math.max(0, Math.round(n)) } : x))} /></td>
                    <td className="px-2 py-1.5 text-right"><NumberInput value={d.irrHa} width={62} onCommit={(n) => setDeals((a) => a.map((x, j) => j === i ? { ...x, irrHa: Math.max(0, Math.min(d.totalHa, Math.round(n))) } : x))} /></td>
                    <td className="px-2 py-1.5 text-right"><NumberInput value={d.eurPerHaCent} moneyCent width={72} onCommit={(n) => setDeals((a) => a.map((x, j) => j === i ? { ...x, eurPerHaCent: Math.max(0, Math.round(n)) } : x))} /></td>
                    <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtMoney(priceOf(d))}</td>
                    <td className="px-2 py-1.5 text-right">
                      {isLease
                        ? <span className="inline-flex items-center gap-1 text-[11px] text-nx-text-muted">{t("Pacht")} <NumberInput value={d.leaseRentPerHaCent ?? 30000} moneyCent width={58} onCommit={(n) => setDeals((a) => a.map((x, j) => j === i ? { ...x, leaseRentPerHaCent: Math.max(0, Math.round(n)) } : x))} /> €/ha</span>
                        : <NumberInput value={d.machineValueCent} moneyCent width={88} onCommit={(n) => setDeals((a) => a.map((x, j) => j === i ? { ...x, machineValueCent: Math.max(0, Math.round(n)) } : x))} />}
                    </td>
                    <td className="px-2 py-1.5 text-right"><NumberInput value={(d.debtShare ?? 0) * 100} width={50} suffix="%" onCommit={(n) => setDeals((a) => a.map((x, j) => j === i ? { ...x, debtShare: Math.max(0, Math.min(1, n / 100)) } : x))} /></td>
                    <td className="px-2 py-1.5 text-right"><button className="text-[12px] text-nx-error" onClick={() => setDeals((a) => a.filter((_, j) => j !== i))}>✕</button></td>
                  </tr>
                );
              })}
              {!deals.length && <tr><td colSpan={10} className="px-2 py-3 text-center text-[11px] text-nx-text-muted">{t("Keine Übernahmen — „+ Übernahme\".")}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {isRamp
            ? <><b style={{ color: "var(--nx-warning)" }}>{t("Pacht-Übernahme")}</b> {t("(~500 €/ha Ablöse, asset-light → laufende Pacht")} {fmtMoney(leaseRentYr)} {t("€/J) vs.")} <b style={{ color: "var(--nx-locate)" }}>{t("Betriebskauf")}</b> {t("(2.000–3.000 €/ha → Land+Gebäude + Maschinen-Zeitwert). FK = Akquisitionskredit-Anteil je Deal. „In Flächen-Ramp übernehmen\" leitet die Fläche aus heute + Akquisitionen ab.")}</>
            : <>{t("Das Akquiseprofil gehört zu")} <b style={{ color: "var(--nx-brand-lift)" }}>{t("Stufe 3b")}</b> {t("und ist in der aktiven Stufe inaktiv (Σ Zukauf-CAPEX = 0). Zum Bearbeiten auf Stufe 3b wechseln.")}</>}
        </div>
      </section>

      {/* Flächen-Ramp — in s3b editierbar, sonst aus der Stufe abgeleitet */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Flächen-Ramp (ha je Jahr")}{isRamp ? t(" — editierbar") : t(" — aus Stufe abgeleitet")})</h3>
        </div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead><tr><th className={th + " text-left"}>{t("Position")}</th>{Y.map((y) => <th key={y} className={th + " text-right"}>{START_YEAR + y}</th>)}</tr></thead>
            <tbody>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-nx-text-secondary font-semibold">{t("Gesamtfläche")}</td>
                {Y.map((y) => <td key={y} className="px-2 py-1.5 text-right">{isRamp ? <NumberInput value={tot(y)} width={66} onCommit={(v) => setTot(y, v)} /> : <span className="num">{fmtNumber(tot(y), 0)}</span>}</td>)}
              </tr>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5" style={{ color: "var(--nx-brand-lift)" }}>{t("· davon beregnet")}</td>
                {Y.map((y) => <td key={y} className="px-2 py-1.5 text-right">{isRamp ? <NumberInput value={irr(y)} width={66} onCommit={(v) => setIrr(y, v)} /> : <span className="num" style={{ color: "var(--nx-brand-lift)" }}>{fmtNumber(irr(y), 0)}</span>}</td>)}
              </tr>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-nx-text-muted">{t("· davon unberegnet")}</td>
                {Y.map((y) => <td key={y} className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtNumber(dry(y), 0)}</td>)}
              </tr>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-nx-text-muted">{t("Beregnungsgrad")}</td>
                {Y.map((y) => <td key={y} className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtNumber(tot(y) > 0 ? (irr(y) / tot(y)) * 100 : 0, 0)}%</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Wachstums-CAPEX — Beregnungsausbau + Akquiseprofil, mit Finanzierung */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Wachstums-CAPEX (Investitionsbedarf je Jahr)")}</h3>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-nx-text-muted">{t("Beregnung €/ha")}
            <NumberInput value={irrCapex} moneyCent width={84} onCommit={(v) => setG((gp) => { gp.irrigEurPerHaCent = Math.max(0, Math.round(v)); })} /></label>
        </div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead><tr><th className={th + " text-left"}>{t("Position")}</th>{Y.map((y) => <th key={y} className={th + " text-right"}>{START_YEAR + y}</th>)}<th className={th + " text-right"}>Σ</th></tr></thead>
            <tbody>
              <Row label={t("Δ beregnet (ha)")} y={Y} f={dIrr} muted num0 />
              <Row label={t("Beregnungsausbau (Pivot)")} y={Y} f={beregY} sum={sumBereg} color="var(--nx-brand-lift)" />
              <Row label={t("Betriebskauf — Land/Gebäude")} y={Y} f={assetLandY} sum={sumAssetLand} color="var(--nx-locate)" />
              <Row label={t("Pacht-Übernahme — Ablöse")} y={Y} f={leaseAbY} sum={sumLeaseAb} color="var(--nx-warning)" />
              <Row label={t("Betriebskauf — Maschinen (Zeitwert)")} y={Y} f={machineryY} sum={sumMach} color="var(--nx-success)" />
              <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                <td className="px-2 py-2 font-semibold">{t("Σ Wachstums-CAPEX")}</td>
                {Y.map((y) => <td key={y} className="num px-2 py-2 text-right font-semibold">{totalCapexY(y) ? fmtMoney(totalCapexY(y)) : "–"}</td>)}
                <td className="num px-2 py-2 text-right font-semibold">{fmtMoney(sumCapex)}</td>
              </tr>
              <Row label={t("davon Fremdkapital (Akquisitionskredit)")} y={Y} f={debtY} sum={sumDebt} color="var(--nx-locate)" muted />
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-nx-text-muted">{t("davon Eigenmittel / Cash")}</td>
                {Y.map((y) => { const e = eqY(y) + beregY(y); return <td key={y} className="num px-2 py-1.5 text-right text-nx-text-muted">{e ? fmtMoney(e) : "–"}</td>; })}
                <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{fmtMoney(sumEq + sumBereg)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Voll verdrahtet:")} <b>{t("Betriebskauf")}</b> {t("→ Land (keine AfA) + Maschinen (AfA) als Bilanz-Asset;")} <b>{t("Pacht-Übernahme")}</b> {t("→ Ablöse (immateriell) + laufende Pacht im OpEx;")} <b>{t("Beregnungsausbau")}</b> {t("→ Pivot-Asset (AfA). Finanzierung je Deal über Akquisitionskredit (FK) + Eigenmittel — schlägt in Bilanz, Cashflow und Covenants durch.")}
        </div>
      </section>

      {/* Anbaustruktur & Produktion — Flächenentwicklung → Kulturen (ha) & Erntemenge (t) */}
      <AnbauMatrix Y={Y} irrByYear={Y.map(irr)} dryByYear={Y.map(dry)} domain={domain} sc={sc} />
    </div>
  );
}

/** Anbaustruktur (ha) & Produktion (t) je Kultur über die Wachstumsjahre.
 *  Beregneter Block skaliert mit der Beregnungsfläche (Anbauplan-Anteile),
 *  unberegneter Block mit der Trockenfläche (Trockenrotation). */
function AnbauMatrix({ Y, irrByYear, dryByYear, domain, sc }: { Y: number[]; irrByYear: number[]; dryByYear: number[]; domain: any; sc: string }) {
  const [mode, setMode] = React.useState<"ha" | "t">("ha");
  const structByYear = Y.map((y) => cropStructure(domain, sc, irrByYear[y], dryByYear[y]));
  const keyOf = (r: CropRow) => r.cropId + "|" + (r.dry ? 1 : 0);
  // stabile Zeilenliste aus dem letzten Jahr (alle Kulturen sicher vorhanden)
  const last = structByYear[structByYear.length - 1];
  const keys = last.map((r) => ({ key: keyOf(r), name: r.name, color: r.color, dry: r.dry }));
  const cell = (y: number, key: string) => structByYear[y].find((r) => keyOf(r) === key);
  const val = (r?: CropRow) => !r ? 0 : mode === "ha" ? r.ha : r.tonnes;
  const fmt = (v: number) => v ? fmtNumber(v, 0) : "–";
  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";
  const sumRow = (dry: boolean, y: number) => structByYear[y].filter((r) => r.dry === dry).reduce((s, r) => s + val(r), 0);
  const grand = (y: number) => structByYear[y].reduce((s, r) => s + val(r), 0);

  const Block = ({ dry, label }: { dry: boolean; label: string }) => (
    <>
      <tr style={{ background: "var(--nx-app-bg)" }}>
        <td className="px-2 py-1 caption text-[10px] font-semibold" style={{ color: dry ? "var(--nx-text-muted)" : "var(--nx-brand-lift)" }} colSpan={Y.length + 2}>{label}</td>
      </tr>
      {keys.filter((k) => k.dry === dry).map((k) => (
        <tr key={k.key} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
          <td className="px-2 py-1.5">
            <span className="inline-flex items-center gap-2">
              <span style={{ width: 9, height: 9, borderRadius: 2, background: k.color, display: "inline-block" }} />
              {k.name}{dry ? t(" ·  unber.") : ""}
            </span>
          </td>
          {Y.map((y) => <td key={y} className="num px-2 py-1.5 text-right" style={{ color: "var(--nx-text)" }}>{fmt(val(cell(y, k.key)))}</td>)}
          <td className="num px-2 py-1.5 text-right font-semibold">{fmt(val(cell(Y.length - 1, k.key)))}</td>
        </tr>
      ))}
      <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
        <td className="px-2 py-1.5 text-[11px] font-semibold" style={{ color: dry ? "var(--nx-text-muted)" : "var(--nx-brand-lift)" }}>Σ {dry ? t("unberegnet") : t("beregnet")}</td>
        {Y.map((y) => <td key={y} className="num px-2 py-1.5 text-right font-semibold" style={{ color: dry ? "var(--nx-text-muted)" : "var(--nx-brand-lift)" }}>{fmt(sumRow(dry, y))}</td>)}
        <td className="num px-2 py-1.5 text-right font-semibold">{fmt(sumRow(dry, Y.length - 1))}</td>
      </tr>
    </>
  );

  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h3 className="text-[13px] font-semibold">{t("Anbaustruktur & Produktion je Jahr")}</h3>
        <div className="inline-flex rounded-control border overflow-hidden" style={{ borderColor: "var(--nx-border)" }}>
          {(["ha", "t"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className="px-3 text-[11px] font-semibold"
              style={{ height: 30, background: mode === m ? "var(--nx-green)" : "var(--nx-surface)", color: mode === m ? "#fff" : "var(--nx-text-secondary)" }}>
              {m === "ha" ? t("Fläche (ha)") : t("Produktion (t)")}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full text-[12px]">
          <thead><tr><th className={th + " text-left"}>{t("Kultur")}</th>{Y.map((y) => <th key={y} className={th + " text-right"}>{START_YEAR + y}</th>)}<th className={th + " text-right"}>{t("Ziel")}</th></tr></thead>
          <tbody>
            <Block dry={false} label={t("Beregnet — Wertrotation (Anbauplan-Anteile)")} />
            <Block dry={true} label={t("Unberegnet — Trockenrotation")} />
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-2 py-2 font-semibold">{t("Gesamt")} ({mode === "ha" ? "ha" : "t"})</td>
              {Y.map((y) => <td key={y} className="num px-2 py-2 text-right font-semibold">{fmt(grand(y))}</td>)}
              <td className="num px-2 py-2 text-right font-semibold">{fmt(grand(Y.length - 1))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
        {t("Beregneter Block = aktuelle Anbauplan-Anteile, skaliert auf die Beregnungsfläche des Jahres (Wertkulturen nur hier). Unberegneter Block = Trockenrotation auf der Restfläche, Ertragsabschlag ~40 %. Produktion (t) = Fläche × Ertrag × (1 − Verlust).")}
      </div>
    </section>
  );
}

/** Zeile der CAPEX-Tabelle: Wert je Jahr (Geld) + Σ; num0 = Ganzzahl statt Geld. */
function Row({ label, y, f, sum, color, muted, num0 }: { label: string; y: number[]; f: (yy: number) => number; sum?: number; color?: string; muted?: boolean; num0?: boolean }) {
  const fmt = (v: number) => num0 ? fmtNumber(v, 0) : fmtMoney(v);
  return (
    <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
      <td className="px-2 py-1.5" style={{ color: muted ? "var(--nx-text-muted)" : (color ?? "var(--nx-text)") }}>{label}</td>
      {y.map((yy) => <td key={yy} className="num px-2 py-1.5 text-right" style={{ color: muted ? "var(--nx-text-muted)" : "var(--nx-text)" }}>{f(yy) ? fmt(f(yy)) : "–"}</td>)}
      <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: color ?? "var(--nx-text)" }}>{sum != null ? fmtMoney(sum) : ""}</td>
    </tr>
  );
}
