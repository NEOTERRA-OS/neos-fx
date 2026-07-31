"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { NumberInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { effectiveGrowth, START_YEAR } from "../../store/model";
import { t } from "../../lib/i18n";

/** PACHT — eine Zeile je Planjahr, mehr braucht es nicht.
 *
 *  Der frühere Pacht-Simulator rechnete eine Besitzgesellschaft durch: Eigentumsflächen,
 *  Indexstufen alle N Jahre, IFRS-16-Kapitalisierung mit Right-of-Use-Asset, Annuitäten-
 *  Barwert der Leasingverbindlichkeit, Auszahlungstranchen. Im Solo-Modell gibt es diese
 *  Gesellschaft nicht — NEOTERRA besitzt keinen Hektar, jede Fläche ist Dritt-Pacht. Damit
 *  war der ganze Apparat eine Maschinerie um EINE Zahl herum: den Satz je Hektar.
 *
 *  Also: Fläche kommt aus dem Anbauplan (nicht editierbar, sie IST die Summe der
 *  Kulturpfade), der Satz ist je Jahr frei setzbar, die Jahrespacht fällt daraus. Eine
 *  Pachtsteigerung modelliert man, indem man sie hinschreibt — nicht über einen
 *  unsichtbaren Inflationsfaktor.
 */
export function PachtView() {
  const { domain, patch } = useModelStore();
  const g = domain.growth;
  const eg = effectiveGrowth(g ?? undefined) ?? g;
  const years = Math.max(1, g?.years ?? 1);
  const haOf = (y: number) => eg?.totalByYear?.[y] ?? eg?.areaByYear?.[y] ?? 0;

  const rateOf = (y: number) => {
    const tbl = domain.pacht?.ratePerHaByYear;
    if (!tbl?.length) return 750;
    return tbl[Math.min(y, tbl.length - 1)] ?? 750;
  };
  const setRate = (y: number, v: number) => patch((d) => {
    if (!d.pacht) return;
    const tbl = (d.pacht.ratePerHaByYear ?? []).slice();
    while (tbl.length < years) tbl.push(tbl[tbl.length - 1] ?? 750);
    tbl[y] = Math.max(0, Math.round(v));
    d.pacht.ratePerHaByYear = tbl;
  });
  /** Ab dem gewählten Jahr denselben Satz fortschreiben — spart sieben gleiche Eingaben. */
  const fortschreiben = (y: number) => patch((d) => {
    if (!d.pacht) return;
    const tbl = (d.pacht.ratePerHaByYear ?? []).slice();
    while (tbl.length < years) tbl.push(tbl[tbl.length - 1] ?? 750);
    for (let k = y + 1; k < years; k++) tbl[k] = tbl[y];
    d.pacht.ratePerHaByYear = tbl;
  });

  const Y = Array.from({ length: years }, (_, y) => y);
  const jahrCent = (y: number) => haOf(y) * rateOf(y) * 100;
  const summe = Y.reduce((s, y) => s + jahrCent(y), 0);
  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";
  const card: React.CSSProperties = { borderColor: "var(--nx-border)", background: "var(--nx-surface)" };

  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={card}>
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Pacht je Planjahr")}</h2>
          <p className="mt-0.5 text-[11px] text-nx-text-muted">
            {t("Fläche aus dem Anbauplan × Pachtsatz je Hektar. Der Satz ist je Jahr frei setzbar — eine Pachtsteigerung wird hier eingetragen, nicht über einen Inflationsfaktor erzeugt. NEOTERRA pachtet bereits beregnete Flächen; die Pivots stecken im Satz, dafür entfällt die eigene Beregnungsinvestition.")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-px sm:grid-cols-3" style={{ background: "var(--nx-border-divider)" }}>
          {[
            [`${t("Fläche")} ${START_YEAR}`, `${fmtNumber(haOf(0), 0)} ha`],
            [`${t("Fläche")} ${START_YEAR + years - 1}`, `${fmtNumber(haOf(years - 1), 0)} ha`],
            [t("Σ Pacht über den Planhorizont"), `${fmtMoney(summe)} €`, "var(--nx-brand-lift)"],
          ].map(([l, v, c], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{l as string}</div>
              <div className="num mt-0.5 text-[15px] font-semibold" style={{ color: (c as string) ?? "var(--nx-text)" }}>{v as string}</div>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                <th className={th + " text-left"}>{t("Position")}</th>
                {Y.map((y) => <th key={y} className={th + " text-right"}>{START_YEAR + y}</th>)}
                <th className={th + " text-right"}>Σ</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-nx-text-secondary">{t("Fläche (ha, aus Anbauplan)")}</td>
                {Y.map((y) => <td key={y} className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtNumber(haOf(y), 0)}</td>)}
                <td className="num px-2 py-1.5 text-right text-nx-text-muted">–</td>
              </tr>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Pachtsatz (€/ha)")}</td>
                {Y.map((y) => (
                  <td key={y} className="px-2 py-1.5 text-right">
                    <div className="inline-flex items-center gap-1">
                      <NumberInput value={rateOf(y)} width={62} onCommit={(v) => setRate(y, v)} />
                      {y < years - 1 && (
                        <button className="text-[10px] text-nx-text-muted hover:text-nx-locate"
                          title={t("Diesen Satz auf alle Folgejahre übernehmen")}
                          onClick={() => fortschreiben(y)}>→</button>
                      )}
                    </div>
                  </td>
                ))}
                <td className="num px-2 py-1.5 text-right text-nx-text-muted">–</td>
              </tr>
              <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                <td className="px-2 py-2 font-semibold">{t("Pacht p. a. (€)")}</td>
                {Y.map((y) => <td key={y} className="num px-2 py-2 text-right font-semibold">{fmtMoney(jahrCent(y))}</td>)}
                <td className="num px-2 py-2 text-right font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{fmtMoney(summe)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Die Jahrespacht geht als opex.pacht in GuV und Cashflow — ausgezahlt in den hinterlegten Tranchen (Standard: 60 % im August, 40 % im Oktober). Sie ist NICHT in den Fixkosten enthalten, es gibt also keine Doppelzählung.")}
        </div>
      </section>
    </div>
  );
}
