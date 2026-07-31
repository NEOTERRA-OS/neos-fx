"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import {
  deriveCropAreasMY, lohnarbeitPerHaCent, lohnAktivIn, bedarfsJahrOf,
  resolveScalar, START_YEAR, type LohnarbeitEntry,
} from "../../store/model";
import { NumberInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import { AlertTriangle } from "lucide-react";

/** LOHNARBEIT — Dienstleistungs-Einkauf je Kultur und Arbeitsgang.
 *
 *  Der Satz gilt je Hektar und ÜBERFAHRT und ist OHNE Kraftstoff kalkuliert (so rechnen die
 *  Erfahrungssätze der Landwirtschaftskammer, so wird in der Praxis abgerechnet): der Diesel
 *  bleibt bei uns, Versicherung, Reparatur, Schmierstoff und das gebundene Kapital nicht.
 *
 *  Wird ein Gang scharfgeschaltet, verschwindet er aus der Eigenmechanisierung:
 *   · die Maschine wird für diese Kultur nicht mehr bemessen,
 *   · fährt sie keine Kultur mehr selbst, entfällt sie ganz aus der Flotte (kein CAPEX),
 *   · ist die Vergabe befristet, verschiebt sich die Anschaffung auf das erste Eigen-Jahr.
 */

const GRUPPEN: { id: LohnarbeitEntry["gruppe"]; label: string }[] = [
  { id: "boden", label: "Bodenbearbeitung" },
  { id: "pflanzung", label: "Pflanzung / Saat" },
  { id: "psm_duenger", label: "Pflanzenschutz & Düngung" },
  { id: "ernte", label: "Ernte & Feldlogistik" },
];

export function LohnarbeitView() {
  const { domain, patch } = useModelStore();
  const sc = useModelStore((s) => s.view.scenarioId);
  const currency = useModelStore((s) => s.view.currency);

  const rows = domain.lohnarbeit ?? [];
  const years = Math.max(1, domain.growth?.years ?? 1);
  const my = React.useMemo(() => deriveCropAreasMY(domain), [domain]);
  const factor = domain.assumptions["lohn.factor"] ? resolveScalar(domain, "lohn.factor", sc) : 1;

  const cropName = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of domain.catalog) m[c.cropId] = c.name;
    return m;
  }, [domain.catalog]);
  const machineLabel = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const x of domain.machineCatalog) m[x.id] = x.label;
    return m;
  }, [domain.machineCatalog]);

  const passesOf = (e: LohnarbeitEntry) =>
    (domain.arbeitsgaenge[e.cropId] ?? []).filter((g) => g.m === e.machineId).reduce((s, g) => s + g.passes, 0);
  const haOf = (cropId: string, y: number) => my.areas[cropId]?.[Math.min(y, years - 1)] ?? 0;

  const upd = (id: string, fn: (e: LohnarbeitEntry) => void) =>
    patch((d) => { const e = (d.lohnarbeit ?? []).find((x) => x.id === id); if (e) fn(e); });

  /** Lohnkosten des Jahres über alle Kulturen (CENT). */
  const jahresKosten = (y: number) =>
    domain.anbauplan.reduce((s, a) => s + lohnarbeitPerHaCent(domain, a.cropId, sc, y) * haOf(a.cropId, y), 0);

  const aktive = rows.filter((e) => e.active);
  const sumHorizont = Array.from({ length: years }, (_, y) => jahresKosten(y)).reduce((s, v) => s + v, 0);

  /** Maschinen, die durch die aktiven Zeilen ganz aus der Flotte fallen. */
  const entfallen = React.useMemo(() => {
    const ids = [...new Set(rows.filter((e) => e.active).map((e) => e.machineId))];
    return ids.filter((id) => bedarfsJahrOf(domain, id, years) < 0);
  }, [domain, rows, years]);

  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";
  const card: React.CSSProperties = { borderColor: "var(--nx-border)", background: "var(--nx-surface)" };

  const yearOpts = Array.from({ length: years }, (_, y) => y);

  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={card}>
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Lohnarbeit — Dienstleistungen einkaufen")}</h2>
          <p className="mt-0.5 text-[11px] text-nx-text-muted">
            {t("Satz je Hektar und Überfahrt, OHNE Kraftstoff und MIT Fahrer. Der Diesel bleibt bei uns; Versicherung, Reparatur, Schmierstoff und das gebundene Kapital der Maschine entfallen. Ein scharfgeschalteter Gang wird für diese Kultur nicht mehr bemessen — fährt ihn keine Kultur mehr selbst, entfällt die Maschine aus der Flotte.")}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)" }}>
          {[
            [t("Zeilen aktiv"), `${aktive.length} / ${rows.length}`, aktive.length ? "var(--nx-brand-lift)" : undefined],
            [t("Lohnkosten Jahr 1"), `${fmtMoney(jahresKosten(0))} €`],
            [t("Lohnkosten über den Horizont"), `${fmtMoney(sumHorizont)} €`, "var(--nx-locate)"],
            [t("Maschinen entfallen"), `${entfallen.length}`, entfallen.length ? "var(--nx-warning)" : undefined],
          ].map(([l, v, c], i) => (
            <div key={i} className="px-4 py-3" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{l as string}</div>
              <div className="num mt-0.5 text-[15px] font-semibold" style={{ color: (c as string) ?? "var(--nx-text)" }}>{v as string}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
          <label className="inline-flex items-center gap-2 text-[11px] text-nx-text-secondary">
            {t("Satz-Faktor (1,00 = deutsche Erfahrungssätze)")}
            <NumberInput value={factor} width={70} decimals={2}
              onCommit={(v) => patch((d) => {
                const a = d.assumptions["lohn.factor"]; if (!a) return;
                const prof = a.scenarioProfiles[d.baseScenarioId];
                if (prof && prof.kind === "constant") prof.value = Math.max(0, v);
              })} />
          </label>
          <span className="flex-1 min-w-[300px] text-[11px] text-nx-text-muted">
            {t("Süd-Dolj liegt beim Lohnanteil unter Deutschland — der Faktor skaliert alle Sätze gemeinsam, bis Angebote vorliegen.")}
          </span>
        </div>
        {entfallen.length > 0 && (
          <div className="flex items-start gap-2 border-t px-4 py-2.5 text-[11px]" style={{ borderColor: "var(--nx-border)", color: "var(--nx-warning)" }}>
            <AlertTriangle size={14} className="mt-px shrink-0" />
            <span>
              {t("Diese Maschinen werden durch die aktiven Zeilen gar nicht mehr angeschafft:")}{" "}
              <b>{entfallen.map((id) => machineLabel[id] ?? id).join(", ")}</b>
            </span>
          </div>
        )}
      </section>

      {GRUPPEN.map((gr) => {
        const list = rows.filter((e) => e.gruppe === gr.id);
        if (!list.length) return null;
        return (
          <section key={gr.id} className="rounded-tile border" style={card}>
            <div className="border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
              <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t(gr.label)}</h3>
            </div>
            <div className="overflow-x-auto px-2 py-2">
              <table className="w-full text-[12px]">
                <thead>
                  <tr>
                    <th className={th + " text-left"}>{t("Kultur")}</th>
                    <th className={th + " text-left"}>{t("Arbeitsgang")}</th>
                    <th className={th + " text-right"}>{t("Überf.")}</th>
                    <th className={th + " text-right"}>{t("Satz €/ha·Überf.")}</th>
                    <th className={th + " text-right"}>{t("€/ha·Jahr")}</th>
                    <th className={th + " text-right"}>{t("ab")}</th>
                    <th className={th + " text-right"}>{t("bis")}</th>
                    <th className={th + " text-right"}>{t("Kosten Jahr 1")}</th>
                    <th className={th + " text-center"}>{t("aktiv")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((e) => {
                    const passes = passesOf(e);
                    const perHaJahr = e.ratePerHaCent * passes * factor;
                    const ha0 = haOf(e.cropId, 0);
                    const kosten0 = lohnAktivIn(e, 0) ? perHaJahr * ha0 : 0;
                    return (
                      <tr key={e.id} style={{ borderTop: "1px solid var(--nx-border-divider)", opacity: e.active ? 1 : 0.62 }}>
                        <td className="px-2 py-1.5">{cropName[e.cropId] ?? e.cropId}</td>
                        <td className="px-2 py-1.5" title={e.quelle ?? ""}>
                          {t(e.label)}
                          <span className="ml-1.5 text-[10px] text-nx-text-muted">{machineLabel[e.machineId]?.replace(/\s*\(.*/, "") ?? e.machineId}</span>
                        </td>
                        <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtNumber(passes, passes % 1 ? 1 : 0)}</td>
                        <td className="px-2 py-1.5 text-right">
                          <NumberInput value={e.ratePerHaCent} moneyCent width={72}
                            onCommit={(v) => upd(e.id, (x) => { x.ratePerHaCent = Math.max(0, Math.round(v)); })} />
                        </td>
                        <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(perHaJahr)}</td>
                        <td className="px-2 py-1.5 text-right">
                          <select className="rounded-control border px-1 text-[11px]" style={{ height: 26, borderColor: "var(--nx-border)", background: "var(--nx-surface)", color: "var(--nx-text)" }}
                            value={e.fromYear ?? 0}
                            onChange={(ev) => upd(e.id, (x) => { x.fromYear = parseInt(ev.target.value, 10); })}>
                            {yearOpts.map((y) => <option key={y} value={y}>{START_YEAR + y}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <select className="rounded-control border px-1 text-[11px]" style={{ height: 26, borderColor: "var(--nx-border)", background: "var(--nx-surface)", color: "var(--nx-text)" }}
                            value={e.toYear ?? -1}
                            onChange={(ev) => upd(e.id, (x) => { const v = parseInt(ev.target.value, 10); if (v < 0) delete x.toYear; else x.toYear = v; })}>
                            <option value={-1}>{t("dauerhaft")}</option>
                            {yearOpts.map((y) => <option key={y} value={y}>{START_YEAR + y}</option>)}
                          </select>
                        </td>
                        <td className="num px-2 py-1.5 text-right" style={{ color: kosten0 ? "var(--nx-locate)" : "var(--nx-text-muted)" }}>
                          {kosten0 ? fmtMoney(kosten0) : "–"}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <input type="checkbox" checked={e.active}
                            onChange={(ev) => upd(e.id, (x) => { x.active = ev.target.checked; })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
              {t("Sätze mit Quellenangabe stammen aus den Erfahrungssätzen der Landwirtschaftskammer NRW (2024, Spalte „ohne Kraftstoff\", Fahrer enthalten). Positionen ohne öffentlichen Anker sind Schätzungen — beim Überfahren des Arbeitsgangs steht die Herkunft.")}
            </div>
          </section>
        );
      })}
    </div>
  );
}
