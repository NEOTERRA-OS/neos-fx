"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { MACHINE_LABELS, machineOpCostPerHaCent } from "../../store/model";
import { fmtMoney } from "../../design/format";
import { t } from "../../lib/i18n";

/** Arbeitsgänge je Kultur — Maschine × Überfahrten (editierbar). Treibt Maschinenstunden,
 *  Maschinen-Betriebskosten (COGS) und die Flottenauslastung. */
export function ArbeitsgaengeView() {
  const { domain, view, patch } = useModelStore();
  const sc = view.scenarioId;
  const machineKeys = Object.keys(MACHINE_LABELS);
  const [open, setOpen] = React.useState<string>(domain.catalog[0]?.cropId ?? "");

  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h2 className="text-[14px] font-semibold">{t("Arbeitsgänge je Kultur (Maschine × Überfahrten)")}</h2>
        <span className="caption text-[10.5px] text-nx-text-muted">{t("Überfahrten editierbar → Maschinenstunden & -kosten rechnen live")}</span>
      </div>
      {domain.catalog.map((c) => {
        const ops = domain.arbeitsgaenge[c.cropId] ?? [];
        const isOpen = open === c.cropId;
        const machEurHa = machineOpCostPerHaCent(domain, c.cropId, sc);
        return (
          <div key={c.cropId} className="border-b" style={{ borderColor: "var(--nx-border)" }}>
            <button className="flex w-full items-center justify-between px-4 py-2.5 text-left" onClick={() => setOpen(isOpen ? "" : c.cropId)}>
              <span className="text-[13px] font-semibold">{isOpen ? "▾" : "▸"} {c.name}</span>
              <span className="num text-[12px] text-nx-text-secondary">{t("Maschinen-Betrieb")} {fmtMoney(machEurHa)} €/ha · {ops.length} {t("Arbeitsgänge")}</span>
            </button>
            {isOpen && (
              <div className="px-4 pb-3">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="caption text-[10.5px] text-nx-text-muted">
                      <th className="px-2 py-1.5 text-left">{t("Maschine")}</th>
                      <th className="px-2 py-1.5 text-right">{t("Überfahrten")}</th>
                      <th className="px-2 py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ops.map((g, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                        <td className="px-2 py-1.5">
                          <select className="rounded-control border px-2 text-[12.5px]" style={{ height: 32, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }}
                            value={g.m} onChange={(e) => patch((d) => { d.arbeitsgaenge[c.cropId][i].m = e.target.value; })}>
                            {machineKeys.map((k) => <option key={k} value={k}>{MACHINE_LABELS[k]}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <PassesCell value={g.passes} onCommit={(n) => patch((d) => { d.arbeitsgaenge[c.cropId][i].passes = n; })} />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <button className="text-[11px] text-nx-error" title={t("Arbeitsgang entfernen")}
                            onClick={() => patch((d) => { d.arbeitsgaenge[c.cropId].splice(i, 1); })}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="mt-2 rounded-control border px-3 text-[12px] font-semibold" style={{ height: 32, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }}
                  onClick={() => patch((d) => { d.arbeitsgaenge[c.cropId].push({ m: machineKeys[0], passes: 1 }); })}>{t("+ Arbeitsgang")}</button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function PassesCell({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [t, setT] = React.useState(String(value));
  React.useEffect(() => setT(String(value)), [value]);
  return (
    <input className="num rounded-control border px-2 text-right text-[12.5px]"
      style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600, height: 32, width: 72 }}
      value={t} inputMode="decimal"
      onChange={(e) => setT(e.target.value)}
      onBlur={(e) => { const n = Number(e.target.value.replace(",", ".")); if (isFinite(n)) onCommit(n); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}
