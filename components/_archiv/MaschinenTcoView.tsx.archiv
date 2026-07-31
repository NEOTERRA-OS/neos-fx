"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { deriveMachineTCO } from "../../store/model";
import { AssumptionField } from "./AssumptionField";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";

/** Maschinen-Einzelkosten (TCO) je Maschine — Fixkosten (AfA/Zins/Versicherung) +
 *  variable Kosten je Betriebsstunde, WARTUNG/SERVICE separat ausgewiesen. */
export function MaschinenTcoView() {
  const domain = useModelStore((s) => s.domain);
  const scenarioId = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick); // re-derive on change
  const tco = React.useMemo(() => deriveMachineTCO(domain, scenarioId), [domain, scenarioId, tick]);

  return (
    <div className="space-y-4">
      <div className="rounded-tile border px-4 py-3 text-[12px] text-nx-text-secondary" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        {t("Vollkosten je Maschine (ASABE/KTBL-Logik). Fixkosten werden über die Auslastung (Betriebsstunden/Jahr aus Anbauplan-Fläche ÷ Flächenleistung) auf €/h und €/ha umgelegt.")} <b>{t("Wartung/Service €/h")}</b> {t("ist eine eigene, editierbare Zeile. In der GuV wirkt der Maschinen-Overhead (Service + Reparaturen + Versicherung) über")}
        <span className="num"> opex.machines</span>{t("; AfA/Finanzierung/Diesel/Fahrer laufen über CapEx/Debt/opLines.")}
      </div>

      {tco.map((m) => (
        <section key={m.machineId} className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
            <h2 className="text-[14px] font-semibold">{m.label} <span className="num text-[12px] text-nx-text-muted">× {m.count}</span></h2>
            <div className="flex items-center gap-5 text-[12px]">
              {m.eurPerHour != null && <span className="num">{t("Vollkosten")} <b>{fmtMoney(m.eurPerHour)} €/h</b></span>}
              {m.eurPerHa != null && <span className="num">≈ <b>{fmtMoney(m.eurPerHa)} €/ha</b></span>}
              {m.hoursPerYear != null && <span className="num text-nx-text-muted">{fmtNumber(m.hoursPerYear, 0)} h/J</span>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-x-8 px-4 py-3 md:grid-cols-2">
            <div>
              <div className="caption py-1 text-[10.5px] font-bold text-nx-text-muted">{t("Fixkosten / Jahr (Flotte)")}</div>
              {[[t("AfA"), m.fixedPerYear.afa], [t("Zins/Finanzierung"), m.fixedPerYear.interest], [t("Versicherung/Unterstellung"), m.fixedPerYear.insurance]].map(([l, v]) => (
                <div key={l as string} className="flex justify-between border-b py-1.5 text-[12.5px]" style={{ borderColor: "var(--nx-border-divider)" }}>
                  <span>{l as string}</span><span className="num">{fmtMoney(v as number)} €</span>
                </div>
              ))}
              <div className="flex justify-between py-1.5 text-[12.5px] font-semibold">
                <span>{t("Σ Fixkosten")}</span><span className="num">{fmtMoney(m.fixedPerYear.total)} €</span>
              </div>
            </div>

            <div>
              <div className="caption py-1 text-[10.5px] font-bold text-nx-text-muted">{t("Variable Kosten / Betriebsstunde")}</div>
              {m.hoursPerYear == null ? (
                <div className="py-2 text-[12px] text-nx-text-muted">{t("Kein Stundenbezug (Anlage: nur AfA + Versicherung).")}</div>
              ) : (
                <>
                  <div className="flex items-center justify-between border-b py-1.5 text-[12.5px]" style={{ borderColor: "var(--nx-border-divider)", background: "var(--nx-surface-alt)" }}>
                    <span className="font-semibold" style={{ color: "var(--nx-warning)" }}>{t("Wartung/Service (separat)")}</span>
                    {m.serviceRateKey ? <AssumptionField akey={m.serviceRateKey} compact /> : <span className="num">{fmtMoney(m.variablePerHour.service)} €/h</span>}
                  </div>
                  {[[t("Reparaturen (ASABE)"), m.variablePerHour.repair], [t("Diesel"), m.variablePerHour.diesel], [t("Fahrer"), m.variablePerHour.operator]].map(([l, v]) => (
                    <div key={l as string} className="flex justify-between border-b py-1.5 text-[12.5px]" style={{ borderColor: "var(--nx-border-divider)" }}>
                      <span>{l as string}</span><span className="num">{fmtMoney(v as number)} €/h</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1.5 text-[12.5px] font-semibold">
                    <span>{t("Σ variabel")}</span><span className="num">{fmtMoney(m.variablePerHour.total)} €/h</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
