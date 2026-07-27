"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import type { Domain, CatalogEntry } from "../../store/model";
import { fmtMoney, fmtNumber, fmtEditable, parseDe } from "../../design/format";
import { AssumptionGroupCards } from "./AssumptionGroupCards";
import { AnbauAnalysePanel } from "./AnbauAnalysePanel";
import { AnbauWhatIfPanel } from "./AnbauWhatIfPanel";
import { cropYield, cropLoss, netTonnes, cropColor, cropName } from "./cropCalc";
import { deriveCropAreasMY, effectiveGrowth, scopedDomain, type CropPolicy } from "../../store/model";
import { t } from "../../lib/i18n";

/** Feldkosten €/ha einer Kultur = Σ opLine (Menge/ha × Stücksatz), aus dem KATALOG gezogen. */
function fieldCostPerHaCent(domain: Domain, entry: CatalogEntry, scenarioId: string): number {
  let c = 0;
  for (const op of entry.ops) for (const l of op.lines) {
    const unit = readAssumption(domain, l.unitCostKey, scenarioId) ?? 0;
    c += l.quantityPerHa * unit;
  }
  return c;
}

function NumCell({ value, onCommit, width = 90, suffix }: { value: number; onCommit: (n: number) => void; width?: number; suffix?: string }) {
  const [t, setT] = React.useState(fmtEditable(value));
  React.useEffect(() => setT(fmtEditable(value)), [value]);
  return (
    <span className="inline-flex items-center gap-1">
      <input className="num rounded-control border px-2 text-right text-[12.5px]"
        style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600, height: 34, width }}
        value={t} inputMode="decimal"
        onChange={(e) => setT(e.target.value)}
        onBlur={(e) => { const n = parseDe(e.target.value); if (n !== null) onCommit(n); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      {suffix && <span className="text-[11px] text-nx-text-muted">{suffix}</span>}
    </span>
  );
}

/** Beregnungs-Badge: beregnet (💧) vs. trocken (☀) — kennzeichnet Zeilen in der Anbau-Tabelle. */
function BeregBadge({ kind }: { kind: "beregnet" | "trocken" }) {
  const beregnet = kind === "beregnet";
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style={{
        background: beregnet ? "color-mix(in srgb, var(--nx-locate) 14%, transparent)" : "color-mix(in srgb, var(--nx-warn, #C9A227) 16%, transparent)",
        color: beregnet ? "var(--nx-locate)" : "var(--nx-warn, #C9A227)",
      }}>
      {beregnet ? "💧" : "☀"} {beregnet ? t("beregnet") : t("trocken")}
    </span>
  );
}

/** Variabler Anbauplan: Kultur × Fläche × Zeitfenster. Kosten werden je Zeile aus dem
 *  Kostenkatalog gezogen und auf die Fläche skaliert (× areaHa). */
export function AnbauplanView() {
  const { domain, view, patch } = useModelStore();
  const sc = view.scenarioId;
  const [tab, setTab] = React.useState<"anbau" | "ertraege" | "preise">("anbau");
  // Stufe 1 (s1a): reiner Ackerbau-Benchmark → abgeleitete Cash-Crop-Rotation (schreibgeschützt).
  //  Sonst: der editierbare Basis-Anbauplan (mit Wertkulturen).
  const stageCashOnly = domain.growth?.stage === "s1a";
  const planDomain = stageCashOnly ? scopedDomain(domain) : domain;
  const plan = planDomain.anbauplan;
  const totalHa = plan.reduce((a, e) => a + e.areaHa, 0);
  const totalAgroCent = plan.reduce((a, e) => {
    const entry = planDomain.catalog.find((c) => c.cropId === e.cropId);
    return a + (entry ? fieldCostPerHaCent(planDomain, entry, sc) : 0) * e.areaHa;
  }, 0);
  const avgPerHaCent = totalHa > 0 ? totalAgroCent / totalHa : 0;

  // ── Trockenrotation (unberegnet): 2. Block. Fläche = Gesamtbetrieb − beregnete Fläche,
  //    aufgeteilt nach growth.drylandRotation. Stufenabhängig über effectiveGrowth (Basisjahr y0).
  //    Der DB steckt bereits in der Engine (buildModelState, alle Jahre) — hier nur die Anzeige.
  const eff = effectiveGrowth(domain.growth);
  const irrHa0 = Math.round(eff?.areaByYear?.[0] ?? totalHa);
  const totFarmHa0 = Math.round(eff?.totalByYear?.[0] ?? eff?.startTotalHa ?? irrHa0);
  const dryHa = Math.max(0, totFarmHa0 - irrHa0);
  const dryRot = eff?.drylandRotation ?? [];
  const dryRows = dryRot.map((r) => {
    const cat = domain.catalog.find((c) => c.cropId === r.cropId);
    const ha = Math.round(r.sharePct * dryHa);
    return { cropId: r.cropId, name: r.label ?? cat?.name ?? cropName(r.cropId), ha, dbCent: r.dbPerHaCent, sumCent: Math.round(ha * r.dbPerHaCent), sharePct: r.sharePct, plant: cat?.plantingPeriod, harvest: cat?.harvestPeriods ?? [] };
  });
  const dryTotHa = dryRows.reduce((a, r) => a + r.ha, 0);
  const dryTotDb = dryRows.reduce((a, r) => a + r.sumCent, 0);
  const showDry = dryHa > 0 && dryRows.length > 0;

  return (
    <div className="space-y-4">
    <div className="flex items-center gap-1 rounded-tile border p-1" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)", width: "fit-content" }}>
      {([["anbau", t("Anbauplan")], ["ertraege", t("Erträge")], ["preise", t("Preise")]] as const).map(([id, label]) => (
        <button key={id} onClick={() => setTab(id)} className="rounded-control px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors"
          style={tab === id ? { background: "var(--nx-yellow)", color: "var(--nx-green)" } : { color: "var(--nx-text-secondary)", background: "transparent" }}>{label}</button>
      ))}
    </div>

    {tab === "anbau" && (<>
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <div>
          <h2 className="text-[14px] font-semibold">{stageCashOnly ? t("Anbauplan (Stufe 1: reiner Ackerbau)") : t("Anbauplan — Kulturen & Flächen")}</h2>
          <div className="text-[10.5px] text-nx-text-muted">{showDry ? t("Beregnete Kulturen + unberegnete Trockenrotation in einer Tabelle. Agronomie aus dem Katalog; Trockenfläche als Netto-Deckungsbeitrag.") : t("Agronomie-Kosten aus dem Katalog (Maschinen separat).")}</div>
        </div>
        <span className="caption text-[10.5px] text-nx-text-muted">{t("Gesamtbetrieb · Σ")} {fmtNumber(totalHa + dryTotHa, 0)} ha</span>
      </div>
      {stageCashOnly && (
        <div className="border-b px-4 py-2 text-[11px]" style={{ borderColor: "var(--nx-border)", background: "color-mix(in srgb, var(--nx-warn, #C9A227) 12%, transparent)", color: "var(--nx-warn, #C9A227)" }}>
          {t("Stufe 1 zeigt die abgeleitete Benchmark-Rotation (reiner Ackerbau, ohne Wertkulturen) — schreibgeschützt. Zum Bearbeiten des Basis-Plans Stufe 1a / 2b / 3c wählen.")}
        </div>
      )}
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="caption text-[10.5px] text-nx-text-muted">
              <th className="px-2 py-2 text-left">{t("Kultur")}</th>
              <th className="px-2 py-2 text-left">{t("Beregnung")}</th>
              <th className="px-2 py-2 text-right">{t("Fläche")}</th>
              <th className="px-2 py-2 text-right">{t("Pflanzung (M)")}</th>
              <th className="px-2 py-2 text-right">{t("Ernte (M)")}</th>
              <th className="px-2 py-2 text-right">{t("€/ha")}</th>
              <th className="px-2 py-2 text-right">{t("Σ €")}</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {plan.map((e, i) => {
              const entry = planDomain.catalog.find((c) => c.cropId === e.cropId);
              const perHa = entry ? fieldCostPerHaCent(planDomain, entry, sc) : 0;
              const cropLabel = entry?.name ?? cropName(e.cropId);
              return (
                <tr key={e.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-2">
                    {stageCashOnly ? (
                      <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>{cropLabel}</span>
                    ) : (
                      <select className="rounded-control border px-2 text-[12.5px]" style={{ height: 34, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600 }}
                        value={e.cropId}
                        onChange={(ev) => patch((d) => { d.anbauplan[i].cropId = ev.target.value; })}>
                        {domain.catalog.map((c) => <option key={c.cropId} value={c.cropId}>{c.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-2"><BeregBadge kind="beregnet" /></td>
                  <td className="px-2 py-2 text-right">
                    {stageCashOnly
                      ? <span className="num">{fmtNumber(e.areaHa, 0)} ha</span>
                      : <NumCell value={e.areaHa} suffix="ha" onCommit={(n) => patch((d) => { d.anbauplan[i].areaHa = n; })} />}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {stageCashOnly
                      ? <span className="num text-nx-text-secondary">{e.plantingPeriod}</span>
                      : <NumCell value={e.plantingPeriod} width={56} onCommit={(n) => patch((d) => { d.anbauplan[i].plantingPeriod = Math.round(n); })} />}
                  </td>
                  <td className="num px-2 py-2 text-right text-nx-text-secondary">{e.harvestPeriods.join(", ")}</td>
                  <td className="num px-2 py-2 text-right">{fmtMoney(perHa)}</td>
                  <td className="num px-2 py-2 text-right font-semibold">{fmtMoney(perHa * e.areaHa)}</td>
                  <td className="px-2 py-2 text-right">
                    {!stageCashOnly && (
                      <button className="text-[11px] text-nx-error" title={t("Zeile entfernen")}
                        onClick={() => patch((d) => { d.anbauplan.splice(i, 1); })}>✕</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {showDry && dryRows.map((r) => (
              <tr key={`dry-${r.cropId}`} style={{ borderTop: "1px solid var(--nx-border-divider)", background: "color-mix(in srgb, var(--nx-warn, #C9A227) 5%, transparent)" }}>
                <td className="px-2 py-2 font-semibold" style={{ color: "var(--nx-text-secondary)" }}>{r.name}</td>
                <td className="px-2 py-2"><BeregBadge kind="trocken" /></td>
                <td className="num px-2 py-2 text-right">{fmtNumber(r.ha, 0)} ha</td>
                <td className="num px-2 py-2 text-right text-nx-text-secondary">{r.plant ?? "—"}</td>
                <td className="num px-2 py-2 text-right text-nx-text-secondary">{r.harvest.length ? r.harvest.join(", ") : "—"}</td>
                <td className="num px-2 py-2 text-right" title={t("Deckungsbeitrag (netto) — Trockenfläche wird als DB modelliert")} style={{ color: "var(--nx-green)" }}>{fmtMoney(r.dbCent)} <span className="text-[9px] opacity-70">DB</span></td>
                <td className="num px-2 py-2 text-right font-semibold" style={{ color: "var(--nx-green)" }}>{fmtMoney(r.sumCent)}</td>
                <td className="px-2 py-2" />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-2 py-2.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Beregnet ·")} {plan.length} {t("Kulturen")}</td>
              <td className="num px-2 py-2.5 text-right font-semibold">{fmtNumber(totalHa, 0)} ha</td>
              <td className="px-2 py-2.5" colSpan={2} />
              <td className="num px-2 py-2.5 text-right text-nx-text-secondary" title={t("gewichteter Durchschnitt")}>ø {fmtMoney(avgPerHaCent)}</td>
              <td className="num px-2 py-2.5 text-right font-semibold">{fmtMoney(totalAgroCent)}</td>
              <td className="px-2 py-2.5" />
            </tr>
            {showDry && (
              <tr>
                <td className="px-2 py-1.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Trocken ·")} {dryRows.length} {t("Kulturen")}</td>
                <td className="num px-2 py-1.5 text-right font-semibold">{fmtNumber(dryTotHa, 0)} ha</td>
                <td className="px-2 py-1.5" colSpan={3} />
                <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: "var(--nx-green)" }}>{fmtMoney(dryTotDb)} <span className="text-[9px] opacity-70">DB</span></td>
                <td className="px-2 py-1.5" />
              </tr>
            )}
            {showDry && (
              <tr style={{ borderTop: "1px solid var(--nx-border)" }}>
                <td className="px-2 py-2 font-bold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Gesamtbetrieb")}</td>
                <td className="num px-2 py-2 text-right font-bold">{fmtNumber(totalHa + dryTotHa, 0)} ha</td>
                <td className="px-2 py-2 text-[10px] text-nx-text-muted" colSpan={5}>{fmtNumber(totalHa, 0)} {t("beregnet")} + {fmtNumber(dryTotHa, 0)} {t("trocken")}</td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2" style={{ borderColor: "var(--nx-border)" }}>
        {!stageCashOnly && (
          <button
            className="rounded-control border px-3 text-[12px] font-semibold"
            style={{ height: 34, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }}
            onClick={() => patch((d) => {
              const c = d.catalog[0];
              d.anbauplan.push({ id: `ab-${d.anbauplan.length + 1}-${c.cropId}`, cropId: c.cropId, areaHa: 500, plantingPeriod: c.plantingPeriod, harvestPeriods: c.harvestPeriods });
            })}
          >{t("+ Kultur hinzufügen")}</button>
        )}
        <span className="text-[11px] text-nx-text-muted">
          {stageCashOnly
            ? t("Stufe 1: reine Cash-Crop-Rotation (abgeleitet, nicht editierbar).")
            : t("Fläche ändern → Kosten & Maschinen rechnen automatisch nach.")}
          {showDry ? " " + t("Trockenzeilen (☀) sind aus dem Wachstumsplan abgeleitet; DB bereits in EBITDA/Cashflow.") : ""}
        </span>
      </div>
    </section>

    {/* Anbaustruktur & Produktion */}
    <ProduktionsTabelle />

    {/* Kultur-Skalierungspolitik: Wie skaliert jede Kultur über den Flächen-Ramp? */}
    <PolicyPanel />

    {/* Agronomie-Advisor — warum diese Struktur + Bewertung von Änderungen */}
    <AnbauAnalysePanel />

    {/* Was-wäre-wenn — Planänderung gegen Baseline bewerten */}
    <AnbauWhatIfPanel />
    </>)}

    {tab === "ertraege" && (
      <AssumptionGroupCards groups={["Ertrag (t/ha)"]} />
    )}

    {tab === "preise" && (<>
      <AssumptionGroupCards groups={["Preis & Verlust (€/t · %)"]} />
      <AssumptionGroupCards groups={["Kontrakt-Qualität (Erfüllung 0..1)"]} />
    </>)}
    </div>
  );
}

/** Anbaustruktur (ha) & Produktion (t) je Kultur — Fläche × Ertrag × (1−Verlust).
 *  Basisjahr = aktueller Anbauplan (beregneter Kernblock). */
/** Kultur-Skalierungspolitik — wie skaliert jede Kultur über den Flächen-Ramp?
 *  scale = proportional (Residual-Füller) · fix = konstant (Werkskapazität) · ramp = schnellstmöglich
 *  auf Ziel-ha unter der Anbaupause-Grenze (Kartoffel-Gruppe ≤ 25 % der beregneten Fläche). */
function PolicyPanel() {
  const { domain, patch } = useModelStore();
  const my = deriveCropAreasMY(domain);
  const last = my.years - 1;
  const cropIds = [...new Set(domain.anbauplan.map((e) => e.cropId))];
  const setPol = (id: string, p: Partial<CropPolicy>) => patch((d) => {
    const cur = d.cropPolicy?.[id] ?? { mode: "scale" as const };
    d.cropPolicy = { ...(d.cropPolicy ?? {}), [id]: { ...cur, ...p } };
  });
  const border = "var(--nx-border)";
  return (
    <section className="rounded-tile border" style={{ borderColor: border, background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: border }}>
        <h3 className="text-[13px] font-semibold">{t("Kultur-Skalierungspolitik — wer wächst wie über den Ramp?")}</h3>
        <span className="caption text-[10.5px] text-nx-text-muted">{t("ramp = PRIO-Hochskalierung unter Anbaupause · fix = Werkskapazität · scale = füllt Rotation")}</span>
      </div>
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full text-[12px]" style={{ minWidth: 680 }}>
          <thead><tr>
            <th className="caption text-[9.5px] text-nx-text-muted text-left px-2 py-1">{t("Kultur")}</th>
            <th className="caption text-[9.5px] text-nx-text-muted text-left px-2 py-1">{t("Politik")}</th>
            <th className="caption text-[9.5px] text-nx-text-muted text-right px-2 py-1">{t("Ziel-ha (ramp)")}</th>
            <th className="caption text-[9.5px] text-nx-text-muted text-right px-2 py-1">{t("Fläche heute → Endausbau")}</th>
          </tr></thead>
          <tbody>
            {cropIds.map((id) => {
              const pol = domain.cropPolicy?.[id] ?? { mode: "scale" as const };
              const curve = my.areas[id] ?? [];
              return (
                <tr key={id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5">{cropName(id)}</td>
                  <td className="px-2 py-1.5">
                    <select className="rounded-control border text-[11.5px] px-1" style={{ background: "var(--nx-app-bg)", borderColor: border, height: 30 }}
                      value={pol.mode} onChange={(e) => setPol(id, { mode: e.target.value as CropPolicy["mode"] })}>
                      <option value="scale">{t("scale — proportional")}</option>
                      <option value="fix">{t("fix — konstant")}</option>
                      <option value="ramp">{t("ramp — auf Ziel")}</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {pol.mode === "ramp"
                      ? <NumCell value={pol.targetHa ?? 0} width={78} suffix="ha" onCommit={(n) => setPol(id, { targetHa: Math.max(0, Math.round(n)) })} />
                      : <span className="text-nx-text-muted">—</span>}
                  </td>
                  <td className="num px-2 py-1.5 text-right">{fmtNumber(curve[0] ?? 0, 0)} → <b>{fmtNumber(curve[last] ?? 0, 0)}</b> ha</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: border }}>
        {t("Kartoffel (Pommes + Chips) teilt sich als Wirtsgruppe die 25-%-Grenze (4-Jahres-Anbaupause) — der Ramp läuft so schnell, wie die beregnete Fläche es agronomisch erlaubt. Σ je Jahr = beregnete Fläche (Residual füllt die Rotation).")}
      </div>
    </section>
  );
}

function ProduktionsTabelle() {
  const { domain, view } = useModelStore();
  const sc = view.scenarioId;
  const rows = domain.anbauplan.map((e) => {
    const y = cropYield(domain, e.cropId, sc);
    const loss = cropLoss(domain, e.cropId, sc);
    const t = netTonnes(domain, e.cropId, sc, e.areaHa, false);
    const entry = domain.catalog.find((c) => c.cropId === e.cropId);
    return { id: e.id, cropId: e.cropId, name: entry?.name ?? e.cropId, ha: e.areaHa, y, loss, t };
  });
  const totHa = rows.reduce((a, r) => a + r.ha, 0);
  const totT = rows.reduce((a, r) => a + r.t, 0);
  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h2 className="text-[14px] font-semibold">{t("Anbaustruktur & Produktion")}</h2>
        <span className="caption text-[10.5px] text-nx-text-muted">{t("Fläche × Ertrag × (1 − Verlust) → Netto-Erntemenge ·")} {fmtNumber(totT, 0)} t</span>
      </div>
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="caption text-[10.5px] text-nx-text-muted">
              <th className="px-2 py-2 text-left">{t("Kultur")}</th>
              <th className="px-2 py-2 text-right">{t("Fläche (ha)")}</th>
              <th className="px-2 py-2 text-right">{t("Anteil")}</th>
              <th className="px-2 py-2 text-right">{t("Ertrag (t/ha)")}</th>
              <th className="px-2 py-2 text-right">{t("Verlust")}</th>
              <th className="px-2 py-2 text-right">{t("Produktion netto (t)")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: cropColor(r.cropId), display: "inline-block" }} />
                    {r.name}
                  </span>
                </td>
                <td className="num px-2 py-2 text-right">{fmtNumber(r.ha, 0)}</td>
                <td className="num px-2 py-2 text-right text-nx-text-muted">{fmtNumber(totHa > 0 ? (r.ha / totHa) * 100 : 0, 0)}%</td>
                <td className="num px-2 py-2 text-right">{fmtNumber(r.y, 1)}</td>
                <td className="num px-2 py-2 text-right text-nx-text-muted">{fmtNumber(r.loss * 100, 0)}%</td>
                <td className="num px-2 py-2 text-right font-semibold">{fmtNumber(r.t, 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-2 py-2.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Summe ·")} {rows.length} {t("Kulturen")}</td>
              <td className="num px-2 py-2.5 text-right font-semibold">{fmtNumber(totHa, 0)}</td>
              <td className="px-2 py-2.5" />
              <td className="px-2 py-2.5" />
              <td className="px-2 py-2.5" />
              <td className="num px-2 py-2.5 text-right font-semibold">{fmtNumber(totT, 0)} t</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
        {t("Netto-Erntemenge nach Feld-/Lagerverlust — Basis für Umsatz (× Preis × Kontrakt-Qualität) und Contribution. Wertkulturen nur auf beregneter Fläche; die Flächenentwicklung über die Jahre steht im Wachstumsplan.")}
      </div>
    </section>
  );
}
