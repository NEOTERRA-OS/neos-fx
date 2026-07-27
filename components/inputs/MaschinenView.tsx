"use client";
import React from "react";
import { useModelStore, selectDerivedCapex, selectScopedDomain, readAssumption } from "../../store/modelStore";
import { machineUnitPriceCent, type MachineType } from "../../store/model";
import { NumberInput, TextInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import { X } from "lucide-react";

/** Maschinen-Register — BESTAND & EINZELKOSTEN je Maschine (Stammdaten):
 *  Kategorie · Hersteller · Produkt · Stückpreis (Liste) · Discount · Rücknahme · Bestand · Bestandswert.
 *  KEINE Investitionsrechnung hier — Neuanschaffungen (Bedarf − Bestand) stehen in der Sicht „Investitionen". */
export function MaschinenView() {
  const { domain, patch } = useModelStore();
  const scenarioId = useModelStore((s) => s.view.scenarioId);
  const derived = useModelStore(selectDerivedCapex);
  // Anlagenregister folgt der aktiven Stufe/Scope: Stufe 1 (nur Ackerbau) zeigt KEINE Wertkultur-Maschinen.
  const sdomain = useModelStore(selectScopedDomain);
  const scopedIds = new Set(sdomain.machineCatalog.map((m) => m.id));
  // Augmentierung aus den Investitionen: Neu-Stück je Maschine (Bedarf − Bestand, aus der Werkbank).
  const newById = new Map(derived.map((d) => [d.machineId, d.newUnits ?? 0]));
  const sumNew = derived.reduce((a, d) => a + (d.newUnits ?? 0), 0);

  const gDisc = readAssumption(domain, "tco.discount", scenarioId) ?? 0;
  const gResTrail = readAssumption(domain, "tco.res_trail", scenarioId) ?? 0;
  const gResSelf = readAssumption(domain, "tco.res_self", scenarioId) ?? 0;
  const effDisc = (m: MachineType) => m.discountPct ?? gDisc;
  const effRes = (m: MachineType) => m.residualPctList ?? (m.cat === "gezogen" ? gResTrail : gResSelf);

  const byId = new Map(domain.machineCatalog.map((m) => [m.id, m.productName ?? m.label]));
  const idxOf = (id: string) => domain.machineCatalog.findIndex((m) => m.id === id);
  const upd = (id: string, fn: (m: MachineType) => void) => patch((d) => { const i = d.machineCatalog.findIndex((m) => m.id === id); if (i >= 0) fn(d.machineCatalog[i]); });
  const addMachine = (cat = "Sonstiges") => patch((d) => {
    let n = 1; while (d.machineCatalog.some((m) => m.id === `m-custom-${n}`)) n++;
    d.machineCatalog.push({
      id: `m-custom-${n}`, label: "Neue Maschine", productName: "Neue Maschine", category: cat, manufacturer: "—",
      mode: "fixedFleet", driver: { kind: "total" }, assetClass: cat === "Bewässerung" ? "irrigation" : cat === "Gebäude & Infrastruktur" ? "buildings" : cat === "IoT / Digitalisierung" ? "other" : "machinery",
      afaCommercialYears: 10, afaFiscalYears: 9, fleetStage1: 1, priceCent: 0, cat: "selbstf", restwertPct: 0.25, nutzungYears: 10, custom: true,
    });
  });

  // Kanonische Reihenfolge — Feld-Arbeitsfolge, dann Trag-/Infrastruktur-Klassen.
  const CAT_ORDER = ["Zugmaschinen", "Bodenbearbeitung", "Aussaat & Pflanzung", "Düngung", "Pflanzenschutz", "Ernte", "Transport", "Logistik", "Hoftechnik", "Bewässerung", "Gebäude & Infrastruktur", "IoT / Digitalisierung", "Sonstiges"];
  const present = Array.from(new Set(sdomain.machineCatalog.map((m) => m.category ?? "Sonstiges")));
  const cats = [...CAT_ORDER.filter((c) => present.includes(c)), ...present.filter((c) => !CAT_ORDER.includes(c))];
  // Restbuchwert je Bestandsmaschine: Netto-Neupreis linear abgeschrieben über die Nutzungsdauer
  //  bis auf den Restwert-Floor: Netto × max(Restwert-%, 1 − (1−Restwert-%) × Alter/Nutzung).
  // Verschleiß = MAXIMUM aus Alter, Betriebsstunden und bearbeiteter Fläche (Bh/ha bilden reale
  //  Nutzung genauer ab als das Alter; eine junge, aber intensiv gefahrene Maschine ist mehr verzehrt).
  const wearFrac = (m: MachineType) => {
    const nutz = m.nutzungYears ?? m.afaCommercialYears ?? 10;
    const ageFrac = nutz > 0 ? Math.max(0, m.ownedAgeYears ?? 0) / nutz : 0;
    const lifeHours = (m.refHoursPerYear ?? 0) * nutz;
    const hoursFrac = lifeHours > 0 && m.ownedHours ? m.ownedHours / lifeHours : 0;
    const lifeHa = lifeHours * (m.cEff ?? 0);
    const haFrac = lifeHa > 0 && m.ownedHa ? m.ownedHa / lifeHa : 0;
    return Math.min(1, Math.max(ageFrac, hoursFrac, haFrac));
  };
  const bestandWert = (m: MachineType) => {
    const netto = machineUnitPriceCent(domain, m, scenarioId) * (1 - effDisc(m));
    const floor = effRes(m);
    const f = Math.max(floor, 1 - (1 - floor) * wearFrac(m));
    return Math.round((m.ownedUnits ?? 0) * netto * f);
  };
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const bestandByCat = (cat: string) => sdomain.machineCatalog.filter((m) => (m.category ?? "Sonstiges") === cat)
    .reduce((a, m) => a + bestandWert(m), 0);
  const sumBestandUnits = sdomain.machineCatalog.reduce((a, m) => a + (m.ownedUnits ?? 0), 0);
  const sumBestandWert = sdomain.machineCatalog.reduce((a, m) => a + bestandWert(m), 0);
  const INFRA = new Set(["Bewässerung", "Gebäude & Infrastruktur"]);
  // Kopfzeile beim Scrollen fixieren (sticky, opaker Surface-Hintergrund).
  const th = "sticky top-0 z-10 bg-[color:var(--nx-surface)] px-2 py-2 caption text-[10px] text-nx-text-muted";
  const selStyle = { height: 32, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" } as const;

  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h2 className="text-[14px] font-semibold">{t("Maschinenbestand — Anlagenregister (heutiger Park)")}</h2>
        <span className="caption text-[10.5px] text-nx-text-muted">{t("Heutiger Park + Investitionen = Park gesamt · Leistungsdaten → Leistungsparameter")}</span>
      </div>
      <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)" }}>
        {([
          [t("Bestand heute (Einh.)"), `${fmtNumber(sumBestandUnits, 0)}`, "var(--nx-brand-lift)"],
          [t("Bestandswert (Netto)"), `${fmtMoney(sumBestandWert)} €`, "var(--nx-brand-lift)"],
          [t("+ Neu (aus Investitionen)"), `${fmtNumber(sumNew, 0)}`, "var(--nx-locate)"],
          [t("= Park gesamt (Einh.)"), `${fmtNumber(sumBestandUnits + sumNew, 0)}`],
        ] as [string, string, string?][]).map(([k, v, c], i) => (
          <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
            <div className="caption text-[10px] text-nx-text-muted">{k}</div>
            <div className="num text-[15px] font-semibold" style={{ color: c ?? "var(--nx-text)" }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="px-2 py-2" style={{ maxHeight: "calc(100vh - 250px)", overflow: "auto" }}>
        <table className="w-full text-[12px]" style={{ minWidth: 1500 }}>
          <thead>
            <tr>
              <th className={th + " text-left"}>{t("Hersteller")}</th>
              <th className={th + " text-left"}>{t("Modell (exakt)")}</th>
              <th className={th + " text-left"}>{t("Bauart")}</th>
              <th className={th + " text-right"}>{t("Stückpreis (Liste)")}</th>
              <th className={th + " text-right"}>{t("Discount")}</th>
              <th className={th + " text-right"}>{t("Netto-Stück")}</th>
              <th className={th + " text-right"}>{t("Rücknahme")}</th>
              <th className={th + " text-right"}>{t("Rückn. €")}</th>
              <th className={th + " text-right"} style={{ color: "var(--nx-brand-lift)" }}>{t("Bestand")}</th>
              <th className={th + " text-right"} style={{ color: "var(--nx-locate)" }}>{t("+ Neu")}</th>
              <th className={th + " text-right"}>{t("= Park")}</th>
              <th className={th + " text-right"}>{t("Alter (J.)")}</th>
              <th className={th + " text-right"}>Bh</th>
              <th className={th + " text-right"}>ha</th>
              <th className={th + " text-right"}>{t("Restbuchwert")}</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {cats.map((cat) => {
              const machines = domain.machineCatalog.filter((m) => (m.category ?? "Sonstiges") === cat && scopedIds.has(m.id));
              return (
                <React.Fragment key={cat}>
                  <tr>
                    <td colSpan={16} className="px-2 pt-3 pb-1">
                      <span className="inline-flex items-center gap-2">
                        <span className="caption text-[10px] font-semibold" style={{ color: INFRA.has(cat) ? "var(--nx-locate)" : "var(--nx-brand-lift)" }}>{INFRA.has(cat) ? "▸ " : ""}{cat}</span>
                        <button className="rounded-pill border px-1.5 text-[10px]" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-muted)", background: "var(--nx-surface)" }} title={`${t("Maschine in „")}${cat}${t("\" hinzufügen")}`} onClick={() => addMachine(cat)}>{t("+ Maschine")}</button>
                      </span>
                    </td>
                  </tr>
                  {machines.map((m) => {
                    const listCent = machineUnitPriceCent(domain, m, scenarioId);
                    const disc = effDisc(m), res = effRes(m);
                    const netCent = listCent * (1 - disc);
                    const resCent = listCent * res;
                    const isFleet = m.mode === "fixedFleet";
                    return (
                      <tr key={m.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                        <td className="px-2 py-1.5"><TextInput value={m.manufacturer ?? ""} width={150} onCommit={(v) => upd(m.id, (mm) => { mm.manufacturer = v; })} /></td>
                        <td className="px-2 py-1.5">
                          <TextInput value={m.productName ?? m.label} width={220} onCommit={(v) => upd(m.id, (mm) => { mm.productName = v; mm.label = v; })} />
                          {m.tractorId && <div className="text-[10px] text-nx-text-muted" style={{ marginTop: 2 }} title={t("Zugmaschine (eigene CAPEX-Position)")}>{t("↳ Zug:")} {byId.get(m.tractorId) ?? m.tractorId}</div>}
                        </td>
                        <td className="px-2 py-1.5">
                          {isFleet ? (
                            <select className="rounded-control border px-2 text-[11.5px]" style={selStyle}
                              value={m.cat ?? "selbstf"} onChange={(e) => upd(m.id, (mm) => { mm.cat = e.target.value as "gezogen" | "selbstf"; })}>
                              <option value="gezogen">{t("gezogen")}</option><option value="selbstf">{t("selbstf.")}</option>
                            </select>
                          ) : <span className="text-[11px] text-nx-text-muted">{m.mode === "perHa" ? "€/ha" : "€/t"}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right"><NumberInput value={listCent} moneyCent width={110} onCommit={(nn) => upd(m.id, (mm) => { mm.priceCent = nn; })} /></td>
                        <td className="px-2 py-1.5 text-right"><NumberInput value={disc * 100} width={56} suffix="%" onCommit={(nn) => upd(m.id, (mm) => { mm.discountPct = Math.max(0, nn / 100); })} /></td>
                        <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtMoney(netCent)}</td>
                        <td className="px-2 py-1.5 text-right"><NumberInput value={res * 100} width={56} suffix="%" onCommit={(nn) => upd(m.id, (mm) => { mm.residualPctList = Math.max(0, nn / 100); })} /></td>
                        <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtMoney(resCent)}</td>
                        <td className="px-2 py-1.5 text-right">{isFleet ? <NumberInput value={m.ownedUnits ?? 0} width={48} onCommit={(nn) => upd(m.id, (mm) => { mm.ownedUnits = Math.max(0, Math.round(nn)); })} /> : <span className="num text-[11px] text-nx-text-muted">–</span>}</td>
                        {/* Augmentierung aus den Investitionen (Bedarf − Bestand): + Neu → = Park gesamt */}
                        <td className="num px-2 py-1.5 text-right" style={{ color: "var(--nx-locate)" }}>{isFleet && (newById.get(m.id) ?? 0) > 0 ? `+${fmtNumber(newById.get(m.id) ?? 0, 0)}` : "–"}</td>
                        <td className="num px-2 py-1.5 text-right font-semibold">{isFleet ? fmtNumber((m.ownedUnits ?? 0) + (newById.get(m.id) ?? 0), 0) : "–"}</td>
                        <td className="px-2 py-1.5 text-right">{isFleet && (m.ownedUnits ?? 0) > 0 ? <NumberInput value={m.ownedAgeYears ?? 0} width={44} onCommit={(nn) => upd(m.id, (mm) => { mm.ownedAgeYears = Math.max(0, nn); })} /> : <span className="num text-[11px] text-nx-text-muted">–</span>}</td>
                        {/* Betriebsstunden (alle Bestandsmaschinen) */}
                        <td className="px-2 py-1.5 text-right">{isFleet && (m.ownedUnits ?? 0) > 0 ? <NumberInput value={m.ownedHours ?? 0} width={64} onCommit={(nn) => upd(m.id, (mm) => { mm.ownedHours = Math.max(0, Math.round(nn)); })} /> : <span className="num text-[11px] text-nx-text-muted">–</span>}</td>
                        {/* Bearbeitete Fläche (nur Anbaugeräte mit C_eff) */}
                        <td className="px-2 py-1.5 text-right">{isFleet && (m.ownedUnits ?? 0) > 0 && m.cEff ? <NumberInput value={m.ownedHa ?? 0} width={64} onCommit={(nn) => upd(m.id, (mm) => { mm.ownedHa = Math.max(0, Math.round(nn)); })} /> : <span className="num text-[11px] text-nx-text-muted">–</span>}</td>
                        <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: (m.ownedUnits ?? 0) > 0 ? "var(--nx-brand-lift)" : "var(--nx-text-muted)" }} title={(m.ownedUnits ?? 0) > 0 ? `${t("Verschleiß")} ${Math.round(wearFrac(m) * 100)} ${t("% (Alter/Bh/ha, Maximum)")}` : undefined}>{(m.ownedUnits ?? 0) > 0 ? fmtMoney(bestandWert(m)) : "–"}</td>
                        <td className="px-2 py-1.5 text-right"><button className="text-[12px] text-nx-error" title={t("Maschine entfernen")} onClick={() => patch((dd) => { const i = idxOf(m.id); if (i >= 0) dd.machineCatalog.splice(i, 1); })}><X size={13} strokeWidth={2.5} aria-hidden /></button></td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: "var(--nx-surface-sunken)" }}>
                    <td colSpan={14} className="px-2 py-1 text-right caption text-[10px] text-nx-text-muted">{t("Σ Restbuchwert")} {cat}</td>
                    <td className="num px-2 py-1 text-right font-semibold" style={{ color: INFRA.has(cat) ? "var(--nx-locate)" : "var(--nx-text)" }}>{bestandByCat(cat) ? fmtMoney(bestandByCat(cat)) : "–"}</td>
                    <td />
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-2 py-2.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }} colSpan={14}>{t("Summe Bestand")} · {fmtNumber(sumBestandUnits, 0)} {t("Einheiten")}</td>
              <td className="num px-2 py-2.5 text-right font-semibold">{fmtMoney(sumBestandWert)} €</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t px-4 py-2" style={{ borderColor: "var(--nx-border)" }}>
        <button className="rounded-control border px-3 text-[12px] font-semibold"
          style={{ height: 34, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }}
          onClick={() => addMachine()}>{t("+ Maschine hinzufügen")}</button>
        <span className="text-[11px] text-nx-text-muted">
          <b>{t("Anlagenregister")}</b>{t(" = heutiger Park (Bestand · Alter/Bh/ha → Restbuchwert) + Einkaufs-Stammdaten (Liste/Discount/Rücknahme). ")}<b style={{ color: "var(--nx-locate)" }}>{t("+ Neu")}</b>{t(" = Vorschlag aus den Investitionen (Bedarf − Bestand); ")}<b>{t("= Park")}</b>{t(" = Park nach Umsetzung. Leistungsdaten (Breite/Speed/Eff) → Leistungsparameter.")}
        </span>
      </div>
    </section>
  );
}
