"use client";
import React from "react";
import { fmtMoney, fmtNumber } from "../../design/format";
import { useModelStore, readAssumption } from "../../store/modelStore";
import { deriveTransportDecision, type TransportConfig } from "../../store/model";
import { Segmented } from "../primitives/Segmented";
import { NumberInput } from "./NumberInput";
import { t as tr } from "../../lib/i18n";

/** Kompaktes Eingabefeld: Label oben, editierbarer Wert (de-DE), Einheit. */
function In({ label, value, onCommit, unit, w = 92, moneyCent }: { label: string; value: number; onCommit: (n: number) => void; unit?: string; w?: number; moneyCent?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="caption text-[10px] text-nx-text-muted">{label}</span>
      <span className="flex items-center gap-1"><NumberInput value={value} width={w} moneyCent={moneyCent} onCommit={onCommit} />{unit && <span className="text-[10.5px] text-nx-text-muted">{unit}</span>}</span>
    </label>
  );
}

/** Transport Feld→Abnehmer — editierbare Eingaben + Make-or-Buy (im Modell). */
function TransportDecisionCard() {
  const { domain, view, patch } = useModelStore();
  const d = deriveTransportDecision(domain, view.scenarioId);
  const chosen = domain.decisions.transportToBuyer;
  const t = domain.transport!;
  const setT = (k: keyof TransportConfig, v: number) => patch((dm) => { if (dm.transport) (dm.transport as any)[k] = v; });
  const spedRate = (readAssumption(domain, "transport.spedition_rate", view.scenarioId) ?? 0) / 100;
  const setSped = (v: number) => patch((dm) => { const b = dm.assumptions["transport.spedition_rate"]; if (b) b.scenarioProfiles[dm.baseScenarioId] = { kind: "constant", value: Math.round(v * 100) }; });
  const dieselL = (readAssumption(domain, "price.diesel_l", view.scenarioId) ?? 0) / 100;
  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h2 className="text-[14px] font-semibold">{tr("Transport Feld→Abnehmer — Make-or-Buy")}</h2>
        <Segmented ariaLabel={tr("Transport")} value={chosen}
          onChange={(v) => patch((dm) => { dm.decisions.transportToBuyer = v as "own" | "spedition"; })}
          options={[{ value: "own", label: tr("Eigenflotte") }, { value: "spedition", label: tr("Spedition") }]} />
      </div>

      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border-divider)" }}>
        <div className="caption text-[10px] font-bold text-nx-text-muted mb-2">{tr("EINGABEN · EIGENFLOTTE (LKW)")}</div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 sm:grid-cols-3 xl:grid-cols-5">
          <In label={tr("Neupreis LKW")} value={t.priceCent} moneyCent w={110} unit="€" onCommit={(v) => setT("priceCent", v)} />
          <In label={tr("Nutzlast")} value={t.payloadT} unit="t" w={64} onCommit={(v) => setT("payloadT", v)} />
          <In label={tr("Distanz (einfach)")} value={t.distanceKm} unit="km" w={64} onCommit={(v) => setT("distanceKm", v)} />
          <In label={tr("Geschwindigkeit")} value={t.speedKmh} unit="km/h" w={64} onCommit={(v) => setT("speedKmh", v)} />
          <In label={tr("Lade/Entlade")} value={t.loadUnloadH} unit="h" w={64} onCommit={(v) => setT("loadUnloadH", v)} />
          <In label={tr("Betriebstage/J")} value={t.operatingDays} unit="d" w={64} onCommit={(v) => setT("operatingDays", v)} />
          <In label={tr("Stunden/Tag")} value={t.hoursPerDay} unit="h" w={64} onCommit={(v) => setT("hoursPerDay", v)} />
          <In label={tr("Diesel")} value={t.dieselLPerHour} unit="l/h" w={64} onCommit={(v) => setT("dieselLPerHour", v)} />
          <In label={tr("Fahrerlohn")} value={t.driverEurPerHourCent} moneyCent w={72} unit="€/h" onCommit={(v) => setT("driverEurPerHourCent", v)} />
          <In label={tr("Nutzungsdauer")} value={t.lifeYears} unit="J" w={56} onCommit={(v) => setT("lifeYears", v)} />
          <In label={tr("Restwert")} value={t.residualPct * 100} unit="%" w={56} onCommit={(v) => setT("residualPct", v / 100)} />
          <In label={tr("Reparatur/J")} value={t.repPctYear * 100} unit="%" w={56} onCommit={(v) => setT("repPctYear", v / 100)} />
          <In label={tr("Versicherung/J")} value={t.versPctYear * 100} unit="%" w={56} onCommit={(v) => setT("versPctYear", v / 100)} />
          <In label={tr("Kalk. Zins")} value={t.interestRate * 100} unit="%" w={56} onCommit={(v) => setT("interestRate", v / 100)} />
          <In label={tr("Dieselpreis (Modell)")} value={dieselL} unit="€/l" w={64} onCommit={(v) => patch((dm) => { const b = dm.assumptions["price.diesel_l"]; if (b) b.scenarioProfiles[dm.baseScenarioId] = { kind: "constant", value: Math.round(v * 100) }; })} />
        </div>
        <div className="caption text-[10px] font-bold text-nx-text-muted mt-3 mb-2">{tr("EINGABEN · SPEDITION")}</div>
        <In label={tr("Speditionsrate")} value={spedRate} unit="€/t" w={72} onCommit={setSped} />
      </div>

      <div className="grid grid-cols-1 gap-x-8 px-4 py-3 md:grid-cols-2">
        <div className="space-y-1 text-[12.5px]">
          <div className="caption text-[10.5px] font-bold text-nx-text-muted">{tr("Eigenflotte")} {chosen === "own" && tr("· aktiv")}</div>
          <div className="flex justify-between"><span className="text-nx-text-secondary">{tr("LKW nötig")}</span><span className="num">{fmtNumber(d.own.lkw, 0)}</span></div>
          <div className="flex justify-between"><span className="text-nx-text-secondary">CAPEX</span><span className="num">{fmtMoney(d.own.capexCent)} €</span></div>
          <div className="flex justify-between"><span className="text-nx-text-secondary">{tr("Gesamt/J")}</span><span className="num">{fmtMoney(d.own.totalCent)} €</span></div>
          <div className="flex justify-between font-semibold"><span>→ €/t</span><span className="num">{fmtNumber(d.own.perTCent / 100, 2)}</span></div>
        </div>
        <div className="space-y-1 text-[12.5px]">
          <div className="caption text-[10.5px] font-bold text-nx-text-muted">{tr("Spedition")} {chosen === "spedition" && tr("· aktiv")}</div>
          <div className="flex justify-between"><span className="text-nx-text-secondary">{tr("Rate")}</span><span className="num">{fmtNumber(d.spedition.perTCent / 100, 2)} €/t</span></div>
          <div className="flex justify-between"><span className="text-nx-text-secondary">{tr("Gesamt/J")}</span><span className="num">{fmtMoney(d.spedition.totalCent)} €</span></div>
          <div className="flex justify-between text-nx-text-muted"><span>{tr("Tonnage/J")}</span><span className="num">{fmtNumber(d.tonnage, 0)} t</span></div>
        </div>
      </div>
      <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
        {tr("Die gewählte Option speist")} <span className="num">opex.transport</span> {tr("(und bei Eigenflotte die LKW-CAPEX→AfA) live in die GuV. Rechnerisch günstiger:")} <b>{d.chosen === "own" ? tr("Eigenflotte") : tr("Spedition")}</b>.
      </div>
    </section>
  );
}

/* Selbstständige Investitions-/Betriebsszenario-Rechner (Make-or-Buy), 1:1 aus dem
 * Planungs-Excel. Reine Entscheidungswerkzeuge mit editierbaren Treibern (lokaler State). */

function Field({ label, value, onChange, unit }: { label: string; value: number; onChange: (n: number) => void; unit?: string }) {
  const [t, setT] = React.useState(String(value));
  React.useEffect(() => setT(String(value)), [value]);
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-[12px] text-nx-text-secondary">{label}</span>
      <span className="inline-flex items-center gap-1">
        <input className="num rounded-control border px-2 text-right text-[12.5px]"
          style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600, height: 32, width: 92 }}
          value={t} inputMode="decimal"
          onChange={(e) => setT(e.target.value)}
          onBlur={(e) => { const n = Number(e.target.value.replace(",", ".")); if (isFinite(n)) onChange(n); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        {unit && <span className="w-[26px] text-[10.5px] text-nx-text-muted">{unit}</span>}
      </span>
    </div>
  );
}

function Result({ rows, winner, diff }: { rows: [string, string, string][]; winner: string; diff: string }) {
  return (
    <div className="mt-2">
      <table className="w-full text-[12.5px]">
        <tbody>
          {rows.map(([l, a, b], i) => (
            <tr key={i} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
              <td className="py-1 text-nx-text-secondary">{l}</td>
              <td className="num py-1 text-right">{a}</td>
              <td className="num py-1 text-right">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 rounded-control px-3 py-2 text-[12.5px]" style={{ background: "var(--nx-success-bg, #E7F0E8)", color: "var(--nx-success)" }}>
        <span aria-hidden>✓</span><b>{tr("Wirtschaftlicher:")} {winner}</b><span className="text-nx-text-muted">{tr("· Differenz")} {diff}{tr("/Jahr")}</span>
      </div>
    </div>
  );
}

/** Vollkosten einer Maschinen-/Fahrzeug-Variante (AfA+Zins+Vers fix, Diesel+Rep var, Personal). */
function calcUnit(p: {
  work: number; window: number; hpd: number; ceff: number; price: number; life: number;
  residual: number; dieselLh: number; repPct: number; insPct: number; persPerUnit: number;
  wage: number; diesel: number; interest: number; perTonne?: boolean; payload?: number;
  loadMin?: number; unloadMin?: number; distance?: number; speed?: number;
}) {
  let hours: number, unitsNeeded: number, throughputBasis = 0;
  if (p.perTonne) {
    const cycleMin = 2 * p.distance! / p.speed! * 60 + p.loadMin! + p.unloadMin!;
    const tripsDay = (p.hpd * 60) / cycleMin;
    const tPerDayUnit = p.payload! * tripsDay;
    const neededTPerDay = p.work / p.window; // work = tonnage
    unitsNeeded = Math.ceil(neededTPerDay / tPerDayUnit);
    hours = p.window * p.hpd * unitsNeeded;
    throughputBasis = p.work;
  } else {
    hours = p.work / p.ceff; // work = ha
    const availPerUnit = p.window * p.hpd;
    unitsNeeded = Math.ceil(hours / availPerUnit);
    throughputBasis = p.work;
  }
  const capex = unitsNeeded * p.price;
  const afa = (p.price - p.price * p.residual) / p.life;
  const zins = (p.price + p.price * p.residual) / 2 * p.interest;
  const vers = p.price * p.insPct;
  const fix = unitsNeeded * (afa + zins + vers);
  const dieselCost = hours * p.dieselLh * p.diesel;
  const rep = unitsNeeded * p.price * p.repPct;
  const betrieb = dieselCost + rep;
  const personal = hours * p.persPerUnit * p.wage;
  const total = fix + betrieb + personal;
  const perUnit = total / throughputBasis;
  return { hours, unitsNeeded, capex, fix, betrieb, personal, total, perUnit };
}

function RoderCalc() {
  const [a, setA] = React.useState({ work: 667, window: 24, hpd: 16, ceff: 0.55, price: 240000, life: 10, residual: 0.20, dieselLh: 24, repPct: 0.08, insPct: 0.02, persPerUnit: 2, wage: 7, diesel: 1, interest: 0.04 });
  const [b, setB] = React.useState({ ...a, ceff: 0.85, price: 480000, residual: 0.25, dieselLh: 32, repPct: 0.09 });
  const ra = calcUnit(a), rb = calcUnit(b);
  const winner = ra.total <= rb.total ? tr("A · 2-reihig gezogen") : tr("B · 4-reihig Selbstfahrer");
  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h2 className="text-[14px] font-semibold">{tr("Kartoffelernte — Roder 2-reihig vs. 4-reihig")}</h2>
      </div>
      <div className="grid grid-cols-1 gap-x-8 px-4 py-3 md:grid-cols-2">
        <div><div className="caption py-1 text-[10.5px] font-bold text-nx-text-muted">{tr("A · 2-reihig gezogen")}</div>
          <Field label={tr("Fläche")} unit="ha" value={a.work} onChange={(v) => setA({ ...a, work: v })} />
          <Field label={tr("Flächenleistung")} unit="ha/h" value={a.ceff} onChange={(v) => setA({ ...a, ceff: v })} />
          <Field label={tr("Neupreis")} unit="€" value={a.price} onChange={(v) => setA({ ...a, price: v })} />
          <Field label={tr("Diesel")} unit="l/h" value={a.dieselLh} onChange={(v) => setA({ ...a, dieselLh: v })} />
        </div>
        <div><div className="caption py-1 text-[10.5px] font-bold text-nx-text-muted">{tr("B · 4-reihig Selbstfahrer")}</div>
          <Field label={tr("Fläche")} unit="ha" value={b.work} onChange={(v) => setB({ ...b, work: v })} />
          <Field label={tr("Flächenleistung")} unit="ha/h" value={b.ceff} onChange={(v) => setB({ ...b, ceff: v })} />
          <Field label={tr("Neupreis")} unit="€" value={b.price} onChange={(v) => setB({ ...b, price: v })} />
          <Field label={tr("Diesel")} unit="l/h" value={b.dieselLh} onChange={(v) => setB({ ...b, dieselLh: v })} />
        </div>
      </div>
      <div className="px-4 pb-4">
        <Result winner={winner}
          diff={fmtMoney(Math.abs(ra.total - rb.total) * 100) + " €"}
          rows={[
            [tr("Maschinen nötig"), fmtNumber(ra.unitsNeeded, 0), fmtNumber(rb.unitsNeeded, 0)],
            ["CAPEX €", fmtMoney(ra.capex * 100), fmtMoney(rb.capex * 100)],
            [tr("Fixkosten/J €"), fmtMoney(ra.fix * 100), fmtMoney(rb.fix * 100)],
            [tr("Betrieb/J €"), fmtMoney(ra.betrieb * 100), fmtMoney(rb.betrieb * 100)],
            [tr("Personal/J €"), fmtMoney(ra.personal * 100), fmtMoney(rb.personal * 100)],
            [tr("Gesamt/J €"), fmtMoney(ra.total * 100), fmtMoney(rb.total * 100)],
            ["→ €/ha", fmtMoney(ra.perUnit * 100), fmtMoney(rb.perUnit * 100)],
          ]} />
      </div>
    </section>
  );
}

function TransportCalc({ title, seedA, seedB, basis }: { title: string; seedA: any; seedB: any; basis: "ha" | "t" }) {
  const [a, setA] = React.useState(seedA);
  const [b, setB] = React.useState(seedB);
  const ra = calcUnit(a);
  // B is a rate-based option (Spedition) or second fleet
  const rb = b.rate !== undefined
    ? { total: b.rate * b.work, perUnit: b.rate, unitsNeeded: 0, capex: 0, fix: 0, betrieb: b.rate * b.work, personal: 0, hours: 0 }
    : calcUnit(b);
  const winner = ra.total <= rb.total ? "A" : "B";
  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}><h2 className="text-[14px] font-semibold">{title}</h2></div>
      <div className="grid grid-cols-1 gap-x-8 px-4 py-3 md:grid-cols-2">
        <div><div className="caption py-1 text-[10.5px] font-bold text-nx-text-muted">A · {seedA.name}</div>
          <Field label={basis === "t" ? tr("Jahresmenge") : tr("Fläche")} unit={basis} value={a.work} onChange={(v) => setA({ ...a, work: v })} />
          <Field label={tr("Nutzlast")} unit="t" value={a.payload ?? 0} onChange={(v) => setA({ ...a, payload: v })} />
          <Field label={tr("Distanz")} unit="km" value={a.distance ?? 0} onChange={(v) => setA({ ...a, distance: v })} />
          <Field label={tr("Neupreis")} unit="€" value={a.price} onChange={(v) => setA({ ...a, price: v })} />
        </div>
        <div><div className="caption py-1 text-[10.5px] font-bold text-nx-text-muted">B · {seedB.name}</div>
          {b.rate !== undefined
            ? <Field label={tr("Speditionsrate")} unit="€/t" value={b.rate} onChange={(v) => setB({ ...b, rate: v })} />
            : (<>
                <Field label={tr("Nutzlast")} unit="t" value={b.payload ?? 0} onChange={(v) => setB({ ...b, payload: v })} />
                <Field label={tr("Neupreis")} unit="€" value={b.price} onChange={(v) => setB({ ...b, price: v })} />
              </>)}
        </div>
      </div>
      <div className="px-4 pb-4">
        <Result winner={`${winner} · ${winner === "A" ? seedA.name : seedB.name}`}
          diff={fmtMoney(Math.abs(ra.total - rb.total) * 100) + " €"}
          rows={[
            [tr("Einheiten nötig"), fmtNumber(ra.unitsNeeded, 0), rb.unitsNeeded ? fmtNumber(rb.unitsNeeded, 0) : "–"],
            ["CAPEX €", fmtMoney(ra.capex * 100), rb.capex ? fmtMoney(rb.capex * 100) : "–"],
            [tr("Gesamt/J €"), fmtMoney(ra.total * 100), fmtMoney(rb.total * 100)],
            [`→ €/${basis}`, fmtMoney(ra.perUnit * 100), fmtMoney(rb.perUnit * 100)],
          ]} />
      </div>
    </section>
  );
}


/* CAPEX-Szenarien-Rechner — getabbte Entscheidungswerkzeuge (Make-or-Buy / Technik-Vergleiche).
 * Erweiterbar: weitere Szenarien/Rechner als zusätzliche Tabs. */
// Spritztechnik ist mit dem 36-vs-48-m-Vergleich zum Tab „Spritz-/Düngertechnik" zusammengeführt
//  (in CapexScenarienView) — daher hier NICHT mehr als eigenes Szenario.
export type ScenarioTab = "transport" | "roder" | "infield";
export const SCENARIO_TABS: { id: ScenarioTab; label: string }[] = [
  { id: "transport", label: "Transport zum Abnehmer" },
  { id: "roder", label: "Rodetechnik" },
  { id: "infield", label: "In-Field-Logistik" },
];

/** Rechner-Inhalt je Szenario — OHNE eigene Tab-Leiste (die Leiste liegt jetzt eine Ebene höher,
 *  in CapexScenarienView, damit alle Szenarien in EINER flachen Struktur stehen). */
export function ScenarioView({ tab }: { tab: ScenarioTab }) {
  return (
    <div className="space-y-4">
      {tab === "transport" && <TransportDecisionCard />}
      {tab === "roder" && <RoderCalc />}
      {tab === "infield" && (
        <TransportCalc title={tr("In-Field-Logistik — Traktor+Trailer vs. LKW 8×8 Container")} basis="t"
          seedA={{ name: "Traktor+Trailer", work: 56700, window: 90, hpd: 14, ceff: 1, price: 120000, life: 10, residual: 0.25, dieselLh: 13, repPct: 0.06, insPct: 0.03, persPerUnit: 1, wage: 7, diesel: 1, interest: 0.04, perTonne: true, payload: 16, loadMin: 20, unloadMin: 25, distance: 70, speed: 30 }}
          seedB={{ name: "LKW 8×8 Container", work: 56700, window: 90, hpd: 14, ceff: 1, price: 260000, life: 12, residual: 0.30, dieselLh: 26, repPct: 0.05, insPct: 0.04, persPerUnit: 1, wage: 7, diesel: 1, interest: 0.04, perTonne: true, payload: 32, loadMin: 15, unloadMin: 10, distance: 70, speed: 60 }} />
      )}
    </div>
  );
}
