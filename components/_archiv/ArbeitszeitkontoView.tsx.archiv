"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { STAGES } from "../../store/model";
import { t } from "../../lib/i18n";

const eur = (x: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(Math.round(x));
const num = (x: number, d = 0) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }).format(x);

// Personal-Stunden-Bedarf je Monat (Stufe 1, aus Arbeitsgängen). Skaliert mit stageFactor.
const MONTHS = ["Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez", "Jan"];
const DEMAND_S1 = [241.68, 3176.28, 8192.50, 83.04, 1312.93, 594.52, 5386.09, 13392.05, 722.98, 0, 0, 0];
const H_BASIS = 173;   // 40h/Monat je FTE
const H_SPITZE = 208;  // 48h/Monat je FTE
const H_YEAR = 1720;   // produktive h/Jahr je FTE
const WAGE_CORE = 7;   // €/h geladen
const WAGE_SEASON = 5.20;

/** Arbeitszeitkonto (RO-konform): monatlicher Personalbedarf vs. Stammkapazität;
 *  Überstunden-Guthaben Sommer → Abbau Winter; Restspitzen über Saisonkräfte (zilieri). */
export function ArbeitszeitkontoView() {
  const stage = useModelStore((s) => s.domain.stage);
  const sf = STAGES[String(stage)]?.stageFactor ?? 1;
  const [coreFTE, setCoreFTE] = React.useState(12);
  const [irrigFTE, setIrrigFTE] = React.useState(6);
  React.useEffect(() => { setCoreFTE(Math.round(12 * sf)); setIrrigFTE(Math.round(6 * sf)); }, [sf]);

  const basis = coreFTE * H_BASIS;
  const spitze = coreFTE * H_SPITZE;
  let konto = 0, seasonSum = 0, demandSum = 0;
  const rows = MONTHS.map((m, i) => {
    const demand = DEMAND_S1[i] * sf;
    const saldo = Math.min(demand, spitze) - basis;
    konto += saldo;
    const season = Math.max(0, demand - spitze);
    seasonSum += season; demandSum += demand;
    return { m, demand, saldo, konto, season, zilieri: season / H_BASIS };
  });

  const costCore = coreFTE * H_YEAR * WAGE_CORE;
  const costSeason = seasonSum * WAGE_SEASON;
  const costIrrig = irrigFTE * H_YEAR * WAGE_CORE;
  const total = costCore + costSeason + costIrrig;

  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Arbeitszeitkonto (Stufe")} {stage})</h2>
          <div className="flex items-center gap-4 text-[12px]">
            <span className="flex items-center gap-2">{t("Stamm-FTE")}
              <input className="num rounded-control border px-2 text-right" style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600, height: 30, width: 60 }}
                type="number" value={coreFTE} onChange={(e) => setCoreFTE(Math.max(0, Number(e.target.value) || 0))} />
            </span>
            <span className="flex items-center gap-2">{t("Bewässerung/Lager-FTE")}
              <input className="num rounded-control border px-2 text-right" style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600, height: 30, width: 60 }}
                type="number" value={irrigFTE} onChange={(e) => setIrrigFTE(Math.max(0, Number(e.target.value) || 0))} />
            </span>
          </div>
        </div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="caption text-[10.5px] text-nx-text-muted">
                <th className="px-2 py-1.5 text-left">{t("Monat")}</th>
                <th className="px-2 py-1.5 text-right">{t("Bedarf h")}</th>
                <th className="px-2 py-1.5 text-right">{t("Saldo (Bedarf−Basis)")}</th>
                <th className="px-2 py-1.5 text-right">{t("Kontostand kum.")}</th>
                <th className="px-2 py-1.5 text-right">{t("Saisonkräfte h")}</th>
                <th className="px-2 py-1.5 text-right">{t("zilieri FTE")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.m} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5">{t(r.m)}</td>
                  <td className="num px-2 py-1.5 text-right">{num(r.demand)}</td>
                  <td className="num px-2 py-1.5 text-right" style={{ color: r.saldo < 0 ? "var(--nx-error)" : "var(--nx-success)" }}>{num(r.saldo)}</td>
                  <td className="num px-2 py-1.5 text-right" style={{ color: r.konto < 0 ? "var(--nx-error)" : "var(--nx-text)" }}>{num(r.konto)}</td>
                  <td className="num px-2 py-1.5 text-right">{r.season > 0 ? num(r.season) : "–"}</td>
                  <td className="num px-2 py-1.5 text-right">{r.zilieri > 0 ? num(r.zilieri, 1) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Negativer Endsaldo (")}{num(rows[rows.length - 1].konto)} {t("h) ⇒ Stammcrew außerhalb der Saison unterausgelastet → Spitzen (v. a. Ernte September) über Saisonkräfte (zilieri, ≤180 Tage/J) decken. Positiver Endsaldo ⇒ Stamm zu klein.")}
        </div>
      </section>

      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}><h2 className="text-[14px] font-semibold">{t("Gesamt-Personalkosten / Jahr")}</h2></div>
        <div className="px-4 py-2">
          {[[t("Stamm-Maschinenführer"), `${coreFTE} FTE × 1.720 h × 7 €/h`, costCore],
            [t("Saisonkräfte (zilieri)"), `${num(seasonSum / H_YEAR, 1)} FTE-Äq × 5,20 €/h`, costSeason],
            [t("Bewässerung/Lager/Werkstatt"), `${irrigFTE} FTE × 1.720 h × 7 €/h`, costIrrig]].map(([l, sub, v]) => (
            <div key={l as string} className="flex items-center justify-between border-b py-1.5 text-[12.5px]" style={{ borderColor: "var(--nx-border-divider)" }}>
              <span>{l as string} <span className="text-[10.5px] text-nx-text-muted">· {sub as string}</span></span>
              <span className="num">{eur(v as number)} €</span>
            </div>
          ))}
          <div className="flex items-center justify-between py-2 text-[13px] font-semibold">
            <span>{t("Gesamt")}</span><span className="num">{eur(total)} €</span>
          </div>
        </div>
      </section>
    </div>
  );
}
