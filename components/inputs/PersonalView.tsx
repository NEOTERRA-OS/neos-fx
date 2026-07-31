"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import {
  PERSONAL_POSITIONEN, personalFteOfYear, personalRatioOf, setPersonalRatio,
  setPersonalOverride, hasPersonalOverride, selfOperatedFieldHoursOfYear,
  machineCapPerUnitHours, machineDemandHoursOfYear, deriveCropAreasMY, START_YEAR,
} from "../../store/model";
import { NumberInput } from "./NumberInput";
import { AssumptionField } from "./AssumptionField";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import { RotateCcw } from "lucide-react";

/** PERSONALPLANUNG — eine Tabelle, ein Treiber je Zeile.
 *
 *  Vorher zeigte dieser Screen für dieselbe Größe drei verschiedene Zahlen nebeneinander:
 *  ein editierbares Feld (das in Wahrheit die Kalibrierungsbasis für den Endausbau war,
 *  nicht die Mannschaft), die Kurve, die die Engine daraus rechnete, und die Vorschläge
 *  eines „Personalplaners", der seinerseits aus den Zahlen des STARTJAHRES rechnete und
 *  deshalb 2 Fahrer empfahl, wo die Kurve auf 9 lief. Keine der drei war beschriftet, und
 *  bei den Maschinenführern steuerte das Feld seit der Umstellung auf gefahrene Stunden
 *  überhaupt nichts mehr. Daher Σ 41,7 unten gegen Σ 38,7 oben und zwei verschiedene
 *  AG-Kosten auf demselben Bildschirm.
 *
 *  Jetzt: jede Position hat EINEN benannten Treiber und EIN Verhältnis — wie viele Hektar
 *  betreut eine Kraft, wie viele Stunden fährt ein Fahrer, wie viele Maschinen betreut ein
 *  Techniker. Daraus fällt die Kopfzahl je Planjahr, und sie reagiert automatisch, wenn
 *  Fläche wächst oder Arbeit fremdvergeben wird: was im Lohn läuft, fährt der
 *  Lohnunternehmer, was gemietet ist, wartet der Vermieter.
 *
 *  Der Treiber ist ein Vorschlag, keine Vorschrift. Jede Jahreszelle lässt sich
 *  überschreiben; der Rücksetz-Pfeil gibt sie der Rechnung zurück. So bleibt sichtbar, wo
 *  der Plan der Formel folgt und wo einer bewussten Entscheidung.
 */
export function PersonalView() {
  const { domain, patch } = useModelStore();
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);
  const readOnly = useModelStore((s) => s.readOnly);
  const years = Math.max(1, domain.growth?.years ?? 1);
  const Y = Array.from({ length: years }, (_, y) => y);

  const daten = React.useMemo(() => {
    const areas = deriveCropAreasMY(domain).areas;
    const haOf = (y: number) => domain.anbauplan.reduce((s, a) => {
      const c = areas[a.cropId];
      return s + (c ? (c[Math.min(y, c.length - 1)] ?? 0) : a.areaHa);
    }, 0);
    const eigeneMaschinen = (y: number) => {
      let n = 0;
      for (const m of domain.machineCatalog) {
        if (!m.cEff || (m.rentedUnits ?? 0) > 0) continue;
        const cap = machineCapPerUnitHours(domain, m.id, sc);
        if (cap > 0) n += Math.ceil(machineDemandHoursOfYear(domain, m.id, y) / cap);
      }
      return n;
    };
    return {
      ha: Y.map(haOf),
      stunden: Y.map((y) => selfOperatedFieldHoursOfYear(domain, y)),
      maschinen: Y.map(eigeneMaschinen),
      zeilen: PERSONAL_POSITIONEN.map((p) => ({
        pos: p,
        fte: Y.map((y) => personalFteOfYear(domain, p.key, y, sc)),
        brutto: readAssumption(domain, p.grossKey, sc) ?? 0,          // CENT / Monat
        overrides: domain.personalOverride?.[p.key] ?? [],
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, sc, tick, years]);

  const cam = domain.personnel?.rates?.cam ?? 0.0225;
  const agKostenJahr = (y: number) => daten.zeilen.reduce((s, z) => s + z.fte[y] * z.brutto * 12 * (1 + cam), 0);
  const fteJahr = (y: number) => daten.zeilen.reduce((s, z) => s + z.fte[y], 0);

  const th = "px-2 py-2 caption text-[10px] text-nx-text-muted";
  const card: React.CSSProperties = { borderColor: "var(--nx-border)", background: "var(--nx-surface)" };

  return (
    <div className="space-y-3">
      <section className="rounded-tile border" style={card}>
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Personalplanung")}</h2>
          <span className="text-[11px] text-nx-text-muted">
            {t("Je Position ein Treiber und ein Verhältnis — daraus fällt die Kopfzahl je Planjahr. Jede Zelle lässt sich überschreiben.")}
          </span>
          <span className="caption ml-auto text-[10px] text-nx-text-muted">
            {t("Σ FTE")} {fmtNumber(fteJahr(0), 1)} → {fmtNumber(fteJahr(years - 1), 1)} · {t("AG-Kosten")} {fmtMoney(agKostenJahr(years - 1))} €
          </span>
        </div>

        {/* Treibergrößen — die Basis, auf der alles darunter rechnet. Sie stehen sichtbar
            oben, damit die Kopfzahl nachvollziehbar bleibt und nicht aus dem Nichts kommt. */}
        <div className="overflow-x-auto border-b px-2 py-1" style={{ borderColor: "var(--nx-border)" }}>
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                <th className={th + " text-left"} style={{ minWidth: 300 }}>{t("Treibergröße")}</th>
                {Y.map((y) => <th key={y} className={th + " text-right"}>{START_YEAR + y}</th>)}
              </tr>
            </thead>
            <tbody>
              {([
                [t("Betriebsfläche (ha)"), daten.ha],
                [t("selbst gefahrene Feldstunden (h)"), daten.stunden],
                [t("eigene Maschinen (Stk)"), daten.maschinen],
              ] as [string, number[]][]).map(([label, reihe]) => (
                <tr key={label} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1 text-nx-text-secondary">{label}</td>
                  {Y.map((y) => <td key={y} className="num px-2 py-1 text-right text-nx-text-muted">{fmtNumber(reihe[y], 0)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto px-2 py-1">
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                <th className={th + " text-left"} style={{ minWidth: 300 }}>{t("Position / Treiber")}</th>
                <th className={th + " text-right"}>{t("Verhältnis")}</th>
                <th className={th + " text-right"}>{t("Brutto/Monat")}</th>
                {Y.map((y) => <th key={y} className={th + " text-right"}>{START_YEAR + y}</th>)}
              </tr>
            </thead>
            <tbody>
              {daten.zeilen.map((z) => (
                <tr key={z.pos.key} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">
                      {t(z.pos.label)}
                      {hasPersonalOverride(domain, z.pos.key) && (
                        <span className="ml-1.5 rounded px-1 text-[9px] font-bold"
                          style={{ color: "var(--nx-locate)", background: "var(--nx-app-bg)" }}>{t("Hand")}</span>
                      )}
                    </div>
                    <div className="text-[9.5px] text-nx-text-muted">{t(z.pos.treiberLabel)}</div>
                  </td>
                  <td className="px-1 py-1.5 text-right">
                    <span className="inline-flex items-center gap-1">
                      <NumberInput value={personalRatioOf(domain, z.pos.key)} width={58}
                        onCommit={(v) => patch((d) => setPersonalRatio(d, z.pos.key, v))} />
                      <span className="text-[9.5px] text-nx-text-muted" style={{ width: 46, textAlign: "left" }}>{z.pos.einheit}</span>
                    </span>
                  </td>
                  <td className="px-1 py-1.5 text-right"><AssumptionField akey={z.pos.grossKey} compact /></td>
                  {Y.map((y) => {
                    const hand = z.overrides[y];
                    const manuell = hand != null && isFinite(hand as number);
                    return (
                      <td key={y} className="px-1 py-1.5 text-right"
                          style={{ background: manuell ? "color-mix(in srgb, var(--nx-locate) 10%, transparent)" : undefined }}>
                        <span className="inline-flex items-center gap-0.5">
                          <NumberInput value={Number(z.fte[y].toFixed(1))} width={48}
                            onCommit={(v) => patch((d) => setPersonalOverride(d, z.pos.key, y, v))} />
                          <span style={{ width: 12, display: "inline-block" }}>
                            {manuell && !readOnly && (
                              <button className="text-[10px] text-nx-text-muted hover:text-nx-error"
                                title={t("Handeingabe entfernen — wieder dem Treiber folgen")}
                                onClick={() => patch((d) => setPersonalOverride(d, z.pos.key, y, null))}>
                                <RotateCcw size={10} />
                              </button>
                            )}
                          </span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                <td className="px-2 py-2 font-semibold" colSpan={3}>{t("Σ FTE")}</td>
                {Y.map((y) => <td key={y} className="num px-2 py-2 text-right font-semibold">{fmtNumber(fteJahr(y), 1)}</td>)}
              </tr>
              <tr>
                <td className="px-2 py-2 font-semibold" colSpan={3}>{t("AG-Personalaufwand p. a. (Brutto + CAM)")}</td>
                {Y.map((y) => <td key={y} className="num px-2 py-2 text-right font-semibold" style={{ color: "var(--nx-locate)" }}>{fmtMoney(agKostenJahr(y))}</td>)}
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Kopfzahl = Treibergröße ÷ Verhältnis. Leitung und Werkstatt sind gedämpft (Sockel 45 % + 55 % flächenproportional) — ein achtmal so großer Betrieb braucht keine achtfache Leitung. Die Maschinenführer folgen den SELBST gefahrenen Feldstunden: was im Lohn vergeben wird, fährt der Lohnunternehmer, was gemietet ist, wartet der Vermieter — beides senkt die Kopfzahl automatisch.")}
          <br />
          {t("Eine Zahl in eine Jahresspalte zu schreiben überschreibt den Treiber für dieses Jahr (blau markiert); der Rücksetz-Pfeil gibt die Zelle wieder der Rechnung zurück. Nicht enthalten: Erntehandarbeit — sie ist als Direktkosten je Kultur verbucht — und LKW-Fahrer, die in der Transportkalkulation stecken.")}
        </div>
      </section>
    </div>
  );
}
