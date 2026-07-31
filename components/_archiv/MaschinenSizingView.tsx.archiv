"use client";
import React from "react";
import { useModelStore, readAssumption, selectDerivedCapex, selectScopedDomain } from "../../store/modelStore";
import { deriveFleetSizing, machineFleetCount, machineUnitPriceCent, CROP_NAME, MACHINE_LABELS, SKALIERUNG_TOTAL_HA, START_YEAR, type FleetSize, type MachineType } from "../../store/model";
import { fmtMoney, fmtNumber } from "../../design/format";
import { NumberInput } from "./NumberInput";
import { AssumptionField } from "./AssumptionField";
import { cropColor } from "./cropCalc";
import { t } from "../../lib/i18n";

const STATUS: Record<FleetSize["status"], { label: string; color: string; bg: string }> = {
  under:   { label: "untermechanisiert", color: "#B42318", bg: "rgba(180,35,24,.10)" },
  min:     { label: "am Minimum",        color: "#B54708", bg: "rgba(181,71,8,.10)" },
  reserve: { label: "Reserve",           color: "#067647", bg: "rgba(6,118,71,.10)" },
};
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Maschinen-Werkbank — EIN interaktives Blatt: alle Sizing-Hebel (Arbeitsbreite,
 *  Fahrgeschwindigkeit, Feldeffizienz, Feldtage, Schichten, h/Tag, Bestand) an einer Stelle.
 *  C_eff = Breite × Geschw. × Eff ÷ 10 fällt live; daraus Bedarf → Minimum → Auslastung/Reserve →
 *  Neu-CAPEX & Stammfahrer. Spielbar: jede Zelle ändern, alles rechnet sofort nach. */
export function MaschinenSizingView() {
  const { domain, view, patch } = useModelStore();
  const sc = view.scenarioId;
  const upd = (id: string, fn: (m: MachineType) => void) => patch((d) => { const i = d.machineCatalog.findIndex((m) => m.id === id); if (i >= 0) fn(d.machineCatalog[i]); });
  const mById = (id: string) => domain.machineCatalog.find((m) => m.id === id);

  const stageLbl = t("Skalierungspfad der Kulturen");
  // Bedarf/Flotte über die Domäne (Solo-Modell: keine Stufen-/Scope-Filterung mehr).
  const sdomain = useModelStore(selectScopedDomain);
  const { machines, tractors } = deriveFleetSizing(sdomain, sc);
  const all = [...tractors, ...machines];
  const unit = (id: string) => { const m = mById(id); return m ? machineUnitPriceCent(domain, m, sc) : 0; };

  const shifts = readAssumption(domain, "en.shifts", sc) ?? 2;
  const shiftEff = readAssumption(domain, "en.shift_eff", sc) ?? 0.7;
  const shiftFactor = 1 + (Math.max(1, shifts) - 1) * shiftEff;

  // Feldspritzen — aus jeder Kultur (PSM), aber fenster-/tank-getrieben (deriveSprayFleet), nicht Formelblock.
  const sprayRows = ["spray_sf", "spray_gz"].map((id) => {
    const m = mById(id); if (!m) return null;
    const required = machineFleetCount(sdomain, m, sc);
    const owned = Math.max(0, Math.round(m.ownedUnits ?? 0));
    const reserve = owned - required;
    const status: FleetSize["status"] = required > owned ? "under" : owned > required ? "reserve" : "min";
    return { id, label: m.label, required, owned, newUnits: Math.max(0, required - owned), reserve, status };
  }).filter(Boolean) as { id: string; label: string; required: number; owned: number; newUnits: number; reserve: number; status: FleetSize["status"] }[];

  // SSOT für Umfang & CAPEX = deriveCapex (assetClass 'machinery', NETTO) — identisch zu Investitionen.
  const derived = useModelStore(selectDerivedCapex);
  const machineryCapex = derived.filter((d) => d.assetClass === "machinery");
  const capexById = new Map(machineryCapex.map((d) => [d.machineId, d]));
  const netAmount = (id: string) => capexById.get(id)?.amount ?? 0;
  // Logistik/Sonstige-Maschinen, die NICHT über Schlagkraft gesizt sind, aber in den Maschinen-CAPEX zählen.
  const sizedShown = new Set<string>([...all.map((r) => r.machineId), ...sprayRows.map((r) => r.id)]);
  const extraCapex = machineryCapex.filter((d) => !sizedShown.has(d.machineId) && ((d.newUnits ?? 0) > 0 || d.count > 0));
  const sumBedarf = machineryCapex.reduce((s, d) => s + d.count, 0);
  const sumOwned = machineryCapex.reduce((s, d) => s + (d.ownedUnits ?? 0), 0);
  const sumNeu = machineryCapex.reduce((s, d) => s + (d.newUnits ?? 0), 0);
  const sumNeuCapex = machineryCapex.reduce((s, d) => s + d.amount, 0);
  const underCount = all.filter((r) => r.status === "under").length;
  const reserveCount = all.filter((r) => r.status === "reserve").length;
  const verdict = underCount > 0 ? `${underCount} ${t("Klasse(n) untermechanisiert")}` : reserveCount > all.length / 2 ? t("Reserve vorhanden") : t("nahe am Minimum");
  const verdictColor = underCount > 0 ? STATUS.under.color : reserveCount > all.length / 2 ? STATUS.reserve.color : STATUS.min.color;

  const overrideOf = (id: string) => mById(id)?.fleetOverride;

  // AUFBAUPFAD der Flotte über die PLANJAHRE. Vorher standen hier fixe Marken von
  // 4.000 / 10.000 / 20.000 ha — Flächen aus dem alten Gruppenmodell, die NEOTERRA solo
  // nie erreicht (Zielzustand 2.334 ha). Der Report rechnete damit einen Park, den es im
  // Plan nicht gibt. Jetzt: der Bedarf je Planjahr auf der Skalierungskurve, und die
  // Differenz zum Vorjahr — das ist der Moment, in dem tatsächlich gekauft wird.
  const baseHa = sdomain.anbauplan.reduce((s, a) => s + a.areaHa, 0) || 1;
  const JAHRE = SKALIERUNG_TOTAL_HA.map((ha, i) => ({ jahr: START_YEAR + i, ha }));
  const reqAt = (r: FleetSize, ha: number) => r.capPerUnitHours > 0 ? Math.ceil((r.demandHours * (ha / baseHa)) / r.capPerUnitHours) : 0;
  /** Erstes Planjahr, in dem die Klasse überhaupt gebraucht wird. */
  const abJahr = (r: FleetSize) => {
    const i = JAHRE.findIndex((j) => reqAt(r, j.ha) > 0);
    return i < 0 ? null : JAHRE[i].jahr;
  };

  const ops: { crop: string; mId: string; passes: number; area: number; cEff: number; hours: number }[] = [];
  for (const a of sdomain.anbauplan) for (const g of sdomain.arbeitsgaenge[a.cropId] ?? []) {
    const m = mById(g.m); const cEff = m?.cEff ?? 0; if (!cEff) continue;
    ops.push({ crop: a.cropId, mId: g.m, passes: g.passes, area: a.areaHa, cEff, hours: (g.passes * a.areaHa) / cEff });
  }
  const [showOps, setShowOps] = React.useState(false);

  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";
  // Sticky-Kopf (nur Haupttabelle): fixiert die obere Zeile im eigenen Scroll-Container.
  const thStick = "sticky top-0 z-10 bg-[color:var(--nx-surface)] px-2 py-1.5 caption text-[10px] text-nx-text-muted";
  const CropChips = ({ ids }: { ids: string[] }) => (
    <span className="inline-flex flex-wrap gap-1">
      {ids.length ? ids.map((c) => (
        <span key={c} className="inline-flex items-center gap-1 rounded px-1 text-[9.5px]" style={{ background: "var(--nx-app-bg)", border: "1px solid var(--nx-border-divider)" }}>
          <span style={{ width: 6, height: 6, borderRadius: 2, background: cropColor(c), display: "inline-block" }} />
          {(CROP_NAME as Record<string, string>)[c] ?? c}
        </span>
      )) : <span className="text-[9.5px] text-nx-text-muted">{t("gepoolt")}</span>}
    </span>
  );

  const RowEl = ({ r }: { r: FleetSize }) => {
    const m = mById(r.machineId);
    const st = STATUS[r.status];
    const util = isFinite(r.utilOwnedPct) ? Math.round(r.utilOwnedPct) : null;
    const hasKin = m?.widthM != null && !r.isTractor;
    const reserve = r.owned - r.required;
    return (
      <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
        <td className="px-2 py-1.5" style={{ minWidth: 150 }}>
          <div className="text-[12px] font-medium">{m?.label ?? r.machineId}</div>
          <CropChips ids={r.crops} />
        </td>
        {/* Leistungsdaten (editierbar) */}
        <td className="px-1 py-1.5 text-right">{hasKin ? <NumberInput value={m!.widthM!} width={44} onCommit={(v) => upd(r.machineId, (mm) => { mm.widthM = v; mm.cEff = r2(v * (mm.speedKmh ?? 0) * (mm.fieldEff ?? 0) / 10); })} /> : <span className="text-nx-text-muted">–</span>}</td>
        <td className="px-1 py-1.5 text-right">{hasKin ? <NumberInput value={m!.speedKmh ?? 0} width={44} onCommit={(v) => upd(r.machineId, (mm) => { mm.speedKmh = v; mm.cEff = r2((mm.widthM ?? 0) * v * (mm.fieldEff ?? 0) / 10); })} /> : <span className="text-nx-text-muted">–</span>}</td>
        <td className="px-1 py-1.5 text-right">{hasKin ? <NumberInput value={Math.round((m!.fieldEff ?? 0) * 100)} width={40} onCommit={(v) => upd(r.machineId, (mm) => { mm.fieldEff = Math.max(0, v) / 100; mm.cEff = r2((mm.widthM ?? 0) * (mm.speedKmh ?? 0) * (Math.max(0, v) / 100) / 10); })} /> : <span className="text-nx-text-muted">–</span>}</td>
        <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{r.cEff ? fmtNumber(r.cEff, 2) : "–"}</td>
        <td className="px-1 py-1.5 text-right"><NumberInput value={r.feldTage} width={40} onCommit={(v) => upd(r.machineId, (mm) => { mm.windowDays = Math.max(1, Math.round(v)); })} /></td>
        <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtNumber(r.demandHours, 0)}</td>
        <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: "var(--nx-locate)" }}>{r.required}</td>
        <td className="px-1 py-1.5 text-right"><NumberInput value={r.owned} width={42} onCommit={(v) => upd(r.machineId, (mm) => { mm.ownedUnits = Math.max(0, Math.round(v)); })} /></td>
        <td className="num px-2 py-1.5 text-right" style={{ color: util != null && util > 100 ? STATUS.under.color : "var(--nx-text)" }}>{util != null ? `${util}%` : "–"}</td>
        <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: reserve < 0 ? STATUS.under.color : reserve > 0 ? STATUS.reserve.color : STATUS.min.color }}>{reserve > 0 ? `+${reserve}` : reserve}</td>
        <td className="px-2 py-1.5"><span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: st.color, background: st.bg }}>{t(st.label)}</span></td>
        <td className="num px-2 py-1.5 text-right font-semibold">{r.newUnits || "–"}</td>
        <td className="num px-2 py-1.5 text-right text-nx-text-muted">{netAmount(r.machineId) ? fmtMoney(netAmount(r.machineId)) : "–"}</td>
        <td className="px-1 py-1.5 text-right">
          <span className="inline-flex items-center gap-1">
            <NumberInput value={overrideOf(r.machineId) ?? r.park} width={40} onCommit={(v) => upd(r.machineId, (mm) => { mm.fleetOverride = Math.max(0, Math.round(v)); })} />
            {overrideOf(r.machineId) != null && <button title={t("Override lösen")} className="text-[11px] text-nx-error" onClick={() => upd(r.machineId, (mm) => { mm.fleetOverride = undefined; })}>×</button>}
          </span>
        </td>
      </tr>
    );
  };

  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h3 className="text-[13px] font-semibold">{t("Bedarf ↔ Bestand · Auslastung & Reserve ·")} {stageLbl}</h3>
        <span className="rounded px-2 py-0.5 text-[11px] font-semibold" style={{ color: verdictColor, background: "var(--nx-app-bg)" }}>{verdict}</span>
      </div>

      {/* Globale Einsatz-Hebel (alle Klassen) */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)", background: "var(--nx-app-bg)" }}>
        <span className="caption text-[10px] font-semibold text-nx-text-muted">{t("GLOBAL:")}</span>
        <label className="flex items-center gap-2 text-[11.5px] text-nx-text-secondary">{t("Feldstunden / Tag")} <AssumptionField akey="en.hours_day" /></label>
        <label className="flex items-center gap-2 text-[11.5px] text-nx-text-secondary">{t("Schichten")} <AssumptionField akey="en.shifts" /></label>
        <label className="flex items-center gap-2 text-[11.5px] text-nx-text-secondary">{t("Schicht-Effekt")} <AssumptionField akey="en.shift_eff" /></label>
        <span className="text-[11.5px] text-nx-text-muted">{t("→ Schichtfaktor")} <b style={{ color: "var(--nx-brand-lift)" }}>{fmtNumber(shiftFactor, 2)}×</b></span>
      </div>

      <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)" }}>
        {([[t("Bedarf (Park gesamt)"), `${sumBedarf} ${t("Einh.")}`, "var(--nx-locate)"], [t("Bestand"), `${sumOwned} ${t("Einh.")}`, "var(--nx-brand-lift)"], [t("Neu nötig"), `${sumNeu} ${t("Einh.")}`, sumNeu > 0 ? STATUS.under.color : STATUS.reserve.color], [t("Σ Neu-CAPEX (netto → Investitionen)"), `${fmtMoney(sumNeuCapex)} €`, "var(--nx-locate)"]] as [string, string, string?][]).map(([k, v, c], i) => (
          <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
            <div className="caption text-[10px] text-nx-text-muted">{k}</div>
            <div className="num text-[13px] font-semibold" style={{ color: c ?? "var(--nx-text)" }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="px-2 py-2" style={{ maxHeight: "calc(100vh - 260px)", overflow: "auto" }}>
        <table className="w-full text-[12px]" style={{ minWidth: 1100 }}>
          <thead><tr>
            <th className={thStick + " text-left"}>{t("Maschine / Kulturen")}</th>
            <th className={thStick + " text-right"}>{t("Breite")} <span className="font-normal">m</span></th>
            <th className={thStick + " text-right"}>{t("Geschw.")} <span className="font-normal">km/h</span></th>
            <th className={thStick + " text-right"}>{t("Feldeff.")} <span className="font-normal">%</span></th>
            <th className={thStick + " text-right"} title={t("Effektive Flächenleistung = Breite × Geschwindigkeit × Feldeffizienz ÷ 10")}>
              C_eff <span className="font-normal">ha/h</span>
            </th>
            <th className={thStick + " text-right"}>{t("Feldtage")} <span className="font-normal">d</span></th>
            <th className={thStick + " text-right"}>{t("Bedarf")} <span className="font-normal">h</span></th>
            <th className={thStick + " text-right"}>{t("Minimum")} <span className="font-normal">{t("Stk")}</span></th>
            <th className={thStick + " text-right"}>{t("Bestand")} <span className="font-normal">{t("Stk")}</span></th>
            <th className={thStick + " text-right"}>{t("Ausl.")} <span className="font-normal">%</span></th>
            <th className={thStick + " text-right"}>{t("Reserve")} <span className="font-normal">{t("Stk")}</span></th>
            <th className={thStick + " text-left"}>{t("Status")}</th>
            <th className={thStick + " text-right"}>{t("Neu")}</th>
            <th className={thStick + " text-right"}>{t("Σ Neu")}</th>
            <th className={thStick + " text-right"}>{t("Fix⁑")}</th>
          </tr></thead>
          <tbody>
            <tr style={{ background: "var(--nx-app-bg)" }}><td className="px-2 py-1 caption text-[10px] font-semibold" colSpan={15}>{t("Zugmaschinen (betriebsweit gepoolt)")}</td></tr>
            {tractors.map((r) => <RowEl key={r.machineId} r={r} />)}
            <tr style={{ background: "var(--nx-app-bg)" }}><td className="px-2 py-1 caption text-[10px] font-semibold" colSpan={15}>{t("Anbaugeräte, Ernte- & Spezialtechnik")}</td></tr>
            {machines.map((r) => <RowEl key={r.machineId} r={r} />)}
            <tr style={{ background: "var(--nx-app-bg)" }}><td className="px-2 py-1 caption text-[10px] font-semibold" colSpan={15}>{t("Feldspritzen — Stückzahl aus Spritzstrategie (Fenster/Tank/48-m)")}</td></tr>
            {sprayRows.map((r) => {
              const st = STATUS[r.status];
              return (
                <tr key={r.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5 text-[12px] font-medium">{r.label}</td>
                  <td className="px-1 py-1.5 text-right text-nx-text-muted" colSpan={5} style={{ fontStyle: "italic" }}>{t("→ Leistungsparameter · Spritzstrategie (Breite/Tank/Fenster)")}</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">–</td>
                  <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: "var(--nx-locate)" }}>{r.required}</td>
                  <td className="px-1 py-1.5 text-right"><NumberInput value={r.owned} width={42} onCommit={(v) => upd(r.id, (mm) => { mm.ownedUnits = Math.max(0, Math.round(v)); })} /></td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">–</td>
                  <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: r.reserve < 0 ? STATUS.under.color : r.reserve > 0 ? STATUS.reserve.color : STATUS.min.color }}>{r.reserve > 0 ? `+${r.reserve}` : r.reserve}</td>
                  <td className="px-2 py-1.5"><span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: st.color, background: st.bg }}>{t(st.label)}</span></td>
                  <td className="num px-2 py-1.5 text-right font-semibold">{r.newUnits || "–"}</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">{netAmount(r.id) ? fmtMoney(netAmount(r.id)) : "–"}</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">–</td>
                </tr>
              );
            })}
            {extraCapex.length > 0 && (
              <>
                <tr style={{ background: "var(--nx-app-bg)" }}><td className="px-2 py-1 caption text-[10px] font-semibold" colSpan={15}>{t("Weitere Maschinen (Logistik & Sonstige · planzahl-/tonnagegetrieben)")}</td></tr>
                {extraCapex.map((d) => {
                  const m = mById(d.machineId);
                  return (
                    <tr key={d.machineId} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                      <td className="px-2 py-1.5 text-[12px] font-medium">{m?.label ?? d.label}</td>
                      <td className="px-1 py-1.5 text-right text-nx-text-muted" colSpan={5} style={{ fontStyle: "italic" }}>{t("Planzahl / Tonnage (kein Schlagkraft-Sizing)")}</td>
                      <td className="num px-2 py-1.5 text-right text-nx-text-muted">–</td>
                      <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: "var(--nx-locate)" }}>{d.count}</td>
                      <td className="px-1 py-1.5 text-right"><NumberInput value={d.ownedUnits ?? 0} width={42} onCommit={(v) => upd(d.machineId, (mm) => { mm.ownedUnits = Math.max(0, Math.round(v)); })} /></td>
                      <td className="num px-2 py-1.5 text-right text-nx-text-muted">–</td>
                      <td className="num px-2 py-1.5 text-right text-nx-text-muted">–</td>
                      <td className="px-2 py-1.5"></td>
                      <td className="num px-2 py-1.5 text-right font-semibold">{(d.newUnits ?? 0) || "–"}</td>
                      <td className="num px-2 py-1.5 text-right text-nx-text-muted">{d.amount ? fmtMoney(d.amount) : "–"}</td>
                      <td className="num px-2 py-1.5 text-right text-nx-text-muted">–</td>
                    </tr>
                  );
                })}
              </>
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
        <b>C_eff</b> {t("= Breite × Geschwindigkeit × Effizienz ÷ 10 (ha/h) — alle drei editierbar, C_eff fällt live.")} <b>{t("Bedarf h")}</b> {t("= Σ Überfahrten × Fläche ÷ C_eff.")} <b>{t("Minimum")}</b> {t("= ⌈Bedarf ÷ (h/Tag × Feldtage × Schichtfaktor)⌉.")} <b>{t("Ausl.")}</b> {t("= Bedarf ÷ Kapazität des Bestands (> 100 % ⇒ untermechanisiert),")} <b>{t("Reserve")}</b> {t("= Bestand − Minimum. Treibt CAPEX (Neu = Minimum − Bestand) & Stammfahrer.")}
        <br />⁑ <b>{t("Fix")}</b> {t("= Hybrid-Override (manuelle Stückzahl, „×\" löst ihn). Zugklassen sind gepoolt (C_eff aus den Anbaugeräten), daher ohne Breite/Speed.")} <b>{t("Σ Neu-CAPEX (netto)")}</b> {t("deckt sich exakt mit den Maschinen-Investitionen (netto, gleiche Maschinen-Menge inkl. Logistik/Sonstige unten). Nicht hier: Bewässerung/Pivot, Lager, IoT — das sind keine Maschinen, sondern eigene CAPEX-Blöcke (Investitionen · weitere Reiter).")}
      </div>

      {/* Aufbaupfad — Flottenbedarf je Planjahr */}
      <div className="border-t px-4 py-3" style={{ borderColor: "var(--nx-border)" }}>
        <h4 className="text-[12.5px] font-semibold mb-1.5">{t("Aufbaupfad der Flotte · welche Klasse kommt in welchem Planjahr dazu?")}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                <th className={th + " text-left"}>{t("Maschine")}</th>
                <th className={th + " text-left"}>{t("ab")}</th>
                {JAHRE.map((j) => <th key={j.jahr} className={th + " text-right"}>{j.jahr}</th>)}
              </tr>
              <tr>
                <th className={th + " text-left"} />
                <th className={th + " text-left"} />
                {JAHRE.map((j) => <th key={j.jahr} className={th + " num text-right font-normal"}>{fmtNumber(j.ha, 0)} ha</th>)}
              </tr>
            </thead>
            <tbody>
              {all.map((r) => {
                const ab = abJahr(r);
                let vor = 0;
                return (
                  <tr key={r.machineId} style={{ borderTop: "1px solid var(--nx-border-divider)", opacity: ab === null ? 0.5 : 1 }}>
                    <td className="px-2 py-1.5 text-[12px]">{r.label}</td>
                    <td className="px-2 py-1.5">
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ color: ab === null ? "var(--nx-text-muted)" : ab === START_YEAR ? STATUS.under.color : STATUS.min.color, background: "var(--nx-app-bg)" }}>
                        {ab === null ? t("nicht im Plan") : ab}
                      </span>
                    </td>
                    {JAHRE.map((j) => {
                      const need = reqAt(r, j.ha);
                      const zu = need - vor; vor = need;
                      return (
                        <td key={j.jahr} className="num px-2 py-1.5 text-right font-semibold"
                            style={{ color: need === 0 ? "var(--nx-text-muted)" : "var(--nx-text)" }}>
                          {need || "–"}{zu > 0 && need > 0 ? <span style={{ color: STATUS.under.color }}> (+{zu})</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-nx-text-muted mt-1.5">
          {t("Zahl = benötigte Stückzahl bei der Fläche des Planjahres (Bedarfsstunden skalieren linear mit ha).")} <span style={{ color: STATUS.under.color }}>{t("(+n)")}</span> {t("= Zugang gegenüber dem Vorjahr, also das Jahr, in dem die Investition anfällt. ‚ab‘ = erstes Planjahr, in dem die Klasse überhaupt gebraucht wird — genau ab da kapitalisiert das Modell sie. Kulturen, die im Plan nicht vorkommen, bleiben grau.")}
        </div>
      </div>

      <div className="border-t px-4 py-2" style={{ borderColor: "var(--nx-border)" }}>
        <button className="text-[11px] font-semibold" style={{ color: "var(--nx-brand-lift)" }} onClick={() => setShowOps((v) => !v)}>
          {showOps ? "▾" : "▸"} {t("Leistungsdaten je Arbeitsgang")} ({ops.length})
        </button>
        {showOps && (
          <div className="overflow-x-auto pt-2">
            <table className="w-full text-[12px]">
              <thead><tr>
                <th className={th + " text-left"}>{t("Kultur")}</th><th className={th + " text-left"}>{t("Arbeitsgang / Maschine")}</th>
                <th className={th + " text-right"}>{t("Überfahrten")}</th><th className={th + " text-right"}>{t("Fläche ha")}</th>
                <th className={th + " text-right"}>C_eff ha/h</th><th className={th + " text-right"}>{t("h/Jahr")}</th>
              </tr></thead>
              <tbody>
                {ops.map((o, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                    <td className="px-2 py-1"><span className="inline-flex items-center gap-1.5"><span style={{ width: 8, height: 8, borderRadius: 2, background: cropColor(o.crop), display: "inline-block" }} />{(CROP_NAME as Record<string, string>)[o.crop] ?? o.crop}</span></td>
                    <td className="px-2 py-1 text-nx-text-secondary">{MACHINE_LABELS[o.mId] ?? o.mId}</td>
                    <td className="px-1 py-1 text-right"><NumberInput value={o.passes} width={40} onCommit={(v) => patch((d) => { const g = (d.arbeitsgaenge[o.crop] ?? []).find((x) => x.m === o.mId); if (g) g.passes = Math.max(0, Math.round(v)); })} /></td>
                    <td className="num px-2 py-1 text-right">{fmtNumber(o.area, 0)}</td>
                    <td className="num px-2 py-1 text-right text-nx-text-muted">{fmtNumber(o.cEff, 2)}</td>
                    <td className="num px-2 py-1 text-right font-semibold">{fmtNumber(o.hours, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
