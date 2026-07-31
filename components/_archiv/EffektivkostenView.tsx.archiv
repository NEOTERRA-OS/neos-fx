"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { deriveEffectiveMachineCost } from "../../store/model";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";

/** TCO · Effektive Maschinenkosten (Delta 21.07.): Effektiv = Netto-Einkauf (Liste − Rabatt)
 *  − Rücknahme/Restwert am Ende der Haltedauer; €/Jahr = Effektiv ÷ Haltedauer. */
export function EffektivkostenView() {
  const domain = useModelStore((s) => s.domain);
  const scenarioId = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);
  const { machines, totals } = React.useMemo(() => deriveEffectiveMachineCost(domain, scenarioId), [domain, scenarioId, tick]);

  return (
    <div className="space-y-4">
      <div className="rounded-tile border px-4 py-3 text-[12px] text-nx-text-secondary" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        {t("Effektive Kosten = Netto-Einkauf (Liste − Rabatt) − Rücknahme/Restwert am Ende der Haltedauer. Rabatt/Restwert-Sätze im View „Preise & Treiber\" (TCO). JD-Schlepper 8RX 410 / 6R 260 mit realen Angebotswerten. Cash-Effekte (Rabatt beim Einkauf → Netto-CAPEX; AfA auf den Restwert) sind in GuV/Bilanz verdrahtet.")}
      </div>

      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("TCO · Effektive Maschinenkosten (Flotte)")}</h2>
          <div className="flex items-center gap-5 text-[12px]">
            <span className="num">{t("Restwert-Quote Ø")} <b>{fmtNumber(totals.resQuote * 100, 0)} %</b></span>
            <span className="num">{t("TCO/Jahr")} <b>{fmtMoney(totals.perYearCent)} €</b></span>
          </div>
        </div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="caption text-[10.5px] text-nx-text-muted">
                <th className="px-2 py-2 text-left">{t("Maschine")}</th>
                <th className="px-2 py-2 text-left">{t("Kat.")}</th>
                <th className="px-2 py-2 text-right">{t("Anz.")}</th>
                <th className="px-2 py-2 text-right">{t("Liste ges.")}</th>
                <th className="px-2 py-2 text-right">{t("Netto −Rabatt")}</th>
                <th className="px-2 py-2 text-right">{t("Restw.%")}</th>
                <th className="px-2 py-2 text-right">{t("Restwert")}</th>
                <th className="px-2 py-2 text-right">{t("Effektiv")}</th>
                <th className="px-2 py-2 text-right">{t("€/Jahr")}</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5">{m.label}</td>
                  <td className="px-2 py-1.5 text-nx-text-muted">{m.cat}</td>
                  <td className="num px-2 py-1.5 text-right">{fmtNumber(m.count, 0)}</td>
                  <td className="num px-2 py-1.5 text-right">{fmtMoney(m.listCent)}</td>
                  <td className="num px-2 py-1.5 text-right">{fmtMoney(m.netCent)}</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-secondary">{fmtNumber(m.resPct * 100, 0)} %</td>
                  <td className="num px-2 py-1.5 text-right" style={{ color: "var(--nx-success)" }}>{fmtMoney(m.residualCent)}</td>
                  <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(m.effCent)}</td>
                  <td className="num px-2 py-1.5 text-right">{fmtMoney(m.perYearCent)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                <td className="px-2 py-2 font-semibold" colSpan={3}>{t("Summe Flotte")}</td>
                <td className="num px-2 py-2 text-right font-semibold">{fmtMoney(totals.listCent)}</td>
                <td className="num px-2 py-2 text-right font-semibold">{fmtMoney(totals.netCent)}</td>
                <td className="num px-2 py-2 text-right">{fmtNumber(totals.resQuote * 100, 0)} %</td>
                <td className="num px-2 py-2 text-right font-semibold">{fmtMoney(totals.residualCent)}</td>
                <td className="num px-2 py-2 text-right font-semibold">{fmtMoney(totals.effCent)}</td>
                <td className="num px-2 py-2 text-right font-semibold">{fmtMoney(totals.perYearCent)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
