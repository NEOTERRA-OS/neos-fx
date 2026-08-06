"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import {
  deriveCropAreasMY, machineOpCostPerHaCent, lohnarbeitPerHaCent, versicherungPerHaCent, START_YEAR,
} from "../../store/model";
import { cropYield, cropLoss } from "./cropCalc";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import type { CostType } from "../../core/types";

/** DIREKTKOSTEN je Kultur — €/ha und €/t, aufgeschlüsselt nach Kostenart.
 *
 *  Direktkosten = alles, was der Hektar unmittelbar verursacht: Saatgut/Pflanzgut, Dünger,
 *  Pflanzenschutz, Material und Handarbeit aus dem Kulturkatalog, dazu die Maschinen-
 *  BETRIEBSkosten (Versicherung, Reparatur, Schmierstoff, Diesel) und — falls scharfgeschaltet —
 *  die Lohnarbeit. NICHT enthalten sind Abschreibung und kalkulatorischer Zins der Maschinen,
 *  Pacht, Personal und Overhead: das sind Struktur-, keine Direktkosten. Genau diese Abgrenzung
 *  unterscheidet den Deckungsbeitrag vom Vollkosten-Betriebsergebnis.
 *
 *  €/t bezieht sich auf die NETTO-Menge (Ertrag × (1 − Verlust)) — also auf das, was tatsächlich
 *  vermarktet wird. Das ist die Zahl, die sich direkt mit dem Kontraktpreis vergleichen lässt.
 */

const GRUPPEN: { id: CostType | "machine_op" | "lohn"; label: string }[] = [
  { id: "seed", label: "Saat-/Pflanzgut" },
  { id: "fertilizer", label: "Dünger" },
  { id: "crop_protection", label: "Pflanzenschutz" },
  { id: "labor", label: "Handarbeit" },
  { id: "fuel", label: "Diesel (Katalog)" },
  { id: "other", label: "Sonstiges Material" },
  { id: "machine_op", label: "Maschinen-Betrieb" },
  { id: "lohn", label: "Lohnarbeit" },
  { id: "insurance", label: "Versicherung" },
];

export function DirektkostenSummary() {
  const { domain } = useModelStore();
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);

  const years = Math.max(1, domain.growth?.years ?? 1);
  const [jahr, setJahr] = React.useState(0);
  const y = Math.min(jahr, years - 1);
  const [proT, setProT] = React.useState(true);

  const rows = React.useMemo(() => {
    const areas = deriveCropAreasMY(domain).areas;
    return domain.catalog.map((cat) => {
      const cropId = cat.cropId;
      // Katalogkosten je Kostenart (CENT/ha)
      const byType: Record<string, number> = {};
      for (const op of cat.ops) for (const l of op.lines) {
        const unit = readAssumption(domain, l.unitCostKey, sc) ?? 0;
        byType[l.costType] = (byType[l.costType] ?? 0) + l.quantityPerHa * unit;
      }
      byType.machine_op = machineOpCostPerHaCent(domain, cropId, sc, y);
      byType.lohn = lohnarbeitPerHaCent(domain, cropId, sc, y);
      /* Die Prämie steht NICHT im Kulturkatalog — sie fällt aus Ertrag, Preis
         und Verlust und muss deshalb wie Maschinen-Betrieb und Lohnarbeit
         hier gerechnet werden, sonst fehlte sie in dieser Tabelle, obwohl sie
         in der GuV steht. */
      byType.insurance = versicherungPerHaCent(domain, cropId, sc);
      const perHa = Object.values(byType).reduce((s, v) => s + v, 0);

      const yieldTHa = cropYield(domain, cropId, sc);
      const loss = cropLoss(domain, cropId, sc);
      const nettoTHa = yieldTHa * (1 - loss);
      const perT = nettoTHa > 0 ? perHa / nettoTHa : 0;
      const preis = readAssumption(domain, cat.priceKey, sc) ?? 0;   // CENT/t
      const ha = areas[cropId]?.[Math.min(y, years - 1)] ?? 0;
      return { cropId, name: cat.name, byType, perHa, perT, yieldTHa, loss, nettoTHa, preis, ha,
        dbPerT: preis - perT, margePct: preis > 0 ? (preis - perT) / preis : 0 };
    }).sort((a, b) => b.ha - a.ha);
  }, [domain, sc, y, tick, years]);

  const gesamtHa = rows.reduce((s, r) => s + r.ha, 0);
  const gesamtKosten = rows.reduce((s, r) => s + r.perHa * r.ha, 0);
  const gesamtT = rows.reduce((s, r) => s + r.nettoTHa * r.ha, 0);

  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";
  const card: React.CSSProperties = { borderColor: "var(--nx-border)", background: "var(--nx-surface)" };
  const zeige = (cent: number) => (proT ? cent : cent);   // beide Modi in CENT

  return (
    <section className="rounded-tile border" style={card}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--nx-border)" }}>
        <div>
          <h2 className="text-[14px] font-semibold">{t("Direktkosten je Kultur")}</h2>
          <p className="mt-0.5 text-[11px] text-nx-text-muted">
            {t("Saat-/Pflanzgut, Dünger, Pflanzenschutz, Material, Handarbeit und Maschinen-Betrieb (inkl. Diesel), dazu aktive Lohnarbeit und die Kulturversicherung. OHNE Abschreibung, Zins, Pacht, Personal und Overhead — das sind Strukturkosten. €/t bezieht sich auf die NETTO-Menge nach Ernteverlust, ist also direkt mit dem Kontraktpreis vergleichbar.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-control border overflow-hidden" style={{ borderColor: "var(--nx-border)" }}>
            {([[true, "€/t"], [false, "€/ha"]] as const).map(([v, lbl]) => (
              <button key={lbl} onClick={() => setProT(v)} className="px-3 text-[11px] font-semibold"
                style={{ height: 28, background: proT === v ? "var(--nx-green)" : "var(--nx-surface)", color: proT === v ? "#fff" : "var(--nx-text-secondary)" }}>
                {lbl}
              </button>
            ))}
          </div>
          <select className="rounded-control border px-2 text-[11px]"
            style={{ height: 28, borderColor: "var(--nx-border)", background: "var(--nx-surface)", color: "var(--nx-text)" }}
            value={y} onChange={(e) => setJahr(parseInt(e.target.value, 10))}>
            {Array.from({ length: years }, (_, i) => <option key={i} value={i}>{START_YEAR + i}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)" }}>
        {[
          [t("Fläche"), `${fmtNumber(gesamtHa, 0)} ha`],
          [t("Netto-Menge"), `${fmtNumber(gesamtT, 0)} t`],
          [t("Direktkosten gesamt"), `${fmtMoney(gesamtKosten)} €`, "var(--nx-locate)"],
          [t("⌀ Direktkosten"), gesamtT > 0 ? `${fmtMoney(gesamtKosten / gesamtT)} €/t` : "–", "var(--nx-brand-lift)"],
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
              <th className={th + " text-left"}>{t("Kultur")}</th>
              <th className={th + " text-right"}>{t("Fläche")}</th>
              <th className={th + " text-right"}>{t("Ertrag netto")}</th>
              {GRUPPEN.map((g) => <th key={g.id} className={th + " text-right"}>{t(g.label)}</th>)}
              <th className={th + " text-right"} style={{ color: "var(--nx-brand-lift)" }}>
                {proT ? t("Σ Direktkosten €/t") : t("Σ Direktkosten €/ha")}
              </th>
              <th className={th + " text-right"}>{t("Preis €/t")}</th>
              <th className={th + " text-right"}>{t("DB €/t")}</th>
              <th className={th + " text-right"}>{t("Marge")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const teiler = proT ? (r.nettoTHa > 0 ? r.nettoTHa : NaN) : 1;
              return (
                <tr key={r.cropId} style={{ borderTop: "1px solid var(--nx-border-divider)", opacity: r.ha > 0 ? 1 : 0.55 }}>
                  <td className="px-2 py-1.5">{t(r.name)}</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">{r.ha > 0 ? `${fmtNumber(r.ha, 0)} ha` : "–"}</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtNumber(r.nettoTHa, 1)} t/ha</td>
                  {GRUPPEN.map((g) => {
                    const v = r.byType[g.id] ?? 0;
                    return (
                      <td key={g.id} className="num px-2 py-1.5 text-right" style={{ color: v ? "var(--nx-text)" : "var(--nx-text-muted)" }}>
                        {v ? fmtMoney(Number.isFinite(teiler) ? v / teiler : 0) : "–"}
                      </td>
                    );
                  })}
                  <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: "var(--nx-brand-lift)" }}>
                    {fmtMoney(Number.isFinite(teiler) ? r.perHa / teiler : 0)}
                  </td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtMoney(r.preis)}</td>
                  <td className="num px-2 py-1.5 text-right font-semibold"
                      style={{ color: r.dbPerT >= 0 ? "var(--nx-success)" : "var(--nx-error)" }}>{fmtMoney(r.dbPerT)}</td>
                  <td className="num px-2 py-1.5 text-right"
                      style={{ color: r.margePct >= 0.4 ? "var(--nx-success)" : r.margePct >= 0 ? "var(--nx-warning)" : "var(--nx-error)" }}>
                    {fmtNumber(r.margePct * 100, 1)} %
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
        {t("Alle Beträge im gewählten Jahr und Szenario. Die Kostenarten stammen Zeile für Zeile aus dem Kulturkatalog (Menge/ha × Stücksatz) — jede Zahl ist bis auf die einzelne Maßnahme rückverfolgbar. Maschinen-Betrieb kommt aus den Arbeitsgängen (Überfahrten ÷ Schlagkraft × €/h), Lohnarbeit nur aus scharfgeschalteten Zeilen. Die Versicherung ist ein Prozentsatz der Versicherungssumme (Netto-Ertrag × Preis), abzüglich des Zuschusses aus sM 17.1 — deshalb steigt sie mit dem Erntewert und fällt im Worst Case NICHT weg, sondern wird teurer, weil dort der Zuschuss auf null steht.")}
      </div>
    </section>
  );
}
