"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { START_YEAR, type CapexPlanItem, type CapexBlock } from "../../store/model";
import { fmtMoney } from "../../design/format";
import { NumberInput, TextInput } from "./NumberInput";
import { t } from "../../lib/i18n";
import { Plus, X, AlertTriangle } from "lucide-react";

/**
 * WAS GEKAUFT WIRD — an einer Stelle, für alle fünf CAPEX-Blöcke.
 *
 * DER BEFUND VOM 04.08.2026. `domain.capexPlan` trug 27 Positionen in fünf
 * Blöcken. Einen Editor hatte davon GENAU EINER: „Weitere Anschaffungen" im
 * Maschinenpark, hart auf `block === "maschinen"` gefiltert — also auf eine
 * einzige Zeile (das FMS/IoT-Paket). Die übrigen 26 — Pivots, Mainlines,
 * Brunnen, Schüttlager, Kühllager, Curing, Gebäudehülle, fünf Packhauslinien,
 * Maschinenhalle, Werkstatt, Tankanlage, Bürogebäude, Hofbefestigung,
 * Wiegebrücke, PV, Zaun — standen im Modell, erschienen in der Eröffnungs-
 * bilanz und im CAPEX-Phasing, und waren von KEINER Ansicht aus änderbar.
 *
 * Zugleich standen `jahr` und `fkQuote` derselben Zeilen ein zweites Mal in der
 * Finanzierung, dort mit anderem Bedienelement (Zahlenfeld statt Auswahl) und
 * ohne Hinweis, dass es dasselbe Feld ist. Wer beide Seiten offen hatte, sah
 * zwei Wahrheiten und musste raten, welche gilt.
 *
 * DIE GRENZE, DIE JETZT GILT — und sie ist keine Geschmacksfrage:
 *
 *   HIER          was, wie viel, wann, wie lange abgeschrieben, welcher
 *                 Zuschuss. Das ist die INVESTITIONSENTSCHEIDUNG.
 *   FINANZIERUNG  FK-Quote, Zins, Laufzeit. Das ist die MITTELHERKUNFT.
 *
 * Dieselbe Position, zwei Fragen, zwei Orte — aber jedes Feld nur an einem.
 * Das Anschaffungsjahr steht in der Finanzierung deshalb nur noch als Anzeige.
 */

export const BLOCK_LABEL: Record<CapexBlock, string> = {
  bewaesserung: "Bewässerung & Wasser-Infrastruktur",
  lager: "Lager (Schütt · Kühl/CA · Curing · Hülle)",
  packhaus: "Packhaus & Aufbereitungslinien",
  gebaeude: "Gebäude & allgemeine Infrastruktur",
  maschinen: "Maschinen & Technik (frei geplant)",
};

const netOf = (it: CapexPlanItem) =>
  it.bestand ? 0 : Math.round(it.menge * it.eurProEinheitCent * (1 - Math.max(0, Math.min(1, it.subventionPct))));

/** Liegt der Einheitspreis außerhalb des recherchierten Benchmarks? */
function ausserhalb(it: CapexPlanItem): string | null {
  const p = it.eurProEinheitCent;
  if (it.benchMinCent != null && p < it.benchMinCent)
    return `${t("unter Benchmark")} (${fmtMoney(it.benchMinCent)}–${fmtMoney(it.benchMaxCent ?? it.benchMinCent)} €)`;
  if (it.benchMaxCent != null && p > it.benchMaxCent)
    return `${t("über Benchmark")} (${fmtMoney(it.benchMinCent ?? 0)}–${fmtMoney(it.benchMaxCent)} €)`;
  return null;
}

/**
 * Ein Block als Tabelle.
 *
 * `scharf` ist die Hybridlogik des Modells und der Grund für den auffälligen
 * Schalter: entweder der pauschale Auto-Block rechnet, oder diese Detailzeilen —
 * nie beides, sonst steht dieselbe Investition zweimal in der Bilanz.
 */
export function CapexBlockTabelle({ block, hinweis }: { block: CapexBlock; hinweis?: string }) {
  const { domain, patch } = useModelStore();
  const readOnly = useModelStore((s) => s.readOnly);
  const years = Math.max(1, domain.growth?.years ?? 1);
  const zeilen = (domain.capexPlan ?? []).filter((it) => it.block === block);
  const scharf = domain.capexPlanActive?.[block] ?? false;

  const upd = (id: string, fn: (it: CapexPlanItem) => void) => patch((d) => {
    const it = (d.capexPlan ?? []).find((x) => x.id === id); if (it) fn(it);
  });
  const add = () => patch((d) => {
    d.capexPlan = d.capexPlan ?? [];
    /* Die ID zählt eine LAUFENDE Nummer hoch und leitet sich NICHT aus der
     *  Position in der Liste ab — sonst zeigt jede Rückmeldung nach dem
     *  Löschen einer Zeile auf die falsche Investition. */
    const max = Math.max(0, ...d.capexPlan.map((x) => Number(/(\d+)$/.exec(x.id)?.[1] ?? 0)));
    d.capexPlan.push({
      id: `cx-${max + 1}`, block, bezeichnung: t("Neue Position"), anlagenklasse: "technik",
      driver: "perStueck", menge: 1, einheit: "Stk", eurProEinheitCent: 0,
      afaYears: 10, restwertPct: 0.1, jahr: 0, fkQuote: 0.5, zins: 0.05, laufzeitJahre: 10,
      subventionPct: 0, bestand: false,
    });
  });
  const del = (id: string) => patch((d) => { d.capexPlan = (d.capexPlan ?? []).filter((x) => x.id !== id); });

  const summe = zeilen.reduce((s, it) => s + netOf(it), 0);
  const th = "px-2 py-2 caption text-[10px] text-nx-text-muted";

  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
        <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t(BLOCK_LABEL[block])}</h3>
        <span className="caption text-[10.5px] text-nx-text-muted">{zeilen.length} {t("Positionen")}</span>
        <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold"
          style={{ color: scharf ? "var(--nx-green)" : "var(--nx-text-muted)" }}
          title={t("Nur scharfgeschaltete Blöcke fließen in CAPEX, Bilanz und Finanzierung. Ausgeschaltet sind sie reine Planung — dann rechnet der pauschale Auto-Block.")}>
          <input type="checkbox" checked={scharf} disabled={readOnly}
            onChange={(e) => patch((d) => { d.capexPlanActive = { ...(d.capexPlanActive ?? {}), [block]: e.target.checked }; })} />
          {scharf ? t("zählt im Modell") : t("nur Planung")}
        </label>
        <span className="num text-[13px] font-semibold" style={{ color: scharf ? "var(--nx-brand-lift)" : "var(--nx-text-muted)" }}>
          {fmtMoney(summe)} €
        </span>
      </div>
      {hinweis && (
        <div className="border-b px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border-divider)" }}>{t(hinweis)}</div>
      )}
      <div className="overflow-x-auto px-2 py-1">
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <th className={th + " text-left"} style={{ minWidth: 310 }}>{t("Position")}</th>
              <th className={th + " text-right"}>{t("Menge")}</th>
              <th className={th + " text-left"}>{t("Einheit")}</th>
              <th className={th + " text-right"}>{t("€/Einheit")}</th>
              <th className={th + " text-right"}>{t("Jahr")}</th>
              <th className={th + " text-right"}>{t("AfA")}</th>
              <th className={th + " text-right"}>{t("Zuschuss")}</th>
              <th className={th + " text-center"}>{t("Bestand")}</th>
              <th className={th + " text-right"}>{t("netto")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {zeilen.map((it) => {
              const warn = ausserhalb(it);
              return (
                <tr key={it.id} style={{ borderTop: "1px solid var(--nx-border-divider)", opacity: it.bestand ? 0.55 : 1 }}>
                  <td className="px-2 py-1.5">
                    <TextInput value={it.bezeichnung} width={300} onCommit={(v) => upd(it.id, (x) => { x.bezeichnung = v; })} />
                    {it.notiz && <div className="text-[10px] text-nx-text-muted" style={{ maxWidth: 380 }}>{it.notiz}</div>}
                  </td>
                  <td className="px-1 py-1.5 text-right"><NumberInput value={it.menge} width={60} onCommit={(v) => upd(it.id, (x) => { x.menge = Math.max(0, v); })} /></td>
                  <td className="px-1 py-1.5"><TextInput value={it.einheit} width={54} onCommit={(v) => upd(it.id, (x) => { x.einheit = v; })} /></td>
                  <td className="px-1 py-1.5 text-right">
                    <span className="inline-flex items-center gap-1">
                      <NumberInput value={it.eurProEinheitCent} unit="money" width={92} onCommit={(v) => upd(it.id, (x) => { x.eurProEinheitCent = Math.max(0, v); })} />
                      {warn && <span title={warn} className="inline-flex"><AlertTriangle size={12} aria-hidden style={{ color: "var(--nx-warning-text)" }} /></span>}
                    </span>
                  </td>
                  <td className="px-1 py-1.5 text-right">
                    <select value={it.jahr} disabled={readOnly}
                      className="rounded-control border px-1 text-[11.5px]"
                      style={{ height: 28, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)" }}
                      onChange={(e) => upd(it.id, (x) => { x.jahr = parseInt(e.target.value, 10); })}>
                      {Array.from({ length: years }, (_, y) => <option key={y} value={y}>{START_YEAR + y}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1.5 text-right"><NumberInput value={it.afaYears} unit="years" suffix="" width={44} onCommit={(v) => upd(it.id, (x) => { x.afaYears = Math.max(1, Math.round(v)); })} /></td>
                  <td className="px-1 py-1.5 text-right">
                    {/* ROHWERT hinein, NICHT vorher mit 100 multiplizieren: `unit="percent"`
                        rechnet selbst um (design/units.ts, Faktor 100). Der alte Aufruf im
                        Maschinenpark tat beides und zeigte aus 25 % „2.500,00 %" — im eigenen
                        Screenshot-Review am 04.08.2026 aufgefallen. */}
                    <NumberInput value={it.subventionPct} width={54} unit="percent"
                      onCommit={(v) => upd(it.id, (x) => { x.subventionPct = Math.max(0, Math.min(1, v)); })} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" checked={it.bestand} disabled={readOnly}
                      title={t("bereits vorhanden — kein Neu-CAPEX")}
                      onChange={(e) => upd(it.id, (x) => { x.bestand = e.target.checked; })} />
                  </td>
                  <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(netOf(it))}</td>
                  <td className="px-1 py-1.5 text-right">
                    {!readOnly && <button title={t("Position entfernen")} className="text-nx-text-muted hover:text-nx-error" onClick={() => del(it.id)}><X size={12} /></button>}
                  </td>
                </tr>
              );
            })}
            {!zeilen.length && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-[12px] text-nx-text-muted">{t("Noch keine Position in diesem Block.")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 border-t px-4 py-2" style={{ borderColor: "var(--nx-border)" }}>
        {!readOnly && (
          <button className="inline-flex items-center gap-1.5 rounded-control border px-3 text-[11.5px] font-semibold"
            style={{ height: 28, borderColor: "var(--nx-brand-lift)", color: "var(--nx-brand-lift)" }} onClick={add}>
            <Plus size={12} strokeWidth={2.5} aria-hidden />{t("Position hinzufügen")}
          </button>
        )}
        <span className="text-[10.5px] text-nx-text-muted">
          {t("Anschaffungsjahr steuert das Phasing, AfA die Abschreibung, Zuschuss mindert die Aktivierung. FK-Quote, Zins und Laufzeit stehen in der Finanzierung — dieselbe Position, andere Frage.")}
        </span>
      </div>
    </section>
  );
}

/** Mehrere Blöcke untereinander — die Reihenfolge ist die des Bauablaufs. */
export function CapexPositionen({ blocks, hinweise }: { blocks: CapexBlock[]; hinweise?: Partial<Record<CapexBlock, string>> }) {
  return (
    <div className="space-y-4">
      {blocks.map((b) => <CapexBlockTabelle key={b} block={b} hinweis={hinweise?.[b]} />)}
    </div>
  );
}
