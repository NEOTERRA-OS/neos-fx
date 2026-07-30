/**
 * ============================================================================
 *  Investor-Grade Financial Model — Domänentypen
 *  AgTech / Corporate Planning · Next.js + TypeScript
 * ----------------------------------------------------------------------------
 *  Diese Datei ist die "Verfassung" des Datenmodells. Sie ist die einzige
 *  Quelle der Wahrheit für die Form von ModelState (Input) und ComputedModel
 *  (Output). Schema (Supabase) und Engine (computeModel) richten sich hiernach.
 *
 *  Konventionen:
 *   - Geldbeträge werden als GANZZAHLIGE MINOR-UNITS geführt (z. B. Euro-Cent),
 *     um Float-Akkumulationsfehler zu vermeiden. Erst bei Anzeige runden.
 *   - Mengen/Flächen/Erträge als number (t, ha, t/ha) — physikalische Größen.
 *   - Raten/Quoten als Dezimalbruch (0.08 = 8 %), nie als "8".
 *   - Jede Annahme ist szenario- UND zeitabhängig auflösbar.
 * ============================================================================
 */

/* --------------------------------------------------------------------------
 * 0. Primitive & Branded Types
 * ------------------------------------------------------------------------ */

/**
 * Geld in Minor-Units (Cent). 12345 = 123,45 €. Konvention: immer Ganzzahl.
 * Als Alias (nicht branded) gehalten, damit die Engine ohne Cast rechnen kann;
 * die Minor-Units-Disziplin wird durch round() in der Engine sichergestellt.
 */
export type Money = number;

/** Dezimalbruch-Rate: 0.08 = 8 %. */
export type Rate = number;

/** ISO-4217, z. B. "EUR". */
export type CurrencyCode = string;

export type UUID = string;

/** Periodenindex: 0 = erste Modellperiode, monoton steigend. */
export type PeriodIndex = number;

/* --------------------------------------------------------------------------
 * 1. Zeitachse
 * ------------------------------------------------------------------------ */

export type Granularity = 'month' | 'quarter' | 'year';

export interface Period {
  index: PeriodIndex;
  /** ISO-Datum des Periodenendes, z. B. "2026-01-31". */
  endDate: string;
  label: string;            // "Jan 26", "Q1 26", "GJ 2026"
  granularity: Granularity;
  /** true, sobald für diese Periode Ist-Zahlen importiert sind. */
  isActual: boolean;
}

export interface Timeline {
  /** Basisgranularität, in der gerechnet wird (i. d. R. 'month'). */
  baseGranularity: Granularity;
  startDate: string;        // ISO
  /** Anzahl Basisperioden im Modell (z. B. 60 = 5 Jahre monatlich). */
  periodCount: number;
  periods: Period[];
}

/* --------------------------------------------------------------------------
 * 2. Szenarien
 * ------------------------------------------------------------------------ */

export type ScenarioKind = 'base' | 'best' | 'worst' | 'custom';

export interface Scenario {
  id: UUID;
  name: string;             // "Base Case", "Dürre 2027", ...
  kind: ScenarioKind;
  /** Optional: erbt Annahmen von diesem Szenario, überschreibt nur Deltas. */
  inheritsFrom?: UUID;
  color?: string;           // für Top-Bar-Tönung / Charts
}

/* --------------------------------------------------------------------------
 * 3. Annahmen (Assumptions) — die einzige Tipp-Zone der Kernlogik
 * ------------------------------------------------------------------------ */

export type Unit =
  | 'money'          // Minor-Units
  | 'rate'           // Dezimalbruch
  | 'count'          // Stückzahl
  | 'hectare'        // ha
  | 'tonne'          // t
  | 'tonne_per_ha'   // t/ha
  | 'money_per_tonne'// €/t (als Money je t)
  | 'money_per_ha'   // €/ha
  | 'days'           // z. B. DSO/DPO
  | 'months';

/** Wie sich ein Annahmewert über die Zeit entwickelt. */
export type TimeProfile =
  | { kind: 'constant'; value: number }
  | { kind: 'growth'; base: number; annualRate: Rate }           // geometrisch
  | { kind: 'ramp'; from: number; to: number; overPeriods: number }
  | { kind: 'curve'; values: number[] }                          // je Periode explizit
  | { kind: 'seasonal'; annual: number; weights: number[] };     // weights.length = Perioden/Jahr

/** Ein Audit-Eintrag: wer hat wann welches Feld von → auf geändert (Team-Nachvollziehbarkeit). */
export interface AssumptionAudit {
  ts: string;               // ISO
  by: string;               // Bearbeiter-Name
  field: string;            // "Wert (Base)" | "Quelle" | "Status" | …
  from?: string;
  to?: string;
}

export type AssumptionConfidence = "hoch" | "mittel" | "niedrig";
export type AssumptionStatus = "offen" | "pruefung" | "geprueft" | "strittig";

export interface AssumptionMeta {
  source?: string;          // "Agronom-Report 2025", "Vertrag XY"
  note?: string;            // Team-Notiz / Kommentar
  owner?: string;           // verantwortliche Person
  confidence?: AssumptionConfidence;
  status?: AssumptionStatus;
  lastEditedBy?: UUID;
  lastEditedAt?: string;    // ISO
  /** Aktualisierungs-Attribution (Name statt UUID) für das Team-Review. */
  updatedBy?: string;
  updatedAt?: string;       // ISO
  /** Änderungshistorie (jüngste zuletzt), gekappt auf die letzten Einträge. */
  history?: AssumptionAudit[];
  /** true => in Berechnungszeile manuell überschrieben (gelbes Hardcode-Flag). */
  isOverride?: boolean;
}

/**
 * Eine Annahme. Der aufgelöste Wert hängt vom aktiven Szenario ab:
 * scenarioProfiles enthält je Szenario-ID ein TimeProfile; fehlt eine ID,
 * wird über Scenario.inheritsFrom bzw. das Base-Szenario aufgelöst.
 */
export interface Assumption {
  id: UUID;
  key: string;              // stabiler, sprechender Schlüssel: "wheat.price_per_t"
  label: string;
  unit: Unit;
  scenarioProfiles: Record<UUID, TimeProfile>;
  meta?: AssumptionMeta;
}

/* --------------------------------------------------------------------------
 * 4. AgTech-Betriebsstruktur: Betrieb → Standort/Parzelle → Kultur → Zyklus
 * ------------------------------------------------------------------------ */

export interface Farm {
  id: UUID;
  name: string;
  currency: CurrencyCode;   // Betriebswährung (kann von Reporting-Währung abweichen)
}

export interface Parcel {
  id: UUID;
  farmId: UUID;
  name: string;
  areaHa: number;           // bewirtschaftbare Fläche
  /** Bodengüte-/Standortfaktor auf den Ertrag (1.0 = Referenz). */
  yieldFactor?: number;
}

export type CropType = 'annual' | 'perennial';

export interface Crop {
  id: UUID;
  name: string;             // "Winterweizen", "Apfel Gala"
  type: CropType;
  /** Nur perennial: Jahre bis Vollertrag (Anlaufkurve). */
  yearsToMaturity?: number;
  /** Nur perennial: Ertragsanteil je Standjahr, z. B. [0, 0.3, 0.7, 1]. */
  maturityCurve?: number[];
}

/* --- Bottom-up-Kostenstruktur (L4): Operation -> Kostenzeile ------------- */

/** Kostenart einer opLine (Master-Referenz §4). */
export type CostType =
  | 'seed'            // Saatgut
  | 'fertilizer'      // Dünger
  | 'crop_protection' // Pflanzenschutz (PSM)
  | 'machine'         // Maschine: Std/ha × TCO-Satz
  | 'labor'           // Lohn: Std/ha × Satz
  | 'fuel'            // Diesel: l/ha × Preis
  | 'other';

/**
 * Kostenzeile (opLine): kleinste Kalkulationseinheit, €/ha = Menge × Stücksatz.
 * Der Stücksatz ist eine ANNAHME (Single Source) — dadurch ist jede Kostenart
 * (Dünger, Diesel, Lohn …) ein sensitivierbarer Treiber.
 */
export interface CostLine {
  id: UUID;
  label: string;                      // "Saatgut Weizen (Zertif.)"
  costType: CostType;
  quantityPerHa: number;              // Menge je ha (kg, h, l …)
  unitCostKey: string;                // Assumption-Key: €/Einheit
}

/** Maßnahme/Operation (z. B. "Aussaat inkl. Saatgut"), fasst Kostenzeilen. */
export interface Operation {
  id: UUID;
  label: string;
  /** Perioden, in denen die Operation kostenwirksam wird (rekurrierend möglich). */
  costPeriods: PeriodIndex[];
  lines: CostLine[];
}

/**
 * Anbauplan: welche Kultur auf welcher Parzelle in welchem Zeitraum,
 * mit den Treibern für Ertrag, Preis, Verlust. Alle Treiber referenzieren
 * Assumption-Keys (Single Source of Truth), NICHT eingebettete Werte.
 */
export interface CropPlan {
  id: UUID;
  parcelId: UUID;
  cropId: UUID;
  areaHa: number;                     // belegte Fläche (<= Parcel.areaHa)
  plantingPeriod: PeriodIndex;        // Aussaat/Pflanzung
  /** Erntefenster: Perioden, in denen geerntet/verkauft wird (Saisonalität). */
  harvestPeriods: PeriodIndex[];
  yieldAssumptionKey: string;         // t/ha
  priceAssumptionKey: string;         // €/t
  lossRateAssumptionKey?: string;     // Ernte-/Lagerverlust, Rate
  /** Kontrakt-Qualitätserfüllung (0..1): realisierter Preis nach Qualitäts-Bonus/Malus
   *  (Brix/Stärke/Protein/Sortierung) × akzeptierte Menge. 1 = 100 % Kontrakterfüllung. */
  qualityAssumptionKey?: string;
  /**
   * Bottom-up-Kosten (bevorzugt): Operationen mit Kostenzeilen. Wenn gesetzt,
   * werden die COGS hieraus in den jeweiligen costPeriods gerechnet.
   */
  operations?: Operation[];
  /**
   * Fallback-Kosten je ha (Assumption-Keys, summiert), Punktlast in
   * plantingPeriod. Nur genutzt, wenn keine operations gesetzt sind.
   */
  variableCostKeysPerHa: string[];
  /**
   * Zweitfrucht (Doppelfruchtsystem, z. B. Gerste → Soja): zusätzlicher Umsatz +
   * Inputkosten auf DERSELBEN Fläche im selben Jahr. Ernte im secondHarvestPeriod.
   * Maschinenarbeit der Zweitfrucht steckt bereits in den Arbeitsgängen (Saat/Ernte);
   * extraCostPerHaCent = nur die zusätzlichen Betriebsmittel (Saatgut/N/PSM/Wasser).
   */
  secondCrop?: {
    label: string;
    yieldAssumptionKey: string;
    priceAssumptionKey: string;
    lossRateAssumptionKey?: string;
    harvestPeriod: PeriodIndex;
    extraCostPerHaCent: number;
  };
}

/* --------------------------------------------------------------------------
 * 5. CapEx, Abschreibung, Finanzierung
 * ------------------------------------------------------------------------ */

export type AssetClass =
  | 'land'          // keine Abschreibung
  | 'machinery'
  | 'irrigation'
  | 'buildings'
  | 'plantings'     // Dauerkulturen als CapEx aktiviert
  | 'other';

/** Finanzierungsart einer Investition (steuert 3-Statement-Wirkung). */
export type FinancingMode = 'cash' | 'loan' | 'lease_fin' | 'lease_op';

export interface CapexItem {
  id: UUID;
  name: string;
  assetClass: AssetClass;
  amount: Money;
  purchasePeriod: PeriodIndex;
  /** Handelsrechtliche (bilanzielle) Nutzungsdauer. land => 0 / ignoriert. */
  usefulLifeMonths: number;
  /**
   * Steuerliche (fiskalische) Nutzungsdauer. Fehlt sie, wird
   * usefulLifeMonths verwendet (keine Buch/Steuer-Differenz, keine latente
   * Steuer). Weicht sie ab, entsteht eine temporäre Differenz -> latente Steuer.
   */
  usefulLifeFiscalMonths?: number;
  /** Finanzierungsart; informativ/für spätere CapEx-Cashwirkung nach Modus. */
  financingMode?: FinancingMode;
  salvageValue?: Money;
  /** Ausmusterung: Periode, in der die Position verkauft/getauscht wird (Ende Tauschzyklus).
   *  Ab dann keine AfA mehr; Restbuchwert geht aus PPE ab, Erlös fließt als Cash zu. */
  disposalPeriod?: PeriodIndex;
  /** Verkaufserlös bei Ausmusterung (CENT). Differenz zum Restbuchwert = Buchgewinn/-verlust. */
  disposalProceedsCent?: Money;
}

export type RepaymentProfile = 'annuity' | 'linear' | 'bullet';
export type RateBasis = 'fixed' | 'floating';
export type PaymentFrequency = 'monthly' | 'quarterly' | 'seasonal';

export interface DebtTranche {
  id: UUID;
  name: string;                       // "Investitionsdarlehen", "Förderkredit"
  /** Objektpreis / voll finanzierter Betrag (vor Avans). */
  principal: Money;
  drawPeriod: PeriodIndex;
  termMonths: number;
  rateBasis: RateBasis;
  /** fixed: fester Satz; floating: Spread über Referenz-Assumption. */
  fixedRate?: Rate;
  floatingSpread?: Rate;
  referenceRateKey?: string;          // Assumption-Key, z. B. "macro.euribor_3m"
  repayment: RepaymentProfile;
  gracePeriodMonths?: number;
  /** Avans (Anzahlung) als Anteil des Preises; mindert den finanzierten Betrag. */
  avansRate?: Rate;
  /** Restwert (valoare reziduală) als Anteil des Preises; Ballon am Laufzeitende. */
  residualRate?: Rate;
  /** Zahlungsfrequenz; seasonal => Raten nur in seasonMonths (Erntemonate). */
  frequency?: PaymentFrequency;
  /** Nur seasonal: Monate (1–12), in denen Raten fällig werden, z. B. [7,10]. */
  seasonMonths?: number[];
}

/** Finanzierungsart eines realen Vertrags (IFRS 16: Leasing → Right-of-Use). */
export type ContractKind = 'lease_fin' | 'lease_op' | 'loan';

/**
 * LeasingContract — reale Finanzierungs-/Leasingvertrags-Maske (Danubia-kalibriert:
 * Raiffeisen CLF 77770, UniCredit CLF 30366974). Ein Vertrag kann MEHRERE CAPEX-
 * Positionen bündeln (Paket, `objectIds`). Der Composer leitet daraus eine
 * DebtTranche für die 3-Statement-Engine ab (principal = Σ Objektwerte bzw.
 * `entryValueCent`). Nichts weggelassen — alle Vertragsfelder abgebildet.
 */
export interface LeasingContract {
  id: UUID;
  name: string;                       // Vertrags-/Paketname
  lessor: string;                     // Finanzierer (Raiffeisen/UniCredit/…)
  contractNo?: string;                // Vertragsnummer (CLF Nr.)
  supplier?: string;                  // Furnizor / Lieferant
  guarantor?: string;                 // Fideiusor / Bürge
  kind: ContractKind;                 // Finanzierungsart
  /** Verknüpfte CAPEX-Positionen (Maschinen-ids). Paket = mehrere Objekte. */
  objectIds: string[];
  /** Objektwert netto (CENT). Fehlt/0 → live aus objectIds abgeleitet. */
  entryValueCent?: Money;
  drawPeriod: PeriodIndex;
  avansRate: Rate;                    // Avans / Anzahlung
  residualRate: Rate;                 // Valoare reziduală / Restwert-Ballon
  termMonths: number;                 // Perioada de leasing
  rateBasis: RateBasis;               // fix | variabel
  fixedRate?: Rate;
  referenceRateKey?: string;          // Rata de referință (EURIBOR 3M)
  floatingSpread?: Rate;              // Marja / Marge
  frequency: PaymentFrequency;        // monatl./quartal/saisonal
  seasonMonths?: number[];            // nur saisonal (z. B. [7,10])
  repayment: RepaymentProfile;        // annuity | linear | bullet
  currency?: string;                  // Moneda plății (RON/EUR)
  fxSource?: string;                  // Cursul de schimb (Bank)
  vatRate?: Rate;                     // TVA auf Raten
  // — Einmalgebühren (Comisioane) —
  feeAnalysisCent?: Money;            // Comision de analiză
  feeRegistrationCent?: Money;        // Înregistrare RNPM
  feeAdminRate?: Rate;                // Comision de administrare (% der finanz. Summe)
  feeAdminCent?: Money;               // alternativ fixer Verwaltungsbetrag
  feeClosingCent?: Money;             // Comision de închidere
  prepaymentRate?: Rate;             // Comision de plată anticipată (%)
  prepaymentMinCent?: Money;          // min.
  lateInterestDaily?: Rate;           // Dobânda de întârziere (%/Tag)
  /** IFRS 16: Objekt als Right-of-Use aktivieren (+ Leasingverbindlichkeit). Default true. */
  ifrs16RightOfUse?: boolean;
  active?: boolean;
}

/** Revolver / Betriebsmittellinie — schließt automatisch Cash-Lücken. */
export interface RevolverFacility {
  limit: Money;
  rateBasis: RateBasis;
  fixedRate?: Rate;
  floatingSpread?: Rate;
  referenceRateKey?: string;
  /** Mindest-Kassenbestand, unter den nicht gefallen werden soll. */
  minCashTarget: Money;
}

/* --------------------------------------------------------------------------
 * 6. Working Capital, Steuern, Subventionen
 * ------------------------------------------------------------------------ */

export interface WorkingCapitalPolicy {
  dsoAssumptionKey: string;           // Days Sales Outstanding
  dpoAssumptionKey: string;           // Days Payable Outstanding
  /** Vorräte: Ernte auf Lager bis Verkauf — Kernschwung bei AgTech. */
  inventoryDaysAssumptionKey: string;
}

export interface TaxPolicy {
  corporateTaxRateKey: string;        // Assumption-Key, Rate
  /** Verlustvortrag zulassen. */
  lossCarryforward: boolean;
}

/** USt-/TVA-Behandlung eines Umsatzstroms (RO Cod Fiscal). */
export type VatTreatment =
  | 'standard'        // Regelsatz (21 %)
  | 'reduced'         // ermäßigt (11 % — Nahrungsmittel)
  | 'reverse_charge'  // taxare inversă (Getreide/Ölsaaten/technische Pflanzen, Art. 331) → keine Ausgangs-USt
  | 'export'          // innergemeinschaftlich/Drittland → 0 %
  | 'zero';           // befreit/0 %

/**
 * VatPolicy — RO-TVA-Mechanik (Ausgangs-/Vorsteuer, CAPEX-Erstattung, Reverse-Charge,
 * Zahllast-/Erstattungs-Timing → Cashflow + Bilanz). Wirkt zahlungswirksam über ein
 * USt-Verrechnungskonto (Forderung/Verbindlichkeit), P&L bleibt netto (USt = durchlaufend).
 */
export interface VatPolicy {
  enabled: boolean;
  standardRate: Rate;                 // 0,21 (RO ab 08/2025)
  reducedRate: Rate;                  // 0,11 (Nahrungsmittel)
  /** Ausgangs-USt-Behandlung je Kultur (cropId → Behandlung). Fehlt → standard. */
  outputByCrop?: Record<string, VatTreatment>;
  /** Vorsteuersatz auf CAPEX (Maschinen 21 %). */
  inputRateCapex: Rate;
  /** Vorsteuersatz auf OpEx/COGS (Mischsatz Inputs). */
  inputRateCost: Rate;
  /** Anteil der COGS mit abziehbarer Vorsteuer (Saatgut/Dünger/PSM/Diesel; Lohn ohne USt). */
  recoverableCogsShare: Rate;
  /** Anteil der OpEx/SG&A mit abziehbarer Vorsteuer (Dienstleistungen/IT; Personal/Zins ohne USt). */
  recoverableOpexShare: Rate;
  /** Zahllast-Lag (Monate) bis Abführung an den Staat. */
  settlementLagMonths: number;
  /** Erstattungs-Lag (Monate) für Vorsteuer-Überhang (rambursare TVA). */
  refundLagMonths: number;
}

export interface Subsidy {
  id: UUID;
  name: string;                       // "GAP-Direktzahlung", "Öko-Regelung 1"
  /** Zahlung je ha oder Pauschale — als Assumption-Key (optional, falls Inline-Satz gesetzt). */
  amountAssumptionKey?: string;
  basis: 'per_ha' | 'lump_sum';
  /** Perioden, in denen die Zahlung eingeht (Fallback, wenn kein payout-Profil gesetzt). */
  receiptPeriods: PeriodIndex[];
  /** Optional: nur diese Parzellen zählen (für crop-spezifische gekoppelte Stützung). Fehlt es → alle Parzellen. */
  parcelIds?: UUID[];
  /** Anspruch je Kultur (Composer mappt → parcelIds). Leer/fehlt → alle Flächen. */
  cropIds?: string[];
  /** Inline-Satz €/ha (CENT) — überschreibt amountAssumptionKey. */
  ratePerHaCent?: number;
  /** Inline-Pauschale (CENT) für basis 'lump_sum'. */
  lumpSumCent?: number;
  /** Nur die ersten N ha zählen (z. B. CRISS/umverteilende Prämie). */
  firstHaCap?: number;
  /** Säule 1 (Direktzahlungen) oder 2 (Ländliche Entwicklung). */
  pillar?: 1 | 2;
  /** Kategorie (biss/criss/eco/coupled/young/anc/agri_env/ant/other) — für Gruppierung. */
  category?: string;
  /** Auszahlungsprofil: Anteile je Periode (z. B. Vorschuss 70 % KW-Okt + Rest 30 % Dez). Fehlt → receiptPeriods gleichverteilt. */
  payout?: { period: PeriodIndex; share: number }[];
  /** Aktiv/inaktiv (Platzhalter für bedingte Programme, z. B. ANC/Junglandwirt). */
  active?: boolean;
}

/* --------------------------------------------------------------------------
 * 7. IAS 41 — biologische Vermögenswerte (optional)
 * ------------------------------------------------------------------------ */

export interface BiologicalAssetPolicy {
  enabled: boolean;                   // false => Bewertung zu Anschaffungskosten
  /** Fair-Value je Kultur/Reifegrad als Assumption-Key. */
  fairValueAssumptionKeys: Record<UUID /* cropId */, string>;
}

/* --------------------------------------------------------------------------
 * 7b. Abnahmeverträge (Off-take) — kontraktspezifischer Preis statt Punktwert
 * ------------------------------------------------------------------------ */

/** Ein Liefervertrag mit einem Abnehmer. GENERISCH über cropId — die Mechanik gilt
 *  für jede Kultur; befüllt ist zunächst nur Kartoffel (VIA AGRO / PepsiCo / Pestova).
 *
 *  Umsatzlogik (computeOperating): Die Erntemenge einer Kultur wird je Jahr auf die
 *  aktiven Verträge aufgeteilt; die Restmenge geht zum Kulturpreis (Spot) aus den
 *  Annahmen weg. OHNE Vertrag bleibt es exakt beim bisherigen Verhalten. */
export interface OfftakeContract {
  id: UUID;
  /** Abnehmer (Anzeigename). */
  buyer: string;
  /** Kultur, auf die der Vertrag zielt (CatalogEntry.cropId). */
  cropId: UUID;
  /** false → Vertrag ruht (keine Mengen-/Preiswirkung). */
  active: boolean;
  /** Mengenbindung: feste Jahres-Tonnage oder Anteil der Erntemenge. */
  volumeMode: 'tonnes' | 'share';
  /** Kontraktmenge in t/Jahr (nur volumeMode='tonnes'). */
  tonnesPerYear?: number;
  /** Anteil der Erntemenge 0..1 (nur volumeMode='share'). */
  share?: number;
  /** Kontrakt-Basispreis in CENT je Tonne — der unterschriebene Preis des ERSTEN Planjahrs.
   *  Die Verträge selbst enthalten keine Indexklausel, sind aber Jahresverträge: im
   *  Mehrjahresplan wird jedes Jahr neu kontrahiert, deshalb schreibt die Engine diesen
   *  Preis ab Jahr 2 mit der Output-Inflation (`infl.output`) fort. Siehe computeOperating. */
  priceCentPerTonne: Money;
  /** false → Basispreis ist ein Platzhalter (im Vertrag nicht befüllt) und wird in der
   *  Oberfläche sichtbar markiert. */
  priceConfirmed: boolean;
  /** Erwarteter Bonus/Malus aus der Qualitätsleiter, CENT/t (kann negativ sein). */
  bonusCentPerTonne?: Money;
  /** Anteil des Bonus, der erst deutlich später fließt (VIA AGRO: Auszahlung ab 01.12.). */
  bonusDelayDays?: number;
  /** Gewichtetes Zahlungsziel in Kalendertagen (Working-Capital-Paket B). */
  dsoDays: number;
  /** Erwartete Zurückweisungsquote am Werkstor 0..1 → mindert die abgerechnete Menge. */
  rejectRate?: number;
  /** Lagerpflicht: 'none' = kein Lager, 'atCost' = auf eigene Kosten ohne Prämie,
   *  'bonus' = Lagerung wird vergütet. */
  storage?: 'none' | 'atCost' | 'bonus';
  /** Deckungskauf-Haftung bei Untererfüllung (Downside-Paket C). */
  coverPurchase?: boolean;
  /** Forderung abtretbar? false → nicht bankfähig (kein Factoring). */
  assignable?: boolean;
  note?: string;
}

/* --------------------------------------------------------------------------
 * 8. ModelState — der vollständige, editierbare Eingabezustand
 * ------------------------------------------------------------------------ */

export interface ModelState {
  id: UUID;
  name: string;
  reportingCurrency: CurrencyCode;
  timeline: Timeline;
  scenarios: Scenario[];
  baseScenarioId: UUID;

  assumptions: Record<string /* Assumption.key */, Assumption>;

  farms: Farm[];
  parcels: Parcel[];
  crops: Crop[];
  cropPlans: CropPlan[];

  capex: CapexItem[];
  debt: DebtTranche[];
  revolver: RevolverFacility;
  workingCapital: WorkingCapitalPolicy;
  tax: TaxPolicy;
  /** USt-/TVA-Mechanik (RO). Optional; fehlt/enabled=false → keine USt-Wirkung. */
  vat?: VatPolicy;
  subsidies: Subsidy[];
  /** Abnahmeverträge je Kultur. Fehlt/leer → Umsatz komplett zum Kulturpreis (Spot). */
  offtake?: OfftakeContract[];
  biologicalAssets: BiologicalAssetPolicy;
  /** Personalplanung (RO-Standard). Optional; Arbeitgeberaufwand fließt in OpEx. */
  personnel?: PersonnelPlan;
  /** Holding-Ebene. Optional; GESONDERT gerechnet (computeHolding), nicht in OpCo-OpEx. */
  holding?: HoldingPlan;

  /** Eröffnungsbilanz (Periode -1), damit die Bilanz einen Startpunkt hat. */
  openingBalance: OpeningBalance;
}

export interface OpeningBalance {
  cash: Money;
  land: Money;
  ppeNet: Money;                      // Sachanlagen netto
  inventory: Money;
  receivables: Money;
  payables: Money;
  debt: Money;
  shareCapital: Money;
  retainedEarnings: Money;
}

/* --------------------------------------------------------------------------
 * 9. ComputedModel — reines Berechnungsergebnis (read-only Output)
 * ------------------------------------------------------------------------ */

/** Eine Ergebniszeile: ein Wert je Periode + Herkunft für Traceability. */
export interface LineItem {
  key: string;                        // "pnl.revenue", "bs.total_assets"
  label: string;
  unit: Unit;
  values: number[];                   // Länge = timeline.periodCount
  /** Keys der Vorgänger-Zeilen/Annahmen (für Trace/Precedent-Graph). */
  precedents: string[];
  /** Menschenlesbare Formel, z. B. "Fläche × Ertrag × Preis × (1−Verlust)". */
  formula?: string;
}

export interface IncomeStatement {
  revenue: LineItem;
  subsidies: LineItem;
  cogs: LineItem;
  grossProfit: LineItem;
  opex: LineItem;
  ebitda: LineItem;
  depreciation: LineItem;
  fairValueChangeBio: LineItem;       // IAS 41, 0 wenn deaktiviert
  /** Buchgewinn/-verlust aus Ausmusterung (Verkauf zu Restwert bei Flottentausch). */
  disposalResult?: LineItem;
  ebit: LineItem;
  interest: LineItem;
  pbt: LineItem;
  /** Gesamter Steueraufwand (zahlungswirksam + latent). */
  tax: LineItem;
  /** Zahlungswirksame Ertragsteuer (auf steuerliche Bemessung, fiskalische AfA). */
  currentTax: LineItem;
  /** Latente Steuer aus temporärer Differenz (bilanzielle − fiskalische AfA). */
  deferredTax: LineItem;
  netIncome: LineItem;
}

export interface BalanceSheet {
  cash: LineItem;
  receivables: LineItem;
  inventory: LineItem;
  biologicalAssets: LineItem;
  land: LineItem;
  ppeNet: LineItem;
  totalAssets: LineItem;
  /** USt-Forderung (TVA de recuperat) — Vorsteuer-Überhang, noch nicht erstattet. */
  vatReceivable?: LineItem;
  payables: LineItem;
  debt: LineItem;
  revolver: LineItem;
  deferredTaxLiability: LineItem;
  /** USt-Verbindlichkeit (TVA de plată) — Zahllast, noch nicht abgeführt. */
  vatPayable?: LineItem;
  totalLiabilities: LineItem;
  shareCapital: LineItem;
  retainedEarnings: LineItem;
  totalEquity: LineItem;
  liabilitiesAndEquity: LineItem;
}

export interface CashFlowStatement {
  netIncome: LineItem;
  addBackDepreciation: LineItem;
  addBackFvBio: LineItem;
  changeInWorkingCapital: LineItem;
  cfo: LineItem;                      // operativ
  capex: LineItem;
  /** Verkaufserlöse aus Ausmusterung (Anlagenabgang) — Teil des investiven Cashflows. */
  disposalProceeds?: LineItem;
  cfi: LineItem;                      // investiv
  debtDrawdowns: LineItem;
  debtRepayments: LineItem;
  revolverMovement: LineItem;
  equityMovement: LineItem;
  interestPaid: LineItem;
  /** USt-/TVA-Timing (Ausgangs-USt − Vorsteuer − Zahllast/Erstattung an Staat). */
  vatCashFlow?: LineItem;
  cff: LineItem;                      // Finanzierung
  netCashFlow: LineItem;
  closingCash: LineItem;
}

/** Ergebnis eines einzelnen Modell-Checks. */
export interface CheckResult {
  id: string;                         // "balance_zero", "cash_ties", ...
  label: string;
  passed: boolean;
  /** Größte Verletzung über alle Perioden (0 wenn passed). */
  maxDeviation: number;
  /** Periodenindizes, in denen der Check reißt (für Sprung zur Ursache). */
  offendingPeriods: PeriodIndex[];
  severity: 'error' | 'warning';
}

export interface KpiSet {
  ebitdaMargin: LineItem;
  netDebtToEbitda: LineItem;
  dscr: LineItem;                     // Debt Service Coverage Ratio
  icr: LineItem;                      // Interest Coverage
  roic: LineItem;
  fcf: LineItem;
}

export interface ComputedModel {
  scenarioId: UUID;
  timeline: Timeline;
  pnl: IncomeStatement;
  balanceSheet: BalanceSheet;
  cashFlow: CashFlowStatement;
  kpis: KpiSet;
  checks: CheckResult[];
  /** Metadaten des Rechenlaufs (Iterationen, Konvergenz). */
  meta: {
    revolverIterations: number;
    converged: boolean;
    computedAt?: string;              // von der aufrufenden Schicht gesetzt
  };
}

/* --------------------------------------------------------------------------
 * 10. Optionen für den Rechenlauf
 * ------------------------------------------------------------------------ */

export interface ComputeOptions {
  /** Zielgranularität der Ausgabe (Aggregation aus Basisperioden). */
  outputGranularity?: Granularity;
  /** Max. Iterationen für die Zirkel-Auflösung (Zins ↔ Cash ↔ Revolver). */
  maxRevolverIterations?: number;     // Default 50
  /** Konvergenzschwelle in Minor-Units. */
  convergenceEpsilon?: number;        // Default 1 (= 1 Cent)
}

/* --------------------------------------------------------------------------
 * 11a. Bewertung / DCF (L5)
 * ------------------------------------------------------------------------ */

export type TerminalMethod = 'gordon' | 'exit_multiple';

export interface ValuationOptions {
  /** Assumption-Key für WACC (Rate). */
  waccKey: string;
  terminalMethod: TerminalMethod;
  /** Gordon: ewige Wachstumsrate (Assumption-Key, Rate). */
  terminalGrowthKey?: string;
  /** Exit-Multiple: Faktor × (annualisiertes) EBITDA der letzten Periode. */
  exitMultiple?: number;
  /** Bandbreite für die Exit-Multiple-Sensitivität, z. B. [5, 7, 9]. */
  exitMultipleSensitivity?: number[];
}

export interface ExitScenario {
  multiple: number;
  npv: Money;          // unlevered Projekt-NPV @ WACC inkl. TV
  projectIRR: Rate;
  equityIRR: Rate;
  terminalValueFirm: Money;
}

export interface ValuationResult {
  wacc: Rate;
  fcff: LineItem;                // Free Cash Flow to Firm (unlevered)
  fcfe: LineItem;                // Free Cash Flow to Equity (levered)
  terminalValueFirm: Money;
  terminalValueEquity: Money;    // TV_firm − Netto-Finanzschuld letzte Periode
  npv: Money;                    // unlevered Projekt-NPV @ WACC (inkl. TV)
  projectIRR: Rate;              // IRR der unlevered Reihe (kann NaN sein)
  equityIRR: Rate;               // IRR der levered Equity-Reihe
  peakFundingEquity: Money;      // Tiefpunkt kumulierter Equity-CF (Kapitalbedarf)
  moic: number;                  // Equity-Multiple (Rückfluss / Einsatz)
  exitSensitivity: ExitScenario[];
}

/* --------------------------------------------------------------------------
 * 11e. Holding-Struktur (L8) — gesondert gerechnet, dann konsolidiert
 *      Eigene Kostenbasis, eigene Steuer-Jurisdiktion, eigene Finanzierung.
 * ------------------------------------------------------------------------ */

export interface HoldingCostItem {
  id: UUID;
  label: string;                // "Wirtschaftsprüfung", "Legal", "Board/D&O", "Domizil", "IT"
  /** €/Periode als Assumption-Key (sensitivierbar). Optional, wenn monthlyCent gesetzt. */
  assumptionKey?: string;
  /** Inline-Kostenwert €/Periode (CENT) — direkt editierbar; hat Vorrang vor assumptionKey. */
  monthlyCent?: Money;
}

export interface HoldingPlan {
  name?: string;                // "NEOS Holding AG"
  costItems: HoldingCostItem[];
  /** Optionales Holding-Personal (eigene Payroll-Sätze der Jurisdiktion). */
  personnel?: PersonnelPlan;
  /** Holding-Finanzierung (z. B. Akquisitionsdarlehen, Gesellschafterdarlehen). */
  debt?: DebtTranche[];
  /** Management-Fee, die an die OpCo weiterberechnet wird (IC-Ertrag der Holding). */
  managementFeeKey?: string;
  /** Gewinnsteuersatz der Holding-Jurisdiktion (Assumption-Key). */
  taxRateKey: string;
  /** Quellensteuer auf Dividenden von der OpCo (z. B. RO 8 %). */
  dividendWithholdingKey?: string;
}

/** Rolle einer Konzern-Gesellschaft im Multi-Entity-Register. */
export type EntityRole = "opco" | "propco" | "holding" | "service" | "other";

/** Rechtsträger (Gesellschaft) im Multi-Entity-/Konsolidierungs-Register.
 *  Anbauplanung bleibt global — die Entitäten strukturieren Eigentum/Steuer/IC. */
export interface Entity {
  id: string;
  name: string;
  /** RO: CUI/CIF (nur Ziffern, ohne „RO"). Basis für den ANAF-Lookup. */
  cui?: string;
  role: EntityRole;
  country: "RO" | "CY" | "DE" | "other";
  /** Beteiligung der Mutter/Holding an dieser Gesellschaft (0–100 %). */
  ownershipPct: number;
  /** USt-/TVA-pflichtig (scpTVA aus ANAF). */
  vatActive?: boolean;
  /** Handelsregister-Nr. (nrRegCom aus ANAF). */
  regCom?: string;
  /** Sitz-Adresse (adresa aus ANAF). */
  address?: string;
  note?: string;
  /** ISO-Datum des letzten erfolgreichen ANAF-Abgleichs. */
  anafCheckedAt?: string;
}

export interface HoldingResult {
  operatingCosts: LineItem;       // Summe Kostenpositionen
  personnelCost: LineItem;        // Arbeitgeberaufwand Holding-Personal
  financingInterest: LineItem;    // Zins Holding-Finanzierung
  managementFeeIncome: LineItem;  // IC-Ertrag (an OpCo weiterberechnet)
  pbt: LineItem;                  // Ergebnis vor Steuern (Holding)
  tax: LineItem;                  // Holding-Ertragsteuer
  netIncome: LineItem;            // Holding-Jahresergebnis
  totalCashCost: LineItem;        // Netto-Cash-Belastung der Holding-Ebene
}

export interface GroupResult {
  ebitda: LineItem;               // Konzern-EBITDA (OpCo − Holding-Überkopf)
  ebit: LineItem;
  netIncome: LineItem;            // Konzern-Jahresergebnis (IC-Fee eliminiert)
  tax: LineItem;                  // Σ Steuern beider Ebenen (keine Steuergruppe)
  holdingCostShare: LineItem;     // Holding-Kostenanteil, der das Konzern-EBITDA mindert
}

/* --------------------------------------------------------------------------
 * 11d. Personalplanung nach RO-Standard (L7)
 *      CAS 25 % + CASS 10 % (AN) · Impozit 10 % (nach Abzug CAS/CASS + Freibetrag)
 *      · CAM 2,25 % (AG). Sätze konfigurierbar (Agrar-Vergünstigungen möglich).
 * ------------------------------------------------------------------------ */

export interface PayrollRates {
  cas: Rate;                    // Rentenversicherung AN (Standard 0.25)
  cass: Rate;                   // Krankenversicherung AN (0.10)
  incomeTax: Rate;             // Impozit pe venit (0.10)
  cam: Rate;                    // Contribuția asiguratorie pentru muncă AG (0.0225)
  /** Deducere personală: monatlicher Personenfreibetrag (Minor-Units). */
  personalDeductionMonthly?: Money;
}

export interface EmployeeRole {
  id: UUID;
  title: string;                // "Traktorist", "Agronom", "Betriebsleiter"
  /** Assumption-Key: Anzahl FTE (kann rampen / je Periode variieren). */
  headcountKey: string;
  /** Assumption-Key: Bruttomonatsgehalt je FTE (€) — sensitivierbar (Lohninflation). */
  grossMonthlyKey: string;
  /** Gruppierung für die Personalplanung: 'leitung' | 'stamm' | 'betrieb' | 'saison'. */
  category?: string;
}

export interface PersonnelPlan {
  rates: PayrollRates;
  roles: EmployeeRole[];
  /**
   * Bezahlte Monatsgehälter je Periode. Fehlt der Wert, wird 12/ppy angesetzt
   * (Jahresmodell = 12, Monatsmodell = 1). Für ein 13. Gehalt anpassen.
   */
  monthsPerPeriodOverride?: number;
}

export interface PersonnelResult {
  gross: LineItem;              // Bruttolohnsumme
  employeeCas: LineItem;        // AN: Rentenbeitrag (einbehalten)
  employeeCass: LineItem;       // AN: Krankenbeitrag (einbehalten)
  incomeTax: LineItem;          // AN: Lohnsteuer (einbehalten)
  net: LineItem;               // Nettoauszahlung
  employerCam: LineItem;        // AG: CAM
  /** Gesamter Arbeitgeberaufwand = Brutto + CAM (P&L-/Cash-relevanter Personalaufwand). */
  totalEmployerCost: LineItem;
  headcount: LineItem;          // Σ FTE je Periode
}

/* --------------------------------------------------------------------------
 * 11c. Kostenaufriss nach Kostenart (L4)
 * ------------------------------------------------------------------------ */

export interface CostBreakdown {
  /** Gesamte COGS je Periode (Minor-Units). */
  total: number[];
  /** COGS je Kostenart je Periode. */
  byType: Record<CostType, number[]>;
  /** Anteil je Kostenart über den gesamten Horizont (0..1), Summe ≈ 1. */
  shareByType: Record<CostType, number>;
}

/* --------------------------------------------------------------------------
 * 11b. Sensitivität / Tornado (L6)
 * ------------------------------------------------------------------------ */

/** Kennzahl, auf die ein Treiber wirkt. */
export type SensitivityMetric = 'npv' | 'equityIRR' | 'projectIRR' | 'ebitdaLast';

export interface SensitivityDriver {
  name: string;
  /** Ein oder mehrere Assumption-Keys, die gemeinsam ausgelenkt werden. */
  assumptionKeys: string[];
  /** relative Auslenkung (×(1±delta)) oder absolute (±delta auf das Niveau). */
  mode: 'relative' | 'absolute';
  delta: number;
}

export interface TornadoBar {
  name: string;
  low: number;   // Metrik bei −Auslenkung
  high: number;  // Metrik bei +Auslenkung
  swingLow: number;  // low − base (i. d. R. negativ)
  swingHigh: number; // high − base
  /** |swingLow| + |swingHigh| — Sortierkriterium (Hebel). */
  totalSwing: number;
}

export interface TornadoResult {
  metric: SensitivityMetric;
  base: number;
  bars: TornadoBar[]; // absteigend nach totalSwing (größter Hebel zuerst)
}

/* --------------------------------------------------------------------------
 * 11. Finanzierungs-/Leasing-Rechner (Ratenplan-Rechner, eigenständig)
 *     Bildet Functional Brief "Financing/Leasing" §4 ab. Reine Kalkulation
 *     eines einzelnen Vertrags, unabhängig vom 3-Statement-Kern.
 * ------------------------------------------------------------------------ */

export interface FinancingContract {
  name?: string;
  price: Money;                       // Objektpreis netto
  avansRate: Rate;                    // Anzahlung als Anteil des Preises
  residualRate: Rate;                 // Restwert/Ballon als Anteil des Preises
  termMonths: number;
  indexRate: Rate;                    // EURIBOR (variabel)
  marginRate: Rate;                   // Bankmarge
  frequency: PaymentFrequency;
  method: 'annuity' | 'linear';
  seasonMonths?: number[];            // nur seasonal
}

export interface FinancingScheduleRow {
  period: number;
  payment: Money;
  interest: Money;
  principal: Money;
  balance: Money;                     // Restschuld (läuft auf Restwert, nicht 0)
}

export interface FinancingSchedule {
  avans: Money;
  residual: Money;
  financedPrincipal: Money;           // price − avans
  annualRate: Rate;                   // index + margin (+ Stress-Delta)
  paymentsPerYear: number;
  numPayments: number;
  payment: Money;                     // Perioden-Rate (annuity: konstant)
  rows: FinancingScheduleRow[];
  totalInterest: Money;
  totalPaid: Money;                   // Σ Raten + Avans + Restwert
}
