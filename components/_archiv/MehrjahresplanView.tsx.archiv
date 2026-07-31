"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { NumberInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { effectiveGrowth, START_YEAR } from "../../store/model";
import { t } from "../../lib/i18n";


/** Wachstum — EINE konsolidierte Sicht (über ha, keine Stufen):
 *  Beregnete Fläche je Jahr → Wachstums-CAPEX (Beregnungsausbau, mit Finanzierung FK/EK).
 *  Die Flächenentwicklung selbst gehört in den Anbauplan — hier steht nur, was daraus an
 *  Investition folgt. Alles fließt verdrahtet in Bilanz/Cashflow/Covenants. */
export function MehrjahresplanView() {
  const { domain, patch } = useModelStore();
  const g = domain.growth;
  if (!g) return <div className="text-[12px] text-nx-text-muted">{t("Kein Wachstumsplan konfiguriert.")}</div>;

  // SOLO-MODELL: keine Wachstumsstufen und kein Akquiseprofil mehr. Die Flächenkurve IST der
  //  Kultur-Skalierungspfad und bleibt hier editierbar; Wachstums-CAPEX = Beregnungsausbau.
  const eg = effectiveGrowth(g) ?? g;
  const years = g.years;
  const irr = (y: number) => eg.areaByYear[y] ?? 0;
  const tot = (y: number) => eg.totalByYear?.[y] ?? irr(y);
  const irrCapex = g.irrigEurPerHaCent ?? 0;
  const startTot = g.startTotalHa ?? tot(0);
  const startIrr = g.startIrrigatedHa ?? irr(0);
  const dIrr = (y: number) => Math.max(0, irr(y) - (y > 0 ? irr(y - 1) : startIrr));

  const setIrr = (y: number, v: number) => patch((d) => { if (d.growth) d.growth.areaByYear[y] = Math.max(0, Math.round(v)); });
  const setG = (fn: (gp: any) => void) => patch((d) => { if (d.growth) fn(d.growth); });

  const beregY = (y: number) => dIrr(y) * irrCapex;
  const sum = (f: (y: number) => number) => { let s = 0; for (let y = 0; y < years; y++) s += f(y); return s; };
  const sumBereg = sum(beregY);

  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";
  const Y = Array.from({ length: years }, (_, y) => y);
  const kpi: [string, string, string?][] = [
    [t("Start") + " " + START_YEAR, `${fmtNumber(startIrr, 0)} ha`],
    [`${t("Ziel")} ${START_YEAR + years - 1}`, `${fmtNumber(irr(years - 1), 0)} ha`],
    [t("Σ Beregnungsausbau"), `${fmtMoney(sumBereg)} €`, "var(--nx-brand-lift)"],
  ];

  return (
    <div className="space-y-4">
      {/* ENTFERNT 31.07.2026: Wachstumsstufen-Auswahl und Akquiseprofil (Betriebsübernahmen,
          Pachtpakete, Land-CAPEX). Es gibt eine Stufe, und gewachsen wird über Pachtfläche. */}
      {/* Flächen-Ramp — in s3b editierbar, sonst aus der Stufe abgeleitet */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Beregnete Fläche je Jahr")}</h3>
          <p className="mt-0.5 text-[11px] text-nx-text-muted">
            {t("Die Gesamtfläche ergibt sich aus den Kultur-Skalierungspfaden im Anbauplan und wird hier nur nachrichtlich gezeigt. Eingabe ist allein der beregnete Anteil — er treibt den Beregnungsausbau darunter.")}
          </p>
        </div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead><tr><th className={th + " text-left"}>{t("Position")}</th>{Y.map((y) => <th key={y} className={th + " text-right"}>{START_YEAR + y}</th>)}</tr></thead>
            <tbody>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-nx-text-secondary font-semibold">{t("Gesamtfläche (aus Anbauplan)")}</td>
                {Y.map((y) => <td key={y} className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtNumber(tot(y), 0)}</td>)}
              </tr>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5" style={{ color: "var(--nx-brand-lift)" }}>{t("· davon beregnet")}</td>
                {Y.map((y) => <td key={y} className="px-2 py-1.5 text-right"><NumberInput value={irr(y)} width={66} onCommit={(v) => setIrr(y, v)} /></td>)}
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
              <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                <td className="px-2 py-2 font-semibold">{t("Σ Wachstums-CAPEX")}</td>
                {Y.map((y) => <td key={y} className="num px-2 py-2 text-right font-semibold">{beregY(y) ? fmtMoney(beregY(y)) : "–"}</td>)}
                <td className="num px-2 py-2 text-right font-semibold">{fmtMoney(sumBereg)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Beregnungsausbau → Pivot-Asset (AfA, 15 J.), finanziert zu 40 % über einen Investitionskredit. Greift erst ab dem in den Annahmen gesetzten Startjahr — davor wird bereits beregnete Fläche gepachtet.")}
        </div>
      </section>

      {/* ENTFERNT 31.07.2026: „Anbaustruktur & Produktion je Jahr". Die Kultur-×-Jahr-Matrix
          steht vollständig im Anbauplan-Editor (dort sogar editierbar) — hier war sie eine
          zweite Darstellung derselben Skalierungspfade. */}
    </div>
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
