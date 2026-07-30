"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import {
  buildModelState, deriveRevenueSplitMY, VALUE_CROP_IDS, BREAK_CROP_IDS,
  type Domain, type SensScenario,
} from "../../store/model";
import { computeModel } from "../../core/engine";
import { aggregateComputed } from "../../core/aggregate";
import { fmtMoney, fmtNumber, fmtPct } from "../../design/format";
import { Segmented } from "../primitives/Segmented";
import { StatusPill } from "../primitives/StatusPill";
import { t, getLang } from "../../lib/i18n";
import { ChevronDown, ChevronRight, RotateCcw, Download, Droplets, TrendingUp, Factory, Save, Trash2, Plus, X, Tornado, GitCompare, SlidersHorizontal } from "lucide-react";

/* ============================================================================
 * SZENARIO-STUDIO — interaktive Simulation auf DEM Modell (nicht daneben).
 *  Jeder Regler lenkt eine oder mehrere Assumptions nicht-destruktiv aus
 *  (structuredClone → Composer → Engine), d. h. ALLE Modell-Abhängigkeiten
 *  greifen automatisch: Input-Inflation, Working Capital, Revolver-Zirkel,
 *  Zins/Steuer, AfA, Covenants. Es gibt keinen zweiten Rechenweg.
 * ========================================================================== */

const ROT_CROPS = BREAK_CROP_IDS;
const VAL_CROPS = VALUE_CROP_IDS;

type DrvMode = "abs" | "mult" | "toggle";
type Drv = {
  id: string; label: string; group: string; keys: string[]; mode: DrvMode;
  unit?: string; money?: boolean; pct?: boolean;
  min?: number; max?: number; step?: number; dec?: number;
  lo?: number; hi?: number;      // Bereichsfaktoren auf den Basiswert (wenn min/max fehlen)
  hint?: string;
};

const G_YLD = "Ertrag (Agronomie)";
const G_PRC = "Preis, Kontrakt & Qualität";
const G_SUB = "Subventionen (GAP/PNS)";
const G_RISK = "Klima- & Infrastrukturrisiko";
const G_OPX = "Input-Preise (OPEX)";
const G_LOG = "Logistik & Verarbeitung";
const G_FIN = "Makro, Steuer & Working Capital";
const GROUPS = [G_YLD, G_PRC, G_SUB, G_RISK, G_OPX, G_LOG, G_FIN];

const DRIVERS: Drv[] = [
  /* -- Ertrag ------------------------------------------------------------- */
  { id: "yield.tomate", label: "Ertrag Industrietomate", group: G_YLD, keys: ["yield.tomate"], mode: "abs", unit: "t/ha", min: 55, max: 115, step: 1, dec: 0, hint: "Basisbereich Kontrakt 75–90 t/ha" },
  { id: "yield.kartoffel_pommes", label: "Ertrag Kartoffel (Pommes/Markies)", group: G_YLD, keys: ["yield.kartoffel_pommes"], mode: "abs", unit: "t/ha", min: 25, max: 70, step: 1, dec: 0, hint: "Basisbereich 45–50 t/ha" },
  { id: "yield.kartoffel_chips", label: "Ertrag Kartoffel (Chips)", group: G_YLD, keys: ["yield.kartoffel_chips"], mode: "abs", unit: "t/ha", min: 25, max: 70, step: 1, dec: 0 },
  { id: "yield.zwiebel_moehre", label: "Ertrag Zwiebel/Möhre", group: G_YLD, keys: ["yield.zwiebel_moehre"], mode: "abs", unit: "t/ha", lo: 0.55, hi: 1.45, step: 1, dec: 0 },
  { id: "yieldRot", label: "Ertrag Rotations-/Break Crops (alle)", group: G_YLD, keys: ROT_CROPS.map((c) => `yield.${c}`), mode: "mult", unit: "×", min: 0.55, max: 1.45, step: 0.01, dec: 2, hint: "Getreide, Raps, Soja, Mais, Trockenanbau" },
  { id: "lossAll", label: "Verlust / Schwund (alle Kulturen)", group: G_YLD, keys: [...VAL_CROPS, ...ROT_CROPS].map((c) => `loss.${c}`), mode: "mult", unit: "×", min: 0, max: 3, step: 0.05, dec: 2 },

  /* -- Preis / Kontrakt / Qualität ---------------------------------------- */
  { id: "market.contract_share", label: "Kontraktanteil Wertkulturen", group: G_PRC, keys: ["market.contract_share"], mode: "abs", pct: true, unit: "%", min: 0, max: 100, step: 5, dec: 0, hint: "Rest wird zum Spotpreis vermarktet" },
  { id: "market.spot_delta", label: "Spotpreis-Delta", group: G_PRC, keys: ["market.spot_delta"], mode: "abs", pct: true, unit: "%", min: -45, max: 45, step: 1, dec: 0, hint: "wirkt voll auf Break Crops, anteilig (1 − Kontraktanteil) auf Wertkulturen" },
  { id: "market.brix_premium", label: "Brix-Prämie / -Abzug Tomate", group: G_PRC, keys: ["market.brix_premium"], mode: "abs", pct: true, unit: "%", min: -25, max: 30, step: 1, dec: 0, hint: "Qualitätsstaffel des Verarbeiters (°Brix)" },
  { id: "market.potato_grade", label: "Sortier-/Qualitätsprämie Kartoffel", group: G_PRC, keys: ["market.potato_grade"], mode: "abs", pct: true, unit: "%", min: -25, max: 30, step: 1, dec: 0, hint: "Stärke, Untergrößen, Zuckergehalt (Chips)" },
  { id: "price.tomate", label: "Kontraktpreis Industrietomate", group: G_PRC, keys: ["price.tomate"], mode: "abs", money: true, unit: "€/t", lo: 0.6, hi: 1.5, step: 1, dec: 0 },
  { id: "priceKart", label: "Kontraktpreis Kartoffel (P + C)", group: G_PRC, keys: ["price.kartoffel_pommes", "price.kartoffel_chips"], mode: "mult", unit: "×", min: 0.55, max: 1.5, step: 0.01, dec: 2 },
  { id: "priceRot", label: "Preis Rotations-/Break Crops (alle)", group: G_PRC, keys: ROT_CROPS.map((c) => `price.${c}`), mode: "mult", unit: "×", min: 0.55, max: 1.5, step: 0.01, dec: 2 },

  /* -- Subventionen -------------------------------------------------------- */
  { id: "subsidy.per_ha", label: "GAP-Basisprämie", group: G_SUB, keys: ["subsidy.per_ha"], mode: "abs", money: true, unit: "€/ha", min: 0, max: 600, step: 5, dec: 0 },
  { id: "subsidy.coupled_freilandgemuese", label: "Gekoppelte Stützung Freilandgemüse (PNS)", group: G_SUB, keys: ["subsidy.coupled_freilandgemuese"], mode: "abs", money: true, unit: "€/ha", min: 0, max: 2600, step: 25, dec: 0, hint: "Tomate + Zwiebel/Möhre, bewässert" },

  /* -- Klima & Infrastruktur ---------------------------------------------- */
  { id: "risk.irrig_outage_d", label: "Beregnungsausfall in der Hitzespitze", group: G_RISK, keys: ["risk.irrig_outage_d"], mode: "abs", unit: "d", min: 0, max: 21, step: 1, dec: 0, hint: "ANIF-Zentralnetz: Pumpen-/Netzausfall in Juli/August" },
  { id: "farm.intake_direct", label: "Direktentnahme Donau aktiv", group: G_RISK, keys: ["farm.intake_direct"], mode: "toggle", hint: "eigene Entnahme + Pumpstation als Redundanz zum ANIF-Netz" },
  { id: "risk.intake_mitigation", label: "Redundanz-Wirkung der Direktentnahme", group: G_RISK, keys: ["risk.intake_mitigation"], mode: "abs", pct: true, unit: "%", min: 0, max: 100, step: 5, dec: 0 },
  { id: "risk.yield_per_outage_d", label: "Ertragsverlust je Ausfalltag (Wertkultur)", group: G_RISK, keys: ["risk.yield_per_outage_d"], mode: "abs", pct: true, unit: "%/d", min: 0, max: 8, step: 0.1, dec: 1 },
  { id: "risk.outage_break_share", label: "Ausfall-Wirkung auf Break Crops", group: G_RISK, keys: ["risk.outage_break_share"], mode: "abs", pct: true, unit: "%", min: 0, max: 100, step: 5, dec: 0 },
  { id: "irrig.norm_scale", label: "Wassernorm (Skalierung der Plan-mm)", group: G_RISK, keys: ["irrig.norm_scale"], mode: "abs", unit: "×", min: 0.6, max: 1.6, step: 0.01, dec: 2, hint: "Trockenjahr = höhere Norm → mehr m³/ha und Energie" },
  { id: "irrig.eur_mm", label: "Bewässerung Energie + Wasser", group: G_RISK, keys: ["irrig.eur_mm"], mode: "abs", money: true, unit: "€/mm·ha", min: 0.4, max: 5, step: 0.05, dec: 2 },

  /* -- OPEX-Inputs --------------------------------------------------------- */
  { id: "fertAll", label: "Düngerpreise N / P / K / S", group: G_OPX, keys: ["fert.n", "fert.p", "fert.k", "fert.s", "fert.n_fert", "fert.p_fert", "fert.k_fert"], mode: "mult", unit: "×", min: 0.5, max: 2.2, step: 0.01, dec: 2 },
  { id: "seedAll", label: "Saat-/Pflanzgut (inkl. Jungpflanzen)", group: G_OPX, keys: [...VAL_CROPS, ...ROT_CROPS].map((c) => `seed.${c}`), mode: "mult", unit: "×", min: 0.5, max: 2.2, step: 0.01, dec: 2 },
  { id: "psmAll", label: "Pflanzenschutz (Mittelkosten)", group: G_OPX, keys: ["psm.per_euro"], mode: "mult", unit: "×", min: 0.5, max: 2.2, step: 0.01, dec: 2, hint: "eigener Stücksatz — unabhängig von Material/Handarbeit" },
  { id: "price.diesel_l", label: "Dieselpreis", group: G_OPX, keys: ["price.diesel_l"], mode: "abs", money: true, unit: "€/l", min: 0.4, max: 3, step: 0.02, dec: 2 },
  { id: "rate.labor_h", label: "Lohnsatz (Saison)", group: G_OPX, keys: ["rate.labor_h"], mode: "abs", money: true, unit: "€/h", lo: 0.5, hi: 2.2, step: 0.1, dec: 2 },
  { id: "matAll", label: "Material / Handarbeit (Stücksatz)", group: G_OPX, keys: ["price.per_euro"], mode: "mult", unit: "×", min: 0.5, max: 2.2, step: 0.01, dec: 2 },

  /* -- Logistik & Verarbeitung -------------------------------------------- */
  { id: "transport.distance_km", label: "Entfernung zum Abnehmer", group: G_LOG, keys: ["transport.distance_km"], mode: "abs", unit: "km", min: 10, max: 400, step: 5, dec: 0, hint: "lokale Verarbeitung ↓ vs. Dritt-Abnehmer ↑ — skaliert den €/t-Satz linear" },
  { id: "transport.spedition_rate", label: "Speditionssatz (Referenz-Entfernung)", group: G_LOG, keys: ["transport.spedition_rate"], mode: "abs", money: true, unit: "€/t", min: 1, max: 40, step: 0.5, dec: 2 },
  { id: "market.tomate_cap_t", label: "Werkskapazität Tomate", group: G_LOG, keys: ["market.tomate_cap_t"], mode: "abs", unit: "t", min: 0, max: 400000, step: 10000, dec: 0 },
  { id: "opex.transport", label: "Transport-Fixkosten p.a.", group: G_LOG, keys: ["opex.transport"], mode: "mult", unit: "×", min: 0, max: 2.5, step: 0.05, dec: 2 },

  /* -- Makro / Steuer / Working Capital ------------------------------------ */
  { id: "macro.rate_shock", label: "Zinsschock auf EURIBOR (additiv)", group: G_FIN, keys: ["macro.rate_shock"], mode: "abs", pct: true, unit: "%", min: -1, max: 6, step: 0.25, dec: 2, hint: "0,25 = +25 bp · 2,00 = +200 bp" },
  { id: "macro.euribor", label: "EURIBOR 3M (Basis)", group: G_FIN, keys: ["macro.euribor"], mode: "abs", pct: true, unit: "%", min: 0, max: 8, step: 0.1, dec: 2 },
  { id: "tax.rate", label: "Körperschaftsteuer (RO)", group: G_FIN, keys: ["tax.rate"], mode: "abs", pct: true, unit: "%", min: 0, max: 35, step: 1, dec: 0 },
  { id: "infl.input", label: "Input-Inflation p.a.", group: G_FIN, keys: ["infl.input"], mode: "abs", pct: true, unit: "%", min: -2, max: 15, step: 0.25, dec: 2 },
  { id: "infl.output", label: "Output-Inflation p.a.", group: G_FIN, keys: ["infl.output"], mode: "abs", pct: true, unit: "%", min: -2, max: 15, step: 0.25, dec: 2 },
  { id: "wc.dso", label: "Zahlungsziel Forderungen (DSO)", hint: "einheitlich für den gesamten Umsatz — Base 14 d ist das Verhandlungsziel", group: G_FIN, keys: ["wc.dso"], mode: "abs", unit: "d", min: 0, max: 180, step: 1, dec: 0 },
  { id: "wc.dpo", label: "DPO — Verbindlichkeitstage", group: G_FIN, keys: ["wc.dpo"], mode: "abs", unit: "d", min: 0, max: 180, step: 5, dec: 0 },
  { id: "wc.inv", label: "Lagertage Fertigerzeugnisse", hint: "ohne Wirkung, solange der Umsatz im Erntemonat gebucht wird — die wachsende Kultur steckt im Feldbestand", group: G_FIN, keys: ["wc.inv"], mode: "abs", unit: "d", min: 0, max: 270, step: 5, dec: 0 },

  /* -- aus der früheren Sensitivitäts-Faktorbibliothek übernommen ---------- */
  { id: "yieldValue", label: "Ertrag Wertkulturen (alle)", group: G_YLD, keys: VAL_CROPS.map((c) => `yield.${c}`), mode: "mult", unit: "×", min: 0.55, max: 1.45, step: 0.01, dec: 2, hint: "Sammeltreiber über alle Wertkulturen" },
  { id: "yieldAll", label: "Ertrag alle Kulturen", group: G_YLD, keys: [...VAL_CROPS, ...ROT_CROPS].map((c) => `yield.${c}`), mode: "mult", unit: "×", min: 0.55, max: 1.45, step: 0.01, dec: 2, hint: "Trockenjahr-Sammeltreiber" },
  { id: "priceValue", label: "Preis Wertkulturen (alle)", group: G_PRC, keys: VAL_CROPS.map((c) => `price.${c}`), mode: "mult", unit: "×", min: 0.55, max: 1.5, step: 0.01, dec: 2 },
  { id: "price.zwiebel_moehre", label: "Preis Zwiebel/Möhre", group: G_PRC, keys: ["price.zwiebel_moehre"], mode: "abs", money: true, unit: "€/t", lo: 0.6, hi: 1.5, step: 1, dec: 0 },
  { id: "qualValue", label: "Kontrakt-Qualität Wertkulturen", group: G_PRC, keys: VAL_CROPS.map((c) => `qual.${c}`), mode: "mult", unit: "×", min: 0.6, max: 1.1, step: 0.01, dec: 2, hint: "realisierter Preis nach Bonus/Malus × akzeptierte Menge" },
  { id: "qualKart", label: "Qualität Kartoffel (Stärke/Zucker)", group: G_PRC, keys: ["qual.kartoffel_pommes", "qual.kartoffel_chips"], mode: "mult", unit: "×", min: 0.6, max: 1.1, step: 0.01, dec: 2 },
  { id: "qualTomate", label: "Qualität Tomate (Brix)", group: G_PRC, keys: ["qual.tomate"], mode: "mult", unit: "×", min: 0.6, max: 1.1, step: 0.01, dec: 2 },
  { id: "wageAll", label: "Löhne gesamt (Stamm + Saison)", group: G_OPX, keys: ["rate.labor_h", "pers.stamm.gross", "pers.saison.gross"], mode: "mult", unit: "×", min: 0.6, max: 2, step: 0.01, dec: 2 },
  { id: "tcoDiscount", label: "Maschinen-Einkaufsrabatt (TCO)", group: G_OPX, keys: ["tco.discount"], mode: "mult", unit: "×", min: 0, max: 2.5, step: 0.05, dec: 2 },
];
const DBY = new Map(DRIVERS.map((d) => [d.id, d]));

/** Alte Faktor-IDs der separaten Sensitivitäts-Ansicht → Treiber der EINEN Bibliothek.
 *  Nur für die Migration persistierter Konfigurationen (domain.sensitivity). */
const LEGACY_FACTOR: Record<string, string> = {
  price_value: "priceValue", price_tomate: "price.tomate", price_kartoffel: "priceKart",
  price_zwiebel: "price.zwiebel_moehre", price_cereal: "priceRot",
  yield_value: "yieldValue", yield_all: "yieldAll",
  qual_value: "qualValue", qual_kartoffel: "qualKart", qual_tomate: "qualTomate",
  loss_all: "lossAll", diesel: "price.diesel_l", fert: "fertAll", seed: "seedAll",
  water: "irrig.eur_mm", labor: "wageAll", tco: "tcoDiscount",
  euribor: "macro.euribor", tax: "tax.rate", subs_base: "subsidy.per_ha",
  subs_coupled: "subsidy.coupled_freilandgemuese", infl_out: "infl.output", infl_in: "infl.input",
};

/* ---- Presets ------------------------------------------------------------- */
type PVal = number | { m: number };   // absolut ODER Faktor auf den Basiswert
type Preset = { id: string; name: string; desc: string; set: Record<string, PVal> };
const PRESETS: Preset[] = [
  { id: "base", name: "Base Case", desc: "Modell-Baseline — alle Treiber auf den hinterlegten Annahmen.", set: {} },
  {
    id: "infra", name: "Infrastruktur-Ausfall",
    desc: "Netz-/Pumpenausfall des ANIF-Zentralnetzes in der Hitzespitze (12 Tage), erhöhte Wassernorm — ohne Donau-Direktentnahme rd. −35 % Ertrag auf den Wertkulturen.",
    set: { "risk.irrig_outage_d": 12, "farm.intake_direct": 0, "irrig.norm_scale": 1.15, "market.potato_grade": -0.06, "market.brix_premium": -0.05 },
  },
  {
    id: "stagfl", name: "Stagflation / Input-Schock",
    desc: "+30 % auf Dünger, Pflanzenschutz und Energie/Diesel, −15 % Spotpreise, +200 bp Zins, Input-Inflation 4,5 % p. a. (Basis 2,5 %).",
    set: { fertAll: 1.30, psmAll: 1.30, "price.diesel_l": { m: 1.30 }, "irrig.eur_mm": { m: 1.30 }, seedAll: 1.15, "market.spot_delta": -0.15, "macro.rate_shock": 0.02, "infl.input": 0.045 },
  },
  {
    id: "bull", name: "Bull / Max. Vertikalisierung",
    desc: "Hohe Erträge, volle lokale Verarbeitung (25 km), maximale Brix-/Sortierprämien, Donau-Direktentnahme als Redundanz.",
    set: {
      "yield.tomate": 95, "yield.kartoffel_pommes": 52, "yield.kartoffel_chips": 52, yieldRot: 1.10,
      "market.brix_premium": 0.12, "market.potato_grade": 0.10, "market.contract_share": 0.90, "market.spot_delta": 0.05,
      "transport.distance_km": 25, "farm.intake_direct": 1, "market.tomate_cap_t": 300000,
    },
  },
  /* -- aus dem früheren Szenario-Editor der Sensitivitäts-Ansicht ---------- */
  {
    id: "dry", name: "Trockenjahr",
    desc: "−15 % Ertrag über alle Kulturen, −6 % Kontrakt-Qualität der Wertkulturen, +15 % Bewässerungskosten je mm.",
    set: { yieldAll: 0.85, qualValue: 0.94, "irrig.eur_mm": { m: 1.15 } },
  },
  {
    id: "potatocrash", name: "Preisverfall Kartoffel",
    desc: "−25 % Kontraktpreis Kartoffel (Pommes + Chips), −5 % Qualitätserfüllung.",
    set: { priceKart: 0.75, qualKart: 0.95 },
  },
  {
    id: "rateshock", name: "Zins- & Kostenschock",
    desc: "+50 % EURIBOR, +30 % Diesel, +25 % Dünger.",
    set: { "macro.euribor": { m: 1.5 }, "price.diesel_l": { m: 1.3 }, fertAll: 1.25 },
  },
];

/* ---- Assumption-Zugriff -------------------------------------------------- */
function readBase(d: Domain, key: string, sc: string): number | null {
  const a: any = d.assumptions?.[key]; if (!a) return null;
  const p = a.scenarioProfiles?.[sc] ?? a.scenarioProfiles?.[d.baseScenarioId];
  if (!p) return null;
  return p.kind === "constant" ? p.value : (p.values?.[0] ?? null);
}
function setAbsKey(d: Domain, key: string, sc: string, v: number) {
  const a: any = d.assumptions?.[key]; if (!a) return;
  const p = a.scenarioProfiles?.[sc] ?? a.scenarioProfiles?.[d.baseScenarioId]; if (!p) return;
  if (p.kind === "constant") a.scenarioProfiles[sc] = { kind: "constant", value: v };
  else { const b = p.values?.[0] ?? 0; const f = b ? v / b : 1; a.scenarioProfiles[sc] = { kind: "curve", values: p.values.map((x: number) => x * f) }; }
}
function scaleKey(d: Domain, key: string, sc: string, f: number) {
  const a: any = d.assumptions?.[key]; if (!a) return;
  const p = a.scenarioProfiles?.[sc] ?? a.scenarioProfiles?.[d.baseScenarioId]; if (!p) return;
  if (p.kind === "constant") a.scenarioProfiles[sc] = { kind: "constant", value: p.value * f };
  else a.scenarioProfiles[sc] = { kind: "curve", values: p.values.map((x: number) => x * f) };
}
/** Regler-Stand nicht-destruktiv auf eine Kopie der Domäne legen. */
function applyStudio(domain: Domain, vals: Record<string, number>, sc: string): Domain {
  const ids = Object.keys(vals); if (!ids.length) return domain;
  const d: Domain = structuredClone(domain);
  for (const id of ids) {
    const drv = DBY.get(id); if (!drv) continue;
    const v = vals[id]; if (v == null || !isFinite(v)) continue;
    for (const k of drv.keys) { if (drv.mode === "mult") scaleKey(d, k, sc, v); else setAbsKey(d, k, sc, v); }
  }
  return d;
}

/* ---- Kern-Rechnung: EIN Engine-Lauf → alle Studio-Kennzahlen ------------- */
type Res = {
  rev: number; sub: number; ebitda: number; margin: number; ebit: number; ni: number; fcf: number; roic: number;
  dscr: number; lev: number; icr: number;
  valueRev: number; breakRev: number; valueShare: number;
  minCash: number; wcPeak: number; runwayM: number;
  mLab: string[]; mCfo: number[]; mCash: number[]; mRev: number[];
};
const sumW = (a: number[], end: number, w: number) => { let s = 0; for (let k = 0; k < w; k++) s += a[end - k] || 0; return s; };

function runStudio(d: Domain, sc: string): Res {
  const cm = computeModel(buildModelState(d, sc), sc, {});           // Monatsraster
  const an = aggregateComputed(cm, "year");
  const i = an.timeline.periodCount - 1;
  const P = an.pnl, K = an.kpis;
  const V = (li: any) => li?.values?.[i] ?? 0;

  const rev = V(P.revenue), sub = V(P.subsidies);
  const split = deriveRevenueSplitMY(d, sc, (P.revenue as any).values);
  const si = Math.min(i, split.years - 1);

  const n = cm.timeline.periodCount;
  const w = Math.min(12, n), end = n - 1;
  const g = (o: any, k: string): number[] => o?.[k]?.values ?? [];
  const cash = g(cm.cashFlow, "closingCash").length ? g(cm.cashFlow, "closingCash") : g(cm.balanceSheet, "cash");
  const cfo = g(cm.cashFlow, "cfo");
  const rec = g(cm.balanceSheet, "receivables"), inv = g(cm.balanceSheet, "inventory");
  const bio = g(cm.balanceSheet, "biologicalAssets"), pay = g(cm.balanceSheet, "payables");
  const mRev = g(cm.pnl, "revenue");

  let minCash = Infinity, wcPeak = 0, burnSum = 0, burnN = 0;
  const mLab: string[] = [], mCfo: number[] = [], mCash: number[] = [], mRevA: number[] = [];
  for (let k = w - 1; k >= 0; k--) {
    const p = end - k;
    mLab.push(cm.timeline.periods[p]?.label ?? String(p + 1));
    mCfo.push(cfo[p] ?? 0); mCash.push(cash[p] ?? 0); mRevA.push(mRev[p] ?? 0);
    minCash = Math.min(minCash, cash[p] ?? 0);
    wcPeak = Math.max(wcPeak, (rec[p] ?? 0) + (inv[p] ?? 0) + (bio[p] ?? 0) - (pay[p] ?? 0));
    if ((cfo[p] ?? 0) < 0) { burnSum += -(cfo[p] as number); burnN++; }
  }
  const burn = burnN ? burnSum / burnN : 0;
  const runwayM = burn > 0 ? Math.max(0, minCash) / burn : Infinity;

  return {
    rev, sub, ebitda: V(P.ebitda), margin: K.ebitdaMargin.values[i] ?? 0, ebit: V(P.ebit), ni: V(P.netIncome),
    fcf: K.fcf.values[i] ?? 0, roic: K.roic.values[i] ?? 0,
    dscr: K.dscr.values[i] ?? 0, lev: K.netDebtToEbitda.values[i] ?? 0, icr: K.icr.values[i] ?? 0,
    valueRev: split.valueCent[si] ?? 0, breakRev: split.breakCent[si] ?? 0, valueShare: split.valueShare[si] ?? 0,
    minCash: isFinite(minCash) ? minCash : 0, wcPeak, runwayM,
    mLab, mCfo, mCash, mRev: mRevA,
  };
}
/** Leichter Lauf nur für die Heatmap (Jahres-EBITDA des Headline-Jahres). */
function ebitdaOf(d: Domain, sc: string): number {
  const cm = computeModel(buildModelState(d, sc), sc, {});
  const v = (cm.pnl as any).ebitda.values as number[];
  return sumW(v, v.length - 1, Math.min(12, v.length));
}

/* ---- Farb-/Formathilfen -------------------------------------------------- */
const dscrCol = (v: number) => (v >= 1.10 ? "var(--nx-success)" : v >= 1.0 ? "var(--nx-warning)" : "var(--nx-error)");
const levCol = (v: number) => (v <= 3.5 ? "var(--nx-success)" : v <= 4.0 ? "var(--nx-warning)" : "var(--nx-error)");
const dispOf = (d: Drv, v: number) => (d.money ? v / 100 : d.pct ? v * 100 : v);
const rawOf = (d: Drv, x: number) => (d.money ? x * 100 : d.pct ? x / 100 : x);

/* ---- Szenario-Register (eingebaut + eigene) ------------------------------ */
type TabId = "sim" | "tornado" | "vergleich";
type ScenEntry = { id: string; name: string; desc: string; set: Record<string, PVal>; builtin: boolean };

/** Persistierte Szenarien lesen und das Legacy-Format (relative %-Shifts auf alte
 *  Faktor-IDs) auf den Reglerstand der EINEN Treiber-Bibliothek migrieren. */
function migrateScenarios(list: SensScenario[] | undefined, baseOfId: (id: string) => number): SensScenario[] {
  if (!list?.length) return [];
  const builtinNames = new Set(PRESETS.map((p) => p.name));
  return list
    // Alt-Bestand: die drei Szenarien der früheren Sensitivitäts-Ansicht sind
    // jetzt eingebaut — sonst stünden sie doppelt im Register.
    .filter((s) => !(!s.vals && builtinNames.has(s.name)))
    .map((s) => {
    if (s.vals) return s;
    const vals: Record<string, number> = {};
    for (const [fid, pct] of Object.entries(s.shifts ?? {})) {
      const did = LEGACY_FACTOR[fid] ?? (DBY.has(fid) ? fid : ""); if (!did) continue;
      const drv = DBY.get(did); if (!drv) continue;
      vals[did] = drv.mode === "mult" ? 1 + pct : baseOfId(did) * (1 + pct);
    }
    return { id: s.id, name: s.name, desc: s.desc, vals };
  });
}
const DEFAULT_TORNADO: { id: string; delta: number }[] = [
  { id: "priceValue", delta: 0.15 }, { id: "yieldValue", delta: 0.10 }, { id: "qualValue", delta: 0.08 },
  { id: "priceRot", delta: 0.15 }, { id: "price.diesel_l", delta: 0.20 }, { id: "fertAll", delta: 0.20 },
  { id: "wageAll", delta: 0.15 }, { id: "macro.euribor", delta: 0.30 }, { id: "subsidy.coupled_freilandgemuese", delta: 0.20 },
];
/** Zielgrößen des Tornados. */
type MetricId = "ebitda" | "ni" | "fcf" | "minCash";
const METRICS: Record<MetricId, { label: string; pick: (r: Res) => number }> = {
  ebitda: { label: "EBITDA", pick: (r) => r.ebitda },
  ni: { label: "Jahresüberschuss", pick: (r) => r.ni },
  fcf: { label: "Free Cash Flow", pick: (r) => r.fcf },
  minCash: { label: "min. Liquidität", pick: (r) => r.minCash },
};
/** Einen Treiber um ±delta (relativ zum Reglerstand bzw. Modellwert) auslenken. */
function bump(d: Domain, drv: Drv, sc: string, cur: number | undefined, delta: number): Domain {
  const out = structuredClone(d);
  if (drv.mode === "mult") { for (const k of drv.keys) scaleKey(out, k, sc, 1 + delta); return out; }
  if (drv.mode === "toggle") { for (const k of drv.keys) setAbsKey(out, k, sc, delta > 0 ? 1 : 0); return out; }
  for (const k of drv.keys) {
    const b = cur ?? readBase(out, k, sc) ?? 0;
    setAbsKey(out, k, sc, b * (1 + delta));
  }
  return out;
}

/* ============================================================================
 * View
 * ========================================================================== */
export function ScenarioStudioView() {
  const domain = useModelStore((s) => s.domain);
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);
  const currency = useModelStore((s) => s.view.currency);
  const readOnly = useModelStore((s) => s.readOnly);
  const patch = useModelStore((s) => s.patch);

  const [vals, setVals] = React.useState<Record<string, number>>({});
  const [preset, setPreset] = React.useState<string>("base");
  const [tab, setTab] = React.useState<TabId>("sim");
  const [open, setOpen] = React.useState<Record<string, boolean>>({ [G_YLD]: true, [G_PRC]: true, [G_RISK]: true });

  const baseOf = React.useCallback((drv: Drv): number => {
    if (drv.mode === "mult") return 1;
    return readBase(domain, drv.keys[0], sc) ?? 0;
  }, [domain, sc]);

  /* ---- EIN Szenario-Register: eingebaute Presets + eigene, persistierte ---- */
  const userScen = React.useMemo(
    () => migrateScenarios(domain.sensitivity?.scenarios, (id) => { const d = DBY.get(id); return d ? baseOf(d) : 0; }),
    [domain.sensitivity, baseOf],
  );
  const allScen: ScenEntry[] = React.useMemo(() => [
    ...PRESETS.map((p) => ({ id: p.id, name: p.name, desc: p.desc, set: p.set, builtin: true })),
    ...userScen.map((s) => ({ id: s.id, name: s.name, desc: s.desc ?? "", set: (s.vals ?? {}) as Record<string, PVal>, builtin: false })),
  ], [userScen]);
  const resolveSet = React.useCallback((set: Record<string, PVal>): Record<string, number> => {
    const next: Record<string, number> = {};
    for (const [id, pv] of Object.entries(set)) {
      const drv = DBY.get(id); if (!drv) continue;
      next[id] = typeof pv === "number" ? pv : baseOf(drv) * pv.m;
    }
    return next;
  }, [baseOf]);

  /* Presets → Reglerstand */
  const applyPreset = (pid: string) => {
    const p = allScen.find((x) => x.id === pid); if (!p) return;
    setVals(resolveSet(p.set)); setPreset(pid);
  };
  const setDrv = (id: string, v: number) => { setVals((s) => ({ ...s, [id]: v })); setPreset("custom"); };
  const clearDrv = (id: string) => { setVals((s) => { const n = { ...s }; delete n[id]; return n; }); setPreset("custom"); };

  /* ---- Eigene Szenarien: Reglerstand speichern / löschen ------------------ */
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState("");
  const saveScenario = () => {
    const nm = saveName.trim(); if (!nm) return;
    const nid = "usr-" + (1 + userScen.reduce((m, s) => Math.max(m, Number(/^usr-(\d+)$/.exec(s.id)?.[1] ?? 0)), 0));
    const snapshot = { ...vals };
    patch((d) => {
      if (!d.sensitivity) d.sensitivity = { tornado: DEFAULT_TORNADO.map((r) => ({ ...r })), scenarios: [] };
      if (!d.sensitivity.scenarios) d.sensitivity.scenarios = [];
      d.sensitivity.scenarios.push({ id: nid, name: nm, desc: `${Object.keys(snapshot).length} ${getLang() === "en" ? "drivers deflected" : "Treiber ausgelenkt"}`, vals: snapshot });
    });
    setSaveOpen(false); setSaveName(""); setPreset(nid);
  };
  const delScenario = (id: string) =>
    patch((d) => { if (d.sensitivity?.scenarios) d.sensitivity.scenarios = d.sensitivity.scenarios.filter((s) => s.id !== id); });

  /* Rechnung: Basis (unverändert) vs. Szenario (Regler) */
  const base = React.useMemo(() => runStudio(domain, sc), [domain, sc, tick]);
  const scenDomain = React.useMemo(() => applyStudio(domain, vals, sc), [domain, vals, sc, tick]);
  const res = React.useMemo(() => runStudio(scenDomain, sc), [scenDomain, sc, tick]);
  const dirty = Object.keys(vals).length > 0;

  /* ---- Tornado: ± je Treiber, gerechnet AUF dem aktuellen Reglerstand ----- */
  const tornRows = domain.sensitivity?.tornado?.length ? domain.sensitivity.tornado : DEFAULT_TORNADO;
  const setTorn = (fn: (r: { id: string; delta: number }[]) => { id: string; delta: number }[]) =>
    patch((d) => {
      if (!d.sensitivity) d.sensitivity = { tornado: DEFAULT_TORNADO.map((r) => ({ ...r })), scenarios: [] };
      d.sensitivity.tornado = fn(d.sensitivity.tornado?.length ? d.sensitivity.tornado : DEFAULT_TORNADO.map((r) => ({ ...r })));
    });
  const tornActive = tab === "tornado";
  /* Zielgröße des Tornados: EBITDA misst nur das operative Geschäft — Zins und
   * Steuer wirken erst darunter, deshalb ist der Jahresüberschuss wählbar. */
  const [metric, setMetric] = React.useState<MetricId>("ebitda");
  const mBase = METRICS[metric].pick(res);
  const bars = React.useMemo(() => {
    if (!tornActive) return [] as Bar[];
    const pick = METRICS[metric].pick;
    const out = tornRows.map(({ id, delta }) => {
      const drv = DBY.get(id); if (!drv) return null;
      if (!drv.keys.some((k) => domain.assumptions[k])) return null;
      const lo = pick(runStudio(bump(scenDomain, drv, sc, vals[id], -delta), sc));
      const hi = pick(runStudio(bump(scenDomain, drv, sc, vals[id], delta), sc));
      return { id, name: drv.label, delta, low: lo, high: hi, swingLow: lo - mBase, swingHigh: hi - mBase, total: Math.abs(lo - mBase) + Math.abs(hi - mBase) };
    }).filter(Boolean) as Bar[];
    out.sort((a, b) => b.total - a.total);
    return out;
  }, [tornActive, metric, tornRows, scenDomain, domain.assumptions, sc, vals, mBase, tick]);

  /* ---- Vergleich: alle Szenarien des Registers gegen die Modell-Basis ----- */
  const cmpActive = tab === "vergleich";
  const cmp = React.useMemo(() => {
    if (!cmpActive) return [] as { s: ScenEntry; k: Res }[];
    return allScen.map((s) => ({ s, k: runStudio(applyStudio(domain, resolveSet(s.set), sc), sc) }));
  }, [cmpActive, allScen, domain, resolveSet, sc, tick]);

  /* Heatmap (25 Läufe) — nachgelagert, damit das Ziehen der Regler flüssig bleibt */
  const heatVals = React.useDeferredValue(vals);
  const heat = React.useMemo(() => {
    if (tab !== "sim") return { steps: [-0.2, -0.1, 0, 0.1, 0.2], grid: [], lo: 0, hi: 1 };
    const d0 = applyStudio(domain, heatVals, sc);
    const steps = [-0.2, -0.1, 0, 0.1, 0.2];
    const allY = [...VAL_CROPS, ...ROT_CROPS].map((c) => `yield.${c}`);
    const allP = [...VAL_CROPS, ...ROT_CROPS].map((c) => `price.${c}`);
    const grid: number[][] = [];
    for (const dy of steps) {
      const row: number[] = [];
      for (const dp of steps) {
        const d = structuredClone(d0);
        for (const k of allY) scaleKey(d, k, sc, 1 + dy);
        for (const k of allP) scaleKey(d, k, sc, 1 + dp);
        row.push(ebitdaOf(d, sc));
      }
      grid.push(row);
    }
    const flat = grid.flat();
    return { steps, grid, lo: Math.min(...flat), hi: Math.max(...flat) };
  }, [tab, domain, heatVals, sc, tick]);

  const cur = currency === "EUR" ? "€" : "RON";
  const D = (now: number, was: number) => now - was;

  return (
    <div className="space-y-4">
      {/* ---------------------------- Kopfzeile: Ansicht + Szenario-Register */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <div className="flex items-center gap-3">
            <h2 className="text-[14px] font-semibold">{t("Szenario-Studio")}</h2>
            <Segmented
              ariaLabel={t("Ansicht")}
              value={tab}
              onChange={(v) => setTab(v as TabId)}
              options={[
                { value: "sim", label: t("Simulation") },
                { value: "tornado", label: t("Tornado") },
                { value: "vergleich", label: t("Szenario-Vergleich") },
              ]}
            />
            {preset === "custom" && <StatusPill tone="warning" label={t("Eigene Einstellung")} />}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-control border px-3 text-[12px] font-semibold"
              style={{ height: 32, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }}
              onClick={() => { setVals({}); setPreset("base"); }}
            >
              <RotateCcw size={13} strokeWidth={2.5} aria-hidden />{t("Zurücksetzen")}
            </button>
            <button
              disabled={!dirty || readOnly}
              title={t("Aktuellen Reglerstand als eigenes Szenario im Register ablegen")}
              className="inline-flex items-center gap-1.5 rounded-control border px-3 text-[12px] font-semibold"
              style={{ height: 32, borderColor: "var(--nx-border)", color: dirty && !readOnly ? "var(--nx-text-secondary)" : "var(--nx-text-muted)", background: "var(--nx-surface)", opacity: dirty && !readOnly ? 1 : 0.5 }}
              onClick={() => setSaveOpen((s) => !s)}
            >
              <Save size={13} strokeWidth={2.5} aria-hidden />{t("Als Szenario speichern")}
            </button>
            <button
              disabled={!dirty || readOnly}
              title={readOnly ? t("Betrachter-Modus: Modell schreibgeschützt") : t("Reglerstand fest in die Annahmen des aktiven Szenarios schreiben")}
              className="inline-flex items-center gap-1.5 rounded-control border px-3 text-[12px] font-semibold"
              style={{ height: 32, borderColor: "var(--nx-brand-lift)", color: dirty && !readOnly ? "var(--nx-brand-lift)" : "var(--nx-text-muted)", background: "var(--nx-surface)", opacity: dirty && !readOnly ? 1 : 0.5 }}
              onClick={() => {
                patch((d) => {
                  for (const [id, v] of Object.entries(vals)) {
                    const drv = DBY.get(id); if (!drv || v == null) continue;
                    for (const k of drv.keys) { if (drv.mode === "mult") scaleKey(d, k, sc, v); else setAbsKey(d, k, sc, v); }
                  }
                });
                setVals({}); setPreset("base");
              }}
            >
              <Download size={13} strokeWidth={2.5} aria-hidden />{t("Ins Modell übernehmen")}
            </button>
          </div>
        </div>
        {/* Szenario-Register: eingebaute Szenarien + eigene, gespeicherte */}
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b" style={{ borderColor: "var(--nx-border-divider)" }}>
          <span className="caption mr-1 text-[9.5px] font-bold uppercase tracking-wide text-nx-text-muted">{t("Szenarien")}</span>
          {allScen.map((s) => {
            const on = preset === s.id;
            return (
              <span key={s.id} className="inline-flex items-center rounded-pill border" title={t(s.desc)}
                style={{ height: 24, borderColor: on ? "var(--nx-brand-lift)" : "var(--nx-border)", background: on ? "var(--nx-success-bg)" : "var(--nx-surface-sunken)" }}>
                <button className="px-2.5 text-[11.5px] font-semibold" style={{ color: on ? "var(--nx-green-ink)" : "var(--nx-text-secondary)" }} onClick={() => applyPreset(s.id)}>
                  {s.builtin ? t(s.name) : s.name}
                </button>
                {!s.builtin && !readOnly && (
                  <button className="pr-2 pl-0.5" title={t("Szenario löschen")} onClick={() => delScenario(s.id)} style={{ color: "var(--nx-text-muted)" }}>
                    <Trash2 size={11} strokeWidth={2.5} aria-hidden />
                  </button>
                )}
              </span>
            );
          })}
        </div>
        {saveOpen && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b" style={{ borderColor: "var(--nx-border-divider)", background: "var(--nx-surface-sunken)" }}>
            <input
              autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveScenario(); if (e.key === "Escape") setSaveOpen(false); }}
              placeholder={t("Name des Szenarios")}
              className="rounded-control border px-2 text-[12px]"
              style={{ height: 28, width: 260, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }}
            />
            <button className="rounded-control border px-3 text-[12px] font-semibold" style={{ height: 28, borderColor: "var(--nx-brand-lift)", color: "var(--nx-brand-lift)" }} onClick={saveScenario}>{t("Speichern")}</button>
            <button className="rounded-control border px-3 text-[12px]" style={{ height: 28, borderColor: "var(--nx-border)", color: "var(--nx-text-muted)" }} onClick={() => setSaveOpen(false)}>{t("Abbrechen")}</button>
            <span className="text-[11px] text-nx-text-muted">{Object.keys(vals).length} {t("Treiber ausgelenkt")}</span>
          </div>
        )}
        <div className="px-4 py-2 text-[11px] text-nx-text-muted">
          {preset === "custom"
            ? t("Regler frei kombiniert — jede Änderung rechnet das vollständige Modell (Composer → Engine) nicht-destruktiv neu.")
            : (() => { const s = allScen.find((x) => x.id === preset); return s ? (s.builtin ? t(s.desc) : s.desc) : ""; })()}
        </div>
      </section>

      {/* ------------------------------------------------------- KPI-Kacheln */}
      <div className="rounded-tile border overflow-hidden" style={{ borderColor: "var(--nx-border)" }}>
        <div className="flex items-center justify-between px-4 py-1.5 border-b" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
          <span className="caption text-[9.5px] font-bold uppercase tracking-wide text-nx-text-muted">{t("Szenario-Kennzahlen")}</span>
          <span className="caption text-[9.5px] text-nx-text-muted">{t("Headline-Jahr · Δ gegen Base Case")}</span>
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-3 xl:grid-cols-6" style={{ background: "var(--nx-border-divider)" }}>
          <Card cap={t("Umsatz Wertkulturen")} val={fmtMoney(res.valueRev, currency)} u={cur} d={D(res.valueRev, base.valueRev)} sub={`${fmtPct(res.valueShare)} ${t("vom Erlös")}`} />
          <Card cap={t("Umsatz Rotation/Break")} val={fmtMoney(res.breakRev, currency)} u={cur} d={D(res.breakRev, base.breakRev)} sub={`${fmtPct(1 - res.valueShare)} ${t("vom Erlös")}`} />
          <Card cap={t("EBITDA")} val={fmtMoney(res.ebitda, currency)} u={cur} d={D(res.ebitda, base.ebitda)} sub={`${t("Marge")} ${fmtPct(res.margin)}`} />
          <Card cap={t("Jahresüberschuss")} val={fmtMoney(res.ni, currency)} u={cur} d={D(res.ni, base.ni)} sub={t("nach Zins & Steuer")} />
          <Card cap={t("Free Cash Flow")} val={fmtMoney(res.fcf, currency)} u={cur} d={D(res.fcf, base.fcf)} sub="NI + AfA − CapEx" />
          <Card cap={t("ROIC")} val={fmtPct(res.roic)} u="" d={0} sub={`${t("Basis")} ${fmtPct(base.roic)}`} />
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-3 xl:grid-cols-6" style={{ background: "var(--nx-border-divider)", borderTop: "1px solid var(--nx-border)" }}>
          <Tile cap={t("Working-Capital-Peak")} val={fmtMoney(res.wcPeak, currency)} u={cur} sub={`${t("Basis")} ${fmtMoney(base.wcPeak, currency)}`} />
          <Tile cap={t("min. Liquidität")} val={fmtMoney(res.minCash, currency)} u={cur} col={res.minCash < 0 ? "var(--nx-error)" : undefined} sub={`${t("Basis")} ${fmtMoney(base.minCash, currency)}`} />
          <Tile cap={t("Cash-Runway")} val={isFinite(res.runwayM) ? fmtNumber(res.runwayM, 1) : "∞"} u={t("Mon.")} col={isFinite(res.runwayM) && res.runwayM < 3 ? "var(--nx-error)" : undefined} sub={t("min. Liquidität / Ø Monatsburn")} />
          <Tile cap={t("DSCR")} val={fmtNumber(res.dscr, 2)} u="x" col={dscrCol(res.dscr)} sub={`${t("Covenant")} ≥ 1,10`} />
          <Tile cap={t("Net Debt / EBITDA")} val={fmtNumber(res.lev, 2)} u="x" col={levCol(res.lev)} sub={`${t("Covenant")} ≤ 3,50`} />
          <Tile cap={t("ICR")} val={fmtNumber(res.icr, 2)} u="x" sub={`${t("Basis")} ${fmtNumber(base.icr, 2)}`} />
        </div>
      </div>

      {/* ------------------------------------- Regler links · Grafiken rechts */}
      {tab === "sim" && (
      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(340px, 400px) minmax(0, 1fr)" }}>
        {/* ---- Regler ---- */}
        <section className="rounded-tile border self-start" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
            <h2 className="text-[14px] font-semibold">{t("Treiber")}</h2>
            <span className="num text-[11px] text-nx-text-muted">{Object.keys(vals).length} {t("aktiv")}</span>
          </div>
          <div className="max-h-[720px] overflow-y-auto">
            {GROUPS.map((grp) => {
              const items = DRIVERS.filter((d) => d.group === grp);
              const nAct = items.filter((d) => vals[d.id] != null).length;
              const isOpen = open[grp] ?? false;
              return (
                <div key={grp} className="border-b" style={{ borderColor: "var(--nx-border-divider)" }}>
                  <button
                    className="flex w-full items-center gap-2 px-4 py-2 text-left"
                    onClick={() => setOpen((o) => ({ ...o, [grp]: !isOpen }))}
                    style={{ background: isOpen ? "var(--nx-surface-sunken)" : "transparent" }}
                  >
                    {isOpen ? <ChevronDown size={13} strokeWidth={2.5} aria-hidden /> : <ChevronRight size={13} strokeWidth={2.5} aria-hidden />}
                    <span className="caption text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--nx-text-secondary)" }}>{t(grp)}</span>
                    {nAct > 0 && <span className="num rounded-pill px-1.5 text-[10px] font-bold" style={{ background: "var(--nx-success-bg)", color: "var(--nx-success)" }}>{nAct}</span>}
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-3 pt-1 space-y-3">
                      {items.map((drv) => (
                        <DrvRow key={drv.id} drv={drv} base={baseOf(drv)} val={vals[drv.id]} onChange={(v) => setDrv(drv.id, v)} onReset={() => clearDrv(drv.id)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ---- Grafiken ---- */}
        <div className="space-y-4">
          <SeasonalChart res={res} base={base} currency={currency} />
          <Heatmap heat={heat} currency={currency} baseEbitda={res.ebitda} />
          <CapexRoi domain={domain} sc={sc} currency={currency} />
        </div>
      </div>
      )}

      {/* --------------------------------------------------------- Tornado */}
      {tab === "tornado" && (
        <TornadoPanel
          bars={bars} rows={tornRows} setTorn={setTorn} readOnly={readOnly}
          currency={currency} metric={metric} setMetric={setMetric} mBase={mBase}
          custom={preset === "custom" || dirty}
        />
      )}

      {/* ------------------------------------------------ Szenario-Vergleich */}
      {tab === "vergleich" && (
        <ComparePanel rows={cmp} base={base} currency={currency} onLoad={applyPreset} active={preset} />
      )}
    </div>
  );
}

/* ============================== Tornado ================================== */
type Bar = { id: string; name: string; delta: number; low: number; high: number; swingLow: number; swingHigh: number; total: number };
function TornadoPanel({ bars, rows, setTorn, readOnly, currency, metric, setMetric, mBase, custom }: {
  bars: Bar[]; rows: { id: string; delta: number }[];
  setTorn: (fn: (r: { id: string; delta: number }[]) => { id: string; delta: number }[]) => void;
  readOnly: boolean; currency: "EUR" | "RON";
  metric: MetricId; setMetric: (m: MetricId) => void; mBase: number; custom: boolean;
}) {
  const maxSwing = Math.max(1, ...bars.map((b) => Math.max(Math.abs(b.swingLow), Math.abs(b.swingHigh))));
  const seg = (v: number) => {
    const w = (Math.abs(v) / maxSwing) * 50;
    return { left: `${v < 0 ? 50 - w : 50}%`, width: `${w}%`, background: v < 0 ? "var(--nx-error)" : "var(--nx-success)" };
  };
  const free = DRIVERS.filter((d) => !rows.some((r) => r.id === d.id));
  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold">
          <Tornado size={14} strokeWidth={2.5} aria-hidden />{t("Tornado — Wirkung je Treiber")}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            ariaLabel={t("Zielgröße")}
            value={metric}
            onChange={(v) => setMetric(v as MetricId)}
            options={(Object.keys(METRICS) as MetricId[]).map((m) => ({ value: m, label: t(METRICS[m].label) }))}
          />
          <span className="text-[11px] text-nx-text-muted">
            {custom ? t("gerechnet um den aktuellen Reglerstand") : t("gerechnet um die Modell-Basis")} · {fmtMoney(mBase, currency)}
          </span>
        </div>
      </div>
      <div className="px-4 py-3 space-y-1.5">
        {bars.length === 0 && <div className="py-6 text-center text-[12px] text-nx-text-muted">{t("Keine Treiber ausgewählt.")}</div>}
        {bars.map((b) => (
          <div key={b.id} className="grid items-center gap-2" style={{ gridTemplateColumns: "minmax(150px, 230px) 70px minmax(0, 1fr) 170px 20px" }}>
            <span className="truncate text-[12px]" title={t(b.name)}>{t(b.name)}</span>
            <span className="flex items-center gap-1">
              <span className="text-[10px] text-nx-text-muted">±</span>
              <input
                type="number" step={1} min={1} max={90} disabled={readOnly}
                value={Math.round(b.delta * 100)}
                onChange={(e) => { const x = Number(e.target.value); if (isFinite(x)) setTorn((r) => r.map((q) => (q.id === b.id ? { ...q, delta: Math.max(0.01, x / 100) } : q))); }}
                className="num rounded-control border px-1 text-right text-[11px]"
                style={{ width: 46, height: 24, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }}
                aria-label={`${t(b.name)} ±%`}
              />
              <span className="text-[10px] text-nx-text-muted">%</span>
            </span>
            <div className="relative" style={{ height: 18, background: "var(--nx-surface-sunken)", borderRadius: 3 }}>
              <div style={{ position: "absolute", top: 0, bottom: 0, ...seg(b.swingLow), opacity: 0.85, borderRadius: 2 }} />
              <div style={{ position: "absolute", top: 0, bottom: 0, ...seg(b.swingHigh), opacity: 0.85, borderRadius: 2 }} />
              <div style={{ position: "absolute", top: -2, bottom: -2, left: "50%", width: 1, background: "var(--nx-border)" }} />
            </div>
            <span className="num text-right text-[11px]">
              <Swing v={b.swingLow} currency={currency} />
              <span className="mx-1 text-nx-text-muted">/</span>
              <Swing v={b.swingHigh} currency={currency} />
            </span>
            <button disabled={readOnly} title={t("Treiber entfernen")} onClick={() => setTorn((r) => r.filter((q) => q.id !== b.id))} style={{ color: "var(--nx-text-muted)" }}>
              <X size={12} strokeWidth={2.5} aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-t" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface-sunken)" }}>
        <Plus size={12} strokeWidth={2.5} aria-hidden />
        <select
          disabled={readOnly} value=""
          onChange={(e) => { const id = e.target.value; if (id) setTorn((r) => [...r, { id, delta: 0.15 }]); }}
          className="rounded-control border px-2 text-[11.5px]"
          style={{ height: 26, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }}
          aria-label={t("Treiber hinzufügen")}
        >
          <option value="">{t("Treiber hinzufügen …")}</option>
          {free.map((d) => <option key={d.id} value={d.id}>{t(d.label)}</option>)}
        </select>
        <span className="text-[11px] text-nx-text-muted">{t("Jede Zeile lenkt den Treiber ±x % aus und rechnet das vollständige Modell neu.")}</span>
      </div>
    </section>
  );
}

function Swing({ v, currency }: { v: number; currency: "EUR" | "RON" }) {
  if (Math.abs(v) < 0.5) return <span className="text-nx-text-muted">—</span>;
  return <span style={{ color: v < 0 ? "var(--nx-error)" : "var(--nx-success)" }}>{v < 0 ? "−" : "+"}{fmtMoney(Math.abs(v), currency)}</span>;
}

/* ========================== Szenario-Vergleich =========================== */
function ComparePanel({ rows, base, currency, onLoad, active }: {
  rows: { s: ScenEntry; k: Res }[]; base: Res; currency: "EUR" | "RON"; onLoad: (id: string) => void; active: string;
}) {
  const th = "px-3 py-1.5 text-right caption text-[9.5px] font-bold uppercase tracking-wide text-nx-text-muted";
  const td = "num px-3 py-1.5 text-right text-[11.5px]";
  return (
    <section className="rounded-tile border overflow-hidden" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold">
          <GitCompare size={14} strokeWidth={2.5} aria-hidden />{t("Szenario-Vergleich")}
        </h2>
        <span className="text-[11px] text-nx-text-muted">{t("Alle Szenarien des Registers gegen die Modell-Basis — Headline-Jahr")}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: "var(--nx-surface-sunken)" }}>
              <th className="px-3 py-1.5 text-left caption text-[9.5px] font-bold uppercase tracking-wide text-nx-text-muted">{t("Szenario")}</th>
              <th className={th}>{t("EBITDA / J.")}</th>
              <th className={th}>{t("Δ vs. Basis")}</th>
              <th className={th}>{t("Umsatz / J.")}</th>
              <th className={th}>{t("min. Liquidität")}</th>
              <th className={th}>{t("DSCR")}</th>
              <th className={th}>{t("Net Debt / EBITDA")}</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
              <td className="px-3 py-1.5 text-[12px] font-semibold">{t("Modell-Basis")}</td>
              <td className={td}>{fmtMoney(base.ebitda, currency)}</td>
              <td className={`${td} text-nx-text-muted`}>—</td>
              <td className={td}>{fmtMoney(base.rev, currency)}</td>
              <td className={td} style={{ color: base.minCash < 0 ? "var(--nx-error)" : undefined }}>{fmtMoney(base.minCash, currency)}</td>
              <td className={td} style={{ color: dscrCol(base.dscr) }}>{fmtNumber(base.dscr, 2)}x</td>
              <td className={td} style={{ color: levCol(base.lev) }}>{fmtNumber(base.lev, 2)}x</td>
              <td />
            </tr>
            {rows.filter(({ s }) => s.id !== "base").map(({ s, k }) => {
              const d = k.ebitda - base.ebitda;
              return (
                <tr key={s.id} style={{ borderTop: "1px solid var(--nx-border-divider)", background: s.id === active ? "var(--nx-success-bg)" : undefined }}>
                  <td className="px-3 py-1.5 text-[12px]">
                    <span className="font-semibold">{s.builtin ? t(s.name) : s.name}</span>
                    {!s.builtin && <span className="ml-1.5 caption text-[9px] text-nx-text-muted">{t("eigen")}</span>}
                  </td>
                  <td className={td}>{fmtMoney(k.ebitda, currency)}</td>
                  <td className={td} style={{ color: d < 0 ? "var(--nx-error)" : d > 0 ? "var(--nx-success)" : undefined }}>
                    {Math.abs(d) < 0.5 ? "—" : `${d < 0 ? "−" : "+"}${fmtMoney(Math.abs(d), currency)}`}
                  </td>
                  <td className={td}>{fmtMoney(k.rev, currency)}</td>
                  <td className={td} style={{ color: k.minCash < 0 ? "var(--nx-error)" : undefined }}>{fmtMoney(k.minCash, currency)}</td>
                  <td className={td} style={{ color: dscrCol(k.dscr) }}>{fmtNumber(k.dscr, 2)}x</td>
                  <td className={td} style={{ color: levCol(k.lev) }}>{fmtNumber(k.lev, 2)}x</td>
                  <td className="px-3 py-1.5 text-right">
                    <button className="inline-flex items-center gap-1 rounded-control border px-2 text-[11px] font-semibold"
                      style={{ height: 24, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}
                      onClick={() => onLoad(s.id)} title={t("Szenario in die Regler laden")}>
                      <SlidersHorizontal size={11} strokeWidth={2.5} aria-hidden />{t("Laden")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ============================== KPI-Kacheln ============================== */
function Card({ cap, val, u, d, sub }: { cap: string; val: string; u: string; d: number; sub: string }) {
  const ERR = "var(--nx-error)";
  const neg = val.startsWith("(");
  return (
    <div className="px-4 py-3" style={{ background: "var(--nx-surface)" }}>
      <div className="caption text-[10px] font-bold text-nx-text-muted">{cap}</div>
      <div className="num text-[19px] font-bold leading-tight" style={{ color: neg ? ERR : "var(--nx-text)" }}>
        {val}{u && <span className="ml-0.5 text-[11px] font-normal text-nx-text-muted">{u}</span>}
      </div>
      <div className="caption text-[9.5px] flex items-center gap-1.5">
        <span className="text-nx-text-muted">{sub}</span>
        {Math.abs(d) > 0.5 && (
          <span className="num font-bold" style={{ color: d < 0 ? ERR : "var(--nx-success)" }}>
            {d < 0 ? "−" : "+"}{fmtMoney(Math.abs(d))}
          </span>
        )}
      </div>
    </div>
  );
}
function Tile({ cap, val, u, col, sub }: { cap: string; val: string; u?: string; col?: string; sub?: string }) {
  return (
    <div className="px-4 py-2" style={{ background: "var(--nx-surface-sunken)" }}>
      <div className="caption text-[10px] font-bold text-nx-text-muted">{cap}</div>
      <div className="num text-[16px] font-bold leading-tight" style={{ color: col ?? (val.startsWith("(") ? "var(--nx-error)" : "var(--nx-text)") }}>
        {val}{u && <span className="ml-0.5 text-[11px] font-normal text-nx-text-muted">{u}</span>}
      </div>
      {sub && <div className="caption text-[9.5px] text-nx-text-muted">{sub}</div>}
    </div>
  );
}

/* ============================== Regler-Zeile ============================== */
function DrvRow({ drv, base, val, onChange, onReset }: { drv: Drv; base: number; val?: number; onChange: (v: number) => void; onReset: () => void }) {
  const cur = val ?? base;
  const active = val != null;
  const dBase = dispOf(drv, base);
  const dCur = dispOf(drv, cur);
  const min = drv.min != null ? drv.min : dBase * (drv.lo ?? 0.6);
  const max = drv.max != null ? drv.max : dBase * (drv.hi ?? 1.4);
  const step = drv.step ?? 1;
  const dec = drv.dec ?? 2;

  if (drv.mode === "toggle") {
    const on = cur >= 0.5;
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12px] leading-tight" style={{ color: active ? "var(--nx-green-ink)" : "var(--nx-text)" }}>{t(drv.label)}</div>
          {drv.hint && <div className="caption text-[9.5px] text-nx-text-muted">{t(drv.hint)}</div>}
        </div>
        <button
          role="switch" aria-checked={on} aria-label={t(drv.label)}
          onClick={() => onChange(on ? 0 : 1)}
          className="shrink-0 rounded-pill border transition-colors"
          style={{ width: 42, height: 24, background: on ? "var(--nx-success-bg)" : "var(--nx-surface-sunken)", borderColor: on ? "var(--nx-success)" : "var(--nx-border)", position: "relative" }}
        >
          <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: 999, background: on ? "var(--nx-success)" : "var(--nx-text-muted)", transition: "left 140ms" }} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] leading-tight truncate" title={t(drv.label)} style={{ color: active ? "var(--nx-green-ink)" : "var(--nx-text)" }}>{t(drv.label)}</span>
        <span className="flex shrink-0 items-center gap-1">
          <input
            type="number" value={Number(dCur.toFixed(dec))} step={step} min={min} max={max}
            onChange={(e) => { const x = Number(e.target.value); if (isFinite(x)) onChange(rawOf(drv, x)); }}
            className="num rounded-control border px-1 text-right text-[11.5px]"
            style={{ width: 74, height: 26, background: "var(--nx-app-bg)", borderColor: active ? "var(--nx-brand-lift)" : "var(--nx-border)", color: "var(--nx-text)", fontWeight: 600 }}
          />
          {drv.unit && <span className="text-[10px] text-nx-text-muted" style={{ width: 42 }}>{drv.unit}</span>}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, dCur))}
          onChange={(e) => onChange(rawOf(drv, Number(e.target.value)))}
          className="h-[4px] flex-1 cursor-pointer"
          style={{ accentColor: "var(--nx-brand-lift)" }}
          aria-label={t(drv.label)}
        />
        <button
          onClick={onReset} title={t("Auf Modellwert zurücksetzen")}
          className="shrink-0 text-[10px]"
          style={{ color: active ? "var(--nx-text-secondary)" : "var(--nx-text-muted)", opacity: active ? 1 : 0.35 }}
        >
          <RotateCcw size={11} strokeWidth={2.5} aria-hidden />
        </button>
      </div>
      <div className="caption text-[9.5px] text-nx-text-muted">
        {`${getLang() === "en" ? "model" : "Modell"} ${fmtNumber(dBase, dec)}${drv.unit ? " " + drv.unit : ""}`}
        {drv.hint ? ` · ${t(drv.hint)}` : ""}
      </div>
    </div>
  );
}

/* ========================= Saisonaler Cashflow =========================== */
function SeasonalChart({ res, base, currency }: { res: Res; base: Res; currency: "EUR" | "RON" }) {
  const n = res.mCfo.length;
  const maxAbs = Math.max(1, ...res.mCfo.map(Math.abs), ...base.mCfo.map(Math.abs));
  const cashMax = Math.max(1, ...res.mCash, ...base.mCash, 0);
  const cashMin = Math.min(0, ...res.mCash, ...base.mCash);
  const H = 150, ZERO = H / 2;
  const cashY = (v: number) => H - ((v - cashMin) / Math.max(1, cashMax - cashMin)) * (H - 8) - 4;
  const pt = (arr: number[]) => arr.map((v, k) => `${((k + 0.5) / n) * 100},${cashY(v)}`).join(" ");
  const burnQ = res.mCfo.slice(0, 6).reduce((a, b) => a + b, 0);
  const harvQ = res.mCfo.slice(6).reduce((a, b) => a + b, 0);

  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold"><Droplets size={14} strokeWidth={2.5} aria-hidden />{t("Saisonaler Cashflow — Vorfinanzierung H1 vs. Ernte-Zufluss H2")}</h2>
        <span className="num text-[11.5px] text-nx-text-secondary">
          {t("H1")} <b style={{ color: burnQ < 0 ? "var(--nx-error)" : "var(--nx-success)" }}>{fmtMoney(burnQ, currency)}</b>
          {"  ·  "}{t("H2")} <b style={{ color: harvQ < 0 ? "var(--nx-error)" : "var(--nx-success)" }}>{fmtMoney(harvQ, currency)}</b>
        </span>
      </div>
      <div className="px-4 py-3">
        <div className="relative" style={{ height: H }}>
          <div className="absolute left-0 right-0" style={{ top: ZERO, height: 1, background: "var(--nx-border)" }} />
          <div className="absolute inset-0 flex items-stretch gap-[3px]">
            {res.mCfo.map((v, k) => {
              const h = (Math.abs(v) / maxAbs) * (H / 2 - 4);
              const bh = (Math.abs(base.mCfo[k] ?? 0) / maxAbs) * (H / 2 - 4);
              const up = v >= 0, bup = (base.mCfo[k] ?? 0) >= 0;
              return (
                <div key={k} className="relative flex-1" title={`${res.mLab[k]}: ${fmtMoney(v, currency)}`}>
                  {/* Base-Referenz (Umriss) */}
                  <div className="absolute" style={{ left: "12%", right: "12%", top: bup ? ZERO - bh : ZERO, height: Math.max(1, bh), border: "1px dashed var(--nx-border)", borderRadius: 2 }} />
                  <div className="absolute" style={{ left: "22%", right: "22%", top: up ? ZERO - h : ZERO, height: Math.max(1, h), background: up ? "var(--nx-success)" : "#C0392B", borderRadius: 2, opacity: 0.9 }} />
                </div>
              );
            })}
          </div>
          <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden>
            <polyline points={pt(base.mCash)} fill="none" stroke="var(--nx-text-muted)" strokeWidth={0.7} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
            <polyline points={pt(res.mCash)} fill="none" stroke="var(--nx-brand-lift)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <div className="mt-1 flex gap-[3px]">
          {res.mLab.map((l, k) => <div key={k} className="caption flex-1 text-center text-[8.5px] text-nx-text-muted">{l.split(" ")[0]}</div>)}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 caption text-[9.5px] text-nx-text-muted">
          <Legend color="var(--nx-success)" label={t("operativer Zufluss")} />
          <Legend color="#C0392B" label={t("operativer Abfluss")} />
          <Legend color="var(--nx-brand-lift)" label={t("Liquidität (Szenario)")} />
          <Legend color="var(--nx-text-muted)" label={t("Base Case (gestrichelt)")} />
        </div>
      </div>
    </section>
  );
}
function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span style={{ width: 10, height: 3, background: color, borderRadius: 2 }} />{label}</span>;
}

/* =============================== Heatmap ================================= */
function Heatmap({ heat, currency, baseEbitda }: { heat: { steps: number[]; grid: number[][]; lo: number; hi: number }; currency: "EUR" | "RON"; baseEbitda: number }) {
  const span = Math.max(1, heat.hi - heat.lo);
  const col = (v: number) => {
    const x = (v - heat.lo) / span;                       // 0 = schwächstes, 1 = stärkstes Feld
    return x >= 0.5
      ? `color-mix(in srgb, var(--nx-success) ${Math.round((x - 0.5) * 2 * 70 + 12)}%, var(--nx-surface))`
      : `color-mix(in srgb, #C0392B ${Math.round((0.5 - x) * 2 * 70 + 12)}%, var(--nx-surface))`;
  };
  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold"><TrendingUp size={14} strokeWidth={2.5} aria-hidden />{t("Sensitivitäts-Matrix — Jahres-EBITDA bei Ertrag × Preis")}</h2>
        <span className="num text-[11.5px] text-nx-text-secondary">{t("Szenario-Mitte")} <b>{fmtMoney(baseEbitda, currency)}</b></span>
      </div>
      <div className="overflow-x-auto px-4 py-3">
        <table className="w-full text-[11.5px]" style={{ borderCollapse: "separate", borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="caption text-[9.5px] font-bold text-nx-text-muted text-left" style={{ width: 92 }}>{t("Ertrag \\ Preis")}</th>
              {heat.steps.map((s) => (
                <th key={s} className="num caption text-[10px] font-bold text-nx-text-muted text-center">{s > 0 ? "+" : ""}{Math.round(s * 100)} %</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heat.grid.map((row, ri) => (
              <tr key={ri}>
                <td className="num caption text-[10px] font-bold text-nx-text-muted">{heat.steps[ri] > 0 ? "+" : ""}{Math.round(heat.steps[ri] * 100)} %</td>
                {row.map((v, ci) => {
                  const mid = ri === 2 && ci === 2;
                  return (
                    <td key={ci} className="num text-center" style={{
                      background: col(v), borderRadius: 4, padding: "7px 4px", fontWeight: mid ? 800 : 600,
                      color: "var(--nx-text)", outline: mid ? "1.5px solid var(--nx-brand-lift)" : "none",
                    }}>
                      {fmtMoney(v, currency)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 caption text-[9.5px] text-nx-text-muted">
          {t("Zeilen = Ertragsauslenkung aller Kulturen, Spalten = Preisauslenkung. Die Matrix rechnet auf dem AKTUELLEN Reglerstand — die Mitte entspricht dem Szenario oben.")}
        </div>
      </div>
    </section>
  );
}

/* ========================= CapEx ROI / Payback =========================== */
type CapexMode = "pivot" | "plant";
function CapexRoi({ domain, sc, currency }: { domain: Domain; sc: string; currency: "EUR" | "RON" }) {
  const [mode, setMode] = React.useState<CapexMode>("pivot");
  const perHa = readBase(domain, "mprice.irrig_perha", sc) ?? 200000;
  const perT = readBase(domain, "mprice.store_pert", sc) ?? 12000;
  const eur = readBase(domain, "macro.euribor", sc) ?? 0.026;
  const shock = readBase(domain, "macro.rate_shock", sc) ?? 0;
  const spedRate = readBase(domain, "transport.spedition_rate", sc) ?? 900;
  const distKm = readBase(domain, "transport.distance_km", sc) ?? 120;
  const refKm = readBase(domain, "transport.dist_ref_km", sc) ?? 120;

  /* Vorbelegung aus dem Modell — danach frei editierbar. */
  const seed = mode === "pivot"
    ? { units: 1000, unitCapex: perHa / 100, benefit: 1400, years: 15, label: "ha", uLabel: "€/ha", bLabel: "€/ha·a", note: "Zusatz-Deckungsbeitrag bewässert vs. trocken je ha" }
    : { units: 60000, unitCapex: perT / 100, benefit: Math.round((spedRate * (distKm / Math.max(1, refKm))) / 100 * 0.7) + 8, years: 20, label: "t", uLabel: "€/t", bLabel: "€/t·a", note: "eingesparte Fracht + Qualitätsprämie je t Eigenverarbeitung" };

  const [units, setUnits] = React.useState(seed.units);
  const [unitCapex, setUnitCapex] = React.useState(seed.unitCapex);
  const [benefit, setBenefit] = React.useState(seed.benefit);
  const [years, setYears] = React.useState(seed.years);
  const [rate, setRate] = React.useState(Math.round((eur + shock + 0.025) * 1000) / 10);
  const modeRef = React.useRef(mode);
  React.useEffect(() => {
    if (modeRef.current === mode) return;
    modeRef.current = mode;
    setUnits(seed.units); setUnitCapex(seed.unitCapex); setBenefit(seed.benefit); setYears(seed.years);
  }, [mode, seed.units, seed.unitCapex, seed.benefit, seed.years]);

  const I = units * unitCapex;                       // Investition €
  const B = units * benefit;                          // jährlicher Nutzen €
  const r = rate / 100;
  const af = (rr: number, n: number) => (Math.abs(rr) < 1e-9 ? n : (1 - Math.pow(1 + rr, -n)) / rr);
  const npv = -I + B * af(r, years);
  const payStat = B > 0 ? I / B : Infinity;
  const payDyn = (() => {
    if (B <= 0) return Infinity;
    let acc = 0;
    for (let y = 1; y <= years; y++) { acc += B / Math.pow(1 + r, y); if (acc >= I) return y - 1 + (I - (acc - B / Math.pow(1 + r, y))) / (B / Math.pow(1 + r, y)); }
    return Infinity;
  })();
  const irr = (() => {
    if (B <= 0 || I <= 0) return NaN;
    let lo = -0.9, hi = 3;
    const f = (rr: number) => -I + B * af(rr, years);
    if (f(lo) < 0 || f(hi) > 0) return NaN;
    for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
    return (lo + hi) / 2;
  })();

  const num = (v: number, set: (n: number) => void, w = 96, dec = 0) => (
    <input type="number" value={Number(v.toFixed(dec))} onChange={(e) => { const x = Number(e.target.value); if (isFinite(x)) set(x); }}
      className="num rounded-control border px-2 text-right text-[12px]"
      style={{ width: w, height: 30, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)", fontWeight: 600 }} />
  );

  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold"><Factory size={14} strokeWidth={2.5} aria-hidden />{t("CapEx-Rechner — Amortisation & Rendite")}</h2>
        <Segmented
          ariaLabel={t("Investitionsobjekt")}
          value={mode}
          onChange={(v) => setMode(v as CapexMode)}
          options={[{ value: "pivot", label: t("Pivot-Beregnung") }, { value: "plant", label: t("Lokale Verarbeitung") }]}
        />
      </div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 px-4 py-3">
        <Field label={t("Umfang")} unit={seed.label}>{num(units, setUnits)}</Field>
        <Field label={t("CapEx je Einheit")} unit={seed.uLabel}>{num(unitCapex, setUnitCapex)}</Field>
        <Field label={t("Nutzen p.a.")} unit={seed.bLabel}>{num(benefit, setBenefit)}</Field>
        <Field label={t("Nutzungsdauer")} unit="a">{num(years, setYears, 62)}</Field>
        <Field label={t("Kalkulationszins")} unit="%">{num(rate, setRate, 62, 2)}</Field>
      </div>
      <div className="grid grid-cols-2 gap-px sm:grid-cols-5" style={{ background: "var(--nx-border-divider)", borderTop: "1px solid var(--nx-border)" }}>
        <Tile cap={t("Investition")} val={fmtMoney(Math.round(I * 100), currency)} u={currency === "EUR" ? "€" : "RON"} />
        <Tile cap={t("Nutzen p.a.")} val={fmtMoney(Math.round(B * 100), currency)} u={currency === "EUR" ? "€" : "RON"} />
        <Tile cap={t("Payback statisch")} val={isFinite(payStat) ? fmtNumber(payStat, 1) : "–"} u="a" col={payStat <= years * 0.5 ? "var(--nx-success)" : payStat <= years ? "var(--nx-warning)" : "var(--nx-error)"} />
        <Tile cap={t("Payback dynamisch")} val={isFinite(payDyn) ? fmtNumber(payDyn, 1) : "–"} u="a" col={payDyn <= years ? "var(--nx-success)" : "var(--nx-error)"} />
        <Tile cap={t("NPV / IRR")} val={`${fmtMoney(Math.round(npv * 100), currency)} / ${isFinite(irr) ? fmtPct(irr) : "–"}`} col={npv >= 0 ? "var(--nx-success)" : "var(--nx-error)"} />
      </div>
      <div className="border-t px-4 py-2 caption text-[9.5px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
        {t(seed.note)} · {t("Vorbelegung aus dem Modell: Bewässerung €/ha, Lager/Packhaus €/t, EURIBOR + Zinsschock.")}
      </div>
    </section>
  );
}
function Field({ label, unit, children }: { label: string; unit: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="caption text-[9.5px] font-bold text-nx-text-muted">{label} <span style={{ fontWeight: 400 }}>({unit})</span></span>
      {children}
    </label>
  );
}
