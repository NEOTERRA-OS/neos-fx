"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import type { Domain, CatalogEntry } from "../../store/model";
import { fmtMoney, fmtNumber, fmtEditable, parseDe } from "../../design/format";
import { AssumptionGroupCards } from "./AssumptionGroupCards";
import { cropYield, cropLoss, netTonnes, cropColor, cropName } from "./cropCalc";
import { deriveCropAreasMY, setCropPathHa, rampCropPath, START_YEAR, type CropPolicy } from "../../store/model";
import { t } from "../../lib/i18n";
import { JahrWahl, JAHR_DEFAULT } from "./JahrWahl";
import { Droplets, Sun, X } from "lucide-react";
import { Segmented } from "../primitives/Segmented";

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
  const anzeige = fmtEditable(value);
  const [t, setT] = React.useState(anzeige);
  React.useEffect(() => setT(anzeige), [value]);
  // Kappen wir die Anzeige auf zwei Nachkommastellen, darf ein blosses Verlassen des
  // Feldes den Wert NICHT auf die gerundete Zahl festschreiben. Deshalb: nur committen,
  // wenn der Text sich gegenueber der gerenderten Darstellung tatsaechlich geaendert hat.

  return (
    <span className="inline-flex items-center gap-1">
      <input className="num rounded-control border px-2 text-right text-[12.5px]"
        style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600, height: 34, width }}
        value={t} inputMode="decimal"
        onChange={(e) => setT(e.target.value)}
        onBlur={(e) => { if (e.target.value === anzeige) return; const n = parseDe(e.target.value); if (n !== null) onCommit(n); }}
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
      {beregnet ? <Droplets size={12} strokeWidth={2} aria-hidden /> : <Sun size={12} strokeWidth={2} aria-hidden />}
      {beregnet ? t("beregnet") : t("trocken")}
    </span>
  );
}

/** Variabler Anbauplan: Kultur × Fläche × Zeitfenster. Kosten werden je Zeile aus dem
 *  Kostenkatalog gezogen und auf die Fläche skaliert (× areaHa). */
export function AnbauplanView() {
  const { domain, view, patch } = useModelStore();
  const sc = view.scenarioId;
  const [tab, setTab] = React.useState<"anbau" | "ertraege" | "preise">("anbau");
  const planDomain = domain;
  const plan = planDomain.anbauplan;
  // ZUSAMMENGEFÜHRT 31.07.2026: der Skalierungspfad steckt jetzt in DIESER Tabelle. Eine Kultur,
  //  eine Zeile — Beregnung, Pflanz-/Erntemonat, Fläche je Planjahr, Kosten. Vorher standen die
  //  Jahresflächen im Dashboard und die Startfläche hier; wer eine Kultur plante, musste an zwei
  //  Stellen arbeiten und konnte beide auseinanderlaufen lassen.
  const jahre = React.useMemo(() => Array.from({ length: Math.max(1, domain.growth?.years ?? 1) }, (_, y) => y), [domain.growth?.years]);
  const myAreas = React.useMemo(() => deriveCropAreasMY(domain).areas, [domain]);
  const haOf = (cropId: string, y: number) => Math.round(myAreas[cropId]?.[Math.min(y, jahre.length - 1)] ?? 0);
  // Trockenrotation läuft jetzt NATIV im Anbauplan (pool:"dryland"). Aufteilung rein über das pool-Feld.
  // NULLBASIS-FALLE im Kopf und in der Summenspalte. `e.areaHa` ist die Flaeche des
  //  STARTJAHRES; fuenf der sieben Kulturen beginnen erst 2028 und stehen dort mit 0 ha.
  //  Die Kopfzeile meldete deshalb "Gesamtbetrieb Sigma 300 ha" fuer einen Plan, dessen
  //  Jahresspalten direkt daneben bis 2.334 ha laufen, und die Spalte "Sigma EUR Jahr 1"
  //  stand fuer diese Kulturen auf null. Bezug ist jetzt das ZIELJAHR.
  // BEZUGSJAHR fuer Kopfzeile und Sigma-Spalte. Default = erstes Planjahr (Regel 01.08.2026):
  //  eine Summe ohne genanntes Jahr wird als "heute" gelesen, nicht als Endausbau.
  const [bezugJ, setBezugJ] = React.useState(JAHR_DEFAULT);
  const zielJ = Math.min(Math.max(0, bezugJ), jahre.length - 1);
  const haZiel = (cropId: string) => myAreas[cropId]?.[Math.min(zielJ, (myAreas[cropId]?.length ?? 1) - 1)] ?? 0;
  const agroOf = (e: { cropId: string; areaHa: number }) => {
    const entry = planDomain.catalog.find((c) => c.cropId === e.cropId);
    return (entry ? fieldCostPerHaCent(planDomain, entry, sc) : 0) * haZiel(e.cropId);
  };
  const irrRows = plan.filter((e) => e.pool !== "dryland");
  const dryPlanRows = plan.filter((e) => e.pool === "dryland");
  const beregHa = irrRows.reduce((a, e) => a + haZiel(e.cropId), 0);
  const dryHa = dryPlanRows.reduce((a, e) => a + haZiel(e.cropId), 0);
  const totalHa = beregHa + dryHa;
  const beregAgroCent = irrRows.reduce((a, e) => a + agroOf(e), 0);
  const dryAgroCent = dryPlanRows.reduce((a, e) => a + agroOf(e), 0);
  const totalAgroCent = beregAgroCent + dryAgroCent;
  const avgPerHaCent = totalHa > 0 ? totalAgroCent / totalHa : 0;
  const showDry = dryHa > 0;

  return (
    <div className="space-y-4">
    <Segmented ariaLabel={t("Ansicht")} value={tab} onChange={(v) => setTab(v as typeof tab)}
      options={[
        { value: "anbau", label: t("Anbauplan") },
        { value: "ertraege", label: t("Erträge") },
        { value: "preise", label: t("Preise") },
      ]} />

    {tab === "anbau" && (<>
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <div>
          <h2 className="text-[14px] font-semibold">{t("Anbauplan — Kulturen & Flächen")}</h2>
          <div className="text-[10.5px] text-nx-text-muted">{showDry ? t("Beregnete Kulturen + unberegnete Trockenrotation in einer Tabelle. Jede Kultur mit eigener Bottom-up-Kalkulation.") : t("Agronomie-Kosten aus dem Katalog (Maschinen separat).")}</div>
        </div>
        <span className="inline-flex items-center gap-3"><JahrWahl jahre={jahre.length} wert={zielJ} onChange={setBezugJ} /><span className="caption text-[10.5px] text-nx-text-muted">{t("Gesamtbetrieb · Σ")} {fmtNumber(totalHa, 0)} ha</span></span>
      </div>
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="caption text-[10.5px] text-nx-text-muted">
              <th className="px-2 py-2 text-left">{t("Kultur")}</th>
              <th className="px-2 py-2 text-left">{t("Beregnung")}</th>
              <th className="px-2 py-2 text-right">{t("Pflanzung (M)")}</th>
              <th className="px-2 py-2 text-right">{t("Ernte (M)")}</th>
              {jahre.map((y) => <th key={y} className="px-1.5 py-2 text-right">{START_YEAR + y}</th>)}
              <th className="px-2 py-2 text-right">{t("€/ha")}</th>
              <th className="px-2 py-2 text-right">{t("Σ €")} {START_YEAR + zielJ}</th>
              <th className="px-1 py-2 text-center" title={t("Linear vom Start- auf den Zielwert hochlaufen lassen")}>↗</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {plan.map((e, i) => {
              const entry = planDomain.catalog.find((c) => c.cropId === e.cropId);
              const perHa = entry ? fieldCostPerHaCent(planDomain, entry, sc) : 0;
              const cropLabel = entry ? t(entry.name) : cropName(e.cropId);
              return (
                <tr key={e.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-2">
                    {(
                      <select className="rounded-control border px-2 text-[12.5px]" style={{ height: 34, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600 }}
                        value={e.cropId}
                        onChange={(ev) => patch((d) => { d.anbauplan[i].cropId = ev.target.value; })}>
                        {domain.catalog.map((c) => <option key={c.cropId} value={c.cropId}>{t(c.name)}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-2"><BeregBadge kind={e.pool === "dryland" ? "trocken" : "beregnet"} /></td>
                  <td className="px-2 py-2 text-right">
                    <NumCell value={e.plantingPeriod} width={56} onCommit={(n) => patch((d) => { d.anbauplan[i].plantingPeriod = Math.round(n); })} />
                  </td>
                  <td className="num px-2 py-2 text-right text-nx-text-secondary">{e.harvestPeriods.join(", ")}</td>
                  {jahre.map((y) => (
                    <td key={y} className="px-1.5 py-2 text-right">
                      <NumCell value={haOf(e.cropId, y)} width={58}
                        onCommit={(n) => patch((d) => setCropPathHa(d, e.cropId, y, n, jahre.length))} />
                    </td>
                  ))}
                  <td className="num px-2 py-2 text-right">{fmtMoney(perHa)}</td>
                  <td className="num px-2 py-2 text-right font-semibold">{fmtMoney(perHa * haZiel(e.cropId))}</td>
                  <td className="px-1 py-2 text-center">
                    <button title={t("Linear vom Start- auf den Zielwert hochlaufen lassen")}
                      onClick={() => patch((d) => rampCropPath(d, e.cropId, jahre.length))}
                      className="rounded-control border px-1.5 text-[11px]"
                      style={{ height: 24, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }}>↗</button>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button className="text-[11px] text-nx-error" title={t("Zeile entfernen")}
                      onClick={() => patch((d) => { d.anbauplan.splice(i, 1); })}><X size={13} strokeWidth={2.5} aria-hidden /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-2 py-2.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Beregnet ·")} {irrRows.length} {t("Kulturen")}</td>
              <td className="num px-2 py-2.5 text-right font-semibold">{fmtNumber(beregHa, 0)} ha</td>
              <td className="px-2 py-2.5" colSpan={2} />
              <td className="num px-2 py-2.5 text-right text-nx-text-secondary" title={t("gewichteter Durchschnitt")}>ø {fmtMoney(avgPerHaCent)}</td>
              <td className="num px-2 py-2.5 text-right font-semibold">{fmtMoney(beregAgroCent)}</td>
              <td className="px-2 py-2.5" />
            </tr>
            {showDry && (
              <tr>
                <td className="px-2 py-1.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Trocken ·")} {dryPlanRows.length} {t("Kulturen")}</td>
                <td className="num px-2 py-1.5 text-right font-semibold">{fmtNumber(dryHa, 0)} ha</td>
                <td className="px-2 py-1.5" colSpan={2} />
                <td className="px-2 py-1.5" />
                <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(dryAgroCent)}</td>
                <td className="px-2 py-1.5" />
              </tr>
            )}
            {showDry && (
              <tr style={{ borderTop: "1px solid var(--nx-border)" }}>
                <td className="px-2 py-2 font-bold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Gesamtbetrieb")}</td>
                <td className="num px-2 py-2 text-right font-bold">{fmtNumber(totalHa, 0)} ha</td>
                <td className="px-2 py-2 text-[10px] text-nx-text-muted" colSpan={5}>{fmtNumber(beregHa, 0)} {t("beregnet")} + {fmtNumber(dryHa, 0)} {t("trocken")}</td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2" style={{ borderColor: "var(--nx-border)" }}>
        {(
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
          {t("Fläche ändern → Kosten & Maschinen rechnen automatisch nach.")}
          {showDry ? " " + t("Trockenkulturen laufen nativ mit eigener Kalkulation (☀ trocken); Maschinen über die volle Fläche.") : ""}
        </span>
      </div>
    </section>

    {/* Anbaustruktur & Produktion */}
    <ProduktionsTabelle />

    {/* ENTFERNT 31.07.2026: das Politik-Panel (scale/fix/ramp je Kultur). Die Flächen stehen
        jetzt Jahr für Jahr in der Tabelle oben — eine explizite Kurve statt einer Regel, die
        man erst im Kopf auflösen muss. Die Modi scale/fix/ramp werden nicht mehr verwendet. */}

    {/* AUSGEBLENDET 31.07.2026: Agronomie-Advisor und Was-wäre-wenn-Panel. Sie gehören zur
        Sektion Anbaustrategie, die vorerst komplett aus der App genommen ist. Der Code bleibt
        unter components/_archiv erhalten; die Anbaupausen-Wächter (Kartoffel 25 %,
        Doldenblütler 20 %) laufen unabhängig davon in der Prüfliste weiter. */}
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
/* PolicyPanel entfernt 31.07.2026 — ersetzt durch die Jahresspalten im Anbauplan. */

function ProduktionsTabelle() {
  const { domain, view } = useModelStore();
  const sc = view.scenarioId;
  // Native Zeilen: beregnet + trocken kommen beide aus dem Anbauplan (pool). Die Trockenkulturen
  // (weizen_dry …) tragen ihre eigenen Rain-fed-Ertragsannahmen — kein separater Abschlag mehr.
  // Flaeche je PLANJAHR statt e.areaHa (Startjahr). Fuenf der sieben Kulturen beginnen 2028
  //  und standen hier mit 0 ha, 0 t und 0 % Anteil — die Tabelle zeigte den Betrieb von 2027
  //  und nannte ihn "Anbaustruktur & Produktion". Jahr waehlbar, Vorbelegung Endausbau.
  const my = React.useMemo(() => deriveCropAreasMY(domain), [domain]);
  const [jahrIdx, setJahrIdx] = React.useState<number>(JAHR_DEFAULT);
  const yi = Math.min(Math.max(0, jahrIdx), my.years - 1);
  const allRows = domain.anbauplan.map((e) => {
    const ha = my.areas[e.cropId]?.[Math.min(yi, (my.areas[e.cropId]?.length ?? 1) - 1)] ?? e.areaHa;
    const y = cropYield(domain, e.cropId, sc);
    const loss = cropLoss(domain, e.cropId, sc);
    const t = netTonnes(domain, e.cropId, sc, ha, false);
    const entry = domain.catalog.find((c) => c.cropId === e.cropId);
    return { id: e.id, cropId: e.cropId, name: entry?.name ?? e.cropId, ha, y, loss, t, pool: e.pool ?? "irrigated" };
  });
  const rows = allRows.filter((r) => r.pool !== "dryland");
  const dryRows = allRows.filter((r) => r.pool === "dryland");
  const beregHa = rows.reduce((a, r) => a + r.ha, 0);
  const beregT = rows.reduce((a, r) => a + r.t, 0);
  const showDry = dryRows.length > 0;
  const dryTotHa = dryRows.reduce((a, r) => a + r.ha, 0);
  const dryTotT = dryRows.reduce((a, r) => a + r.t, 0);
  const grandHa = beregHa + dryTotHa;
  const grandT = beregT + dryTotT;
  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[14px] font-semibold">{t("Anbaustruktur & Produktion")}</h2>
          <JahrWahl jahre={my.years} wert={yi} onChange={setJahrIdx} label="" />
        </div>
        <span className="caption text-[10.5px] text-nx-text-muted">{t("Fläche × Ertrag × (1 − Verlust) → Netto-Erntemenge ·")} {fmtNumber(grandT, 0)} t</span>
      </div>
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="caption text-[10.5px] text-nx-text-muted">
              <th className="px-2 py-2 text-left">{t("Kultur")}</th>
              <th className="px-2 py-2 text-left">{t("Beregnung")}</th>
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
                    {t(r.name)}
                  </span>
                </td>
                <td className="px-2 py-2"><BeregBadge kind="beregnet" /></td>
                <td className="num px-2 py-2 text-right">{fmtNumber(r.ha, 0)}</td>
                <td className="num px-2 py-2 text-right text-nx-text-muted">{fmtNumber(grandHa > 0 ? (r.ha / grandHa) * 100 : 0, 0)}%</td>
                <td className="num px-2 py-2 text-right">{fmtNumber(r.y, 1)}</td>
                <td className="num px-2 py-2 text-right text-nx-text-muted">{fmtNumber(r.loss * 100, 0)}%</td>
                <td className="num px-2 py-2 text-right font-semibold">{fmtNumber(r.t, 0)}</td>
              </tr>
            ))}
            {showDry && dryRows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--nx-border-divider)", background: "color-mix(in srgb, var(--nx-warn, #C9A227) 5%, transparent)" }}>
                <td className="px-2 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: cropColor(r.cropId), display: "inline-block", opacity: 0.6 }} />
                    {t(r.name)}
                  </span>
                </td>
                <td className="px-2 py-2"><BeregBadge kind="trocken" /></td>
                <td className="num px-2 py-2 text-right">{fmtNumber(r.ha, 0)}</td>
                <td className="num px-2 py-2 text-right text-nx-text-muted">{fmtNumber(grandHa > 0 ? (r.ha / grandHa) * 100 : 0, 0)}%</td>
                <td className="num px-2 py-2 text-right">{fmtNumber(r.y, 1)}</td>
                <td className="num px-2 py-2 text-right text-nx-text-muted">{fmtNumber(r.loss * 100, 0)}%</td>
                <td className="num px-2 py-2 text-right font-semibold">{fmtNumber(r.t, 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-2 py-2.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Beregnet ·")} {rows.length} {t("Kulturen")}</td>
              <td className="num px-2 py-2.5 text-right font-semibold">{fmtNumber(beregHa, 0)}</td>
              <td className="px-2 py-2.5" colSpan={3} />
              <td className="num px-2 py-2.5 text-right font-semibold">{fmtNumber(beregT, 0)} t</td>
            </tr>
            {showDry && (
              <tr>
                <td className="px-2 py-1.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Trocken ·")} {dryRows.length} {t("Kulturen")}</td>
                <td className="num px-2 py-1.5 text-right font-semibold">{fmtNumber(dryTotHa, 0)}</td>
                <td className="px-2 py-1.5" colSpan={3} />
                <td className="num px-2 py-1.5 text-right font-semibold">{fmtNumber(dryTotT, 0)} t</td>
              </tr>
            )}
            {showDry && (
              <tr style={{ borderTop: "1px solid var(--nx-border)" }}>
                <td className="px-2 py-2 font-bold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Gesamtbetrieb")}</td>
                <td className="num px-2 py-2 text-right font-bold">{fmtNumber(grandHa, 0)}</td>
                <td className="px-2 py-2" colSpan={3} />
                <td className="num px-2 py-2 text-right font-bold">{fmtNumber(grandT, 0)} t</td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
        {t("Netto-Erntemenge nach Feld-/Lagerverlust. Beregnete Kulturen: Basis für Umsatz (× Preis × Kontrakt-Qualität). Trockenkulturen (☀): Rain-fed-Ertrag mit eigener Bottom-up-Kalkulation — volle Kosten (Agronomie, Maschinen, Personal, Fixkosten) über die gesamte Fläche gerechnet, nicht als Pauschale. Flächenentwicklung über die Jahre steht im Wachstumsplan.")}
      </div>
    </section>
  );
}
