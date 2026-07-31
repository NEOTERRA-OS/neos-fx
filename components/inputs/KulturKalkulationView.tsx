"use client";
import React from "react";
import { DirektkostenSummary } from "./DirektkostenSummary";
import { useModelStore } from "../../store/modelStore";
import { START_YEAR, deriveCropMassnahmen, deriveAgronomieWarnings, getProductCatalog, exportMassnahmenplan, MACHINE_LABELS, CROP_NAME, type CropCalc, type MassnahmeBM } from "../../store/model";
import { findProduct, categoriesForOp, type CatalogProduct } from "../../store/productCatalog";
import { fmtMoney, fmtNumber } from "../../design/format";
import { NumberInput, TextInput } from "./NumberInput";
import { ProductPicker } from "./ProductPicker";
import { cropColor } from "./cropCalc";
import { t } from "../../lib/i18n";
import { JahrWahl, JAHR_DEFAULT } from "./JahrWahl";
import { Link, Search, Ban, TriangleAlert, Check, X } from "lucide-react";

/** BBCH-Annotation aus dem Maßnahmen-Label entfernen (wird bereits in Spalte 1 „BBCH · Timing" gezeigt).
 *  Der gespeicherte Label behält BBCH (Timing-Quelle) — hier nur die Anzeige/Bearbeitung ohne Dopplung. */
function stripBBCH(s: string): string {
  return (s || "").replace(/\s*\(BBCH[^)]*\)/gi, "").trim();
}

/** Stücksatz-Einheit aus der Mengen-Einheit ableiten: "kg N/ha" → "€/kg N", "t/ha" → "€/t", "mm/ha" → "€/mm". */
function priceUnit(unit: string): string {
  const base = (unit || "").replace(/\s*\/\s*ha$/i, "").trim();
  return base ? `€/${base}` : "€";
}

/** Kultur-Kalkulation — je Kultur die vollständige Maßnahmenkette (ab Bodenbearbeitung nach
 *  Vorernte): Maschine + Überfahrten + Betriebsmittel (Menge & Einheit) + Diesel + Fahrer + €/ha.
 *  Rollt zu Gesamtkosten und Maschinen-/Diesel-/Fahrer-Bedarf hoch (× Fläche). */
export function KulturKalkulationView() {
  const { domain, view, patch } = useModelStore();
  const sc = view.scenarioId;
  const crops = domain.anbauplan.map((a) => a.cropId);
  const uniqueCrops = [...new Set(crops)];
  const [crop, setCrop] = React.useState(uniqueCrops[0] ?? "weizen");
  // BEZUGSJAHR der absoluten Summen. Je-ha-Kosten sind flächenunabhängig, die Betriebssumme
  //  ist es nicht: 2027 sind es 300 ha, 2034 sind es 2.334. Default = erstes Planjahr.
  const jahre = Math.max(1, domain.growth?.years ?? 1);
  const [jahr, setJahr] = React.useState(JAHR_DEFAULT);
  const jy = Math.min(Math.max(0, jahr), jahre - 1);
  const calc = deriveCropMassnahmen(domain, crop, sc, jy);
  const mById = (id: string) => domain.machineCatalog.find((m) => m.id === id);

  // Kostenkatalog INTEGRIERT: Mengen & Stücksätze werden direkt hier editiert.
  const updQty = (opCode: string, lineIdx: number, v: number) => patch((d) => {
    const e = d.catalog.find((c) => c.cropId === crop);
    const l = e?.ops.find((o) => o.code === opCode)?.lines[lineIdx];
    if (l) l.quantityPerHa = Math.max(0, v);
  });
  const updPrice = (key: string, cent: number) => patch((d) => {
    if (d.assumptions[key]) d.assumptions[key].scenarioProfiles[sc] = { kind: "constant", value: Math.max(0, Math.round(cent)) };
  });
  const updPasses = (mId: string, n: number) => patch((d) => {
    const g = (d.arbeitsgaenge[crop] ?? []).find((x) => x.m === mId);
    if (g) g.passes = Math.max(0, Math.round(n));
  });

  // ---- Maßnahmen-Journal: jede Maßnahme einzeln planen (FMS-Abgleich Plan ↔ Ist).
  type Draft = typeof domain;
  const opOf = (d: Draft, opCode: string) => d.catalog.find((c) => c.cropId === crop)?.ops.find((o) => o.code === opCode);
  // SSOT-Verzahnung: Streuer-/Spritzen-Überfahrten an die Maßnahmen koppeln (Composer/Flotte konsistent).
  const newMid = () => `user-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const syncPasses = (d: Draft) => {
    const e = d.catalog.find((c) => c.cropId === crop);
    const psmSum = (e?.ops.find((o) => o.code === "OP-PSM")?.lines ?? []).reduce((s, l) => s + (l.passes ?? 1), 0);
    const gifts = new Set<string>();
    (e?.ops.find((o) => o.code === "OP-DUENG")?.lines ?? []).forEach((l) => {
      const lb = l.label.split(" · ")[0];
      if (!/fertigation|unterfuß|unterfuss/i.test(lb)) gifts.add(l.mid ?? lb);
    });
    const sp = (d.arbeitsgaenge[crop] ?? []).find((g) => g.m === "spritze14"); if (sp) sp.passes = psmSum;
    const st = (d.arbeitsgaenge[crop] ?? []).find((g) => g.m === "streuer"); if (st) st.passes = Math.max(0, gifts.size);
  };
  const addLine = (opCode: string, prefix?: string, mid?: string) => patch((d) => {
    const op = opOf(d, opCode); if (!op) return;
    if (opCode === "OP-DUENG") op.lines.push({ label: prefix ? `${prefix} · Neu` : "Neue Gabe (Streuer) · Neu", costType: "fertilizer", quantityPerHa: 0, unitCostKey: "price.per_euro", unit: "€/ha", mid: mid ?? newMid() });
    else op.lines.push({ label: "Neue Position", costType: "other", quantityPerHa: 0, unitCostKey: "price.per_euro", unit: "€/ha", mid: mid ?? newMid() });
    syncPasses(d);
  });
  const removeLine = (opCode: string, lineIdx: number) => patch((d) => {
    const op = opOf(d, opCode);
    if (op && op.lines[lineIdx]) op.lines.splice(lineIdx, 1);
    syncPasses(d);
  });
  const updLabel = (opCode: string, lineIdx: number, label: string) => patch((d) => {
    const l = opOf(d, opCode)?.lines[lineIdx];
    if (l) l.label = label;
    syncPasses(d);
  });
  const updLinePasses = (opCode: string, lineIdx: number, n: number) => patch((d) => {
    const l = opOf(d, opCode)?.lines[lineIdx];
    if (l) l.passes = Math.max(1, Math.round(n));
    syncPasses(d);
  });
  // Ganze Maßnahme entfernen: gezielt die Zeilen dieser Maßnahme (lineIdxs) bzw. den Feld-Arbeitsgang.
  const removeMeasure = (r: { machineId?: string; opCode?: string; lineIdxs?: number[] }) => patch((d) => {
    if (r.opCode && r.lineIdxs && r.lineIdxs.length) {
      const op = opOf(d, r.opCode);
      if (op) [...r.lineIdxs].sort((a, b) => b - a).forEach((i) => { if (op.lines[i]) op.lines.splice(i, 1); });
      syncPasses(d);
    } else if (r.machineId) {
      const idx = (d.arbeitsgaenge[crop] ?? []).findIndex((x) => x.m === r.machineId);
      if (idx >= 0) d.arbeitsgaenge[crop].splice(idx, 1);
    }
  });
  // Neue Maßnahmen: Düngegabe, PSM-Anwendung, Maschinen-Arbeitsgang.
  const addGift = () => patch((d) => { const op = opOf(d, "OP-DUENG"); if (op) { op.lines.push({ label: "Neue Gabe (Streuer) · N", costType: "fertilizer", quantityPerHa: 0, unitCostKey: "fert.n", unit: "kg N/ha", mid: newMid() }); syncPasses(d); } });
  const addPsm = () => patch((d) => { const op = opOf(d, "OP-PSM"); if (op) { op.lines.push({ label: "Neue Anwendung (BBCH …)", costType: "crop_protection", quantityPerHa: 0, unitCostKey: "price.per_euro", unit: "€/ha (Mittel)", passes: 1, mid: newMid() }); syncPasses(d); } });
  const addMachineMeasure = (mId: string) => patch((d) => {
    if (!d.arbeitsgaenge[crop]) d.arbeitsgaenge[crop] = [];
    if (!d.arbeitsgaenge[crop].some((x) => x.m === mId)) d.arbeitsgaenge[crop].push({ m: mId, passes: 1, mid: `${crop}::mach::${mId}` });
  });
  const exportPlan = () => {
    const blob = new Blob([JSON.stringify(exportMassnahmenplan(domain, sc), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "neosfx-massnahmenplan.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const warns = deriveAgronomieWarnings(domain, crop);

  // Produktkatalog + Picker-Status
  const products = getProductCatalog(domain);
  const [picker, setPicker] = React.useState<{ opCode: string; lineIdx: number; label: string } | null>(null);
  const setProduct = (opCode: string, lineIdx: number, p: CatalogProduct) => patch((d) => {
    const l = opOf(d, opCode)?.lines[lineIdx];
    if (l) { l.label = p.name; l.productId = p.id; }
  });

  const BmLine = ({ b }: { b: MassnahmeBM }) => {
    const linked = findProduct(products, b.productId);
    const canPick = categoriesForOp(b.opCode).length > 0;
    return (
      <div>
        <div className="flex items-center gap-1.5">
          <TextInput value={stripBBCH(b.label)} width={168} onCommit={(s) => {
            const m = b.label.match(/\s*\(BBCH[^)]*\)/i);
            updLabel(b.opCode, b.lineIdx, m ? stripBBCH(s) + " " + m[0].trim() : s);
          }} />
          {canPick && (
            <button className="shrink-0 rounded-control border px-1.5 text-[11px] leading-none hover:opacity-80"
              style={{ height: 24, borderColor: linked ? "var(--nx-green)" : "var(--nx-border)", color: linked ? "var(--nx-green)" : "var(--nx-locate)", background: "var(--nx-app-bg)" }}
              title={linked ? t("Produkt ändern") : t("Produkt vorschlagen")}
              onClick={() => setPicker({ opCode: b.opCode, lineIdx: b.lineIdx, label: b.label })}>
              {linked ? <Link size={12} strokeWidth={2.5} aria-hidden /> : <Search size={12} strokeWidth={2.5} aria-hidden />}
            </button>
          )}
          <span className="ml-auto inline-flex shrink-0 items-center gap-1">
            <NumberInput value={b.qty} width={56} onCommit={(v) => updQty(b.opCode, b.lineIdx, v)} />
            <span className="w-[64px] text-[10px] text-nx-text-muted">{b.physical ? b.unit : "€/ha"}</span>
            {b.physical && b.unitCostKey !== "price.per_euro" ? (
              <>
                <NumberInput value={b.unitPriceCent} unit="money" width={62} onCommit={(v) => updPrice(b.unitCostKey, v)} />
                <span className="w-[58px] text-[10px] text-nx-text-muted">{priceUnit(b.unit)}</span>
              </>
            ) : <span style={{ width: 62 + 4 + 58, display: "inline-block" }} />}
            <span className="num w-[52px] text-right text-[11px] text-nx-text-muted">{fmtMoney(b.cent)}</span>
            <span className="w-[30px] text-[9px] text-nx-text-muted">€/ha</span>
            <button className="text-[12px] leading-none text-nx-error hover:opacity-70" title={t("Betriebsmittel entfernen")}
              onClick={() => removeLine(b.opCode, b.lineIdx)}><X size={12} strokeWidth={2.5} aria-hidden /></button>
          </span>
        </div>
        {linked && (
          <div className="mt-0.5 pl-1 text-[10px]" style={{ color: linked.roAuthorized === "no" ? "var(--nx-error)" : "var(--nx-text-muted)" }}>
            {linked.manufacturer}
            {(linked.activeIngredients ?? []).length ? ` · ${linked.activeIngredients!.map((a) => a.name).join(" + ")}` : ""}
            {linked.roAuthorized === "yes" ? <>{" · RO "}<Check size={11} strokeWidth={2.5} className="inline align-[-1px]" aria-hidden /></> : linked.roAuthorized === "no" ? <>{" · "}<TriangleAlert size={11} strokeWidth={2.5} className="inline align-[-1px]" aria-hidden />{" "}{t("nicht zugel.")}</> : " · RO ?"}
          </div>
        )}
      </div>
    );
  };

  // Roll-up über alle Kulturen (× Fläche)
  const roll = uniqueCrops.map((c) => deriveCropMassnahmen(domain, c, sc, jy));
  const rollTot = roll.reduce((acc, c) => {
    const a = c.areaHa;
    acc.total += c.totals.totalCent * a; acc.masch += c.totals.maschineCent * a; acc.bm += c.totals.bmCent * a;
    acc.dieselL += c.totals.dieselLHa * a; acc.fahrerH += c.totals.fahrerHHa * a; acc.ha += a;
    acc.seed += c.totals.seedCent * a; acc.fert += c.totals.fertCent * a; acc.psm += c.totals.psmCent * a;
    acc.water += c.totals.waterCent * a; acc.mat += c.totals.materialCent * a; acc.hand += c.totals.handCent * a;
    return acc;
  }, { total: 0, masch: 0, bm: 0, dieselL: 0, fahrerH: 0, ha: 0, seed: 0, fert: 0, psm: 0, water: 0, mat: 0, hand: 0 });

  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";
  const tot = calc.totals;

  return (
    <div className="space-y-4">
      {/* Übersicht zuerst: was kostet der Hektar und was die Tonne — je Kultur, aufgeschlüsselt.
          Darunter dann die Maßnahmenkette der ausgewählten Kultur im Detail. */}
      <DirektkostenSummary />

      {/* Kultur-Auswahl */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Kultur-Kalkulation — BBCH-getriebene Maßnahmenkette (Kostenkatalog integriert)")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">{t("Anker = Aussaat (S) & BBCH, nicht Kalender · Überfahrten, Mengen & Stücksätze editierbar")}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {uniqueCrops.map((c) => {
            const on = c === crop;
            return (
              <button key={c} onClick={() => setCrop(c)} className="inline-flex items-center gap-1.5 rounded-control border px-2.5 text-[12px] font-semibold"
                style={{ height: 32, borderColor: on ? cropColor(c) : "var(--nx-border)", background: on ? cropColor(c) : "var(--nx-surface)", color: on ? "#fff" : "var(--nx-text-secondary)" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: on ? "#fff" : cropColor(c), display: "inline-block" }} />
                {t((CROP_NAME as Record<string, string>)[c] ?? c)}
              </button>
            );
          })}
        </div>
      </section>

      {/* Maßnahmenblatt */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: cropColor(crop) }}>{calc.name} {t("· Maßnahmenkette")} ({fmtNumber(calc.areaHa, 0)} ha {t("in")} {START_YEAR + jy})</h3>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-[11px] text-nx-text-muted">{t("Aussaat/Pflanzung (S)")}
              <select className="rounded-control border px-2 text-[12px] font-semibold"
                style={{ height: 30, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)" }}
                value={(domain.catalog.find((c) => c.cropId === crop)?.sowMonth ?? -1)}
                onChange={(e) => { const v = Number(e.target.value); patch((d) => { const en = d.catalog.find((c) => c.cropId === crop); if (en) en.sowMonth = v < 0 ? undefined : v; }); }}>
                <option value={-1}>{t("Standort-Default")}</option>
                {["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"].map((mn, i) => <option key={i} value={i}>{t(mn)}</option>)}
              </select>
            </label>
            <button className="rounded-control border px-2.5 py-1 text-[11.5px] font-semibold hover:opacity-80"
              style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-app-bg)" }}
              onClick={exportPlan} title={t("Maßnahmenplan als JSON exportieren (stabile IDs für den FMS-Abgleich)")}>{t("Plan exportieren")}</button>
            <span className="num text-[12px] font-semibold">{fmtMoney(tot.totalCent)} €/ha</span>
          </div>
        </div>
        {/* Agronomie-Wächter — warnt, wenn Pflicht-Maßnahmen fehlen/gelöscht wurden (blockiert nie). */}
        {warns.length > 0 && (
          <div className="mx-4 mt-3 space-y-1.5">
            {warns.map((wn, i) => {
              const err = wn.severity === "error";
              return (
                <div key={i} className="flex items-start gap-2 rounded-tile border px-3 py-2 text-[11.5px]"
                  style={{ borderColor: err ? "var(--nx-error)" : "var(--nx-warn, #C9A227)",
                    background: err ? "color-mix(in srgb, var(--nx-error) 12%, transparent)" : "color-mix(in srgb, var(--nx-warn, #C9A227) 14%, transparent)" }}>
                  <span className="shrink-0 font-semibold" style={{ color: err ? "var(--nx-error)" : "var(--nx-warn, #C9A227)" }}>{err ? <Ban size={13} strokeWidth={2.5} aria-hidden /> : <TriangleAlert size={13} strokeWidth={2.5} aria-hidden />}</span>
                  <span>
                    <b style={{ color: err ? "var(--nx-error)" : "var(--nx-warn, #C9A227)" }}>{t(wn.category)}: </b>
                    <span className="text-nx-text-secondary">{wn.message}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]" style={{ minWidth: 900 }}>
            <thead><tr>
              <th className={th + " text-left"}>BBCH · Timing</th>
              <th className={th + " text-left"}>{t("Maßnahme")}</th>
              <th className={th + " text-left"}>{t("Maschine")}</th>
              <th className={th + " text-left"}>{t("Betriebsmittel (Menge · Einheit)")}</th>
              <th className={th + " text-right"}>Diesel l/ha</th>
              <th className={th + " text-right"}>{t("Fahrer Ak-h")}</th>
              <th className={th + " text-right"}>{t("Masch €/ha")}</th>
              <th className={th + " text-right"}>{t("BM €/ha")}</th>
              <th className={th + " text-right"}>Σ €/ha</th>
            </tr></thead>
            <tbody>
              {calc.rows.map((r, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5" style={{ minWidth: 120 }}>
                    <div className="num text-[11.5px] font-semibold">{r.bbch !== "—" ? `BBCH ${r.bbch}` : "—"}</div>
                    <div className="text-[10px] text-nx-text-secondary">{r.timing}</div>
                    <div className="text-[10px] text-nx-text-muted">≈ {r.monat}</div>
                  </td>
                  <td className="px-2 py-1.5 font-medium">
                    <div className="flex items-center gap-1.5">
                      <span>{r.phase}</span>
                      {(r.kind === "machine" || r.opCode) && (
                        <button className="shrink-0 text-[11px] leading-none text-nx-error hover:opacity-70" title={t("Maßnahme entfernen")}
                          onClick={() => removeMeasure(r)}><X size={12} strokeWidth={2.5} aria-hidden /></button>
                      )}
                    </div>
                    <div className="num text-[9px] text-nx-text-muted" title={t("Stabile Maßnahmen-ID für den FMS-Abgleich")}>#{r.measureId}</div>
                  </td>
                  <td className="px-2 py-1.5 text-nx-text-secondary">
                    {r.machineId ? (() => {
                      const m = mById(r.machineId);
                      const isPsm = r.opCode === "OP-PSM";
                      const isStreuer = r.machineId === "streuer";
                      return (
                        <div>
                          <span className="inline-flex items-center gap-1">
                            {isStreuer
                              ? <span className="num text-[11.5px] font-semibold" style={{ color: "var(--nx-locate)" }}>1</span>
                              : <NumberInput value={r.passes} unit="count" suffix="" width={40} onCommit={(v) => isPsm ? updLinePasses("OP-PSM", r.lineIdxs![0], v) : updPasses(r.machineId!, v)} />}
                            <span className="text-[11.5px]">× {r.machineLabel}</span>
                          </span>
                          {m?.widthM != null && (
                            <div className="num text-[10px] text-nx-text-muted" style={{ marginTop: 2 }}>
                              {fmtNumber(m.widthM, 1)} m · {fmtNumber(m.speedKmh ?? 0, 1)} km/h · {fmtNumber((m.fieldEff ?? 0) * 100, 0)} % → <b style={{ color: "var(--nx-brand-lift)" }}>{fmtNumber(m.cEff ?? 0, 2)} ha/h</b>
                            </div>
                          )}
                        </div>
                      );
                    })() : r.applyHint ? <span className="text-[11.5px] text-nx-text-muted">{t(r.applyHint)}</span> : <span className="text-nx-text-muted">—</span>}
                  </td>
                  <td className="px-2 py-1.5" style={{ minWidth: 360 }}>
                    {r.bm.length ? <div className="space-y-1">{r.bm.map((b) => <BmLine key={`${r.opCode}-${b.lineIdx}`} b={b} />)}</div> : <span className="text-[11px] text-nx-text-muted">{t("keine Betriebsmittel")}</span>}
                    {r.opCode && r.opCode !== "OP-PSM" && (
                      <button className="mt-1 rounded-control border px-2 py-0.5 text-[10.5px] font-semibold hover:opacity-80"
                        style={{ borderColor: "var(--nx-border)", color: "var(--nx-locate)", background: "var(--nx-app-bg)" }}
                        onClick={() => addLine(r.opCode!, r.opCode === "OP-DUENG" ? r.phase : undefined, r.opCode === "OP-DUENG" ? r.measureId : undefined)}>{t("+ Betriebsmittel")}</button>
                    )}
                  </td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">{r.dieselLHa ? fmtNumber(r.dieselLHa, 1) : "–"}</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">{r.fahrerHHa ? fmtNumber(r.fahrerHHa, 2) : "–"}</td>
                  <td className="num px-2 py-1.5 text-right">{r.maschineCent ? fmtMoney(r.maschineCent) : "–"}</td>
                  <td className="num px-2 py-1.5 text-right">{r.bmCent ? fmtMoney(r.bmCent) : "–"}</td>
                  <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(r.totalCent)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                <td className="px-2 py-2 font-semibold" colSpan={4}>{t("Summe je ha")}</td>
                <td className="num px-2 py-2 text-right font-semibold">{fmtNumber(tot.dieselLHa, 0)} l</td>
                <td className="num px-2 py-2 text-right font-semibold">{fmtNumber(tot.fahrerHHa, 1)} h</td>
                <td className="num px-2 py-2 text-right font-semibold">{fmtMoney(tot.maschineCent)}</td>
                <td className="num px-2 py-2 text-right font-semibold">{fmtMoney(tot.bmCent)}</td>
                <td className="num px-2 py-2 text-right font-semibold" style={{ color: cropColor(crop) }}>{fmtMoney(tot.totalCent)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {/* Maßnahme hinzufügen — jede Maßnahme einzeln planbar (FMS-Abgleich Plan ↔ Ist). */}
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
          <span className="text-[11px] font-semibold text-nx-text-secondary">{t("Maßnahme hinzufügen")}:</span>
          <button className="rounded-control border px-2.5 py-1 text-[12px] font-semibold hover:opacity-80"
            style={{ borderColor: "var(--nx-border)", color: "var(--nx-locate)", background: "var(--nx-app-bg)" }} onClick={addGift}>{t("+ Düngegabe")}</button>
          <button className="rounded-control border px-2.5 py-1 text-[12px] font-semibold hover:opacity-80"
            style={{ borderColor: "var(--nx-border)", color: "var(--nx-locate)", background: "var(--nx-app-bg)" }} onClick={addPsm}>{t("+ PSM-Anwendung")}</button>
          <select className="rounded-control border px-2 text-[12px]" style={{ height: 32, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }}
            value=""
            onChange={(e) => { if (e.target.value) addMachineMeasure(e.target.value); e.currentTarget.value = ""; }}>
            <option value="">{t("+ Maschinen-Maßnahme …")}</option>
            {Object.keys(MACHINE_LABELS)
              .filter((k) => !(domain.arbeitsgaenge[crop] ?? []).some((g) => g.m === k))
              .map((k) => <option key={k} value={k}>{MACHINE_LABELS[k]}</option>)}
          </select>
          <span className="text-[10.5px] text-nx-text-muted">{t("Jede Maßnahme einzeln — für den späteren Abgleich Plan ↔ Ist im Farm-Management-System.")}</span>
        </div>

        {/* Kostenblöcke je ha */}
        <div className="grid grid-cols-2 gap-px border-t sm:grid-cols-4 lg:grid-cols-8" style={{ background: "var(--nx-border-divider)", borderColor: "var(--nx-border)" }}>
          {([[t("Maschinen"), tot.maschineCent], [t("Saatgut"), tot.seedCent], [t("Dünger"), tot.fertCent], [t("PSM"), tot.psmCent], [t("Wasser"), tot.waterCent], [t("Material"), tot.materialCent], [t("Handarbeit"), tot.handCent], [t("davon Diesel"), tot.dieselCent]] as [string, number][]).map(([k, v], i) => (
            <div key={i} className="px-3 py-2" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[9.5px] text-nx-text-muted">{k}</div>
              <div className="num text-[12px] font-semibold">{fmtMoney(v)}</div>
            </div>
          ))}
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          <b>{t("Alles hier editierbar")}</b>{t(": Überfahrten (Feld vor der Maschine), Betriebsmittel-")}<b>{t("Menge")}</b>{t(" (Saatstärke, kg N/P₂O₅/K₂O, mm Wasser) und ")}<b>{t("Stücksatz")}</b>{t(" (€/Einheit — schreibt die Preis-Annahme, wirkt überall). Bei €/ha-Blöcken (PSM-Mittel, Handarbeit, Material) ist die Menge der Satz selbst. Maschinenzeile zeigt Breite · Geschwindigkeit · Effizienz → ha/h (Stammdaten im Register änderbar). Die Maschinen-Stunden treiben zugleich den Maschinenbedarf → Investition − Bestand.")}
        </div>
      </section>

      {/* Roll-up Betrieb */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Betriebssumme · alle Kulturen im Anbauplan")} ({fmtNumber(rollTot.ha, 0)} ha)</h3>
          <JahrWahl jahre={jahre} wert={jy} onChange={setJahr} />
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-6" style={{ background: "var(--nx-border-divider)" }}>
          {([[t("Direktkosten gesamt"), fmtMoney(rollTot.total) + " €", "var(--nx-locate)"], ["Ø €/ha", fmtMoney(rollTot.ha > 0 ? rollTot.total / rollTot.ha : 0) + " €"], [t("Maschinen"), fmtMoney(rollTot.masch) + " €"], [t("Betriebsmittel"), fmtMoney(rollTot.bm) + " €"], ["Diesel", fmtNumber(rollTot.dieselL, 0) + " l"], [t("Fahrer-Feldstunden"), fmtNumber(rollTot.fahrerH, 0) + " h"]] as [string, string, string?][]).map(([k, v, c], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[13px] font-semibold" style={{ color: c ?? "var(--nx-text)" }}>{v}</div>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead><tr>
              <th className={th + " text-left"}>{t("Kultur")}</th><th className={th + " text-right"}>{t("Fläche ha")}</th>
              <th className={th + " text-right"}>€/ha</th><th className={th + " text-right"}>{t("Maschinen €/ha")}</th>
              <th className={th + " text-right"}>{t("BM €/ha")}</th><th className={th + " text-right"}>Diesel l/ha</th>
              <th className={th + " text-right"}>{t("Fahrer Ak-h")}</th><th className={th + " text-right"}>{t("Σ Direktkosten")}</th>
            </tr></thead>
            <tbody>
              {roll.map((c: CropCalc) => (
                <tr key={c.cropId} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5"><span className="inline-flex items-center gap-1.5"><span style={{ width: 8, height: 8, borderRadius: 2, background: cropColor(c.cropId), display: "inline-block" }} />{c.name}</span></td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtNumber(c.areaHa, 0)}</td>
                  <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(c.totals.totalCent)}</td>
                  <td className="num px-2 py-1.5 text-right">{fmtMoney(c.totals.maschineCent)}</td>
                  <td className="num px-2 py-1.5 text-right">{fmtMoney(c.totals.bmCent)}</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtNumber(c.totals.dieselLHa, 0)}</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtNumber(c.totals.fahrerHHa, 1)}</td>
                  <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(c.totals.totalCent * c.areaHa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ProductPicker
        open={!!picker}
        onClose={() => setPicker(null)}
        products={products}
        cropId={crop}
        cropName={t((CROP_NAME as Record<string, string>)[crop] ?? crop)}
        opCode={picker?.opCode}
        label={picker?.label}
        currentId={picker ? domain.catalog.find((c) => c.cropId === crop)?.ops.find((o) => o.code === picker.opCode)?.lines[picker.lineIdx]?.productId : undefined}
        onPick={(p) => picker && setProduct(picker.opCode, picker.lineIdx, p)}
      />
    </div>
  );
}
