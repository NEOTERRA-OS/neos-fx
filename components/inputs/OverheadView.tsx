"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { type OverheadItem } from "../../store/model";
import { NumberInput, TextInput } from "./NumberInput";
import { fmtMoney } from "../../design/format";
import { t } from "../../lib/i18n";
import { X } from "lucide-react";

/** Overhead / SG&A — indirekte Gemeinkosten der ganzen Company (Corporate + Post-Harvest/
 *  Packhaus, Kühllager, Logistik, Vermarktung, Software/IT …). Gruppen & Positionen frei
 *  editier-/erweiterbar: Gruppe umbenennen/anlegen/entfernen, Positionen je Gruppe.
 *  Summe fließt über opex.sga in die OpEx/SG&A-Zeile der GuV (mindert EBITDA). */
export function OverheadView() {
  const domain = useModelStore((s) => s.domain);
  const patch = useModelStore((s) => s.patch);
  const items = domain.overhead ?? [];

  // Gruppen in Reihenfolge des ersten Auftretens (stabil, neue Gruppen hinten).
  const groups = React.useMemo(() => {
    const seen: string[] = [];
    for (const it of items) if (!seen.includes(it.group)) seen.push(it.group);
    return seen;
  }, [items]);

  const totalMonthly = items.reduce((s, o) => s + (o.monthlyCent || 0), 0);

  const updItem = (globalIdx: number, fn: (o: OverheadItem) => void) => patch((d) => { fn(d.overhead[globalIdx]); });
  const addItem = (group: string) => patch((d) => {
    let n = 1; while (d.overhead.some((o) => o.id === `ov-custom-${n}`)) n++;
    d.overhead.push({ id: `ov-custom-${n}`, group, label: "Neue Position", monthlyCent: 0 });
  });
  const removeItem = (globalIdx: number) => patch((d) => { d.overhead.splice(globalIdx, 1); });
  const renameGroup = (oldName: string, newName: string) => patch((d) => {
    const nm = newName.trim() || oldName;
    for (const o of d.overhead) if (o.group === oldName) o.group = nm;
  });
  const deleteGroup = (name: string) => patch((d) => { d.overhead = d.overhead.filter((o) => o.group !== name); });
  const addGroup = () => patch((d) => {
    let n = 1; while (d.overhead.some((o) => o.group === `Neue Gruppe ${n}`)) n++;
    let k = 1; while (d.overhead.some((o) => o.id === `ov-custom-${k}`)) k++;
    d.overhead.push({ id: `ov-custom-${k}`, group: `Neue Gruppe ${n}`, label: "Neue Position", monthlyCent: 0 });
  });

  return (
    <div className="space-y-4">
      <div className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Overhead / SG&A — indirekte Gemeinkosten (Company)")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">
            Σ {fmtMoney(totalMonthly)} €/Monat · {fmtMoney(totalMonthly * 12)} €/Jahr → {t("OpEx (mindert EBITDA)")}
          </span>
        </div>
        <div className="px-4 py-2 text-[12px] text-nx-text-secondary">
          {t("Vollständige Company-Struktur inkl. Nachernte/Packhaus, Kühllager, Logistik, Vermarktung/Handel und Software/IT.")}
          <b> {t("Gruppen und Positionen sind frei editier- & erweiterbar")}</b> {t("— Gruppenname anpassen, Gruppen anlegen/entfernen, Positionen je Gruppe hinzufügen/entfernen. Die Summe fließt strukturiert in die GuV (OpEx/SG&A), skaliert mit der Fläche.")}
        </div>
      </div>

      {groups.map((group) => {
        const groupItems = items.map((it, gi) => ({ it, gi })).filter((x) => x.it.group === group);
        const groupSum = groupItems.reduce((s, x) => s + (x.it.monthlyCent || 0), 0);
        const isLogistik = /logist|distrib|transport|fracht/i.test(group);
        return (
          <section key={group} className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)", boxShadow: "var(--nx-el-card)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
              <div className="flex items-center gap-2">
                <span className="caption text-[9.5px] text-nx-text-muted">{t("GRUPPE")}</span>
                <TextInput value={group} width={320} onCommit={(v) => renameGroup(group, v)} />
              </div>
              <div className="flex items-center gap-3">
                <span className="num text-[10.5px] text-nx-text-muted">{fmtMoney(groupSum)} €/Mon · {fmtMoney(groupSum * 12)} €/J</span>
                <button className="inline-flex items-center gap-1 text-[11px] text-nx-error" title={t("Gruppe entfernen (alle Positionen)")} onClick={() => deleteGroup(group)}><X size={12} strokeWidth={2.5} aria-hidden /> {t("Gruppe")}</button>
              </div>
            </div>
            {isLogistik && (
              <div className="flex items-start gap-2 px-4 py-2 text-[11px] border-b" style={{ borderColor: "var(--nx-border-divider)", background: "var(--nx-warning-bg,#FCF0C4)", color: "var(--nx-text-secondary)" }}>
                <span aria-hidden style={{ color: "var(--nx-warning,#B7791F)", fontWeight: 700 }}>!</span>
                <span><b>{t("Hinweis Doppelzählung:")}</b> {t("Transport-/Frachtkosten Feld→Abnehmer werden bereits über den")}
                  <b> {t("CAPEX-Szenarien-Rechner → Transport")}</b> (<span className="num">opex.transport</span>) {t("modelliert. Wenn du den Transport-Entscheider aktiv nutzt, hier die entsprechende Fracht-Position auf")} <b>0</b> {t("setzen, um Doppelzählung zu vermeiden.")}</span>
              </div>
            )}
            <div className="overflow-x-auto px-2 py-1.5">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr>
                    <th className="px-2 py-1.5 text-left caption text-[10.5px] text-nx-text-muted">{t("Position")}</th>
                    <th className="px-2 py-1.5 text-right caption text-[10.5px] text-nx-text-muted">€/Monat</th>
                    <th className="px-2 py-1.5 text-right caption text-[10.5px] text-nx-text-muted">€/Jahr</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {groupItems.map(({ it, gi }) => (
                    <tr key={it.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                      <td className="px-2 py-1.5"><TextInput value={it.label} width={360} onCommit={(v) => updItem(gi, (o) => { o.label = v; })} /></td>
                      <td className="px-2 py-1.5 text-right"><NumberInput value={it.monthlyCent} moneyCent width={110} onCommit={(nv) => updItem(gi, (o) => { o.monthlyCent = nv; })} /></td>
                      <td className="num px-2 py-1.5 text-right text-nx-text-secondary">{fmtMoney(it.monthlyCent * 12)} €</td>
                      <td className="px-2 py-1.5 text-right"><button className="text-[12px] text-nx-error" title={t("Position entfernen")} onClick={() => removeItem(gi)}><X size={13} strokeWidth={2.5} aria-hidden /></button></td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                    <td className="px-2 py-1.5 text-[11px] font-semibold">Σ {group}</td>
                    <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(groupSum)} €</td>
                    <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(groupSum * 12)} €</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="border-t px-4 py-1.5" style={{ borderColor: "var(--nx-border-divider)" }}>
              <button className="rounded-control border px-3 text-[11.5px] font-semibold"
                style={{ height: 30, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }}
                onClick={() => addItem(group)}>{t("+ Position")}</button>
            </div>
          </section>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-tile border px-4 py-3" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <button className="rounded-control border px-3 text-[12px] font-semibold"
          style={{ height: 34, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }}
          onClick={addGroup}>{t("+ Gruppe / Kategorie anlegen")}</button>
        <span className="num text-[14px] font-bold">Σ {fmtMoney(totalMonthly)} €/Monat · {fmtMoney(totalMonthly * 12)} €/Jahr</span>
      </div>
    </div>
  );
}
