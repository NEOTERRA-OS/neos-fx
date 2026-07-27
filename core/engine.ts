/**
 * ============================================================================
 *  Investor-Grade Financial Model — Rechenkern (Engine)
 * ----------------------------------------------------------------------------
 *  REINE Funktion: computeModel(state, scenarioId, options) -> ComputedModel.
 *  KEINE React-Imports, KEINE Seiteneffekte, KEIN Zufall, KEIN Date.now().
 *  Gleiche Inputs -> immer gleiche Outputs. Diese Datei ist voll unit-testbar.
 *
 *  Aufbau des Rechenlaufs:
 *    1) Annahmen je Periode auflösen (Szenario-Kette + Zeitprofil)
 *    2) Operatives Modell: Revenue -> COGS -> OpEx -> EBITDA
 *    3) CapEx & Abschreibung, Working-Capital-Bewegung
 *    4) Debt Schedule (feste Tranchen)
 *    5) ITERATIV: Revolver <-> Zins <-> Cash bis Konvergenz
 *    6) Statements schließen (P&L, Bilanz, Cashflow) + Checks
 *
 *  Reifegrad: Struktur & Kernformeln vollständig; einzelne Blöcke sind als
 *  // TODO markiert und liefern konservative Defaults, damit das Modell von
 *  Beginn an SCHLIESST (Bilanz-Check grün) und iterativ verfeinert werden kann.
 * ============================================================================
 */

import type {
  ModelState,
  Scenario,
  Assumption,
  TimeProfile,
  ComputedModel,
  ComputeOptions,
  LineItem,
  CheckResult,
  Granularity,
  UUID,
  PeriodIndex,
  CropPlan,
  FinancingContract,
  FinancingSchedule,
  FinancingScheduleRow,
  ValuationOptions,
  ValuationResult,
  ExitScenario,
  SensitivityDriver,
  SensitivityMetric,
  TornadoResult,
  TornadoBar,
} from './types';

/* --------------------------------------------------------------------------
 * Hilfen
 * ------------------------------------------------------------------------ */

const round = (x: number): number => Math.round(x);
const zeros = (n: number): number[] => new Array(n).fill(0);
const addArr = (a: number[], b: number[]): number[] => a.map((v, i) => v + b[i]);
const subArr = (a: number[], b: number[]): number[] => a.map((v, i) => v - b[i]);
const scaleArr = (a: number[], k: number): number[] => a.map((v) => v * k);

function periodsPerYear(g: Granularity): number {
  return g === 'month' ? 12 : g === 'quarter' ? 4 : 1;
}

function makeLine(
  key: string,
  label: string,
  unit: LineItem['unit'],
  values: number[],
  precedents: string[] = [],
  formula?: string,
): LineItem {
  return { key, label, unit, values, precedents, formula };
}

/* --------------------------------------------------------------------------
 * Szenario-Auflösung: Kette base -> ... -> aktiv
 * ------------------------------------------------------------------------ */

function scenarioChain(state: ModelState, scenarioId: UUID): UUID[] {
  const byId = new Map(state.scenarios.map((s) => [s.id, s]));
  const chain: UUID[] = [];
  let cur: Scenario | undefined = byId.get(scenarioId);
  const guard = new Set<UUID>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.push(cur.id);
    cur = cur.inheritsFrom ? byId.get(cur.inheritsFrom) : undefined;
  }
  if (!chain.includes(state.baseScenarioId)) chain.push(state.baseScenarioId);
  return chain; // spezifischstes zuerst
}

/* --------------------------------------------------------------------------
 * Zeitprofil -> Wert je Periode
 * ------------------------------------------------------------------------ */

function expandProfile(profile: TimeProfile, n: number, ppy: number): number[] {
  switch (profile.kind) {
    case 'constant':
      return new Array(n).fill(profile.value);
    case 'growth': {
      // annualRate geometrisch, auf Basisperiode heruntergebrochen
      const perPeriod = Math.pow(1 + profile.annualRate, 1 / ppy) - 1;
      return Array.from({ length: n }, (_, i) => profile.base * Math.pow(1 + perPeriod, i));
    }
    case 'ramp':
      return Array.from({ length: n }, (_, i) => {
        if (i >= profile.overPeriods) return profile.to;
        const t = profile.overPeriods === 0 ? 1 : i / profile.overPeriods;
        return profile.from + (profile.to - profile.from) * t;
      });
    case 'curve':
      return Array.from({ length: n }, (_, i) => profile.values[i] ?? profile.values.at(-1) ?? 0);
    case 'seasonal': {
      const w = profile.weights;
      return Array.from({ length: n }, (_, i) => profile.annual * (w[i % w.length] ?? 0));
    }
  }
}

/**
 * Löst eine Annahme für das aktive Szenario je Periode auf.
 * Fällt der spezifischste Fall aus, wird die Szenario-Kette hinab aufgelöst.
 */
function resolveAssumption(
  state: ModelState,
  key: string,
  chain: UUID[],
  n: number,
  ppy: number,
): number[] {
  const a: Assumption | undefined = state.assumptions[key];
  if (!a) return zeros(n); // fehlende Annahme -> 0 (Check-Panel flaggt separat)
  for (const sid of chain) {
    const prof = a.scenarioProfiles[sid];
    if (prof) return expandProfile(prof, n, ppy);
  }
  return zeros(n);
}

/* --------------------------------------------------------------------------
 * AgTech-Revenue: Kultur × Fläche × Ertrag × Preis × (1 − Verlust)
 * ------------------------------------------------------------------------ */

function maturityFactor(state: ModelState, plan: CropPlan, period: PeriodIndex, ppy: number): number {
  const crop = state.crops.find((c) => c.id === plan.cropId);
  if (!crop || crop.type === 'annual') return 1;
  const yearsSincePlanting = Math.floor((period - plan.plantingPeriod) / ppy);
  if (yearsSincePlanting < 0) return 0;
  const curve = crop.maturityCurve ?? [];
  return curve[yearsSincePlanting] ?? curve.at(-1) ?? 1;
}

const COST_TYPES: import('./types').CostType[] = [
  'seed', 'fertilizer', 'crop_protection', 'machine', 'labor', 'fuel', 'other',
];

function emptyByType(n: number): Record<import('./types').CostType, number[]> {
  const o = {} as Record<import('./types').CostType, number[]>;
  for (const t of COST_TYPES) o[t] = zeros(n);
  return o;
}

/**
 * Kosten je ha und Periode für einen Anbauplan — bottom-up aus operations,
 * sonst Fallback (Summe variableCostKeysPerHa als Punktlast in plantingPeriod).
 * Liefert Gesamt-€/ha je Periode UND den Aufriss nach Kostenart.
 */
function cropCostPerHa(
  plan: CropPlan,
  state: ModelState,
  chain: UUID[],
  n: number,
  ppy: number,
): { perPeriodPerHa: number[]; byTypePerHa: Record<import('./types').CostType, number[]> } {
  const perPeriodPerHa = zeros(n);
  const byTypePerHa = emptyByType(n);

  if (plan.operations && plan.operations.length > 0) {
    for (const op of plan.operations) {
      for (const line of op.lines) {
        const unitCost = resolveAssumption(state, line.unitCostKey, chain, n, ppy);
        for (const p of op.costPeriods) {
          if (p < 0 || p >= n) continue;
          const c = line.quantityPerHa * unitCost[p]; // €/ha
          perPeriodPerHa[p] += c;
          byTypePerHa[line.costType][p] += c;
        }
      }
    }
    return { perPeriodPerHa, byTypePerHa };
  }

  // Fallback: pauschale Kostenkeys als Punktlast in der Pflanzperiode
  const cp = plan.plantingPeriod;
  if (cp >= 0 && cp < n) {
    const sum = plan.variableCostKeysPerHa.reduce(
      (acc, k) => acc + resolveAssumption(state, k, chain, n, ppy)[cp],
      0,
    );
    perPeriodPerHa[cp] += sum;
    byTypePerHa.other[cp] += sum;
  }
  return { perPeriodPerHa, byTypePerHa };
}

/**
 * Kostenaufriss nach Kostenart über alle Anbaupläne (L4).
 * Reine Funktion — für Controlling-Sicht (Master §10 Kostenarten-Split) und
 * als Grundlage der Kostentreiber-Sensitivität.
 */
export function computeCostBreakdown(
  state: ModelState,
  scenarioId: UUID,
): import('./types').CostBreakdown {
  const n = state.timeline.periodCount;
  const ppy = periodsPerYear(state.timeline.baseGranularity);
  const chain = scenarioChain(state, scenarioId);

  const total = zeros(n);
  const byType = emptyByType(n);
  for (const plan of state.cropPlans) {
    const { byTypePerHa } = cropCostPerHa(plan, state, chain, n, ppy);
    for (const t of COST_TYPES) {
      for (let p = 0; p < n; p++) {
        const v = byTypePerHa[t][p] * plan.areaHa;
        byType[t][p] += v;
        total[p] += v;
      }
    }
  }

  const grand = total.reduce((a, b) => a + b, 0);
  const shareByType = {} as Record<import('./types').CostType, number>;
  for (const t of COST_TYPES) {
    shareByType[t] = grand !== 0 ? byType[t].reduce((a, b) => a + b, 0) / grand : 0;
  }
  return { total, byType, shareByType };
}

/* --------------------------------------------------------------------------
 * Working Capital (L3) — Vorräte, Forderungen, Verbindlichkeiten aus
 * DSO/DPO/Lagertagen. Treibt den saisonalen Cash-Swing (größter Cash-Treiber
 * bei AgTech). ΔNWC speist den operativen Cashflow.
 * ------------------------------------------------------------------------ */

export interface WorkingCapitalResult {
  receivables: number[];
  inventory: number[];
  payables: number[];
  nwc: number[];         // Netto-Umlaufvermögen = Vorräte + Forderungen − Verbindl.
  wcChange: number[];    // ΔNWC je Periode (Cash-Bindung, wenn positiv)
}

function computeWorkingCapital(
  state: ModelState,
  chain: UUID[],
  n: number,
  ppy: number,
  revenue: number[],
  cogs: number[],
): WorkingCapitalResult {
  const wc = state.workingCapital;
  const dso = resolveAssumption(state, wc.dsoAssumptionKey, chain, n, ppy);
  const dpo = resolveAssumption(state, wc.dpoAssumptionKey, chain, n, ppy);
  const invDays = resolveAssumption(state, wc.inventoryDaysAssumptionKey, chain, n, ppy);

  const receivables = zeros(n);
  const inventory = zeros(n);
  const payables = zeros(n);
  const nwc = zeros(n);
  const wcChange = zeros(n);

  // Tage -> Periodenanteil: annualisierter Fluss × Tage/365.
  const ob = state.openingBalance;
  const openingNwc = (ob?.inventory ?? 0) + (ob?.receivables ?? 0) - (ob?.payables ?? 0);

  for (let p = 0; p < n; p++) {
    const annualRev = revenue[p] * ppy;
    const annualCogs = cogs[p] * ppy;
    receivables[p] = (annualRev * dso[p]) / 365;
    payables[p] = (annualCogs * dpo[p]) / 365;
    inventory[p] = (annualCogs * invDays[p]) / 365;
    nwc[p] = inventory[p] + receivables[p] - payables[p];
    wcChange[p] = nwc[p] - (p === 0 ? openingNwc : nwc[p - 1]);
  }
  return { receivables, inventory, payables, nwc, wcChange };
}

/** Standalone-Sicht fürs 13-Wochen-/Saison-Cash-Modul. */
export function computeWorkingCapitalSchedule(
  state: ModelState,
  scenarioId: UUID,
): WorkingCapitalResult {
  const n = state.timeline.periodCount;
  const ppy = periodsPerYear(state.timeline.baseGranularity);
  const chain = scenarioChain(state, scenarioId);
  const op = computeOperating(state, chain, n, ppy);
  return computeWorkingCapital(state, chain, n, ppy, op.revenue, op.cogs);
}

/**
 * Personalplanung nach RO-Standard (L7). Reine Funktion.
 * Arbeitnehmer: CAS + CASS vom Brutto; Impozit 10 % auf (Brutto − CAS − CASS
 * − Personenfreibetrag). Arbeitgeber: CAM auf Brutto. Gesamter AG-Aufwand =
 * Brutto + CAM (fließt in computeModel in die OpEx als Personalüberkopf).
 */
export function computePersonnel(
  state: ModelState,
  scenarioId: UUID,
): import('./types').PersonnelResult {
  const n = state.timeline.periodCount;
  const ppy = periodsPerYear(state.timeline.baseGranularity);
  const chain = scenarioChain(state, scenarioId);
  const plan = state.personnel;

  const gross = zeros(n);
  const employeeCas = zeros(n);
  const employeeCass = zeros(n);
  const incomeTax = zeros(n);
  const net = zeros(n);
  const employerCam = zeros(n);
  const totalEmployerCost = zeros(n);
  const headcount = zeros(n);

  const line = (key: string, label: string, values: number[]) =>
    makeLine(key, label, 'money', values);

  if (!plan) {
    return {
      gross: line('hr.gross', 'Bruttolohnsumme', gross),
      employeeCas: line('hr.cas', 'CAS (AN)', employeeCas),
      employeeCass: line('hr.cass', 'CASS (AN)', employeeCass),
      incomeTax: line('hr.tax', 'Lohnsteuer (AN)', incomeTax),
      net: line('hr.net', 'Nettolohn', net),
      employerCam: line('hr.cam', 'CAM (AG)', employerCam),
      totalEmployerCost: line('hr.total', 'Personalaufwand (AG gesamt)', totalEmployerCost),
      headcount: makeLine('hr.headcount', 'FTE', 'count', headcount),
    };
  }

  const r = plan.rates;
  const pd = r.personalDeductionMonthly ?? 0;
  const monthsPerPeriod = plan.monthsPerPeriodOverride ?? 12 / ppy;

  for (const role of plan.roles) {
    const fte = resolveAssumption(state, role.headcountKey, chain, n, ppy);
    const grossMonthly = resolveAssumption(state, role.grossMonthlyKey, chain, n, ppy);
    for (let p = 0; p < n; p++) {
      const heads = fte[p];
      const gm = grossMonthly[p];                 // Brutto je FTE und Monat
      // Beiträge werden monatlich gerechnet (Freibetrag ist monatlich):
      const cas = gm * r.cas;
      const cass = gm * r.cass;
      const taxable = Math.max(0, gm - cas - cass - pd);
      const tax = taxable * r.incomeTax;
      const netMonthly = gm - cas - cass - tax;
      const cam = gm * r.cam;
      const scale = heads * monthsPerPeriod;

      gross[p] += gm * scale;
      employeeCas[p] += cas * scale;
      employeeCass[p] += cass * scale;
      incomeTax[p] += tax * scale;
      net[p] += netMonthly * scale;
      employerCam[p] += cam * scale;
      totalEmployerCost[p] += (gm + cam) * scale;
      headcount[p] += heads;
    }
  }

  return {
    gross: line('hr.gross', 'Bruttolohnsumme', gross),
    employeeCas: line('hr.cas', 'CAS (AN, 25 %)', employeeCas),
    employeeCass: line('hr.cass', 'CASS (AN, 10 %)', employeeCass),
    incomeTax: line('hr.tax', 'Lohnsteuer (AN, 10 %)', incomeTax),
    net: line('hr.net', 'Nettolohn', net),
    employerCam: line('hr.cam', 'CAM (AG, 2,25 %)', employerCam),
    totalEmployerCost: line('hr.total', 'Personalaufwand (AG gesamt)', totalEmployerCost),
    headcount: makeLine('hr.headcount', 'FTE', 'count', headcount),
  };
}

/* --------------------------------------------------------------------------
 * Holding-Struktur (L8) — GESONDERT gerechnet, danach konsolidiert.
 * Eigene Kostenbasis, eigene Steuer-Jurisdiktion, eigene Finanzierung. Ändert
 * das OpCo-Modell NICHT (Trennung der Ebenen).
 * ------------------------------------------------------------------------ */

export function computeHolding(
  state: ModelState,
  scenarioId: UUID,
): import('./types').HoldingResult {
  const n = state.timeline.periodCount;
  const ppy = periodsPerYear(state.timeline.baseGranularity);
  const chain = scenarioChain(state, scenarioId);
  const plan = state.holding;
  const L = (key: string, label: string, values: number[]) => makeLine(key, label, 'money', values);

  const operatingCosts = zeros(n);
  const personnelCost = zeros(n);
  const financingInterest = zeros(n);
  const managementFeeIncome = zeros(n);

  if (plan) {
    for (const item of plan.costItems) {
      if (item.monthlyCent != null) { for (let p = 0; p < n; p++) operatingCosts[p] += item.monthlyCent; continue; }
      if (!item.assumptionKey) continue;
      const v = resolveAssumption(state, item.assumptionKey, chain, n, ppy);
      for (let p = 0; p < n; p++) operatingCosts[p] += v[p];
    }
    // Holding-Personal (eigene Jurisdiktion/Sätze) via Shallow-Clone
    if (plan.personnel) {
      const hp = computePersonnel({ ...state, personnel: plan.personnel }, scenarioId);
      for (let p = 0; p < n; p++) personnelCost[p] += hp.totalEmployerCost.values[p];
    }
    // Holding-Finanzierung (eigene Tranchen) via Shallow-Clone
    if (plan.debt && plan.debt.length > 0) {
      const hd = computeDebtSchedule({ ...state, debt: plan.debt }, chain, n, ppy);
      for (let p = 0; p < n; p++) financingInterest[p] += hd.interest[p];
    }
    if (plan.managementFeeKey) {
      const mf = resolveAssumption(state, plan.managementFeeKey, chain, n, ppy);
      for (let p = 0; p < n; p++) managementFeeIncome[p] += mf[p];
    }
  }

  const pbt = managementFeeIncome.map((mf, i) => mf - operatingCosts[i] - personnelCost[i] - financingInterest[i]);
  const taxRate = plan
    ? resolveAssumption(state, plan.taxRateKey, chain, n, ppy)
    : zeros(n);
  const tax = pbt.map((v, i) => (v > 0 ? v * taxRate[i] : 0));
  const netIncome = subArr(pbt, tax);
  // Netto-Cash-Belastung der Holding-Ebene (vor Dividenden von der OpCo):
  const totalCashCost = operatingCosts.map(
    (oc, i) => oc + personnelCost[i] + financingInterest[i] + tax[i] - managementFeeIncome[i],
  );

  return {
    operatingCosts: L('hold.opcost', 'Holding-Betriebskosten', operatingCosts),
    personnelCost: L('hold.personnel', 'Holding-Personal', personnelCost),
    financingInterest: L('hold.interest', 'Holding-Zins', financingInterest),
    managementFeeIncome: L('hold.mgmtfee', 'Management-Fee (IC-Ertrag)', managementFeeIncome),
    pbt: L('hold.pbt', 'Holding-Ergebnis v. St.', pbt),
    tax: L('hold.tax', 'Holding-Steuer', tax),
    netIncome: L('hold.ni', 'Holding-Jahresergebnis', netIncome),
    totalCashCost: L('hold.cashcost', 'Holding Netto-Cash-Belastung', totalCashCost),
  };
}

/**
 * Konzern-Konsolidierung: OpCo + Holding. Die Management-Fee ist ein interner
 * Transfer und wird eliminiert (nur Holding-Überkopf mindert das Konzern-EBITDA).
 * Keine Steuergruppe: Konzernsteuer = Σ der Einzelsteuern.
 */
export function consolidateGroup(
  opco: ComputedModel,
  holding: import('./types').HoldingResult,
): import('./types').GroupResult {
  const n = opco.timeline.periodCount;
  const L = (key: string, label: string, values: number[]) => makeLine(key, label, 'money', values);
  const holdingOverhead = holding.operatingCosts.values.map(
    (oc, i) => oc + holding.personnelCost.values[i],
  );
  const ebitda = opco.pnl.ebitda.values.map((e, i) => e - holdingOverhead[i]);
  const ebit = ebitda.map((e, i) => e - opco.pnl.depreciation.values[i]);
  const tax = opco.pnl.tax.values.map((t, i) => t + holding.tax.values[i]);
  // Konzern-NI: OpCo-NI + Holding-Beitrag OHNE IC-Fee (eliminiert)
  const netIncome = opco.pnl.netIncome.values.map(
    (ni, i) => ni - holding.operatingCosts.values[i] - holding.personnelCost.values[i]
      - holding.financingInterest.values[i] - holding.tax.values[i],
  );
  return {
    ebitda: L('grp.ebitda', 'Konzern-EBITDA', ebitda),
    ebit: L('grp.ebit', 'Konzern-EBIT', ebit),
    netIncome: L('grp.ni', 'Konzern-Jahresergebnis', netIncome),
    tax: L('grp.tax', 'Konzernsteuer (Σ)', tax),
    holdingCostShare: L('grp.holdcost', 'Holding-Kostenanteil', holdingOverhead),
  };
}

interface OperatingResult {
  revenue: number[];
  cogs: number[];
  subsidies: number[];
  inventoryValue: number[]; // Ende-Bestand geernteter, noch nicht verkaufter Ware
  outputVat: number[];      // Ausgangs-USt (TVA colectată) je Periode — 0 bei Reverse-Charge/Export
}

function computeOperating(
  state: ModelState,
  chain: UUID[],
  n: number,
  ppy: number,
): OperatingResult {
  const revenue = zeros(n);
  const cogs = zeros(n);
  const subsidies = zeros(n);
  const inventoryValue = zeros(n);
  const outputVat = zeros(n);
  const vat = state.vat;
  const outRate = (cropId: string): number => {
    if (!vat || !vat.enabled) return 0;
    const t = vat.outputByCrop?.[cropId] ?? 'standard';
    return t === 'standard' ? vat.standardRate : t === 'reduced' ? vat.reducedRate : 0; // reverse_charge/export/zero → 0
  };

  for (const plan of state.cropPlans) {
    const yieldTHa = resolveAssumption(state, plan.yieldAssumptionKey, chain, n, ppy);
    const priceEurT = resolveAssumption(state, plan.priceAssumptionKey, chain, n, ppy);
    const lossRate = plan.lossRateAssumptionKey
      ? resolveAssumption(state, plan.lossRateAssumptionKey, chain, n, ppy)
      : zeros(n);
    const qualFactor = plan.qualityAssumptionKey
      ? resolveAssumption(state, plan.qualityAssumptionKey, chain, n, ppy)
      : null;

    for (const p of plan.harvestPeriods) {
      if (p < 0 || p >= n) continue;
      const mf = maturityFactor(state, plan, p, ppy);
      const effYield = yieldTHa[p] * mf * plan.areaHa;              // t
      const netTonnes = effYield * (1 - lossRate[p]);
      // Kontrakt-Qualitätserfüllung: realisierter Preis nach Bonus/Malus × akzeptierte Menge (0..1).
      const qual = qualFactor ? (qualFactor[p] > 0 ? qualFactor[p] : 1) : 1;
      const rev = round(netTonnes * priceEurT[p] * qual);          // €/t in Minor-Units
      revenue[p] += rev;
      outputVat[p] += round(rev * outRate(plan.cropId));           // Ausgangs-USt (0 bei Reverse-Charge)
    }

    // Zweitfrucht (Doppelfruchtsystem): zusätzlicher Umsatz + Inputkosten auf gleicher Fläche.
    if (plan.secondCrop) {
      const s2 = plan.secondCrop;
      const y2 = resolveAssumption(state, s2.yieldAssumptionKey, chain, n, ppy);
      const p2 = resolveAssumption(state, s2.priceAssumptionKey, chain, n, ppy);
      const l2 = s2.lossRateAssumptionKey ? resolveAssumption(state, s2.lossRateAssumptionKey, chain, n, ppy) : null;
      const hp = s2.harvestPeriod;
      if (hp >= 0 && hp < n) {
        const netT = y2[hp] * plan.areaHa * (1 - (l2 ? l2[hp] : 0));   // t
        const rev2 = round(netT * p2[hp]);
        revenue[hp] += rev2;
        outputVat[hp] += round(rev2 * outRate(plan.cropId));
        cogs[hp] += round(s2.extraCostPerHaCent * plan.areaHa);         // Zweitfrucht-Betriebsmittel
      }
    }

    // Produktionskosten: bottom-up (operations) oder Fallback (Punktlast).
    const { perPeriodPerHa } = cropCostPerHa(plan, state, chain, n, ppy);
    for (let p = 0; p < n; p++) cogs[p] += round(perPeriodPerHa[p] * plan.areaHa);
  }

  // Subventionen (GAP/CAP etc.) — Inline-Satz > Assumption; Anspruchs-Cap (CRISS erste N ha);
  // Auszahlungsprofil (Vorschuss/Rest) verteilt den Jahresbetrag anteilig auf Perioden (Cashflow-Timing).
  for (const s of state.subsidies) {
    if (s.active === false) continue;
    const amount = s.ratePerHaCent != null
      ? new Array(n).fill(s.ratePerHaCent)
      : (s.amountAssumptionKey ? resolveAssumption(state, s.amountAssumptionKey, chain, n, ppy) : new Array(n).fill(0));
    const eligibleParcels = s.parcelIds
      ? state.parcels.filter((pc) => s.parcelIds!.includes(pc.id))
      : state.parcels;
    let totalHa = eligibleParcels.reduce((sum, pc) => sum + pc.areaHa, 0);
    if (s.firstHaCap != null && s.firstHaCap > 0) totalHa = Math.min(totalHa, s.firstHaCap);
    const profile = (s.payout && s.payout.length)
      ? s.payout
      : s.receiptPeriods.map((p) => ({ period: p, share: 1 / Math.max(1, s.receiptPeriods.length) }));
    for (const { period, share } of profile) {
      if (period < 0 || period >= n) continue;
      const full = s.basis === 'per_ha'
        ? amount[period] * totalHa
        : (s.lumpSumCent != null ? s.lumpSumCent : amount[period]);
      subsidies[period] += round(full * share);
    }
  }

  // TODO: Vorratsbewertung Ernte-auf-Lager (saisonaler WC-Swing) — hier 0-Default
  return { revenue, cogs, subsidies, inventoryValue, outputVat };
}

/* --------------------------------------------------------------------------
 * USt / TVA (RO) — Ausgangs-/Vorsteuer, CAPEX-Erstattung, Reverse-Charge,
 * Zahllast-/Erstattungs-Timing. USt ist durchlaufend (P&L netto); Wirkung nur
 * über ein Verrechnungskonto (Forderung/Verbindlichkeit) + Cash-Timing.
 * ------------------------------------------------------------------------ */
interface VatResult {
  outputVat: number[];       // Ausgangs-USt (colectată)
  inputVat: number[];        // Vorsteuer gesamt (deductibilă): OpEx/COGS + CAPEX
  inputVatCapex: number[];   // davon aus CAPEX (rambursare-treibend)
  accrual: number[];         // Zahllast(+)/Erstattung(−) je Periode = output − input
  settled: number[];         // Cash-Abführung(+)/Erstattung(−) an/vom Staat (mit Lag)
  vatCashFlow: number[];     // Netto-Cash-Wirkung je Periode = accrual − settled
  netUnsettled: number[];    // Saldo Verrechnungskonto (>0 Verbindlichkeit, <0 Forderung)
  vatReceivable: number[];   // Bilanz-Aktivum (max(0,−netUnsettled))
  vatPayable: number[];      // Bilanz-Passivum (max(0, netUnsettled))
}

function computeVat(
  state: ModelState,
  n: number,
  ppy: number,
  outputVat: number[],
  cogs: number[],
  opex: number[],
  capexOut: number[],
): VatResult {
  const v = state.vat;
  const empty = (): VatResult => ({
    outputVat: zeros(n), inputVat: zeros(n), inputVatCapex: zeros(n), accrual: zeros(n),
    settled: zeros(n), vatCashFlow: zeros(n), netUnsettled: zeros(n), vatReceivable: zeros(n), vatPayable: zeros(n),
  });
  if (!v || !v.enabled) return empty();

  const inputVatCapex = capexOut.map((c) => round(c * v.inputRateCapex));
  const inputVatCost = cogs.map((c, i) =>
    round(c * v.recoverableCogsShare * v.inputRateCost + opex[i] * v.recoverableOpexShare * v.inputRateCost));
  const inputVat = addArr(inputVatCapex, inputVatCost);
  const accrual = subArr(outputVat, inputVat);          // >0 Zahllast, <0 Vorsteuer-Überhang

  // Abführung/Erstattung mit Lag: Zahllast nach settlementLag, Erstattung nach refundLag.
  const monthsPerPeriod = 12 / ppy;
  const setLag = Math.max(0, Math.round(v.settlementLagMonths / monthsPerPeriod));
  const refLag = Math.max(0, Math.round(v.refundLagMonths / monthsPerPeriod));
  const settled = zeros(n);
  for (let p = 0; p < n; p++) {
    const a = accrual[p];
    const lag = a >= 0 ? setLag : refLag;
    const t = p + lag;
    if (t < n) settled[t] += a;                          // Cash: +Zahllast (out) / −Erstattung (in)
  }

  const vatCashFlow = subArr(accrual, settled);          // in-Periode brutto − Settlement
  const netUnsettled = zeros(n);
  let cum = 0;
  for (let p = 0; p < n; p++) { cum += vatCashFlow[p]; netUnsettled[p] = cum; }
  const vatReceivable = netUnsettled.map((x) => (x < 0 ? -x : 0));
  const vatPayable = netUnsettled.map((x) => (x > 0 ? x : 0));

  return { outputVat, inputVat, inputVatCapex, accrual, settled, vatCashFlow, netUnsettled, vatReceivable, vatPayable };
}

/* --------------------------------------------------------------------------
 * CapEx & Abschreibung (linear, Land nicht abgeschrieben)
 * ------------------------------------------------------------------------ */

function computeCapexDepreciation(state: ModelState, n: number, ppy: number) {
  const capexOut = zeros(n);
  // Vorsteuer-Bemessung: OHNE Land (RO Art. 292 regelmäßig befreit/Reverse-Charge), OHNE
  //  IFRS-16-ROU (non-cash, keine Eingangsrechnung) und OHNE Pacht-Ablösen (Entschädigung).
  const capexVatable = zeros(n);
  const depCommercial = zeros(n); // bilanziell -> P&L / PPE-Buchwert
  const depFiscal = zeros(n);     // steuerlich -> Bemessungsgrundlage
  const landAdditions = zeros(n);
  // Ausmusterung (Disposal): Restbuchwert-Abgang aus PPE, Verkaufserlös als Cash, Buchgewinn/-verlust.
  const disposalBook = zeros(n);        // bilanzieller Restbuchwert-Abgang (PPE −)
  const disposalBookFiscal = zeros(n);  // steuerlicher Restbuchwert (für Steuer-Ergebnis)
  const disposalProceeds = zeros(n);    // Verkaufserlös (Cash +)

  // Nutzungsdauern sind in MONATEN definiert; auf Modellperioden umrechnen.
  const toPeriods = (months: number) => Math.max(1, Math.round((months / 12) * ppy));

  // AfA über die Nutzungsdauer, aber gestoppt bei Ausmusterung (dispP). Gibt die
  // Anzahl abgeschriebener Perioden zurück (für den Restbuchwert am Abgang).
  const spreadCapped = (
    target: number[], amount: number, start: PeriodIndex, lifeMonths: number, dispP: number,
  ): number => {
    const lifePeriods = toPeriods(lifeMonths);
    const perPeriod = amount / lifePeriods;
    const applied = Math.max(0, Math.min(lifePeriods, dispP - start));
    for (let i = 0; i < applied; i++) {
      const p = start + i;
      if (p >= 0 && p < n) target[p] += perPeriod;
    }
    return perPeriod * applied; // Σ AfA bis zum Abgang
  };

  for (const item of state.capex) {
    if (item.purchasePeriod >= 0 && item.purchasePeriod < n) {
      capexOut[item.purchasePeriod] += item.amount;
      if (item.assetClass === 'land') landAdditions[item.purchasePeriod] += item.amount;
      const noVat = item.assetClass === 'land' || item.id.startsWith('cx-rou') || item.id.startsWith('cx-farm-lease');
      if (!noVat) capexVatable[item.purchasePeriod] += item.amount;
    }
    if (item.assetClass === 'land' || item.usefulLifeMonths <= 0) continue;
    const depreciable = item.amount - (item.salvageValue ?? 0);
    const dispP = item.disposalPeriod != null && item.disposalPeriod < n && item.disposalPeriod > item.purchasePeriod
      ? item.disposalPeriod : n;
    const fiscalLife = item.usefulLifeFiscalMonths ?? item.usefulLifeMonths;
    const depAppliedC = spreadCapped(depCommercial, depreciable, item.purchasePeriod, item.usefulLifeMonths, dispP);
    const depAppliedF = spreadCapped(depFiscal, depreciable, item.purchasePeriod, fiscalLife, dispP);
    if (item.disposalPeriod != null && item.disposalPeriod < n && item.disposalPeriod > item.purchasePeriod) {
      const p = item.disposalPeriod;
      const bookC = item.amount - depAppliedC;   // Restbuchwert bilanziell
      const bookF = item.amount - depAppliedF;   // Restbuchwert steuerlich
      disposalBook[p] += bookC;
      disposalBookFiscal[p] += bookF;
      disposalProceeds[p] += item.disposalProceedsCent ?? 0;
    }
  }
  return { capexOut, capexVatable, depCommercial, depFiscal, landAdditions, disposalBook, disposalBookFiscal, disposalProceeds };
}

/* --------------------------------------------------------------------------
 * Debt Schedule (feste Tranchen) — Tilgung & Zins
 * ------------------------------------------------------------------------ */

function startMonth(state: ModelState): number {
  // 1–12 aus ISO-Startdatum "YYYY-MM-..." (ohne Date.now(), resume-sicher).
  const m = parseInt(state.timeline.startDate.slice(5, 7), 10);
  return isFinite(m) && m >= 1 && m <= 12 ? m : 1;
}

function computeDebtSchedule(state: ModelState, chain: UUID[], n: number, ppy: number) {
  const drawdowns = zeros(n);
  const repayments = zeros(n);
  const balloon = zeros(n);
  const avansOut = zeros(n); // informativ; Cash entsteht als capexOut − drawdown
  const interest = zeros(n);
  const balance = zeros(n);

  const sm = startMonth(state);
  const monthOf = (p: number) => ((sm - 1 + p) % 12) + 1;

  for (const t of state.debt) {
    const refRate = t.referenceRateKey
      ? resolveAssumption(state, t.referenceRateKey, chain, n, ppy)
      : zeros(n);
    const annualRate = (p: number) =>
      t.rateBasis === 'fixed' ? (t.fixedRate ?? 0) : refRate[p] + (t.floatingSpread ?? 0);

    const price = t.principal;
    const avans = price * (t.avansRate ?? 0);
    const residual = price * (t.residualRate ?? 0);
    const financed = price - avans;

    // Zahlungen/Jahr auf dem Modellraster: bei Jahresmodell (ppy=1) genau 1.
    const freq = t.frequency ?? 'monthly';
    const rawPayPerYear =
      freq === 'monthly' ? 12 : freq === 'quarterly' ? 4 : (t.seasonMonths?.length ?? 5);
    const payPerYear = Math.max(1, Math.min(rawPayPerYear, ppy));
    const interval = Math.max(1, Math.round(ppy / payPerYear)); // Modellperioden je Rate
    const nPay = Math.max(1, Math.round((t.termMonths / 12) * payPerYear));
    const r = annualRate(t.drawPeriod) / payPerYear; // Periodenzins je Rate (fix genähert)

    const disc = Math.pow(1 + r, -nPay);
    const pmt =
      r > 0 ? (financed - residual * disc) * r / (1 - disc) : (financed - residual) / nPay;
    const linPrin = (financed - residual) / nPay;

    let outstanding = 0;
    let paymentsMade = 0;
    const isDue = (p: number): boolean => {
      const offset = p - t.drawPeriod;
      if (offset <= 0) return false; // erste Rate eine Periode nach Ziehung
      if (freq === 'seasonal' && ppy >= 12) return (t.seasonMonths ?? []).includes(monthOf(p));
      return offset % interval === 0;
    };

    for (let p = 0; p < n; p++) {
      if (p === t.drawPeriod) {
        outstanding = financed;
        drawdowns[p] += financed;
        avansOut[p] += avans;
      }
      if (isDue(p) && paymentsMade < nPay && outstanding > residual + 1e-6) {
        const zins = outstanding * r;
        let tilg: number;
        if (t.repayment === 'linear') tilg = linPrin;
        else if (t.repayment === 'bullet') tilg = paymentsMade === nPay - 1 ? outstanding - residual : 0;
        else tilg = pmt - zins; // annuity
        tilg = Math.min(Math.max(0, tilg), outstanding - residual);
        interest[p] += zins;
        repayments[p] += tilg;
        outstanding -= tilg;
        paymentsMade++;
        if (paymentsMade === nPay) {
          // Restwert-Ballon fällig -> Restschuld auf 0
          balloon[p] += outstanding;
          outstanding = 0;
        }
      }
      balance[p] += outstanding;
    }
  }
  return { drawdowns, repayments, balloon, avansOut, interest, balance };
}

/**
 * Eigenständiger Ratenplan-Rechner (Functional Brief Financing/Leasing §4).
 * Reine Kalkulation eines einzelnen Vertrags; unabhängig vom 3-Statement-Kern.
 * extraRate: Aufschlag für den Zinsschock-Stresstest (§6).
 */
export function computeFinancingSchedule(
  c: FinancingContract,
  extraRate = 0,
): FinancingSchedule {
  const avans = c.price * c.avansRate;
  const residual = c.price * c.residualRate;
  const financed = c.price - avans;
  const annualRate = c.indexRate + c.marginRate + extraRate;
  const perYr =
    c.frequency === 'monthly' ? 12 : c.frequency === 'quarterly' ? 4 : (c.seasonMonths?.length ?? 5);
  const nPay = Math.max(1, Math.round((c.termMonths / 12) * perYr));
  const r = annualRate / perYr;
  const disc = Math.pow(1 + r, -nPay);
  const pmt = r > 0 ? (financed - residual * disc) * r / (1 - disc) : (financed - residual) / nPay;
  const linPrin = (financed - residual) / nPay;

  let bal = financed;
  let totalInterest = 0;
  const rows: FinancingScheduleRow[] = [];
  for (let i = 1; i <= nPay; i++) {
    const interest = bal * r;
    let payment: number;
    let principal: number;
    if (c.method === 'linear') {
      principal = linPrin;
      payment = principal + interest;
    } else {
      payment = pmt;
      principal = pmt - interest;
    }
    bal = Math.max(residual, bal - principal);
    totalInterest += interest;
    rows.push({ period: i, payment, interest, principal, balance: bal });
  }
  const totalPaid = rows.reduce((a, x) => a + x.payment, 0) + avans + residual;
  return {
    avans,
    residual,
    financedPrincipal: financed,
    annualRate,
    paymentsPerYear: perYr,
    numPayments: nPay,
    payment: c.method === 'linear' ? rows[0].payment : pmt,
    rows,
    totalInterest,
    totalPaid,
  };
}

/* --------------------------------------------------------------------------
 * Hauptfunktion
 * ------------------------------------------------------------------------ */

export function computeModel(
  state: ModelState,
  scenarioId: UUID,
  options: ComputeOptions = {},
): ComputedModel {
  const n = state.timeline.periodCount;
  const ppy = periodsPerYear(state.timeline.baseGranularity);
  const chain = scenarioChain(state, scenarioId);
  const maxIter = options.maxRevolverIterations ?? 50;
  const eps = options.convergenceEpsilon ?? 1;

  // --- 2) Operatives Modell -------------------------------------------------
  const op = computeOperating(state, chain, n, ppy);
  const grossProfit = subArr(addArr(op.revenue, op.subsidies), op.cogs);

  // OpEx / SG&A: Summe aller Assumptions mit Präfix "opex." + Personalüberkopf
  const opexAssumptions = Object.values(state.assumptions)
    .filter((a) => a.key.startsWith('opex.'))
    .reduce((acc, a) => addArr(acc, resolveAssumption(state, a.key, chain, n, ppy)), zeros(n));
  // Fester Personalaufwand (RO-Standard) als SG&A-Überkopf; Feldlohn steckt
  // separat in den COGS-opLines (LABOR) und wird hier NICHT doppelt gezählt.
  const personnelCost = computePersonnel(state, scenarioId).totalEmployerCost.values;
  const opex = addArr(opexAssumptions, personnelCost);

  const ebitda = subArr(grossProfit, opex);

  // --- 3) CapEx / Abschreibung (dual: bilanziell vs. fiskalisch) -----------
  const { capexOut, capexVatable, depCommercial, depFiscal, landAdditions, disposalBook, disposalBookFiscal, disposalProceeds } =
    computeCapexDepreciation(state, n, ppy);
  const fvBio = zeros(n); // TODO: IAS-41-Fair-Value-Änderung, wenn aktiviert
  // Ausmusterung: Buchgewinn/-verlust = Verkaufserlös − Restbuchwert (fließt ins EBIT).
  const disposalGainLoss = subArr(disposalProceeds, disposalBook);
  const disposalGainLossFiscal = subArr(disposalProceeds, disposalBookFiscal);
  // P&L nutzt die bilanzielle AfA + Buchgewinn/-verlust aus Ausmusterung:
  const ebit = addArr(addArr(subArr(ebitda, depCommercial), fvBio), disposalGainLoss);
  // Steuerliches EBIT (fiskalische AfA + steuerlicher Veräußerungserfolg):
  const ebitFiscal = addArr(addArr(subArr(ebitda, depFiscal), fvBio), disposalGainLossFiscal);

  // --- 4) Debt Schedule -----------------------------------------------------
  const debt = computeDebtSchedule(state, chain, n, ppy);

  // --- Working Capital (L3): NWC aus DSO/DPO/Lagertagen, ΔNWC in den CFO -----
  const workingCapital = computeWorkingCapital(state, chain, n, ppy, op.revenue, op.cogs);
  const wcChange = workingCapital.wcChange;

  // --- USt / TVA (RO): Ausgangs-/Vorsteuer, CAPEX-Erstattung, Timing --------
  const vat = computeVat(state, n, ppy, op.outputVat, op.cogs, opex, capexVatable);

  const taxRate = resolveAssumption(state, state.tax.corporateTaxRateKey, chain, n, ppy);

  // Reinvestitions-Befreiung (RO): reinvestierter Gewinn in qual. Ausrüstung (Maschinen/Bewässerung)
  //  ist von der KSt befreit. Jahres-Pooling: befreit = min(Jahres-Bemessung, qual. Ausrüstungs-CAPEX);
  //  Steuerminderung anteilig auf die Monate mit positiver Bemessung verteilt.
  const reinvestOn = (resolveAssumption(state, 'tax.reinvest_on', chain, n, ppy)[0] ?? 0) >= 0.5;
  const reinvestShare = reinvestOn ? (resolveAssumption(state, 'tax.reinvest_share', chain, n, ppy)[0] ?? 1) : 0;
  const QUAL_REINVEST = new Set(['machinery', 'irrigation']);
  const reinvestByPeriod = zeros(n);
  if (reinvestOn) for (const c of state.capex) {
    const pp = c.purchasePeriod;
    // Qualifikation: nur NEU-Investitionen aus laufendem Gewinn — t0-Erstpark/Bestand (pp=0) und
    //  übernommene GEBRAUCHT-Flotten (Asset-Deals) qualifizieren nicht (RO Art. 22: neue Ausrüstung).
    if (QUAL_REINVEST.has(c.assetClass) && pp > 0 && pp < n && !c.id.startsWith('cx-farm-mach'))
      reinvestByPeriod[pp] += (c.amount ?? 0) * reinvestShare;
  }
  /** RO-KSt korrekt als JAHRESsteuer: (1) Jahres-Pooling der fiskalischen Bemessung (negative
   *  Monate — Pflanzkosten-Frühjahr — verrechnen sich mit der Ernte, statt dass jeder positive
   *  Monat isoliert besteuert wird); (2) Verlustvortrag über Jahresgrenzen (RO Art. 31: Verrechnung
   *  max. 70 % der Jahresbemessung); (3) Reinvestitions-Befreiung auf die Bemessung NACH Verlust-
   *  abzug. Zahllast anteilig auf Monate mit positiver Bemessung verteilt (Vorauszahlungs-Timing). */
  const annualCurrentTax = (taxableArr: number[]): number[] => {
    const out = zeros(n);
    const carryEnabled = state.tax.lossCarryforward !== false;
    let lossCarry = 0;
    for (let y = 0; y * ppy < n; y++) {
      const a = y * ppy, b = Math.min(n, a + ppy);
      let taxableYr = 0, qualYr = 0, posSum = 0;
      for (let i = a; i < b; i++) { taxableYr += taxableArr[i]; qualYr += reinvestByPeriod[i]; posSum += Math.max(0, taxableArr[i]); }
      let taxYr = 0;
      if (taxableYr <= 0) {
        if (carryEnabled) lossCarry += -taxableYr;
      } else {
        const offset = carryEnabled ? Math.min(lossCarry, taxableYr * 0.7) : 0;
        lossCarry -= offset;
        let base = taxableYr - offset;
        if (reinvestOn) base = Math.max(0, base - Math.min(base, qualYr));
        taxYr = base * (taxRate[a] ?? 0);
      }
      if (taxYr > 0 && posSum > 0) { for (let i = a; i < b; i++) out[i] = taxYr * Math.max(0, taxableArr[i]) / posSum; }
      else if (taxYr > 0) out[b - 1] = taxYr;
    }
    return out;
  };

  // --- 5) Iterative Auflösung Revolver <-> Zins <-> Cash -------------------
  let revolverBalance = zeros(n);
  let revolverInterest = zeros(n);
  let revolverMovement = zeros(n);
  let closingCash = zeros(n);
  let iterations = 0;
  let converged = false;
  // Floating: Referenzzins (z. B. EURIBOR) + Spread — vorher wurde nur der Spread verzinst.
  const revRefRate = state.revolver.rateBasis === 'floating' && state.revolver.referenceRateKey
    ? resolveAssumption(state, state.revolver.referenceRateKey, chain, n, ppy) : null;
  const revRateAt = (p: number) => (state.revolver.rateBasis === 'fixed'
    ? (state.revolver.fixedRate ?? 0)
    : ((revRefRate ? (revRefRate[p] ?? 0) : 0) + (state.revolver.floatingSpread ?? 0))) / ppy;
  const minCash = state.revolver.minCashTarget ?? 0;
  const openingCash = state.openingBalance?.cash ?? 0;

  for (let it = 0; it < maxIter; it++) {
    iterations = it + 1;
    const interestTotal = addArr(debt.interest, revolverInterest);
    const pbt = subArr(ebit, interestTotal);              // bilanzielles Ergebnis v. St.
    const taxableFiscal = subArr(ebitFiscal, interestTotal); // steuerliche Bemessung
    // Zahlungswirksame Steuer: JAHRES-Bemessung + Verlustvortrag + Reinvestitions-Befreiung.
    const currentTax = annualCurrentTax(taxableFiscal);
    // Latente Steuer aus temporärer AfA-Differenz (fiskalisch − bilanziell):
    const deferredTax = depFiscal.map((df, i) => (df - depCommercial[i]) * taxRate[i]);
    // NI = bilanzielles EBT − (zahlungswirksame + latente Steuer)
    const netIncome = subArr(pbt, addArr(currentTax, deferredTax));

    // CFO = NI + bilanz. Abschreibung + latente Steuer (nicht zahlungswirksam)
    //       − FV(Bio) − ΔWC   (latente Steuer wird zurückaddiert)
    const cfo = subArr(
      addArr(addArr(addArr(netIncome, depCommercial), deferredTax), scaleArr(fvBio, -1)),
      addArr(wcChange, disposalGainLoss), // Buchgewinn/-verlust raus (Cash steckt im CFI-Erlös)
    );
    // CFI = −CapEx + Verkaufserlöse aus Ausmusterung
    const cfi = addArr(scaleArr(capexOut, -1), disposalProceeds);
    // CFF ohne Revolver = Drawdowns − Tilgung − Restwert-Ballon
    const cffExRevolver = subArr(subArr(debt.drawdowns, debt.repayments), debt.balloon);

    // Cash vor Revolver, kumuliert:
    const newRevBalance = zeros(n);
    const newRevInterest = zeros(n);
    const newRevMovement = zeros(n);
    const newClosingCash = zeros(n);

    let prevCash = openingCash;
    let prevRev = 0;
    for (let p = 0; p < n; p++) {
      const revInt = round(prevRev * revRateAt(p));
      newRevInterest[p] = revInt; // fließt in NI der nächsten Iteration ein
      // Revolver-Zins NICHT separat abziehen: er steckt bereits im Jahresüber-
      // schuss (netIncome -> cfo) und würde sonst doppelt zählen.
      const preCash = prevCash + cfo[p] + cfi[p] + cffExRevolver[p] + vat.vatCashFlow[p];
      let draw = 0;
      let repay = 0;
      if (preCash < minCash) {
        draw = Math.min(state.revolver.limit - prevRev, minCash - preCash);
      } else if (prevRev > 0) {
        repay = Math.min(prevRev, preCash - minCash);
      }
      const rev = prevRev + draw - repay;
      newRevMovement[p] = draw - repay;
      newRevBalance[p] = rev;
      newClosingCash[p] = preCash + draw - repay;
      prevCash = newClosingCash[p];
      prevRev = rev;
    }

    // Konvergenzprüfung gegen letzte Iteration
    const delta = newRevBalance.reduce((m, v, i) => Math.max(m, Math.abs(v - revolverBalance[i])), 0);
    revolverBalance = newRevBalance;
    revolverInterest = newRevInterest;
    revolverMovement = newRevMovement;
    closingCash = newClosingCash;
    if (delta <= eps) {
      converged = true;
      break;
    }
  }

  // --- 6) Statements zusammensetzen ----------------------------------------
  const interestTotal = addArr(debt.interest, revolverInterest);
  const pbt = subArr(ebit, interestTotal);
  const taxableFiscal = subArr(ebitFiscal, interestTotal);
  const currentTax = annualCurrentTax(taxableFiscal);
  const deferredTax = depFiscal.map((df, i) => (df - depCommercial[i]) * taxRate[i]);
  const totalTax = addArr(currentTax, deferredTax);
  const netIncome = subArr(pbt, totalTax);

  // Retained Earnings Rollforward
  const retainedEarnings = zeros(n);
  let reRunning = state.openingBalance?.retainedEarnings ?? 0;
  for (let p = 0; p < n; p++) {
    reRunning += netIncome[p];
    retainedEarnings[p] = reRunning;
  }

  // Latente Steuerschuld (kumulierte latente Steuer)
  const deferredTaxLiability = zeros(n);
  let dtlRunning = 0;
  for (let p = 0; p < n; p++) {
    dtlRunning += deferredTax[p];
    deferredTaxLiability[p] = dtlRunning;
  }

  // Sachanlagen netto (PPE) Rollforward — bilanzielle AfA mindert den Buchwert
  const ppeNet = zeros(n);
  let ppeRunning = state.openingBalance?.ppeNet ?? 0;
  const land = zeros(n);
  let landRunning = state.openingBalance?.land ?? 0;
  for (let p = 0; p < n; p++) {
    // PPE: + CapEx − AfA − Restbuchwert-Abgang aus Ausmusterung.
    ppeRunning += (capexOut[p] - landAdditions[p]) - depCommercial[p] - disposalBook[p];
    ppeNet[p] = ppeRunning;
    landRunning += landAdditions[p];
    land[p] = landRunning;
  }

  // Debt-Bilanzsaldo
  const debtBalance = debt.balance;

  // Aktiva / Passiva — WC-Positionen aus dem Working-Capital-Modul (L3)
  const inventory = workingCapital.inventory;
  const receivables = workingCapital.receivables;
  const payables = workingCapital.payables;
  const bioAssets = zeros(n);
  const shareCapital = new Array(n).fill(state.openingBalance?.shareCapital ?? 0);

  const totalAssets = addArr(
    addArr(addArr(addArr(closingCash, receivables), addArr(inventory, bioAssets)),
      addArr(land, ppeNet)),
    vat.vatReceivable,          // USt-Forderung (TVA de recuperat)
  );
  const totalLiab = addArr(
    addArr(addArr(addArr(payables, debtBalance), revolverBalance),
      deferredTaxLiability),
    vat.vatPayable,             // USt-Verbindlichkeit (TVA de plată)
  );
  const totalEquity = addArr(shareCapital, retainedEarnings);
  const liabAndEquity = addArr(totalLiab, totalEquity);

  // --- Checks ---------------------------------------------------------------
  const checks: CheckResult[] = [];
  const balanceDev = totalAssets.map((v, i) => v - liabAndEquity[i]);
  checks.push(buildCheck('balance_zero', 'Bilanz geht auf (A = L + E)', balanceDev, eps, 'error'));

  const negCash = closingCash.map((v) => (v < 0 ? -v : 0));
  checks.push(buildCheck('no_negative_cash', 'Keine negative Kasse', negCash, 0, 'error'));

  const reCheck = retainedEarnings.map((v, i) => {
    const prev = i === 0 ? (state.openingBalance?.retainedEarnings ?? 0) : retainedEarnings[i - 1];
    return v - (prev + netIncome[i]);
  });
  checks.push(buildCheck('re_rollforward', 'Retained-Earnings-Rollforward', reCheck, eps, 'error'));

  // --- KPIs -----------------------------------------------------------------
  const ebitdaMargin = ebitda.map((v, i) => {
    const rev = op.revenue[i] + op.subsidies[i];
    return rev !== 0 ? v / rev : 0;
  });
  const debtService = addArr(debt.repayments, interestTotal);
  const dscr = debtService.map((ds, i) => (ds !== 0 ? cfoAt(ebitda, i) / ds : 0));
  const icr = interestTotal.map((int, i) => (int !== 0 ? ebit[i] / int : 0));
  const netDebt = subArr(addArr(debtBalance, revolverBalance), closingCash);
  const netDebtToEbitda = netDebt.map((nd, i) => (ebitda[i] !== 0 ? nd / annualize(ebitda, i, ppy) : 0));
  const fcf = subArr(addArr(netIncome, depCommercial), capexOut);
  const roic = ebit.map((e, i) => {
    const invested = totalEquity[i] + debtBalance[i] + revolverBalance[i];
    return invested !== 0 ? annualize([e], 0, ppy) / invested : 0;
  });

  // --- Zusatz-Checks (rein additiv, severity 'warning') --------------------
  // 1) unresolved_keys: im ModelState referenzierte Assumption-Keys, die NICHT
  //    in state.assumptions existieren (resolveAssumption liefert dort still 0).
  const referencedKeys: string[] = [];
  for (const cp of state.cropPlans) {
    referencedKeys.push(cp.yieldAssumptionKey, cp.priceAssumptionKey);
    if (cp.lossRateAssumptionKey) referencedKeys.push(cp.lossRateAssumptionKey);
    for (const k of cp.variableCostKeysPerHa) referencedKeys.push(k);
    if (cp.operations) {
      for (const op2 of cp.operations) {
        for (const line of op2.lines) referencedKeys.push(line.unitCostKey);
      }
    }
  }
  referencedKeys.push(
    state.workingCapital.dsoAssumptionKey,
    state.workingCapital.dpoAssumptionKey,
    state.workingCapital.inventoryDaysAssumptionKey,
    state.tax.corporateTaxRateKey,
  );
  for (const s of state.subsidies) if (s.amountAssumptionKey) referencedKeys.push(s.amountAssumptionKey);
  for (const t of state.debt) if (t.referenceRateKey) referencedKeys.push(t.referenceRateKey);
  if (state.revolver.referenceRateKey) referencedKeys.push(state.revolver.referenceRateKey);
  if (state.personnel) {
    for (const role of state.personnel.roles) {
      referencedKeys.push(role.headcountKey, role.grossMonthlyKey);
    }
  }
  if (state.holding) {
    for (const ci of state.holding.costItems) if (ci.assumptionKey) referencedKeys.push(ci.assumptionKey);
    if (state.holding.managementFeeKey) referencedKeys.push(state.holding.managementFeeKey);
    referencedKeys.push(state.holding.taxRateKey);
    if (state.holding.dividendWithholdingKey) referencedKeys.push(state.holding.dividendWithholdingKey);
    if (state.holding.personnel) {
      for (const role of state.holding.personnel.roles) {
        referencedKeys.push(role.headcountKey, role.grossMonthlyKey);
      }
    }
    if (state.holding.debt) {
      for (const t of state.holding.debt) if (t.referenceRateKey) referencedKeys.push(t.referenceRateKey);
    }
  }
  const missingKeys = Array.from(new Set(referencedKeys)).filter((k) => !(k in state.assumptions));
  checks.push({
    id: 'unresolved_keys',
    label: missingKeys.length > 0
      ? `Fehlende Assumption-Keys (still → 0): ${missingKeys.join(', ')}`
      : 'Alle referenzierten Assumption-Keys aufgelöst',
    passed: missingKeys.length === 0,
    maxDeviation: missingKeys.length,
    offendingPeriods: [],
    severity: 'warning',
  });

  // Covenants werden — wie reale Kreditauflagen — auf JAHRESBASIS geprüft (nicht auf
  // verzerrten Einzelmonaten): am jeweiligen Jahresende gegen die Jahres-Summe/-Endstände.
  // Für ein Modell mit ppy Perioden/Jahr ist das jede ppy-te Periode; sonst das Modellende.
  const cfoMonthly = subArr(addArr(addArr(netIncome, depCommercial), deferredTax), wcChange);
  const debtServiceMonthly = addArr(debt.repayments, interestTotal);
  const yearEnds: number[] = [];
  if (ppy > 1) { for (let ye = ppy - 1; ye < n; ye += ppy) yearEnds.push(ye); if (yearEnds[yearEnds.length - 1] !== n - 1) yearEnds.push(n - 1); }
  else { for (let i = 0; i < n; i++) yearEnds.push(i); }
  const sumWin = (arr: number[], end: number, len: number) => { let s = 0; for (let k = 0; k < len && end - k >= 0; k++) s += arr[end - k]; return s; };

  const dscrMin = state.assumptions['covenant.dscr_min']
    ? (resolveAssumption(state, 'covenant.dscr_min', chain, n, ppy)[0] ?? 1.25) : 1.25;
  const leverageMax = state.assumptions['covenant.leverage_max']
    ? (resolveAssumption(state, 'covenant.leverage_max', chain, n, ppy)[0] ?? 3.5) : 3.5;
  const dscrOffending: PeriodIndex[] = []; let dscrMaxShortfall = 0;
  const levOffending: PeriodIndex[] = []; let levMaxExcess = 0;
  for (const ye of yearEnds) {
    const win = Math.min(ppy, ye + 1);
    const yEbitda = sumWin(ebitda, ye, win);
    const yCfo = sumWin(cfoMonthly, ye, win);
    const yDs = sumWin(debtServiceMonthly, ye, win);
    const yNetDebt = debtBalance[ye] + revolverBalance[ye] - closingCash[ye];
    // DSCR (nur wenn echter Schuldendienst)
    if (yDs > 0) {
      const v = yCfo / yDs;
      if (Number.isFinite(v) && v < dscrMin) { dscrOffending.push(ye); dscrMaxShortfall = Math.max(dscrMaxShortfall, dscrMin - v); }
    }
    // Leverage (nur wenn Jahres-EBITDA positiv)
    if (yEbitda > 0) {
      const v = yNetDebt / yEbitda;
      if (Number.isFinite(v) && v > leverageMax) { levOffending.push(ye); levMaxExcess = Math.max(levMaxExcess, v - leverageMax); }
    }
  }
  checks.push({
    id: 'dscr_covenant',
    label: `DSCR ≥ ${dscrMin.toFixed(2)} (Mindest-Kapitaldienstdeckung, p.a.)`,
    passed: dscrOffending.length === 0, maxDeviation: dscrMaxShortfall,
    offendingPeriods: dscrOffending, severity: 'warning',
  });
  checks.push({
    id: 'leverage_covenant',
    label: `Net Debt / EBITDA ≤ ${leverageMax.toFixed(2)} (Verschuldungsgrenze, p.a.)`,
    passed: levOffending.length === 0, maxDeviation: levMaxExcess,
    offendingPeriods: levOffending, severity: 'warning',
  });

  // --- LineItems für Output ------------------------------------------------
  return {
    scenarioId,
    timeline: state.timeline,
    pnl: {
      revenue: makeLine('pnl.revenue', 'Umsatz', 'money', op.revenue, [], 'Σ Fläche×Ertrag×Preis×(1−Verlust)'),
      subsidies: makeLine('pnl.subsidies', 'Subventionen (GAP/CAP)', 'money', op.subsidies),
      cogs: makeLine('pnl.cogs', 'Produktionskosten (COGS)', 'money', op.cogs),
      grossProfit: makeLine('pnl.gross_profit', 'Rohertrag', 'money', grossProfit, ['pnl.revenue', 'pnl.subsidies', 'pnl.cogs']),
      opex: makeLine('pnl.opex', 'OpEx / SG&A', 'money', opex),
      ebitda: makeLine('pnl.ebitda', 'EBITDA', 'money', ebitda, ['pnl.gross_profit', 'pnl.opex']),
      depreciation: makeLine('pnl.depreciation', 'Abschreibung (bilanziell)', 'money', depCommercial),
      fairValueChangeBio: makeLine('pnl.fv_bio', 'FV-Änderung biol. Vermögen', 'money', fvBio),
      disposalResult: makeLine('pnl.disposal', 'Ergebnis Anlagenabgang (Ausmusterung)', 'money', disposalGainLoss),
      ebit: makeLine('pnl.ebit', 'EBIT', 'money', ebit, ['pnl.ebitda', 'pnl.depreciation', 'pnl.disposal']),
      interest: makeLine('pnl.interest', 'Zinsaufwand', 'money', interestTotal),
      pbt: makeLine('pnl.pbt', 'Ergebnis vor Steuern', 'money', pbt, ['pnl.ebit', 'pnl.interest']),
      tax: makeLine('pnl.tax', 'Ertragsteuer (gesamt)', 'money', totalTax, ['pnl.current_tax', 'pnl.deferred_tax']),
      currentTax: makeLine('pnl.current_tax', 'davon zahlungswirksam', 'money', currentTax),
      deferredTax: makeLine('pnl.deferred_tax', 'davon latente Steuer', 'money', deferredTax),
      netIncome: makeLine('pnl.net_income', 'Jahresüberschuss', 'money', netIncome, ['pnl.pbt', 'pnl.tax']),
    },
    balanceSheet: {
      cash: makeLine('bs.cash', 'Kasse', 'money', closingCash),
      receivables: makeLine('bs.receivables', 'Forderungen', 'money', receivables),
      inventory: makeLine('bs.inventory', 'Vorräte', 'money', inventory),
      biologicalAssets: makeLine('bs.bio', 'Biologische Vermögenswerte', 'money', bioAssets),
      land: makeLine('bs.land', 'Grund & Boden', 'money', land),
      ppeNet: makeLine('bs.ppe', 'Sachanlagen (netto)', 'money', ppeNet),
      vatReceivable: makeLine('bs.vat_receivable', 'USt-Forderung (TVA de recuperat)', 'money', vat.vatReceivable),
      totalAssets: makeLine('bs.total_assets', 'Summe Aktiva', 'money', totalAssets),
      payables: makeLine('bs.payables', 'Verbindlichkeiten', 'money', payables),
      debt: makeLine('bs.debt', 'Finanzverbindlichkeiten', 'money', debtBalance),
      revolver: makeLine('bs.revolver', 'Betriebsmittellinie', 'money', revolverBalance),
      deferredTaxLiability: makeLine('bs.deferred_tax', 'Latente Steuern', 'money', deferredTaxLiability),
      vatPayable: makeLine('bs.vat_payable', 'USt-Verbindlichkeit (TVA de plată)', 'money', vat.vatPayable),
      totalLiabilities: makeLine('bs.total_liabilities', 'Summe Passiva (FK)', 'money', totalLiab),
      shareCapital: makeLine('bs.share_capital', 'Gezeichnetes Kapital', 'money', shareCapital),
      retainedEarnings: makeLine('bs.retained_earnings', 'Gewinnrücklagen', 'money', retainedEarnings),
      totalEquity: makeLine('bs.total_equity', 'Eigenkapital', 'money', totalEquity),
      liabilitiesAndEquity: makeLine('bs.liab_and_equity', 'Summe Passiva', 'money', liabAndEquity),
    },
    cashFlow: {
      netIncome: makeLine('cf.net_income', 'Jahresüberschuss', 'money', netIncome),
      addBackDepreciation: makeLine('cf.dep', '+ Abschreibung', 'money', depCommercial),
      addBackFvBio: makeLine('cf.fv_bio', '+ latente Steuer / − FV biol.', 'money', subArr(deferredTax, fvBio)),
      changeInWorkingCapital: makeLine('cf.wc', '− Δ Working Capital', 'money', scaleArr(wcChange, -1)),
      cfo: makeLine('cf.cfo', 'Operativer Cashflow', 'money',
        subArr(addArr(addArr(netIncome, depCommercial), deferredTax), addArr(wcChange, disposalGainLoss))),
      capex: makeLine('cf.capex', '− CapEx', 'money', scaleArr(capexOut, -1)),
      cfi: makeLine('cf.cfi', 'Investiver Cashflow', 'money', addArr(scaleArr(capexOut, -1), disposalProceeds)),
      disposalProceeds: makeLine('cf.disposal', '+ Verkaufserlös Ausmusterung', 'money', disposalProceeds),
      debtDrawdowns: makeLine('cf.draw', 'Kreditaufnahme', 'money', debt.drawdowns),
      debtRepayments: makeLine('cf.repay', 'Tilgung', 'money', scaleArr(debt.repayments, -1)),
      revolverMovement: makeLine('cf.revolver', 'Revolver-Bewegung', 'money', revolverMovement),
      equityMovement: makeLine('cf.equity', 'Eigenkapitalbewegung', 'money', zeros(n)),
      interestPaid: makeLine('cf.interest', 'Gezahlte Zinsen', 'money', scaleArr(interestTotal, -1)),
      vatCashFlow: makeLine('cf.vat', 'USt/TVA-Timing (Vorsteuer/Zahllast/Erstattung)', 'money', vat.vatCashFlow),
      cff: makeLine('cf.cff', 'Finanzierungs-Cashflow', 'money',
        addArr(subArr(subArr(debt.drawdowns, debt.repayments), debt.balloon), revolverMovement)),
      netCashFlow: makeLine('cf.net', 'Netto-Cashflow', 'money',
        closingCash.map((v, i) => v - (i === 0 ? openingCash : closingCash[i - 1]))),
      closingCash: makeLine('cf.closing', 'Endbestand Kasse', 'money', closingCash),
    },
    kpis: {
      ebitdaMargin: makeLine('kpi.ebitda_margin', 'EBITDA-Marge', 'rate', ebitdaMargin),
      netDebtToEbitda: makeLine('kpi.nd_ebitda', 'Net Debt / EBITDA', 'count', netDebtToEbitda),
      dscr: makeLine('kpi.dscr', 'DSCR', 'count', dscr),
      icr: makeLine('kpi.icr', 'Zinsdeckung (ICR)', 'count', icr),
      roic: makeLine('kpi.roic', 'ROIC', 'rate', roic),
      fcf: makeLine('kpi.fcf', 'Free Cash Flow', 'money', fcf),
    },
    checks,
    meta: { revolverIterations: iterations, converged },
  };
}

/* --------------------------------------------------------------------------
 * Kleine Helfer für KPIs/Checks
 * ------------------------------------------------------------------------ */

function cfoAt(ebitda: number[], i: number): number {
  return ebitda[i]; // Proxy; exakter: CFO aus Cashflow
}
function annualize(arr: number[], i: number, ppy: number): number {
  // Summe der letzten ppy Perioden (rollierend), Fallback: Wert × ppy
  return arr[i] !== undefined ? arr[i] * ppy : 0;
}

function buildCheck(
  id: string,
  label: string,
  deviations: number[],
  tolerance: number,
  severity: 'error' | 'warning',
): CheckResult {
  const offendingPeriods: PeriodIndex[] = [];
  let maxDeviation = 0;
  deviations.forEach((d, i) => {
    const abs = Math.abs(d);
    if (abs > tolerance) offendingPeriods.push(i);
    if (abs > maxDeviation) maxDeviation = abs;
  });
  return {
    id,
    label,
    passed: offendingPeriods.length === 0,
    maxDeviation,
    offendingPeriods,
    severity,
  };
}

/* ==========================================================================
 * L5 — Bewertung / DCF
 * ==========================================================================
 * Reine Funktionen. computeValuation nimmt den (bereits gerechneten)
 * ComputedModel + ModelState und leitet FCFF/FCFE, Terminal Value, NPV,
 * Projekt-/Equity-IRR, Peak-Funding, MOIC und die Exit-Multiple-Sensitivität ab.
 * ======================================================================== */

/** NPV einer Cashflow-Reihe: CF[0] auf t=1 abgezinst … CF[k] auf t=k+1. */
export function npv(cashflows: number[], rate: number): number {
  return cashflows.reduce((acc, cf, i) => acc + cf / Math.pow(1 + rate, i + 1), 0);
}

/** IRR per Bisektion. Gibt NaN zurück, wenn kein Vorzeichenwechsel vorliegt. */
export function irr(cashflows: number[]): number {
  const f = (r: number) => cashflows.reduce((a, cf, i) => a + cf / Math.pow(1 + r, i + 1), 0);
  let lo = -0.9;
  let hi = 5.0;
  if (f(lo) * f(hi) > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function periodsPerYearOf(g: Granularity): number {
  return g === 'month' ? 12 : g === 'quarter' ? 4 : 1;
}

export function computeValuation(
  state: ModelState,
  computed: ComputedModel,
  options: ValuationOptions,
): ValuationResult {
  const n = state.timeline.periodCount;
  const ppy = periodsPerYearOf(state.timeline.baseGranularity);
  const chain = scenarioChain(state, computed.scenarioId);

  const wacc = resolveAssumption(state, options.waccKey, chain, n, ppy)[0] ?? 0;
  const taxRate = resolveAssumption(state, state.tax.corporateTaxRateKey, chain, n, ppy);
  const g = options.terminalGrowthKey
    ? (resolveAssumption(state, options.terminalGrowthKey, chain, n, ppy)[0] ?? 0)
    : 0;

  // Bausteine aus dem ComputedModel rekonstruieren
  const ebit = computed.pnl.ebit.values;
  const dep = computed.pnl.depreciation.values;          // bilanziell
  const deferredTax = computed.pnl.deferredTax.values;
  const netIncome = computed.pnl.netIncome.values;
  const capexOut = computed.cashFlow.capex.values.map((v) => -v); // capex-Zeile ist −capexOut
  const wcChange = computed.cashFlow.changeInWorkingCapital.values.map((v) => -v); // cf.wc = −ΔWC
  const netBorrowing = computed.cashFlow.cff.values;      // draw − repay − ballon + revolver

  // FCFF (unlevered) = NOPAT + AfA + latente Steuer − CapEx − ΔWC
  const fcff = ebit.map((e, i) => e * (1 - taxRate[i]) + dep[i] + deferredTax[i] - capexOut[i] - wcChange[i]);
  // FCFE (levered) = Jahresüberschuss + AfA + latente Steuer − CapEx − ΔWC + Netto-Kreditaufnahme
  const fcfe = netIncome.map((ni, i) => ni + dep[i] + deferredTax[i] - capexOut[i] - wcChange[i] + netBorrowing[i]);

  // Netto-Finanzschuld & EBITDA der letzten Periode
  const bs = computed.balanceSheet;
  const netDebtLast =
    bs.debt.values[n - 1] + bs.revolver.values[n - 1] - bs.cash.values[n - 1];
  const ebitdaLastAnnual = computed.pnl.ebitda.values[n - 1] * ppy; // annualisiert

  // Per-Perioden-WACC für unterjährige Modelle
  const wPer = Math.pow(1 + wacc, 1 / ppy) - 1;

  const terminalFirm = (multiple: number): number => {
    if (options.terminalMethod === 'exit_multiple') return multiple * ebitdaLastAnnual;
    // Gordon: ewige Rente auf annualisierten FCFF der letzten Periode
    const fcffAnnualLast = fcff[n - 1] * ppy;
    return wacc > g ? (fcffAnnualLast * (1 + g)) / (wacc - g) : 0;
  };

  const evalMultiple = (multiple: number) => {
    const tvFirm = terminalFirm(multiple);
    const tvEquity = tvFirm - netDebtLast;
    const unlevered = fcff.slice();
    unlevered[n - 1] += tvFirm;
    const levered = fcfe.slice();
    levered[n - 1] += tvEquity;
    return {
      tvFirm,
      tvEquity,
      npv: npv(unlevered, wPer),
      projectIRR: irr(unlevered),
      equityIRR: irr(levered),
    };
  };

  const baseMultiple = options.exitMultiple ?? 0;
  const baseEval = evalMultiple(baseMultiple);

  // Peak-Funding & MOIC auf der levered Reihe (mit Base-TV)
  const leveredBase = fcfe.slice();
  leveredBase[n - 1] += baseEval.tvEquity;
  let cum = 0;
  let peak = 0;
  let inflow = 0;
  let outflow = 0;
  for (const cf of leveredBase) {
    cum += cf;
    if (cum < peak) peak = cum;
    if (cf > 0) inflow += cf;
    else outflow += -cf;
  }
  const moic = outflow > 0 ? inflow / outflow : NaN;

  const exitSensitivity: ExitScenario[] = (options.exitMultipleSensitivity ?? []).map((m) => {
    const e = evalMultiple(m);
    return {
      multiple: m,
      npv: e.npv,
      projectIRR: e.projectIRR,
      equityIRR: e.equityIRR,
      terminalValueFirm: e.tvFirm,
    };
  });

  const line = (key: string, label: string, values: number[]): LineItem => ({
    key, label, unit: 'money', values, precedents: [],
  });

  return {
    wacc,
    fcff: line('val.fcff', 'Free Cash Flow to Firm', fcff),
    fcfe: line('val.fcfe', 'Free Cash Flow to Equity', fcfe),
    terminalValueFirm: baseEval.tvFirm,
    terminalValueEquity: baseEval.tvEquity,
    npv: baseEval.npv,
    projectIRR: baseEval.projectIRR,
    equityIRR: baseEval.equityIRR,
    peakFundingEquity: peak,
    moic,
    exitSensitivity,
  };
}

/* ==========================================================================
 * L6 — Sensitivität / Tornado (nicht-destruktives Re-Run)
 * ==========================================================================
 * Jeder Treiber wird um ±delta ausgelenkt, Modell + Bewertung neu gerechnet
 * und die Δ-Metrik gegen den Basiswert gemessen. Kein Zustand wird mutiert
 * (tiefe Kopie je Auslenkung). Sortierung nach Hebel (totalSwing).
 * ======================================================================== */

/** Wendet eine relative/absolute Auslenkung auf das Niveau eines Zeitprofils an. */
function perturbProfile(
  p: TimeProfile,
  mode: 'relative' | 'absolute',
  delta: number,
  sign: 1 | -1,
): TimeProfile {
  const bump = (x: number) => (mode === 'relative' ? x * (1 + sign * delta) : x + sign * delta);
  switch (p.kind) {
    case 'constant':
      return { ...p, value: bump(p.value) };
    case 'growth':
      return { ...p, base: bump(p.base) };
    case 'ramp':
      return { ...p, from: bump(p.from), to: bump(p.to) };
    case 'curve':
      return { ...p, values: p.values.map(bump) };
    case 'seasonal':
      return { ...p, annual: bump(p.annual) };
  }
}

/** Tiefe Kopie + Auslenkung mehrerer Annahmen. Mutiert das Original nicht. */
function perturbState(
  state: ModelState,
  keys: string[],
  mode: 'relative' | 'absolute',
  delta: number,
  sign: 1 | -1,
): ModelState {
  const clone: ModelState = JSON.parse(JSON.stringify(state));
  for (const key of keys) {
    const a = clone.assumptions[key];
    if (!a) continue;
    for (const sid of Object.keys(a.scenarioProfiles)) {
      a.scenarioProfiles[sid] = perturbProfile(a.scenarioProfiles[sid], mode, delta, sign);
    }
  }
  return clone;
}

function metricOf(
  state: ModelState,
  scenarioId: UUID,
  metric: SensitivityMetric,
  valuation?: ValuationOptions,
): number {
  const computed = computeModel(state, scenarioId);
  if (metric === 'ebitdaLast') {
    return computed.pnl.ebitda.values[state.timeline.periodCount - 1];
  }
  if (!valuation) throw new Error(`Metrik "${metric}" benötigt ValuationOptions`);
  const v = computeValuation(state, computed, valuation);
  return metric === 'npv' ? v.npv : metric === 'equityIRR' ? v.equityIRR : v.projectIRR;
}

export function computeTornado(
  state: ModelState,
  scenarioId: UUID,
  drivers: SensitivityDriver[],
  opts: { metric: SensitivityMetric; valuation?: ValuationOptions },
): TornadoResult {
  const base = metricOf(state, scenarioId, opts.metric, opts.valuation);
  const bars: TornadoBar[] = drivers.map((d) => {
    const low = metricOf(
      perturbState(state, d.assumptionKeys, d.mode, d.delta, -1),
      scenarioId,
      opts.metric,
      opts.valuation,
    );
    const high = metricOf(
      perturbState(state, d.assumptionKeys, d.mode, d.delta, +1),
      scenarioId,
      opts.metric,
      opts.valuation,
    );
    const swingLow = low - base;
    const swingHigh = high - base;
    return {
      name: d.name,
      low,
      high,
      swingLow,
      swingHigh,
      totalSwing: Math.abs(swingLow) + Math.abs(swingHigh),
    };
  });
  bars.sort((a, b) => b.totalSwing - a.totalSwing);
  return { metric: opts.metric, base, bars };
}
