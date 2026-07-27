"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import { AssumptionField } from "./AssumptionField";
import { fmtMoney } from "../../design/format";
import { t } from "../../lib/i18n";

function QtyCell({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [t, setT] = React.useState(String(value));
  React.useEffect(() => setT(String(value)), [value]);
  return (
    <input className="num rounded-control border px-2 text-right text-[12.5px]"
      style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600, height: 34, width: 92 }}
      value={t} inputMode="decimal"
      onChange={(e) => setT(e.target.value)}
      onBlur={(e) => { const n = Number(e.target.value.replace(",", ".")); if (isFinite(n)) onCommit(n); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

/** Kostenkatalog je Kultur — die wiederverwendbare "Datenbank": pro Kultur
 *  Operation → opLine (Menge/ha × Stücksatz). Der Anbauplan zieht diese Kosten. */
export function KatalogView() {
  const { domain, view, patch } = useModelStore();
  const sc = view.scenarioId;
  const [open, setOpen] = React.useState<string>(domain.catalog[0]?.cropId ?? "");

  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h2 className="text-[14px] font-semibold">{t("Kostenkatalog je Kultur — Agronomie-Direktkosten")}</h2>
        <span className="caption text-[10.5px] text-nx-text-muted">{t("Saatgut/Dünger/PSM/Beregnung/Handarbeit · Maschinenkosten separat (Maschinen-Screens)")}</span>
      </div>
      {domain.catalog.map((c, ci) => {
        const isOpen = open === c.cropId;
        const total = c.ops.reduce((a, op) => a + op.lines.reduce((b, l) => b + l.quantityPerHa * (readAssumption(domain, l.unitCostKey, sc) ?? 0), 0), 0);
        return (
          <div key={c.cropId} className="border-b" style={{ borderColor: "var(--nx-border)" }}>
            <button className="flex w-full items-center justify-between px-4 py-2.5 text-left"
              onClick={() => setOpen(isOpen ? "" : c.cropId)}>
              <span className="text-[13px] font-semibold">{isOpen ? "▾" : "▸"} {c.name}</span>
              <span className="num text-[12px] text-nx-text-secondary">{t("Σ Agronomie")} {fmtMoney(total)} €/ha</span>
            </button>
            {isOpen && (
              <div className="overflow-x-auto px-4 pb-3">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="caption text-[10.5px] text-nx-text-muted">
                      <th className="px-2 py-1.5 text-left">{t("Operation / Zeile")}</th>
                      <th className="px-2 py-1.5 text-left">{t("Art")}</th>
                      <th className="px-2 py-1.5 text-right">{t("Menge/ha")}</th>
                      <th className="px-2 py-1.5 text-right">{t("Stücksatz")}</th>
                      <th className="px-2 py-1.5 text-right">€/ha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.ops.map((op, oi) => (
                      <React.Fragment key={op.code}>
                        <tr><td colSpan={5} className="px-2 pt-2 text-[11px] font-semibold text-nx-text-secondary">{op.code} · {op.label}</td></tr>
                        {op.lines.map((l, li) => {
                          const unit = readAssumption(domain, l.unitCostKey, sc) ?? 0;
                          return (
                            <tr key={li} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                              <td className="px-2 py-1.5 pl-4">{l.label}</td>
                              <td className="px-2 py-1.5 text-nx-text-muted">{l.costType}</td>
                              <td className="px-2 py-1.5 text-right">
                                <QtyCell value={l.quantityPerHa} onCommit={(n) => patch((d) => { d.catalog[ci].ops[oi].lines[li].quantityPerHa = n; })} />
                              </td>
                              <td className="px-2 py-1.5 text-right"><AssumptionField akey={l.unitCostKey} compact /></td>
                              <td className="num px-2 py-1.5 text-right">{fmtMoney(l.quantityPerHa * unit)}</td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
