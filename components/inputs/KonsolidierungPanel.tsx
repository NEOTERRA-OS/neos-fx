"use client";
import React from "react";
import { useModelStore, selectModelState, selectComputedAnnual, readAssumption } from "../../store/modelStore";
import { pachtIndexFactor } from "../../store/model";
import { computeHolding } from "../../core/engine";
import { fmtMoney } from "../../design/format";
import { t } from "../../lib/i18n";

/** Konzern-Konsolidierung (opt-in) — getrieben vom Gesellschaften-Register.
 *  IC-Eliminationen: Besitz-Pacht (OpCo→PropCo, im OpCo-Abschluss Kosten → konzernintern
 *  zurückaddiert, EBITDA-neutral in Σ) und Management-Fee (OpCo→Holding, eliminiert).
 *  Herleitung (Headline-Jahr):
 *   Konzern-EBITDA = OpCo-EBITDA + Besitz-Pacht − Holding-Overhead
 *   Konzern-JÜ     = OpCo-JÜ + PropCo-JÜ − (Holding-Overhead + Holding-Zins)   [Fee netto eliminiert] */
export function KonsolidierungPanel() {
  const domain = useModelStore((s) => s.domain);
  const patch = useModelStore((s) => s.patch);
  const scenarioId = useModelStore((s) => s.view.scenarioId);
  const annual = useModelStore(selectComputedAnnual);
  const mstate = useModelStore(selectModelState);
  const active = domain.consolidation?.active ?? false;
  const entities = domain.entities ?? [];

  const holding = React.useMemo(() => computeHolding(mstate, scenarioId), [mstate, scenarioId]);

  const yLast = annual.timeline.periodCount - 1;
  const yearLabel = annual.timeline.periods[yLast]?.label ?? "";
  const V = (li: { values: number[] }) => li.values[yLast] ?? 0;
  const mPer = Math.max(1, Math.round(mstate.timeline.periodCount / Math.max(1, annual.timeline.periodCount)));
  const sumLast = (li: { values: number[] }) => {
    let s = 0; for (let p = mstate.timeline.periodCount - mPer; p < mstate.timeline.periodCount; p++) s += li.values[p] ?? 0; return s;
  };

  const holdFee = sumLast(holding.managementFeeIncome);
  const holdOverhead = sumLast(holding.operatingCosts) + sumLast(holding.personnelCost);
  const holdInterest = sumLast(holding.financingInterest);
  const holdTax = sumLast(holding.tax);
  const holdNi = sumLast(holding.netIncome);

  const pc = domain.pacht;
  const roRate = readAssumption(domain, "tax.rate", scenarioId) ?? 0.16;
  // Intercompany-Besitz-Pacht (Cash-Rent, unabhängig von der Buchungsart): ownHa × Satz × Index.
  const besitzPacht = pc ? Math.round(pc.ownedHa * pc.baseRentPerHaCent * pachtIndexFactor(pc, yLast)) : 0;
  // Steckt die Pacht als Aufwand in der OpCo-EBITDA? Nur OHNE IFRS-16 (sonst unter EBITDA kapitalisiert).
  const pachtInOpco = pc && !pc.ifrs16;

  const opEbitda = V(annual.pnl.ebitda);
  const opNi = V(annual.pnl.netIncome);

  const holdEnt = entities.find((e) => e.role === "holding");
  const propEnt = entities.find((e) => e.role === "propco");
  const opEnt = entities.find((e) => e.role === "opco");
  const hasHolding = !!holdEnt && (holdFee !== 0 || holdOverhead !== 0);
  const hasPropco = !!propEnt && besitzPacht > 0;

  const propNi = Math.round(besitzPacht * (1 - roRate));
  const holdEbitdaCtr = holdFee - holdOverhead;

  // IC-Elimination der Besitz-Pacht: PropCo-Ertrag raus; OpCo-Aufwand nur zurücknehmen, wenn er
  //  dort steckt (ohne IFRS-16). IFRS-16 → Pacht ist nicht in OpCo-EBITDA/-JÜ → nur PropCo-Seite raus.
  const elimPachtEbitda = hasPropco ? besitzPacht - (pachtInOpco ? besitzPacht : 0) : 0;
  const elimPachtNi = hasPropco ? propNi - (pachtInOpco ? propNi : 0) : 0;

  // Σ Einzelabschlüsse
  const sumEbitda = opEbitda + (hasPropco ? besitzPacht : 0) + (hasHolding ? holdEbitdaCtr : 0);
  const sumNi = opNi + (hasPropco ? propNi : 0) + (hasHolding ? holdNi : 0);
  // IC-Elimination gesamt: Management-Fee (Holding) + Besitz-Pacht (PropCo).
  const elimEbitda = (hasHolding ? holdFee : 0) + elimPachtEbitda;
  const elimNi = (hasHolding ? (holdFee - holdTax) : 0) + elimPachtNi;
  // Konzern
  const grpEbitda = sumEbitda - elimEbitda;
  const grpNi = sumNi - elimNi;

  const setActive = (v: boolean) => patch((d) => { d.consolidation = { active: v }; });

  const Money = ({ c, strong, tone }: { c: number; strong?: boolean; tone?: "elim" | "sum" | "grp" }) => (
    <span className={"num " + (strong ? "font-bold" : "")} style={{ color: c < 0 ? "var(--nx-error)" : tone === "grp" ? "var(--nx-brand-lift)" : "var(--nx-text)" }}>
      {fmtMoney(c)} €
    </span>
  );

  const ICSTYLE: React.CSSProperties = { borderColor: "var(--nx-border)", background: "var(--nx-surface)" };

  return (
    <section className="rounded-tile border" style={ICSTYLE}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h2 className="text-[13px] font-semibold">{t("Konzern-Konsolidierung · getrieben vom Register")} {yearLabel && <span className="caption text-[10.5px] text-nx-text-muted">· {yearLabel}</span>}</h2>
        {/* Opt-in-Schalter */}
        <button
          role="switch" aria-checked={active}
          onClick={() => setActive(!active)}
          className="inline-flex items-center gap-2 rounded-control border px-2.5 text-[11.5px] font-semibold"
          style={{ height: 30, borderColor: "var(--nx-border)", background: active ? "var(--nx-brand-tint)" : "var(--nx-surface)", color: active ? "var(--nx-brand-lift)" : "var(--nx-text-secondary)" }}
        >
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: active ? "var(--nx-brand-lift)" : "var(--nx-text-muted)" }} />
          {active ? t("Konsolidierung aktiv") : t("Konsolidierung aktivieren")}
        </button>
      </div>

      {!active ? (
        <div className="px-4 py-3 text-[12px] text-nx-text-secondary">
          {t("Konzern-Sicht ist")} <b>{t("deaktiviert")}</b> {t("— Dashboard & GuV zeigen den")} <b>{t("OpCo-Einzelabschluss")}</b>{t(". Bei Aktivierung werden die konzerninternen Transaktionen laut Register eliminiert (Besitz-Pacht OpCo↔PropCo, Management-Fee OpCo↔Holding) und die konsolidierte Konzern-Sicht eingeblendet.")}
        </div>
      ) : (
        <>
          {/* IC-Transaktionen */}
          <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border-divider)" }}>
            <div className="caption text-[10px] font-bold text-nx-text-muted mb-1.5">{t("Intercompany-Transaktionen (eliminiert)")}</div>
            <div className="flex flex-col gap-1 text-[12px]">
              {hasPropco ? (
                <div className="flex items-center gap-2">
                  <span className="rounded-control px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--nx-surface-sunken)", color: "var(--nx-text-secondary)" }}>{t("Besitz-Pacht")}</span>
                  <span className="text-nx-text-secondary">{opEnt?.name ?? t("OpCo")} → {propEnt?.name ?? t("PropCo")}</span>
                  <span className="num ml-auto">{fmtMoney(besitzPacht)} €/J</span>
                  <span className="caption text-[10px] text-nx-text-muted" style={{ width: 130, textAlign: "right" }}>{pachtInOpco ? t("eliminiert (netto)") : t("eliminiert · IFRS-16")}</span>
                </div>
              ) : null}
              {hasHolding ? (
                <div className="flex items-center gap-2">
                  <span className="rounded-control px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--nx-surface-sunken)", color: "var(--nx-text-secondary)" }}>{t("Management-Fee")}</span>
                  <span className="text-nx-text-secondary">{opEnt?.name ?? t("OpCo")} → {holdEnt?.name ?? t("Holding")}</span>
                  <span className="num ml-auto">{fmtMoney(holdFee)} €/J</span>
                  <span className="caption text-[10px] text-nx-text-muted" style={{ width: 130, textAlign: "right" }}>{t("eliminiert")}</span>
                </div>
              ) : null}
              {!hasPropco && !hasHolding && <span className="text-nx-text-muted">{t("Keine IC-Transaktionen im Register (keine PropCo/Holding).")}</span>}
            </div>
          </div>

          {/* Konsolidierungs-Bridge */}
          <div className="overflow-x-auto px-2 py-1.5">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr>
                  <th className="px-2 py-1.5 text-left caption text-[10px] text-nx-text-muted">{t("Konsolidierungs-Bridge")} · {yearLabel}</th>
                  <th className="px-2 py-1.5 text-right caption text-[10px] text-nx-text-muted">EBITDA</th>
                  <th className="px-2 py-1.5 text-right caption text-[10px] text-nx-text-muted">{t("Jahresüberschuss")}</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5">{opEnt?.name ?? t("OpCo")} <span className="caption text-[10px] text-nx-text-muted">{t("· Einzelabschluss")}</span></td>
                  <td className="px-2 py-1.5 text-right"><Money c={opEbitda} /></td>
                  <td className="px-2 py-1.5 text-right"><Money c={opNi} /></td>
                </tr>
                {hasPropco && (
                  <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                    <td className="px-2 py-1.5">+ {propEnt?.name ?? t("PropCo")} <span className="caption text-[10px] text-nx-text-muted">{t("· Besitz-Pacht")}</span></td>
                    <td className="px-2 py-1.5 text-right"><Money c={besitzPacht} /></td>
                    <td className="px-2 py-1.5 text-right"><Money c={propNi} /></td>
                  </tr>
                )}
                {hasHolding && (
                  <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                    <td className="px-2 py-1.5">+ {holdEnt?.name ?? t("Holding")} <span className="caption text-[10px] text-nx-text-muted">{t("· inkl. Fee")}</span></td>
                    <td className="px-2 py-1.5 text-right"><Money c={holdEbitdaCtr} /></td>
                    <td className="px-2 py-1.5 text-right"><Money c={holdNi} /></td>
                  </tr>
                )}
                <tr style={{ borderTop: "1px solid var(--nx-border)" }}>
                  <td className="px-2 py-1.5 font-semibold">{t("Σ Einzelabschlüsse")}</td>
                  <td className="px-2 py-1.5 text-right"><Money c={sumEbitda} strong /></td>
                  <td className="px-2 py-1.5 text-right"><Money c={sumNi} strong /></td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5 text-nx-text-secondary">{t("− IC-Elimination")} <span className="caption text-[10px] text-nx-text-muted">· {hasPropco ? t("Besitz-Pacht + ") : ""}{t("Management-Fee (netto)")}</span></td>
                  <td className="px-2 py-1.5 text-right"><Money c={-elimEbitda} /></td>
                  <td className="px-2 py-1.5 text-right"><Money c={-elimNi} /></td>
                </tr>
                <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                  <td className="px-2 py-2 font-bold">{t("= Konzern")} <span className="caption text-[10px] text-nx-text-muted">{t("· konsolidiert")}</span></td>
                  <td className="px-2 py-2 text-right"><Money c={grpEbitda} strong tone="grp" /></td>
                  <td className="px-2 py-2 text-right"><Money c={grpNi} strong tone="grp" /></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="px-4 py-2 border-t text-[11px] text-nx-text-secondary" style={{ borderColor: "var(--nx-border-divider)" }}>
            {t("Konzern ≠ OpCo-Einzelabschluss: die")} <b>{t("konzerninterne Besitz-Pacht")}</b> ({fmtMoney(besitzPacht)} €) {t("wird zurückaddiert (im OpCo-Abschluss Kosten, im Konzern intern), die")} <b>{t("Management-Fee")}</b> {t("als reiner Transfer eliminiert. PropCo-JÜ zu RO-Satz")} {(roRate * 100).toFixed(0)} %{t("; gleiche RO-Besteuerung OpCo/PropCo → Pacht im JÜ neutral. Vereinfachte Management-Konsolidierung.")}
          </div>
        </>
      )}
    </section>
  );
}
