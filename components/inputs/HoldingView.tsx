"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import { AssumptionField } from "./AssumptionField";
import { TextInput, NumberInput } from "./NumberInput";
import { fmtMoney } from "../../design/format";
import { t } from "../../lib/i18n";
import { X } from "lucide-react";

/** Holding (Deutschland, GmbH) — gesondert gerechnet, dann konsolidiert. Kostenblöcke, Fee,
 *  Steuersatz, Quellensteuer als sensitivierbare Annahmen. */
export function HoldingView() {
  const { domain, patch, view } = useModelStore();
  const h = domain.holding;
  if (!h) return <div className="rounded-tile border p-4 text-[12.5px]" style={{ borderColor: "var(--nx-border)" }}>{t("Keine Holding.")}</div>;
  const scenarioId = view.scenarioId;
  const costVal = (it: { monthlyCent?: number; assumptionKey?: string }) =>
    it.monthlyCent != null ? it.monthlyCent : (it.assumptionKey ? (readAssumption(domain, it.assumptionKey, scenarioId) ?? 0) : 0);
  const totalCost = h.costItems.reduce((s, it) => s + costVal(it), 0);
  const updCost = (i: number, fn: (it: any) => void) => patch((d) => { fn(d.holding!.costItems[i]); });
  const addCost = () => patch((d) => {
    let n = 1; while (d.holding!.costItems.some((c) => c.id === `hc-custom-${n}`)) n++;
    d.holding!.costItems.push({ id: `hc-custom-${n}`, label: t("Neue Position"), monthlyCent: 0 });
  });
  const removeCost = (i: number) => patch((d) => { d.holding!.costItems.splice(i, 1); });

  const meta: [string | undefined, string][] = [
    [h.taxRateKey, t("Gewinnsteuersatz (DE: KSt + SolZ + GewSt)")],
    [h.managementFeeKey, t("Management-Fee (IC) / Monat")],
    [h.dividendWithholdingKey, t("Quellensteuer Dividende")],
  ];

  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h2 className="text-[14px] font-semibold">{t("Holding (Deutschland) — reine Verwaltungsholding")}</h2>
        <span className="caption text-[10.5px] text-nx-text-muted">{t("gesondert → Konzern-Rollup")}</span>
      </div>
      <div className="px-4 py-2 border-b text-[11.5px] text-nx-text-secondary" style={{ borderColor: "var(--nx-border-divider)" }}>
        {t("Ohne eigenen Geschäftsbetrieb — laufende Kosten für Geschäftsführung, Rechnungswesen und Compliance. Deutschland: Körperschaftsteuer 15 % + SolZ + Gewerbesteuer ≈ ")}<b>29,8 %</b>{t("; auf Dividenden der NEOTERRA SRL greift das Schachtelprivileg (§ 8b KStG, 95 % steuerfrei). Zypern wurde verworfen — Substanzanforderungen und Bankfähigkeit zu komplex. Die IC-Management-Fee unterliegt der Verrechnungspreis-Dokumentation.")}
      </div>

      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border-divider)" }}>
        <span className="text-[12px] text-nx-text-secondary">Name</span>
        <TextInput value={h.name ?? ""} onCommit={(s) => patch((d) => { d.holding!.name = s; })} />
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border-divider)" }}>
        {meta.map(([k, label]) => k ? (
          <div key={k} className="flex items-center gap-2">
            <span className="text-[12px] text-nx-text-secondary">{label}</span>
            <AssumptionField akey={k} compact />
          </div>
        ) : null)}
      </div>

      <div className="px-2 py-2">
        <div className="caption px-2 py-1 text-[10.5px] font-bold text-nx-text-muted">{t("Kostenblöcke (€/Monat) — editierbar & erweiterbar")}</div>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left caption text-[10px] text-nx-text-muted">{t("Position")}</th>
              <th className="px-2 py-1 text-right caption text-[10px] text-nx-text-muted">{t("€/Monat")}</th>
              <th className="px-2 py-1 text-right caption text-[10px] text-nx-text-muted">{t("€/Jahr")}</th>
              <th className="px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {h.costItems.map((it, i) => (
              <tr key={it.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5"><TextInput value={it.label} width={300} onCommit={(v) => updCost(i, (o) => { o.label = v; })} /></td>
                <td className="px-2 py-1.5 text-right"><NumberInput value={costVal(it)} moneyCent width={110} onCommit={(nv) => updCost(i, (o) => { o.monthlyCent = nv; o.assumptionKey = undefined; })} /></td>
                <td className="num px-2 py-1.5 text-right text-nx-text-secondary">{fmtMoney(costVal(it) * 12)} €</td>
                <td className="px-2 py-1.5 text-right"><button className="text-[12px] text-nx-error" title={t("Position entfernen")} onClick={() => removeCost(i)}><X size={13} strokeWidth={2.5} aria-hidden /></button></td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-2 py-1.5 text-[11px] font-semibold">{t("Σ Holding-Kosten")}</td>
              <td className="num px-2 py-1.5 text-right font-bold">{fmtMoney(totalCost)} €</td>
              <td className="num px-2 py-1.5 text-right font-bold">{fmtMoney(totalCost * 12)} €</td>
              <td></td>
            </tr>
          </tbody>
        </table>
        <div className="px-2 py-1.5">
          <button className="rounded-control border px-3 text-[11.5px] font-semibold"
            style={{ height: 30, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }}
            onClick={addCost}>{t("+ Position")}</button>
        </div>
      </div>
    </section>
  );
}
