"use client";
import { create } from "zustand";
import type { ComputedModel, ModelState, Granularity } from "../core/types";
import { computeModel } from "../core/engine";
import { aggregateComputed } from "../core/aggregate";
import { SEED, buildModelState, deriveCapex, BASE_SCENARIO_ID, type Domain, type DerivedCapex } from "./model";
import { setFormatLocale } from "../design/format";
import { setLang as i18nSetLang, localeFor, type Lang } from "../lib/i18n";

/** The store holds the DOMAIN (catalog + anbauplan + machineCatalog + assumptions + rest)
 *  and the view state. The engine-ready ModelState and the ComputedModel are DERIVED,
 *  memoised values (composer + engine). Exactly one place composes/computes. */

type View = { scenarioId: string; granularity: Granularity; currency: "EUR" | "RON"; lang: Lang };

export type CloudState = "off" | "load" | "saving" | "saved" | "local" | "error";

type Store = {
  domain: Domain;
  view: View;
  recalcTick: number; // bumps on every domain change → "Neu berechnet" pulse
  cloud: CloudState;  // Auto-Save-Status (Supabase)
  /** Aktueller Bearbeiter (Team-Review) — Login-Mail oder session-lokal, für Autor/Audit. */
  editor: string;
  setEditor: (name: string) => void;
  /** Betrachter-Modus (Reviewer/Investor): Modell schreibgeschützt, Kommentare bleiben erlaubt. */
  readOnly: boolean;
  setReadOnly: (b: boolean) => void;
  /** Kommentar-Mutation — wirkt AUCH im Betrachter-Modus (Reviewer dürfen kommentieren). */
  mutateComments: (mutator: (draft: Domain) => void) => void;
  setCloud: (c: CloudState) => void;
  setScenario: (id: string) => void;
  setGranularity: (g: Granularity) => void;
  setCurrency: (c: "EUR" | "RON") => void;
  setLang: (l: Lang) => void;
  loadDomain: (domain: Domain) => void;
  patch: (mutator: (draft: Domain) => void) => void;
};

export const useModelStore = create<Store>((set) => ({
  domain: SEED,
  view: { scenarioId: BASE_SCENARIO_ID, granularity: "month", currency: "EUR", lang: "de" },
  recalcTick: 0,
  cloud: "off",
  editor: "Benedikt Förtig",
  setEditor: (name) => set({ editor: name || "—" }),
  readOnly: typeof window !== "undefined" && /(^|[#&?])readonly\b/i.test(window.location.hash + window.location.search),
  setReadOnly: (b) => set({ readOnly: b }),
  mutateComments: (mutator) =>
    set((s) => { const next = structuredClone(s.domain); mutator(next); return { domain: next, recalcTick: s.recalcTick + 1 }; }),
  setCloud: (c) => set({ cloud: c }),
  setScenario: (id) => set((s) => ({ view: { ...s.view, scenarioId: id } })),
  setGranularity: (g) => set((s) => ({ view: { ...s.view, granularity: g } })),
  setCurrency: (c) => set((s) => { setFormatLocale(localeFor(s.view.lang), c); return { view: { ...s.view, currency: c } }; }),
  setLang: (l) => set((s) => { i18nSetLang(l); setFormatLocale(localeFor(l), s.view.currency); return { view: { ...s.view, lang: l } }; }),
  // ENTFERNT 31.07.2026: setStage / setScope / setEntityView. Es gibt nur noch eine Stufe,
  //  einen Scope (Wertkulturen) und eine operative Gesellschaft; die drei Setter konnten das
  //  Modell nur beschädigen (Anbauplan auf Cash Crops umbauen, Flächenkurve flachdrücken).
  loadDomain: (domain) => set((s) => ({ domain, recalcTick: s.recalcTick + 1 })),
  patch: (mutator) =>
    set((s) => {
      if (s.readOnly) return {} as Partial<Store>; // Betrachter-Modus: Modell-Änderungen blockiert
      const next = structuredClone(s.domain);
      mutator(next);
      return { domain: next, recalcTick: s.recalcTick + 1 };
    }),
}));

/* ---- memoised derived selectors (engine is pure → cache by signature) ---- */
let _msKey = "", _ms: ModelState | null = null;
export function selectModelState(s: Store): ModelState {
  const key = `${s.recalcTick}|${s.view.scenarioId}`;
  if (key !== _msKey || !_ms) { _ms = buildModelState(s.domain, s.view.scenarioId); _msKey = key; }
  return _ms;
}

// Basis-Rechnung immer auf Modell-Granularität (Monat); Aggregation ist Darstellungssache.
let _cmBaseKey = "", _cmBase: ComputedModel | null = null;
function computedBase(s: Store): ComputedModel {
  const key = `${s.recalcTick}|${s.view.scenarioId}`;
  if (key !== _cmBaseKey || !_cmBase) { _cmBase = computeModel(selectModelState(s), s.view.scenarioId, {}); _cmBaseKey = key; }
  return _cmBase;
}

let _cmKey = "", _cm: ComputedModel | null = null;
export function selectComputed(s: Store): ComputedModel {
  const key = `${s.recalcTick}|${s.view.scenarioId}|${s.view.granularity}`;
  if (key !== _cmKey || !_cm) { _cm = aggregateComputed(computedBase(s), s.view.granularity); _cmKey = key; }
  return _cm;
}

// Monats-Sicht (Basisraster) — unabhängig vom Zeit-Umschalter (Saison-Kurven).
export function selectComputedMonthly(s: Store): ComputedModel {
  return computedBase(s);
}

// Jahres-Sicht — unabhängig vom Zeit-Umschalter (für KPI-Leiste + Dashboard).
let _cmYKey = "", _cmY: ComputedModel | null = null;
export function selectComputedAnnual(s: Store): ComputedModel {
  const key = `${s.recalcTick}|${s.view.scenarioId}`;
  if (key !== _cmYKey || !_cmY) { _cmY = aggregateComputed(computedBase(s), "year"); _cmYKey = key; }
  return _cmY;
}

/** Effektive Domäne nach aktiver Stufe/Scope — DIESELBE Transformation wie im Composer (buildModelState).
 *  Stufe 1 (nur Ackerbau, s1a) entfernt die Wertkultur-Maschinen; Scope „valueOnly" umgekehrt.
 *  Alle Maschinen-/Kultur-Bedarfsansichten leiten hierüber ab → konsistent zur GuV. */
let _sdKey = "", _sd: Domain | null = null;
export function selectScopedDomain(s: Store): Domain {
  const key = `${s.recalcTick}`;
  if (key !== _sdKey || !_sd) { _sd = s.domain; _sdKey = key; }
  return _sd;
}

let _dcKey = "", _dc: DerivedCapex[] | null = null;
export function selectDerivedCapex(s: Store): DerivedCapex[] {
  const key = `${s.recalcTick}|${s.view.scenarioId}`;
  if (key !== _dcKey || !_dc) { _dc = deriveCapex(s.domain, s.view.scenarioId); _dcKey = key; }
  return _dc;
}

/** Headline-KPIs eines BELIEBIGEN Domänen-Stands (für den Versions-Vergleich / KPI-Delta). */
export type HeadlineKpis = { revenue: number; ebitda: number; ebit: number; netIncome: number; fcf: number; roic: number; ebitdaMargin: number; netDebtToEbitda: number; dscr: number; icr: number };
export function computeHeadline(domain: Domain, scenarioId: string): HeadlineKpis {
  const annual = aggregateComputed(computeModel(buildModelState(domain, scenarioId), scenarioId, {}), "year");
  const i = annual.timeline.periodCount - 1;
  const p = annual.pnl, k = annual.kpis;
  const V = (li: { values: number[] }) => li.values[i] ?? 0;
  return {
    revenue: V(p.revenue) + V(p.subsidies), ebitda: V(p.ebitda), ebit: V(p.ebit), netIncome: V(p.netIncome),
    fcf: k.fcf.values[i] ?? 0, roic: k.roic.values[i] ?? 0, ebitdaMargin: k.ebitdaMargin.values[i] ?? 0,
    netDebtToEbitda: k.netDebtToEbitda.values[i] ?? 0, dscr: k.dscr.values[i] ?? 0, icr: k.icr.values[i] ?? 0,
  };
}

/* ---- assumption read/write helpers (constant profile per active scenario) ---- */
export function readAssumption(domain: Domain, key: string, scenarioId: string): number | null {
  const a = domain.assumptions[key];
  if (!a) return null;
  const prof = a.scenarioProfiles[scenarioId] ?? a.scenarioProfiles[SEED.baseScenarioId];
  return prof && prof.kind === "constant" ? (prof as any).value : null;
}
