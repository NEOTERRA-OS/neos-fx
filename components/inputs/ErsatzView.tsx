"use client";
import React from "react";
import { useModelStore, selectScopedDomain } from "../../store/modelStore";
import { deriveReplacementCapex } from "../../store/model";
import { NumberInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";

/** Ersatzinvestitionen — revolvierende Flottenerneuerung, JE MASCHINE editierbar.
 *  Tauschzyklus, AfA-Dauer und Bh/Jahr je Maschine; daraus Neukauf, Verkaufserlös (Ausmusterung)
 *  und Buchgewinn/-verlust. Wirkt live in CapEx/GuV/Bilanz/Cashflow (Ausmusterung ab Zyklusende). */
export function ErsatzView() {
  const { domain, view, patch } = useModelStore();
  // Ersatzinvestitionen folgen der aktiven Stufe/Scope (Stufe 1 = nur Ackerbau → keine Wertkultur-Maschinen).
  const sdomain = useModelStore(selectScopedDomain);
  const repl = deriveReplacementCapex(sdomain, view.scenarioId);
  const rows = [...repl.machines].sort((a, b) => b.annualReplaceCent - a.annualReplaceCent);

  const setCfg = (id: string, key: "cycleYears" | "afaYears" | "hoursPerYear", value: number) =>
    patch((d) => { d.replacement = d.replacement ?? {}; d.replacement[id] = { ...(d.replacement[id] ?? {}), [key]: value }; });
  const setEnabled = (id: string, on: boolean) =>
    patch((d) => { d.replacement = d.replacement ?? {}; d.replacement[id] = { ...(d.replacement[id] ?? {}), enabled: on }; });

  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";
  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Ersatzinvestitionen — revolvierende Flottenerneuerung")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">{t("je Maschine editierbar · Basis")} {fmtNumber(domain.anbauplan.reduce((s, a) => s + a.areaHa, 0), 0)} {t("ha · skaliert mit der Fläche")}</span>
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)" }}>
          {[
            [t("Neukauf / Jahr (Basis)"), fmtMoney(repl.totalReplaceCent) + " €"],
            [t("Verkaufserlös / Jahr"), fmtMoney(repl.totalProceedsCent) + " €"],
            [t("Netto-Ersatz-Cash / Jahr"), fmtMoney(repl.totalReplaceCent - repl.totalProceedsCent) + " €"],
            [t("Buchergebnis Abgang / Jahr"), fmtMoney(repl.totalLossCent) + " €"],
          ].map(([k, v], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[13px] font-semibold">{v}</div>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 text-[11.5px] text-nx-text-muted">
          {t("Tauschzyklus je Maschine = min(vorgegeben, Bh-Kappung / Bh je Jahr). Neukauf = Flotte netto / Zyklus (revolvierend, 1/Zyklus pro Jahr — kein Komplett-Tausch). AfA-Dauer > Zyklus ⇒ Buchverlust beim Verkauf; AfA ≤ Zyklus ⇒ Buchgewinn. Die realen Ersatzinvestitionen ergeben sich aus den echten Betriebsstunden — hier als editierbare Annahme je Maschine.")}
        </div>
      </section>

      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="overflow-x-auto px-2 py-1.5">
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                <th className={th}>{t("Aktiv")}</th>
                <th className={th + " text-left"}>{t("Maschine")}</th>
                <th className={th + " text-right"}>{t("Bh / Jahr")}</th>
                <th className={th + " text-right"}>{t("Zyklus (J)")}</th>
                <th className={th + " text-right"}>{t("AfA (J)")}</th>
                <th className={th + " text-right"}>{t("Flotte netto")}</th>
                <th className={th + " text-right"}>{t("Restwert")}</th>
                <th className={th + " text-right"}>{t("Neukauf/J")}</th>
                <th className={th + " text-right"}>{t("Erlös/J")}</th>
                <th className={th + " text-right"}>{t("Buchergebnis/J")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} style={{ borderTop: "1px solid var(--nx-border-divider)", opacity: m.enabled ? 1 : 0.5 }}>
                  <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={m.enabled} onChange={(e) => setEnabled(m.id, e.target.checked)} /></td>
                  <td className="px-2 py-1.5">{m.label}</td>
                  <td className="px-2 py-1.5 text-right"><NumberInput value={m.hoursPerYear} width={64} onCommit={(v) => setCfg(m.id, "hoursPerYear", Math.max(1, Math.round(v)))} /></td>
                  <td className="px-2 py-1.5 text-right"><NumberInput value={m.cycleYears} width={52} onCommit={(v) => setCfg(m.id, "cycleYears", Math.max(2, Math.round(v)))} /></td>
                  <td className="px-2 py-1.5 text-right"><NumberInput value={m.afaYears} width={52} onCommit={(v) => setCfg(m.id, "afaYears", Math.max(1, Math.round(v)))} /></td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtMoney(m.fleetNetCent)} €</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtMoney(m.fleetResidualCent)} €</td>
                  <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(m.annualReplaceCent)} €</td>
                  <td className="num px-2 py-1.5 text-right">{fmtMoney(m.annualProceedsCent)} €</td>
                  <td className="num px-2 py-1.5 text-right" style={{ color: m.annualLossCent < 0 ? "var(--nx-error)" : "var(--nx-text)" }}>{fmtMoney(m.annualLossCent)} €</td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                <td className="px-2 py-1.5" colSpan={7}><span className="text-[11px] font-semibold">{t("Σ (Basis)")}</span></td>
                <td className="num px-2 py-1.5 text-right font-bold">{fmtMoney(repl.totalReplaceCent)} €</td>
                <td className="num px-2 py-1.5 text-right font-bold">{fmtMoney(repl.totalProceedsCent)} €</td>
                <td className="num px-2 py-1.5 text-right font-bold" style={{ color: repl.totalLossCent < 0 ? "var(--nx-error)" : "var(--nx-text)" }}>{fmtMoney(repl.totalLossCent)} €</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
