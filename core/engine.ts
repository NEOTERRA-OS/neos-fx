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
  OfftakeContract,
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
): {
  perPeriodPerHa: number[];
  /** Kosten von Arbeitsgängen mit cohort='next' — gehören zur Ernte NACH der nächsten. */
  perPeriodPerHaNext: number[];
  byTypePerHa: Record<import('./types').CostType, number[]>;
} {
  const perPeriodPerHa = zeros(n);
  const perPeriodPerHaNext = zeros(n);
  const byTypePerHa = emptyByType(n);

  if (plan.operations && plan.operations.length > 0) {
    for (const op of plan.operations) {
      const target = op.cohort === 'next' ? perPeriodPerHaNext : perPeriodPerHa;
      for (const line of op.lines) {
        const unitCost = resolveAssumption(state, line.unitCostKey, chain, n, ppy);
        for (const p of op.costPeriods) {
          if (p < 0 || p >= n) continue;
          const c = line.quantityPerHa * unitCost[p]; // €/ha
          target[p] += c;
          byTypePerHa[line.costType][p] += c;   // Kostenarten-Sicht: Kohorte irrelevant
        }
      }
    }
    return { perPeriodPerHa, perPeriodPerHaNext, byTypePerHa };
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
  return { perPeriodPerHa, perPeriodPerHaNext, byTypePerHa };
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
  /** Erhaltene Anzahlungen (Vertragsverbindlichkeit) — Passivum, mindert das NWC. */
  customerAdvances: number[];
  /** Nachrichtlich: Anzahlungszufluss(+) − Verrechnung gegen Forderung(−) je Periode. */
  advanceMovement: number[];
  /** Skonto/Zins auf ausstehende Anzahlungen → Finanzaufwand (nicht EBITDA-wirksam). */
  advanceCost: number[];
  /** Avalprovision auf besicherte Anzahlungen → Betriebsaufwand (EBITDA-wirksam). */
  advanceSecurityFee: number[];
  /** Zahlungseingänge aus Forderungen je Periode (nachrichtlich, für Analyse/Ansicht). */
  collections: number[];
  /** Zahlungsausgänge an Lieferanten je Periode (nachrichtlich). */
  payments: number[];
  /** Feldbestand (wachsende Kultur) — durchgereicht, Teil des NWC. */
  bioAssets: number[];
  nwc: number[];         // = Vorräte + Forderungen + Feldbestand − Verbindl. − Anzahlungen
  wcChange: number[];    // ΔNWC je Periode (Cash-Bindung, wenn positiv)
}

/**
 * Working Capital mit echtem Forderungs-Rollforward (Paket B).
 *
 * Vorher wurden die Forderungen als Kennzahl aus dem Fluss der LAUFENDEN Periode
 * gebildet (annualisierter Umsatz × DSO/365). Bei Ernteumsatz in einem einzigen Monat
 * entstanden die Forderungen IM Erntemonat und fielen im Folgemonat auf null — das
 * Gegenteil eines Zahlungsziels. Jetzt gilt:
 *
 *   Forderungen[p] = Forderungen[p−1] + fakturiert[p] − eingegangen[p] − verrechnete Anzahlung[p]
 *
 * Das Zahlungsziel ist EINHEITLICH und gilt für den gesamten Umsatz — ein Treiber aus
 * `wc.dsoAssumptionKey` (Base 14 Tage = Verhandlungsziel, Best 7, Worst 28), NICHT je
 * Vertrag. Begründung wie bei der Anzahlung: jeder Vertrag ist individuell verhandelt;
 * ein Zahlungsziel je Kontrakt fesselt das Modell an eine Momentaufnahme des Abnehmer-
 * mixes und lässt sich im Wachstumsszenario nicht fortschreiben. Die in den Verträgen
 * dokumentierten Ziele (VIA AGRO 47 · PepsiCo 28 · Pestova 14) bleiben auf
 * `OfftakeContract.dsoDays` als Beleg erhalten und werden in der Ansicht gegen die
 * Planungsannahme gestellt — der Abstand IST die Verhandlungsaufgabe.
 *
 * Einzige Ausnahme: separat fakturierte Bonustranchen tragen über `extraDelayDays`
 * einen Zusatzverzug ON TOP (VIA AGRO: Qualitäts-/Lagerbonus erst ab 01.12.), weil das
 * kein Zahlungsziel ist, sondern ein Kalendertrigger.
 *
 * Fällt ein Zahlungsziel zwischen zwei Perioden, wird linear auf die beiden Nachbar-
 * perioden aufgeteilt, statt auf eine ganze Periode zu runden. Zahlungen jenseits des
 * Horizonts bleiben als offene Forderung stehen — richtig für einen abgeschnittenen
 * Planungszeitraum.
 *
 * Vorräte und Verbindlichkeiten laufen bewusst WEITER über die Tages-Kennzahl: die
 * Umstellung von DPO und Lagertagen auf einen echten Rollforward ist ein eigener
 * Schritt (siehe Handover), sonst wären die Ankerverschiebungen nicht mehr eindeutig
 * dem Zahlungs-Timing der Erlösseite zuzuordnen.
 */
function computeWorkingCapital(
  state: ModelState,
  chain: UUID[],
  n: number,
  ppy: number,
  revenue: number[],
  cogs: number[],
  costIncurred: number[],
  bioAssets: number[],
  receiptTerms: ReceiptTerm[],
  advanceFlows: AdvanceFlow[],
): WorkingCapitalResult {
  const wc = state.workingCapital;
  const dso = resolveAssumption(state, wc.dsoAssumptionKey, chain, n, ppy);
  const dpo = resolveAssumption(state, wc.dpoAssumptionKey, chain, n, ppy);
  const invDays = resolveAssumption(state, wc.inventoryDaysAssumptionKey, chain, n, ppy);

  const receivables = zeros(n);
  const inventory = zeros(n);
  const payables = zeros(n);
  const customerAdvances = zeros(n);
  const advanceMovement = zeros(n);
  const advanceCost = zeros(n);
  const advanceSecurityFee = zeros(n);
  const collections = zeros(n);
  const payments = zeros(n);
  const nwc = zeros(n);
  const wcChange = zeros(n);

  const ob = state.openingBalance;
  // Eröffnungsforderungen gelten in Periode 0 als eingegangen — genau die Wirkung, die
  // die frühere Formel über openingNwc in wcChange[0] hatte (Verhalten unverändert).
  const openingNwc = (ob?.inventory ?? 0) + (ob?.receivables ?? 0) - (ob?.payables ?? 0);

  // --- Fälligkeiten planen ---------------------------------------------------
  const daysPerPeriod = 365 / ppy;
  const billedNet = zeros(n);
  const advanceIn = zeros(n);
  const advanceApplied = zeros(n);

  const termsByPeriod: ReceiptTerm[][] = Array.from({ length: n }, () => []);
  for (const t of receiptTerms) {
    if (t.period >= 0 && t.period < n) termsByPeriod[t.period].push(t);
  }
  const advByPeriod: AdvanceFlow[][] = Array.from({ length: n }, () => []);
  for (const a of advanceFlows) {
    if (a.period >= 0 && a.period < n) advByPeriod[a.period].push(a);
  }
  // Konditionen gelten für den gepoolten Saldo — eine Policy, nicht je Vertrag.
  const advSettlement = advanceFlows[0]?.settlement ?? 'firstDeliveries';
  const advCostRate = advanceFlows[0]?.costRate ?? 0;
  const advFeeRate = advanceFlows[0]?.securityFeeRate ?? 0;
  // Für 'finalInvoice': letzte anrechenbare Fakturaperiode je Jahr.
  const lastBill = new Map<number, number>();
  for (const t of receiptTerms) {
    if (!t.advanceEligible || t.period < 0 || t.period >= n) continue;
    const y = Math.floor(t.period / ppy);
    const cur = lastBill.get(y);
    if (cur === undefined || t.period > cur) lastBill.set(y, t.period);
  }

  /** Betrag nach dem EINHEITLICHEN Zahlungsziel (+ optionalem Zusatzverzug) fällig stellen;
   *  Zwischenlage linear auf die beiden Nachbarperioden aufteilen. */
  const schedule = (p: number, amount: number, extraDelayDays: number | undefined) => {
    const days = Math.max(0, (dso[p] ?? 0) + (extraDelayDays ?? 0));
    const lag = days / daysPerPeriod;
    const k = Math.floor(lag);
    const frac = lag - k;
    const first = round(amount * (1 - frac));
    if (p + k < n) collections[p + k] += first;
    const second = amount - first;
    if (second !== 0 && p + k + 1 < n) collections[p + k + 1] += second;
  };

  let advBal = 0;
  for (let p = 0; p < n; p++) {
    // (a) Zins/Skonto und Avalprovision auf den Stand des Vorperiodenendes (wie beim Revolver).
    if (advBal > 0) {
      advanceCost[p] = round((advBal * advCostRate) / ppy);
      advanceSecurityFee[p] = round((advBal * advFeeRate) / ppy);
    }
    // (b) Anzahlungszufluss: Kasse hoch, Vertragsverbindlichkeit hoch — KEIN Umsatz.
    for (const a of advByPeriod[p]) {
      advBal += a.amount;
      advanceIn[p] += a.amount;
    }
    // (c) Faktura: Anzahlung gegen die entstehende Forderung verrechnen, Rest fällig stellen.
    for (const t of termsByPeriod[p]) {
      let amt = t.amount;
      if (t.advanceEligible && amt > 0 && advBal > 0) {
        const eligible = advSettlement === 'finalInvoice'
          ? lastBill.get(Math.floor(p / ppy)) === p
          : true;
        if (eligible) {
          const use = Math.min(advBal, amt);
          advBal -= use;
          amt -= use;
          advanceApplied[p] += use;
        }
      }
      if (amt !== 0) schedule(p, amt, t.extraDelayDays);
      billedNet[p] += amt;
    }
    customerAdvances[p] = advBal;
    advanceMovement[p] = advanceIn[p] - advanceApplied[p];
  }

  // --- Verbindlichkeiten: Rollforward aus dem ENTSTANDENEN Kostenfluss -------
  // Bemessungsgrundlage ist `costIncurred`, nicht `cogs`: bezahlt wird der Dünger, wenn
  // er geliefert wird, nicht wenn die Ernte in die GuV läuft (Feldbestand-Aktivierung).
  // Bei DPO ≈ einer Periodenlänge liefert der Rollforward dasselbe wie die frühere
  // Tages-Kennzahl — nachgemessen: Abweichung 0. Er rechnet aber auch dann richtig,
  // wenn das Zahlungsziel von diesem Zufall abweicht.
  const dppPay = 365 / ppy;
  for (let p = 0; p < n; p++) {
    const amount = costIncurred[p];
    if (amount === 0) continue;
    const lag = Math.max(0, dpo[p] ?? 0) / dppPay;
    const k = Math.floor(lag);
    const frac = lag - k;
    const first = round(amount * (1 - frac));
    if (p + k < n) payments[p + k] += first;
    const second = amount - first;
    if (second !== 0 && p + k + 1 < n) payments[p + k + 1] += second;
  }

  // --- Rollforward und NWC --------------------------------------------------
  let recRunning = 0;   // Eröffnungsforderungen stecken in openingNwc (s. o.)
  let payRunning = 0;   // Eröffnungsverbindlichkeiten ebenso
  for (let p = 0; p < n; p++) {
    recRunning += billedNet[p] - collections[p];
    receivables[p] = recRunning;
    payRunning += costIncurred[p] - payments[p];
    payables[p] = payRunning;
    // Fertigerzeugnisse: erst mit einem Lieferplan sinnvoll (wc.inv steht auf 0). Die
    // wachsende Kultur steckt NICHT hier, sondern im Feldbestand — keine Doppelzählung.
    inventory[p] = (cogs[p] * ppy * invDays[p]) / 365;
    nwc[p] = inventory[p] + receivables[p] + bioAssets[p] - payables[p] - customerAdvances[p];
    wcChange[p] = nwc[p] - (p === 0 ? openingNwc : nwc[p - 1]);
  }
  return {
    receivables, inventory, payables, customerAdvances, advanceMovement,
    advanceCost, advanceSecurityFee, collections, payments, bioAssets, nwc, wcChange,
  };
}

/* --------------------------------------------------------------------------
 * Kostenstelle Lager & Packhaus — Deckungsbeitragsrechnung
 * --------------------------------------------------------------------------
 * Das Lager ist seit dem Dienstleistungsmodell ein Profit Center mit EXTERNEM
 * Erlös: die Ware wird bei der Ernte verkauft, das Eigentum geht über, die
 * Einlagerung wird separat berechnet. Diese Funktion stellt Erlös und Kosten
 * gegenüber und leitet die beiden Zahlen ab, um die es wirtschaftlich geht:
 *
 *   Break-even-Gebühr    ab welchem €/t·Monat trägt sich die Anlage?
 *   Break-even-Belegung  wie weit darf die Belegung fallen, bis sie es nicht mehr tut?
 *
 * Rein, deterministisch, ohne Seiteneffekte — wie computeHolding.
 * ------------------------------------------------------------------------ */
export interface StorageResult {
  feeRevenue: number[];
  energyCost: number[];
  handlingCost: number[];
  lossCost: number[];
  depreciation: number[];
  /** Ergebnis der Kostenstelle je Periode = Gebühr − Betrieb − Verlust − AfA. */
  result: number[];
  /** Eingelagerte Menge je Periode (Zugang, t). */
  storedIn: number[];
  /** Belegung zum Periodenende (t). */
  balanceT: number[];
  /** Höchste Belegung über den Horizont (t) — die Kapazität, die gebaut werden muss. */
  peakT: number;
  serviceMode: boolean;
  /** Angesetzte Gebühr in CENT je Tonne und Monat. */
  feePerTonneMonth: number;
  /** Gebühr, ab der sich die Anlage trägt (CENT je Tonne und Monat). */
  breakEvenFee: number;
  /** Belegung, ab der sich die Anlage trägt (t Jahresdurchsatz). */
  breakEvenTonnes: number;
  /** Dieselbe Schwelle als Anteil der geplanten Belegung (0..1). */
  breakEvenOccupancy: number;
  /** Referenzjahr der Break-even-Rechnung (0-basiert) — das letzte volle Jahr. */
  referenceYear: number;
}

export function computeStorage(state: ModelState, scenarioId: UUID): StorageResult {
  const n = state.timeline.periodCount;
  const ppy = periodsPerYear(state.timeline.baseGranularity);
  const chain = scenarioChain(state, scenarioId);
  const op = computeOperating(state, chain, n, ppy);

  // AfA der Lager-CAPEX, linear ab Anschaffung. Erfasst sowohl die abgeleiteten Träger
  // (cx-store, cx-store_tech) als auch die Detailplanzeilen der Blöcke lager/packhaus.
  const isStorageCapex = (id: string) =>
    id.startsWith('cx-store') || id.startsWith('cx-plan-lg-') || id.startsWith('cx-plan-pk-');
  const depreciation = zeros(n);
  for (const c of state.capex) {
    if (!isStorageCapex(c.id)) continue;
    const life = Math.max(1, c.usefulLifeMonths);
    const base = c.amount - (c.salvageValue ?? 0);
    for (let p = Math.max(0, c.purchasePeriod); p < Math.min(n, c.purchasePeriod + life); p++) {
      depreciation[p] += base / life;
    }
  }

  const result = zeros(n);
  for (let p = 0; p < n; p++) {
    result[p] = op.storageFeeRevenue[p] - op.storageEnergyCost[p]
              - op.storageHandlingCost[p] - op.storageLossCost[p] - depreciation[p];
  }

  const peakT = op.storedTonnesBalance.reduce((m, v) => Math.max(m, v), 0);
  const serviceMode = (state.assumptions['store.service_mode']
    ? (resolveAssumption(state, 'store.service_mode', chain, n, ppy)[0] ?? 1) : 1) >= 0.5;
  const feePerTonneMonth = state.assumptions['store.fee_per_t_month']
    ? (resolveAssumption(state, 'store.fee_per_t_month', chain, n, ppy)[0] ?? 0) : 0;

  /* Break-even auf einem eingeschwungenen Jahr — das letzte VOLLE Jahr des Horizonts.
   * Das erste Jahr taugt nicht: dort ist das Lager oft noch nicht verfügbar. */
  const years = Math.max(1, Math.floor(n / ppy));
  const refY = Math.max(0, years - 1);
  const yr = (arr: number[]) => {
    let s = 0;
    for (let p = refY * ppy; p < Math.min(n, (refY + 1) * ppy); p++) s += arr[p];
    return s;
  };
  const feeY = yr(op.storageFeeRevenue);
  const varY = yr(op.storageEnergyCost) + yr(op.storageHandlingCost) + yr(op.storageLossCost);
  const fixY = yr(depreciation);
  // Gebühr, bei der Erlös = Gesamtkosten. Der Erlös ist linear in der Gebühr.
  const breakEvenFee = feeY > 0 ? (feePerTonneMonth * (varY + fixY)) / feeY : 0;
  // Belegung, bei der der Deckungsbeitrag die Fixkosten deckt. Gebühr und variable Kosten
  // skalieren beide mit der Menge, die AfA nicht.
  const tonnesY = yr(op.storedTonnesIn);
  const contribPerT = tonnesY > 0 ? (feeY - varY) / tonnesY : 0;
  const breakEvenTonnes = contribPerT > 0 ? fixY / contribPerT : 0;
  const breakEvenOccupancy = tonnesY > 0 ? breakEvenTonnes / tonnesY : 0;

  return {
    feeRevenue: op.storageFeeRevenue,
    energyCost: op.storageEnergyCost,
    handlingCost: op.storageHandlingCost,
    lossCost: op.storageLossCost,
    depreciation, result,
    storedIn: op.storedTonnesIn,
    balanceT: op.storedTonnesBalance,
    peakT, serviceMode, feePerTonneMonth,
    breakEvenFee, breakEvenTonnes, breakEvenOccupancy, referenceYear: refY,
  };
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
  return computeWorkingCapital(
    state, chain, n, ppy, op.revenue, op.cogs, op.costIncurred, op.bioAssets,
    op.receiptTerms, op.advances,
  );
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

/* ENTFERNT 31.07.2026: consolidateGroup — Konzern-Aggregation über mehrere Gesellschaften.
   Die Funktion hatte im gesamten Repo keinen einzigen Aufrufer. computeHolding bleibt:
   die NEOS Holding GmbH wird weiterhin gerechnet. */

/** Ein fakturierter Erlösstrom mit eigenem Zahlungsziel (Paket B).
 *  Σ aller Terme einer Periode == revenue[p] (exakt, Restbetrag im letzten Term). */
export interface ReceiptTerm {
  /** Periode der Rechnungsstellung (= Ernte-/Lieferperiode). */
  period: number;
  /** Betrag in CENT. */
  amount: number;
  /** Zusätzlicher Verzug in Kalendertagen ON TOP auf das einheitliche Zahlungsziel.
   *  Nur für separat fakturierte Tranchen (Qualitäts-/Lagerbonus mit Kalendertrigger).
   *  Das Zahlungsziel selbst ist NICHT kontraktbezogen — siehe computeWorkingCapital. */
  extraDelayDays?: number;
  /** Kultur, aus der der Strom stammt (Zweitfrucht: die der Hauptkultur). */
  cropId?: string;
  /** Vertrag, aus dem der Strom stammt. undefined → Spot/Restmenge oder Zweitfrucht. */
  contractId?: string;
  /** true → Bonustranche (separat fakturiert, eigenes verzögertes Zahlungsziel). */
  isBonus?: boolean;
  /** true → gegen diesen Strom darf eine erhaltene Anzahlung verrechnet werden. */
  advanceEligible?: boolean;
}

/** Ein Anzahlungszufluss (Paket B). Kein Umsatz — Kasse + Vertragsverbindlichkeit.
 *  Bemessen am geplanten Erntewert der einbezogenen Kulturen, nicht am Einzelvertrag. */
export interface AdvanceFlow {
  /** Periode des Zuflusses. */
  period: number;
  /** Betrag in CENT = geplanter Erntewert des Jahres × Quote. */
  amount: number;
  /** Erntejahr, auf das sich die Anzahlung bezieht. */
  year: number;
  settlement: 'firstDeliveries' | 'finalInvoice';
  /** Skonto/Zins p. a. auf den ausstehenden Betrag → Finanzaufwand. */
  costRate: number;
  /** Avalprovision p. a. auf die besicherte Summe → OpEx. */
  securityFeeRate: number;
}

interface OperatingResult {
  revenue: number[];
  /** In die GuV ENTLASSENE Produktionskosten — bei der Ernte, nicht bei Kostenentstehung.
   *  Siehe Feldbestand-Aktivierung unten. */
  cogs: number[];
  /** Tatsächlich ENTSTANDENE Direktkosten je Periode (Aussaat, Dünger, PSM, Arbeitsgänge).
   *  Treibt die Verbindlichkeiten und den Zahlungsstrom — NICHT die GuV. */
  costIncurred: number[];
  /** Feldbestand (wachsende Kultur) zu Herstellungskosten, Periodenendstand. */
  bioAssets: number[];
  subsidies: number[];
  inventoryValue: number[]; // Ende-Bestand geernteter, noch nicht verkaufter Ware
  outputVat: number[];      // Ausgangs-USt (TVA colectată) je Periode — 0 bei Reverse-Charge/Export
  /** Fakturierte Erlösströme mit Zahlungsziel — Grundlage des Forderungs-Rollforwards. */
  receiptTerms: ReceiptTerm[];
  /** Anzahlungszuflüsse je Vertrag und Jahr. */
  advances: AdvanceFlow[];
  /** Deckungskauf-Aufwand bei Untererfüllung kontrahierter Mengen (Paket C) — Betriebsaufwand. */
  coverPurchaseCost: number[];
  /** Betriebskosten der Lagerung gesamt (Energie + Handling + Verlust) — Betriebsaufwand. */
  storageCost: number[];
  storageEnergyCost: number[];
  storageHandlingCost: number[];
  /** Wert der Lagerverluste: Ersatzpflicht (Dienstleistung) bzw. Mengenverlust (Eigenlager). */
  storageLossCost: number[];
  /** Eingelagerte Tonnage je Periode (Zugang) — für Belegung und Kostenstelle. */
  storedTonnesIn: number[];
  /** Lagerbestand in Tonnen zum Periodenende — Belegungskurve. */
  storedTonnesBalance: number[];
  /** Erlösaufschlag aus der Lagergebühr — der Ertrag der Kostenstelle Lager. */
  storageFeeRevenue: number[];
}

function computeOperating(
  state: ModelState,
  chain: UUID[],
  n: number,
  ppy: number,
): OperatingResult {
  const revenue = zeros(n);
  // Entstandene Direktkosten (nicht die GuV-Zeile!). Die GuV bekommt sie erst bei der
  // Ernte über die Feldbestand-Aktivierung weiter unten.
  const costIncurred = zeros(n);
  const subsidies = zeros(n);
  /** Kostenstrom: entstandene Kosten (nach Kohorte getrennt) und Ernteperioden über den
   *  Horizont. Der Strom, nicht die einzelne Planzeile, ist die richtige Einheit — bei
   *  Winterkulturen liegt die Aussaat für die nächste Ernte in derselben Planzeile
   *  NACH deren Ernte (weizen: Ernte Periode 6, Aussaat Periode 9).
   *
   *  Der Schlüssel trennt die ZWEITFRUCHT vom Hauptfruchtstrom (`|2` am Ende), obwohl
   *  beide dieselbe cropId tragen. Ohne diese Trennung lagen die Gerste-Herbstaussaat
   *  (Oktober) und die Soja-Ernte (ebenfalls Oktober) im selben Strom, und die Aussaat
   *  wurde bei der Soja-Ernte in die GuV entlassen statt bei der Gerstenernte des
   *  Folgejahres. Die Trennung löst das ohne jede Datenpflege. */
  interface CostStream { cur: number[]; next: number[]; harvest: Set<number> }
  const streams = new Map<string, CostStream>();
  const streamOf = (plan: CropPlan, second = false) =>
    `${plan.parcelId}|${plan.cropId}${second ? '|2' : ''}`;
  const getStream = (key: string): CostStream => {
    let st = streams.get(key);
    if (!st) { st = { cur: zeros(n), next: zeros(n), harvest: new Set<number>() }; streams.set(key, st); }
    return st;
  };
  const addStreamCost = (key: string, p: number, amount: number, cohort?: 'current' | 'next') => {
    const st = getStream(key);
    (cohort === 'next' ? st.next : st.cur)[p] += amount;
  };
  const addStreamHarvest = (key: string, p: number) => { getStream(key).harvest.add(p); };
  const inventoryValue = zeros(n);
  const outputVat = zeros(n);
  const vat = state.vat;
  const outRate = (cropId: string): number => {
    if (!vat || !vat.enabled) return 0;
    const t = vat.outputByCrop?.[cropId] ?? 'standard';
    return t === 'standard' ? vat.standardRate : t === 'reduced' ? vat.reducedRate : 0; // reverse_charge/export/zero → 0
  };

  // --- Durchgang 1: Netto-Erntemengen je Plan/Periode -----------------------
  // Die Vertragsaufteilung braucht die Gesamtmenge je Kultur, BEVOR der Umsatz
  // gerechnet wird — deshalb zwei Durchgänge über die Anbaupläne.
  interface PlanCalc {
    plan: CropPlan;
    priceEurT: number[];   // Spot-/Kulturpreis aus den Annahmen (CENT/t)
    qual: number[];        // Qualitätserfüllung 0..1 (1 = voll)
    netT: number[];        // Netto-Erntemenge in t je Periode
  }
  const calcs: PlanCalc[] = state.cropPlans.map((plan) => {
    const yieldTHa = resolveAssumption(state, plan.yieldAssumptionKey, chain, n, ppy);
    const priceEurT = resolveAssumption(state, plan.priceAssumptionKey, chain, n, ppy);
    const lossRate = plan.lossRateAssumptionKey
      ? resolveAssumption(state, plan.lossRateAssumptionKey, chain, n, ppy)
      : zeros(n);
    const qualFactor = plan.qualityAssumptionKey
      ? resolveAssumption(state, plan.qualityAssumptionKey, chain, n, ppy)
      : null;
    const qual = zeros(n).map((_, p) => (qualFactor ? (qualFactor[p] > 0 ? qualFactor[p] : 1) : 1));
    const netT = zeros(n);
    for (const p of plan.harvestPeriods) {
      if (p < 0 || p >= n) continue;
      const mf = maturityFactor(state, plan, p, ppy);
      netT[p] = yieldTHa[p] * mf * plan.areaHa * (1 - lossRate[p]);   // t
    }
    return { plan, priceEurT, qual, netT };
  });

  // --- Abnahmeverträge: Mischpreis je Kultur und JAHR ------------------------
  // Kontraktmengen sind Jahresmengen; der Anteil gilt dann in allen Ernteperioden
  // des Jahres. Ohne Vertrag bleibt share = 0 → voller Kulturpreis (Rückfall).
  const years = Math.max(1, Math.ceil(n / ppy));
  const tonnesByCropYear = new Map<string, number[]>();
  for (const c of calcs) {
    let arr = tonnesByCropYear.get(c.plan.cropId);
    if (!arr) { arr = new Array(years).fill(0); tonnesByCropYear.set(c.plan.cropId, arr); }
    for (let p = 0; p < n; p++) arr[Math.floor(p / ppy)] += c.netT[p];
  }
  const byCrop = new Map<string, OfftakeContract[]>();
  for (const c of state.offtake ?? []) {
    if (c.active === false) continue;
    const l = byCrop.get(c.cropId);
    if (l) l.push(c); else byCrop.set(c.cropId, [c]);
  }
  // Indexierung der Kontraktpreise: Die vorliegenden Verträge sind JAHRESverträge
  //  (Laufzeit bis 2026/27) — im Mehrjahresplan wird also jedes Jahr neu kontrahiert.
  //  Deshalb wachsen die Kontraktpreise ab Jahr 2 mit derselben Output-Inflation wie
  //  der Spotpreis (buildModelState/curveInfl, iOut). Jahr 1 = unterschriebener Preis.
  //  Ohne diesen Schritt fiele der Mischpreis nur deshalb hinter den Spot zurück, weil
  //  ein Einjahresvertrag über acht Jahre fortgeschrieben wird — ein Artefakt, keine Aussage.
  // Zurückweisungsquote am Werkstor (Paket C): EINHEITLICH für Kontrakt- und Spotmengen.
  // Wirkt als Erlösabschlag; die Produktionskosten bleiben unberührt, weil die Ware gewachsen
  // und geerntet ist. Der Rücktransport zurückgewiesener Ware (VIA AGRO 6.7) ist NICHT bewertet.
  const rejectSeries = resolveAssumption(state, "quality.reject", chain, n, ppy);
  /* --- Vermarktungskanal: direkt ab Feld gegen Lager -------------------------
   * Die Planung ist von den Bestandsverträgen gelöst (die galten für 2025). Gerechnet wird
   * mit zwei Kanälen je Kultur: die Tonnage, die DIREKT ab Feld weggeht, und die Tonnage,
   * die EINGELAGERT wird. Lagerware erlöst später (Erntemonat + Lagerdauer), zum Preis des
   * Auslagerungsmonats PLUS einem Aufschlag je Tonne und Lagermonat, den der Abnehmer zahlt.
   * Der Schwund mindert die lieferbare MENGE, nicht die Kosten — die Herstellungskosten der
   * verdorbenen Ware stecken bereits im Feldbestand. */
  const has = (k: string) => !!state.assumptions[k];
  // MASTER-SCHALTER: store.active = 0 → gar keine Einlagerung. Weder Lagererlös noch Lager-
  //  kosten noch Verwahrerhaftung; die gesamte Ernte wird bei der Ernte direkt verkauft.
  const storeAktiv = !has("store.active")
    || (resolveAssumption(state, "store.active", chain, n, ppy)[0] ?? 1) >= 0.5;
  const storeShareOf = (cropId: string): number => {
    if (!storeAktiv) return 0;
    const k = `store.share.${cropId}`;
    if (!has(k)) return 0;                       // ohne Quote: alles direkt ab Feld
    const v = resolveAssumption(state, k, chain, n, ppy)[0] ?? 0;
    return Math.max(0, Math.min(1, v));
  };
  // Das Lager existiert heute nicht — vor der Fertigstellung geht alles direkt ab Feld weg.
  const storeFromP = has("store.from_month")
    ? Math.max(0, Math.round(resolveAssumption(state, "store.from_month", chain, n, ppy)[0] ?? 0)) : 0;
  const storeMonthsSeries = has("store.months")
    ? resolveAssumption(state, "store.months", chain, n, ppy) : null;
  const storeMonthsOf = (cropId: string): number => {
    const k = `store.months.${cropId}`;
    const v = has(k)
      ? (resolveAssumption(state, k, chain, n, ppy)[0] ?? 0)
      : (storeMonthsSeries ? (storeMonthsSeries[0] ?? 0) : 0);
    return Math.max(0, Math.round(v));
  };
  /* DIENSTLEISTUNGSMODELL (Standard) gegen EIGENLAGER — der Unterschied ist strukturell:
   *
   *  Dienstleistung: Die Ware wird bereits bei der ERNTE verkauft, das Eigentum geht auf den
   *    Abnehmer über, sie bleibt aber in unserem Lager. Erlös aus der Ware entsteht im
   *    Erntemonat, die Forderung ebenso — der Abnehmer finanziert den Bestand, nicht wir.
   *    Die Einlagerung ist eine SEPARATE Leistung und wird über die Lagermonate abgegrenzt.
   *    Wir sind Verwahrer: Schwund geht zu unseren Lasten, aber als Ersatzpflicht zum
   *    Warenwert, nicht als entgangener Erlös.
   *
   *  Eigenlager: Die Ware bleibt unser Eigentum und wird erst bei der Auslagerung verkauft.
   *    Erlös und Forderung entstehen später, wir tragen die Kapitalbindung — und im ersten
   *    Lagerjahr fällt ein voller Herbstumsatz ins Folgejahr.
   *
   *  Wirtschaftlich unterscheiden sich die Modelle in drei Punkten: Zeitpunkt des Erlöses,
   *  wer den Bestand finanziert, und wer die Preisentwicklung über den Winter bekommt. */
  const serviceMode = has("store.service_mode")
    ? (resolveAssumption(state, "store.service_mode", chain, n, ppy)[0] ?? 1) >= 0.5 : true;
  const feeSeries = has("store.fee_per_t_month")
    ? resolveAssumption(state, "store.fee_per_t_month", chain, n, ppy) : null;
  const energySeries = has("store.energy_per_t_month")
    ? resolveAssumption(state, "store.energy_per_t_month", chain, n, ppy) : null;
  const handlingSeries = has("store.handling_per_t")
    ? resolveAssumption(state, "store.handling_per_t", chain, n, ppy) : null;
  const lossSeries = has("store.loss_rate")
    ? resolveAssumption(state, "store.loss_rate", chain, n, ppy) : null;
  const storageEnergyCost = zeros(n);
  const storageHandlingCost = zeros(n);
  const storageLossCost = zeros(n);
  const storedTonnesIn = zeros(n);
  const storedTonnesOut = zeros(n);
  const storageFeeRevenue = zeros(n);
  const acceptAt = (p: number) => 1 - Math.max(0, Math.min(1, rejectSeries[p] ?? 0));
  const inflOutSeries = resolveAssumption(state, "infl.output", chain, n, ppy);
  const offtakeIdx = (y: number) => Math.pow(1 + (inflOutSeries[Math.min(y * ppy, n - 1)] ?? 0), y);
  /** Ein Vertragsanteil eines Kultur-Jahres, nach Kürzung bei Übervergabe.
   *  Basis- und Bonuspreis bleiben GETRENNT, weil sie unterschiedliche Zahlungsziele
   *  tragen (VIA AGRO: Bonus separat fakturiert, frühestens ab 01.12.) — Paket B. */
  interface MixPart { c: OfftakeContract; s: number; base: number; bonus: number }
  /** cropId → je Jahr { share: kontrahierter Mengenanteil, price: mengengewichteter Kontraktpreis }. */
  const mix = new Map<string, { share: number; price: number; parts: MixPart[] }[]>();
  for (const [cropId, list] of byCrop) {
    const tons = tonnesByCropYear.get(cropId);
    mix.set(cropId, Array.from({ length: years }, (_, y) => {
      const total = tons ? tons[y] : 0;
      const idx = offtakeIdx(y);
      let share = 0, valued = 0;
      const parts: MixPart[] = [];
      for (const c of list) {
        const s = c.volumeMode === 'tonnes'
          ? (total > 0 ? Math.min(1, (c.tonnesPerYear ?? 0) / total) : 0)
          : Math.max(0, Math.min(1, c.share ?? 0));
        if (s <= 0) continue;
        // Realisierter Kontraktpreis: (Basis + erwarteter Bonus/Malus) × Indexierung.
        // Die Zurückweisungsquote steckt NICHT hier, sondern einheitlich im Erlösabschlag
        // (quality.reject) — sonst würde sie doppelt gezählt. OfftakeContract.rejectRate ist
        // seit Paket C dokumentarisch.
        const keep = idx;
        const base = c.priceCentPerTonne * keep;
        const bonus = (c.bonusCentPerTonne ?? 0) * keep;
        const eff = base + bonus;
        share += s; valued += s * eff;
        parts.push({ c, s, base, bonus });
      }
      // Übervergabe (Σ > 100 %): es gibt nur eine Ernte → proportional kürzen.
      if (share > 1) {
        for (const pt of parts) pt.s /= share;
        valued /= share; share = 1;
      }
      return { share, price: share > 0 ? valued / share : 0, parts };
    }));
  }

  // --- Anzahlungen der Off-taker: Quote auf den GEPLANTEN ERNTEWERT ----------
  // Bemessungsgrundlage ist nicht der Einzelvertrag, sondern der geplante Erntewert
  // (Fläche × Ertrag × Mischpreis) der einbezogenen Kulturen — siehe HarvestAdvancePolicy.
  // Damit skaliert die Vorfinanzierung automatisch mit dem Anbauplan und damit mit
  // Wachstumsszenarien. Der Erntewert je Jahr wird in Durchgang 2 aufsummiert.
  const advPolicy = state.harvestAdvance;
  const advActive = !!advPolicy && advPolicy.active !== false;
  const advCropIds = advPolicy?.cropIds && advPolicy.cropIds.length
    ? new Set(advPolicy.cropIds) : null;                 // null → alle Kulturen
  const advEligible = (cropId: string) => advActive && (!advCropIds || advCropIds.has(cropId));
  const advRate = advActive
    ? resolveAssumption(state, advPolicy!.rateAssumptionKey, chain, n, ppy) : null;
  const advCostRate = advActive && advPolicy!.costRateAssumptionKey
    ? resolveAssumption(state, advPolicy!.costRateAssumptionKey, chain, n, ppy) : null;
  const advFeeRate = advActive && advPolicy!.securityFeeRateAssumptionKey
    ? resolveAssumption(state, advPolicy!.securityFeeRateAssumptionKey, chain, n, ppy) : null;
  /** Geplanter Erntewert je Jahr über die einbezogenen Kulturen (CENT). */
  const advBaseByYear = new Array(years).fill(0);

  // --- Durchgang 2: Umsatz, Zweitfrucht, Produktionskosten ------------------
  const receiptTerms: ReceiptTerm[] = [];
  for (const calc of calcs) {
    const plan = calc.plan;
    const mixYears = mix.get(plan.cropId);

    for (const p of plan.harvestPeriods) {
      if (p < 0 || p >= n) continue;
      const m = mixYears?.[Math.floor(p / ppy)];
      const spot = calc.priceEurT[p];
      // Mischpreis: kontrahierter Anteil zum Vertragspreis, Rest zum Kulturpreis.
      const blended = m && m.share > 0 ? m.share * m.price + (1 - m.share) * spot : spot;
      // Kontrakt-Qualitätserfüllung: realisierter Preis nach Bonus/Malus × akzeptierte Menge (0..1).
      /* Kanal-Split: die eingelagerte Tonnage erlöst später und teurer, die Direktware
       * sofort zum Feldpreis. Ohne Einlagerungsquote ist storedT = 0 und es bleibt exakt
       * beim bisherigen Verhalten. */
      const share = p >= storeFromP ? storeShareOf(plan.cropId) : 0;
      const months = share > 0 ? storeMonthsOf(plan.cropId) : 0;
      const storedT = calc.netT[p] * share;
      const directT = calc.netT[p] - storedT;

      // Erlösabschlag Zurückweisung: die zurückgewiesene Menge wird nicht bezahlt.
      let rev = round(directT * blended * calc.qual[p] * acceptAt(p));

      if (storedT > 0) {
        const outP = p + months;
        // Mengenstrom und Betriebskosten fallen in JEDEM Fall an — auch wenn die Auslagerung
        // jenseits des Horizonts liegt.
        storedTonnesIn[p] += storedT;
        const handling = handlingSeries ? (handlingSeries[p] ?? 0) : 0;
        storageHandlingCost[p] += round(storedT * handling);      // Ein-/Auslagerung, Durchsatz
        const energy = energySeries ? (energySeries[p] ?? 0) : 0;
        for (let q = p + 1; q <= Math.min(outP, n - 1); q++) {
          storageEnergyCost[q] += round(storedT * energy);         // Energie je Lagermonat
        }

        // Lagerverlust auf die GESAMTE eingelagerte Menge, nicht je Monat.
        const lossRate = lossSeries ? Math.max(0, Math.min(1, lossSeries[p] ?? 0)) : 0;

        if (serviceMode) {
          /* --- Ware bei der Ernte verkauft, Lagerung als Dienstleistung --------------- */
          // Der Warenerlös entsteht JETZT, zusammen mit der Direktware — Eigentum geht über,
          // die Ware bleibt nur physisch bei uns.
          rev += round(storedT * blended * calc.qual[p] * acceptAt(p));
          storedTonnesOut[Math.min(outP, n - 1)] += storedT;
          // Lagergebühr über die Lagermonate abgegrenzt (Leistung wird über die Zeit erbracht).
          for (let q = p + 1; q <= Math.min(outP, n - 1); q++) {
            const feeQ = feeSeries ? (feeSeries[q] ?? 0) : 0;
            const feeRev = round(storedT * feeQ);
            if (feeRev === 0) continue;
            storageFeeRevenue[q] += feeRev;
            revenue[q] += feeRev;
            outputVat[q] += round(feeRev * outRate(plan.cropId));
            receiptTerms.push({ period: q, amount: feeRev, cropId: plan.cropId });
          }
          // Verwahrerhaftung: Schwund geht zu unseren Lasten — als Ersatzpflicht zum
          // WARENWERT, nicht als entgangener Erlös. Eine vertragliche Schwundtoleranz
          // (marktüblich) würde diesen Posten deckeln; hier bewusst ungedeckelt angesetzt.
          const lossT = storedT * lossRate;
          storageLossCost[Math.min(outP, n - 1)] += round(lossT * blended);
        } else if (outP < n) {
          /* --- Eigenlager: Verkauf erst bei der Auslagerung --------------------------- */
          const outT = storedT * Math.max(0, 1 - lossRate);        // Verlust mindert die Menge
          const fee = feeSeries ? (feeSeries[outP] ?? 0) : 0;
          const spotOut = calc.priceEurT[outP] ?? blended;
          const mOut = mixYears?.[Math.floor(outP / ppy)];
          const baseOut = mOut && mOut.share > 0
            ? mOut.share * mOut.price + (1 - mOut.share) * spotOut : spotOut;
          const revStored = round(outT * (baseOut + fee * months) * calc.qual[outP] * acceptAt(outP));
          storageFeeRevenue[outP] += round(outT * fee * months * calc.qual[outP] * acceptAt(outP));
          storedTonnesOut[outP] += storedT;
          if (outP === p) {
            rev += revStored;                   // Lagerdauer 0 → gleiche Periode
          } else {
            revenue[outP] += revStored;
            outputVat[outP] += round(revStored * outRate(plan.cropId));
            if (advEligible(plan.cropId)) advBaseByYear[Math.floor(outP / ppy)] += revStored;
            if (revStored !== 0) {
              receiptTerms.push({
                period: outP, amount: revStored, cropId: plan.cropId,
                advanceEligible: advEligible(plan.cropId) || undefined,
              });
            }
          }
        }
        // Eigenlager mit outP >= n: die Ware ist am Horizontende noch nicht verkauft — kein
        // Umsatz, sie bleibt im Lagerbestand stehen.
      }
      revenue[p] += rev;
      outputVat[p] += round(rev * outRate(plan.cropId));           // Ausgangs-USt (0 bei Reverse-Charge)

      // Zahlungs-Timing (Paket B): denselben Umsatz nach Preisgewichten in Ströme mit
      // eigenem Zahlungsziel zerlegen. Σ Terme == rev EXAKT — der Restbetrag aus der
      // Rundung landet im Spot-Term, damit der Forderungs-Rollforward nicht driftet.
      if (rev !== 0) {
        const elig = advEligible(plan.cropId) || undefined;
        if (elig) advBaseByYear[Math.floor(p / ppy)] += rev;
        // Das Zahlungsziel ist EINHEITLICH (wc.dso) und nicht kontraktbezogen — die Aufteilung
        // hier dient nur noch der Bonustranche, die als separat fakturierter Strom einen
        // Zusatzverzug tragen kann (VIA AGRO: Qualitäts-/Lagerbonus erst ab 01.12.).
        const weights: { w: number; extraDelayDays?: number; contractId?: string; isBonus?: boolean }[] = [];
        if (m && m.share > 0 && blended > 0) {
          for (const pt of m.parts) {
            if (pt.base !== 0) weights.push({ w: pt.s * pt.base, contractId: pt.c.id });
            if (pt.bonus !== 0) weights.push({
              w: pt.s * pt.bonus,
              extraDelayDays: pt.c.bonusDelayDays ?? 0,
              contractId: pt.c.id,
              isBonus: true,
            });
          }
        }
        let allocated = 0;
        for (const wt of weights) {
          const amount = round((rev * wt.w) / blended);
          if (amount === 0) continue;
          allocated += amount;
          receiptTerms.push({
            period: p, amount, extraDelayDays: wt.extraDelayDays, cropId: plan.cropId,
            contractId: wt.contractId, isBonus: wt.isBonus, advanceEligible: elig,
          });
        }
        // Spot-/Restmenge trägt dasselbe einheitliche Zahlungsziel und den Rundungsrest.
        const rest = rev - allocated;
        if (rest !== 0) receiptTerms.push({ period: p, amount: rest, cropId: plan.cropId, advanceEligible: elig });
      }
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
        const rev2 = round(netT * p2[hp] * acceptAt(hp));
        revenue[hp] += rev2;
        outputVat[hp] += round(rev2 * outRate(plan.cropId));
        // Zweitfrucht läuft ohne Abnahmevertrag → globaler DSO, keine Vorfinanzierung.
        if (rev2 !== 0) receiptTerms.push({ period: hp, amount: rev2, cropId: plan.cropId });
        // Zweitfrucht-Betriebsmittel: EIGENER Kostenstrom, und kostenwirksam zur AUSSAAT
        // (unmittelbar nach der Hauptfruchternte), nicht erst im Erntemonat der Zweitfrucht.
        const k2 = streamOf(plan, true);
        const c2 = round(s2.extraCostPerHaCent * plan.areaHa);
        const sowMain = plan.harvestPeriods.filter((x) => x >= 0 && x < n);
        const cp2 = s2.costPeriod ?? (sowMain.length ? Math.max(...sowMain) : hp);
        const cp2c = cp2 >= 0 && cp2 < n ? cp2 : hp;
        costIncurred[cp2c] += c2;
        addStreamCost(k2, cp2c, c2);
        addStreamHarvest(k2, hp);                                       // Zweitfrucht-Ernte
      }
    }

    // Produktionskosten: bottom-up (operations) oder Fallback (Punktlast).
    // ENTSTEHUNG, nicht GuV — die Zuordnung zur Ernte erfolgt über den Feldbestand.
    // Die Kohorte je Arbeitsgang (Operation.cohort) wird dabei mitgeführt.
    const kMain = streamOf(plan);
    const { perPeriodPerHa, perPeriodPerHaNext } = cropCostPerHa(plan, state, chain, n, ppy);
    for (let p = 0; p < n; p++) {
      const c = round(perPeriodPerHa[p] * plan.areaHa);
      if (c !== 0) { costIncurred[p] += c; addStreamCost(kMain, p, c, 'current'); }
      const cN = round(perPeriodPerHaNext[p] * plan.areaHa);
      if (cN !== 0) { costIncurred[p] += cN; addStreamCost(kMain, p, cN, 'next'); }
    }
    for (const h of plan.harvestPeriods) if (h >= 0 && h < n) addStreamHarvest(kMain, h);
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

  // --- Anzahlungsplan: Quote × geplanter Erntewert, Zufluss im Policy-Monat --
  // Der Zufluss liegt VOR der Ernte desselben Jahres (typisch beim Legen) — genau in das
  // Liquiditätsloch, das die Direktkosten von Februar bis September aufreißen.
  const advances: AdvanceFlow[] = [];
  if (advActive && advRate) {
    // Kalendermonat 1–12 → Periodenindex innerhalb des Jahres (granularitätsfest).
    const m0 = Math.min(12, Math.max(1, Math.round(advPolicy!.month || 3))) - 1;
    const off = Math.min(ppy - 1, Math.floor((m0 * ppy) / 12));
    for (let y = 0; y < years; y++) {
      const period = y * ppy + off;
      if (period < 0 || period >= n) continue;
      const rate = advRate[period] ?? 0;
      const amount = round(advBaseByYear[y] * rate);
      if (amount <= 0) continue;
      advances.push({
        period,
        amount,
        year: y,
        settlement: advPolicy!.settlement ?? 'firstDeliveries',
        costRate: advCostRate ? (advCostRate[period] ?? 0) : 0,
        securityFeeRate: advFeeRate ? (advFeeRate[period] ?? 0) : 0,
      });
    }
  }

  /* --- Feldbestand aktivieren (Matching-Prinzip) ----------------------------
   * Vorher liefen die Direktkosten in dem Monat in die GuV, in dem sie ENTSTANDEN.
   * Bei einer Kultur, die von Februar bis August Kosten verursacht und im September
   * verkauft wird, zeigte der Monatsausweis dadurch sieben Monate Verlust und einen
   * Gewinnsprung im Erntemonat — Aufwand ohne den zugehörigen Erlös.
   *
   * Jetzt wandern die Kosten zunächst als Feldbestand (wachsende Kultur, bewertet zu
   * Herstellungskosten) in die BILANZ und werden erst bei der Ernte in die GuV entlassen:
   *
   *   Feldbestand[p] = Feldbestand[p−1] + entstanden[p] − entlassen[p]
   *
   * Entlassen wird je Kostenstrom (parcelId × cropId) bei jeder Ernte alles, was seit
   * der VORHERIGEN Ernte dieses Stroms aufgelaufen ist. Damit ordnet sich die Herbst-
   * aussaat einer Winterkultur automatisch der Ernte des Folgejahres zu, obwohl sie in
   * derselben Planzeile hinter deren Ernte steht.
   *
   * GRENZE DIESER HEURISTIK: Die Arbeitsgänge tragen keine Kohorten-Kennung. Fallen in
   * EINEM Monat die Ernte einer Zweitfrucht und die Aussaat der Folgekultur zusammen
   * (Gerste/Soja im Oktober), wird beides gemeinsam entlassen — das Modell kann die
   * beiden Kostenblöcke nicht trennen. Auf das JAHR wirkt das nicht, weil beide im
   * selben Jahr liegen; im Monatsausweis ist die Trennschärfe dort begrenzt.
   *
   * Ein am Horizontende noch nicht entlasteter Rest bleibt bewusst als Feldbestand in
   * der Bilanz stehen — richtig für einen abgeschnittenen Planungszeitraum.
   * NICHT zahlungswirksam: der Zahlungsstrom folgt `costIncurred`, nicht `cogs`. */
  const cogs = zeros(n);
  /* ERÖFFNUNGS-FELDBESTAND — ohne ihn entsteht ein Modellrand-Artefakt.
   * Die Kultur, die im Juli des ersten Planjahres geerntet wird, wurde im Herbst DAVOR
   * gesät — vor Periode 0. Diese Vorkosten stehen nirgends im Modell. Würde man die
   * Aktivierung ohne Eröffnungsbestand einführen, entlastete Jahr 1 eine Ernte, für die
   * es nie bezahlt hat: das EBITDA des ersten Jahres stieg um rund 175 T€, ohne dass sich
   * wirtschaftlich etwas verbessert hätte.
   *
   * In-Modell-Proxy: die Herbstarbeit, die im ERSTEN Jahr nach der letzten Ernte dieses
   * Stroms anfällt — bei Winterweizen genau die Oktoberaussaat. Im stationären Zustand
   * stand am 1. Januar dasselbe im Boden. Der Proxy ist bewusst abgeleitet und nicht
   * gesetzt, damit er bei jeder Flächenänderung mitskaliert (Wachstumsszenarien).
   *
   * GRENZE: Fallen Ernte einer Zweitfrucht und Herbstaussaat in denselben Monat
   * (Gerste/Soja, Oktober), erkennt der Proxy die Aussaat nicht und liefert 0 — dann
   * bleibt Jahr 1 um diesen Block zu günstig. Betroffen ist nur der Gerste-Soja-Strom. */
  const openingBio = new Map<string, number>();
  for (const [key, st] of streams) {
    const hs = [...st.harvest].sort((a, b) => a - b);
    const inYear1 = hs.filter((h) => h < ppy);
    let opening = 0;
    if (inYear1.length > 0) {
      for (let p = inYear1[inYear1.length - 1] + 1; p < Math.min(n, ppy); p++) {
        opening += st.cur[p] + st.next[p];
      }
    }
    if (opening > 0) openingBio.set(key, opening);
  }

  for (const [key, st] of streams) {
    // Zwei Töpfe: `bucket` sammelt die Kosten der nächsten Ernte, `bucketNext` die der
    // Ernte danach (Arbeitsgänge mit cohort='next'). Bei einer Ernte wird `bucket`
    // entlastet und `bucketNext` rückt nach.
    let bucket = openingBio.get(key) ?? 0;
    let bucketNext = 0;
    for (let p = 0; p < n; p++) {
      bucket += st.cur[p];
      bucketNext += st.next[p];
      if (st.harvest.has(p)) {
        if (bucket !== 0) cogs[p] += bucket;
        bucket = bucketNext;
        bucketNext = 0;
      }
    }
  }
  let openingBioTotal = 0;
  for (const v of openingBio.values()) openingBioTotal += v;

  const bioAssets = zeros(n);
  let bioRunning = openingBioTotal;
  for (let p = 0; p < n; p++) {
    bioRunning += costIncurred[p] - cogs[p];
    bioAssets[p] = bioRunning;
  }

  /* --- Deckungskauf bei Untererfüllung (Paket C) ----------------------------
   * Zwei der drei Verträge geben dem Abnehmer bei Untererfüllung ein Recht, zu Marktpreisen
   * zuzukaufen und NEOTERRA die Preisdifferenz in Rechnung zu stellen — bei PepsiCo ohne
   * Deckelung, bei VIA AGRO ab dem 15.11. (3.6) bzw. bei fehlendem Pflanzgutbeleg (5.10).
   * Das ist ein negativ korrelierter Cashflow: er entsteht genau dann, wenn die Ernte
   * schlecht ausfällt und die Marktpreise hoch stehen.
   *
   * Fehlmenge = kontrahierte Tonnage − tatsächlich zugeteilte Menge. Bei volumeMode 'share'
   * kann per Definition keine Fehlmenge entstehen (der Anteil folgt der Ernte). Gebucht wird
   * zur LETZTEN Ernteperiode der Kultur im jeweiligen Jahr — dann steht die Fehlmenge fest.
   * Läuft als Betriebsaufwand ins EBITDA, damit im Worst Case sichtbar wird, dass der
   * Ertragsausfall doppelt trifft: weniger Erlös UND Strafzahlung. */
  const coverPurchaseCost = zeros(n);
  const coverPremium = resolveAssumption(state, "market.cover_premium", chain, n, ppy);
  const lastHarvestOfCropYear = new Map<string, number>();
  for (const c of calcs) {
    for (const h of c.plan.harvestPeriods) {
      if (h < 0 || h >= n) continue;
      const k = `${c.plan.cropId}:${Math.floor(h / ppy)}`;
      const cur = lastHarvestOfCropYear.get(k);
      if (cur === undefined || h > cur) lastHarvestOfCropYear.set(k, h);
    }
  }
  for (const [cropId, list] of byCrop) {
    const tons = tonnesByCropYear.get(cropId);
    const mixYears = mix.get(cropId);
    if (!mixYears) continue;
    for (let y = 0; y < years; y++) {
      const period = lastHarvestOfCropYear.get(`${cropId}:${y}`);
      if (period === undefined) continue;
      const total = tons ? tons[y] : 0;
      let shortfall = 0;
      for (const c of list) {
        if (!c.coverPurchase || c.volumeMode !== 'tonnes') continue;
        const pt = mixYears[y]?.parts.find((q) => q.c.id === c.id);
        const allocated = pt ? pt.s * total : 0;
        shortfall += Math.max(0, (c.tonnesPerYear ?? 0) - allocated);
      }
      if (shortfall <= 0) continue;
      coverPurchaseCost[period] += round(shortfall * (coverPremium[period] ?? 0));
    }
  }

  // TODO: Ernte-auf-Lager (Fertigerzeugnisse) — braucht einen Lieferplan, der auch den
  // Umsatz aus dem Erntemonat in die Liefermonate verschiebt. Bewusst offen; solange der
  // Umsatz vollständig im Erntemonat gebucht wird, liegt per Konstruktion keine fertige
  // Ware auf Lager (siehe wc.inv, Standard 0).
  // Belegungskurve: Bestand am Periodenende = Zugänge minus Abgänge, kumuliert.
  const storedTonnesBalance = zeros(n);
  let stRunning = 0;
  for (let p = 0; p < n; p++) {
    stRunning += storedTonnesIn[p] - storedTonnesOut[p];
    storedTonnesBalance[p] = Math.max(0, stRunning);
  }

  return {
    revenue, cogs, costIncurred, bioAssets, subsidies, inventoryValue, outputVat,
    receiptTerms, advances, coverPurchaseCost,
    storageCost: addArr(addArr(storageEnergyCost, storageHandlingCost), storageLossCost),
    storageEnergyCost, storageHandlingCost, storageLossCost,
    storedTonnesIn, storedTonnesBalance, storageFeeRevenue,
  };
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
    /** Periodenzins je Rate — PERIODENSCHARF, nicht zum Ziehungszeitpunkt eingefroren.
     *  Vorher las diese Zeile den Satz einmal beim Abruf und hielt ihn über die gesamte
     *  Laufzeit ("fix genähert"), während der Revolver daneben periodenscharf rechnete.
     *  Eine Zinssensitivität wirkte damit nur auf den Revolver — das Modell sah gegen
     *  Zinsänderungen weit robuster aus, als das Unternehmen es ist.
     *  Bei `fixed` und bei konstanter Referenzkurve ist das Ergebnis identisch zu vorher;
     *  der Unterschied zeigt sich erst unter einer Zinskurve, also genau dort, wo er hin soll. */
    const rAt = (p: number) => annualRate(p) / payPerYear;
    const r = rAt(t.drawPeriod); // Satz bei Ziehung — bestimmt die Form der Annuität

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
        const rp = rAt(p);                 // Satz DIESER Periode
        const zins = outstanding * rp;
        let tilg: number;
        if (t.repayment === 'linear') tilg = linPrin;
        else if (t.repayment === 'bullet') tilg = paymentsMade === nPay - 1 ? outstanding - residual : 0;
        else {
          // Annuität mit Zinsanpassung: die Rate wird bei geändertem Satz auf die
          // Restlaufzeit neu gestellt — so machen es Banken auch. Bei konstantem
          // Satz ist pmtT identisch mit pmt, die Reihe also unverändert.
          const rest = nPay - paymentsMade;
          const dq = Math.pow(1 + rp, -rest);
          const pmtT = rp > 0
            ? (outstanding - residual * dq) * rp / (1 - dq)
            : (outstanding - residual) / Math.max(1, rest);
          tilg = pmtT - zins;
        }
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
 * Verlustvortrag (RO Art. 31 Cod fiscal i.d.F. Legea 296/2023)
 * ------------------------------------------------------------------------ */

export interface LossCarryOptions {
  /** Vortrag zulassen. */
  enabled: boolean;
  /** Vortragsdauer in Jahren. RO seit Legea 296/2023: fuenf statt sieben. */
  years: number;
  /** Anteil der Jahresbemessung, der hoechstens verrechnet werden darf. RO: 0,7. */
  maxOffsetShare: number;
}

export interface LossCarryResult {
  /** Bemessung je Jahr NACH Verrechnung (nie negativ). */
  baseAfterOffset: number[];
  /** Je Jahr tatsaechlich verrechneter Betrag. */
  offsetPerYear: number[];
  /** Summe der Verluste, die ungenutzt verfallen sind. */
  expired: number;
  /** Summe der am Ende des Horizonts noch offenen Verluste. */
  open: number;
}

/**
 * Verlustvortrag mit Verfall — als eigenstaendige, pruefbare Funktion.
 *
 * Zwei Regeln gelten zusammen, und vorher war nur eine umgesetzt:
 *   a) Verrechnung hoechstens 70 % der Jahresbemessung   — war richtig
 *   b) Vortrag hoechstens fuenf aufeinanderfolgende Jahre — fehlte
 *
 * Ohne (b) verrechnete das Modell ueber den Horizont 2027-2034 im Jahr 2034 noch
 * Verluste aus 2027. Das ist zu wenig Steuer und zu viel ausgewiesene Liquiditaet,
 * ausgerechnet in den Jahren, in denen Darlehen endfaellig werden.
 *
 * Verrechnet wird FIFO — der aelteste Verlust zuerst. Andernfalls verfaellt ein
 * alter Verlust, waehrend ein juengerer verrechnet wird, und das waere teurer als
 * noetig.
 */
export function applyLossCarryforward(
  taxablePerYear: number[],
  opt: LossCarryOptions,
): LossCarryResult {
  const baseAfterOffset: number[] = [];
  const offsetPerYear: number[] = [];
  const pool: { year: number; amount: number }[] = [];
  let expired = 0;

  for (let y = 0; y < taxablePerYear.length; y++) {
    const taxableYr = taxablePerYear[y];
    // Verfall VOR der Verrechnung: was aelter als `years` ist, ist weg.
    while (pool.length && y - pool[0].year > opt.years) {
      expired += pool[0].amount;
      pool.shift();
    }
    if (taxableYr <= 0) {
      if (opt.enabled && taxableYr < 0) pool.push({ year: y, amount: -taxableYr });
      baseAfterOffset.push(0);
      offsetPerYear.push(0);
      continue;
    }
    let offset = 0;
    if (opt.enabled) {
      let room = taxableYr * opt.maxOffsetShare;
      while (pool.length && room > 1e-9) {
        const take = Math.min(pool[0].amount, room);
        pool[0].amount -= take; room -= take; offset += take;
        if (pool[0].amount <= 1e-6) pool.shift();
      }
    }
    baseAfterOffset.push(taxableYr - offset);
    offsetPerYear.push(offset);
  }
  return {
    baseAfterOffset,
    offsetPerYear,
    expired,
    open: pool.reduce((s, e) => s + e.amount, 0),
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

  // --- Working Capital (L3): Forderungs-Rollforward + Anzahlungen -----------
  // Muss VOR dem EBITDA stehen, weil die Avalprovision auf erhaltene Anzahlungen ein
  // Betriebsaufwand ist. Bei Satz 0 (Standardkalibrierung) ist die Reihe null und das
  // EBITDA bleibt unverändert.
  const workingCapital = computeWorkingCapital(
    state, chain, n, ppy, op.revenue, op.cogs, op.costIncurred, op.bioAssets,
    op.receiptTerms, op.advances,
  );
  const wcChange = workingCapital.wcChange;

  // Deckungskauf (Paket C) und Avalprovision auf Anzahlungen sind Betriebsaufwand und damit
  // EBITDA-wirksam — gewollt: im Worst Case soll sichtbar sein, dass ein Ertragsausfall
  // zusätzlich eine Vertragsstrafe auslöst.
  const opex = addArr(
    addArr(addArr(opexAssumptions, personnelCost), workingCapital.advanceSecurityFee),
    addArr(op.coverPurchaseCost, op.storageCost),
  );

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
  // Diagnose: was ist ungenutzt verfallen, was steht noch offen. Beides gehört
  // sichtbar gemacht — ein verfallener Verlustvortrag ist bares Geld.
  let lossCarryExpired = 0;
  let lossCarryOpen = 0;
  const annualCurrentTax = (taxableArr: number[]): number[] => {
    const out = zeros(n);
    const carryEnabled = state.tax.lossCarryforward !== false;
    /** Verlustvortrag mit VERFALL. Legea 296/2023 hat Art. 31 Cod fiscal in zwei
     *  Richtungen geaendert: die Verrechnung ist auf 70 % der Jahresbemessung
     *  begrenzt (war hier schon richtig), UND der Vortrag laeuft nur noch fuenf
     *  aufeinanderfolgende Jahre statt sieben (fehlte). Ueber den Horizont
     *  2027-2034 ist das kein Randfall: ein Verlust aus 2027 ist nach 2032
     *  verfallen, das Modell verrechnete ihn bis dahin noch 2034 — also zu wenig
     *  Steuer und zu viel ausgewiesene Liquiditaet in genau den Jahren, in denen
     *  Darlehen endfaellig werden.
     *  Verrechnet wird FIFO: der aelteste Verlust zuerst, sonst verfaellt er,
     *  waehrend ein juengerer verrechnet wird. */
    const jahre: number[] = [];
    const qual: number[] = [];
    const grenzen: [number, number][] = [];
    for (let y = 0; y * ppy < n; y++) {
      const a = y * ppy, b = Math.min(n, a + ppy);
      let taxableYr = 0, qualYr = 0;
      for (let i = a; i < b; i++) { taxableYr += taxableArr[i]; qualYr += reinvestByPeriod[i]; }
      jahre.push(taxableYr); qual.push(qualYr); grenzen.push([a, b]);
    }
    const vt = applyLossCarryforward(jahre, {
      enabled: carryEnabled,
      years: state.tax.lossCarryforwardYears ?? 5,
      maxOffsetShare: 0.7,
    });
    lossCarryExpired = vt.expired;
    lossCarryOpen = vt.open;

    for (let y = 0; y < jahre.length; y++) {
      const [a, b] = grenzen[y];
      let posSum = 0;
      for (let i = a; i < b; i++) posSum += Math.max(0, taxableArr[i]);
      let base = vt.baseAfterOffset[y];
      if (reinvestOn && base > 0) base = Math.max(0, base - Math.min(base, qual[y]));
      const taxYr = base > 0 ? base * (taxRate[a] ?? 0) : 0;
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

  /** Ein Durchgang der Fixpunktschleife. Bewusst als Funktion, damit es **eine**
   *  Formel je Groesse gibt. Vorher stand die CFO-Formel zweimal im Code — einmal
   *  hier, einmal beim Zusammensetzen der Statements — und die beiden Fassungen
   *  waren bereits auseinandergelaufen (die Statement-Fassung kannte den
   *  fvBio-Term nicht). Solange fvBio null ist, faellt das nicht auf; sobald
   *  IAS 41 implementiert wird, sofort. */
  const iterate = (revInterestIn: number[]) => {
    const interestTotal = addArr(addArr(debt.interest, revInterestIn), workingCapital.advanceCost);
    const pbt = subArr(ebit, interestTotal);              // bilanzielles Ergebnis v. St.
    const taxableFiscal = subArr(ebitFiscal, interestTotal); // steuerliche Bemessung
    // Zahlungswirksame Steuer: JAHRES-Bemessung + Verlustvortrag + Reinvestitions-Befreiung.
    const currentTax = annualCurrentTax(taxableFiscal);
    // Latente Steuer aus temporärer AfA-Differenz (fiskalisch − bilanziell):
    const deferredTax = depFiscal.map((df, i) => (df - depCommercial[i]) * taxRate[i]);
    // NI = bilanzielles EBT − (zahlungswirksame + latente Steuer)
    const netIncome = subArr(pbt, addArr(currentTax, deferredTax));

    /** CFO = NI + bilanz. AfA + latente Steuer − FV(Bio) − ΔWC + USt-Timing.
     *  Die USt gehoert HIER hinein und nicht in eine eigene vierte Kategorie.
     *  Vorher lief sie ausserhalb von CFO/CFI/CFF direkt in die Kasse — mit dem
     *  Ergebnis, dass sich die drei ausgewiesenen Bloecke NICHT auf den
     *  ausgewiesenen Netto-Cashflow summierten. Genau diese Probe rechnet ein
     *  Finanzierer als erste nach. Sachlich ist die USt ein Zahlungszeitpunkt-
     *  Effekt auf operative Vorgaenge, also operativer Cashflow. */
    const cfo = addArr(
      subArr(
        addArr(addArr(addArr(netIncome, depCommercial), deferredTax), scaleArr(fvBio, -1)),
        addArr(wcChange, disposalGainLoss), // Buchgewinn/-verlust raus (Cash steckt im CFI-Erlös)
      ),
      vat.vatCashFlow,
    );
    // CFI = −CapEx + Verkaufserlöse aus Ausmusterung
    const cfi = addArr(scaleArr(capexOut, -1), disposalProceeds);
    // CFF ohne Revolver = Drawdowns − Tilgung − Restwert-Ballon
    const cffExRevolver = subArr(subArr(debt.drawdowns, debt.repayments), debt.balloon);

    const revBalance = zeros(n);
    const revInterest = zeros(n);
    const revMovement = zeros(n);
    const cash = zeros(n);

    let prevCash = openingCash;
    let prevRev = 0;
    for (let p = 0; p < n; p++) {
      revInterest[p] = round(prevRev * revRateAt(p)); // fließt in NI der nächsten Iteration
      // Revolver-Zins NICHT separat abziehen: er steckt bereits im Jahresüber-
      // schuss (netIncome -> cfo) und würde sonst doppelt zählen.
      const preCash = prevCash + cfo[p] + cfi[p] + cffExRevolver[p];
      let draw = 0;
      let repay = 0;
      if (preCash < minCash) {
        draw = Math.min(state.revolver.limit - prevRev, minCash - preCash);
      } else if (prevRev > 0) {
        repay = Math.min(prevRev, preCash - minCash);
      }
      const rev = prevRev + draw - repay;
      revMovement[p] = draw - repay;
      revBalance[p] = rev;
      cash[p] = preCash + draw - repay;
      prevCash = cash[p];
      prevRev = rev;
    }
    return { interestTotal, pbt, currentTax, deferredTax, netIncome,
             cfo, cfi, cffExRevolver, revBalance, revInterest, revMovement, cash };
  };

  let res = iterate(revolverInterest);
  for (let it = 0; it < maxIter; it++) {
    iterations = it + 1;
    const delta = res.revBalance.reduce((m, v, i) => Math.max(m, Math.abs(v - revolverBalance[i])), 0);
    revolverBalance = res.revBalance;
    if (delta <= eps) { converged = true; break; }
    res = iterate(res.revInterest);
  }
  revolverInterest = res.revInterest;
  revolverMovement = res.revMovement;
  closingCash = res.cash;

  // --- 6) Statements zusammensetzen ----------------------------------------
  /** Die Werte kommen aus DEMSELBEN Durchgang, der auch die Kasse erzeugt hat.
   *  Vorher wurden Ergebnis und Steuer nach dem Schleifenende noch einmal neu
   *  gerechnet — mit dem frischen Revolverzins, waehrend closingCash noch auf dem
   *  vorherigen beruhte. Der Bilanz-Check verglich damit eine Aktiv- und eine
   *  Passivseite aus zwei verschiedenen Zinsstaenden. Bei Konvergenz lag die
   *  Differenz unter der Toleranz und war unsichtbar; bei Nichtkonvergenz nicht. */
  const { interestTotal, pbt, currentTax, deferredTax, netIncome, cfo, cfi, cffExRevolver } = res;
  const totalTax = addArr(currentTax, deferredTax);

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
  // Erhaltene Anzahlungen: Passivum (IFRS 15 Vertragsverbindlichkeit), KEIN Umsatz.
  // Im NWC steckt die Position mit negativem Vorzeichen — die Bilanzgleichung schließt
  // damit genauso wie bei den Verbindlichkeiten aus Lieferungen.
  const customerAdvances = workingCapital.customerAdvances;
  // Feldbestand (wachsende Kultur zu Herstellungskosten) — steckt im NWC, damit die
  // Aktivierung zahlungsneutral bleibt: der höhere Jahresüberschuss vor der Ernte wird
  // durch die Bestandsbildung im ΔWC genau ausgeglichen.
  const bioAssets = workingCapital.bioAssets;
  const shareCapital = new Array(n).fill(state.openingBalance?.shareCapital ?? 0);

  const totalAssets = addArr(
    addArr(addArr(addArr(closingCash, receivables), addArr(inventory, bioAssets)),
      addArr(land, ppeNet)),
    vat.vatReceivable,          // USt-Forderung (TVA de recuperat)
  );
  const totalLiab = addArr(
    addArr(addArr(addArr(payables, debtBalance), revolverBalance),
      deferredTaxLiability),
    addArr(vat.vatPayable, customerAdvances),   // USt-Verbindlichkeit + erhaltene Anzahlungen
  );
  const totalEquity = addArr(shareCapital, retainedEarnings);
  const liabAndEquity = addArr(totalLiab, totalEquity);

  // --- Checks ---------------------------------------------------------------
  const checks: CheckResult[] = [];
  const balanceDev = totalAssets.map((v, i) => v - liabAndEquity[i]);
  checks.push(buildCheck('balance_zero', 'Bilanz geht auf (A = L + E)', balanceDev, eps, 'error'));

  const negCash = closingCash.map((v) => (v < 0 ? -v : 0));
  checks.push(buildCheck('no_negative_cash', 'Keine negative Kasse', negCash, 0, 'error'));

  /** Die Probe, die ein Finanzierer als erste rechnet:
   *      CFO + CFI + CFF + Anfangsbestand  ==  Endbestand
   *  Sie schlug vorher fehl, weil das USt-Timing ausserhalb der drei Bloecke direkt
   *  in die Kasse lief. Seit die USt im operativen Cashflow steckt, geht sie auf —
   *  und der Check sorgt dafuer, dass sie es bleibt. */
  const cffTotal = addArr(cffExRevolver, revolverMovement);
  const cfTie = closingCash.map((v, i) => {
    const prev = i === 0 ? openingCash : closingCash[i - 1];
    return v - (prev + cfo[i] + cfi[i] + cffTotal[i]);
  });
  checks.push(buildCheck('cashflow_ties', 'Kapitalflussrechnung geht auf (CFO+CFI+CFF = ΔKasse)', cfTie, eps, 'error'));

  /** FRUCHTFOLGE. Bei einer Anbaupause von p Jahren darf eine Wirtsgruppe
   *  hoechstens 1/p der Rotationsflaeche belegen — sonst steht sie frueher wieder
   *  auf derselben Flaeche, als der Boden es traegt.
   *
   *  Vorher gab es dafuer zwei handgeschriebene Sonderfaelle im Composer: einen
   *  Kartoffel-Cap, der nur im ramp-Zweig griff (und damit nie, weil der
   *  Skalierungspfad ueber path laeuft), und einen Doldenblueter-Guard, der
   *  tatsaechlich lief. Ergebnis: die Kartoffel belegte 42,8 % statt 25 %, ohne
   *  dass irgendetwas warnte. Diese Pruefung ist die gemeinsame Stelle, die
   *  gefehlt hat — datengetrieben, nicht je Kultur ausprogrammiert. */
  for (const rule of state.rotationRules ?? []) {
    const gesamtHa = state.rotationAreaHa ?? state.cropPlans.reduce((sum, p) => sum + p.areaHa, 0);
    if (gesamtHa <= 0) continue;
    const gruppeHa = state.cropPlans.reduce(
      (sum, p) => sum + p.areaHa * (rule.cropWeights[p.cropId] ?? 0), 0);
    const maxShare = rule.maxShare ?? 1 / Math.max(1, rule.pauseYears);
    const anteil = gruppeHa / gesamtHa;
    const ueberhangHa = Math.max(0, gruppeHa - maxShare * gesamtHa);
    checks.push({
      id: `rotation_${rule.id}`,
      label: `Fruchtfolge ${rule.label}: ${(anteil * 100).toFixed(1)} % der Rotationsfläche `
        + `(zulässig ${(maxShare * 100).toFixed(1)} % bei ${rule.pauseYears} Jahren Anbaupause)`,
      passed: ueberhangHa < 0.5,
      maxDeviation: ueberhangHa,
      offendingPeriods: [],
      severity: 'error',
    });
  }

  /** Verfallener Verlustvortrag. Kein Fehler — eine Tatsache, die man kennen will:
   *  jeder verfallene Euro ist Steuerschild, das nie genutzt wurde. Wer das sieht,
   *  kann Investitionen oder Ergebnisse zeitlich anders legen. */
  checks.push({
    id: 'loss_carry_expired',
    label: `Verlustvortrag ungenutzt verfallen (${state.tax.lossCarryforwardYears ?? 5}-Jahres-Frist, RO Art. 31)`,
    passed: lossCarryExpired <= eps,
    maxDeviation: lossCarryExpired,
    offendingPeriods: [],
    severity: 'warning',
  });

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
  referencedKeys.push('quality.reject', 'market.cover_premium', 'infl.output');
  for (const k of ['store.months', 'store.from_month', 'store.service_mode', 'store.fee_per_t_month',
                   'store.energy_per_t_month', 'store.handling_per_t', 'store.loss_rate']) {
    if (k in state.assumptions) referencedKeys.push(k);
  }
  if (state.harvestAdvance?.active) {
    referencedKeys.push(state.harvestAdvance.rateAssumptionKey);
    if (state.harvestAdvance.costRateAssumptionKey) referencedKeys.push(state.harvestAdvance.costRateAssumptionKey);
    if (state.harvestAdvance.securityFeeRateAssumptionKey) referencedKeys.push(state.harvestAdvance.securityFeeRateAssumptionKey);
  }
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
  /** Jahre mit Netto-Verschuldung UND EBITDA <= 0: die Kennzahl ist nicht berechenbar, die
   *  Auflage aber erst recht nicht erfüllt. Vorher wurden solche Jahre stillschweigend
   *  übersprungen — der Check meldete "grün", je schlechter das Ergebnis wurde. */
  let levNotComputable = 0;
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
    // Leverage: bei positivem Jahres-EBITDA als Verhältnis, sonst als nicht einhaltbar.
    if (yEbitda > 0) {
      const v = yNetDebt / yEbitda;
      if (Number.isFinite(v) && v > leverageMax) { levOffending.push(ye); levMaxExcess = Math.max(levMaxExcess, v - leverageMax); }
    } else if (yNetDebt > 0) {
      // EBITDA <= 0 bei Netto-Verschuldung: aus negativem Ergebnis ist kein Kapitaldienst
      // zu leisten. Als gerissen ausweisen statt den Check zu überspringen.
      levOffending.push(ye); levNotComputable++;
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
    label: levNotComputable > 0
      ? `Net Debt / EBITDA ≤ ${leverageMax.toFixed(2)} (Verschuldungsgrenze, p.a.) — in ${levNotComputable} Jahr(en) nicht berechenbar: EBITDA ≤ 0 bei Netto-Verschuldung`
      : `Net Debt / EBITDA ≤ ${leverageMax.toFixed(2)} (Verschuldungsgrenze, p.a.)`,
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
      cogs: makeLine('pnl.cogs', 'Produktionskosten (COGS)', 'money', op.cogs, [],
        'Bei der Ernte aus dem Feldbestand entlastet — nicht bei Kostenentstehung. Der Zahlungsstrom folgt den entstandenen Kosten (Verbindlichkeiten), nicht dieser Zeile.'),
      grossProfit: makeLine('pnl.gross_profit', 'Rohertrag', 'money', grossProfit, ['pnl.revenue', 'pnl.subsidies', 'pnl.cogs']),
      opex: makeLine('pnl.opex', 'OpEx / SG&A', 'money', opex),
      coverPurchase: makeLine('pnl.cover_purchase', 'davon: Deckungskauf (Untererfüllung Kontrakt)', 'money', op.coverPurchaseCost),
      storageCost: makeLine('pnl.storage_cost', 'davon: Lagerbetrieb (Energie, Ein-/Auslagerung)', 'money', op.storageCost),
      storageFeeRevenue: makeLine('pnl.storage_fee', 'nachrichtlich: Lageraufschlag im Umsatz', 'money', op.storageFeeRevenue),
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
      biologicalAssets: makeLine('bs.bio', 'Feldbestand (wachsende Kultur, zu Herstellungskosten)', 'money', bioAssets),
      land: makeLine('bs.land', 'Grund & Boden', 'money', land),
      ppeNet: makeLine('bs.ppe', 'Sachanlagen (netto)', 'money', ppeNet),
      vatReceivable: makeLine('bs.vat_receivable', 'USt-Forderung (TVA de recuperat)', 'money', vat.vatReceivable),
      totalAssets: makeLine('bs.total_assets', 'Summe Aktiva', 'money', totalAssets),
      payables: makeLine('bs.payables', 'Verbindlichkeiten', 'money', payables),
      customerAdvances: makeLine('bs.customer_advances', 'Erhaltene Anzahlungen (Abnehmer)', 'money', customerAdvances),
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
      // Nachrichtlich („davon"): steckt bereits in der ΔWC-Zeile — nicht zusätzlich addieren.
      customerAdvanceMovement: makeLine('cf.advance', 'davon: Anzahlungen Abnehmer (Zufluss/Verrechnung)', 'money', workingCapital.advanceMovement),
      bioAssetMovement: makeLine('cf.bio', 'davon: Aufbau/Auflösung Feldbestand', 'money',
        bioAssets.map((v, i) => v - (i === 0 ? 0 : bioAssets[i - 1]))),
      // EINE Formel: dieselbe Reihe, die auch die Kasse erzeugt hat (s. iterate()).
      cfo: makeLine('cf.cfo', 'Operativer Cashflow', 'money', cfo),
      capex: makeLine('cf.capex', '− CapEx', 'money', scaleArr(capexOut, -1)),
      cfi: makeLine('cf.cfi', 'Investiver Cashflow', 'money', cfi),
      disposalProceeds: makeLine('cf.disposal', '+ Verkaufserlös Ausmusterung', 'money', disposalProceeds),
      debtDrawdowns: makeLine('cf.draw', 'Kreditaufnahme', 'money', debt.drawdowns),
      debtRepayments: makeLine('cf.repay', 'Tilgung', 'money', scaleArr(debt.repayments, -1)),
      revolverMovement: makeLine('cf.revolver', 'Revolver-Bewegung', 'money', revolverMovement),
      equityMovement: makeLine('cf.equity', 'Eigenkapitalbewegung', 'money', zeros(n)),
      interestPaid: makeLine('cf.interest', 'Gezahlte Zinsen', 'money', scaleArr(interestTotal, -1)),
      // Nachrichtlich („davon"): steckt bereits im operativen Cashflow — nicht zusätzlich addieren.
      vatCashFlow: makeLine('cf.vat', 'davon: USt/TVA-Timing (Vorsteuer/Zahllast/Erstattung)', 'money', vat.vatCashFlow),
      cff: makeLine('cf.cff', 'Finanzierungs-Cashflow', 'money',
        addArr(cffExRevolver, revolverMovement)),
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
