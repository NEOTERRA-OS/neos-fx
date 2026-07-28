"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { buildModelState, type Domain } from "../../store/model";
import { computeModel } from "../../core/engine";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import { X } from "lucide-react";

/* ============================================================================
 * Faktor-Bibliothek — welche Treiber in die Sensitivität/Szenarien einfließen.
 *  Jeder Faktor lenkt eine oder mehrere Assumptions (×Faktor) nicht-destruktiv aus.
 * ========================================================================== */
type Factor = { id: string; name: string; group: string; keys: string[]; defDelta: number };
const VALUE = ["tomate", "kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre"];
const CEREAL = ["weizen", "gerste_zw", "winterraps", "soja_luzerne", "mais"];
const FACTOR_LIB: Factor[] = [
  // Erlös
  { id: "price_value", name: "Preis Wertkulturen (alle)", group: "Erlös", keys: VALUE.map((c) => `price.${c}`), defDelta: 0.15 },
  { id: "price_tomate", name: "Preis Tomate", group: "Erlös", keys: ["price.tomate"], defDelta: 0.15 },
  { id: "price_kartoffel", name: "Preis Kartoffel (P+C)", group: "Erlös", keys: ["price.kartoffel_pommes", "price.kartoffel_chips"], defDelta: 0.15 },
  { id: "price_zwiebel", name: "Preis Zwiebel/Möhre", group: "Erlös", keys: ["price.zwiebel_moehre"], defDelta: 0.15 },
  { id: "price_cereal", name: "Preis Getreide/Ölsaat (alle)", group: "Erlös", keys: CEREAL.map((c) => `price.${c}`), defDelta: 0.15 },
  { id: "yield_value", name: "Ertrag Wertkulturen (alle)", group: "Erlös", keys: VALUE.map((c) => `yield.${c}`), defDelta: 0.10 },
  { id: "yield_all", name: "Ertrag alle Kulturen", group: "Erlös", keys: [...VALUE, ...CEREAL].map((c) => `yield.${c}`), defDelta: 0.10 },
  { id: "qual_value", name: "Kontrakt-Qualität Wertkulturen", group: "Erlös", keys: VALUE.map((c) => `qual.${c}`), defDelta: 0.08 },
  { id: "qual_kartoffel", name: "Qualität Kartoffel (Stärke/Zucker)", group: "Erlös", keys: ["qual.kartoffel_pommes", "qual.kartoffel_chips"], defDelta: 0.10 },
  { id: "qual_tomate", name: "Qualität Tomate (Brix)", group: "Erlös", keys: ["qual.tomate"], defDelta: 0.10 },
  { id: "loss_all", name: "Verlust/Schwund (alle)", group: "Erlös", keys: [...VALUE, ...CEREAL].map((c) => `loss.${c}`), defDelta: 0.25 },
  // Kosten
  { id: "diesel", name: "Dieselpreis", group: "Kosten", keys: ["price.diesel_l"], defDelta: 0.20 },
  { id: "fert", name: "Düngerpreise (N/P/K)", group: "Kosten", keys: ["fert.n", "fert.p", "fert.k", "fert.n_fert", "fert.p_fert", "fert.k_fert"], defDelta: 0.20 },
  { id: "seed", name: "Saatgut/Pflanzgut", group: "Kosten", keys: [...VALUE, ...CEREAL].map((c) => `seed.${c}`), defDelta: 0.15 },
  { id: "water", name: "Bewässerung €/mm", group: "Kosten", keys: ["irrig.eur_mm"], defDelta: 0.20 },
  { id: "labor", name: "Lohn (Saison/Stamm)", group: "Kosten", keys: ["rate.labor_h", "pers.stamm.gross", "pers.saison.gross"], defDelta: 0.15 },
  { id: "tco", name: "Maschinen-Einkaufsrabatt (TCO)", group: "Kosten", keys: ["tco.discount"], defDelta: 0.25 },
  // Makro & Finanzierung
  { id: "euribor", name: "Zins / Euribor", group: "Makro & Finanz", keys: ["macro.euribor"], defDelta: 0.30 },
  { id: "tax", name: "Körperschaftsteuer", group: "Makro & Finanz", keys: ["tax.rate"], defDelta: 0.20 },
  { id: "subs_base", name: "Basisprämie (GAP)", group: "Makro & Finanz", keys: ["subsidy.per_ha"], defDelta: 0.20 },
  { id: "subs_coupled", name: "Gekoppelte Stützung", group: "Makro & Finanz", keys: ["subsidy.coupled_freilandgemuese"], defDelta: 0.20 },
  { id: "infl_out", name: "Output-Inflation", group: "Makro & Finanz", keys: ["infl.output"], defDelta: 0.50 },
  { id: "infl_in", name: "Input-Inflation", group: "Makro & Finanz", keys: ["infl.input"], defDelta: 0.50 },
];
const FBY = new Map(FACTOR_LIB.map((f) => [f.id, f]));

/* ---- Kern-Rechnung: KPIs für eine (ausgelenkte) Domäne --------------------- */
type Kpis = { ebitda: number; umsatz: number; minCash: number; dscrMin: number; levMax: number };
function kpisOf(domain: Domain, sc: string): Kpis {
  const ms = buildModelState(domain, sc);
  const cm: any = computeModel(ms, sc, { outputGranularity: "month" });
  const g = (o: any, k: string) => (o?.[k]?.values) ?? [];
  const pnl = cm.incomeStatement ?? cm.pnl, bs = cm.balanceSheet, cf = cm.cashFlow;
  const ebitda = g(pnl, "ebitda"), rev = g(pnl, "revenue"), cfo = g(cf, "cfo");
  const rep = g(cf, "debtRepayments"), intp = g(cf, "interestPaid");
  const debt = g(bs, "debt"), revol = g(bs, "revolver"), cash = g(bs, "cash");
  const n = ebitda.length, sw = (a: number[], ye: number, w: number) => { let s = 0; for (let k = 0; k < w; k++) s += a[ye - k] || 0; return s; };
  let minCash = Infinity, dscrMin = Infinity, levMax = 0;
  for (let p = 0; p < n; p++) minCash = Math.min(minCash, cash[p] ?? 0);
  for (let y = 0; y * 12 < n; y++) {
    const ye = Math.min(n - 1, y * 12 + 11), w = Math.min(12, ye + 1);
    const yE = sw(ebitda, ye, w), yCfo = sw(cfo, ye, w), yDs = Math.abs(sw(rep, ye, w)) + Math.abs(sw(intp, ye, w));
    const yND = (debt[ye] || 0) + (revol[ye] || 0) - (cash[ye] || 0);
    if (yDs > 0) dscrMin = Math.min(dscrMin, yCfo / yDs);
    if (yE > 0) levMax = Math.max(levMax, yND / yE);
  }
  // Basis = HEADLINE-JAHR (letzte 12 Monate), NICHT kumuliert über den Horizont — konsistent zum Kennzahlen-Band.
  const yw = Math.min(12, n);
  return { ebitda: sw(ebitda, n - 1, yw), umsatz: sw(rev, n - 1, yw), minCash, dscrMin: isFinite(dscrMin) ? dscrMin : 0, levMax };
}
/** Domäne kopieren und je (keys, faktor) auslenken. shifts: factorId → prozentuale Änderung. */
function perturb(domain: Domain, shifts: Record<string, number>, sc: string): Domain {
  const d: Domain = structuredClone(domain);
  for (const [fid, pct] of Object.entries(shifts)) {
    const f = FBY.get(fid); if (!f || !pct) continue;
    for (const k of f.keys) {
      const a = d.assumptions[k]; if (!a) continue;
      const prof = a.scenarioProfiles[sc] ?? a.scenarioProfiles[d.baseScenarioId];
      if (prof && prof.kind === "constant") a.scenarioProfiles[sc] = { kind: "constant", value: (prof as any).value * (1 + pct) };
    }
  }
  return d;
}

type Scenario = { id: string; name: string; shifts: Record<string, number> };
const DEFAULT_TORNADO = ["price_value", "yield_value", "qual_value", "price_cereal", "diesel", "fert", "labor", "euribor", "subs_coupled"];
const DEFAULT_SCEN: Scenario[] = [
  { id: "s1", name: "Trockenjahr", shifts: { yield_all: -0.15, qual_value: -0.06, water: 0.15 } },
  { id: "s2", name: "Preisverfall Kartoffel", shifts: { price_kartoffel: -0.25, qual_kartoffel: -0.05 } },
  { id: "s3", name: "Zins- & Kostenschock", shifts: { euribor: 0.5, diesel: 0.3, fert: 0.25 } },
];

const ensureSens = (d: Domain): { tornado: { id: string; delta: number }[]; scenarios: Scenario[] } => {
  if (!d.sensitivity) d.sensitivity = { tornado: DEFAULT_TORNADO.map((id) => ({ id, delta: FBY.get(id)!.defDelta })), scenarios: DEFAULT_SCEN.map((s) => ({ ...s, shifts: { ...s.shifts } })) };
  return d.sensitivity as any;
};

export function SensitivitaetView() {
  const domain = useModelStore((s) => s.domain);
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);
  const patch = useModelStore((s) => s.patch);

  // Persistiert im Modell (domain.sensitivity) → bleibt beim Speichern/Laden erhalten.
  const rows = domain.sensitivity?.tornado ?? DEFAULT_TORNADO.map((id) => ({ id, delta: FBY.get(id)!.defDelta }));
  const scen: Scenario[] = domain.sensitivity?.scenarios ?? DEFAULT_SCEN;
  const setRows = (fn: (r: { id: string; delta: number }[]) => { id: string; delta: number }[]) => patch((d) => { const s = ensureSens(d); s.tornado = fn(s.tornado); });
  const setScen = (fn: (s: Scenario[]) => Scenario[]) => patch((d) => { const s = ensureSens(d); s.scenarios = fn(s.scenarios); });
  const [addSel, setAddSel] = React.useState("");

  const base = React.useMemo(() => kpisOf(domain, sc), [domain, sc, tick]);

  // Tornado
  const bars = React.useMemo(() => {
    const out = rows.map(({ id, delta }) => {
      const f = FBY.get(id); if (!f) return null;
      const keys = f.keys.filter((k) => domain.assumptions[k]); if (!keys.length) return null;
      const low = kpisOf(perturb(domain, { [id]: -delta }, sc), sc).ebitda;
      const high = kpisOf(perturb(domain, { [id]: delta }, sc), sc).ebitda;
      return { id, name: f.name, delta, low, high, swingLow: low - base.ebitda, swingHigh: high - base.ebitda, total: Math.abs(low - base.ebitda) + Math.abs(high - base.ebitda) };
    }).filter(Boolean) as any[];
    out.sort((a, b) => b.total - a.total);
    return out;
  }, [rows, domain, sc, tick, base.ebitda]);
  const maxSwing = Math.max(1, ...bars.map((b) => Math.max(Math.abs(b.swingLow), Math.abs(b.swingHigh))));

  // Szenarien
  const scenKpis = React.useMemo(() => scen.map((s) => ({ ...s, k: kpisOf(perturb(domain, s.shifts, sc), sc) })), [scen, domain, sc, tick]);

  const addFactor = () => { if (addSel && !rows.some((r) => r.id === addSel)) { setRows((r) => [...r, { id: addSel, delta: FBY.get(addSel)!.defDelta }]); setAddSel(""); } };
  const available = FACTOR_LIB.filter((f) => !rows.some((r) => r.id === f.id));

  const dscrCol = (v: number) => v >= 1.10 ? "var(--nx-success)" : v >= 1.0 ? "var(--nx-warning)" : "var(--nx-error)";
  const levCol = (v: number) => v <= 3.5 ? "var(--nx-success)" : v <= 4.0 ? "var(--nx-warning)" : "var(--nx-error)";

  return (
    <div className="space-y-4">
      {/* Dynamischer Tornado */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Sensitivität — Δ Jahres-EBITDA je Treiber (dynamisch)")}</h2>
          <span className="num text-[12px] text-nx-text-secondary">{t("Basis-EBITDA")} <b>{fmtMoney(base.ebitda)} €</b></span>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b" style={{ borderColor: "var(--nx-border-divider)" }}>
          <select value={addSel} onChange={(e) => setAddSel(e.target.value)} className="rounded-control border px-2 text-[12px]" style={{ height: 32, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }}>
            <option value="">{t("+ Treiber hinzufügen…")}</option>
            {["Erlös", "Kosten", "Makro & Finanz"].map((grp) => (
              <optgroup key={grp} label={t(grp)}>
                {available.filter((f) => f.group === grp).map((f) => <option key={f.id} value={f.id}>{t(f.name)}</option>)}
              </optgroup>
            ))}
          </select>
          <button className="rounded-control border px-3 text-[12px] font-semibold" style={{ height: 32, borderColor: "var(--nx-brand-lift)", color: "var(--nx-brand-lift)", background: "var(--nx-surface)" }} onClick={addFactor}>{t("Hinzufügen")}</button>
          <span className="text-[11px] text-nx-text-muted">{t("± je Treiber editierbar; Tornado rechnet live neu.")}</span>
        </div>
        <div className="px-4 py-3">
          {bars.map((b) => {
            const wLow = (Math.abs(b.swingLow) / maxSwing) * 50, wHigh = (Math.abs(b.swingHigh) / maxSwing) * 50;
            return (
              <div key={b.id} className="flex items-center gap-2 py-1 text-[12px]">
                <div className="w-[200px] shrink-0 text-nx-text-secondary truncate" title={t(b.name)}>{t(b.name)}</div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] text-nx-text-muted">±</span>
                  <input type="number" value={Math.round(b.delta * 100)} onChange={(e) => { const v = Math.max(0, Number(e.target.value)) / 100; setRows((r) => r.map((x) => x.id === b.id ? { ...x, delta: v } : x)); }}
                    className="num rounded-control border px-1 text-right text-[11px]" style={{ width: 46, height: 26, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />
                  <span className="text-[10px] text-nx-text-muted">%</span>
                </div>
                <div className="relative flex h-5 flex-1 items-center">
                  <div className="absolute left-1/2 top-0 h-full" style={{ width: 1, background: "var(--nx-border)" }} />
                  <div className="absolute" style={{ right: "50%", width: `${wLow}%`, height: 14, background: "#C0392B", borderRadius: 2, opacity: 0.85 }} title={`− : ${fmtMoney(b.low)} €`} />
                  <div className="absolute" style={{ left: "50%", width: `${wHigh}%`, height: 14, background: "var(--nx-success)", borderRadius: 2, opacity: 0.9 }} title={`+ : ${fmtMoney(b.high)} €`} />
                </div>
                <div className="num w-[135px] shrink-0 text-right text-nx-text-muted">{fmtMoney(b.low)} … {fmtMoney(b.high)}</div>
                <button className="shrink-0 text-[12px] text-nx-error px-1" title={t("Entfernen")} onClick={() => setRows((r) => r.filter((x) => x.id !== b.id))}><X size={13} strokeWidth={2.5} aria-hidden /></button>
              </div>
            );
          })}
          {!bars.length && <div className="py-4 text-center text-[12px] text-nx-text-muted">{t("Treiber oben hinzufügen.")}</div>}
        </div>
      </section>

      {/* Szenario-Editor */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Szenario-Editor — kombinierte Treiber → KPI-Wirkung")}</h2>
          <button className="rounded-control border px-3 text-[12px] font-semibold" style={{ height: 32, borderColor: "var(--nx-brand-lift)", color: "var(--nx-brand-lift)", background: "var(--nx-surface)" }}
            onClick={() => setScen((s) => [...s, { id: "s" + (s.length + 1) + "-" + s.reduce((a, x) => a + x.name.length, 0), name: "Neues Szenario", shifts: {} }])}>{t("+ Szenario")}</button>
        </div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead><tr className="caption text-[10px] text-nx-text-muted">
              <th className="px-2 py-1.5 text-left">{t("Szenario")}</th>
              <th className="px-2 py-1.5 text-right">{t("EBITDA/J.")}</th><th className="px-2 py-1.5 text-right">{t("Δ vs. Basis")}</th>
              <th className="px-2 py-1.5 text-right">{t("Umsatz/J.")}</th><th className="px-2 py-1.5 text-right">{t("min. Liquidität")}</th>
              <th className="px-2 py-1.5 text-right">{t("DSCR")}</th><th className="px-2 py-1.5 text-right">{t("Net Debt/EBITDA")}</th><th /></tr></thead>
            <tbody>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Basis")}</td>
                <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(base.ebitda)}</td>
                <td className="num px-2 py-1.5 text-right text-nx-text-muted">–</td>
                <td className="num px-2 py-1.5 text-right">{fmtMoney(base.umsatz)}</td>
                <td className="num px-2 py-1.5 text-right">{fmtMoney(base.minCash)}</td>
                <td className="num px-2 py-1.5 text-right" style={{ color: dscrCol(base.dscrMin) }}>{fmtNumber(base.dscrMin, 2)}</td>
                <td className="num px-2 py-1.5 text-right" style={{ color: levCol(base.levMax) }}>{fmtNumber(base.levMax, 2)}</td><td />
              </tr>
              {scenKpis.map((s) => {
                const dE = s.k.ebitda - base.ebitda;
                return (
                  <tr key={s.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                    <td className="px-2 py-1.5">
                      <input value={s.name} onChange={(e) => setScen((arr) => arr.map((x) => x.id === s.id ? { ...x, name: e.target.value } : x))}
                        className="rounded-control border px-2 text-[12px]" style={{ height: 28, width: 150, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />
                    </td>
                    <td className="num px-2 py-1.5 text-right">{fmtMoney(s.k.ebitda)}</td>
                    <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: dE < 0 ? "var(--nx-error)" : "var(--nx-success)" }}>{dE < 0 ? "(" + fmtMoney(-dE) + ")" : "+" + fmtMoney(dE)}</td>
                    <td className="num px-2 py-1.5 text-right">{fmtMoney(s.k.umsatz)}</td>
                    <td className="num px-2 py-1.5 text-right" style={{ color: s.k.minCash < 0 ? "var(--nx-error)" : "var(--nx-text)" }}>{fmtMoney(s.k.minCash)}</td>
                    <td className="num px-2 py-1.5 text-right" style={{ color: dscrCol(s.k.dscrMin) }}>{fmtNumber(s.k.dscrMin, 2)}</td>
                    <td className="num px-2 py-1.5 text-right" style={{ color: levCol(s.k.levMax) }}>{fmtNumber(s.k.levMax, 2)}</td>
                    <td className="px-2 py-1.5 text-right"><button className="text-[12px] text-nx-error" onClick={() => setScen((arr) => arr.filter((x) => x.id !== s.id))}><X size={13} strokeWidth={2.5} aria-hidden /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Shift-Editor je Szenario */}
        <div className="space-y-3 border-t px-4 py-3" style={{ borderColor: "var(--nx-border)" }}>
          {scen.map((s) => (
            <div key={s.id} className="rounded-tile border px-3 py-2" style={{ borderColor: "var(--nx-border-divider)" }}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] font-semibold">{t(s.name)}</span>
                <ShiftAdder onAdd={(fid) => setScen((arr) => arr.map((x) => x.id === s.id ? { ...x, shifts: { ...x.shifts, [fid]: x.shifts[fid] ?? -0.1 } } : x))} existing={Object.keys(s.shifts)} />
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(s.shifts).map(([fid, pct]) => (
                  <div key={fid} className="inline-flex items-center gap-1.5 rounded-pill border px-2 py-1" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface-sunken)" }}>
                    <span className="text-[11px]">{t(FBY.get(fid)?.name ?? fid)}</span>
                    <input type="number" value={Math.round(pct * 100)} onChange={(e) => { const v = Number(e.target.value) / 100; setScen((arr) => arr.map((x) => x.id === s.id ? { ...x, shifts: { ...x.shifts, [fid]: v } } : x)); }}
                      className="num rounded-control border px-1 text-right text-[11px]" style={{ width: 48, height: 24, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />
                    <span className="text-[10px] text-nx-text-muted">%</span>
                    <button className="text-[11px] text-nx-error" onClick={() => setScen((arr) => arr.map((x) => { if (x.id !== s.id) return x; const sh = { ...x.shifts }; delete sh[fid]; return { ...x, shifts: sh }; }))}><X size={12} strokeWidth={2.5} aria-hidden /></button>
                  </div>
                ))}
                {!Object.keys(s.shifts).length && <span className="text-[11px] text-nx-text-muted">{t("Noch keine Treiber — rechts hinzufügen.")}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Jedes Szenario kombiniert beliebige Treiber (%-Auslenkung) und rechnet das Modell nicht-destruktiv neu — EBITDA, Umsatz, min. Liquidität, DSCR und Net Debt/EBITDA live gegen die Basis. Grün/Gelb/Rot = Covenant-Ampel.")}
        </div>
      </section>
    </div>
  );
}

function ShiftAdder({ onAdd, existing }: { onAdd: (fid: string) => void; existing: string[] }) {
  const [sel, setSel] = React.useState("");
  const avail = FACTOR_LIB.filter((f) => !existing.includes(f.id));
  return (
    <div className="flex items-center gap-1">
      <select value={sel} onChange={(e) => setSel(e.target.value)} className="rounded-control border px-2 text-[11px]" style={{ height: 28, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }}>
        <option value="">{t("+ Treiber…")}</option>
        {["Erlös", "Kosten", "Makro & Finanz"].map((grp) => (
          <optgroup key={grp} label={t(grp)}>{avail.filter((f) => f.group === grp).map((f) => <option key={f.id} value={f.id}>{t(f.name)}</option>)}</optgroup>
        ))}
      </select>
      <button className="rounded-control border px-2 text-[11px]" style={{ height: 28, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }} onClick={() => { if (sel) { onAdd(sel); setSel(""); } }}>+</button>
    </div>
  );
}
