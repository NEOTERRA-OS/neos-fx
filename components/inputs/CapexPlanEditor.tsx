"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { NumberInput, TextInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import type { CapexBlock, CapexDriverMode, AnlagenKlasse, CapexPlanItem } from "../../store/model";

const BLOCKS: { id: CapexBlock; label: string; hint: string; auto?: string }[] = [
  { id: "maschinen", label: "Maschinen & Fahrzeuge — Jahres-Planung", hint: "NUR für Maschinen, die NICHT im Register/Bedarf stehen (LKW, Radlader etc. dort planen — sonst doppelt!). Diskrete Zukäufe je Planjahr (Jahr 0 = 2026), mit AfA/FK/Zuschuss", auto: "additiv; zählt erst mit aktiver Detailplanung" },
  { id: "bewaesserung", label: "Bewässerung / Wasser-Infrastruktur", hint: "Pivots, Verrohrung, Pumpen, Brunnen, Reservoir, Filtration, Strom, SCADA", auto: "ersetzt den Auto-Beregnungsausbau (€/ha)" },
  { id: "lager", label: "Lager (Kartoffel + Zwiebel/Möhre)", hint: "Schütt-/Kühl-/CA-Lager, Curing, Gebäudehülle — Tomate wird NICHT gelagert", auto: "ersetzt den Auto-Lagerblock (store €/t)" },
  { id: "packhaus", label: "Packhaus / Aufbereitungslinien", hint: "Waschen, Sortieren/Grading, Verpackung, Palettierung", auto: "rein additiv (kein Auto-Block)" },
  { id: "gebaeude", label: "Gebäude & allgemeine Infrastruktur", hint: "Hallen, Werkstatt, Silos, Tankanlage, Wiegebrücke, PV, Wege, Zaun", auto: "rein additiv (kein Auto-Block)" },
];
const DRIVERS: { id: CapexDriverMode; unit: string }[] = [
  { id: "fix", unit: "pauschal" }, { id: "perHa", unit: "ha" }, { id: "perTonne", unit: "t" },
  { id: "perM2", unit: "m²" }, { id: "perM3", unit: "m³" }, { id: "perStueck", unit: "Stück" },
  { id: "perKWp", unit: "kWp" }, { id: "perLfm", unit: "lfm" },
];
const KLASSEN: { id: AnlagenKlasse; label: string }[] = [
  { id: "bau", label: "Bau" }, { id: "infrastruktur", label: "Infrastruktur" }, { id: "technik", label: "Technik" }, { id: "elektronik", label: "Elektronik" },
];
/** Investitionskategorie → Anlagenklasse/Bilanzierung (machinery/other/buildings/irrigation). */
const KATEGORIEN: { id: NonNullable<CapexPlanItem["kategorie"]>; label: string }[] = [
  { id: "maschinen", label: "Maschinen" }, { id: "iot", label: "IoT / Sonstige" },
  { id: "gebaeude", label: "Gebäude" }, { id: "bewaesserung", label: "Bewässerung" },
];
const DEFAULT_KAT: Record<CapexBlock, NonNullable<CapexPlanItem["kategorie"]>> = {
  maschinen: "maschinen", bewaesserung: "bewaesserung", lager: "gebaeude", packhaus: "gebaeude", gebaeude: "gebaeude",
};
const STORE_CROPS: { key: string; label: string }[] = [
  { key: "store.share.kartoffel_pommes", label: "Kartoffel Pommes" },
  { key: "store.share.kartoffel_chips", label: "Kartoffel Chips" },
  { key: "store.share.zwiebel_moehre", label: "Zwiebel / Möhre" },
];

let _uid = 0;
const newId = () => `plan-${Date.now().toString(36)}-${_uid++}`;

export function CapexPlanEditor({ blocks }: { blocks?: CapexBlock[] } = {}) {
  const domain = useModelStore((s) => s.domain);
  const patch = useModelStore((s) => s.patch);
  const sc = useModelStore((s) => s.view.scenarioId);
  const plan = domain.capexPlan ?? [];
  const active = domain.capexPlanActive ?? {};
  const shownBlocks = blocks ? BLOCKS.filter((b) => blocks.includes(b.id)) : BLOCKS;

  const setActive = (b: CapexBlock, on: boolean) => patch((d) => { d.capexPlanActive = { ...(d.capexPlanActive ?? {}), [b]: on }; });
  const upd = (id: string, p: Partial<CapexPlanItem>) => patch((d) => { const it = (d.capexPlan ?? []).find((x) => x.id === id); if (it) Object.assign(it, p); });
  const add = (b: CapexBlock) => patch((d) => {
    const item: CapexPlanItem = { id: newId(), block: b, bezeichnung: "Neue Position", anlagenklasse: "technik", driver: "fix", menge: 1, einheit: "pauschal", eurProEinheitCent: 0, afaYears: 15, restwertPct: 0.1, jahr: 1, fkQuote: 0.5, zins: 0.05, laufzeitJahre: 15, subventionPct: 0, bestand: false };
    d.capexPlan = [...(d.capexPlan ?? []), item];
  });
  const dup = (id: string) => patch((d) => { const arr = d.capexPlan ?? []; const it = arr.find((x) => x.id === id); if (it) d.capexPlan = [...arr, { ...it, id: newId(), bezeichnung: it.bezeichnung + " (Kopie)" }]; });
  const del = (id: string) => patch((d) => { d.capexPlan = (d.capexPlan ?? []).filter((x) => x.id !== id); });

  const readShare = (key: string): number => {
    const a = domain.assumptions[key]; const p = a?.scenarioProfiles?.[sc] ?? a?.scenarioProfiles?.[domain.baseScenarioId];
    return p && p.kind === "constant" ? (p as any).value : 1;
  };
  const setShare = (key: string, v: number) => patch((d) => { if (d.assumptions[key]) d.assumptions[key].scenarioProfiles[d.baseScenarioId] = { kind: "constant", value: Math.max(0, Math.min(1, v)) }; });

  const netOf = (it: CapexPlanItem) => it.bestand ? 0 : Math.round(it.menge * it.eurProEinheitCent * (1 - Math.max(0, Math.min(1, it.subventionPct))));
  const shownIds = new Set(shownBlocks.map((b) => b.id));
  const scoped = plan.filter((x) => shownIds.has(x.block));
  const blockSum = (b: CapexBlock) => plan.filter((x) => x.block === b).reduce((s, x) => s + netOf(x), 0);
  const activeTotal = scoped.filter((x) => active[x.block]).reduce((s, x) => s + netOf(x), 0);
  const planTotal = scoped.reduce((s, x) => s + netOf(x), 0);

  const border = "var(--nx-border)", surface = "var(--nx-surface)";
  // Kopfzeile beim Scrollen fixieren (sticky, opaker Surface-Hintergrund).
  const th = "sticky top-0 z-10 bg-[color:var(--nx-surface)] px-2 py-1.5 caption text-[9.5px] text-nx-text-muted text-left whitespace-nowrap";
  const Pct = ({ v, on }: { v: number; on: (n: number) => void }) => <NumberInput value={Math.round(v * 1000) / 10} width={58} suffix="%" onCommit={(n) => on(n / 100)} />;

  return (
    <div className="space-y-4">
      {/* Generischer Intro-Header nur in der UNGEFILTERTEN Gesamtansicht — in den Kategorie-Tabs
          (Maschinen/Bewässerung/Lager/Gebäude) erklärt sich jeder Block selbst. */}
      {!blocks && (
        <section className="rounded-tile border" style={{ borderColor: border, background: surface }}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: border }}>
            <h2 className="text-[14px] font-semibold">{t("Infrastruktur-CAPEX — Detailplanung (editierbar & erweiterbar)")}</h2>
            <span className="caption text-[10.5px] text-nx-text-muted">{t("Aktive Blöcke Σ")} <b className="num">{fmtMoney(activeTotal)} €</b> · {t("Gesamtplan")} <b className="num">{fmtMoney(planTotal)} €</b></span>
          </div>
          <p className="px-4 py-2.5 text-[11.5px] text-nx-text-secondary leading-relaxed">
            {t("Jeder Block hat einen Schalter")} <b>{t("Detailplanung aktiv")}</b>{t(": aktiv → die Zeilen zählen im Modell und der jeweilige Auto-Block (Beregnung €/ha bzw. Lager €/t) wird abgeschaltet (kein Doppelzählen); inaktiv → der Auto-Block läuft und die Zeilen sind reine Planung. Netto-CAPEX = Menge × €/Einheit × (1 − Zuschuss);")} <code>Bestand</code> {t("= 0. Werte sind mit EU/RO-Benchmarks 2025/26 vorbefüllt — auf eure Angebote anpassen.")}
          </p>
        </section>
      )}

      {shownBlocks.map((blk) => {
        const rows = plan.filter((x) => x.block === blk.id);
        const on = !!active[blk.id];
        return (
          <section key={blk.id} className="rounded-tile border overflow-hidden" style={{ borderColor: border, background: surface }}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: border, background: on ? "color-mix(in srgb, var(--nsb-accent) 10%, transparent)" : "transparent" }}>
              <div>
                <h3 className="text-[13px] font-semibold">{t(blk.label)}</h3>
                <div className="caption text-[10px] text-nx-text-muted">{t(blk.hint)} · <i>{blk.auto ? t(blk.auto) : ""}</i></div>
              </div>
              <div className="flex items-center gap-3">
                <span className="num text-[12px] font-semibold">{fmtMoney(blockSum(blk.id))} €</span>
                <label className="flex items-center gap-1.5 text-[11.5px] cursor-pointer select-none">
                  <input type="checkbox" checked={on} onChange={(e) => setActive(blk.id, e.target.checked)} />
                  <span className={on ? "font-semibold" : "text-nx-text-muted"}>{t("Detailplanung aktiv")}</span>
                </label>
              </div>
            </div>

            {/* Einlagerungsquote-Panel nur im Lager-Block */}
            {blk.id === "lager" && (
              <div className="px-4 py-2.5 border-b flex flex-wrap items-center gap-x-5 gap-y-2" style={{ borderColor: border, background: "var(--nx-surface-sunken)" }}>
                <span className="caption text-[10.5px] text-nx-text-muted">{t("Einlagerungsquote (Rest fährt direkt Feld → Verarbeiter, keine Lager-CAPEX):")}</span>
                {STORE_CROPS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-[11.5px]"><span className="text-nx-text-secondary">{t(c.label)}</span><Pct v={readShare(c.key)} on={(n) => setShare(c.key, n)} /></label>
                ))}
              </div>
            )}

            <div className="px-2 py-2" style={{ maxHeight: "calc(100vh - 300px)", overflow: "auto" }}>
              <table className="w-full" style={{ minWidth: 1180 }}>
                <thead><tr>
                  <th className={th} style={{ minWidth: 210 }}>{t("Bezeichnung")}</th>
                  <th className={th}>{t("Kategorie")}</th>
                  <th className={th}>{t("Klasse")}</th>
                  <th className={th}>{t("Treiber")}</th>
                  <th className={th + " text-right"}>{t("Menge")}</th>
                  <th className={th}>{t("Einheit")}</th>
                  <th className={th + " text-right"}>{t("€/Einheit")}</th>
                  <th className={th + " text-right"}>{t("AfA J.")}</th>
                  <th className={th + " text-right"}>{t("Jahr")}</th>
                  <th className={th + " text-right"}>{t("FK")}</th>
                  <th className={th + " text-right"}>{t("Zuschuss")}</th>
                  <th className={th + " text-right"}>{t("Restw.")}</th>
                  <th className={th + " text-center"}>{t("Best.")}</th>
                  <th className={th + " text-right"}>{t("Netto-CAPEX")}</th>
                  <th className={th}></th>
                </tr></thead>
                <tbody>
                  {rows.map((it) => {
                    const outOfBench = !it.bestand && it.benchMinCent != null && it.benchMaxCent != null && (it.eurProEinheitCent < it.benchMinCent || it.eurProEinheitCent > it.benchMaxCent);
                    return (
                      <tr key={it.id} style={{ borderTop: "1px solid var(--nx-border-divider)", opacity: on ? 1 : 0.62 }}>
                        <td className="px-2 py-1"><TextInput value={it.bezeichnung} width={200} onCommit={(s) => upd(it.id, { bezeichnung: s })} /></td>
                        <td className="px-2 py-1">
                          <select className="rounded-control border text-[11.5px]" style={{ background: "var(--nx-app-bg)", borderColor: border, height: 34 }} value={it.kategorie ?? DEFAULT_KAT[it.block]} onChange={(e) => upd(it.id, { kategorie: e.target.value as CapexPlanItem["kategorie"] })}>
                            {KATEGORIEN.map((k) => <option key={k.id} value={k.id}>{t(k.label)}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <select className="rounded-control border text-[11.5px]" style={{ background: "var(--nx-app-bg)", borderColor: border, height: 34 }} value={it.anlagenklasse} onChange={(e) => upd(it.id, { anlagenklasse: e.target.value as AnlagenKlasse })}>
                            {KLASSEN.map((k) => <option key={k.id} value={k.id}>{t(k.label)}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <select className="rounded-control border text-[11.5px]" style={{ background: "var(--nx-app-bg)", borderColor: border, height: 34 }} value={it.driver}
                            onChange={(e) => { const dv = e.target.value as CapexDriverMode; const u = DRIVERS.find((x) => x.id === dv)?.unit ?? it.einheit; upd(it.id, { driver: dv, einheit: u }); }}>
                            {DRIVERS.map((k) => <option key={k.id} value={k.id}>{k.id}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-right"><NumberInput value={it.menge} width={82} onCommit={(n) => upd(it.id, { menge: Math.max(0, n) })} /></td>
                        <td className="px-2 py-1"><TextInput value={it.einheit} width={64} onCommit={(s) => upd(it.id, { einheit: s })} /></td>
                        <td className="px-2 py-1 text-right">
                          <NumberInput value={it.eurProEinheitCent} moneyCent width={96} onCommit={(n) => upd(it.id, { eurProEinheitCent: Math.max(0, n) })} />
                          {outOfBench && <div className="caption text-[9px]" style={{ color: "var(--nx-neg, #C62828)" }} title={`${t("Benchmark")} ${fmtMoney(it.benchMinCent!)}–${fmtMoney(it.benchMaxCent!)} €`}>{t("⚠ außerh. Benchmark")}</div>}
                        </td>
                        <td className="px-2 py-1 text-right"><NumberInput value={it.afaYears} width={52} onCommit={(n) => upd(it.id, { afaYears: Math.max(1, Math.round(n)) })} /></td>
                        <td className="px-2 py-1 text-right"><NumberInput value={it.jahr} width={48} onCommit={(n) => upd(it.id, { jahr: Math.max(0, Math.round(n)) })} /></td>
                        <td className="px-2 py-1 text-right"><Pct v={it.fkQuote} on={(n) => upd(it.id, { fkQuote: n })} /></td>
                        <td className="px-2 py-1 text-right"><Pct v={it.subventionPct} on={(n) => upd(it.id, { subventionPct: n })} /></td>
                        <td className="px-2 py-1 text-right"><Pct v={it.restwertPct} on={(n) => upd(it.id, { restwertPct: n })} /></td>
                        <td className="px-2 py-1 text-center"><input type="checkbox" checked={it.bestand} onChange={(e) => upd(it.id, { bestand: e.target.checked })} title={t("Bestand → kein Neu-CAPEX")} /></td>
                        <td className="px-2 py-1 text-right num font-semibold">{it.bestand ? "–" : fmtMoney(netOf(it))}</td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          <button onClick={() => dup(it.id)} className="text-[13px] px-1 text-nx-text-muted hover:text-nx-text" title={t("Duplizieren")}>⧉</button>
                          <button onClick={() => del(it.id)} className="text-[13px] px-1" style={{ color: "var(--nx-neg, #C62828)" }} title={t("Löschen")}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && <tr><td colSpan={15} className="px-3 py-3 text-[11.5px] text-nx-text-muted">{t("Noch keine Position — „+ Position\" nutzen.")}</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 border-t" style={{ borderColor: border }}>
              <button onClick={() => add(blk.id)} className="px-2.5 py-1 rounded-md text-[12px] border" style={{ borderColor: border }}>{t("+ Position")}</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
