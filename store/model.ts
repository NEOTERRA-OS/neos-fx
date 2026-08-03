/**
 * ============================================================================
 *  NEOS FX — Domänen-Datenmodell-Kern (Single Source of Truth)
 *  KANONISCHE NEOTERRA-Kostenbasis · Eigenmechanisierung · 3-Statement-konform
 * ----------------------------------------------------------------------------
 *  Drei gekoppelte Schichten:
 *    1) catalog       — Agronomie-Direktkosten je Kultur (Operationen → opLines)
 *    2) anbauplan     — VARIABLER Anbauplan (6-Feld-Rotation, Fläche = ÷6)
 *    3) machineCatalog— Maschinenpark (15 Feldmaschinen + Beregnung + Lager)
 *
 *  Der Composer buildModelState(domain, scenarioId) setzt daraus einen gültigen
 *  ModelState (core/types.ts) zusammen; deriveCapex(domain, scenarioId) leitet
 *  Flotte/CAPEX aus fester Flottenzahl × stageFactor ab.
 *
 *  3-STATEMENT-SPLIT (KEINE Doppelzählung):
 *   - Agronomie-Direktkosten (Saatgut/Dünger/PSM/Beregnung-Wasser/Material/Handarbeit)
 *       → COGS via editierbarem catalog (opLines, unitCostKey 'price.per_euro').
 *   - Maschinen-BETRIEBskosten (Vers+Rep+Diesel+Schmier je €/h, OHNE AfA/Zins)
 *       → COGS, composer-seitig aus den Arbeitsgängen (Referenz C) berechnet und je
 *         Kultur als EINE zusätzliche 'machine'-cropPlan-Operation angehängt.
 *   - Maschinen-AfA + Zins → NICHT in COGS: AfA via Flotten-CAPEX (Engine-AfA),
 *       Zins via Finanzierung. Beregnung-Pivot-Fixkosten → durch Bewässerungs-CAPEX
 *       (irrigation €/ha → Engine-AfA) abgedeckt, NICHT als opex (sonst doppelt).
 *   - Personal (Maschinenführer + Saison + Bewässerung/Lager/Werkstatt) via
 *       personnel-Modell (RO-Payroll), AG-Aufwand → OpEx (nicht in COGS).
 *   - Fixkosten (Pacht 250 €/ha alle + Overhead/Versich./Zins je Kultur)
 *       → composer setzt opex.fix (Monatswert), die Engine summiert opex.* in OpEx.
 *
 *  Geld überall in MINOR-UNITS (Cent). Raten als Dezimalbruch. FX 1 € = 5,0 RON.
 *  Quelle: NEOS-FX-Kostenkalkulation-Referenz.md, Abschnitte A–F.
 * ============================================================================
 */
import type {
  ModelState,
  Assumption,
  AssumptionMeta,
  Timeline,
  Scenario,
  Unit,
  Operation,
  CostLine,
  CostType,
  CropPlan,
  Crop,
  Parcel,
  Farm,
  CapexItem,
  AssetClass,
  FinancingMode,
  DebtTranche,
  LeasingContract,
  RevolverFacility,
  WorkingCapitalPolicy,
  TaxPolicy,
  VatPolicy,
  Subsidy,
  PersonnelPlan,
  HoldingPlan,
  Entity,
  OpeningBalance,
  BiologicalAssetPolicy,
  OfftakeContract,
  HarvestAdvancePolicy,
  UUID,
  CheckResult,
} from "../core/types";
export type { OfftakeContract, HarvestAdvancePolicy } from "../core/types";
import { DEFAULT_PRODUCTS, type CatalogProduct } from "./productCatalog";
export type { CatalogProduct } from "./productCatalog";

/* --------------------------------------------------------------------------
 * Szenario-IDs
 * ------------------------------------------------------------------------ */
const base: UUID = "sc-base";
const best: UUID = "sc-best";
const worst: UUID = "sc-worst";
export const BASE_SCENARIO_ID = base;

/* --------------------------------------------------------------------------
 * Skalierungsstufen (Referenz E). beregnete Fläche & stageFactor je Stufe.
 * ------------------------------------------------------------------------ */
export type Stage = 1 | 2 | "3b";
/** UI-Stufenauswahl (Toggle) — der Buchstabe kodiert die zusätzliche Stellschraube:
 *   1  = Basis: nur Cash Crops (Ackerbau, ohne Wertkulturen) · Benchmark
 *   1a = + Wertkulturen (Value: Gemüse/Kartoffel)         [a = Anbau Wertkulturen]
 *   2b = + Vollberegnung (gesamte Fläche beregnet)         [b = Beregnung]
 *   3c = + Fläche & Beregnung (Zukauf bis Zielausbau)      [c = Fläche + Beregnung]
 *  Intern: 1→s1a · 1a→s1 · 2b→s2 · 3c→s3b. */
export type StageSel = "1" | "1a" | "2b" | "3c";
/* ENTFERNT 31.07.2026: STAGE_SEMANTICS (Legende Stufe 1/1a/2b/3c) — es gibt nur noch
   eine Stufe; die Karte im Dashboard beschrieb eine Welt, die das Modell nicht mehr kennt. */
/** Betriebsgröße als KALIBRIERUNGSBASIS — keine Ausbaustufen mehr. Der Betrieb wächst über
 *  den Kultur-Skalierungspfad (SKALIERUNG_HA), nicht über Stufen. Die 4.000 ha sind die
 *  Bezugsgröße, auf die der Pfad kalibriert ist (buildAnbauplan / skalierungPolicy).
 *  ENTFERNT 31.07.2026: Stufe 2 (10.000 ha) und Stufe 3b (20.000 ha). domain.stage war
 *  ohnehin fest auf 1 verdrahtet, stageFactorOf lieferte damit immer 1. */
export const STAGES: Record<string, { label: string; beregneteFlaecheHa: number; stageFactor: number; feldHa: number }> = {
  "1": { label: "NEOTERRA SRL", beregneteFlaecheHa: 4000, stageFactor: 1, feldHa: 667 },
};
const stageFactorOf = (_stage: Stage): number => 1;

/* --------------------------------------------------------------------------
 * Export-Vertrag: Typen
 * ------------------------------------------------------------------------ */
export type OpLineSeed = {
  label: string;
  costType: CostType;
  quantityPerHa: number;
  unitCostKey: string;
  /** Natürliche Einheit der Menge (kg, t, Einh., mm, €/ha …) — für transparente Aufschlüsselung. */
  unit?: string;
  /** Verknüpftes Produkt aus dem Produktkatalog (Sync-Referenz). */
  productId?: string;
  /** Nur OP-PSM: Spritz-Überfahrten dieser Anwendung (Default 1; treibt die Spritzen-Passes). */
  passes?: number;
  /** Stabile Maßnahmen-ID (FMS-Abgleich Plan ↔ Ist). Zeilen EINER Gabe teilen sich die mid. */
  mid?: string;
};
export type OpSeed = {
  code: string;
  label: string;
  costPeriods: number[];
  lines: OpLineSeed[];
};
export type CatalogEntry = {
  cropId: string;
  name: string;
  type: "annual" | "perennial";
  yieldKey: string;
  priceKey: string;
  lossKey: string;
  qualityKey?: string;
  plantingPeriod: number;
  harvestPeriods: number[];
  /** Aussaat-/Pflanzmonat (0=Jan) — editierbarer Timing-Anker der BBCH-Maßnahmenkette.
   *  Fehlt → Standort-Default (SOW_MONTH). Alle Maßnahmen hängen relativ an S (Saat) bzw. E (Ernte). */
  sowMonth?: number;
  ops: OpSeed[];
};
export type MachineDriver =
  | { kind: "crop"; cropId: string }
  | { kind: "valueCrops" }
  | { kind: "crops"; ids: string[]; /** true → nicht Jahresdurchsatz, sondern gleichzeitige Spitzenbelegung. */ peakConcurrent?: boolean }
  | { kind: "irrigated" }   // nur beregnete Fläche (pool !== "dryland") — z. B. Beregnung/Pivot-CAPEX
  | { kind: "total" };
export type MachineType = {
  id: string;
  label: string;
  capacityKey?: string;
  unitPriceKey?: string;
  /** Inline-Stückpreis (CENT) — überschreibt unitPriceKey. Für editierbare/eigene Maschinen. */
  priceCent?: number;
  /** true = editierbar/nutzergepflegt (reine CAPEX-Register-Zeile, kein Arbeitsgang). */
  custom?: boolean;
  mode: "perUnit" | "perHa" | "perTonne" | "fixedFleet";
  driver: MachineDriver;
  assetClass: string;
  afaFiscalYears: number;
  afaCommercialYears: number;
  note?: string;
  // --- Maschinen-Einzelkosten / TCO (optional, Alt-Vertrag) ---
  /** Flächenleistung ha/h. Fehlt → Maschine ohne Stundenbezug (nur AfA + Versicherung). */
  haPerHour?: number;
  /** Assumption-Key für Wartung/Service €/h (CENT), SEPARAT ausgewiesen. */
  serviceRateKey?: string;
  /** Reparaturen als Anteil des Neupreises über die ganze Nutzungsdauer (z. B. 0.7). */
  repairPctLife?: number;
  /** Versicherung + Unterstellung als %/Jahr des Neupreises (z. B. 0.01). */
  insurancePct?: number;
  /** Dieselverbrauch l/h. */
  dieselLPerHour?: number;
  // --- NEU: kanonische NEOTERRA-Maschinenparameter (Referenz B/D) ---
  /** Feste Flottenzahl bei Stufe 1 (× stageFactor, aufgerundet). */
  fleetStage1?: number;
  /** Effektive Flächenleistung C_eff (ha/h) — Referenz B. */
  cEff?: number;
  /** Restwert als Anteil des Neupreises. */
  restwertPct?: number;
  /** Nutzungsdauer (Jahre) — Referenz B. */
  nutzungYears?: number;
  /** Referenz-Auslastung h/Jahr — Referenz B. */
  refHoursPerYear?: number;
  /** AfA €/h (CENT) — Referenz B (fix, → CAPEX). */
  afaPerHourCent?: number;
  /** kalk. Zins €/h (CENT) — Referenz B (fix, → Finanzierung). */
  interestPerHourCent?: number;
  /** Versicherung €/h (CENT) — Referenz B (Betriebskosten, → COGS). */
  insurancePerHourCent?: number;
  /** Reparaturen €/h (CENT) — Referenz B (Betriebskosten, → COGS). */
  repairPerHourCent?: number;
  /** Schmierstoffe €/h (CENT) — Referenz B (Betriebskosten, → COGS). */
  lubePerHourCent?: number;
  /** Bauart für globale TCO (Restwert-Klasse): gezogen (res_trail) vs. selbstf. (res_self). */
  cat?: "gezogen" | "selbstf";
  // --- Per-Maschine-TCO-Overrides (reale Angebotswerte; überschreiben tco.*-Defaults) ---
  /** Einkaufsrabatt auf Liste, maschinenspezifisch. Fehlt → globaler tco.discount. */
  discountPct?: number;
  /** Restwert als Anteil der LISTE, maschinenspezifisch. Fehlt → tco.res_trail/res_self je cat. */
  residualPctList?: number;
  /** Für CAPEX-only-Träger (z. B. Zugschlepper): Service-Stunden = Stunden dieser Anbaugerät-id. */
  serviceHoursLike?: string;
  /** Delta 21.07. (2): Teil des fenstergetriebenen Spritzen-Mischparks. Count NICHT aus
   *  fleetStage1, sondern aus dem Mehrkultur-Sommerpeak (deriveSprayFleet), Anteil gezogen/SF. */
  sprayPart?: "gz" | "sf";
  /** Bestand-vs-Plan: bereits im Betrieb vorhandene Einheiten. Neu-CAPEX (Bilanzzugang +
   *  Finanzierung) entsteht nur für ⌈benötigte Flotte − ownedUnits⌉. Editierbar (Swap Ist/Plan). */
  ownedUnits?: number;
  /** MASCHINENMIETE AM MARKT (nicht Intercompany — das Solo-Modell hat keine zweite operative
   *  Gesellschaft mehr). Einheiten, die NICHT gekauft, sondern gemietet werden: kein CAPEX/AfA,
   *  stattdessen stundenbasierte Miet-OPEX (gemietete Stück × Stunden/Stück × €/h aus
   *  Stundenkosten × (1 + machine.rent_markup)). Neu-CAPEX = ⌈benötigt − owned − rented⌉. */
  rentedUnits?: number;
  /** Verleiher (Entity.id) — im Solo-Modell unbesetzt, es wird am Markt gemietet. Das Feld
   *  bleibt für gespeicherte Stände lesbar, hat aber keine Rechenwirkung mehr. */
  rentedFrom?: string;
  /** Durchschnittsalter des Bestands (Jahre) → Restbuchwert = Netto × max(Restwert-%,
   *  1 − (1−Restwert-%) × Verschleiß). Editierbar im Register. */
  ownedAgeYears?: number;
  /** Kumulierte Betriebsstunden des Bestands (Bh) → Verschleiß = Bh / (h/Jahr × Nutzungsdauer). */
  ownedHours?: number;
  /** Kumulierte bearbeitete Fläche des Bestands (ha) → Verschleiß = ha / (Lebensdauer-ha). Nur Anbaugeräte mit C_eff. */
  ownedHa?: number;
  /** Hybrid-Override: manuell fixierte Flottenzahl (überschreibt das Bottom-up-Sizing). */
  fleetOverride?: number;
  /** Leistungsdaten (C_eff-Herleitung): Arbeitsbreite (m), Fahrgeschwindigkeit (km/h),
   *  Feldeffizienz (0..1). C_eff = Breite × Geschw. × Eff ÷ 10 (ha/h). Editierbar → treibt cEff. */
  widthM?: number;
  speedKmh?: number;
  fieldEff?: number;
  /** Bearbeitbare Feldtage im kritischen Fenster (Sizing). Fehlt → WINDOW_FELDTAGE[id]. */
  windowDays?: number;
  /** 48-m-Paket-Gate: "base" nur aktiv wenn farm.boom48=0, "boom48" nur wenn =1. Sonst Flotte 0. */
  activeWhen?: "base" | "boom48";
  /** Zugmaschine (Traktor-id) für gezogene Anbaugeräte — nur Zuordnung/Anzeige; Traktor ist eigene
   *  CAPEX-Position (zug_9r/8rx/6r). Kraftstoff des Arbeitsgangs bleibt am Gerät (lastabhängig). */
  tractorId?: string;
  // --- Strukturiertes Register (editierbar) ---
  /** Maschinenkategorie (Bodenbearbeitung, Sätechnik, Ernte, Zugmaschine, …). */
  category?: string;
  /** Hersteller / Marke (John Deere, HORSCH, ROPA, …). */
  manufacturer?: string;
  /** Produktbezeichnung / Modell (ohne Hersteller). */
  productName?: string;
};
export type AnbauEntry = {
  id: string;
  cropId: string;
  areaHa: number;
  plantingPeriod: number;
  harvestPeriods: number[];
  /** Wasserregime des Eintrags: beregnet (Default) vs. unberegnete Trockenrotation.
   *  Steuert die Zwei-Pool-Flächenskalierung (irrigated → areaByYear, dryland → total − areaByYear). */
  pool?: "irrigated" | "dryland";
  /** Gesellschaft, der diese Kultur zugeordnet ist (Entity-Split). Fehlt → aus Value/Cash abgeleitet
   *  (Value Crops → NEOTERRA-OpCo, Cash/Trockenrotation → Isolde). Referenziert Entity.id. */
  entityId?: string;
};
export type DerivedCapex = {
  machineId: string;
  label: string;
  areaHa: number;
  count: number;
  unitPrice: number;
  amount: number;
  assetClass: string;
  /** Bestand-vs-Plan: bereits vorhandene Einheiten (kein Neu-CAPEX). */
  ownedUnits?: number;
  /** Neu zu beschaffende Einheiten = max(0, count − ownedUnits); nur diese erzeugen `amount`. */
  newUnits?: number;
  /** Intercompany gemietete Einheiten (kein CAPEX — Miet-OPEX). Reduziert die kapitalisierte Flotte. */
  rentedUnits?: number;
};
export type TCOBreakdown = {
  machineId: string; label: string; count: number; assetClass: string;
  hoursPerYear: number | null;                 // null bei Maschinen ohne Stundenbezug
  fixedPerYear: { afa: number; interest: number; insurance: number; total: number };   // CENT, Flotte gesamt
  variablePerHour: { service: number; repair: number; diesel: number; operator: number; total: number }; // CENT/h
  eurPerHour: number | null; eurPerHa: number | null;   // CENT
  serviceRateKey?: string;
};
/** Arbeitsgang: Maschine (machineCatalog-id) × Überfahrten (Referenz C). */
export type Arbeitsgang = { m: string; passes: number; mid?: string };

/** LOHNARBEIT (Dienstleistungs-Einkauf): ein Arbeitsgang EINER Kultur wird fremdvergeben.
 *  Satz je Hektar und ÜBERFAHRT, EXKLUSIVE Diesel — der Kraftstoff bleibt bei uns (so rechnen
 *  die Erfahrungssätze der Landwirtschaftskammer und so wird in der Praxis abgerechnet).
 *  Wirkung, wenn aktiv:
 *   · Lohnkosten als eigene COGS-Operation (Satz × Überfahrten × ha) — zahlungswirksam,
 *     wird wie jede Feldmaßnahme im Feldbestand aktiviert und bei der Ernte aufgelöst,
 *   · Maschinen-Betriebskosten des Gangs entfallen (Versicherung, Reparatur, Schmierstoff) —
 *     der DIESEL bleibt, weil der Satz ihn nicht enthält,
 *   · kalkulatorische Maschinenkosten (AfA + Zins) des Gangs entfallen,
 *   · die Maschine wird für diese Kultur nicht mehr bemessen; wird sie von KEINER Kultur mehr
 *     selbst gefahren, entfällt sie aus der Flotte (kein CAPEX). Ist Lohnarbeit nur befristet,
 *     verschiebt sich die Anschaffung auf das erste Jahr in Eigenmechanisierung. */
export type LohnarbeitEntry = {
  id: string;
  cropId: string;
  machineId: string;          // ersetzter Arbeitsgang (Maschine aus arbeitsgaenge)
  label: string;
  gruppe: "boden" | "pflanzung" | "psm_duenger" | "ernte";
  /** Satz in CENT je ha und ÜBERFAHRT, ohne Kraftstoff, mit Fahrer. */
  ratePerHaCent: number;
  /** true → Diesel steckt im Satz und entfällt bei uns. Default false (Satz exkl. Diesel). */
  dieselIncluded?: boolean;
  fromYear?: number;          // erstes Planjahr mit Lohnarbeit (Default 0)
  toYear?: number;            // letztes Planjahr mit Lohnarbeit (Default: bis Horizontende)
  active: boolean;
  quelle?: string;            // Herkunft des Satzes
};
/** Modell-Entscheidungen (Make-or-Buy etc.). */
export type Decisions = { transportToBuyer: "own" | "spedition" };
export type Domain = {
  meta: { id: string; name: string; reportingCurrency: string };
  /** Skalierungsstufe: treibt Flotte (× stageFactor) und Personal-Kopfzahlen. */
  stage: Stage;
  /** Scope: volle 6-Feld-Rotation ('full') vs. nur Wertkulturen stand-alone ('valueOnly'). */
  scope?: "full" | "valueOnly";
  /** Entity-Sicht (Header): Gesellschaft, für die ALLES gerechnet wird (Vollkosten-Standalone).
   *  Fehlt / 'combined' → kombiniertes Gesamtmodell. Referenziert Entity.id (z. B. 'ent-opco'/'ent-isolde'). */
  entityView?: string;
  timeline: Timeline;
  scenarios: Scenario[];
  baseScenarioId: string;
  assumptions: Record<string, Assumption>;
  /** Stand der STAMMDATEN, aus denen dieser Domänen-Stand gebaut wurde (siehe STAMMDATEN_VERSION).
   *  Liegt er zurück, zieht `migrateDomain` Maschinenkatalog, Listenpreise, Gemeinkosten-Register
   *  und neue Annahme-Keys aus dem Seed nach — Planentscheidungen bleiben unangetastet. */
  stammdatenVersion?: number;
  catalog: CatalogEntry[];
  machineCatalog: MachineType[];
  anbauplan: AnbauEntry[];
  /** Editierbare Arbeitsgänge je Kultur (cropId → Maschine·Überfahrten). Referenz C. */
  arbeitsgaenge: Record<string, Arbeitsgang[]>;
  /** Modell-Entscheidungen (Make-or-Buy). */
  decisions: Decisions;
  debt: DebtTranche[];
  /** Reale Finanzierungs-/Leasingverträge (je CAPEX-Position/Paket). Composer → debt. */
  financingContracts: LeasingContract[];
  revolver: RevolverFacility;
  workingCapital: WorkingCapitalPolicy;
  tax: TaxPolicy;
  /** USt-/TVA-Mechanik (RO). */
  vat: VatPolicy;
  subsidies: Subsidy[];
  personnel?: PersonnelPlan;
  holding?: HoldingPlan;
  /** Multi-Entity-Register (Gesellschaften): Eigentum/Steuer/IC. Anbauplanung bleibt global. */
  entities?: Entity[];
  /** Konzern-Konsolidierung (opt-in): IC-Elimination (Pacht OpCo↔PropCo, Fee OpCo↔Holding). */
  consolidation?: { active: boolean };
  openingBalance: OpeningBalance;
  biologicalAssets: BiologicalAssetPolicy;
  /** Corporate-Gemeinkosten / SG&A — strukturiert, editierbar, erweiterbar. Summe → opex.sga. */
  overhead: OverheadItem[];
  /** Mehrjahres-Wachstumsplan (Ziel-ha je Jahr). Fehlt/years≤1 → Einzeljahr. */
  growth?: GrowthPlan;
  /** Ersatzinvestitions-Konfiguration je Maschine (machineId → Cfg). Fehlt → Defaults. */
  replacement?: Record<string, ReplCfg>;
  /** Transport-Eigenflotte-Parameter (CAPEX-Szenarien-Rechner). Fehlt → Defaults. */
  transport?: TransportConfig;
  /** Sensitivitäts-Konfiguration (persistiert): Tornado-Treiber + benutzerdefinierte Szenarien. */
  sensitivity?: SensitivityConfig;
  /** Pacht an die Besitzgesellschaft (Eigentumsflächen außerhalb der OpCo). */
  pacht?: PachtConfig;
  /** Detail-CAPEX-Planung (Infrastruktur): editierbare Einzelpositionen je Block. */
  /** Treiberverhaeltnis je Personalposition (ha/FTE, h/FTE, Stk/FTE bzw. Ziel-FTE). */
  personalRatio?: Record<string, number>;
  /** MANUELLE Kopfzahl je Position und Planjahr. Schlaegt den Treiber. null = Treiber gilt.
   *  Der Treiber ist ein Vorschlag, keine Vorschrift: wer den Betrieb kennt, weiss besser,
   *  ob 2029 ein Agronom mehr noetig ist, als es jede Verhaeltniszahl hergibt. */
  personalOverride?: Record<string, (number | null)[]>;
  capexPlan?: CapexPlanItem[];
  /** Hybrid-Schalter je Block: true → Detailzeilen zählen & Auto-Block (Beregnung/Lager) aus;
   *  false → Auto-Block läuft, Detailzeilen sind reine Planung (zählen nicht). */
  capexPlanActive?: Partial<Record<CapexBlock, boolean>>;
  /** Fahrgassen-Ökonomie (Pivot-Geometrie) — treibt den 36-vs-48-m-Ertragseffekt bei Wertkulturen. */
  tramline?: TramlineConfig;
  /** Standort-Profil — parametrisiert den Agronomie-Advisor (Niederschlag/Boden/Klima) je Betrieb. */
  standort?: StandortProfil;
  /** Baseline-Snapshot des Anbauplans für den What-if-Vergleich (Fläche je Kultur). */
  anbauBaseline?: { cropId: string; areaHa: number }[];
  /** Ist-Stand des jetzigen Gesellschafters (Benchmark ggü. Stufe 1a/1b). Alle Geldwerte CENT. */
  gesellschafterIst?: { umsatzCent: number; ebitdaCent: number; netIncomeCent: number; flaecheHa: number };
  /** Bodenprobenahme Make-or-Buy (eigener UTV-Rig vs. Dienstleister). */
  soilSampling?: SoilSamplingConfig;
  /** Kultur-Skalierungspolitik über den Flächen-Ramp (cropId → Politik). Fehlt → "scale". */
  cropPolicy?: Record<string, CropPolicy>;
  /** Produktkatalog (Dünger/PSM/Blattdünger/Beizung/Sorten) — Entscheidungshilfe je Maßnahme,
   *  sync-ready für Abgleich mit der NEOS Web App. Fehlt → DEFAULT_PRODUCTS. */
  productCatalog?: CatalogProduct[];
  /** Kommentar-Threads (Team-Diskussion) je Ziel (Treiber/Zahl). Im gemeinsamen Cloud-Stand. */
  comments?: CommentThread[];
  /** Abnahmeverträge (Off-taker) je Kultur — kontraktspezifischer Preis statt Punktwert.
   *  Fehlt/leer → Umsatz rechnet unverändert mit dem Kulturpreis aus den Annahmen. */
  offtake?: OfftakeContract[];
  /** Anzahlungen der Off-taker — Quote auf den GEPLANTEN ERNTEWERT (Fläche × Ertrag × Preis),
   *  nicht je Vertrag. Fehlt/inaktiv → keine Anzahlungswirkung. */
  harvestAdvance?: HarvestAdvancePolicy;
  /** Lohnarbeit / Dienstleistungs-Einkauf je Kultur und Arbeitsgang. Fehlt → alles in
   *  Eigenmechanisierung. Einträge sind einzeln scharfschaltbar (active). */
  lohnarbeit?: LohnarbeitEntry[];
};

/** Kommentar-Thread an einem Ziel (z. B. Annahme, Maßnahme). Nachrichten chronologisch. */
export type CommentMessage = { id: string; author: string; ts: string; text: string };
export type CommentThread = {
  id: string;
  target: string;          // stabiler Ziel-Schlüssel, z. B. "assumption:yield.weizen"
  targetLabel: string;     // menschenlesbar, z. B. "Ertrag Winterweizen"
  area?: string;           // Bereich (Annahmen, Maschinen …) für die Übersicht
  resolved: boolean;
  messages: CommentMessage[];
};

/** Skalierungspolitik je Kultur über den Mehrjahres-Ramp:
 *  · "scale" (Default): Fläche wächst proportional mit der beregneten Fläche (Residual-Füller).
 *  · "fix":   Fläche bleibt konstant (z. B. Tomate = kontrahierte Werkskapazität).
 *  · "ramp":  Fläche wächst SCHNELLSTMÖGLICH auf targetHa — begrenzt durch shareCap
 *             (Anbaupause: Kartoffel ≤ 25 % der beregneten Fläche, Wirtsgruppen-weit).
 *  · "path":  EXPLIZITER Skalierungspfad — haByYear[] gibt die Fläche je Planjahr direkt vor
 *             (Index 0 = START_YEAR). Kürzer als der Horizont ⇒ letzter Wert wird fortgeschrieben.
 *             Für Kulturen, deren Hochlauf verhandelt/beschlossen ist (Kartoffel 300 ha 2027 →
 *             1.000 ha 2031) und nicht aus einer Optimierung fallen soll. */
export type CropPolicy = {
  mode: "scale" | "fix" | "ramp" | "path";
  targetHa?: number;      // Ziel-Fläche (nur ramp)
  /** Fläche je Planjahr in ha (nur "path"); Index 0 = START_YEAR. Kurz ⇒ letzter Wert gilt weiter. */
  haByYear?: number[];
  shareCap?: number;      // max. Anteil an der beregneten Fläche (Default 0.25 für Kartoffel-Gruppe)
  /** ABSATZ-Obergrenze in t/Jahr (Marktanalyse): Fläche wird auf capTonnes/Ertrag gekappt,
   *  der Überschuss wandert in die übrigen scale-Kulturen (v. a. Cash Crops/Kartoffel-Rotation). */
  capTonnes?: number;
};

/** Kartoffel-Wirtsgruppe (gemeinsame Anbaupause → gemeinsamer shareCap). */
const KART_GROUP = new Set(["kartoffel_pommes", "kartoffel_chips"]);
const KART_CAP_DEFAULT = 0.25; // 4-Jahres-Anbaupause ⇒ max. 1/4 der Rotationsfläche

/** DOLDENBLÜTLER-Gruppe (Apiaceae: Sellerie, Möhre, Pastinake, Petersilie …) — gemeinsame
 *  4–5-jährige Anbaupause (Nematoden, Septoria, Sclerotinia) ⇒ gemeinsam ≤ ~20 % der Rotation.
 *  zwiebel_moehre zählt nur zur HÄLFTE (Möhren-Anteil; Zwiebel ist Amaryllisgewächs). */
export const APIACEAE_WEIGHT: Record<string, number> = { knollensellerie: 1, zwiebel_moehre: 0.5 };
export const DOLDEN_CAP_DEFAULT = 0.20;

/** Kultur-Flächen je Ramp-Jahr nach Politik. Liefert je Kultur die ha-Kurve über die Jahre.
 *  Reihenfolge: (1) fix-Kulturen konstant, (2) ramp-Kulturen so schnell wie der shareCap erlaubt
 *  Richtung Ziel (Kartoffel-Gruppe gemeinsam gedeckelt), (3) Residual proportional auf die
 *  scale-Kulturen — Σ je Jahr = beregnete Fläche des Jahres (Rotationsfläche bleibt konsistent). */
export function deriveCropAreasMY(domain: Domain): { years: number; irrHa: number[]; areas: Record<string, number[]> } {
  const years = Math.max(1, domain.growth?.years ?? 1);
  const gEff = effectiveGrowth(domain.growth);
  const baseArea = domain.anbauplan.filter((a) => a.pool !== "dryland").reduce((s, a) => s + a.areaHa, 0) || 1;
  const irrHa = Array.from({ length: years }, (_, y) => {
    const a = gEff?.areaByYear?.[y];
    return a && a > 0 ? a : baseArea;
  });
  const pol = domain.cropPolicy ?? {};
  const areas: Record<string, number[]> = {};
  for (const e of domain.anbauplan) areas[e.cropId] = new Array(years).fill(0);
  const baseOf = (id: string) => domain.anbauplan.filter((e) => e.cropId === id).reduce((s, e) => s + e.areaHa, 0);
  // Zwei-Pool: Dryland-Kulturen füllen die unberegnete Fläche (totalByYear − areaByYear), NICHT das
  //  Beregnungs-Residual. dryIds/dryBaseSum steuern die separate Verteilung.
  const dryIds = new Set(domain.anbauplan.filter((a) => a.pool === "dryland").map((a) => a.cropId));
  const dryBaseSum = domain.anbauplan.filter((a) => a.pool === "dryland").reduce((s, a) => s + a.areaHa, 0) || 1;
  const dryHaOf = (y: number) => {
    const tb = gEff?.totalByYear; const totY = tb ? (tb[Math.min(y, tb.length - 1)] ?? 0) : (gEff?.startTotalHa ?? irrHa[y]);
    return Math.max(0, totY - irrHa[y]);
  };

  for (let y = 0; y < years; y++) {
    // Jahr 0 = IST-Anbauplan (Konsistenz mit deriveCapex/Flotten-Sizing/Lager-Basis, die auf dem
    //  statischen Plan rechnen). Die Politik (ramp/fix) greift ab Jahr 1.
    if (y === 0) {
      for (const e of domain.anbauplan) areas[e.cropId][0] += e.areaHa;
      continue;
    }
    let fixed = 0;
    // (1) fix
    for (const e of domain.anbauplan) {
      if (pol[e.cropId]?.mode === "fix") { areas[e.cropId][y] += e.areaHa; fixed += e.areaHa; }
    }
    // (1b) path — expliziter Skalierungspfad je Planjahr. Hat Vorrang vor ramp/scale und
    //  belegt die Fläche wie eine fixe Vorgabe; der Rest der Rotation ist Residual.
    for (const id of Object.keys(pol)) {
      const p = pol[id];
      if (p?.mode !== "path" || !p.haByYear?.length || !areas[id]) continue;
      const ha = p.haByYear[Math.min(y, p.haByYear.length - 1)] ?? 0;
      areas[id][y] += ha; fixed += ha;
    }
    // (2) ramp — Kartoffel-Gruppe gemeinsam unter shareCap, so schnell wie erlaubt Richtung Σ targets
    const rampIds = domain.anbauplan.map((e) => e.cropId).filter((id, i, arr) => arr.indexOf(id) === i && pol[id]?.mode === "ramp");
    const kartIds = rampIds.filter((id) => KART_GROUP.has(id));
    const otherRamp = rampIds.filter((id) => !KART_GROUP.has(id));
    if (kartIds.length) {
      const cap = (pol[kartIds[0]]?.shareCap ?? KART_CAP_DEFAULT) * irrHa[y];
      const targetSum = kartIds.reduce((s, id) => s + (pol[id]?.targetHa ?? baseOf(id)), 0);
      const groupHa = Math.min(targetSum, cap);
      for (const id of kartIds) {
        const t = pol[id]?.targetHa ?? baseOf(id);
        const ha = targetSum > 0 ? groupHa * (t / targetSum) : 0;
        areas[id][y] += ha; fixed += ha;
      }
    }
    for (const id of otherRamp) {
      const cap = (pol[id]?.shareCap ?? 1) * irrHa[y];
      const ha = Math.min(pol[id]?.targetHa ?? baseOf(id), cap);
      areas[id][y] += ha; fixed += ha;
    }
    // Guard: fix+ramp dürfen die beregnete Fläche nicht überzeichnen — sonst proportional kappen
    //  (Σ je Jahr bleibt IMMER = beregnete Fläche, keine Phantom-Hektar).
    if (fixed > irrHa[y] && fixed > 0) {
      const k = irrHa[y] / fixed;
      for (const id of Object.keys(areas)) if (!dryIds.has(id)) areas[id][y] *= k;
      fixed = irrHa[y];
    }
    // (3) Residual proportional auf scale-Kulturen (nur beregnet — Dryland getrennt, s. u.)
    const scaleEntries = domain.anbauplan.filter((e) => e.pool !== "dryland" && (!pol[e.cropId] || pol[e.cropId].mode === "scale"));
    const scaleBase = scaleEntries.reduce((s, e) => s + e.areaHa, 0) || 1;
    const residual = Math.max(0, irrHa[y] - fixed);
    for (const e of scaleEntries) areas[e.cropId][y] += residual * (e.areaHa / scaleBase);
    // (3b) Dryland-Pool: füllt totalByYear − areaByYear, proportional zu den Basis-Anteilen.
    const dryHaY = dryHaOf(y);
    for (const e of domain.anbauplan) if (e.pool === "dryland") areas[e.cropId][y] += dryHaY * (e.areaHa / dryBaseSum);
    // (4) MARKT-CAPS (Absatzobergrenze t/a → ha = cap/Ertrag, Base-Szenario): gekappter Überschuss
    //  wandert proportional in die übrigen scale-Kulturen (Rotationsfläche bleibt Σ-konstant).
    const cappedIds = Object.keys(pol).filter((id) => (pol[id]?.capTonnes ?? 0) > 0 && areas[id]);
    for (const id of cappedIds) {
      const yld = resolveScalar(domain, `yield.${id}`, domain.baseScenarioId) || 1;
      const capHa = (pol[id]!.capTonnes as number) / yld;
      const cur = areas[id][y];
      if (cur > capHa) {
        const excess = cur - capHa;
        areas[id][y] = capHa;
        const rest = scaleEntries.filter((e) => e.cropId !== id && !(pol[e.cropId]?.capTonnes));
        const rb = rest.reduce((s, e) => s + e.areaHa, 0) || 1;
        for (const e of rest) areas[e.cropId][y] += excess * (e.areaHa / rb);
      }
    }
    // (5) DOLDENBLÜTLER-GUARD (Apiaceae-Anbaupause 4–5 J. ⇒ gemeinsam ≤ 20 % der Rotation):
    //  Überschreitet die gewichtete Gruppe (Sellerie + ½ Zwiebel/Möhre) den Cap, wird die Gruppe
    //  proportional gekappt und die frei werdende Fläche auf Nicht-Apiaceae-scale-Kulturen verteilt.
    {
      const doldenHa = Object.keys(APIACEAE_WEIGHT).reduce((s, id) => s + (areas[id]?.[y] ?? 0) * APIACEAE_WEIGHT[id], 0);
      const capHa = DOLDEN_CAP_DEFAULT * irrHa[y];
      if (doldenHa > capHa && doldenHa > 0) {
        const k = capHa / doldenHa;
        let freed = 0;
        for (const id of Object.keys(APIACEAE_WEIGHT)) {
          if (!areas[id]) continue;
          const cut = areas[id][y] * (1 - k);
          areas[id][y] -= cut; freed += cut;
        }
        const rest = scaleEntries.filter((e) => !(e.cropId in APIACEAE_WEIGHT) && !(pol[e.cropId]?.capTonnes));
        const rb = rest.reduce((s, e) => s + e.areaHa, 0) || 1;
        for (const e of rest) areas[e.cropId][y] += freed * (e.areaHa / rb);
      }
    }
  }
  return { years, irrHa, areas };
}

/** Bodenprobenahme — deterministische Herleitung (Handoff §5). Geld in CENT. */
export function computeSoilSampling(cfg: SoilSamplingConfig) {
  const pSoilRigCent = cfg.pSamplerCent + cfg.pUTVCent + cfg.pITCent + cfg.pMiscCent;
  const soilN = cfg.soilGrid > 0 && cfg.soilTurnus > 0 ? cfg.flaecheHa / cfg.soilGrid / cfg.soilTurnus : 0; // Proben/Jahr
  const feldtage = cfg.soilPerDay > 0 ? soilN / cfg.soilPerDay : 0;
  const nRigs = cfg.soilDays > 0 ? Math.max(1, Math.ceil(feldtage / cfg.soilDays)) : 1;
  const auslastung = nRigs * cfg.soilDays > 0 ? feldtage / (nRigs * cfg.soilDays) : 0;
  // Kapitalkosten je Rig (AfA linear auf Restwert + kalk. Zins auf ⌀ Kapital), CENT/J
  const afaRig = (pSoilRigCent * (1 - cfg.residPct)) / Math.max(1, cfg.holdYears);
  const zinsRig = (pSoilRigCent * (1 + cfg.residPct)) / 2 * cfg.zins;
  const kapitalRigCent = afaRig + zinsRig;
  const soilFixCashCent = cfg.fixInsurCent + cfg.fixRomposCent + cfg.fixMaintCent + cfg.fixFlowCent;
  const soilVarCent = cfg.varPersCent + cfg.varFuelCent + cfg.varConsCent + cfg.varLabCent;
  const eigenJahrCent = nRigs * (kapitalRigCent + soilFixCashCent) + soilN * soilVarCent;
  const dlJahrCent = soilN * cfg.dlCent;
  const ersparnisCent = dlJahrCent - eigenJahrCent;           // + = Eigen günstiger
  const capexCent = nRigs * pSoilRigCent;
  const eigenOpexCashCent = nRigs * soilFixCashCent + soilN * soilVarCent; // zahlungswirksam (ohne Kapital)
  const amortDenom = dlJahrCent - eigenOpexCashCent;
  const amortYears = amortDenom > 0 ? capexCent / amortDenom : Infinity;
  return {
    pSoilRigCent, soilN, feldtage, nRigs, auslastung,
    kapitalRigCent, afaRig, zinsRig, soilFixCashCent, soilVarCent,
    eigenJahrCent, dlJahrCent, ersparnisCent, capexCent, eigenOpexCashCent, amortYears,
    activeAnnualCent: cfg.mode === "eigen" ? eigenJahrCent : dlJahrCent,
    activeCapexCent: cfg.mode === "eigen" ? capexCent : 0,
  };
}
export type SoilSamplingResult = ReturnType<typeof computeSoilSampling>;

/** Bodenprobenahme (Make-or-Buy) — eigener UTV-Vollautomat vs. Dienstleister. Quelle: HANDOFF
 *  Bodenprobenahme-Modul (SSOT). Alle Geldwerte in CENT. Flotte NICHT fix → aus Kapazität abgeleitet. */
export type SoilSamplingConfig = {
  /** Opt-in: erst wenn true, fließt die Bodenprobenahme (CAPEX/OPEX) ins 3-Statement-Modell.
   *  false = reiner Make-or-Buy-Rechner zum Diskutieren, ohne Modellwirkung. */
  active?: boolean;
  mode: "eigen" | "dl";
  flaecheHa: number;          // Ackerfläche (10.000)
  soilGrid: number;           // ha/Probe (A 3 · B/C 1)
  soilTurnus: number;         // Zyklus Jahre (A/B 4 · C 2)
  soilPerDay: number;         // Proben/Feldtag (80)
  soilDays: number;           // Feldtage/Saison (60)
  // CAPEX je Rig (Komponenten, CENT)
  pSamplerCent: number; pUTVCent: number; pITCent: number; pMiscCent: number;
  // Kapitalkosten
  holdYears: number;          // Nutzungsdauer (8)
  residPct: number;           // Restwert (0,35)
  zins: number;               // kalk. Zins (0,04)
  // Cash-Fixkosten je Rig p.a. (CENT)
  fixInsurCent: number; fixRomposCent: number; fixMaintCent: number; fixFlowCent: number;
  // Variable je Probe – Eigen (CENT)
  varPersCent: number; varFuelCent: number; varConsCent: number; varLabCent: number;
  // Dienstleister je Probe (CENT) — Entnahme + Labor
  dlCent: number;
};

/** Standort-Profil — macht den Advisor betriebs-/standortunabhängig einsetzbar. */
export type StandortProfil = {
  name: string;
  rainfallMm: number;        // Jahresniederschlag (mm) — treibt Wasser-/Beregnungsschwellen
  soil: "chernozem" | "lehm" | "sand" | "ton";  // Bodentyp (Runoff/Wasserhaltevermögen)
  summerHeat: "hoch" | "mittel" | "gering";      // Sommer-Trockenstress
};

/** Fahrgassen-Ökonomie unter Center-Pivot: wieviele Reihen/Beete werden gepflanzt, wo liegen die
 *  Fahrgassen, und welcher Ertragsverlust entsteht durch die Opferstreifen. Der wirtschaftliche
 *  Kern des 48-m-Schritts bei Kartoffel/Tomate: breitere Fahrgasse → weniger Fahrgassen → weniger
 *  Opferfläche → höherer Effektivertrag. */
export type TramlineCrop = {
  key: string;
  label: string;
  areaHa: number;       // Wertkultur-Fläche unter Pivot (editierbar)
  rowM: number;         // Reihenabstand (m) — Kartoffel 0,75
  tramlineRows: number; // ausgesparte Fahrgassen-Reihen je Spritzbreite (Neoterra-Schema: 2)
  yieldT: number;       // Ertrag t/ha
  priceEurTCent: number;// Preis €/t (CENT)
};
export type TramlineConfig = {
  pivotHa: number;      // Fläche je Pivot (inkl. End-gun) — Neoterra Ø 40
  pivots: number;       // Anzahl Pivots — Neoterra 40
  boomBase: number;     // Basis-Arbeitsbreite (m) — Bestand 36
  boomAlt: number;      // Alternative Arbeitsbreite (m) — Paket 48
  planterM: number;     // Pflanz-Arbeitsbreite (m) — gültige Spritzbreiten = Vielfache (3,0)
  randFactor: number;   // Rand-/Vorgewende-Faktor (Kreis-Fit): randLoss = randFactor × Boom / Feld-⌀
  capPriceBaseCent: number; // Neupreis Spritze Basis-Breite (CENT)
  capResBasePct: number;    // Restwertquote Basis (0..1)
  capPriceAltCent: number;  // Neupreis Spritze Alt-Breite (CENT)
  capResAltPct: number;     // Restwertquote Alt (0..1, i. d. R. niedriger = geringere Marktgängigkeit)
  crops: TramlineCrop[];
  /** Cash-Crop-Effekt: +Schlagkraft → sinkender Maschinenbedarf am Peak (kein Fahrgassen-Ertragseffekt). */
  cash: TramlineCash;
};
/** Cash-Crop-Schlagkraft: breiteres Gestänge = +Fläche/h → weniger Spritzen/Streuer im Peakfenster. */
export type TramlineCash = {
  areaHa: number;           // Cash-Crop-Fläche (Getreide/Raps/Soja/Mais)
  passes: number;           // Spritz-Überfahrten je Peakfenster
  cEffBaseHaH: number;      // Flächenleistung ha/h bei Basis-Breite (36 m ≈ 24,1)
  windowDays: number;       // Peak-Spritzfenster (Tage)
  hoursDay: number;         // Feldstunden/Tag (2-Schicht ≈ 16)
  sprayerCapexCent: number; // CAPEX je Spritze (Neubeschaffung, CENT)
  operatorYearCent: number; // Vollkosten je Fahrer/Jahr (CENT)
};

/** Detail-CAPEX-Planung — Blöcke, Kostentreiber, Anlagenklassen. */
export type CapexBlock = "bewaesserung" | "lager" | "packhaus" | "gebaeude" | "maschinen";
export type CapexDriverMode = "fix" | "perHa" | "perTonne" | "perM2" | "perM3" | "perStueck" | "perKWp" | "perLfm";
export type AnlagenKlasse = "bau" | "infrastruktur" | "technik" | "elektronik";
/** Editierbare CAPEX-Einzelposition (Infrastruktur/Gebäude). Geldwerte in CENT, Quoten als Dezimal. */
export type CapexPlanItem = {
  id: string;
  block: CapexBlock;
  bezeichnung: string;
  anlagenklasse: AnlagenKlasse;
  driver: CapexDriverMode;
  menge: number;
  einheit: string;                 // Anzeige-Einheit (ha, t, m², Stück …)
  eurProEinheitCent: number;       // €/Einheit in CENT
  afaYears: number;                // Nutzungsdauer/AfA
  restwertPct: number;             // Restwert 0..1
  jahr: number;                    // Anschaffungsjahr (0-basiert, relativ zum Planstart)
  fkQuote: number;                 // Fremdfinanzierungsquote 0..1
  zins: number;                    // Kreditzins (Dezimal)
  laufzeitJahre: number;           // Kreditlaufzeit (Jahre)
  subventionPct: number;           // Zuschussquote 0..1 (z. B. AFIR 25 %)
  bestand: boolean;                // true → bereits vorhanden, kein Neu-CAPEX
  /** Investitionskategorie (steuert die Anlagenklasse/Bilanzierung). Fehlt → aus dem Block abgeleitet. */
  kategorie?: "maschinen" | "iot" | "gebaeude" | "bewaesserung";
  benchMinCent?: number;           // Benchmark-Untergrenze €/Einheit (Guard)
  benchMaxCent?: number;           // Benchmark-Obergrenze €/Einheit (Guard)
  quelle?: string;
  notiz?: string;
};

/** PACHT — einfache Jahrestabelle. Der frühere Simulator modellierte eine
 *  Besitzgesellschaft (Eigentumsflächen, Index-Stufen, IFRS-16-Kapitalisierung, Annuitäten-
 *  Barwerte). Die gibt es im Solo-Modell nicht: NEOTERRA besitzt keine Fläche, jeder Hektar
 *  ist Dritt-Pacht. Übrig bleibt genau eine Stellschraube — der Satz je Hektar und Planjahr.
 *  Der Rest der Felder bleibt im Typ, damit gespeicherte Stände nicht brechen; gerechnet
 *  wird nur noch mit ratePerHaByYear (Fallback: der Süd-Dolj-Satz von 750 €/ha). */
export type PachtConfig = {
  /** Pachtsatz €/ha je Planjahr (Index 0 = START_YEAR). Kürzere Reihen laufen mit dem
   *  letzten Wert weiter — das ist die einzige Eingabe, die die Pacht steuert. */
  ratePerHaByYear?: number[];
  ownedHa: number;              // Eigentumsfläche der Besitzgesellschaft (verpachtet an OpCo)
  baseRentPerHaCent: number;    // Basis-Pacht €/ha (CENT)
  indexPct: number;             // Default-Stufe für den „Stufen erzeugen"-Helper (Dezimalbruch)
  intervalYears: number;        // Default-Intervall für den Helper (Jahre)
  indexBasis: "cpi" | "landvalue" | "fixed"; // Indexierungsmechanismus (Anzeige)
  /** Frei anpassbarer Indexfahrplan: je Stufe Jahr + %-Anhebung. Überschreibt intervall/pct wenn gesetzt. */
  indexSteps?: { atYear: number; pct: number }[];
  /** IFRS-16-Bilanzierung: Right-of-Use-Asset + Leasingverbindlichkeit (AfA + Zins statt Miete). */
  ifrs16?: boolean;
  /** Leasinglaufzeit (Jahre) für ROU/Verbindlichkeit (durchsetzbare Vertragslaufzeit). */
  leaseTermYears?: number;
  /** Diskontierungssatz (Grenzfremdkapitalzins) für die Leasingverbindlichkeit. */
  discountRate?: number;
  /** Auszahlungstranchen: Monat (1–12) + Anteil (Summe ~1). Default Aug 60 % / Okt 40 %. */
  payMonths?: { month: number; share: number }[];
};
/** Barwert einer nachschüssigen Annuität: Zahlung × [1 − (1+r)^-T] / r. */
export function annuityPV(payment: number, termYears: number, rate: number): number {
  if (termYears <= 0) return 0;
  if (rate <= 0) return payment * termYears;
  return payment * (1 - Math.pow(1 + rate, -termYears)) / rate;
}
/** Kumulierter Indexfaktor der Pacht in Jahr y (Basis = 1,0). Nutzt den anpassbaren Fahrplan
 *  indexSteps (alle Stufen mit atYear ≤ y), sonst den gleichmäßigen intervall/pct-Fallback. */
export function pachtIndexFactor(pc: PachtConfig, y: number): number {
  if (pc.indexSteps && pc.indexSteps.length) {
    return pc.indexSteps.filter((s) => s.atYear <= y).reduce((f, s) => f * (1 + s.pct), 1);
  }
  return Math.pow(1 + (pc.indexPct ?? 0), Math.floor(y / Math.max(1, pc.intervalYears ?? 5)));
}

/** Persistierte Sensitivitäts-/Szenario-Konfiguration.
 *  IDs referenzieren die EINE Treiber-Bibliothek des Szenario-Studios (DRIVERS).
 *  `vals` = gespeicherter Reglerstand (Rohwert je Treiber, wie im Studio).
 *  `shifts` = Legacy (relative %-Auslenkung auf alte Faktor-IDs) — wird beim Laden migriert. */
export type SensScenario = {
  id: string; name: string; desc?: string;
  vals?: Record<string, number>;
  /** @deprecated Legacy-Format vor der Studio-Zusammenführung. */
  shifts?: Record<string, number>;
};
export type SensitivityConfig = { tornado: { id: string; delta: number }[]; scenarios: SensScenario[] };

/** Eine SG&A-/Gemeinkostenposition (Monatswert CENT), gruppiert wie in Corporates üblich. */
export type OverheadItem = { id: string; group: string; label: string; monthlyCent: number };

/* --------------------------------------------------------------------------
 * Assumption-Helfer: konstante Profile je Szenario (base/best/worst).
 * ------------------------------------------------------------------------ */
function A(
  id: string,
  key: string,
  label: string,
  unit: Unit,
  b: number,
  bestV?: number,
  worstV?: number,
): Assumption {
  const profiles: Assumption["scenarioProfiles"] = {
    [base]: { kind: "constant", value: b },
  };
  if (bestV !== undefined) profiles[best] = { kind: "constant", value: bestV };
  if (worstV !== undefined) profiles[worst] = { kind: "constant", value: worstV };
  return { id, key, label, unit, scenarioProfiles: profiles };
}

/** Konstanter Wert EINES Szenarios — null, wenn das Szenario keinen eigenen Wert trägt und
 *  damit von Base erbt. Kurven (kind "curve") liefern ebenfalls null: die werden im Modell
 *  abgeleitet und sind im Annahmen-Sheet nicht direkt editierbar. */
export function readScenarioConst(domain: Domain, key: string, scenarioId: string): number | null {
  const p = domain.assumptions[key]?.scenarioProfiles?.[scenarioId];
  return p && p.kind === "constant" ? p.value : null;
}

/** Setzt den Wert EINES Szenarios. value === null entfernt den Eigenwert — das Szenario erbt
 *  dann wieder von Base. Genau diese Unterscheidung macht das Szenario-Band lesbar: ein leeres
 *  Feld heißt "wie Base", eine Zahl heißt "bewusst abweichend". Mutator auf einem Entwurf. */
export function setScenarioConst(d: Domain, key: string, scenarioId: string, value: number | null): void {
  const a = d.assumptions[key];
  if (!a) return;
  if (value === null) {
    if (scenarioId === d.baseScenarioId) return;      // Base ist die Basis, kann nicht erben
    delete a.scenarioProfiles[scenarioId];
    return;
  }
  a.scenarioProfiles[scenarioId] = { kind: "constant", value };
}

/** Baut das Assumptions-Record aus einer Liste (key = Index). */
function asRecord(list: Assumption[]): Record<string, Assumption> {
  const o: Record<string, Assumption> = {};
  for (const a of list) o[a.key] = a;
  return o;
}

/* --------------------------------------------------------------------------
 * Timeline: Mehrjahresplan, monatlich, Basisjahr 2027. N_YEARS Jahre × 12 Monate.
 *  ENTSCHEIDUNG 30.07.2026 (Benedikt): 2026 fällt komplett aus der Planung — das Modell
 *  rechnet ab 2027 als JAHR 1 (Periode 0 = Januar 2027). Alle Jahresindizes y sind damit
 *  START_YEAR + y; UI-Ansichten importieren START_YEAR statt eigener Konstanten.
 * ------------------------------------------------------------------------ */
export const START_YEAR = 2027;
const N_YEARS = 9;   // 2027-2035 — der Zielhorizont endet mit 2.500 ha Kartoffel
const N = N_YEARS * 12;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad2 = (x: number) => (x < 10 ? `0${x}` : `${x}`);
const MONTH_END: string[] = Array.from({ length: N }, (_, i) => {
  const y = START_YEAR + Math.floor(i / 12), m = i % 12;
  return `${y}-${pad2(m + 1)}-${pad2(DAYS[m])}`;
});
/* --------------------------------------------------------------------------
 * SKALIERUNGSPFAD der Spezialkulturen — ha je Planjahr, Index 0 = START_YEAR (2027).
 *  Beschlossen 30.07.2026 (Benedikt): NEOTERRA plant für 2027 300 ha Kartoffel; weitere
 *  Wertkulturen kommen ab 2028 dazu. Kartoffel läuft stufenweise auf 1.000 ha bis 2031
 *  (= 25 % der beregneten Fläche, 4-Jahres-Anbaupause ⇒ Obergrenze der Rotation).
 *  Werte sind auf Stufe 1 (4.000 ha beregnet) kalibriert und skalieren mit der Stufe.
 *
 *  Kultur              2027  2028  2029  2030  2031  2032  2033  2034
 *  Kartoffel Pommes     150   225   300   400   500   500   500   500
 *  Kartoffel Chips      150   225   300   400   500   500   500   500
 *  Industrietomate        0    50   300   450   600   667   667   667
 *  Zwiebel/Möhre          0   100   200   300   400   467   467   467
 *  Knollensellerie        0    30    50    70    90   100   100   100
 *  Süßkartoffel           0    20    30    40    50    50    50    50
 *  Knoblauch              0    20    30    40    50    50    50    50
 *  Σ Spezialkulturen    300   670 1.210 1.700 2.190 2.334 2.334 2.334
 */
/* ZIELBILD 2035 — 2.500 ha Kartoffel (Vorgabe Betrieb 03.08.2026).
 *
 * Die Aufteilung folgt der Abnahme, nicht der Fläche: **50.000 t Chips, der Rest
 * Pommes.** Bei 42 t/ha Chips sind das 1.190 ha; die verbleibenden 1.310 ha gehen
 * in die Pommesschiene und liefern bei 50 t/ha rund 65.500 t. Zusammen 2.500 ha
 * und rund 115.500 t.
 *
 * Der Hochlauf 2032-2035 ist bewusst gleichmäßig: die Rotationsfläche muss
 * mitwachsen (4 × Kartoffel = 10.000 ha in 2035), und die wird mit dem
 * Partnerbetrieb abgestimmt — ein Sprung ließe sich dort nicht abbilden.
 *
 * Die übrigen Wertkulturen wachsen NICHT mit. Sie hängen an Absatzdeckeln
 * (Zwiebel/Möhre 60.000 t, Sellerie 22.000 t) bzw. an der Werkskapazität
 * (Tomate 667 ha) und bleiben ab 2032 auf ihrem Niveau. Der Zuwachs bis 2035
 * ist damit vollständig Kartoffel.
 *                    2027  2028  2029  2030  2031  2032  2033  2034  2035 */
export const SKALIERUNG_HA: Record<string, number[]> = {
  kartoffel_pommes: [150, 225, 300, 400, 500,  700,  900, 1100, 1310],
  kartoffel_chips:  [150, 225, 300, 400, 500,  650,  800,  980, 1190],
  // 2028 auf 50 ha begrenzt (Benedikt 31.07.2026: "50 ha gehen") — Pilotjahr für die
  //  Industrietomate, erst danach der Hochlauf auf die Werkskapazität.
  tomate:           [  0,  50, 300, 450, 600,  667,  667,  667,  667],
  zwiebel_moehre:   [  0, 100, 200, 300, 400,  467,  467,  467,  467],
  knollensellerie:  [  0,  30,  50,  70,  90,  100,  100,  100,  100],
  suesskartoffel:   [  0,  20,  30,  40,  50,   50,   50,   50,   50],
  knoblauch:        [  0,  20,  30,  40,  50,   50,   50,   50,   50],
};

/** Skalierungspfad → CropPolicy-Eintrag je Kultur (mit Stufen-Skalierung). */
export function skalierungPolicy(stage: Stage = 1): Record<string, CropPolicy> {
  const sf = STAGES[String(stage)].beregneteFlaecheHa / 4000;
  const out: Record<string, CropPolicy> = {};
  for (const [id, path] of Object.entries(SKALIERUNG_HA))
    out[id] = { mode: "path", haByYear: path.map((h) => Math.round(h * sf)) };
  return out;
}

/** Σ Wertkulturen je Planjahr (ha). */
export const WERTKULTUR_TOTAL_HA: number[] = Array.from({ length: N_YEARS }, (_, y) =>
  Object.values(SKALIERUNG_HA).reduce((s, path) => s + (path[Math.min(y, path.length - 1)] ?? 0), 0));

/* --------------------------------------------------------------------------
 * ROTATIONSFLÄCHE — die Kartoffel bestimmt sie, nicht umgekehrt.
 *
 * Befund Deep Review 03.08.2026: der Kartoffel-shareCap (25 %, aus der
 * 4-Jahres-Anbaupause) war toter Code — er griff nur im Zweig `mode: "ramp"`,
 * während der Skalierungspfad über `mode: "path"` läuft und ausdrücklich Vorrang
 * hat. Tatsächlich belegte die Kartoffel 42,8 % der Fläche (1.000 von 2.334 ha).
 *
 * Ursache: die Pfade waren auf 4.000 ha beregnete Fläche kalibriert. Am
 * 31.07.2026 entfiel der Ackerbau-Residualblock, die Betriebsfläche wurde zur
 * Summe der Wertkulturen — 2.334 ha. Die Kartoffelzahl blieb.
 *
 * Entscheidung Benedikt 03.08.2026: **Rotationsfläche ausweiten**, Kartoffel
 * bleibt bei 1.000 ha.
 *
 * Präzisierung desselben Tages: NEOTERRA baut **nur Wertkulturen und
 * Zwischenfrüchte** (Sudangras u. a.). Die Bruchkulturen der Rotation — Getreide,
 * Ölsaaten — bewirtschaftet ein **anderer Betrieb**; die Rotation wird zwischen
 * beiden eng abgestimmt.
 *
 * Daraus folgt für das Modell zweierlei:
 *   • Die Rotationsfläche ist eine **Nebenbedingung, keine Kostenposition**.
 *     NEOTERRA pachtet, bewirtschaftet und mechanisiert nur die Wertkulturen.
 *     Pacht, Maschinen, Personal und CAPEX hängen deshalb weiter an
 *     WERTKULTUR_TOTAL_HA und ausdrücklich nicht an ROTATION_TOTAL_HA.
 *   • ROTATION_TOTAL_HA ist die **Bezugsgröße der Fruchtfolgeprüfung**: die
 *     gemeinsam abgestimmte Fläche, auf der sich die Kartoffel bewegen kann.
 *     Gegen sie wird der 25-%-Anteil gemessen, nicht gegen die eigene Fläche.
 *
 * Die zuvor gerechnete Belastung von −0,90 Mio €/a entfällt damit: sie unterstellte,
 * NEOTERRA trage die 1.666 ha Bruchkultur selbst. Tut es nicht.
 * ------------------------------------------------------------------------ */

/** Anbaupause der Kartoffel-Wirtsgruppe. Daraus folgt der Höchstanteil 1/4. */
export const KARTOFFEL_PAUSE_JAHRE = 4;

/** Rotationsfläche je Planjahr: so groß, dass die Kartoffel ihre Pause einhält. */
export const ROTATION_TOTAL_HA: number[] = Array.from({ length: N_YEARS }, (_, y) => {
  const kart = (SKALIERUNG_HA.kartoffel_pommes[y] ?? 0) + (SKALIERUNG_HA.kartoffel_chips[y] ?? 0);
  return Math.max(kart * KARTOFFEL_PAUSE_JAHRE, WERTKULTUR_TOTAL_HA[y]);
});

/** Fläche, welche die Bruchkulturen des Partnerbetriebs tragen — Rotationsfläche
 *  minus Wertkulturen. Planungsgröße für die Abstimmung, keine NEOTERRA-Kosten. */
export const BREAK_TOTAL_HA: number[] = ROTATION_TOTAL_HA.map(
  (r, y) => Math.max(0, r - WERTKULTUR_TOTAL_HA[y]));

/** Σ bewirtschaftete Fläche je Planjahr = die Wertkulturen. Bewusst NICHT die
 *  Rotationsfläche: an dieser Zahl hängen Pacht, Personal, Maschinen und CAPEX,
 *  und NEOTERRA bewirtschaftet nur die Wertkulturen. */
export const SKALIERUNG_TOTAL_HA: number[] = WERTKULTUR_TOTAL_HA.slice();

const TIMELINE: Timeline = {
  baseGranularity: "month",
  startDate: `${START_YEAR}-01-01`,
  periodCount: N,
  periods: Array.from({ length: N }, (_, i) => ({
    index: i,
    endDate: MONTH_END[i],
    label: `M${i + 1}`,
    granularity: "month" as const,
    isActual: false,
  })),
};

/* Wachstumsplan (Ramp): Ziel-Hektar je Jahr (4.000 → 10.000 → 20.000 ha).
 * yearScale[y] = areaByYear[y] / Basisfläche (Σ Anbauplan). Skaliert Fläche/Umsatz,
 * Flotte/CAPEX, OpEx/Personal, Subventionen — mit CAPEX-/Finanzierungs-Phasing. */
/** Transport-Eigenflotte-Parameter (editierbar; im CAPEX-Szenarien-Rechner). */
export type TransportConfig = {
  priceCent: number; payloadT: number; distanceKm: number; speedKmh: number; loadUnloadH: number;
  operatingDays: number; hoursPerDay: number; dieselLPerHour: number; repPctYear: number;
  versPctYear: number; driverEurPerHourCent: number; lifeYears: number; residualPct: number; interestRate: number;
};
const TRANSPORT_DEFAULT: TransportConfig = {
  priceCent: 13000000, payloadT: 27, distanceKm: 70, speedKmh: 60, loadUnloadH: 0.75,
  operatingDays: 220, hoursPerDay: 10, dieselLPerHour: 25, repPctYear: 0.10, versPctYear: 0.06,
  driverEurPerHourCent: 800, lifeYears: 8, residualPct: 0.30, interestRate: 0.04,
};

/* ENTFERNT 31.07.2026: DrylandCrop — die Trockenrotation gehörte Isolde Farms. */
export type GrowthPlan = {
  years: number;
  /** BEREGNETE Fläche je Jahr = Irrigations-Ramp (Stufe 1→3b). Treibt das Kern-Modell (Wertrotation). */
  areaByYear: number[];
  /** GESAMT-Betriebsfläche je Jahr. Im Solo-Modell identisch mit areaByYear (alles beregnet). */
  totalByYear?: number[];
  /** Startpunkt (t0) = erstes Planjahr des Skalierungspfads. */
  startTotalHa?: number;
  startIrrigatedHa?: number;
  /** Bewässerungs-Ausbau €/ha (Pivot/Verrohrung) — Planwert für neu beregnete ha.
   *  Greift erst ab `irrig.capex_from_year`; davor wird bereits beregnete Fläche gepachtet. */
  irrigEurPerHaCent?: number;
  /** Aktive Wachstumsstufe. Nur noch "s3b" = Kurven werden verbatim übernommen; die
   *  Flächenkurve IST der Kultur-Skalierungspfad. Die früheren Stufen s1/s1a/s2 (flach,
   *  Cash-only, Vollberegnung) sind entfallen — sie haben den Pfad überschrieben. */
  stage?: "s3b";
};

/** Effektiver Wachstumsplan: reicht die geplanten Flächenkurven durch und stellt nur sicher,
 *  dass die beregnete Fläche die Gesamtfläche nie übersteigt. */
export function effectiveGrowth(gp: GrowthPlan | undefined): GrowthPlan | undefined {
  if (!gp) return gp;
  // PHYSIK-GUARD: beregnete Fläche kann die Gesamtfläche nie übersteigen.
  //  Die früheren Stufen-Zweige (s1/s1a flach, s2 Vollberegnung) sind entfallen — sie hätten
  //  die Flächenkurve auf das Startjahr flachgedrückt und damit den Skalierungspfad gelöscht.
  if (gp.totalByYear?.length) {
    const area = gp.areaByYear.map((a, y) => Math.min(a, gp.totalByYear![Math.min(y, gp.totalByYear!.length - 1)] ?? a));
    return { ...gp, areaByYear: area };
  }
  return gp;
}

/* ENTFERNT 31.07.2026: FarmDeal — Betriebsübernahmen/Pachtpakete (Stufe 3b). Es gibt keinen
   Flächenzukauf mehr: gewachsen wird über den Kultur-Skalierungspfad auf Pachtfläche. */
/** Ersatzinvestitions-Konfiguration je Maschine (überschreibt globale Defaults). */
export type ReplCfg = { cycleYears?: number; afaYears?: number; hoursPerYear?: number; enabled?: boolean };
const GROWTH: GrowthPlan = {
  years: N_YEARS,
  // NEOTERRA-SOLO: die BEWIRTSCHAFTETE Fläche ist die Summe der Wertkulturen —
  //  300 ha (2027) → 2.334 ha (2032+). Die Rotationsfläche ist mit 4.000 ha größer,
  //  die Differenz bewirtschaftet aber der Partnerbetrieb; sie kostet hier weder
  //  Pacht noch Technik. Siehe ROTATION_TOTAL_HA.
  //  Stufe "s3b" heißt hier nur: Kurven werden VERBATIM übernommen (kein s1-Flach, kein s2-Ausbau);
  //  Flächenzukauf/Akquisitionen sind bewusst leer — gewachsen wird über die Kulturen, nicht über Land.
  areaByYear: SKALIERUNG_TOTAL_HA.slice(),
  totalByYear: SKALIERUNG_TOTAL_HA.slice(),
  startTotalHa: SKALIERUNG_TOTAL_HA[0],
  startIrrigatedHa: SKALIERUNG_TOTAL_HA[0],
  // Wachstum heißt hier: MEHR PACHTFLÄCHE, kein Landkauf — die Zukauf-Mechanik ist entfernt.
  //  Die Fläche kostet laufende Pacht (opex.pacht, 750 €/ha), die Beregnung bleibt CAPEX.

  irrigEurPerHaCent: 300000,  // 3.000 €/ha Beregnungsausbau (Pivot + Verrohrung + Pumpe)
  stage: "s3b",
};

const SCENARIOS: Scenario[] = [
  { id: base, name: "Base Case", kind: "base" },
  { id: best, name: "Best Case", kind: "best", inheritsFrom: base },
  { id: worst, name: "Worst Case", kind: "worst", inheritsFrom: base },
];

/* --------------------------------------------------------------------------
 * KULTUREN (7) — Kalender (Pflanz-/Erntemonat, Index 0–11).
 * ------------------------------------------------------------------------ */
type CropId =
  | "weizen" | "gerste_zw" | "soja_luzerne" | "winterraps" | "mais" | "tomate"
  | "kartoffel_pommes" | "kartoffel_chips" | "zwiebel_moehre"
  // NEU (Marktanalyse 24.07.2026): Import-Substitution mit belegtem Marktpotenzial —
  //  Süßkartoffel (Dăbuleni-erprobt), Knoblauch (~19 % der HS-0703-Importe), Knollensellerie (HS-070690-Pool ~23 kt).
  | "suesskartoffel" | "knoblauch" | "knollensellerie"
  // Rain-fed (Trockenrotation) — eigene Kulturvarianten, gleiche Maschinen wie die Cash-Crops,
  //  reduzierte Direktkosten, keine Beregnung. DB = Ergebnis der Bottom-up-Kalkulation.
  | "weizen_dry" | "gerste_dry" | "raps_dry"
  // Sonnenblume (rain-fed Break Crop, Süd-Dolj): trockentolerant, tiefwurzelnd, niedriger N-Bedarf.
  //  Eigene lange Anbaupause (Sclerotinia/Phomopsis/Orobanche) → Kandidat der Trockenrotation.
  | "sonnenblume";

/** Kultur-Kalender (Monatsindex 0 = Jan). WINTERUNGEN saisonal korrekt: Aussaat im HERBST
 *  (Saatgut-/Herbstkosten Sep/Okt — konsistent mit SOW_MONTH des Maßnahmenkatalogs), Düngung/
 *  PSM/Beregnung im FRÜHJAHR (optionale explizite Monate dueng/psm/bereg; fehlen sie → plant+1/2/3).
 *  Steady-State je Modelljahr: Herbstsaat (für Folgejahr) + Sommerernte (Vorjahressaat) im selben Jahr. */
export const CROP_CAL: Record<CropId, { plant: number; harvest: number[]; dueng?: number; psm?: number; bereg?: number }> = {
  weizen:            { plant: 9, harvest: [6], dueng: 1, psm: 3, bereg: 4 },  // Saat Okt · N1 Feb · PSM Apr · Beregnung Mai
  gerste_zw:         { plant: 9, harvest: [6], dueng: 1, psm: 3, bereg: 4 },  // Saat Okt (Winterung)
  soja_luzerne:      { plant: 3, harvest: [8] },
  winterraps:        { plant: 8, harvest: [6], dueng: 1, psm: 2, bereg: 3 },  // Saat Sep · N1 Feb · PSM Mär
  mais:              { plant: 3, harvest: [9] },   // Aussaat Apr, Ernte Okt (bewässert)
  tomate:            { plant: 3, harvest: [8] },
  kartoffel_pommes:  { plant: 3, harvest: [8] },
  kartoffel_chips:   { plant: 3, harvest: [8] },
  zwiebel_moehre:    { plant: 3, harvest: [8] },
  suesskartoffel:    { plant: 4, harvest: [9], dueng: 4, psm: 5, bereg: 6 },  // Slips Mai · Ernte Okt (Dăbuleni-erprobt)
  knoblauch:         { plant: 9, harvest: [6], dueng: 2, psm: 3, bereg: 4 },  // Winterknoblauch: Stecken Okt · Ernte Jul
  knollensellerie:   { plant: 3, harvest: [9], dueng: 4, psm: 5, bereg: 6 },  // Pflanzung Apr · Ernte Okt (Lager)
  weizen_dry:        { plant: 9, harvest: [6], dueng: 1, psm: 3 },  // rain-fed, keine Beregnung
  gerste_dry:        { plant: 9, harvest: [6], dueng: 1, psm: 3 },
  raps_dry:          { plant: 8, harvest: [6], dueng: 1, psm: 2 },
  sonnenblume:       { plant: 3, harvest: [8], dueng: 3, psm: 4 },  // Sommerung: Saat Apr · Ernte Sep, rain-fed
};

export const CROP_NAME: Record<CropId, string> = {
  weizen: "Winterweizen",
  gerste_zw: "Wintergerste + Doppel-Soja",
  soja_luzerne: "Soja / Luzerne",
  winterraps: "Winterraps",
  mais: "Körnermais",
  tomate: "Industrietomate",
  kartoffel_pommes: "Kartoffel (Pommes)",
  kartoffel_chips: "Kartoffel (Chips)",
  zwiebel_moehre: "Zwiebel / Möhre",
  suesskartoffel: "Süßkartoffel",
  knoblauch: "Knoblauch",
  knollensellerie: "Knollensellerie",
  weizen_dry: "Winterweizen (trocken)",
  gerste_dry: "Wintergerste (trocken)",
  raps_dry: "Winterraps (trocken)",
  sonnenblume: "Sonnenblume (trocken)",
};

/**
 * Agronomie-Direktkosten €/ha je Kultur (Referenz A):
 * [Saatgut/Pflanzgut, Düngung, Pflanzenschutz, Beregnung(Wasser+Energie), Material/Lager, Handarbeit]
 */
const AGRO_COSTS: Record<CropId, [number, number, number, number, number, number]> = {
  weizen:            [ 99, 288, 210, 300,   0,  60], // Σ 957
  gerste_zw:         [ 95, 258, 180, 280,   0,  70], // Σ 883
  soja_luzerne:      [180, 190, 130, 320,   0, 120], // Σ 940
  winterraps:        [ 72, 235, 165, 110,   0,  30], // Σ 612 (DB ~1.270 bei 4,0 t × 470 €)
  mais:              [250, 320, 130, 300,   0,  30], // Σ 1030 (DB ~1.820 bei 15 t × 190 €, bewässert)
  tomate:            [900,1217,1100, 462,   0, 650], // Σ 4329
  kartoffel_pommes:  [1003, 614, 650, 555, 600, 350], // Σ 3772
  kartoffel_chips:   [1233, 652, 670, 555, 672, 380], // Σ 4162
  zwiebel_moehre:    [600, 500, 650, 500,   0, 550], // Σ 2800
  suesskartoffel:    [3600, 450, 350, 480, 250, 900], // Σ 6030 (Slips teuer, Handernte-Anteil)
  knoblauch:         [2700, 420, 400, 240, 200, 900], // Σ 4860 (Pflanzknoblauch ~900 kg/ha)
  knollensellerie:   [3000, 520, 500, 560, 150, 400], // Σ 5130 (Jungpflanzen ~60k/ha)
  weizen_dry:        [ 80, 150, 110,   0,   0,  40], // Σ 380 rain-fed (weniger N/PSM, keine Beregnung)
  gerste_dry:        [ 72, 130,  95,   0,   0,  35], // Σ 332
  raps_dry:          [ 60, 150, 120,   0,   0,  25], // Σ 355
  sonnenblume:       [100, 130, 120,   0,   0,  25], // Σ 375 rain-fed (Hybridsaat, niedriger N, ClearField+Sclerotinia)
};

/** Fixkosten je ha (Referenz A): Pacht (alle) + Overhead/Versich./Zins je Kultur. */
// Dritt-Pacht Süd-Dolj, €/ha/Jahr. 750 € statt 250 €: NEOTERRA pachtet BEREITS BEREGNETE
// Flächen — die Pivots sind im Pachtzins enthalten, dafür entfällt die eigene
// Beregnungsinvestition (siehe irrig.capex_from_year). Entscheidung 30.07.2026.
const PACHT_PER_HA = 750;                 // EUR/ha (Referenzwert fuer die Vollkosten-Sicht)
/** Derselbe Satz in CENT — die Speichereinheit jedes Geldwerts im Modell.
 *  `pacht.ratePerHaByYear` lag als EINZIGE Geldgroesse in EURO statt in Cent. Solange jede
 *  Ansicht ihre Umrechnung selbst mitbrachte, fiel das nicht auf; mit einem gemeinsamen
 *  Einheiten-Register faellt es sofort auf, weil das Feld dann 7,50 EUR/ha anzeigen wuerde.
 *  Der Ausreisser ist beseitigt, gespeicherte Staende werden in migrateDomain umgestellt. */
const PACHT_PER_HA_CENT = PACHT_PER_HA * 100;
const OVERHEAD_PER_HA: Record<CropId, number> = {
  weizen: 150, gerste_zw: 140, soja_luzerne: 130, winterraps: 140, mais: 150, tomate: 680,
  kartoffel_pommes: 410, kartoffel_chips: 470, zwiebel_moehre: 300,
  suesskartoffel: 380, knoblauch: 350, knollensellerie: 320,
  weizen_dry: 150, gerste_dry: 140, raps_dry: 140, sonnenblume: 140,
};
/** Beregnung-Pivot AfA/Wartung je ha (Referenz A, §3-Fixblock) — nur für die analytische
 *  Vollkosten-Sicht (deriveContribution). Im 3-Statement steckt die Beregnung in der CAPEX-AfA. */
const BEREGNUNG_PIVOT_PER_HA: Record<CropId, number> = {
  weizen: 250, gerste_zw: 250, soja_luzerne: 250, winterraps: 250, mais: 300, tomate: 600,
  kartoffel_pommes: 450, kartoffel_chips: 450, zwiebel_moehre: 300,
  suesskartoffel: 400, knoblauch: 250, knollensellerie: 350,
  weizen_dry: 0, gerste_dry: 0, raps_dry: 0, sonnenblume: 0,
};
/** Personal (Maschinenbetrieb) €/ha je Kultur (Referenz A / §3). Nur für die Vollkosten-Sicht;
 *  im 3-Statement ist Personal über das FTE-Modell (computePersonnel) abgebildet. CENT/ha. */
const PERSONNEL_MASCH_PER_HA_CENT: Record<CropId, number> = {
  weizen: 1220, gerste_zw: 1281, soja_luzerne: 1022, winterraps: 1150, mais: 1300, tomate: 13471,
  kartoffel_pommes: 6719, kartoffel_chips: 6719, zwiebel_moehre: 11026,
  suesskartoffel: 8500, knoblauch: 9500, knollensellerie: 9800,
  weizen_dry: 1220, gerste_dry: 1281, raps_dry: 1150, sonnenblume: 1150,
};

/**
 * Arbeitsgänge je Kultur (Referenz C): Maschine · Überfahrten.
 * Personal-je-Maschine ist im personnel-Modell (Stamm-Maschinenführer) abgebildet —
 * hier NICHT als COGS-Lohn (keine Doppelzählung).
 */
const ARBEITSGAENGE: Record<CropId, Arbeitsgang[]> = {
  weizen: [
    { m: "pflug", passes: 1 }, { m: "saatbett", passes: 1 }, { m: "drille", passes: 1 },
    { m: "streuer", passes: 3 }, { m: "spritze14", passes: 4 }, { m: "maehdr", passes: 1 }, { m: "transport", passes: 1 },
  ],
  gerste_zw: [
    { m: "pflug", passes: 1 }, { m: "drille", passes: 1 }, { m: "streuer", passes: 2 },
    { m: "spritze14", passes: 5 }, { m: "maehdr", passes: 2 }, { m: "einzelkorn", passes: 1 },
  ],
  soja_luzerne: [
    { m: "pflug", passes: 1 }, { m: "einzelkorn", passes: 1 }, { m: "streuer", passes: 1 },
    { m: "spritze14", passes: 3 }, { m: "maehdr", passes: 1 }, { m: "transport", passes: 1 },
  ],
  // Winterraps (Break, Ölsaat) — Ackerbaupark: Aussaat Drille, PSM Herbizid/Fungizid (Sclerotinia)/Insektizid, Mähdrusch.
  winterraps: [
    { m: "pflug", passes: 1 }, { m: "saatbett", passes: 1 }, { m: "einzelkorn", passes: 1 },
    { m: "streuer", passes: 2 }, { m: "spritze14", passes: 3 }, { m: "maehdr", passes: 1 }, { m: "transport", passes: 1 },
  ],
  // Körnermais (Break, bewässert) — Einzelkornsaat, hohe N-Düngung, Mähdrusch mit Maisgebiss.
  mais: [
    { m: "pflug", passes: 1 }, { m: "saatbett", passes: 1 }, { m: "einzelkorn", passes: 1 },
    { m: "streuer", passes: 2 }, { m: "spritze14", passes: 2 }, { m: "maehdr", passes: 1 }, { m: "transport", passes: 1 },
  ],
  tomate: [
    { m: "pflug", passes: 1 }, { m: "saatbett", passes: 1 }, { m: "streuer", passes: 1 },
    { m: "tompflanz", passes: 1 }, { m: "spritze14", passes: 16 }, { m: "tomernte", passes: 1 }, { m: "transport", passes: 1 },
  ],
  // Delta 21.07.: One-Pass (SC360+CP42) verschmilzt Dammformen + Legen; Häufeln entfällt;
  // Ernte durch gezogenen Roder ROPA Keiler II (statt Kartoffel-Vollernter SF).
  kartoffel_pommes: [
    { m: "pflug", passes: 1 }, { m: "onepass", passes: 1 }, { m: "streuer", passes: 1 },
    { m: "spritze14", passes: 16 }, { m: "roder_ropa", passes: 1 }, { m: "transport", passes: 1 },
  ],
  kartoffel_chips: [
    { m: "pflug", passes: 1 }, { m: "onepass", passes: 1 }, { m: "streuer", passes: 1 },
    { m: "spritze14", passes: 16 }, { m: "roder_ropa", passes: 1 }, { m: "transport", passes: 1 },
  ],
  // ROPA Keiler 2 RK22 = geteilter Wurzelernter (Kartoffel + Möhre + Zwiebel + Sellerie) →
  // Ernte über roder_ropa (statt separater gemernte-Kette). Optional 2-phasig: Schwadleger vorab.
  zwiebel_moehre: [
    { m: "pflug", passes: 1 }, { m: "saatbett", passes: 1 }, { m: "gem_saat", passes: 1 },
    // Ernte gesplittet: Zwiebel-Hälfte 2-stufig (Schwadleger + Ladeeroder), Möhren-Hälfte Klemmband → je 0,5 Passes.
    { m: "streuer", passes: 1 }, { m: "spritze14", passes: 8 },
    // ZWIEBEL zweiphasig: Schwadleger (Phase 1) + Aufnahme (Phase 2). Phase 2 faehrt der
    //  ROPA Keiler 2 mit der Schwadaufnahme — ROPA vermarktet genau diesen Einsatz und
    //  ruestet dafuer in Minuten um. Der separate Zwiebel-Ladeeroder (gem_lader, 265.000 EUR)
    //  ist damit doppelte Technik fuer dieselbe Arbeit und entfaellt.
    //  NICHT ersetzbar bleiben: der Schwadleger (der Keiler nimmt Schwad auf, legt aber
    //  keinen) und der Moehren-/Sellerie-Klemmbandroder (er zieht am Laub — ein Siebketten-
    //  roder haeckselt das Kraut und rodet mit Erde, das ist das Verfahren fuer Industrie-
    //  und Lagerware, nicht fuer Waschmoehre mit Schalenanspruch).
    { m: "gem_schwad", passes: 0.5 }, { m: "roder_ropa", passes: 0.5 }, { m: "gem_moehre", passes: 0.5 },
    { m: "transport", passes: 1 },
  ],
  // NEU: Süßkartoffel — Slips-Pflanzung (Gemüse-Pflanzmaschine), Rodung Siebkette (ROPA).
  suesskartoffel: [
    { m: "pflug", passes: 1 }, { m: "saatbett", passes: 1 }, { m: "tompflanz", passes: 1 },
    { m: "streuer", passes: 1 }, { m: "spritze14", passes: 3 },
    { m: "roder_ropa", passes: 1 }, { m: "transport", passes: 1 },
  ],
  // NEU: Winterknoblauch — Stecken via Legemaschine (Zehenausrichtung), Rodung Siebkette.
  knoblauch: [
    { m: "pflug", passes: 1 }, { m: "saatbett", passes: 1 }, { m: "knobl_lege", passes: 1 },
    { m: "streuer", passes: 1 }, { m: "spritze14", passes: 4 },
    { m: "roder_ropa", passes: 1 }, { m: "transport", passes: 1 },
  ],
  // NEU: Knollensellerie — Pflanzung Gemüse-Pflanzmaschine, Ernte Klemmbandroder (T-300-Klasse).
  knollensellerie: [
    { m: "pflug", passes: 1 }, { m: "saatbett", passes: 1 }, { m: "tompflanz", passes: 1 },
    { m: "streuer", passes: 1 }, { m: "spritze14", passes: 5 },
    { m: "gem_moehre", passes: 1 }, { m: "transport", passes: 1 },
  ],
  // Rain-fed: gleiche Ackerbaupark-Maschinen wie beregnet, aber weniger Streuer-/Spritz-Überfahrten.
  weizen_dry: [
    { m: "pflug", passes: 1 }, { m: "saatbett", passes: 1 }, { m: "drille", passes: 1 },
    { m: "streuer", passes: 2 }, { m: "spritze14", passes: 3 }, { m: "maehdr", passes: 1 }, { m: "transport", passes: 1 },
  ],
  gerste_dry: [
    { m: "pflug", passes: 1 }, { m: "drille", passes: 1 }, { m: "streuer", passes: 2 },
    { m: "spritze14", passes: 3 }, { m: "maehdr", passes: 1 }, { m: "transport", passes: 1 },
  ],
  raps_dry: [
    { m: "pflug", passes: 1 }, { m: "saatbett", passes: 1 }, { m: "einzelkorn", passes: 1 },
    { m: "streuer", passes: 2 }, { m: "spritze14", passes: 2 }, { m: "maehdr", passes: 1 }, { m: "transport", passes: 1 },
  ],
  // Sonnenblume: Einzelkornsaat (Präzision wie Mais/Raps), wenige Überfahrten, Mähdrusch mit SB-Vorsatz.
  sonnenblume: [
    { m: "pflug", passes: 1 }, { m: "saatbett", passes: 1 }, { m: "einzelkorn", passes: 1 },
    { m: "streuer", passes: 1 }, { m: "spritze14", passes: 3 }, { m: "maehdr", passes: 1 }, { m: "transport", passes: 1 },
  ],
};

/** Maschinen-Key → Klartext-Label (für Arbeitsgang-UI). Alle 15 Feldmaschinen-Keys. */
export const MACHINE_LABELS: Record<string, string> = {
  pflug: "Grubber/Pflug",
  saatbett: "Saatbettkombi",
  drille: "Getreidedrille",
  einzelkorn: "Einzelkornsägerät",
  gem_saat: "Beetsämaschine Feingemüse",
  knobl_lege: "Knoblauch-Legemaschine",
  streuer: "Düngerstreuer",
  spritze14: "Spritzen-Kostenprofil 36 m (Mischpark TD 12 / PT)",
  krautschl: "Frontkrautschläger ROPA KS 475 (am Roder)",
  onepass: "One-Pass SC360 + CP42",
  roder_ropa: "Roder ROPA Keiler II",
  zug_8rx: "Zug JD 8RX 410",
  ops_6r: "Pflege/Ernte JD 6R 260",
  radlader: "JCB Radlader",
  shuttle: "Field-Shuttle 8×8",
  tompflanz: "Tomaten-Pflanzmaschine",
  tomernte: "Tomaten-Vollernter SF",
  gem_schwad: "Zwiebel-Schwadleger (WR-180)",
  gem_lader: "Zwiebel-Ladeeroder (SP-400)",
  gem_moehre: "Möhren-Klemmbandroder (T-300 DF)",
  maehdr: "Mähdrescher S7 900",
  transport: "Transporteinheit (Schlepper + Kipper)",
};

/* --------------------------------------------------------------------------
 * ASSUMPTIONS — die einzige Tipp-Zone (Single Source of Truth).
 * ------------------------------------------------------------------------ */
const ASSUMPTIONS: Record<string, Assumption> = asRecord([
  // --- Makro / Steuer / Covenant / OpEx ---
  A("macro.euribor", "macro.euribor", "EURIBOR 3M", "percent", 0.026, 0.02, 0.036),
  A("tax.rate", "tax.rate", "Körperschaftsteuersatz (RO)", "percent", 0.16),
  // Reinvestitions-Befreiung (RO): reinvestierter Gewinn in qual. Ausrüstung (Maschinen/Bewässerung/
  //  Verarbeitungstechnik) ist von der 16 %-KSt befreit. Jahres-Pooling: befreit = min(Gewinn, qual. CAPEX).
  A("tax.reinvest_on", "tax.reinvest_on", "Reinvestitions-Befreiung aktiv (0/1)", "flag", 0),
  A("tax.reinvest_share", "tax.reinvest_share", "Qualifizierender Anteil der Ausrüstungs-CAPEX", "percent", 1.0),
  // Innenfinanzierung: Neuanschaffungen (Maschinen) aus Cash statt Kredit — der Revolver deckt nur echte
  //  Deckungslücken (= automatischer „genug Cash?"-Check). 1 = Cash-first, 0 = Kredit-/Leasingverträge.
  A("finance.capex_selffund", "finance.capex_selffund", "Neuanschaffungen aus Cash (0/1)", "flag", 0),
  // opex.admin: Legacy-Zentralverwaltung — jetzt 0, weil die Gemeinkosten strukturiert und
  // dynamisch über domain.overhead (SG&A) laufen; der Composer setzt deren Summe in opex.sga.
  A("opex.admin", "opex.admin", "Zentralverwaltung /Monat", "money", 0),
  // opex.sga: Summe der strukturierten Corporate-Gemeinkosten (domain.overhead) — Composer setzt sie je Build.
  A("opex.sga", "opex.sga", "Gemeinkosten / SG&A (Summe) /Monat", "money", 0),
  // opex.machines: NUR Wartung/Service (separater Pfad, reale JD-€/h). Betrieb steckt in COGS,
  // AfA/Zins in CAPEX/Finanzierung. Composer überschreibt je Build aus den Service-Sätzen.
  A("opex.machines", "opex.machines", "Maschinen-Wartung/Service /Monat", "money", 0),
  // opex.machine_rent: Intercompany-Maschinenmiete (gemietete Einheiten × Stunden × €/h). Composer-gesetzt.
  A("opex.machine_rent", "opex.machine_rent", "Maschinen-Miete (extern) /Monat", "money", 0),
  // opex.machine_rent_income: Miet-ERTRAG des Verleihers (negativ in OpEx → hebt EBITDA). Composer-gesetzt.
  A("opex.machine_rent_income", "opex.machine_rent_income", "Maschinen-Miet-Ertrag (Intercompany) /Monat", "money", 0),
  // Aufschlag auf die Stundenkosten (AfA/h + Service/h) für die Intercompany-Miete (z. B. +15 % Isolde-Marge).
  A("machine.rent_markup", "machine.rent_markup", "Miet-Aufschlag des Vermieters", "percent", 0.15),
  // opex.fix: Pacht + Overhead je Kultur — wird im Composer je Build aus dem Anbauplan
  // deterministisch als Monatswert überschrieben.
  A("opex.fix", "opex.fix", "Fixkosten/Monat (Pacht + Overhead/Versich./Zins)", "money", 0),
  // opex.transport: Transport ZUM ABNEHMER — wird im Composer aus der Make-or-Buy-
  // Entscheidung (deriveTransportDecision) je Build als Monatswert überschrieben.
  A("opex.transport", "opex.transport", "Transport zum Abnehmer /Monat (Make-or-Buy)", "money", 0),
  A("transport.spedition_rate", "transport.spedition_rate", "Spedition €/t (Transport zum Abnehmer)", "money", 900),
  // --- Globale TCO-Maschinenkosten (ALLE Feldmaschinen) ---
  A("tco.discount", "tco.discount", "Einkaufsrabatt auf Listenpreis", "percent", 0.20),
  A("tco.res_trail", "tco.res_trail", "Restwert-Quote gezogene Maschinen (nach Haltedauer)", "percent", 0.55),
  A("tco.res_self", "tco.res_self", "Restwert-Quote Selbstfahrer (nach Haltedauer)", "percent", 0.45),
  A("tco.hold_years", "tco.hold_years", "Haltedauer / Tauschzyklus (Jahre)", "years", 6),
  // Ersatzinvestitionen: Tauschzyklus je Maschine = min(hold_years, replace_hours / Bh je Jahr).
  A("capex.replace_hours", "capex.replace_hours", "Tauschzyklus — Betriebsstunden-Kappung (Bh)", "hours", 6000),
  // Bilanzielle AfA-Dauer der Maschinen (Standard). Länger als der Tauschzyklus ⇒ Buchverlust bei Tausch.
  A("capex.afa_years", "capex.afa_years", "AfA-Dauer Maschinen (Jahre, bilanziell)", "years", 8),
  // Wartung/Service €/h (CENT) — reale JD-Angebotswerte; SEPARAT vom CAPEX (Netto-Einkauf).
  // Fließt über den Service-Pfad in opex.machines (Monats-Overhead) und in deriveMachineTCO.
  A("tco.zug_8rx.service_h", "tco.zug_8rx.service_h", "Wartung/Service Zug JD 8RX €/h", "money", 291),
  A("tco.ops_6r.service_h", "tco.ops_6r.service_h", "Wartung/Service Pflege/Ernte JD 6R €/h", "money", 220),
  A("tco.maehdr.service_h", "tco.maehdr.service_h", "Wartung/Service Mähdrescher S7 900 €/h", "money", 644),
  // Zahlungsziel EINHEITLICH auf Planungsebene (Entscheidung Benedikt, 30.07.) — ein Treiber
  // für den gesamten Umsatz, nicht je Vertrag. Begründung wie bei der Anzahlung: jeder Vertrag
  // ist individuell verhandelt; ein Zahlungsziel je Kontrakt fesselt das Modell an eine
  // Momentaufnahme des Abnehmermixes und lässt sich im Wachstumsszenario nicht fortschreiben.
  // Base 14 Tage = das Verhandlungsziel, das NEOTERRA grundsätzlich anstrebt (heute nur von
  // Pestova erreicht). Best 7 = besser als jeder vorliegende Vertrag. Worst 28 = PepsiCos
  // effektives Ziel inkl. Sperrfenster. Die 47 Tage von VIA AGRO liegen damit AUSSERHALB des
  // Bandes — bleibt dieser Vertrag unverändert, ist das Band nach oben zu erweitern.
  // Worst 47 = das gewichtete Zahlungsziel von VIA AGRO (50 % @ 15 AT · 25 % @ 45 AT ·
  //  25 % @ 60 AT). Ein Worst Case, der ein besseres Ziel unterstellt als der schlechteste
  //  laufende Vertrag, wäre keiner. Fällt der VIA-AGRO-Rahmenvertrag weg, kann Worst auf 28
  //  (PepsiCos effektives Ziel inkl. Sperrfenster) zurückgenommen werden.
  A("wc.dso", "wc.dso", "Zahlungsziel Forderungen (DSO)", "days", 14, 7, 47),
  A("wc.dpo", "wc.dpo", "DPO (Verb.-Tage)", "days", 30),
  // Fertigerzeugnisse (Ernte auf Lager) — STANDARD 0. Solange der Umsatz vollständig im
  // Erntemonat gebucht wird, liegt per Konstruktion keine fertige Ware auf Lager; ein Wert
  // > 0 wäre ein Plug ohne wirtschaftliche Bedeutung (er blähte früher den Erntemonat auf
  // das Doppelte der Monatskosten auf und stand im November auf null, obwohl dann das
  // Kartoffellager voll ist). Die WACHSENDE Kultur steckt im Feldbestand (biologicalAssets),
  // nicht hier. Wirksam wird diese Stellschraube erst mit einem Lieferplan, der den Umsatz
  // aus dem Erntemonat in die Liefermonate verschiebt.
  A("wc.inv", "wc.inv", "Lagertage Fertigerzeugnisse", "days", 0),
  // --- Anzahlungen der Off-taker (Paket B) ---
  // VERHANDLUNGSANNAHME, keine Vertragslage: keiner der drei geprüften Verträge sagt eine
  // Anzahlung zu (PepsiCo: Vorschüsse werden gegen die ersten Lieferungen verrechnet, KEIN
  // Vorschuss zugesagt). Bemessung am geplanten Erntewert, nicht am Einzelvertrag — damit
  // skaliert die Vorfinanzierung mit dem Anbauplan und mit Wachstumsszenarien.
  // Base 20 % konservativ · Best 30 % · Worst 0 (im Stressfall zahlt niemand vor).
  A("advance.rate", "advance.rate", "Anzahlungsquote Off-taker", "percent", 0.20, 0.30, 0),
  // Preis des Gelds: Skonto/Zins p. a. auf den ausstehenden Anzahlungsbetrag → Finanzaufwand.
  // 0, solange keine Konditionen vorliegen. ACHTUNG: 0 stellt die Anzahlung als Gratisgeld dar —
  // Benchmark wäre der Revolver-Satz (EURIBOR 2,6 % + 3,2 % Spread ≈ 5,8 %).
  A("advance.cost_rate", "advance.cost_rate", "Preis der Vorfinanzierung p. a. (Skonto/Zins)", "percent", 0),
  // Avalprovision p. a. auf die besicherte Summe → Betriebsaufwand (EBITDA-wirksam).
  A("advance.aval_fee", "advance.aval_fee", "Avalprovision Anzahlung p. a.", "percent", 0),
  // --- Förderung ---
  // Kappung der GAP-Flächenpauschalen je Betrieb und Jahr ab 2028. DEFAULT 0 = KEINE
  //  KAPPUNG, auf Entscheidung vom 31.07.2026: die laufende Periode wird fortgeschrieben.
  //  Der Mechanismus bleibt als Stellschraube erhalten — der Kommissionsvorschlag für den
  //  MFR 2028–2034 sieht eine Kappung bei 100.000 € je Betrieb und Jahr vor. Wer den
  //  Risikofall rechnen will, trägt hier 100.000 (also 10.000.000 CENT) ein; dann werden
  //  ab dem zweiten Planjahr die Flächenpauschalen anteilig gekürzt, die gekoppelte
  //  Stützung bleibt ausgenommen.
  A("cap.per_farm_from_2028", "cap.per_farm_from_2028", "GAP-Kappung Flächenprämien je Betrieb ab 2028", "money", 0),
  // ERSETZT 31.07.2026: subsidy.per_ha (205 €/ha) und subsidy.coupled_freilandgemuese
  //  (1.612 €/ha). Beide Keys standen im Annahmen-Register und im Szenario-Studio, wurden
  //  aber von der Engine NIE gelesen — die zahlt aus dem Subventions-Register (BISS, Öko,
  //  VCP je Kultur). Wer an den Reglern drehte, bewegte nichts. Der eine Regler, der die
  //  Förderung wirklich bewegt, steht jetzt hier und wirkt auf ALLE Registersätze.
  //  Das ist auch die Stellschraube für das dokumentierte VCP-Risiko: gilt die engere
  //  Lesart der Intervention PD-17, fehlen ab 2032 rund 1,07 Mio €/Jahr.
  A("subsidy.factor", "subsidy.factor", "Förderung — Faktor auf alle Registersätze", "factor", 1.0, 0.7, 1.15),
  // ENTFERNT 31.07.2026: rev.gerste_zweitfrucht. Die Gerste-Zweitfrucht gehörte zum
  //  Ackerbau; der Erlösstrom läuft seit Paket A über secondCrop in der Engine.
  A("covenant.dscr_min", "covenant.dscr_min", "DSCR min. (Agrar-Projektfin. 1,10)", "ratio", 1.10),
  A("covenant.leverage_max", "covenant.leverage_max", "Leverage max.", "ratio", 3.5),

  // --- Shared Stücksätze (CENT je Einheit) ---
  A("price.diesel_l", "price.diesel_l", "Diesel €/l", "money", 100),
  A("rate.labor_h", "rate.labor_h", "Lohn Saison/zilier €/h", "money", 520),
  // Phase 8 — Inflation p.a. (getrennt, real vs. nominal). Auf 0 = konstante Preise (real).
  A("infl.output", "infl.output", "Inflation Output-Preise (Ernteerlöse) p.a.", "percent", 0.02),
  A("infl.input", "infl.input", "Inflation Input-Kosten p. a.", "percent", 0.025),
  A("infl.wage", "infl.wage", "Inflation Löhne/Gehälter p.a.", "percent", 0.03),
  A("infl.capex", "infl.capex", "Inflation CAPEX (Maschinen/Anlagen) p.a.", "percent", 0.02),
  A("price.per_euro", "price.per_euro", "Pauschal-Stücksatz (1 € = 100 ct)", "money", 100),
  // Phase 4 — Nährstoffpreise €/kg (CENT/kg), reale 2025er-Basis (Masterplan). Editierbar/quellenbelegt.
  // Streuer/Kopf: N via KAS 1,37 / Harnstoff 1,08 (Blend 1,30); P₂O₅ via DAP; K₂O via Kornkali.
  A("fert.n", "fert.n", "Düngerpreis N Streuer/Kopf (KAS/Harnstoff) €/kg", "money", 130),
  A("fert.p", "fert.p", "Düngerpreis P₂O₅ (DAP) €/kg", "money", 135),
  A("fert.k", "fert.k", "Düngerpreis K₂O (Kornkali) €/kg", "money", 88),
  A("fert.s", "fert.s", "Düngerpreis Schwefel (SO₃/Sulfat) €/kg S", "money", 60),
  // Fertigation (löslich): N Kalksalpeter, P₂O₅ MAP, K₂O Kaliumnitrat.
  A("fert.n_fert", "fert.n_fert", "Düngerpreis N Fertigation (Kalksalpeter) €/kg", "money", 200),
  A("fert.p_fert", "fert.p_fert", "Düngerpreis P₂O₅ Fertigation (MAP) €/kg", "money", 180),
  A("fert.k_fert", "fert.k_fert", "Düngerpreis K₂O Fertigation (Kaliumnitrat) €/kg", "money", 240),
  // Phase 5 — Saatgut/Pflanzgut €/Einheit (CENT), je Kultur natürliche Einheit (kg / Einh. / t / 1000 Pfl.).
  A("seed.weizen", "seed.weizen", "Saatgut Winterweizen €/kg", "money", 55),
  A("seed.gerste_zw", "seed.gerste_zw", "Saatgut Wintergerste €/kg", "money", 53),
  A("seed.soja_luzerne", "seed.soja_luzerne", "Saatgut Soja €/kg (inkl. Impfung)", "money", 150),
  A("seed.winterraps", "seed.winterraps", "Saatgut Winterraps-Hybrid €/Einheit", "money", 12000),
  A("seed.mais", "seed.mais", "Saatgut Körnermais-Hybrid €/Einheit (80.000 K)", "money", 23000),
  A("seed.weizen_dry", "seed.weizen_dry", "Saatgut Winterweizen (trocken) €/kg", "money", 55),
  A("seed.gerste_dry", "seed.gerste_dry", "Saatgut Wintergerste (trocken) €/kg", "money", 53),
  A("seed.raps_dry", "seed.raps_dry", "Saatgut Winterraps (trocken) €/Einheit", "money", 12000),
  A("seed.sonnenblume", "seed.sonnenblume", "Saatgut Sonnenblume-Hybrid €/Einheit", "money", 20000),
  A("seed.tomate", "seed.tomate", "Tomate F1-Jungpflanzen €/1000 Pfl.", "money", 3600),
  A("seed.kartoffel_pommes", "seed.kartoffel_pommes", "Pflanzkartoffeln (Pommes) €/t", "money", 39000),
  A("seed.kartoffel_chips", "seed.kartoffel_chips", "Pflanzkartoffeln (Chips) €/t", "money", 41000),
  A("seed.zwiebel_moehre", "seed.zwiebel_moehre", "Saatgut Zwiebel/Möhre (Präzision) €/ha-Satz", "money", 55000),
  A("seed.suesskartoffel", "seed.suesskartoffel", "Süßkartoffel-Slips €/1.000 Stk (30 T/ha)", "money", 12000),
  A("seed.knoblauch", "seed.knoblauch", "Pflanzknoblauch €/kg (900 kg/ha)", "money", 300),
  A("seed.knollensellerie", "seed.knollensellerie", "Sellerie-Jungpflanzen je 1.000 Stück", "money", 6500),
  // Phase 5 — Bewässerung Energie+Wasser €/mm·ha (CENT). Norm mm je Kultur × Preis (Center-Pivot Süd-Dolj).
  A("irrig.eur_mm", "irrig.eur_mm", "Bewässerung Energie+Wasser €/mm·ha", "money", 150),

  // --- Ertrag / Preis / Verlust je Kultur (Referenz A) ---
  A("yield.weizen", "yield.weizen", "Ertrag Winterweizen", "tonne_per_ha", 8.5, 9.4, 7.2),
  A("price.weizen", "price.weizen", "Preis Winterweizen", "money_per_tonne", 17000, 19000, 15000),
  A("loss.weizen", "loss.weizen", "Verlust Winterweizen", "percent", 0.05),
  A("yield.gerste_zw", "yield.gerste_zw", "Ertrag Wintergerste", "tonne_per_ha", 7.0, 7.7, 6.0),
  A("yield.soja_zw", "yield.soja_zw", "Ertrag Zweitfrucht-Soja (nach Gerste, beregnet)", "tonne_per_ha", 2.1, 2.5, 1.6),
  A("price.gerste_zw", "price.gerste_zw", "Preis Wintergerste", "money_per_tonne", 18000, 20000, 16000),
  A("loss.gerste_zw", "loss.gerste_zw", "Verlust Wintergerste", "percent", 0.05),
  A("yield.soja_luzerne", "yield.soja_luzerne", "Ertrag Soja/Luzerne", "tonne_per_ha", 4.0, 4.6, 3.4),
  A("price.soja_luzerne", "price.soja_luzerne", "Preis Soja/Luzerne", "money_per_tonne", 43000, 47000, 38000),
  A("loss.soja_luzerne", "loss.soja_luzerne", "Verlust Soja/Luzerne", "percent", 0.05),
  A("yield.winterraps", "yield.winterraps", "Ertrag Winterraps", "tonne_per_ha", 4.0, 4.6, 3.2),
  A("price.winterraps", "price.winterraps", "Preis Winterraps", "money_per_tonne", 47000, 52000, 41000),
  A("loss.winterraps", "loss.winterraps", "Verlust Winterraps", "percent", 0.05),
  A("yield.mais", "yield.mais", "Ertrag Körnermais (bewässert)", "tonne_per_ha", 14.0, 15.5, 11.5),
  A("price.mais", "price.mais", "Preis Körnermais", "money_per_tonne", 19000, 21000, 16500),
  A("loss.mais", "loss.mais", "Verlust Körnermais", "percent", 0.10),
  A("yield.tomate", "yield.tomate", "Ertrag Industrietomate", "tonne_per_ha", 88, 95, 74),
  A("price.tomate", "price.tomate", "Preis Industrietomate", "money_per_tonne", 12000, 13800, 10200),
  A("loss.tomate", "loss.tomate", "Verlust Industrietomate", "percent", 0.08),
  A("yield.kartoffel_pommes", "yield.kartoffel_pommes", "Ertrag Kartoffel (Pommes)", "tonne_per_ha", 45, 50, 38),
  // Preisband aus den geprüften Abnahmeverträgen (PepsiCo Basis 220 €/t, max. 255,40;
  //  Pestova 240 €/t flat; VIA AGRO Leiter −0,15…+0,11 RON/kg). Spot/Rest-Menge.
  A("price.kartoffel_pommes", "price.kartoffel_pommes", "Preis Kartoffel (Pommes)", "money_per_tonne", 23500, 25500, 22000),
  A("loss.kartoffel_pommes", "loss.kartoffel_pommes", "Verlust Kartoffel (Pommes)", "percent", 0.10),
  A("yield.kartoffel_chips", "yield.kartoffel_chips", "Ertrag Kartoffel (Chips)", "tonne_per_ha", 42, 47, 35),
  A("price.kartoffel_chips", "price.kartoffel_chips", "Preis Kartoffel (Chips)", "money_per_tonne", 23500, 25500, 22000),
  A("loss.kartoffel_chips", "loss.kartoffel_chips", "Verlust Kartoffel (Chips)", "percent", 0.10),
  A("yield.zwiebel_moehre", "yield.zwiebel_moehre", "Ertrag Zwiebel/Möhre", "tonne_per_ha", 60, 66, 51),
  A("price.zwiebel_moehre", "price.zwiebel_moehre", "Preis Zwiebel/Möhre", "money_per_tonne", 17500, 20125, 14875),
  A("loss.zwiebel_moehre", "loss.zwiebel_moehre", "Verlust Zwiebel/Möhre", "percent", 0.08),
  // NEU (Marktanalyse 24.07.): Import-Substitutions-Kulturen — konservative Preise (Großhandel ab Hof).
  A("yield.suesskartoffel", "yield.suesskartoffel", "Ertrag Süßkartoffel", "tonne_per_ha", 25, 32, 18),
  A("price.suesskartoffel", "price.suesskartoffel", "Preis Süßkartoffel (Großhandel, Importparität)", "money_per_tonne", 70000, 85000, 55000),
  A("loss.suesskartoffel", "loss.suesskartoffel", "Verlust Süßkartoffel (Curing/Sortierung)", "percent", 0.10),
  A("yield.knoblauch", "yield.knoblauch", "Ertrag Knoblauch (bewässert)", "tonne_per_ha", 9, 11, 7),
  A("price.knoblauch", "price.knoblauch", "Preis Knoblauch (Erzeuger RO)", "money_per_tonne", 250000, 287500, 212500),
  A("loss.knoblauch", "loss.knoblauch", "Verlust Knoblauch (Trocknung/Putzen)", "percent", 0.08),
  A("yield.knollensellerie", "yield.knollensellerie", "Ertrag Knollensellerie", "tonne_per_ha", 38, 48, 31),
  A("price.knollensellerie", "price.knollensellerie", "Preis Knollensellerie", "money_per_tonne", 48000, 55200, 40800),
  A("loss.knollensellerie", "loss.knollensellerie", "Verlust Knollensellerie (Putzen/Lager)", "percent", 0.07),
  // Rain-fed (Trockenrotation) — eigene, niedrigere Erträge; Preise = beregnet.
  A("yield.weizen_dry", "yield.weizen_dry", "Ertrag Winterweizen (trocken/rain-fed)", "tonne_per_ha", 5.5, 6.2, 4.2),
  A("price.weizen_dry", "price.weizen_dry", "Preis Winterweizen (trocken)", "money_per_tonne", 17000, 19000, 15000),
  A("loss.weizen_dry", "loss.weizen_dry", "Verlust Winterweizen (trocken)", "percent", 0.05),
  A("yield.gerste_dry", "yield.gerste_dry", "Ertrag Wintergerste (trocken/rain-fed)", "tonne_per_ha", 4.8, 5.4, 3.8),
  A("price.gerste_dry", "price.gerste_dry", "Preis Wintergerste (trocken)", "money_per_tonne", 18000, 20000, 16000),
  A("loss.gerste_dry", "loss.gerste_dry", "Verlust Wintergerste (trocken)", "percent", 0.05),
  A("yield.raps_dry", "yield.raps_dry", "Ertrag Winterraps (trocken/rain-fed)", "tonne_per_ha", 2.8, 3.3, 2.2),
  A("price.raps_dry", "price.raps_dry", "Preis Winterraps (trocken)", "money_per_tonne", 47000, 52000, 41000),
  A("loss.raps_dry", "loss.raps_dry", "Verlust Winterraps (trocken)", "percent", 0.05),
  A("qual.weizen_dry", "qual.weizen_dry", "Qualitätserfüllung Winterweizen (trocken)", "percent", 0.98, 1.00, 0.92),
  A("qual.gerste_dry", "qual.gerste_dry", "Qualitätserfüllung Wintergerste (trocken)", "percent", 0.98, 1.00, 0.92),
  A("qual.raps_dry", "qual.raps_dry", "Qualitätserfüllung Winterraps (trocken)", "percent", 0.98, 1.00, 0.92),
  // Sonnenblume (rain-fed Break Crop) — Ertrag Oltenien ~3,0 t/ha, Ölsaatpreis knapp unter Raps.
  A("yield.sonnenblume", "yield.sonnenblume", "Ertrag Sonnenblume (trocken/rain-fed)", "tonne_per_ha", 3.0, 3.5, 2.2),
  A("price.sonnenblume", "price.sonnenblume", "Preis Sonnenblume (Ölsaat)", "money_per_tonne", 46000, 52000, 40000),
  A("loss.sonnenblume", "loss.sonnenblume", "Verlust Sonnenblume (Ernte/Trocknung)", "percent", 0.05),
  A("qual.sonnenblume", "qual.sonnenblume", "Qualitätserfüllung Sonnenblume (Ölgehalt)", "percent", 0.98, 1.00, 0.92),

  // --- Kontrakt-Qualitätserfüllung (0..1): realisierter Preis nach Qualitäts-Bonus/Malus ×
  //     akzeptierte Menge. 1 = 100 % Kontrakterfüllung. Best/Worst = Qualitäts-Upside/-Downside.
  //     Treiber je Kultur: Getreide Protein/Fallzahl, Raps Ölgehalt, Tomate Brix/Farbe,
  //     Kartoffel Stärke/Zucker/Fritierfarbe/Sortierung, Zwiebel/Möhre Kaliber/Sortierung.
  A("qual.weizen", "qual.weizen", "Qualitätserfüllung Weizen (Protein/Fallzahl)", "percent", 0.99, 1.00, 0.94),
  A("qual.gerste_zw", "qual.gerste_zw", "Qualitätserfüllung Gerste", "percent", 0.99, 1.00, 0.94),
  A("qual.soja_luzerne", "qual.soja_luzerne", "Qualitätserfüllung Soja/Luzerne", "percent", 0.99, 1.00, 0.95),
  A("qual.winterraps", "qual.winterraps", "Qualitätserfüllung Raps (Ölgehalt)", "percent", 0.99, 1.00, 0.94),
  A("qual.mais", "qual.mais", "Qualitätserfüllung Mais (Feuchte/Bruch)", "percent", 0.99, 1.00, 0.95),
  A("qual.tomate", "qual.tomate", "Qualitätserfüllung Tomate (Brix/Farbe)", "percent", 0.98, 1.00, 0.88),
  A("qual.kartoffel_pommes", "qual.kartoffel_pommes", "Qualitätserfüllung Kartoffel Pommes", "percent", 0.97, 1.00, 0.86),
  A("qual.kartoffel_chips", "qual.kartoffel_chips", "Qualitätserfüllung Kartoffel Chips", "percent", 0.97, 1.00, 0.85),
  A("qual.zwiebel_moehre", "qual.zwiebel_moehre", "Qualitätserfüllung Zwiebel/Möhre", "percent", 0.97, 1.00, 0.87),
  A("qual.suesskartoffel", "qual.suesskartoffel", "Qualitätserfüllung Süßkartoffel (Kaliber/Schale)", "percent", 0.95, 1.00, 0.85),
  A("qual.knoblauch", "qual.knoblauch", "Qualitätserfüllung Knoblauch (Kaliber/Trocknung)", "percent", 0.97, 1.00, 0.88),
  A("qual.knollensellerie", "qual.knollensellerie", "Qualitätserfüllung Knollensellerie (Kaliber/Putz)", "percent", 0.97, 1.00, 0.88),

  // --- Maschinen-Neupreise (CENT) — Referenz B ---
  // Anbaugeräte-Preise = NUR das Gerät (ohne Schlepper — Traktoren sind eigene Positionen zug_9r/8rx/6r).
  A("mprice.pflug", "mprice.pflug", "Universalgrubber HORSCH Fortis 6.4 LT", "money", 7200000),
  A("mprice.saatbett", "mprice.saatbett", "Saatbettkombi 12 m", "money", 7000000),
  A("mprice.drille", "mprice.drille", "Getreidedrille 9–12 m (HORSCH Pronto)", "money", 13000000),
  A("mprice.einzelkorn", "mprice.einzelkorn", "Einzelkornsämaschine HORSCH Maestro 12 TX", "money", 24000000),
  // Feingemüse-Sätechnik: Zwiebel und Möhre werden auf BEETEN gesät (Reihenabstand 5–7 cm,
  //  Beetbreite 1,50–1,80 m), nicht mit 50-cm-Einzelkorntechnik. Klasse Agricola Italiana
  //  SNT, 3 Beete → rd. 5,4 m, hydraulisch klappbar, 12–15 Elemente.
  //  ANKER: SNT-2-320 mit 8 Reihen auf 3,00 m neu 36.500 € (traktorpool, HU, 2025); ein
  //  5,50-m-/12-Element-Rahmen von 2021 liegt gebraucht bei 45.000 € netto (agriaffaires/FR),
  //  was bei 60–70 % Restwert auf 64–75 T€ neu deutet. Beide Richtungen treffen sich bei
  //  50–60 T€. Spanne 45–68 T€. Preistreiber ist der Elementtyp, nicht die Beetzahl:
  //  dieselben 8 Reihen kosten als SN (Einzelreihe) 18.000 €, als SNT (Bandsaat) 36.500 €.
  A("mprice.gem_saat", "mprice.gem_saat", "Beetsämaschine Feingemüse", "money", 5500000),
  // Knoblauch wird gesteckt, nicht gesät. ANKER: JJ Broch PLNA-6 (6-reihig, pneumatisch),
  //  Neupreis 21.850 € netto bei Topmaquinaria/ES (Abruf 31.07.2026); Reihenkosten in dieser
  //  Klasse rd. 2.500–3.500 €/Reihe, 6 → 8 Reihen also +4.000–8.000 €. Spanne 22–34 T€.
  //  BEWUSSTE ABWEICHUNG von der ersten Fassung (60 T€): dort war eine Maschine mit
  //  ZEHENAUSRICHTUNG unterstellt. Die gibt es kommerziell nur handbeschickt (Garmach MGP,
  //  ERME PLMS) mit ~0,7 ha/TAG — für 50 ha bräuchte es vier bis fünf davon. Bei dieser
  //  Fläche legt man pneumatisch und ohne Ausrichtung; der Ertragsabschlag daraus ist ein
  //  offener Punkt in der Agronomie, keine Frage des Maschinenpreises.
  A("mprice.knobl_lege", "mprice.knobl_lege", "Knoblauch-Legemaschine pneumatisch (8-reihig)", "money", 2800000),
  A("mprice.streuer", "mprice.streuer", "Düngerstreuer RAUCH AERO GT 36 m", "money", 8500000),
  A("mprice.streuer_xeric", "mprice.streuer_xeric", "Düngerstreuer HORSCH Leeb Xeric 14 FS", "money", 16500000),
  A("mprice.boom48_pkg", "mprice.boom48_pkg", "48-m-Paket", "money", 17000000),
  A("mprice.spritze14", "mprice.spritze14", "Spritzen-Kostenprofil 36 m (Mischpark, €/Einheit)", "money", 38000000),
  A("mprice.krautschl", "mprice.krautschl", "Krautschläger ROPA KS 475 (4-reihig, 75–80 cm)", "money", 4500000),
  // Kartoffel One-Pass-Kette (Delta 21.07.) — ersetzt Legemaschine/Dammformer/Vollernter SF.
  A("mprice.onepass", "mprice.onepass", "Dewulf CP 42 Smart Float Becherlegemaschine", "money", 8000000),
  A("mprice.sc360", "mprice.sc360", "Dewulf SC-Front Frontfräse", "money", 6000000),
  A("mprice.roder_ropa", "mprice.roder_ropa", "Roder ROPA Keiler II", "money", 22500000),
  // Reale John-Deere-Angebotswerte (Liste) — Overrides für Rabatt/Restwert an der MachineType.
  A("mprice.zug_8rx", "mprice.zug_8rx", "Zugschlepper JD 8RX 410 (Liste, JD-Angebot)", "money", 68644700),
  // 9R 590 -> 8R 410 (Entscheidung 31.07.2026). Fuer 300 ha Startflaeche ist die 590-PS-Klasse
  //  ueberdimensioniert. Anker: dasselbe JD-Angebot vom 23.07.2026 wie fuer 8RX und 9R —
  //  Liste 523.813 EUR gegen 700.336 EUR, also -25,2 %. Der 8R 410 zieht den 6,2-m-Grubber
  //  (HORSCH gibt max. 435 PS an) mit Reserve.
  A("mprice.zug_9r", "mprice.zug_9r", "Zugschlepper JD 8R 410", "money", 52381300),
  A("mprice.ops_6r", "mprice.ops_6r", "Pflege-/Ernteschlepper JD 6R 260", "money", 32509400),
  A("mprice.lkw_sattel", "mprice.lkw_sattel", "LKW mit Sattelauflieger", "money", 13000000),
  A("mprice.radlader", "mprice.radlader", "JCB Radlader (Lager/Verladung)", "money", 10000000),
  A("mprice.shuttle", "mprice.shuttle", "Field-Shuttle 8×8 (Überladewagen)", "money", 5000000),
  A("mprice.fieldloader", "mprice.fieldloader", "DEMA Fieldloader OL-COMBI", "money", 20000000),
  A("log.fieldloader_tph", "log.fieldloader_tph", "Fieldloader-Überladeleistung", "tonne_per_ha", 150),
  A("mprice.tompflanz", "mprice.tompflanz", "Tomaten-Pflanzmaschine Checchi & Magli", "money", 14000000),
  A("mprice.tomernte", "mprice.tomernte", "Tomaten-Vollernter SF", "money", 45000000),
  A("mprice.gem_schwad", "mprice.gem_schwad", "Zwiebel-Schwadleger ASA-LIFT WR-180", "money", 9500000),
  A("mprice.gem_lader", "mprice.gem_lader", "Zwiebel-Ladeeroder ASA-LIFT SP-400", "money", 26500000),
  A("mprice.gem_moehre", "mprice.gem_moehre", "Möhren-Klemmbandroder ASA-LIFT T-300 DF (2-reihig)", "money", 34000000),
  A("mprice.maehdr", "mprice.maehdr", "Mähdrescher JD S7 900", "money", 85877800),
  A("mprice.transport", "mprice.transport", "Kipper/Anhänger (Transport)", "money", 4000000),
  // 3.000 €/ha statt 2.000: derselbe Ausbau (Pivot + Verrohrung + Pumpe) stand hier und in
  //  growth.irrigEurPerHaCent mit zwei verschiedenen Preisen. Je nachdem, welcher Block rechnete,
  //  kostete dieselbe Beregnung 2,42 oder 3,63 Mio €. Angeglichen auf den belegten Wert.
  A("mprice.irrig_perha", "mprice.irrig_perha", "Bewässerung/Pivot €/ha", "money_per_ha", 300000),
  // Ab welchem Planjahr investiert NEOTERRA SELBST in Beregnung?
  //  DEFAULT „nie" (Wert ≥ Planhorizont): Die Pachtentscheidung vom 30.07.2026 setzt den
  //  Pachtzins mit 750 €/ha an STATT 250 €/ha, ausdrücklich weil bereits beregnete Flächen
  //  gepachtet werden — die Pivots stecken im Pachtzins. Wer zusätzlich 3.000 €/ha eigene
  //  Beregnung investiert, zahlt die Pivots zweimal: 3,63 Mio € CAPEX neben 500 €/ha
  //  Pachtaufschlag, der bis 2034 auf rund 1,17 Mio € im Jahr läuft. Der Regler bleibt: wer
  //  unberegnete Fläche pachtet und selbst erschließt, setzt hier das Startjahr.
  A("irrig.capex_from_year", "irrig.capex_from_year", "Beregnungs-CAPEX ab Planjahr", "year", 99),
  // Globaler Regler auf ALLE Lohnarbeits-Sätze. Basis 1,0 = deutsche Erfahrungssätze (LWK NRW).
  //  Süd-Dolj liegt beim Lohnanteil darunter — hier kalibrieren, sobald Angebote vorliegen.
  A("lohn.factor", "lohn.factor", "Lohnarbeit — Satz-Faktor", "factor", 1.0, 0.85, 1.15),
  // Lager €/t GETRENNT: Hülle/Bau und Technik. Summe bleibt bei 120 €/t wie zuvor — die
  //  Aufteilung folgt der CAPEX-Taxonomie (Bau: Schüttlager + Hülle rund 11,2 Mio €,
  //  Technik: Kühl-/CA-Lager + Curing + Packlinien rund 12,4 Mio €), also etwa hälftig.
  // Cold Storage: Baukosten 350–400 €/t Kapazität (Vorgabe Benedikt; deckt sich mit der
  //  CAPEX-Taxonomie, die Kühl-/CA-Lager mit 250–550 €/t führt). Angesetzt 375 €/t, geteilt
  //  in Hülle/Bau und Technik. BEZUGSGRÖSSE IST DIE SPITZENBELEGUNG, nicht der Jahresdurchsatz.
  A("mprice.store_pert", "mprice.store_pert", "Cold Storage Hülle & Bau €/t Kapazität", "money_per_tonne", 17500),
  A("mprice.store_tech_pert", "mprice.store_tech_pert", "Cold Storage Technik €/t Kapazität", "money_per_tonne", 20000),
  // Absatz-/Kapazitätsgrenzen: Verarbeitungskapazität des kontrahierten Tomatenwerks (t/Kampagne).
  //  Mittelgroßes EU-Werk ≈ 100–250 kt/Kampagne (2.000–4.000 t/Tag × 60–80 Tage). Advisor warnt darüber.
  A("market.tomate_cap_t", "market.tomate_cap_t", "Tomatenwerk-Kapazität (t/Kampagne)", "tonne", 150000),
  // Einlagerungsquote je lagerpflichtiger Kultur (0..1): Anteil der Ernte, der eingelagert wird.
  //  Rest geht direkt Feld → Verarbeiter (keine Lager-CAPEX). Treibt die Lager-Bemessung (store).
  // Szenarioband nach Vorgabe Benedikt: Base 50/50 · Best 25 % frisch / 75 % Lager ·
  //  Worst gar keine Einlagerung. Die Quote ist frei variierbar (Preise & Treiber,
  //  Szenario-Studio). Sie treibt gleichzeitig Preis, Umsatzzeitpunkt, Kapitalbindung und
  //  die Lager-CAPEX-Bemessung — im Worst Case ohne Einlagerung entfällt konsequenterweise
  //  auch die Lagerinvestition.
  A("store.share.kartoffel_pommes", "store.share.kartoffel_pommes", "Einlagerungsquote Kartoffel Pommes", "percent", 0.50, 0.75, 0),
  A("store.share.kartoffel_chips", "store.share.kartoffel_chips", "Einlagerungsquote Kartoffel Chips", "percent", 0.50, 0.75, 0),
  A("store.share.zwiebel_moehre", "store.share.zwiebel_moehre", "Einlagerungsquote Zwiebel/Möhre", "percent", 0.50, 0.75, 0),
  // Die übrigen lagerpflichtigen Kulturen brauchen dieselbe Quote — sonst klaffen die
  //  Vorgaben auseinander: die CAPEX-Bemessung nimmt bei fehlendem Schlüssel 100 % an,
  //  der Erlöskanal in der Engine dagegen 0 %. Dann wird Lager gebaut, das nie genutzt wird.
  A("store.share.suesskartoffel", "store.share.suesskartoffel", "Einlagerungsquote Süßkartoffel", "percent", 0.50, 0.75, 0),
  A("store.share.knoblauch", "store.share.knoblauch", "Einlagerungsquote Knoblauch", "percent", 0.50, 0.75, 0),
  A("store.share.knollensellerie", "store.share.knollensellerie", "Einlagerungsquote Knollensellerie", "percent", 0.50, 0.75, 0),

  /* --- Lagerkanal: Planungsannahmen statt Einzelverträge -------------------
   * Die Planung ist bewusst von den Bestandsverträgen gelöst (die galten für 2025 und sind
   * nur noch Beleg). Gerechnet wird mit zwei Vermarktungskanälen je Kultur: die Tonnage, die
   * DIREKT ab Feld weggeht, und die Tonnage, die EINGELAGERT wird. Die Einlagerungsquote
   * oben steuert diesen Split — sie ist damit die folgenreichste Planungsannahme im Modell,
   * weil sie zugleich Preis, Umsatzzeitpunkt, Kapitalbindung und Lager-CAPEX treibt. */
  // Durchschnittliche Lagerdauer. Global; je Kultur über `store.months.<cropId>` überschreibbar.
  A("store.months", "store.months", "Lagerdauer Ø (Monate)", "months", 4, 3, 6),
  // Ab welchem Planmonat kann überhaupt eingelagert werden. HEUTE GIBT ES KEIN LAGER — es muss
  //  erst gebaut werden. Vorher geht die gesamte Ernte direkt ab Feld weg. Standard 12 = ab
  //  Jahr 2, passend zur CAPEX-Phasierung (Anschaffung Jahr 0/1).
  // MASTER-SCHALTER Lager/Packhaus. 0 = kein Lagerbau: keine Einlagerung, keine Lagererlöse,
  //  keine Lagerkosten, KEINE Lager-CAPEX. Die gesamte Ernte geht direkt ab Feld weg.
  //  Entscheidung 31.07.2026 (Benedikt): erst einmal komplett raus — der Lagerbau ist im
  //  Detail zu analysieren. Die vollständige Lagermechanik (Dienstleistungsmodell,
  //  Spitzenbelegung, Break-even-Gebühr) bleibt im Modell und ist mit einer 1 wieder scharf.
  A("store.active", "store.active", "Lager/Packhaus aktiv (1) oder komplett aus (0)", "flag", 1),
  // Die beiden Bauteile werden EINZELN entschieden (Beschluss 31.07.2026): Hülle und Technik
  //  sind getrennte Investitionen mit getrennter Nutzungsdauer, getrennter Steuerwirkung
  //  (Art. 22 Reinvestitionsbefreiung greift auf Technik, nicht auf Gebäude) und getrennter
  //  Make-or-Buy-Frage — eine Halle lässt sich mieten, eine Packlinie kaum.
  //  Wirken erst, wenn store.active = 1 steht.
  A("store.capex_shell", "store.capex_shell", "Lager: Hülle & Bau selbst investieren (1/0)", "flag", 1),
  A("store.capex_tech", "store.capex_tech", "Lager: Technik selbst investieren (1/0)", "flag", 1),
  A("store.from_month", "store.from_month", "Lager verfügbar ab Planmonat", "month", 12),
  // DER Verhandlungswert: Aufschlag, den der Abnehmer für Lagerware zahlt, je Tonne und Monat.
  // VERHANDLUNGSANNAHME — kein vorliegender Vertrag sagt ihn zu; PepsiCo verlangt Lagerung
  // heute ausdrücklich auf Kosten NEOTERRAs. Kalibrierung: die reine Kapitalbindung kostet bei
  // 5,8 % Revolver-Satz und 235 €/t rund 1,15 €/t·Monat, die Energie nochmal rund 2 €/t·Monat.
  // Ein Satz unter etwa 3,50 €/t·Monat deckt die Selbstkosten nicht.
  // Vermarktungsmodell der Lagerware. 1 = DIENSTLEISTUNG (Standard): Die Ware wird bereits
  //  bei der Ernte verkauft, das Eigentum geht auf den Abnehmer über, sie bleibt aber in
  //  unserem Lager. Die Einlagerung wird als separate Dienstleistung berechnet.
  //  0 = EIGENLAGER: Die Ware bleibt unser Eigentum und wird erst bei der Auslagerung verkauft.
  //  Der Unterschied ist erheblich — siehe Kommentar in computeOperating.
  A("store.service_mode", "store.service_mode", "Lager als Dienstleistung (1) statt Eigenlager (0)", "flag", 1),
  /* Lagergebühr je Tonne und Monat — Kalibrierung Benedikt nach der Cold-Storage-Rechnung:
   *   Base  20,00   Best  22,00   Worst  11,70 = GENAU DER BREAK-EVEN
   *
   * Der Worst-Case-Wert ist bewusst der Break-even: im Stressfall trägt sich das Lager
   * gerade eben und verdient nichts. Der Break-even ist dort SKALENINVARIANT (11,70 bei
   * 25 % wie bei 50 % Einlagerung), weil CAPEX und Betriebskosten linear mit der Kapazität
   * skalieren — er hängt nur an Lagerdauer, Schwund und Baukosten je Tonne.
   *
   * ACHTUNG: Im Worst Case steht die Einlagerungsquote auf 0 (Entscheidung Benedikt beim
   * Szenarioband). Solange das so bleibt, wird dort nichts eingelagert und die Gebühr ist
   * wirkungslos — sie greift erst, wenn die Quote im Worst Case über 0 gezogen wird.
   * Der Base-Break-even liegt bei 13,44 (kürzere Lagerdauer, niedrigerer Schwund). */
  A("store.fee_per_t_month", "store.fee_per_t_month", "Lagergebühr (€/t·Monat)", "money_per_tonne", 2000, 2200, 1170),
  // Betriebskosten der Lagerung — Literaturkalibrierung, bis technische Daten der Anlage vorliegen.
  A("store.energy_per_t_month", "store.energy_per_t_month", "Lagerenergie (€/t·Monat)", "money_per_tonne", 200, 150, 300),
  A("store.handling_per_t", "store.handling_per_t", "Ein-/Auslagerung (€/t Durchsatz)", "money_per_tonne", 600, 500, 800),
  // Lagerverlust auf die GESAMTE eingelagerte Menge (nicht je Monat) — Vorgabe Benedikt.
  //  Im Dienstleistungsmodell ist das keine Erlösminderung, sondern eine Ersatzpflicht zum
  //  Warenwert: die Ware gehört bereits dem Abnehmer, wir sind Verwahrer. Eine vertragliche
  //  Schwundtoleranz würde den Posten deckeln — heute bewusst ungedeckelt angesetzt.
  //  Kalibrierung Benedikt: Base 3 %. Best 2 %, Worst 8 % als Band. Der Schwund ist der
  //  wirksamste Hebel auf den Break-even — die Senkung von 5 auf 3 % drückte ihn im Base
  //  Case um 2,71 €/t·Monat (16,15 → 13,44).
  A("store.loss_rate", "store.loss_rate", "Lagerverlust (Anteil der eingelagerten Menge)", "percent", 0.03, 0.02, 0.08),


  // --- Personal (headcount / Bruttomonatsgehalt CENT) — Referenz D, Stufe 1 ---
  // Kopfzahlen skaliert der Composer mit stageFactor.
  A("pers.leitung.n", "pers.leitung.n", "Betriebsleitung & Agronomie (FTE)", "fte", 3),
  A("pers.leitung.gross", "pers.leitung.gross", "Leitung/Agronomie Brutto/Monat", "money", 250000),
  A("pers.stamm.n", "pers.stamm.n", "Stamm-Maschinenführer (FTE)", "fte", 12),
  A("pers.stamm.gross", "pers.stamm.gross", "Maschinenführer Brutto/Monat (7 €/h)", "money", 100333),
  A("pers.bewaesserung.n", "pers.bewaesserung.n", "Bewässerung / Pivot-Steuerung (FTE)", "fte", 4),
  A("pers.bewaesserung.gross", "pers.bewaesserung.gross", "Bewässerung Brutto/Monat", "money", 90000),
  A("pers.lager.n", "pers.lager.n", "Lager & Aufbereitung (FTE)", "fte", 4),
  A("pers.lager.gross", "pers.lager.gross", "Lager Brutto/Monat", "money", 88000),
  A("pers.service.n", "pers.service.n", "Werkstatt & Service/Technik (FTE)", "fte", 3),
  A("pers.service.gross", "pers.service.gross", "Werkstatt/Service Brutto/Monat", "money", 115000),
  A("pers.saison.n", "pers.saison.n", "Saisonkräfte (Kampagne, FTE-Äq.)", "fte", 11.72),
  A("pers.saison.gross", "pers.saison.gross", "Saisonkraft Brutto/Monat (5,20 €/h)", "money", 74550),
  A("pers.prakt.n", "pers.prakt.n", "Praktikanten / Trainees (FTE)", "fte", 4),
  A("pers.prakt.gross", "pers.prakt.gross", "Praktikant Brutto/Monat", "money", 45000),

  // --- Holding (CENT je Periode / Raten) ---
  A("hold.audit", "hold.audit", "Holding Wirtschaftsprüfung", "money", 100000),
  A("hold.legal", "hold.legal", "Holding Legal", "money", 83000),
  A("hold.board", "hold.board", "Holding Board/D&O", "money", 208000),
  A("hold.domizil", "hold.domizil", "Holding Domizil", "money", 66000),
  A("hold.it", "hold.it", "Holding IT", "money", 125000),
  A("hold.tax", "hold.tax", "Holding Steuerberatung", "money", 83000),
  A("hold.fee", "hold.fee", "Management-Fee (IC)", "money", 416700),
  // DEUTSCHE GmbH statt CY Ltd (Entscheidung 30.07.2026): Körperschaftsteuer 15 %
  //  + Solidaritätszuschlag 5,5 % darauf (= 15,825 %) + Gewerbesteuer. Bei Hebesatz 400 %
  //  sind das 14,0 % ⇒ rund 29,8 % Gesamtbelastung. Auf Dividenden AUS der SRL greift das
  //  Schachtelprivileg (§ 8b KStG): 95 % steuerfrei, 5 % gelten als nicht abziehbare
  //  Betriebsausgabe — die Beteiligungserträge sind daher fast unbelastet; der Satz hier
  //  trifft die eigenen Erträge der Holding (v. a. die Management-Fee).
  A("hold.taxrate", "hold.taxrate", "Holding-Steuersatz (DE: KSt + SolZ + GewSt)", "percent", 0.298),
  // Ausschüttung DE-GmbH an Gesellschafter: 25 % Kapitalertragsteuer + SolZ = 26,375 %.
  //  Auf 0 lassen, solange thesauriert wird; für die Ausschüttungsrechnung hier setzbar.
  A("hold.wht", "hold.wht", "Kapitalertragsteuer Ausschüttung (DE, inkl. SolZ)", "percent", 0),

  // --- Delta 21.07. (2): Spritzstrategie (fenstergetriebene Flotte, Mischpark) ---
  // Die Spritzenzahl ist der Mehrkultur-Sommerpeak (max. gleichzeitiger PSM-Bedarf ALLER
  // Kulturen), nicht mehr pauschal. Fließt über spray_gz/spray_sf in CAPEX/TCO/Bilanz.
  A("spray.appl_lha", "spray.appl_lha", "Wasseraufwand l/ha (Kartoffel-Blight 200–400)", "litre_per_ha", 200),
  A("spray.window_days", "spray.window_days", "PSM-Fenster je Runde (Tage)", "days", 5),
  A("spray.boom_m", "spray.boom_m", "Gestängebreite", "metre", 36),
  // 48-m-Paket-Schalter: aktiviert kohärent 48-m-Spritzenbreite + Streuer-Swap AERO GT→Leeb Xeric 14 FS
  // + 48-m-Umrüst-CAPEX (Gestänge PT/TD + Fahrgassen-Terminal). Boden/Saat/Drusch (12 m) bereits kompatibel.
  A("farm.boom48", "farm.boom48", "48-m-Paket aktiv (0 = 36 m Bestand · 1 = 48 m Paket)", "flag", 0),
  A("spray.speed_kmh", "spray.speed_kmh", "Fahrtempo km/h", "kmh", 12),
  A("spray.refill_min", "spray.refill_min", "Befüllzeit min", "minutes", 20),
  A("spray.field_eff", "spray.field_eff", "Feldeffizienz", "percent", 0.80),
  A("spray.hours_day", "spray.hours_day", "Einsatzstunden/Tag", "hours", 11),
  A("spray.reserve", "spray.reserve", "Spritzen — Redundanz-Reserve", "count", 1),
  A("spray.sf_share", "spray.sf_share", "Selbstfahrer-Anteil der Spritzenflotte", "percent", 0.25),
  A("spray.tank_gz_l", "spray.tank_gz_l", "Tank gezogen (Dammann) l", "litre", 14000),
  A("spray.tank_sf_l", "spray.tank_sf_l", "Tank Selbstfahrer l", "litre", 12000),
  A("spray.pivot_ha", "spray.pivot_ha", "Pivot-Fläche ha (1 Kreis)", "hectare", 70),
  A("spray.boom48_prem", "spray.boom48_prem", "48-m-Preisaufschlag", "percent", 0.15),
  A("spray.res48_hair", "spray.res48_hair", "48-m-Restwert-Abschlag (pp)", "percent", 0.08),
  A("mprice.spray_gz", "mprice.spray_gz", "Spritze gezogen (Dammann 14.000 l)", "money", 25000000),
  A("mprice.spray_sf", "mprice.spray_sf", "Spritze Selbstfahrer (12.000 l)", "money", 56000000),

  // --- Delta 21.07. (2): Wertkultur-Maschinen bottom-up (Einsatzplanung) ---
  A("mprice.transplant", "mprice.transplant", "Tom/Gem-Pflanzmaschine (bottom-up)", "money", 9000000),
  A("mprice.tomharv", "mprice.tomharv", "Tom/Gem-Ernter (bottom-up)", "money", 45000000),
  A("val.trans_rate", "val.trans_rate", "Setzleistung ha/Tag je Pflanzmaschine", "ha_per_day", 8),
  A("val.trans_win", "val.trans_win", "Setzfenster Wochen", "weeks", 5),
  A("val.tomh_rate", "val.tomh_rate", "Ernteleistung ha/Tag je Ernter", "ha_per_day", 15),
  A("val.tomh_win", "val.tomh_win", "Erntefenster Wochen", "weeks", 8),
  A("val.seas_labor_ha", "val.seas_labor_ha", "Saisonarbeit €/ha (Default 0 — erst reconcilen)", "money_per_ha", 0),

  // --- Delta 21.07. (2): Einsatzplanung (Schichten, Staffelung, Stammpersonal) ---
  A("en.shifts", "en.shifts", "Schichten (1 oder 2)", "count", 2),
  A("en.shift_eff", "en.shift_eff", "Schicht-Effekt (0–1, Zweitschicht-Durchsatz)", "percent", 0.70),
  A("en.hours_day", "en.hours_day", "Feldstunden je Tag (1 Schicht)", "hours", 10),
  A("en.harvest_staffel", "en.harvest_staffel", "Ernte-Staffelung (Wochen, Reifegruppen)", "weeks", 3),
  A("en.saat_staffel", "en.saat_staffel", "Aussaat-Staffelung (Wochen)", "weeks", 2),
  A("en.avail_h_year", "en.avail_h_year", "Verfügbare Feld-Betriebsstunden je Maschine und Jahr", "hours", 2000),
  // ENTFERNT 31.07.2026: en.staff (45 Personen) — die Personalkapazität kommt aus der
  //  Personalplanung (personalFteOfYear), nicht mehr aus einer Konstante des Gruppenmodells.
  // ENTFERNT 31.07.2026: en.drill / en.fert / en.combine / en.transp. Vier Klassen der
  //  Einsatzplanung standen auf frei gesetzten Basiszahlen aus dem Gruppenmodell, „damit die
  //  Einsatzplanung out-of-the-box engpassfrei ist" — eine Ampel, die per Konstruktion nie
  //  Rot zeigt, prüft nichts. Alle Klassen zählen jetzt Maschinen aus dem Katalog.
  A("en.gross_extra", "en.gross_extra", "Großschlepper zusätzlich zur Legekombi", "count", 1),

  /* ------------------------------------------------------------------
   * SZENARIO-STUDIO — Risiko-, Markt- und Logistik-Treiber.
   *  ALLE Defaults sind NEUTRAL (Faktor 1 / Delta 0), d. h. das Basismodell rechnet
   *  exakt wie bisher, solange kein Regler bewegt wird. Der Composer legt sie in
   *  buildModelState als Overlay ÜBER die bereits inflationierten Kurven.
   * ---------------------------------------------------------------- */
  // Klima- & Infrastrukturrisiko — Beregnungsausfall (ANIF-Netzpumpwerk) in der Hitzespitze.
  //  Ertragsverlust = Ausfalltage × Verlust/Tag, gekappt bei 85 %. Direktentnahme Donau
  //  (eigene Pumpstation + Druckleitung) puffert den Netzausfall zu `intake_mitigation`.
  A("risk.irrig_outage_d", "risk.irrig_outage_d", "Beregnungsausfall in der Hitzespitze (Tage)", "days", 0, 0, 10),
  A("risk.yield_per_outage_d", "risk.yield_per_outage_d", "Ertragsverlust je Ausfalltag (Wertkultur)", "percent", 0.030),
  A("risk.outage_break_share", "risk.outage_break_share", "Ausfall-Wirkung auf Break Crops (Anteil)", "percent", 0.40),
  A("farm.intake_direct", "farm.intake_direct", "Direktentnahme Donau aktiv (0/1)", "flag", 0),
  A("risk.intake_mitigation", "risk.intake_mitigation", "Redundanz-Wirkung Direktentnahme (0..1)", "percent", 0.85),
  A("irrig.norm_scale", "irrig.norm_scale", "Wassernorm-Skalierung (1,0 = Plan-mm)", "factor", 1.0),
  // Markt & Qualität — Kontrakt vs. Spot. Kontrahierte Menge ist preisfest; nur der
  //  Spot-Anteil (1 − contract_share) trägt die Spot-Delta. Break Crops sind voll spot-exponiert.
  A("market.contract_share", "market.contract_share", "Kontraktanteil Wertkulturen (0..1)", "percent", 0.80),
  A("market.spot_delta", "market.spot_delta", "Spotpreis-Delta (±)", "percent", 0),
  A("market.brix_premium", "market.brix_premium", "Brix-Prämie/-Abzug Industrietomate (±)", "percent", 0),
  A("market.potato_grade", "market.potato_grade", "Sortier-/Qualitätsprämie Kartoffel (±)", "percent", 0),
  // Logistik — Entfernung zum Abnehmer. Der €/t-Speditionssatz ist auf `dist_ref_km`
  //  kalibriert und skaliert linear mit der tatsächlichen Entfernung.
  A("transport.distance_km", "transport.distance_km", "Entfernung zum Abnehmer (km)", "km", 120),
  A("transport.dist_ref_km", "transport.dist_ref_km", "Referenz-Entfernung des €/t-Satzes (km)", "km", 120),
  // Zinsschock ADDITIV in Basispunkten-Dezimal (0,02 = +200 bps) — multiplikativ auf den
  //  EURIBOR wäre als Regler unbrauchbar (Vorzeichenwechsel bei Negativzins).
  A("macro.rate_shock", "macro.rate_shock", "Zinsschock auf EURIBOR (additiv, 0,02 = +200 bp)", "percent", 0),
  // Pflanzenschutz-Stücksatz — bis hierher teilte sich PSM den Pauschalsatz mit Material und
  //  Handarbeit, ein PSM-Regler hätte zwei fremde Kostenblöcke mitgezogen. Jetzt eigener Satz.
  A("psm.per_euro", "psm.per_euro", "Pflanzenschutz-Stücksatz (1 € = 100 ct)", "money", 100),

  /* --- Paket C: Downside ------------------------------------------------- */
  // Zurückweisungsquote am Werkstor. EINHEITLICH für alle Erlöse (Kontrakt und Spot), weil
  //  auch ein Händler zurückweist und weil ein Satz je Kontrakt das Modell an den heutigen
  //  Abnehmermix fesselt. Grundlage: VIA-AGRO-Prüfprotokoll ANEXA 1F-P.2.2.-9 mit harten
  //  Ausschlussgrenzen (>200 Punkte, UWG <345/>480 g, Trockenmasse <19 %, Zucker >4 g/l,
  //  Erde ≥10 % ab Feld bzw. ≥6 % ab Lager, Steine >1 %, Schwimmer ≥6 %, Phytophthora,
  //  Mindesttemperatur 8 °C). Der Erzeuger verzichtet auf Ansprüche für zurückgewiesene Ware
  //  (6.2) und trägt den Rücktransport (6.7) — Letzterer ist hier NOCH NICHT bewertet.
  //  Wirkt als Erlösabschlag; die COGS bleiben unberührt, denn die Ware ist gewachsen.
  A("quality.reject", "quality.reject", "Zurückweisungsquote am Werkstor", "percent", 0.03, 0.01, 0.05),
  // Deckungskauf: Marktaufschlag je Tonne Fehlmenge, den der Abnehmer NEOTERRA in Rechnung
  //  stellt (VIA AGRO 3.6 / 5.10, PepsiCo ohne Deckelung). Negativ korreliert: er entsteht
  //  genau dann, wenn die Ernte schlecht ausfällt und die Marktpreise hoch stehen.
  A("market.cover_premium", "market.cover_premium", "Deckungskauf-Aufschlag je t Fehlmenge", "money_per_tonne", 3000, 0, 8000),
]);

/* Begründungspflichtige Annahmen (Paket C). Die Kartoffelerträge liegen über der
 * rumänischen Evidenz; der einzige EXTERNE, vertraglich bindende Anker ist Pestova mit
 * 36 t/ha auf 28,2 ha. Sie sind damit nicht falsch, aber belegpflichtig — im Register
 * sichtbar als strittig markiert, damit sie nicht unbemerkt in den Investorencase wandern. */
for (const [key, note] of [
  ["yield.kartoffel_chips", "42 t/ha liegen 17 % über dem einzigen externen Anker: Pestova schreibt 36 t/ha als vertragliche Produktionsverpflichtung fest (SALES CONTRACT NO 03/2026). Worst Case steht auf 35 t/ha und damit unter dem Anker. Base ist zu belegen."],
  ["yield.kartoffel_pommes", "45 t/ha liegen über der rumänischen Evidenz (siehe NEOS-FX-Agronomie-Nachschlag2-Research.md). Kein externer Vertragsanker vorhanden, weil VIA AGRO Anexa 1 unbefüllt ist. Base ist zu belegen."],
] as const) {
  const a = ASSUMPTIONS[key];
  if (a) a.meta = { ...(a.meta ?? {}), status: "strittig", confidence: "niedrig", note };
}

/* --------------------------------------------------------------------------
 * KOSTENKATALOG je Kultur (Agronomie-Direktkosten → opLines).
 *  Je Direktkosten-Block EINE opLine, unitCostKey 'price.per_euro' (1 € = 100 ct),
 *  quantityPerHa = €/ha-Wert aus Referenz A. Editierbar in der Katalog-UI.
 *  Maschinen-Betriebskosten kommen NICHT aus dem Katalog, sondern composer-seitig.
 * ------------------------------------------------------------------------ */
const L = (
  label: string,
  costType: CostType,
  quantityPerHa: number,
  unitCostKey: string,
  unit?: string,
): OpLineSeed => ({ label, costType, quantityPerHa, unitCostKey, unit });

const clampP = (p: number): number => Math.max(0, Math.min(N - 1, p));

/* --------------------------------------------------------------------------
 * PHASE 3 — Pflanzenschutz & Düngung BOTTOM-UP (BBCH-Programme, §A des Research-Docs).
 *  PSM: je Kultur Überfahrten/Blöcke mit Mittelkosten €/ha (Wasser ist ~kostenfrei via Pivot).
 *  Düngung: je Kultur GABEN mit N/P₂O₅/K₂O (kg/ha) × Nährstoffpreis, Applikation Streuer vs.
 *  Fertigation (lösliche Produkte teurer). Summen kalibriert nahe der bisherigen Aggregate.
 *  Alle €/ha; Nährstoffpreise sind editierbare Kalibrierungspunkte (§G).
 * ------------------------------------------------------------------------ */
// Phase 4: Düngung = Nährstoffmenge (kg/ha) × Preis-Assumption (fert.*, CENT/kg) — editierbar,
// reale 2025er-Düngerpreise (Masterplan). Je Nährstoff eine transparente Zeile (Menge × Preis).
// unterfuss = mit der Aussaat ausgebracht (Einzelkorn-Unterfußdüngung) → KEINE eigene Streuer-Überfahrt.
type Gabe = { label: string; n?: number; p?: number; k?: number; s?: number; fert?: boolean; unterfuss?: boolean };
/** Düngeprogramm je Kultur — Gaben mit Nährstoffmengen kg/ha (BBCH/Applikation im Label). */
const DUENGUNG_PROGRAM: Record<CropId, Gabe[]> = {
  weizen:           [{ label: "Grund P/K (BBCH 00, Streuer)", p: 70, k: 90 }, { label: "N1 Andüngung + S (BBCH 25–30)", n: 60, s: 25 }, { label: "N2 Schossen (BBCH 31–32)", n: 70 }, { label: "N3 Ähre/Qualität (BBCH 37–49)", n: 45 }],
  gerste_zw:        [{ label: "Grund P/K (Streuer)", p: 60, k: 80 }, { label: "N1 + S (BBCH 25–30)", n: 60, s: 20 }, { label: "N2 (BBCH 31–32)", n: 60 }, { label: "N3 (BBCH 39–49)", n: 45 }],
  soja_luzerne:     [{ label: "Grund P/K (Streuer; N-Fixierer)", p: 70, k: 140 }, { label: "Start-N + Rhizobium", n: 30 }],
  winterraps:       [{ label: "Grund P/K (Streuer)", p: 50, k: 85 }, { label: "N Herbst (BBCH 12–16)", n: 35 }, { label: "N1 Frühjahr + S (BBCH 30)", n: 55, s: 45 }, { label: "N2 Knospe + Bor (BBCH 50)", n: 50 }],
  mais:             [{ label: "Grund/Unterfuß P/K (BBCH 00)", p: 60, k: 70, unterfuss: true }, { label: "N Start Unterfuß", n: 40, unterfuss: true }, { label: "N2 (BBCH 14–16)", n: 120 }, { label: "N3 Fertigation (BBCH 18)", n: 80, fert: true }],
  tomate:           [{ label: "Grund P/K (vor Pflanzung, Streuer)", p: 120, k: 250 }, { label: "N+K laufend (BBCH 20–80, Fertigation)", n: 200, k: 300, fert: true }],
  kartoffel_pommes: [{ label: "Grund P/K + Start-N (vor Legen, Streuer)", p: 100, k: 300, n: 80 }, { label: "N-Kopf (BBCH 20–40, Fertigation)", n: 120, fert: true }],
  kartoffel_chips:  [{ label: "Grund P/K + Start-N (vor Legen, Streuer)", p: 100, k: 320, n: 80 }, { label: "N-Kopf (BBCH 20–40, Fertigation)", n: 130, fert: true }],
  zwiebel_moehre:   [{ label: "Grund P/K (Streuer)", p: 80, k: 200 }, { label: "N (BBCH 12–45, Fertigation)", n: 145, fert: true }],
  suesskartoffel:   [{ label: "Grund P/K (vor Pflanzung, Streuer)", p: 60, k: 180 }, { label: "N moderat (BBCH 20–60, Fertigation — zu viel N → Kraut statt Knolle)", n: 70, fert: true }],
  knoblauch:        [{ label: "Grund P/K (Herbst, Streuer)", p: 60, k: 120 }, { label: "N1 Frühjahr + S (BBCH 13–15)", n: 60, s: 25 }, { label: "N2 (BBCH 15–41)", n: 40 }],
  knollensellerie:  [{ label: "Grund P/K + Bor (vor Pflanzung, Streuer)", p: 90, k: 260 }, { label: "N+K laufend (BBCH 15–45, Fertigation)", n: 150, k: 100, fert: true }],
  weizen_dry:       [{ label: "Grund P/K (BBCH 00, Streuer)", p: 50, k: 60 }, { label: "N1 Andüngung + S (BBCH 25–30)", n: 45, s: 20 }, { label: "N2 Schossen (BBCH 31–32)", n: 40 }],
  gerste_dry:       [{ label: "Grund P/K (Streuer)", p: 45, k: 55 }, { label: "N1 + S (BBCH 25–30)", n: 45, s: 15 }, { label: "N2 (BBCH 31–32)", n: 35 }],
  raps_dry:         [{ label: "Grund P/K (Streuer)", p: 40, k: 70 }, { label: "N Herbst (BBCH 12–16)", n: 25 }, { label: "N1 Frühjahr + S (BBCH 30)", n: 45, s: 35 }],
  sonnenblume:      [{ label: "Grund P/K + N (BBCH 00, Streuer)", n: 40, p: 40, k: 80 }, { label: "N Andüngung (BBCH 14–16)", n: 30 }],
};
/** PSM-Programm je Kultur — Überfahrten/Blöcke mit Mittelkosten €/ha (BBCH im Label).
 *  passes = Spritz-Überfahrten des Blocks (Default 1; 0 = Tankmischung mit vorherigem Block
 *  bzw. nur anteilig eingepreist → keine eigene Überfahrt). SSOT für die Spritzen-Passes! */
const PSM_PROGRAM: Record<CropId, { label: string; eurHa: number; passes?: number }[]> = {
  weizen:           [{ label: "H Herbst (BBCH 11–13)", eurHa: 55 }, { label: "WR + H (BBCH 30–31)", eurHa: 50 }, { label: "F Fahnenblatt (BBCH 37–39)", eurHa: 55 }, { label: "F + I Blüte (BBCH 61–65)", eurHa: 50 }],
  gerste_zw:        [{ label: "H Herbst (BBCH 12–13)", eurHa: 50 }, { label: "T1 GS 30–32: Fungizid (Fluxapyroxad+Prothioconazol) + WR — Netzflecken/Rhynchosporium (~60%)", eurHa: 60 }, { label: "T2 GS 45–49: Fungizid Ramularia (Prothioconazol+Folpet-Multisite) (~40%)", eurHa: 48 }, { label: "Soja H (BBCH 12–14)", eurHa: 18 }, { label: "Soja F + I (BBCH 61–65)", eurHa: 12 }],
  soja_luzerne:     [{ label: "H Vorauflauf (BBCH 00–09)", eurHa: 60 }, { label: "H Nachauflauf (BBCH 13–15)", eurHa: 45 }, { label: "F + I Blüte (BBCH 61–71)", eurHa: 25 }],
  winterraps:       [{ label: "H Nachauflauf (BBCH 12–14, Metazachlor+Quinmerac)", eurHa: 45 }, { label: "I+WR Herbst Erdfloh (BBCH 14–16, Tau-Fluvalinat) — Tankmix mit H", eurHa: 40, passes: 0 }, { label: "I Rapsglanzkäfer (BBCH 50–59, Acetamiprid)", eurHa: 30 }, { label: "F Sclerotinia (BBCH 63–65, Prothioconazol+Fluopyram)", eurHa: 50 }],
  mais:             [{ label: "H Nachauflauf (BBCH 13–16)", eurHa: 70 }, { label: "I Maiszünsler (BBCH 33–51)", eurHa: 40 }, { label: "F (BBCH 63, opt. — anteilig eingepreist, keine volle Überfahrt)", eurHa: 20, passes: 0 }],
  tomate:           [{ label: "Anwachsen 2× F+I (BBCH 11–19, Cymoxanil + Chlorantraniliprol)", eurHa: 120, passes: 2 }, { label: "Veg. 7× F+I (BBCH 20–50, Mandipropamid + Emamectin/Spinosad, Tuta-Rotation)", eurHa: 525, passes: 7 }, { label: "Blüte/Ansatz 4× F+I (BBCH 60–69, Azoxystrobin + Indoxacarb)", eurHa: 280, passes: 4 }, { label: "Reife 3× F (BBCH 70–89, Difenoconazol/Alternaria)", eurHa: 175, passes: 3 }],
  kartoffel_pommes: [{ label: "H Vorauflauf (BBCH 00–08, Metribuzin+Clomazone)", eurHa: 55 }, { label: "I Kartoffelkäfer (BBCH 10–20, Acetamiprid)", eurHa: 40 }, { label: "F Krautfäule-Serie 12× (BBCH 20–89, Cymoxanil/Fluazinam/Mandipropamid/Oxathiapiprolin/Kupfer — KEIN Mancozeb)", eurHa: 555, passes: 12 }],
  kartoffel_chips:  [{ label: "H Vorauflauf (BBCH 00–08, Metribuzin+Clomazone)", eurHa: 55 }, { label: "I Kartoffelkäfer (BBCH 10–20, Acetamiprid)", eurHa: 45 }, { label: "F Krautfäule-Serie 12× (BBCH 20–89, Cymoxanil/Fluazinam/Mandipropamid/Oxathiapiprolin/Kupfer — KEIN Mancozeb)", eurHa: 570, passes: 12 }],
  zwiebel_moehre:   [{ label: "H Vorauflauf (BBCH 00–09)", eurHa: 60 }, { label: "H Nachauflauf (BBCH 11–13)", eurHa: 55 }, { label: "I Thrips/Fliege (BBCH 14–19)", eurHa: 90 }, { label: "F Mehltau/Botrytis 4× (BBCH 13–45)", eurHa: 360, passes: 4 }, { label: "F Abschluss (BBCH 47–48)", eurHa: 85 }],
  suesskartoffel:   [{ label: "H Vorauflauf (BBCH 00–08, Clomazone)", eurHa: 50 }, { label: "I Drahtwurm/Blattfresser (BBCH 20–40)", eurHa: 45 }, { label: "F Blattflecken (BBCH 40–70, opt.)", eurHa: 40 }],
  knoblauch:        [{ label: "H Nachauflauf Herbst (BBCH 11–13)", eurHa: 50 }, { label: "F Rost/Peronospora 2× (BBCH 15–45)", eurHa: 130, passes: 2 }, { label: "I Thrips/Lauchmotte (BBCH 15–41)", eurHa: 40 }],
  // Sellerie: hoher Septoria-Druck unter Beregnung (LEH-Makellosigkeit!) → volles Fungizid-Programm.
  knollensellerie:  [{ label: "H Nachpflanzung (BBCH 12–14)", eurHa: 70 }, { label: "F Septoria/Alternaria 5× (BBCH 15–48, Mankozeb-frei: Difenoconazol/Azoxystrobin-Rotation)", eurHa: 380, passes: 5 }, { label: "I Möhrenfliege/Blattläuse 2× (BBCH 14–41)", eurHa: 90, passes: 2 }],
  weizen_dry:       [{ label: "H Herbst (BBCH 11–13)", eurHa: 45 }, { label: "WR + H (BBCH 30–31)", eurHa: 45 }, { label: "F Fahnenblatt (BBCH 37–39)", eurHa: 45 }],
  gerste_dry:       [{ label: "H Herbst (BBCH 12–13)", eurHa: 45 }, { label: "T1 GS 30–32 Fungizid (Netzflecken/Rhynchosporium)", eurHa: 50 }, { label: "T2 GS 45–49 Fungizid (Ramularia)", eurHa: 40 }],
  raps_dry:         [{ label: "H Nachauflauf (BBCH 12–14, Metazachlor+Quinmerac)", eurHa: 45 }, { label: "I Rapsglanzkäfer (BBCH 50–59, Acetamiprid)", eurHa: 30 }, { label: "F Sclerotinia (BBCH 63–65, Prothioconazol+Fluopyram)", eurHa: 50 }],
  sonnenblume:      [{ label: "H Vorauflauf (BBCH 00–09)", eurHa: 50 }, { label: "H Nachauflauf (BBCH 12–16, Imazamox/ClearField)", eurHa: 45 }, { label: "F Sclerotinia/Phomopsis (BBCH 51–59, Boscalid)", eurHa: 45 }],
};

/* --- SSOT-VERZAHNUNG Maßnahmen → Arbeitsgänge ------------------------------------
 * Die Überfahrten der Ausbring-Maschinen werden aus den MASSNAHMEN-Programmen abgeleitet:
 *   Streuer-Passes  = Anzahl Düngegaben ohne Fertigation/Unterfuß (die laufen über Pivot bzw. Drille)
 *   Spritzen-Passes = Σ passes der PSM-Blöcke (Default 1 je Block; 0 = Tankmix/anteilig)
 * Damit treiben die Kultur-Kalkulations-Maßnahmen automatisch Maschinenstunden, Diesel,
 * Spritzen-Flottensizing und opex.machines — kein manueller Doppelpflege-Drift mehr.
 * domain.arbeitsgaenge bleibt editierbar; Abweichungen meldet deriveMassnahmenChecks (Check-Panel). */
export const duengPasses = (cropId: string): number =>
  (DUENGUNG_PROGRAM[cropId as CropId] ?? []).filter((g) => !g.fert && !g.unterfuss).length;
export const psmPasses = (cropId: string): number =>
  (PSM_PROGRAM[cropId as CropId] ?? []).reduce((s, p) => s + (p.passes ?? 1), 0);
for (const cid of Object.keys(ARBEITSGAENGE) as CropId[]) {
  for (const g of ARBEITSGAENGE[cid]) {
    if (g.m === "streuer") g.passes = duengPasses(cid);
    if (g.m === "spritze14") g.passes = psmPasses(cid);
    // Stabile Maßnahmen-ID je Feld-Arbeitsgang (FMS-Abgleich).
    if (!g.mid) g.mid = `${cid}::mach::${g.m}`;
  }
}

/* --- AGRONOMIE-WÄCHTER („Warning-KI") -------------------------------------------
 * Prüft je Kultur, ob agronomische Pflicht-Maßnahmen vorhanden sind. Löschen bleibt IMMER
 * erlaubt (warnt, blockiert nicht) — aber mit klarer Konsequenz am Standort. */
export type AgroWarning = { cropId: string; category: string; severity: "warning" | "error"; message: string };

/** PSM-anfällige Kulturen (lazy — VALUE_CROP_IDS wird weiter unten deklariert, TDZ vermeiden). */
const psmNeeding = (cropId: string) => VALUE_CROP_IDS.includes(cropId) || cropId === "weizen" || cropId === "winterraps";
/** Ob eine Op-Zeilengruppe (Betriebsmittel) eine positive Menge trägt. */
function opQty(entry: CatalogEntry | undefined, code: string): number {
  const op = entry?.ops.find((o) => o.code === code);
  return op ? op.lines.reduce((s, l) => s + (l.quantityPerHa || 0), 0) : 0;
}

/** Agronomische Warnungen je Kultur — fehlende/entfernte Pflicht-Maßnahmen mit Konsequenz. */
export function deriveAgronomieWarnings(domain: Domain, cropId: string): AgroWarning[] {
  const entry = domain.catalog.find((c) => c.cropId === cropId);
  if (!entry) return [];
  const name = entry.name ?? cropId;
  const gaenge = domain.arbeitsgaenge[cropId] ?? [];
  const dryHeat = (domain.standort?.summerHeat ?? "hoch") === "hoch";
  const isValue = VALUE_CROP_IDS.includes(cropId);
  const w: AgroWarning[] = [];
  const push = (category: string, severity: "warning" | "error", message: string) => w.push({ cropId, category, severity, message });

  // 1) Saat-/Pflanzgut — ohne geht gar nichts.
  if (opQty(entry, "OP-SAAT") <= 0)
    push("Saat/Pflanzung", "error", `${name}: Ohne Saat-/Pflanzgut ist kein Anbau möglich.`);
  // 2) Düngung — Chernozem trägt hohen Entzug, aber nicht ohne Nachlieferung.
  if (opQty(entry, "OP-DUENG") <= 0)
    push("Düngung", "warning", `${name}: Keine Düngung hinterlegt — am Standort (Chernozem, hoher Nährstoffentzug) nicht tragfähig. Folge: deutlicher Ertrags-/Qualitätsverlust und N-Auszehrung des Bodens.`);
  // 3) Pflanzenschutz — nur für anfällige Kulturen.
  if (psmNeeding(cropId) && opQty(entry, "OP-PSM") <= 0) {
    const risk = cropId.startsWith("kartoffel") ? "Kraut- & Knollenfäule (Phytophthora)"
      : cropId === "weizen" ? "Septoria/Fusarium & Ungras-Konkurrenz"
      : cropId === "tomate" ? "Krautfäule & Bakteriosen"
      : cropId === "winterraps" ? "Sclerotinia/Rapsglanzkäfer"
      : "Pilz- & Schädlingsdruck";
    push("Pflanzenschutz", "warning", `${name}: Kein Pflanzenschutz hinterlegt — hohes Ausfallrisiko (${risk}).`);
  }
  // 4) Beregnung — Wertkulturen am heißen Trockenstandort nicht ohne.
  if (isValue && dryHeat && opQty(entry, "OP-BEREG") <= 0)
    push("Beregnung", "warning", `${name}: Wertkultur ohne Beregnung am Trockenstandort (Süd-Dolj, Sommerhitze) — Totalausfallrisiko in Trockenperioden.`);
  // 5) Maschinen-Maßnahmen — mind. eine (Bodenbearbeitung/Aussaat/Ernte).
  if (gaenge.length === 0)
    push("Maschinen", "warning", `${name}: Keine Maschinen-Maßnahmen hinterlegt (Bodenbearbeitung/Aussaat/Ernte fehlen).`);
  return w;
}

/** Konsistenz-Check fürs Check-Panel: melden, wenn die (editierbaren) Arbeitsgänge-Überfahrten
 *  von den Maßnahmen-Programmen der Kultur-Kalkulation abweichen (Streuer ↔ Düngegaben,
 *  Spritze ↔ Σ PSM-Blöcke). Warnung, kein Fehler — bewusste Abweichung bleibt möglich. */
export function deriveMassnahmenChecks(domain: Domain): CheckResult[] {
  const bad: string[] = [];
  let dev = 0;
  const seen = new Set<string>();
  for (const a of domain.anbauplan) {
    if (seen.has(a.cropId)) continue;
    seen.add(a.cropId);
    const gg = domain.arbeitsgaenge[a.cropId] ?? [];
    const st = gg.find((g) => g.m === "streuer");
    const sp = gg.find((g) => g.m === "spritze14");
    const dp = duengPasses(a.cropId), pp = psmPasses(a.cropId);
    const nm = (CROP_NAME as Record<string, string>)[a.cropId] ?? a.cropId;
    if (st && st.passes !== dp) { bad.push(`${nm}: Streuer ${st.passes}≠${dp} Gaben`); dev += Math.abs(st.passes - dp); }
    if (sp && sp.passes !== pp) { bad.push(`${nm}: Spritze ${sp.passes}≠${pp} PSM`); dev += Math.abs(sp.passes - pp); }
  }
  const checks: CheckResult[] = [{
    id: "massnahmen_sync",
    label: bad.length
      ? `Maßnahmen ↔ Arbeitsgänge: ${bad.join(" · ")}`
      : "Maßnahmen ↔ Arbeitsgänge synchron (Düngegaben & PSM-Überfahrten)",
    passed: bad.length === 0,
    maxDeviation: dev,
    offendingPeriods: [],
    severity: "warning",
  }];

  // Doldenblütler-Anbaupause (Apiaceae ≤ 20 % der Rotation, alle Ramp-Jahre).
  {
    const my = deriveCropAreasMY(domain);
    let worst = 0, worstY = 0;
    for (let y = 0; y < my.years; y++) {
      const dolden = Object.keys(APIACEAE_WEIGHT).reduce((s, id) => s + (my.areas[id]?.[y] ?? 0) * APIACEAE_WEIGHT[id], 0);
      const share = my.irrHa[y] > 0 ? dolden / my.irrHa[y] : 0;
      if (share > worst) { worst = share; worstY = y; }
    }
    checks.push({
      id: "dolden_pause",
      label: worst > DOLDEN_CAP_DEFAULT + 1e-6
        ? `Doldenblütler-Anbaupause verletzt: ${Math.round(worst * 100)} % Apiaceae (Jahr ${START_YEAR + worstY}) > 20 %`
        : `Doldenblütler-Anbaupause OK (Apiaceae max. ${Math.round(worst * 100)} % ≤ 20 % — Sellerie + ½ Möhre)`,
      passed: worst <= DOLDEN_CAP_DEFAULT + 1e-6,
      maxDeviation: Math.max(0, worst - DOLDEN_CAP_DEFAULT),
      offendingPeriods: [],
      severity: "warning",
    });
  }

  // INTERCOMPANY-ABGLEICH Management-Fee. Die Holding vereinnahmt die Fee als Ertrag
  //  (hold.fee → managementFeeIncome); die OpCo muss denselben Betrag als Aufwand tragen,
  //  sonst entsteht Konzernergebnis aus dem Nichts. Bis 31.07.2026 fehlte die Gegenbuchung
  //  vollständig: 50 T€ im Jahr Ertrag ohne Aufwand — und das, obwohl die Holding sich eine
  //  Verrechnungspreis-Dokumentation für genau diese Fee leistet.
  {
    const feeH = domain.assumptions["hold.fee"]
      ? Math.round(resolveScalar(domain, "hold.fee", domain.baseScenarioId)) : 0;
    const feeO = (domain.overhead ?? [])
      .filter((o) => o.id === HOLDING_FEE_OVERHEAD_ID)
      .reduce((s, o) => s + (o.monthlyCent || 0), 0);
    const diff = Math.abs(feeH - feeO);
    checks.push({
      id: "ic_mgmt_fee",
      label: diff <= 1
        ? `Management-Fee IC abgestimmt (${(feeH / 100).toFixed(0)} €/Monat, Holding-Ertrag = OpCo-Aufwand)`
        : `Management-Fee IC NICHT abgestimmt: Holding ${(feeH / 100).toFixed(0)} €/Monat gegen OpCo ${(feeO / 100).toFixed(0)} €/Monat`,
      passed: diff <= 1,
      maxDeviation: diff / 100,
      offendingPeriods: [],
      severity: "warning",
    });
  }

  // Agronomie-Wächter: fehlende Pflicht-Maßnahmen je angebauter Kultur (Warnung, kein Block).
  {
    const cropsInPlan = [...new Set(domain.anbauplan.map((a) => a.cropId))];
    const allWarn = cropsInPlan.flatMap((cid) => deriveAgronomieWarnings(domain, cid));
    const hasError = allWarn.some((x) => x.severity === "error");
    const cats = [...new Set(allWarn.map((x) => x.category))];
    checks.push({
      id: "agronomie_guard",
      label: allWarn.length === 0
        ? "Agronomie-Wächter OK (alle Pflicht-Maßnahmen je Kultur vorhanden)"
        : `Agronomie-Wächter: ${allWarn.length} Hinweis(e) — fehlt: ${cats.join(", ")}`,
      passed: allWarn.length === 0,
      maxDeviation: allWarn.length,
      offendingPeriods: [],
      severity: hasError ? "error" : "warning",
    });
  }
  return checks;
}

/** Phase 5 — Saatgut/Pflanzgut: Menge/ha (natürliche Einheit) × Preis-Assumption seed.<crop>. */
const SEED_PROGRAM: Record<CropId, { qty: number; unit: string }> = {
  weizen: { qty: 220, unit: "kg" }, gerste_zw: { qty: 180, unit: "kg" }, soja_luzerne: { qty: 75, unit: "kg" },
  winterraps: { qty: 1.8, unit: "Einh." }, mais: { qty: 1.0, unit: "Einh." }, tomate: { qty: 25, unit: "×1000 Pfl." },
  kartoffel_pommes: { qty: 2.8, unit: "t" }, kartoffel_chips: { qty: 3.0, unit: "t" }, zwiebel_moehre: { qty: 1, unit: "ha-Satz" },
  // Sellerie: 45–50 T Pfl./ha (50×40 cm) — Standard Frischmarkt-Kaliber 500–1.000 g.
  suesskartoffel: { qty: 30, unit: "×1000 Slips" }, knoblauch: { qty: 900, unit: "kg" }, knollensellerie: { qty: 50, unit: "×1000 Pfl." },
  weizen_dry: { qty: 200, unit: "kg" }, gerste_dry: { qty: 170, unit: "kg" }, raps_dry: { qty: 1.8, unit: "Einh." },
  sonnenblume: { qty: 0.5, unit: "Einh." },
};
/** Phase 5 — Bewässerungsnorm mm/ha je Kultur (Süd-Oltenien; Weizen/Mais belegt, übrige abgeleitet). */
const BEWAESSERUNG_MM: Record<CropId, number> = {
  weizen: 175, gerste_zw: 110, soja_luzerne: 150, winterraps: 130, mais: 200,
  tomate: 550, kartoffel_pommes: 380, kartoffel_chips: 380, zwiebel_moehre: 330,
  suesskartoffel: 300, knoblauch: 150, knollensellerie: 350,
  weizen_dry: 0, gerste_dry: 0, raps_dry: 0, sonnenblume: 0,
};

function buildCropOps(cropId: CropId): OpSeed[] {
  const cal = CROP_CAL[cropId];
  const c = AGRO_COSTS[cropId];
  const one = (label: string, ct: CostType, val: number): OpLineSeed[] => [L(label, ct, val, "price.per_euro")];
  const seed = SEED_PROGRAM[cropId];
  const mm = BEWAESSERUNG_MM[cropId];
  // Phase 4: je Gabe eine Zeile JE NÄHRSTOFF (Menge kg × Preis-Assumption fert.*) → Menge × Preis transparent.
  //  Alle Zeilen EINER Gabe teilen sich eine stabile Maßnahmen-ID (mid) für den FMS-Abgleich.
  const duengLines: OpLineSeed[] = [];
  DUENGUNG_PROGRAM[cropId].forEach((g, gi) => {
    const kN = g.fert ? "fert.n_fert" : "fert.n";
    const kP = g.fert ? "fert.p_fert" : "fert.p";
    const kK = g.fert ? "fert.k_fert" : "fert.k";
    const mid = `${cropId}::dueng::${gi}`;
    if (g.n) duengLines.push({ ...L(`${g.label} · N`, "fertilizer", g.n, kN, "kg N/ha"), mid });
    if (g.p) duengLines.push({ ...L(`${g.label} · P₂O₅`, "fertilizer", g.p, kP, "kg P₂O₅/ha"), mid });
    if (g.k) duengLines.push({ ...L(`${g.label} · K₂O`, "fertilizer", g.k, kK, "kg K₂O/ha"), mid });
    if (g.s) duengLines.push({ ...L(`${g.label} · S`, "fertilizer", g.s, "fert.s", "kg S/ha"), mid });
  });
  // PSM: je Überfahrt Mittelkosten €/ha (editierbar). Wirkstoffe im Label (EU/RO zugelassen 2025/26).
  const psmLines: OpLineSeed[] = PSM_PROGRAM[cropId].map((p, pi) =>
    ({ ...L(p.label, "crop_protection", p.eurHa, "psm.per_euro", "€/ha (Mittel)"), passes: p.passes ?? 1, mid: `${cropId}::psm::${pi}` }));
  return [
    { code: "OP-SAAT",  label: "Saatgut/Pflanzgut",           costPeriods: [clampP(cal.plant)],     lines: [{ ...L(`Saatgut/Pflanzgut (Saatstärke)`, "seed", seed.qty, `seed.${cropId}`, `${seed.unit}/ha`), mid: `${cropId}::saat` }] },
    { code: "OP-DUENG", label: "Düngung (Gaben)",             costPeriods: [clampP(cal.dueng ?? cal.plant + 1)], lines: duengLines },
    { code: "OP-PSM",   label: "Pflanzenschutz (BBCH)",       costPeriods: [clampP(cal.psm ?? cal.plant + 2)], lines: psmLines },
    { code: "OP-BEREG", label: "Bewässerung (mm × €/mm·ha)",  costPeriods: [clampP(cal.bereg ?? cal.plant + 3)], lines: [{ ...L(`Bewässerung`, "other", mm, "irrig.eur_mm", "mm/ha"), mid: `${cropId}::bereg` }] },
    { code: "OP-MAT",   label: "Material/Lager",              costPeriods: cal.harvest.slice(),     lines: [{ ...L("Material/Lager", "other", c[4], "price.per_euro", "€/ha"), mid: `${cropId}::mat` }] },
    { code: "OP-HAND",  label: "Handarbeit (nicht-maschinell)", costPeriods: cal.harvest.slice(),   lines: [{ ...L("Handarbeit", "labor", c[5], "price.per_euro", "€/ha"), mid: `${cropId}::hand` }] },
  ];
}

const CROP_IDS: CropId[] = [
  "weizen", "gerste_zw", "soja_luzerne", "winterraps", "mais", "tomate",
  "kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre",
  "suesskartoffel", "knoblauch", "knollensellerie",
  "weizen_dry", "gerste_dry", "raps_dry", "sonnenblume",
];

/** Wertkulturen (Beregnung/Gemüse, hoher DB) vs. Break Crops (Getreide/Ölsaat der Rotation). */
export const VALUE_CROP_IDS: string[] = ["tomate", "kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre", "suesskartoffel", "knoblauch", "knollensellerie"];
export const BREAK_CROP_IDS: string[] = ["weizen", "gerste_zw", "soja_luzerne", "winterraps", "mais", "weizen_dry", "gerste_dry", "raps_dry", "sonnenblume"];
/** Lagerpflichtige Kulturen (Packhaus/Kühl-/CA-Lager). Industrietomate → direkt zum Verarbeiter
 *  (keine Einlagerung); Getreide → Silo/Direktverkauf. Nur Kartoffel + Zwiebel/Möhre. */
export const STORAGE_CROP_IDS: string[] = ["kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre", "suesskartoffel", "knoblauch", "knollensellerie"];

/** ARBEITSKATALOG der App — NUR die Wertkulturen. Die Stammdaten der übrigen Kulturen
 *  (Ackerbau, Trockenrotation, Sonnenblume) bleiben vollständig im Modell hinterlegt:
 *  CROP_CAL, CROP_NAME, AGRO_COSTS, ARBEITSGAENGE, OVERHEAD_PER_HA und die yield./price./loss.-
 *  Annahmen sind unverändert da und jederzeit reaktivierbar. Sie erscheinen nur nicht mehr in
 *  Anbauplan, Maßnahmen, Kalkulation, Contribution und Produktkatalog — dort würden sie eine
 *  Betriebsstruktur zeigen, die das Solo-Modell nicht mehr hat. */
/** Bruchkulturen der Rotation. Sie belegen Flaeche und kosten Pacht, aber sie
 *  erscheinen NICHT im Arbeitskatalog: NEOS FX rechnet nur Wertkulturen, und fuer
 *  Cash Crops wird keine eigene Technik vorgehalten (Vorgabe Betrieb 03.08.2026).
 *  Ihre Bestellung laeuft ueber Lohnarbeit — sie duerfen deshalb weder in die
 *  Maschinenbemessung noch in den CAPEX eingehen. */
export const ROTATION_CROP_IDS: string[] = ["weizen", "gerste_zw", "sonnenblume", "soja_luzerne", "mais"];

const CATALOG: CatalogEntry[] = CROP_IDS
  .filter((cropId) => VALUE_CROP_IDS.includes(cropId))
  .map((cropId) => ({
  cropId,
  name: CROP_NAME[cropId],
  type: "annual",
  yieldKey: `yield.${cropId}`,
  priceKey: `price.${cropId}`,
  lossKey: `loss.${cropId}`,
  qualityKey: `qual.${cropId}`,
  plantingPeriod: CROP_CAL[cropId].plant,
  harvestPeriods: CROP_CAL[cropId].harvest.slice(),
  ops: buildCropOps(cropId),
}));

/* --------------------------------------------------------------------------
 * MASCHINEN-KATALOG — Feldmaschinen (Referenz B/D, Delta 21.07.) + Beregnung + Lager.
 *  Per-Stunde-Werte in CENT. C_eff (ha/h) und fleetStage1 aus Referenz.
 *  Delta: Kartoffel-Kette auf One-Pass umgestellt (kartlege/dammhaeufl/karternte
 *  ersetzt durch onepass + roder_ropa; CAPEX-only-Träger 8RX/6R/Radlader/Shuttle).
 * ------------------------------------------------------------------------ */
type Spec = {
  id: string; label: string; priceKey: string; cat: "gezogen" | "selbstf";
  neupreis: number; nutzung: number; hJ: number; restw: number; dieselLh: number;
  afa: number; zins: number; vers: number; rep: number; schmier: number;
  cEff: number; fleet: number;
  // Optionale reale TCO-Overrides (Rabatt/Restwert/Service) — analog CAPEX-only-Träger.
  discountPct?: number; residualPctList?: number; serviceRateKey?: string;
  /** Bestand: bereits im Betrieb vorhandene Einheiten (kein Neu-CAPEX/keine Finanzierung). */
  owned?: number;
  /** 48-m-Paket-Gate (s. MachineType.activeWhen). */
  activeWhen?: "base" | "boom48";
  /** Zugmaschine (Traktor-id) für gezogene Geräte — Zuordnung/Anzeige. */
  tractorId?: string;
};
const SPEC: Spec[] = [
  // Boden/Saat auf reale GROSSE Arbeitsbreiten (Bestand 12 m; Drille 9–12 m) → höhere C_eff,
  // damit weniger Einheiten (Phase 2). Preise mprice.* = Platzhalter, mit 12-m-Angebot zu schärfen (§G).
  // Stage B — Anbaugeräte einzeln (ohne Schlepper); Zugmaschine via tractorId (eigene CAPEX-Position).
  //  Kraftstoff (dieselLh) bleibt am Gerät = lastabhängiger Arbeitsgang-Diesel (physisch aus dem Traktor).
  // AKTUELLES PROGRAMM (Terrano 12 FM seit ~10 J. eingestellt): HORSCH Fortis 6.4 LT —
  //  6,20 m, bis 30 cm Arbeitstiefe, ~435 PS empfohlen (→ 9R 590), Liste ~71.230 € (profi-Test).
  //  cEff = 6,2 m × 8 km/h × 0,72 ÷ 10 ≈ 3,57 ha/h (halbe Schlagkraft ggü. dem alten 12-m-Fantasieprofil).
  { id: "pflug",      label: "Grubber HORSCH Fortis 6.4 LT · bis 30 cm (6,20 m)", priceKey: "mprice.pflug", cat: "gezogen", neupreis: 7200000, nutzung: 10, hJ: 600, restw: 0.25, dieselLh: 22, afa: 1800, zins: 600, vers: 480, rep: 1920, schmier: 260, cEff: 3.57, fleet: 4, tractorId: "zug_9r" },
  { id: "saatbett",   label: "Saatbettkombi Väderstad NZ Extreme · 12,5 m (passiv)",              priceKey: "mprice.saatbett",   cat: "gezogen", neupreis: 7000000, nutzung: 10, hJ: 500, restw: 0.25, dieselLh: 18, afa: 2400, zins: 800, vers: 640, rep: 2240, schmier: 270, cEff: 9.60, fleet: 1, tractorId: "zug_9r" },
  { id: "drille",     label: "Getreidedrille HORSCH Pronto 9 DC · 9,0 m", priceKey: "mprice.drille", cat: "gezogen", neupreis: 13000000, nutzung: 12, hJ: 350, restw: 0.25, dieselLh: 14, afa: 3036, zins: 1214, vers: 971, rep: 2429, schmier: 210, cEff: 6.00, fleet: 1, tractorId: "zug_9r" },
  { id: "einzelkorn", label: "Einzelkorn HORSCH Maestro 24.50 SX · 24 R 50 cm (12,0 m)", priceKey: "mprice.einzelkorn", cat: "gezogen", neupreis: 24000000, nutzung: 12, hJ: 300, restw: 0.25, dieselLh: 12, afa: 3958, zins: 1583, vers: 1267, rep: 3167, schmier: 180, cEff: 4.02, fleet: 2, tractorId: "zug_9r" },
  // FEINGEMÜSE-SÄTECHNIK. Der Maestro ist eine Mais-/Soja-/Raps-Einzelkornsämaschine mit
  //  50 cm Reihenabstand — für Zwiebel und Möhre die falsche Maschine: die werden auf Beeten
  //  in Mehrfachreihen (5–7 cm) gesät. cEff = 5,4 m × 4,5 km/h × 0,65 ÷ 10 = 1,58 ha/h;
  //  Präzisionssaat fährt langsam, das ist der Preis für die Standgenauigkeit.
  { id: "gem_saat",   label: "Beetsämaschine Feingemüse · 3 Beete (5,40 m)", priceKey: "mprice.gem_saat", cat: "gezogen", neupreis: 5500000, nutzung: 12, hJ: 200, restw: 0.25, dieselLh: 8, afa: 1719, zins: 516, vers: 430, rep: 1289, schmier: 120, cEff: 1.58, fleet: 1, tractorId: "ops_6r" },
  // KNOBLAUCH-LEGETECHNIK. Zehen werden gesteckt, nicht gesät — das kann keine Sämaschine.
  //  Pneumatische Legemaschine der Klasse JJ Broch PLNA / Seca SC1: 0,4–0,5 ha/h laut
  //  Herstellerangabe (PLNA-5, 845 l, ab 90 PS). cEff = 1,8 m × 4,6 km/h × 0,60 ÷ 10 = 0,50.
  { id: "knobl_lege", label: "Knoblauch-Legemaschine pneumatisch · 8-reihig (1,80 m)", priceKey: "mprice.knobl_lege", cat: "gezogen", neupreis: 2800000, nutzung: 12, hJ: 150, restw: 0.20, dieselLh: 8, afa: 1244, zins: 373, vers: 311, rep: 933, schmier: 120, cEff: 0.50, fleet: 1, tractorId: "ops_6r" },
  // BESTAND 2× RAUCH AERO GT 36 m (pneum. Balkenstreuer) — decken die Düngung @ Stufe 1.
  { id: "streuer",    label: "Düngerstreuer Bredal K135 gezogen · 36,0 m",  priceKey: "mprice.streuer",    cat: "gezogen", neupreis: 8500000, nutzung: 10, hJ: 400, restw: 0.20, dieselLh: 10, afa: 2800, zins: 840, vers: 700, rep: 1750, schmier: 150, cEff: 18.62, fleet: 1, owned: 0, activeWhen: "base", tractorId: "ops_6r" },
  // spritze14: bleibt der COGS-/Betriebskosten-Träger (Diesel/Rep/Vers/Schmier je ha aus den
  // Arbeitsgängen). fleet: 0 → KEIN CAPEX (der Spritzen-CAPEX kommt fenstergetrieben aus
  // spray_gz/spray_sf, sonst Doppelzählung). Analog zur 8RX/6R-Aufteilung Betrieb↔CAPEX.
  { id: "spritze14",  label: "Feldspritze Leeb-Profil · 36,0 m (Mischpark)", priceKey: "mprice.spritze14",  cat: "selbstf", neupreis: 38000000, nutzung: 12, hJ: 500, restw: 0.25, dieselLh: 18, afa: 4750, zins: 1900, vers: 1520, rep: 4560, schmier: 270, cEff: 24.10, fleet: 0 },
  // FRONTANBAU am Roder (einphasige Ernte): kein eigener Traktor/keine eigene Überfahrt — Stückzahl folgt dem Roder,
  //  der Diesel des Toppers ist in den Roder gefaltet (dieselLh dort +4). CAPEX/AfA bleiben eigenständig.
  { id: "krautschl",  label: "Krautschläger ROPA KS 475 · Frontanbau am Roder (einphasig)", priceKey: "mprice.krautschl",  cat: "gezogen", neupreis: 4500000, nutzung: 10, hJ: 300, restw: 0.20, dieselLh: 0, afa: 5200, zins: 1560, vers: 1300, rep: 3900, schmier: 180, cEff: 0.81, fleet: 2 },
  // Kartoffel One-Pass-Kette (Delta 21.07.). Diesel/Fahrer der Zugschlepper 8RX/6R sind
  // bewusst in die operating€/h von onepass/roder_ropa GEFALTET (dieselLh 40 bzw. 32) —
  // Kalibrierungspunkt; die Träger 8RX/6R/Radlader/Shuttle liefern separat CAPEX+AfA.
  { id: "onepass",    label: "Dewulf CP 42 Smart Float · 4 R (3,0 m)", priceKey: "mprice.onepass",  cat: "gezogen", neupreis: 8000000, nutzung: 10, hJ: 250, restw: 0.20, dieselLh: 40, afa: 3840, zins: 1152, vers: 960, rep: 2880, schmier: 600, cEff: 0.50, fleet: 3, tractorId: "zug_8rx" },
  // ROPA Keiler II: 225.000 € Listenpreis netto (ohne MwSt), mit WD-Triebachse. Regulärer Rabatt-Pfad
  // (globaler tco.discount) → Netto-Einkauf; Restwert über die gezogene Quote (tco.res_trail).
  // ROPA Keiler 2 RK22 = GETEILTER Wurzelernter (Kartoffel + Möhre + Zwiebel + Sellerie). Flotte auf
  // kombinierten Wurzel-Ernte-Peak dimensioniert (Phase 2: 6 @ Stufe 1 statt Kart 3 + Gemüse 7). Bestand 1×.
  // Keiler II hält wertstabil: Wiederverkaufs-/Rücknahmewert nach ~5 J. ~55–65 % der Liste (explizit 60 %,
  //  überschreibt den globalen Anhänger-Default 55 %). Bilanziell: linear auf restw 20 % über 10 J. ⇒ Buchwert
  //  bei 5 J. ~60 %, konsistent. residualPctList treibt die TCO-Effektivkosten (Wertverzehr über die Haltedauer).
  { id: "roder_ropa", label: "Wurzelernter ROPA Keiler 2 · 2 R (1,5 m, einphasig m. Frontkrautschläger)", priceKey: "mprice.roder_ropa", cat: "gezogen", neupreis: 22500000, nutzung: 10, hJ: 300, restw: 0.20, dieselLh: 36, afa: 5333, zins: 1600, vers: 1333, rep: 5333, schmier: 480, cEff: 0.81, fleet: 6, owned: 0, residualPctList: 0.60 },
  { id: "tompflanz",  label: "Pflanzmaschine Checchi & Magli DUAL 12 GOLD · 6 R (3,0 m)", priceKey: "mprice.tompflanz", cat: "gezogen", neupreis: 14000000, nutzung: 10, hJ: 200, restw: 0.20, dieselLh: 10, afa: 6400, zins: 1920, vers: 1600, rep: 4800, schmier: 150, cEff: 0.49, fleet: 5, tractorId: "ops_6r" },
  { id: "tomernte",   label: "Tomaten-Vollernter Guaresi G-89 · 1,8 m",           priceKey: "mprice.tomernte",   cat: "selbstf", neupreis: 45000000, nutzung: 10, hJ: 300, restw: 0.25, dieselLh: 35, afa: 11250, zins: 3750, vers: 3000, rep: 13500, schmier: 525, cEff: 0.66, fleet: 3 },
  // Zwiebel/Möhre-Ernte läuft jetzt über den geteilten ROPA Keiler (s. o.). Alt-Kette bleibt als
  // Alternative im Katalog, aber fleet 0 → kein CAPEX (optional 2-phasig via Schwadleger separat).
  // Gemüse-Ernte AUFGESPLITTET in die realen Einzelmaschinen (statt Sammel-„Kette"):
  //  Zwiebel 2-stufig = Schwadleger (rodet ins Schwad) + Ladeeroder (nimmt auf) · Möhre = Klemmbandroder.
  //  Passes je 0,5 auf zwiebel_moehre (halbe Fläche Zwiebel-Weg, halbe Fläche Möhren-Weg).
  { id: "gem_schwad", label: "Zwiebel-Schwadleger ASA-LIFT WR-180 (1,80 m)", priceKey: "mprice.gem_schwad", cat: "gezogen", neupreis: 9500000, nutzung: 10, hJ: 250, restw: 0.20, dieselLh: 12, afa: 3000, zins: 950, vers: 800, rep: 3200, schmier: 150, cEff: 0.90, fleet: 1, tractorId: "ops_6r" },
  { id: "gem_lader",  label: "Zwiebel-Ladeeroder ASA-LIFT SP-400 (1,50 m Pickup)", priceKey: "mprice.gem_lader", cat: "gezogen", neupreis: 26500000, nutzung: 10, hJ: 250, restw: 0.20, dieselLh: 18, afa: 8500, zins: 2550, vers: 2100, rep: 8500, schmier: 300, cEff: 0.70, fleet: 2, tractorId: "zug_8rx" },
  { id: "gem_moehre", label: "Möhren-Klemmbandroder ASA-LIFT T-300 DF (2-reihig)", priceKey: "mprice.gem_moehre", cat: "gezogen", neupreis: 34000000, nutzung: 10, hJ: 250, restw: 0.20, dieselLh: 20, afa: 10900, zins: 3270, vers: 2720, rep: 10900, schmier: 350, cEff: 0.50, fleet: 2, tractorId: "zug_8rx" },
  // Reale JD-Angebotswerte X9 1100: Liste 1.290.504 € / Rabatt 33,67 % (Netto 856.000) / Restwert 38,12 % v. Liste / Wartung 6,44 €/h.
  // KALIBRIERUNGSPUNKT: Operating-Parameter (Diesel l/h, C_eff/Flächenleistung, h/J) unverändert vom 9-m-Mähdrescher übernommen —
  // C_eff/Diesel des X9 1100 sind real vermutlich höher; separat kalibrieren, sobald Angebotsdaten vorliegen.
  // Alternative S785i tracks (Liste 798.029 / Rabatt 24,2 % / Restwert 43,5 % / Wartung 6,82 €/h) — tracked Variante für
  // Bodenschutz, per gleichem Override-Mechanismus (discountPct/residualPctList/serviceRateKey) einsetzbar; aktuell NICHT aktiv.
  { id: "maehdr",     label: "Mähdrescher JD S7 900 + HD40X 12,19 m (JD-Angebot)", priceKey: "mprice.maehdr", cat: "selbstf", neupreis: 85877800, nutzung: 12, hJ: 350, restw: 0.25, dieselLh: 32, afa: 7143, zins: 2857, vers: 2286, rep: 9143, schmier: 480, cEff: 3.24, fleet: 1,
    discountPct: 0.2489, residualPctList: 0.4309, serviceRateKey: "tco.maehdr.service_h" },
  { id: "transport",  label: "Feldrand-Logistik Kipper 24 t",     priceKey: "mprice.transport",  cat: "gezogen", neupreis: 4000000, nutzung: 10, hJ: 600, restw: 0.25, dieselLh: 15, afa: 1500, zins: 500, vers: 400, rep: 1200, schmier: 225, cEff: 3.00, fleet: 2, tractorId: "ops_6r" },
];

/** CAPEX-only-Träger der One-Pass-Kette (in KEINEM Arbeitsgang; liefern nur CAPEX+AfA).
 *  8RX/6R tragen reale JD-Angebotswerte: Per-Maschine-Rabatt/Restwert + Service-€/h. */
type CapexOnlySpec = {
  id: string; label: string; priceKey: string; cat: "gezogen" | "selbstf"; nutzung: number; restw: number; fleet: number;
  discountPct?: number; residualPctList?: number; serviceRateKey?: string; serviceHoursLike?: string;
  /** Bestand: bereits vorhandene Einheiten (kein Neu-CAPEX/keine Finanzierung). */
  owned?: number;
};
const CAPEX_ONLY_SPEC: CapexOnlySpec[] = [
  // Reale JD-Angebotswerte 9R 590: Liste 700.336 € / Rabatt 35,03 % / Restwert 29,24 % v. Liste.
  // BESTAND 3× — Prime Mover für die 12-m-Boden/Saat/Drille (590-PS-Klasse, ≠ 8RX 410).
  { id: "zug_9r",   label: "Zug JD 8R 410 (Boden/Saat)", priceKey: "mprice.zug_9r", cat: "selbstf", nutzung: 10, restw: 0.25, fleet: 3,
    discountPct: 0.3503, residualPctList: 0.2924, serviceRateKey: "tco.zug_8rx.service_h", serviceHoursLike: "pflug", owned: 0 },
  // Reale JD-Angebotswerte: Liste 686.447 € / Rabatt 36,05 % / Restwert 30,06 % v. Liste / Wartung 2,91 €/h.
  { id: "zug_8rx",  label: "Zug JD 8RX 410",       priceKey: "mprice.zug_8rx",  cat: "selbstf", nutzung: 10, restw: 0.25, fleet: 3,
    discountPct: 0.3605, residualPctList: 0.3006, serviceRateKey: "tco.zug_8rx.service_h", serviceHoursLike: "onepass", owned: 0 },
  // Reale JD-Angebotswerte: Liste 325.094 € (6R 250 +3 %) / Rabatt 31,75 % / Restwert 36,90 % v. Liste / Wartung 2,20 €/h.
  { id: "ops_6r",   label: "Pflege/Ernte JD 6R 260", priceKey: "mprice.ops_6r", cat: "selbstf", nutzung: 10, restw: 0.25, fleet: 3,
    discountPct: 0.3175, residualPctList: 0.3690, serviceRateKey: "tco.ops_6r.service_h", serviceHoursLike: "roder_ropa", owned: 0 },
  { id: "radlader", label: "JCB Radlader",         priceKey: "mprice.radlader", cat: "selbstf", nutzung: 10, restw: 0.25, fleet: 1, owned: 0 },
  { id: "shuttle",  label: "Field-Shuttle 8×8",    priceKey: "mprice.shuttle",  cat: "selbstf", nutzung: 8,  restw: 0.25, fleet: 9, owned: 0 },
  // Ernte-Logistik Kartoffel: Shuttles laden am Feldrand in den DEMA Fieldloader, der die LKW befüllt (→ Lager/Fabrik).
  //  Eine Verladestation je Rode-Linie → Stückzahl folgt dem Roder (s. machineFleetCount). Elektrisch, kein eigener Antrieb.
  { id: "fieldloader", label: "DEMA Fieldloader OL-COMBI (Feldrand-Überladetrichter)", priceKey: "mprice.fieldloader", cat: "gezogen", nutzung: 10, restw: 0.20, fleet: 4, owned: 0 },
  // Straßentransport/Auslieferung — BESTAND 8× (kein Neu-CAPEX; Make-or-Buy vs. Spedition via opex.transport).
  { id: "lkw_sattel", label: "LKW mit Sattelauflieger (Auslieferung)", priceKey: "mprice.lkw_sattel", cat: "selbstf", nutzung: 8, restw: 0.30, fleet: 8, owned: 0 },
];

/** Strukturierte Register-Metadaten je Maschine: Kategorie · Hersteller · Produkt. */
//  Klare Struktur nach Feld-Arbeitsfolge (Bodenbearbeitung → Aussaat/Pflanzung → Düngung →
//  Pflanzenschutz → Ernte) plus Trag-/Infrastruktur-Klassen. Kanonisch via CAT_ORDER sortiert.
const MACHINE_META: Record<string, { category: string; manufacturer: string; product: string }> = {
  zug_9r:      { category: "Zugmaschinen", manufacturer: "John Deere", product: "8R 410 (Rad, 411 PS)" },
  zug_8rx:     { category: "Zugmaschinen", manufacturer: "John Deere", product: "8RX 410" },
  ops_6r:      { category: "Zugmaschinen", manufacturer: "John Deere", product: "6R 260" },
  pflug:       { category: "Bodenbearbeitung", manufacturer: "HORSCH", product: "Fortis 6.4 LT · Universalgrubber bis 30 cm (6,20 m)" },
  // GERAETEWECHSEL 31.07.2026: Der HORSCH Cruiser 12 XL verlangt laut Herstellerprospekt
  //  500-600 PS — das IST die 9R-590-Klasse und haette den Wechsel auf den 8R 410 unmoeglich
  //  gemacht. Die passive Zinken-Saatbettkombi derselben Breite braucht laut Vaederstad
  //  300-500 PS und wird vom 8R 410 gezogen.
  saatbett:    { category: "Bodenbearbeitung", manufacturer: "Väderstad", product: "NZ Extreme 1250 · passive Saatbettkombination 12,5 m (300–500 PS)" },
  sc360:       { category: "Bodenbearbeitung", manufacturer: "Dewulf", product: "SC-Front Frontfräse (Kartoffelbeet)" },
  drille:      { category: "Aussaat & Pflanzung", manufacturer: "HORSCH", product: "Getreidedrille Pronto 9 DC · 9,0 m" },
  einzelkorn:  { category: "Aussaat & Pflanzung", manufacturer: "HORSCH", product: "Maestro 24.50 SX · 24-reihig 50 cm (12,0 m)" },
  gem_saat:    { category: "Aussaat & Pflanzung", manufacturer: "Agricola-Klasse", product: "Beetsämaschine Feingemüse · 3 Beete (5,40 m) — Zwiebel/Möhre" },
  knobl_lege:  { category: "Aussaat & Pflanzung", manufacturer: "JJ-Broch-/Seca-Klasse", product: "Knoblauch-Legemaschine pneumatisch · 8-reihig (1,80 m), 0,4–0,5 ha/h" },
  onepass:     { category: "Aussaat & Pflanzung", manufacturer: "Dewulf", product: "CP 42 Becherlegemaschine · 4-reihig (3,0 m)" },
  tompflanz:   { category: "Aussaat & Pflanzung", manufacturer: "Checchi & Magli", product: "Pflanzmaschine DUAL 12 GOLD · 6-reihig (3,0 m)" },
  streuer:     { category: "Düngung", manufacturer: "Bredal", product: "Düngerstreuer K135 · gezogen 36 m (Bestand 2×)" },
  // KOSTENPROFIL, keine eigene Maschine: fasst den realen Mischpark (TD 12 gezogen + PT SF, je 36 m)
  //  für Arbeitsgänge/€-Sätze zusammen — die ECHTEN Spritzen stehen als eigene Register-Zeilen darunter.
  spritze14:   { category: "Pflanzenschutz", manufacturer: "—", product: "Spritzen-KOSTENPROFIL 36 m (Mischpark TD 12 + PT — keine eigene Maschine)" },
  // Mechanisches Krautschlagen = Ernte-Vorbereitung (Abreife/Rodung), NICHT Pflanzenschutz
  //  (das wäre nur die chemische Sikkation). Kategorie daher „Ernte".
  krautschl:   { category: "Ernte", manufacturer: "ROPA", product: "KS 475 Krautschläger · Frontanbau am Keiler 2 (einphasige Rodung)" },
  maehdr:      { category: "Ernte", manufacturer: "John Deere", product: "Mähdrescher S7 900 + Bandschneidwerk HD40X (12,19 m)" },
  tomernte:    { category: "Ernte", manufacturer: "Guaresi", product: "Tomaten-Vollernter G-89 · 1,8 m" },
  roder_ropa:  { category: "Ernte", manufacturer: "ROPA", product: "Keiler 2 RK22 · 2-reihig, einphasig m. Frontkrautschläger (Kartoffel/Süßkartoffel)" },
  gem_schwad:  { category: "Ernte", manufacturer: "ASA-LIFT", product: "WR-180 Zwiebel-Schwadleger (1,80 m)" },
  gem_lader:   { category: "Ernte", manufacturer: "ASA-LIFT", product: "SP-400 Zwiebel-Ladeeroder (1,50 m Pickup)" },
  gem_moehre:  { category: "Ernte", manufacturer: "ASA-LIFT", product: "T-300 DF Möhren-Klemmbandroder (2-reihig)" },
  transport:   { category: "Transport", manufacturer: "—", product: "Kipper / Anhänger" },
  shuttle:     { category: "Transport", manufacturer: "—", product: "Field-Shuttle 8×8 (Überladewagen, Bunker → Fieldloader)" },
  fieldloader: { category: "Transport", manufacturer: "DEMA", product: "Fieldloader OL-COMBI · Feldrand-Überladetrichter, 9-m-Elevator (Shuttle → LKW)" },
  lkw_sattel:  { category: "Logistik", manufacturer: "—", product: "LKW mit Sattelauflieger" },
  radlader:    { category: "Hoftechnik", manufacturer: "JCB", product: "Radlader" },
  irrig:       { category: "Bewässerung", manufacturer: "Valley / Reinke / Bauer", product: "Pivot-Bewässerung" },
  store:       { category: "Gebäude & Infrastruktur", manufacturer: "—", product: "Lager / Packhaus" },
};

/** Leistungsdaten-Seed je Maschine: Arbeitsbreite (m), Feldeffizienz (0..1), Feldtage.
 *  Fahrgeschwindigkeit wird so gesetzt, dass Breite×Geschw×Eff÷10 = hinterlegtes C_eff (exakt).
 *  Alle Werte editierbar in der Maschinen-Werkbank. Selbstfahrer-Ernter: „Breite" = eff. Aufnahme-/
 *  Schneidbreite, Eff niedriger (Durchsatzgrenze). Feldtage = bearbeitbare Tage im kritischen Fenster. */
const MACHINE_KIN: Record<string, { w: number; eff: number; feldTage: number }> = {
  pflug: { w: 6.2, eff: 0.72, feldTage: 24 }, saatbett: { w: 12, eff: 0.80, feldTage: 30 },
  drille: { w: 9, eff: 0.75, feldTage: 30 }, einzelkorn: { w: 12, eff: 0.70, feldTage: 23 },
  gem_saat: { w: 5.4, eff: 0.65, feldTage: 20 }, knobl_lege: { w: 1.8, eff: 0.60, feldTage: 25 },
  streuer: { w: 36, eff: 0.72, feldTage: 41 }, spritze14: { w: 36, eff: 0.75, feldTage: 0 },
  krautschl: { w: 3, eff: 0.80, feldTage: 16 }, onepass: { w: 3, eff: 0.75, feldTage: 31 },
  roder_ropa: { w: 1.5, eff: 0.90, feldTage: 18 }, tompflanz: { w: 3, eff: 0.80, feldTage: 18 },
  tomernte: { w: 1.8, eff: 0.85, feldTage: 24 }, maehdr: { w: 12.19, eff: 0.45, feldTage: 97 },
  transport: { w: 6, eff: 0.70, feldTage: 44 },
  gem_schwad: { w: 1.8, eff: 0.75, feldTage: 20 }, gem_lader: { w: 1.5, eff: 0.70, feldTage: 20 },
  gem_moehre: { w: 1.5, eff: 0.70, feldTage: 28 },
};
const kinSpeed = (id: string, cEff: number) => { const k = MACHINE_KIN[id]; return k ? (cEff * 10) / (k.w * k.eff) : undefined; };

const FIELD_MACHINES: MachineType[] = SPEC.map((s) => ({
  id: s.id,
  label: s.label,
  widthM: MACHINE_KIN[s.id]?.w,
  fieldEff: MACHINE_KIN[s.id]?.eff,
  speedKmh: kinSpeed(s.id, s.cEff),
  windowDays: MACHINE_KIN[s.id]?.feldTage || undefined,
  category: MACHINE_META[s.id]?.category,
  manufacturer: MACHINE_META[s.id]?.manufacturer,
  productName: MACHINE_META[s.id]?.product,
  unitPriceKey: s.priceKey,
  mode: "fixedFleet",
  driver: { kind: "total" },
  assetClass: "machinery",
  afaCommercialYears: s.nutzung,
  afaFiscalYears: Math.max(1, s.nutzung - 1), // steuerlich 1 Jahr kürzer → latente Steuer
  fleetStage1: s.fleet,
  cEff: s.cEff,
  haPerHour: s.cEff,
  restwertPct: s.restw,
  nutzungYears: s.nutzung,
  refHoursPerYear: s.hJ,
  dieselLPerHour: s.dieselLh,
  afaPerHourCent: s.afa,
  interestPerHourCent: s.zins,
  insurancePerHourCent: s.vers,
  repairPerHourCent: s.rep,
  lubePerHourCent: s.schmier,
  cat: s.cat,
  discountPct: s.discountPct,
  residualPctList: s.residualPctList,
  serviceRateKey: s.serviceRateKey,
  ownedUnits: s.owned,
  activeWhen: s.activeWhen,
  tractorId: s.tractorId,
}));

// BESTAND = 0 (Entscheidung 31.07.2026): NEOTERRA startet 2027 ohne eigene Technik. Vorher trug
// das Register 18 Einheiten aus dem Kombimodell — die CAPEX kapitalisierte dann den GANZEN Park
// (rund 2,3 Mio € für Maschinen, die angeblich schon da waren), während die Eröffnungsbilanz
// null Sachanlagen auswies. Beides zusammen ging nicht auf. Jetzt ist beides konsistent:
// kein Bestand, keine Sachanlage, die CAPEX kauft die Flotte im jeweiligen Bedarfsjahr.

// CAPEX-only-Träger: feste Flotte, aber ohne cEff/Arbeitsgang (keine COGS-/Stundenkosten).
const CAPEX_ONLY_MACHINES: MachineType[] = CAPEX_ONLY_SPEC.map((s) => ({
  id: s.id,
  label: s.label,
  category: MACHINE_META[s.id]?.category,
  manufacturer: MACHINE_META[s.id]?.manufacturer,
  productName: MACHINE_META[s.id]?.product,
  unitPriceKey: s.priceKey,
  mode: "fixedFleet",
  driver: { kind: "total" },
  assetClass: "machinery",
  afaCommercialYears: s.nutzung,
  afaFiscalYears: Math.max(1, s.nutzung - 1),
  fleetStage1: s.fleet,
  restwertPct: s.restw,
  nutzungYears: s.nutzung,
  cat: s.cat,
  discountPct: s.discountPct,
  residualPctList: s.residualPctList,
  serviceRateKey: s.serviceRateKey,
  serviceHoursLike: s.serviceHoursLike,
  ownedUnits: s.owned,
}));

/** Delta 21.07. (2): Spritzen-Mischpark — fenstergetriebene Flotte (Mehrkultur-Sommerpeak).
 *  Kein Arbeitsgang (Betrieb läuft über spritze14-Profil); nur CAPEX/TCO. Count aus
 *  deriveSprayFleet, nicht aus fleetStage1. Restwert über globale tco.res_trail/res_self je cat. */
const SPRAY_MACHINES: MachineType[] = [
  { id: "spray_gz", label: "Feldspritze gezogen HORSCH Leeb TD 12 (12.000 l)", unitPriceKey: "mprice.spray_gz",
    category: "Pflanzenschutz", manufacturer: "HORSCH Leeb", productName: "TD 12 gezogen (12.000 l)",
    mode: "fixedFleet", driver: { kind: "total" }, assetClass: "machinery",
    afaCommercialYears: 10, afaFiscalYears: 9, fleetStage1: 0, restwertPct: 0.30, nutzungYears: 10,
    cat: "gezogen", sprayPart: "gz",
    widthM: 36, speedKmh: 8.93, fieldEff: 0.75, cEff: 24.1, tractorId: "zug_8rx" },
  // BESTAND 3× HORSCH Leeb 8.300 PT (8.000-l-Klasse, SF) — decken den fenstergetriebenen SF-Bedarf @ Stufe 1.
  { id: "spray_sf", label: "Feldspritze SF HORSCH Leeb 8.300 PT (8.000-l-Klasse)", unitPriceKey: "mprice.spray_sf",
    category: "Pflanzenschutz", manufacturer: "HORSCH Leeb", productName: "PT 8.300 Selbstfahrer",
    mode: "fixedFleet", driver: { kind: "total" }, assetClass: "machinery",
    afaCommercialYears: 10, afaFiscalYears: 9, fleetStage1: 0, restwertPct: 0.30, nutzungYears: 10,
    cat: "selbstf", sprayPart: "sf", ownedUnits: 0,
    widthM: 36, speedKmh: 8.93, fieldEff: 0.75, cEff: 24.1 },
];

const MACHINE_CATALOG: MachineType[] = [
  ...FIELD_MACHINES,
  ...CAPEX_ONLY_MACHINES,
  ...SPRAY_MACHINES,
  // Zweiter Streuer im Bestand: RAUCH AERO GT 60.1 (36 m, pneum. Balken) — Reserve/Präzisions-N
  //  neben den 2× Bredal K135. Bestand-only (fleetStage1 0, kein Arbeitsgang → keine Doppelzählung
  //  der Düngearbeit; erscheint im Register mit Bestandswert, erzeugt keine Neu-Investition).
  { id: "streuer_rauch", label: "Düngerstreuer RAUCH AERO GT 60.1 gezogen · 36 m", productName: "AERO GT 60.1 · 36 m (Bestand)",
    category: "Düngung", manufacturer: "RAUCH", priceCent: 8500000,
    mode: "fixedFleet", driver: { kind: "total" }, assetClass: "machinery",
    afaCommercialYears: 10, afaFiscalYears: 9, fleetStage1: 0, restwertPct: 0.20, nutzungYears: 10,
    cat: "gezogen", cEff: 18.62, ownedUnits: 0, tractorId: "ops_6r",
    widthM: 36, speedKmh: 7.18, fieldEff: 0.72 },
  // 48-m-Paket (nur aktiv bei farm.boom48=1): Streuer-Swap AERO GT → HORSCH Leeb Xeric 14 FS (48 m)
  // + Umrüst-CAPEX (48-m-Gestänge auf PT/TD + Fahrgassen-Terminal). Boden/Saat/Drusch (12 m) bleiben.
  { id: "streuer_xeric", label: "Düngerstreuer HORSCH Leeb Xeric 14 FS (48 m)", unitPriceKey: "mprice.streuer_xeric",
    category: "Düngung", manufacturer: "HORSCH Leeb", productName: "Xeric 14 FS (48 m)",
    mode: "fixedFleet", driver: { kind: "total" }, assetClass: "machinery",
    afaCommercialYears: 10, afaFiscalYears: 9, fleetStage1: 1, restwertPct: 0.30, nutzungYears: 10,
    cat: "gezogen", cEff: 18.62, haPerHour: 18.62, ownedUnits: 0, activeWhen: "boom48",
    widthM: 48, speedKmh: 7.18, fieldEff: 0.54 },
  { id: "boom48_retrofit", label: "48-m-Paket: Gestänge-Umrüstung PT/TD + Fahrgassen-Terminal", unitPriceKey: "mprice.boom48_pkg",
    category: "Pflanzenschutz", manufacturer: "HORSCH Leeb", productName: "48-m-Gestänge-Umrüstung + Terminal",
    mode: "fixedFleet", driver: { kind: "total" }, assetClass: "machinery",
    afaCommercialYears: 8, afaFiscalYears: 7, fleetStage1: 1, restwertPct: 0.20, nutzungYears: 8,
    cat: "selbstf", ownedUnits: 0, activeWhen: "boom48" },
  // Kartoffel-Pflanzkomplex — SC360 Strip-Till (Beetformer) als eigene CAPEX-Position (im One-Pass
  //  mit CP42 gezogen; Feld-Operation/Diesel liegt auf onepass=CP42, daher hier kein cEff/Arbeitsgang).
  { id: "sc360", label: "Dewulf SC-Front Frontfräse", productName: "SC-Front Frontfräse (Kartoffelbeet)",
    category: "Bodenbearbeitung", manufacturer: "Dewulf", unitPriceKey: "mprice.sc360",
    mode: "fixedFleet", driver: { kind: "total" }, assetClass: "machinery",
    afaCommercialYears: 10, afaFiscalYears: 9, fleetStage1: 3, restwertPct: 0.20, nutzungYears: 10, cat: "gezogen", tractorId: "zug_8rx" },
  // IoT / Digitalisierung: als editierbare Position in der Maschinen-Jahres-Planung (CAPEX_PLAN_SEED),
  //  nicht mehr als Katalog-Maschine — Kategorie/AfA/Jahr dort frei planbar.
  { id: "irrig", label: "Bewässerung/Pivot", unitPriceKey: "mprice.irrig_perha",
    category: "Bewässerung", manufacturer: "Valley / Reinke / Bauer", productName: "Pivot-Bewässerung",
    mode: "perHa", driver: { kind: "irrigated" }, assetClass: "irrigation",
    afaFiscalYears: 14, afaCommercialYears: 15, insurancePct: 0.008 },
  // Lager GETRENNT nach Hülle und Technik. Vorher lief beides als ein Posten mit
  //  assetClass 'buildings' und 20/25 Jahren. Das war in drei Punkten falsch:
  //  (1) Kältetechnik und Pack-/Sortierlinien sind nach 8–15 Jahren erneuerungsbedürftig,
  //      nicht nach 25 — die Ersatzinvestition wurde um über ein Jahrzehnt zu spät geplant;
  //  (2) sie sind `echipamente tehnologice` und qualifizieren damit für die RO-Reinvestitions-
  //      befreiung (Art. 22), die nur für machinery/irrigation greift — als 'buildings' ging
  //      die Steuerbefreiung verloren;
  //  (3) Hülle und Technik skalieren unterschiedlich (Bau je m², Technik je t).
  { id: "store", label: "Lager/Packhaus — Hülle & Bau", unitPriceKey: "mprice.store_pert",
    category: "Gebäude & Infrastruktur", manufacturer: "—", productName: "Lager / Packhaus (Bau)",
    mode: "perTonne", driver: { kind: "crops", ids: STORAGE_CROP_IDS, peakConcurrent: true }, assetClass: "buildings",
    afaFiscalYears: 20, afaCommercialYears: 25, insurancePct: 0.008 },
  { id: "store_tech", label: "Lager/Packhaus — Technik", unitPriceKey: "mprice.store_tech_pert",
    category: "Gebäude & Infrastruktur", manufacturer: "—", productName: "Kälte · Belüftung · Sortier-/Packlinien",
    mode: "perTonne", driver: { kind: "crops", ids: STORAGE_CROP_IDS, peakConcurrent: true }, assetClass: "machinery",
    afaFiscalYears: 10, afaCommercialYears: 12, insurancePct: 0.008 },
];

/* --------------------------------------------------------------------------
 * LOHNARBEIT — Dienstleistungs-Einkauf je Kultur und Arbeitsgang.
 *  Sätze in €/ha und ÜBERFAHRT, OHNE Kraftstoff, MIT Fahrer.
 *  Anker: Landwirtschaftskammer NRW, „Erfahrungssätze für Maschinenring-Arbeiten" (2024) —
 *  dort steht jede Position getrennt „ohne" und „mit Kraftstoff"; übernommen ist die
 *  Spalte OHNE, weil der Diesel bei uns bleibt. Positionen ohne öffentlichen Anker
 *  (Tomaten-Vollernter, Zwiebel-/Möhrentechnik, Setzling-Pflanzung, Feldrand-Logistik)
 *  sind als Schätzung markiert und ausdrücklich zu kalibrieren.
 *  Rumänien liegt beim Lohnanteil unter Deutschland — dafür gibt es den globalen
 *  Regler `lohn.factor` (Basis 1,0 = deutsche Erfahrungssätze).
 *  ALLE Einträge stehen auf active: false. Nichts wirkt, bis es im Register
 *  scharfgeschaltet wird.
 * ------------------------------------------------------------------------ */
type LohnSatz = { m: string; gruppe: LohnarbeitEntry["gruppe"]; label: string; eurHa: number; quelle: string };
const LWK = "LWK NRW Erfahrungssätze 2024 · ohne Kraftstoff, mit Fahrer";
const SCHAETZ = "Schätzung — kein öffentlicher Anker, zu kalibrieren";
const LOHN_SAETZE: LohnSatz[] = [
  { m: "pflug",       gruppe: "boden",       label: "Grundbodenbearbeitung (Grubber)", eurHa: 45,  quelle: LWK + " (Grubber 3 m flach 29 €, auf 6,2 m/tief hochgerechnet)" },
  { m: "saatbett",    gruppe: "boden",       label: "Saatbettbereitung",               eurHa: 28,  quelle: LWK + " (Saatbettkombination 4 m 33 €, auf 12 m gerechnet)" },
  { m: "onepass",     gruppe: "pflanzung",   label: "Kartoffeln legen",                eurHa: 90,  quelle: LWK + " (Kartoffellegemaschine 4-reihig)" },
  { m: "einzelkorn",  gruppe: "pflanzung",   label: "Einzelkornsaat",                  eurHa: 40,  quelle: LWK + " (Einzelkornsägerät 12-reihig 55,50 €, auf 24 R gerechnet)" },
  { m: "gem_saat",    gruppe: "pflanzung",   label: "Beetsaat Zwiebel/Möhre",          eurHa: 95,  quelle: SCHAETZ },
  { m: "knobl_lege",  gruppe: "pflanzung",   label: "Knoblauch stecken",               eurHa: 320, quelle: SCHAETZ },
  { m: "tompflanz",   gruppe: "pflanzung",   label: "Setzling-Pflanzung",              eurHa: 220, quelle: SCHAETZ },
  { m: "streuer",     gruppe: "psm_duenger", label: "Düngerstreuen",                   eurHa: 13,  quelle: LWK + " (Schleuderstreuer 1000 l)" },
  { m: "spritze14",   gruppe: "psm_duenger", label: "Pflanzenschutz",                  eurHa: 14,  quelle: LWK + " (Feldspritze 1000 l 17,50 €, auf 36 m gerechnet)" },
  { m: "roder_ropa",  gruppe: "ernte",       label: "Rodung (Bunkerroder)",            eurHa: 435, quelle: LWK + " (Kartoffelbunkerroder 2-reihig)" },
  { m: "tomernte",    gruppe: "ernte",       label: "Tomaten-Vollernte",               eurHa: 600, quelle: SCHAETZ },
  { m: "gem_schwad",  gruppe: "ernte",       label: "Zwiebel schwaden",                eurHa: 120, quelle: SCHAETZ },
  { m: "gem_lader",   gruppe: "ernte",       label: "Zwiebel laden/roden",             eurHa: 260, quelle: SCHAETZ },
  { m: "gem_moehre",  gruppe: "ernte",       label: "Möhren-/Sellerierodung",          eurHa: 320, quelle: SCHAETZ },
  { m: "transport",   gruppe: "ernte",       label: "Feldrand-Logistik",               eurHa: 60,  quelle: SCHAETZ },
];

/** Erzeugt für jede (Kultur × Arbeitsgang)-Kombination eine Lohnarbeits-Zeile, alle inaktiv. */
function buildLohnarbeit(): LohnarbeitEntry[] {
  const byM = new Map(LOHN_SAETZE.map((x) => [x.m, x]));
  const out: LohnarbeitEntry[] = [];
  for (const cid of Object.keys(SKALIERUNG_HA)) {
    for (const g of ARBEITSGAENGE[cid as CropId] ?? []) {
      const sz = byM.get(g.m);
      if (!sz) continue;
      out.push({
        id: `lohn-${cid}-${g.m}`, cropId: cid, machineId: g.m,
        label: sz.label, gruppe: sz.gruppe,
        ratePerHaCent: Math.round(sz.eurHa * 100),
        dieselIncluded: false, active: false, quelle: sz.quelle,
      });
    }
  }
  return out;
}

/** Setzt die Fläche EINER Kultur in EINEM Planjahr (Mutator auf einem Domänen-Entwurf).
 *
 *  Zwei Dinge müssen zusammenbleiben, sonst rechnet das Modell auseinander:
 *   · cropPolicy[cropId].haByYear — die Flächenkurve, aus der deriveCropAreasMY die Jahre ab 1 zieht,
 *   · anbauplan[].areaHa für JAHR 0 — die Bemessungsgrundlage für Maschinenpark, Lager und
 *     Beregnung. Bliebe sie stehen, würde für eine Fläche dimensioniert, die im Startjahr gar
 *     nicht bewirtschaftet wird.
 *  Mehrere Anbauplan-Zeilen derselben Kultur werden gleichmäßig bedient, Rundungsrest auf die letzte. */
export function setCropPathHa(d: Domain, cropId: string, y: number, haIn: number, years: number): void {
  const ha = Math.max(0, Math.round(haIn));
  const cur = d.cropPolicy?.[cropId];
  const areas = deriveCropAreasMY(d).areas;
  const path: number[] = Array.from({ length: years }, (_, i) => {
    const hb = cur?.haByYear;
    if (hb?.length) return hb[Math.min(i, hb.length - 1)] ?? 0;
    return Math.round(areas[cropId]?.[Math.min(i, (areas[cropId]?.length ?? 1) - 1)] ?? 0);
  });
  path[Math.max(0, Math.min(years - 1, y))] = ha;
  d.cropPolicy = { ...(d.cropPolicy ?? {}), [cropId]: { ...(cur ?? {}), mode: "path", haByYear: path } };
  if (y === 0) {
    const rows = d.anbauplan.filter((a) => a.cropId === cropId);
    if (rows.length) {
      const per = Math.round(ha / rows.length);
      rows.forEach((a, i) => { a.areaHa = i === rows.length - 1 ? ha - per * (rows.length - 1) : per; });
    }
  }
}

/** Lässt eine Kultur linear vom Start- auf den Zielwert hochlaufen (beide bleiben stehen). */
export function rampCropPath(d: Domain, cropId: string, years: number): void {
  const areas = deriveCropAreasMY(d).areas;
  const a0 = Math.round(areas[cropId]?.[0] ?? 0);
  const aN = Math.round(areas[cropId]?.[Math.min(years - 1, (areas[cropId]?.length ?? 1) - 1)] ?? 0);
  const path = Array.from({ length: years }, (_, i) => Math.round(a0 + ((aN - a0) * i) / Math.max(1, years - 1)));
  d.cropPolicy = { ...(d.cropPolicy ?? {}), [cropId]: { ...(d.cropPolicy?.[cropId] ?? {}), mode: "path", haByYear: path } };
}

/** Ist der Eintrag im Planjahr y wirksam? */
export function lohnAktivIn(e: LohnarbeitEntry, y: number): boolean {
  if (!e.active) return false;
  if (y < (e.fromYear ?? 0)) return false;
  if (e.toYear != null && y > e.toYear) return false;
  return true;
}

/** Fremdvergebene Arbeitsgänge (machineId) einer Kultur im Planjahr y. */
export function lohnGaengeOf(domain: Domain, cropId: string, y: number): Set<string> {
  const out = new Set<string>();
  for (const e of domain.lohnarbeit ?? []) if (e.cropId === cropId && lohnAktivIn(e, y)) out.add(e.machineId);
  return out;
}

/** Lohnarbeitskosten je ha (CENT) einer Kultur im Planjahr y: Σ Satz × Überfahrten × Regler. */
export function lohnarbeitPerHaCent(domain: Domain, cropId: string, scenarioId: string, y = 0): number {
  const list = (domain.lohnarbeit ?? []).filter((e) => e.cropId === cropId && lohnAktivIn(e, y));
  if (!list.length) return 0;
  const f = domain.assumptions["lohn.factor"] ? resolveScalar(domain, "lohn.factor", scenarioId) : 1;
  const gaenge = domain.arbeitsgaenge[cropId] ?? [];
  let cent = 0;
  for (const e of list) {
    const passes = gaenge.filter((g) => g.m === e.machineId).reduce((s, g) => s + g.passes, 0);
    cent += e.ratePerHaCent * passes * f;
  }
  return cent;
}

/** Memo für deriveCropAreasMY je Domänen-Objekt — machineHoursPerYear ruft es sehr oft. */
const _areasMemo = new WeakMap<object, ReturnType<typeof deriveCropAreasMY>>();
export function cropAreasMemo(domain: Domain): ReturnType<typeof deriveCropAreasMY> {
  let v = _areasMemo.get(domain as object);
  if (!v) { v = deriveCropAreasMY(domain); _areasMemo.set(domain as object, v); }
  return v;
}

/** BEMESSUNGSJAHR einer Maschine: das erste Planjahr, in dem sie überhaupt gebraucht wird —
 *  also eine Nutzer-Kultur Fläche hat UND den Gang nicht fremdvergibt.
 *
 *  Warum nicht einfach Jahr 0: seit dem Skalierungspfad starten Tomate, Zwiebel/Möhre,
 *  Sellerie, Süßkartoffel und Knoblauch mit 0 ha. Ihre Technik (Tomaten-Vollernter,
 *  Zwiebel-/Möhrenkette, Pflanzmaschine) hätte damit im Startjahr 0 Bedarfsstunden — und weil
 *  die Vintage-Logik Basis × Faktor rechnet, wäre sie über den GANZEN Horizont nie beschafft
 *  worden. Das Modell hat für diese Kulturen faktisch keine Erntetechnik gekauft.
 *
 *  -1 = über den ganzen Horizont nicht gebraucht (keine Fläche oder dauerhaft fremdvergeben)
 *       ⇒ die Maschine entfällt aus der Flotte. */
export function bedarfsJahrOf(domain: Domain, machineId: string, years: number): number {
  const users = [...new Set(domain.anbauplan
    .filter((a) => (domain.arbeitsgaenge[a.cropId] ?? []).some((g) => g.m === machineId))
    .map((a) => a.cropId))];
  if (!users.length) return 0;
  const areas = cropAreasMemo(domain).areas;
  const haOf = (cid: string, y: number) => areas[cid]?.[Math.min(y, (areas[cid]?.length ?? 1) - 1)] ?? 0;
  for (let y = 0; y < years; y++) {
    if (users.some((cid) => haOf(cid, y) > 0 && !lohnGaengeOf(domain, cid, y).has(machineId))) return y;
  }
  return -1;
}

/* --------------------------------------------------------------------------
 * ANBAUPLAN — NEOTERRA-SOLO (Entscheidung 30.07.2026, Benedikt).
 *  Das Modell rechnet NUR die Wertkulturen der NEOTERRA SRL. Der Ackerbau-Block
 *  (Weizen/Gerste/Mais/Raps/Soja) und die unberegnete Trockenrotation von Isolde Farms
 *  sind vollständig entfallen — keine Residualfläche, keine Zwei-Pool-Logik.
 *  Bewirtschaftete Fläche = Σ Skalierungspfad des Jahres (2027: 300 ha, 2032+: 2.334 ha).
 *  Jahr 0 (= START_YEAR) steht im Anbauplan und ist Basis für CAPEX-, Flotten- und
 *  Lagerbemessung; die Folgejahre liefert deriveCropAreasMY aus cropPolicy ("path").
 * ------------------------------------------------------------------------ */
export function buildAnbauplan(stage: Stage): AnbauEntry[] {
  const sf = STAGES[String(stage)].beregneteFlaecheHa / 4000; // SKALIERUNG_HA ist auf Stufe 1 kalibriert
  const mk = (cropId: CropId, area: number): AnbauEntry => ({
    id: `ab-${cropId}`,
    cropId,
    areaHa: area,
    plantingPeriod: CROP_CAL[cropId].plant,
    harvestPeriods: CROP_CAL[cropId].harvest.slice(),
  });
  // NUR Wertkulturen. Die Bruchkulturen der Rotation stehen bewusst nicht hier:
  //  der Anbauplan treibt Maschinenbemessung, CAPEX, Parzellen und Kulturplaene —
  //  und fuer Cash Crops haelt der Betrieb keine eigene Technik vor.
  return (Object.keys(SKALIERUNG_HA) as CropId[])
    .map((cid) => mk(cid, Math.round((SKALIERUNG_HA[cid]?.[0] ?? 0) * sf)));
}

/** Forward-Migration gespeicherter Domänen (Cloud-AUTOSAVE / JSON-Import), die VOR der
 *  Trockenrotations-Vollintegration gespeichert wurden. Ergänzt die nativen Rain-fed-Kulturen
 *  (weizen_dry/gerste_dry/raps_dry) ADDITIV: Katalog, Arbeitsgänge, Assumptions und Anbauplan-
 *  Einträge (~1,5× beregnete Fläche, 40/35/25 %). Idempotent & nicht-destruktiv — bestehende
 *  (evtl. editierte) Nutzerdaten werden NIE überschrieben, nur Fehlendes aus SEED nachgezogen.
 *  Nach dem nächsten Autosave heilt sich der Cloud-Stand dauerhaft. */
/** Schlüssel des Szenario-Studios (Risiko/Markt/Logistik) + eigener PSM-Stücksatz.
 *  Werden in Altständen (Cloud-Slots, JSON-Exporte) nachgezogen; Defaults sind neutral. */
const STUDIO_KEYS: string[] = [
  "risk.irrig_outage_d", "risk.yield_per_outage_d", "risk.outage_break_share",
  "farm.intake_direct", "risk.intake_mitigation", "irrig.norm_scale",
  "market.contract_share", "market.spot_delta", "market.brix_premium", "market.potato_grade",
  "transport.distance_km", "transport.dist_ref_km", "macro.rate_shock", "psm.per_euro",
];

/** Zieht die Studio-Keys nach und hängt die PSM-Zeilen vom Pauschal- auf den PSM-Stücksatz um
 *  (vorher teilten sich PSM, Material und Handarbeit `price.per_euro` — ein PSM-Regler hätte
 *  zwei fremde Kostenblöcke mitbewegt). Läuft IMMER, auch für sonst fertig migrierte Stände. */
function migrateStudio(d: Domain): Domain {
  let assumptions = d.assumptions ?? {};
  const missing = STUDIO_KEYS.filter((k) => !assumptions[k] && SEED.assumptions[k]);
  if (missing.length) {
    assumptions = { ...assumptions };
    for (const k of missing) assumptions[k] = SEED.assumptions[k];
  }
  let touched = false;
  const catalog = Array.isArray(d.catalog) ? d.catalog.map((c: any) => {
    if (!Array.isArray(c?.ops)) return c;
    let hit = false;
    const ops = c.ops.map((op: any) => {
      if (op?.code !== "OP-PSM" || !Array.isArray(op.lines)) return op;
      if (!op.lines.some((l: any) => l?.unitCostKey === "price.per_euro")) return op;
      hit = true;
      return { ...op, lines: op.lines.map((l: any) => l?.unitCostKey === "price.per_euro" ? { ...l, unitCostKey: "psm.per_euro" } : l) };
    });
    if (!hit) return c;
    touched = true;
    return { ...c, ops };
  }) : d.catalog;
  if (!missing.length && !touched) return d;
  return { ...d, assumptions, catalog };
}

/* --------------------------------------------------------------------------
 * SZENARIO-STUDIO — Overlay-Faktoren (SSOT).
 *  EINE Quelle für Risiko-/Markt-Faktoren, damit Composer (buildModelState) und die
 *  direkten Ableitungen (Umsatz-Split, Charts) garantiert dieselbe Logik rechnen.
 * ------------------------------------------------------------------------ */
export type StudioOverlay = {
  /** Ertragsfaktor je Kultur (Beregnungsausfall; Trockenrotation unbetroffen). */
  yieldFactor: (cropId: string) => number;
  /** Preisfaktor je Kultur (Spot-Exposition, Brix-Prämie, Kartoffel-Sortierung). */
  priceFactor: (cropId: string) => number;
  /** Skalierung der Wassernorm (kostenwirksam auf irrig.eur_mm). */
  irrigNormScale: number;
  /** Additiver Zinsschock auf den EURIBOR (0,02 = +200 bp). */
  rateShock: number;
  /** Effektiver Ertragsabschlag der Wertkulturen aus dem Ausfall (0..0,85). */
  outageHit: number;
};

export function studioOverlay(domain: Domain, scenarioId: string): StudioOverlay {
  const S = (k: string, dflt: number): number => {
    const a = domain.assumptions?.[k]; if (!a) return dflt;
    const v = resolveScalar(domain, k, scenarioId);
    return isFinite(v) ? v : dflt;
  };
  // Beregnungsausfall: Netzausfall (ANIF-Pumpwerk) × Verlust/Tag, gedämpft durch die
  //  Direktentnahme Donau (eigene Pumpstation/Druckleitung als Redundanz), Kappung 85 %.
  const outageD = Math.max(0, S("risk.irrig_outage_d", 0));
  const intake = Math.max(0, Math.min(1, S("farm.intake_direct", 0)));
  const mitig = Math.max(0, Math.min(1, S("risk.intake_mitigation", 0.85)));
  const outageHit = outageD > 0
    ? Math.min(0.85, Math.max(0, outageD * (1 - intake * mitig) * S("risk.yield_per_outage_d", 0.03)))
    : 0;
  const bs = Math.max(0, Math.min(1, S("risk.outage_break_share", 0.40)));
  const isDry = (cr: string) => cr.endsWith("_dry") || cr === "sonnenblume";
  const yieldFactor = (cropId: string): number => {
    if (outageHit <= 0 || isDry(cropId)) return 1;
    return VALUE_CROP_IDS.includes(cropId) ? 1 - outageHit : 1 - outageHit * bs;
  };
  // Markt: kontrahierte Menge ist preisfest, nur (1 − Kontraktanteil) trägt die Spot-Delta.
  //  Break Crops sind voll spot-exponiert (Börsenware ohne Abnahmevertrag).
  const spot = S("market.spot_delta", 0);
  const cs = Math.max(0, Math.min(1, S("market.contract_share", 0.80)));
  const brix = S("market.brix_premium", 0);
  const grade = S("market.potato_grade", 0);
  const priceFactor = (cropId: string): number => {
    let f = 1;
    if (spot !== 0) f *= VALUE_CROP_IDS.includes(cropId) ? 1 + (1 - cs) * spot : 1 + spot;
    if (cropId === "tomate" && brix !== 0) f *= 1 + brix;
    if ((cropId === "kartoffel_pommes" || cropId === "kartoffel_chips") && grade !== 0) f *= 1 + grade;
    return f;
  };
  const norm = S("irrig.norm_scale", 1);
  return { yieldFactor, priceFactor, irrigNormScale: norm > 0 ? norm : 1, rateShock: S("macro.rate_shock", 0), outageHit };
}

/* --------------------------------------------------------------------------
 * deriveRevenueSplitMY — Umsatz-Segmentierung Wertkulturen vs. Rotation/Break Crops.
 *  Die ComputedModel-P&L kennt KEINE Kultur-Ebene (revenue ist eine Summe). Der Split
 *  wird deshalb hier als VERHÄLTNIS aus Fläche × Ertrag × (1−Verlust) × Preis × Qualität
 *  je Jahr gerechnet und — wenn die Engine-Umsatzkurve übergeben wird — auf diese
 *  normiert. Damit stimmen Segment-Summe und P&L-Umsatz IMMER überein (kein zweiter,
 *  driftender Umsatzpfad). Studio-Overlay-Faktoren gehen über studioOverlay ein.
 * ------------------------------------------------------------------------ */
export function deriveRevenueSplitMY(
  domain: Domain,
  scenarioId: string,
  revenueCentByYear?: number[],
): {
  years: number;
  valueShare: number[]; valueCent: number[]; breakCent: number[];
  byCropCent: Record<string, number[]>;
} {
  const my = deriveCropAreasMY(domain);
  const ov = studioOverlay(domain, scenarioId);
  const years = my.years;
  const raw: Record<string, number[]> = {};
  const valueRaw = new Array(years).fill(0);
  const breakRaw = new Array(years).fill(0);
  for (const [cropId, areaCurve] of Object.entries(my.areas)) {
    const yld = resolveScalar(domain, `yield.${cropId}`, scenarioId) * ov.yieldFactor(cropId);
    const price = resolveScalar(domain, `price.${cropId}`, scenarioId) * ov.priceFactor(cropId);
    const loss = resolveScalar(domain, `loss.${cropId}`, scenarioId) || 0;
    const qRaw = resolveScalar(domain, `qual.${cropId}`, scenarioId);
    const qual = qRaw > 0 ? qRaw : 1;
    const isValue = VALUE_CROP_IDS.includes(cropId);
    const curve = new Array(years).fill(0);
    for (let y = 0; y < years; y++) {
      const rev = (areaCurve[y] ?? 0) * yld * (1 - loss) * price * qual;
      curve[y] = rev;
      if (isValue) valueRaw[y] += rev; else breakRaw[y] += rev;
    }
    raw[cropId] = curve;
  }
  const valueShare = new Array(years).fill(0);
  const valueCent = new Array(years).fill(0);
  const breakCent = new Array(years).fill(0);
  const byCropCent: Record<string, number[]> = {};
  for (const id of Object.keys(raw)) byCropCent[id] = new Array(years).fill(0);
  for (let y = 0; y < years; y++) {
    const tot = valueRaw[y] + breakRaw[y];
    valueShare[y] = tot > 0 ? valueRaw[y] / tot : 0;
    const engine = revenueCentByYear?.[y];
    const k = engine != null && isFinite(engine) && tot > 0 ? engine / tot : 1;
    valueCent[y] = Math.round(valueRaw[y] * k);
    breakCent[y] = Math.round(breakRaw[y] * k);
    for (const id of Object.keys(raw)) byCropCent[id][y] = Math.round(raw[id][y] * k);
  }
  return { years, valueShare, valueCent, breakCent, byCropCent };
}

/** Forward-Migration gespeicherter Domänen. Zieht NUR noch die Studio-Schlüssel nach.
 *
 *  ENTFERNT 30.07.2026: die Trockenrotations-Migration. Sie hat bei jedem Laden geprüft,
 *  ob der Anbauplan `pool: "dryland"`-Zeilen enthält, und — falls nicht — Weizen/Gerste/Raps
 *  trocken mit dem 1,5-fachen der beregneten Fläche ANGEHÄNGT, dazu Isolde ins Entity-Register.
 *  Im Solo-Modell ist genau das der Normalzustand: der erste Autosave-/Reload-Zyklus hätte die
 *  Trockenrotation und Isolde stillschweigend wieder eingespielt und die Solo-Entscheidung
 *  rückgängig gemacht. Kein Ersatz nötig — die betroffenen Kulturen sind aus dem Modell raus. */
export function migrateDomain(dIn: Domain): Domain {
  const d = dIn && dIn.assumptions ? migrateStudio(dIn) : dIn;
  if (!d || !Array.isArray(d.anbauplan)) return d;
  // SOLO-MODELL: Ackerbau- und Trockenkulturen aus dem Anbauplan entfernen. Gespeicherte Stände
  //  (Cloud-Autosave, JSON-Import) tragen sie noch — und sie WIRKEN dort: Fläche, Erlös, Kosten,
  //  Maschinenbedarf und Personal rechnen mit. Es reicht also nicht, sie in den Ansichten
  //  auszublenden; sie müssen aus der Domäne heraus, sonst zeigt das Modell eine Struktur, die
  //  es nicht mehr gibt. Der Kulturkatalog behält ihre Stammdaten als Referenz.
  //  KEIN frueher Rücksprung, wenn der Anbauplan schon sauber ist: Zeitachse, Wachstumskurve
  //  und Katalog können unabhängig davon veraltet sein. Genau daran ist die erste Fassung
  //  gescheitert — der Plan war bereinigt, die Jahresbeschriftung lief trotzdem ab 2026.
  const fremd = d.anbauplan.filter((a) => !VALUE_CROP_IDS.includes(a.cropId));
  const anbauplan = d.anbauplan.filter((a) => VALUE_CROP_IDS.includes(a.cropId));
  let cropPolicy = { ...(d.cropPolicy ?? {}) };
  for (const a of fremd) delete cropPolicy[a.cropId];
  // Altstände tragen die ALTE Politik (ramp/fix/scale) und damit die Flächen des Kombimodells.
  //  Trägt keine einzige Kultur einen expliziten Pfad, ist der beschlossene Skalierungspfad
  //  (300 ha Kartoffel 2027 → 2.334 ha ab 2032) der Plan von Rekord — sonst öffnet sich die App
  //  mit einer Flächenstruktur, die niemand mehr beschlossen hat. Sobald ein Pfad gepflegt ist,
  //  bleibt er unangetastet.
  const hatPfad = Object.values(cropPolicy).some((p) => (p as CropPolicy)?.haByYear?.length);
  if (!hatPfad) {
    cropPolicy = { ...skalierungPolicy(1) };
    cropPolicy.zwiebel_moehre = { ...cropPolicy.zwiebel_moehre, capTonnes: 60000 };
    cropPolicy.knollensellerie = { ...cropPolicy.knollensellerie, capTonnes: 22000 };
    for (const a of anbauplan) {
      const path = cropPolicy[a.cropId]?.haByYear;
      if (path) a.areaHa = path[0] ?? 0;      // Jahr 0 = Bemessungsgrundlage, muss mitziehen
    }
  }
  //  Katalog ebenfalls auf die Wertkulturen reduzieren — er speist Maßnahmen, Kalkulation,
  //  Contribution und Produktkatalog. Die Stammdaten der übrigen Kulturen bleiben im Modell.
  const catalog = Array.isArray(d.catalog) ? d.catalog.filter((c) => VALUE_CROP_IDS.includes(c.cropId)) : d.catalog;

  // WACHSTUMSKURVE NACHZIEHEN — das ist der eigentliche Fehler in Altständen. Sie tragen die
  //  Flächenkurve des Kombimodells (10.000 → 20.000 ha). Nach dem Entfernen des Ackerbaus
  //  stünde einer Betriebsfläche von 2.334 ha eine Kurve von 20.000 ha gegenüber. Weil
  //  scale[y] = Fläche des Jahres / Basisfläche in OPEX, Pacht, Personal, Transport und die
  //  Maschinen-Vintages eingeht, rechnete das Modell diese Blöcke auf der 20.000-ha-Kurve —
  //  Umsatz aus 2.334 ha, Kosten aus 20.000 ha. Die Kurve ist deshalb auf die Summe der
  //  Kulturpfade zu setzen: im Solo-Modell IST die Betriebsfläche die Summe der Kulturen.
  const years = Math.max(1, d.growth?.years ?? 1);
  const haOfYear = (y: number): number => {
    let sum = 0;
    for (const a of anbauplan) {
      const path = cropPolicy[a.cropId]?.haByYear;
      sum += path?.length ? (path[Math.min(y, path.length - 1)] ?? 0) : a.areaHa;
    }
    return Math.round(sum);
  };
  const kurve = Array.from({ length: years }, (_, y) => haOfYear(y));
  const growth = d.growth ? {
    ...d.growth,
    areaByYear: kurve.slice(),
    totalByYear: kurve.slice(),
    startTotalHa: kurve[0],
    startIrrigatedHa: kurve[0],
    stage: "s3b" as const,          // die früheren Stufen gibt es nicht mehr
    drylandRotation: undefined,
    acquisitions: undefined,
  } : d.growth;

  // ZEITACHSE: Altstände tragen das alte Basisjahr (2026). Die Engine rechnet zwar rein über
  //  Periodenindizes, aber JEDE Beschriftung — Diagramme, Jahresspalten, Stichtage der Bilanz —
  //  kommt aus timeline.startDate. Ohne Nachziehen liest sich der ganze Plan um ein Jahr
  //  verschoben, obwohl die Zahlen zum Startjahr 2027 gehören.
  const timeline = d.timeline && !String(d.timeline.startDate ?? "").startsWith(String(START_YEAR))
    ? SEED.timeline
    : d.timeline;

  // HOLDING: Altstände tragen den ZYPERN-Kostenblock (Company Secretary, Statutory Audit
  //  „CY-Pflicht", Annual Levy/HE32, lokale CY-Directors, Substanz/Board-Meetings CY). Die
  //  Holding ist seit dem 30.07.2026 eine deutsche GmbH — diese Posten gibt es hier nicht,
  //  andere (Offenlegung im Bundesanzeiger, IHK-Beitrag, Notar/Handelsregister) fehlten.
  //  Ein CY-Marker in irgendeinem Label heißt: der ganze Block stammt aus der alten Struktur
  //  und wird durch den GmbH-Block ersetzt. Editierte GmbH-Blöcke bleiben unangetastet.
  const CY = /\bCY\b|Cyprus|Zypern|HE32|Company Secretary|Annual Levy|Registered Office|Statutory Audit|Verwaltungsrat/i;
  const holding = d.holding && (d.holding.costItems ?? []).some((c) => CY.test(String(c.label ?? "")))
    ? { ...d.holding, name: /ltd/i.test(String(d.holding.name ?? "")) ? HOLDING.name : d.holding.name,
        costItems: HOLDING.costItems.map((c) => ({ ...c })) }
    : d.holding;

  //  Dieselbe Umstellung im Gesellschafts-Register: eine Holding mit Sitz CY ist die alte
  //  Struktur — Land, Name und Notiz kommen auf den GmbH-Stand.
  const entities = Array.isArray(d.entities)
    ? d.entities.map((e): Entity => (e.role === "holding" && e.country !== "DE"
        ? { ...e, country: "DE" as const, name: /ltd/i.test(String(e.name ?? "")) ? "NEOS Holding GmbH" : (e.name ?? "NEOS Holding GmbH"),
            note: "Konzernmutter (Deutschland) · Beteiligung an der NEOTERRA SRL, § 8b KStG" }
        : e))
    : d.entities;

  /* ---- STAMMDATEN NACHZIEHEN (Versionssprung) --------------------------------------
     Alles, was dem MODELL gehört, kommt aus dem Seed; alles, was der NUTZER entschieden hat,
     bleibt stehen. Ohne diesen Block überschreibt jeder gespeicherte Stand die Stammdaten
     beim Laden mit seinem eigenen, eingefrorenen Katalog — Korrekturen am Modell erreichen
     den Nutzer nie. */
  const stammAlt = d.stammdatenVersion ?? 0;
  const stammNeu = stammAlt < STAMMDATEN_VERSION;

  // MASCHINENKATALOG: Stammdaten (Bezeichnung, Hersteller, Preis-Key, Leistungsparameter,
  //  AfA-Dauer, Kategorie) folgen dem Seed. Übernommen werden nur die Nutzerfelder — Bestand,
  //  gemietete Einheiten, Alter. Klassen, die es im Modell nicht mehr gibt (Einzelkorn-
  //  Sämaschine, Mähdrescher, Krautschläger), verschwinden; neue kommen dazu.
  const machineCatalog = (() => {
    if (!stammNeu || !Array.isArray(d.machineCatalog)) return d.machineCatalog;
    const alt = new Map(d.machineCatalog.map((m) => [m.id, m as Record<string, unknown>]));
    return SEED.machineCatalog.map((sm) => {
      const a = alt.get(sm.id);
      if (!a) return { ...sm };
      const zusammen: Record<string, unknown> = { ...sm };
      for (const f of MASCHINE_NUTZERFELDER) if (a[f] != null) zusammen[f] = a[f];
      return zusammen as MachineType;
    });
  })();

  // LISTENPREISE (`mprice.*`) sind Stammdaten, keine Planentscheidung: sie kommen aus Angeboten
  //  und Recherche. Beim Versionssprung folgen sie dem Seed — sonst bliebe der Schlepper zu
  //  700.336 € stehen, obwohl im Modell ein anderes Gerät zu 523.813 € steht.
  const stammKeys = (k: string) => k.startsWith("mprice.");

  // NEUE ANNAHME-KEYS NACHSPIELEN. Gespeicherte Stände kennen nur die Keys, die es beim
  //  Speichern gab. Fehlt ein Key, den die Engine referenziert, löst sie ihn still auf 0 auf —
  //  der Check „Fehlende Assumption-Keys" meldete genau das für `quality.reject` und
  //  `market.cover_premium`. Das trifft jeden neuen Treiber, deshalb generisch: alles, was der
  //  Seed kennt und der Stand nicht, wird ergänzt. VORHANDENE Werte bleiben unangetastet —
  //  hier wird nur aufgefüllt, nie überschrieben.
  const assumptions = { ...(d.assumptions ?? {}) };
  for (const [k, a] of Object.entries(SEED.assumptions)) {
    // Fehlender Key → ergänzen. Listenpreis bei Versionssprung → nachziehen.
    if (!assumptions[k] || (stammNeu && stammKeys(k))) assumptions[k] = JSON.parse(JSON.stringify(a));
    else if (assumptions[k]) {
      // Beschriftung und EINHEIT sind Stammdaten (die Einheit steuert Umrechnung und
      //  Nachkommastellen der Anzeige). Der WERT bleibt in jedem Fall unangetastet.
      assumptions[k] = { ...assumptions[k], label: a.label, unit: a.unit };
    }
  }

  // GEMEINKOSTEN-POSITIONEN nachspielen, die im Seed neu hinzugekommen sind — dieselbe Logik.
  //  Konkret die Gegenbuchung zur Management-Fee der Holding: ohne sie meldet der
  //  IC-Abgleich in gespeicherten Ständen eine Differenz, die es im Modell nicht gibt.
  const overhead = Array.isArray(d.overhead) ? d.overhead.slice() : d.overhead;
  if (Array.isArray(overhead)) {
    const vorhanden = new Set(overhead.map((o) => o.id));
    for (const o of SEED.overhead ?? []) if (!vorhanden.has(o.id)) overhead.push({ ...o });
  }

  // PACHTSATZ VON EURO AUF CENT. Gespeicherte Staende tragen die Tabelle in Euro (750);
  //  ab jetzt liegt sie wie jeder Geldwert in Cent (75.000). Erkennungsmerkmal: ein
  //  realistischer Pachtsatz in Cent liegt nie unter 10.000 (= 100 EUR/ha).
  const pacht = d.pacht && Array.isArray(d.pacht.ratePerHaByYear) && d.pacht.ratePerHaByYear.length
    && Math.max(...d.pacht.ratePerHaByYear) < 10000
    ? { ...d.pacht, ratePerHaByYear: d.pacht.ratePerHaByYear.map((v) => Math.round(v * 100)) }
    : d.pacht;

  // SUBVENTIONSREGISTER: Sätze und Kulturzuordnung sind Recht, keine Planentscheidung —
  //  beim Versionssprung folgen sie dem Seed. Der Aktiv-Schalter je Zeile bleibt beim Nutzer.
  const subsidies = stammNeu && Array.isArray(d.subsidies)
    ? SEED.subsidies.map((ss) => {
        const a = (d.subsidies ?? []).find((x) => x.id === ss.id);
        return a ? { ...ss, active: a.active } : { ...ss };
      })
    : d.subsidies;

  return { ...d, anbauplan, cropPolicy, catalog, growth, timeline, holding, entities,
    assumptions, overhead, subsidies, machineCatalog, pacht, stammdatenVersion: STAMMDATEN_VERSION,
    scope: "full", stage: 1, entityView: undefined };
}


/** BELEG ZUM TREIBER — der Satz, der früher in Klammern im NAMEN stand.
 *  Ein Treibername soll den Treiber benennen, nicht seine Herleitung tragen: „Preis
 *  Knollensellerie (Erzeuger; Importparität ~0,74 USD/kg)" war 60 Zeichen lang und wurde in
 *  jeder Tabelle abgeschnitten. Die Herleitung steht jetzt hier und erscheint als Notiz im
 *  Annahmen-Register sowie als Tooltip am Feld. */
export const ASSUMPTION_NOTE: Record<string, string> = {
  "spray.boom_m": "36 = Bestand · 48 = 48-m-Paket → weniger Spritzen und rund −25 % Spritzkosten je Hektar",
  "mprice.fieldloader": "Feldrand-Überladetrichter, 9-m-Elevator, elektrisch",
  "mprice.pflug": "6,20 m, bis 30 cm Arbeitstiefe; Liste rund 71,2 T€",
  "mprice.maehdr": "mit Bandschneidwerk HD40X 12,19 m; Liste laut JD-Angebot",
  "irrig.capex_from_year": "Wert ≥ Planhorizont = nie; die Pacht enthält die Pivots bereits (750 €/ha)",
  "subsidy.factor": "1,00 = Sätze wie im Subventions-Register hinterlegt",
  "yield.knollensellerie": "bewässert; Upside 48–50 t am Süd-Standort",
  "en.avail_h_year": "bezogen auf eine Schicht",
  "qual.kartoffel_pommes": "Länge, Zuckergehalt, Sortierung",
  "qual.kartoffel_chips": "Fritierfarbe, Zuckergehalt",
  "qual.zwiebel_moehre": "Kaliber, Sortierung",
  "mprice.roder_ropa": "Listenpreis netto ohne MwSt, mit WD-Triebachse",
  "infl.input": "Dünger, PSM, Saatgut, Diesel, OpEx",
  "price.knollensellerie": "Erzeugerpreis; Importparität rund 0,74 USD/kg",
  "seed.knollensellerie": "50.000 Pflanzen/ha, Erdpressballen",
  "yield.suesskartoffel": "bewässert; Dăbuleni-Versuche 23–53 t",
  "mprice.boom48_pkg": "Gestänge-Umrüstung PT/TD plus Fahrgassen-Terminal",
  "spray.reserve": "Stück über dem reinen Rechenbedarf; Pflanzenschutz ist terminkritisch",
  "wc.inv": "wirkt erst mit einem Lieferplan je Vertrag",
  "cap.per_farm_from_2028": "0 = keine Kappung",
  "mprice.lkw_sattel": "Straßentransport zum Abnehmer",
  "advance.rate": "Anteil des geplanten Erntewerts",
  "mprice.streuer_xeric": "48 m, 14.000 l",
  "mprice.ops_6r": "Liste = 6R 250 plus 3 %",
  "log.fieldloader_tph": "treibt den Stückzahlbedarf",
  "machine.rent_markup": "auf die Stundenkosten",
  "mprice.zug_9r": "Liste laut JD-Angebot vom 23.07.2026",
  "mprice.gem_saat": "3 Beete, Agricola-Klasse — Klassenanker, kein Angebot",
  "lohn.factor": "1,00 = LWK-Erfahrungssätze",
  "opex.admin": "Legacy-Zeile, in die SG&A überführt",
};

/* --------------------------------------------------------------------------
 * FINANZIERUNG / REVOLVER / WC / STEUER / SUBVENTION.
 * ------------------------------------------------------------------------ */
// Legacy-Freiform-Tranchen (z. B. manuelle Sonderlinien). Maschinenfinanzierung läuft
// jetzt über FINANCING_CONTRACTS (je Objekt/Paket). Leer im Basisfall.
const DEBT: DebtTranche[] = [];

/* CAPEX-Detailplanung — Benchmark-Vorbefüllung (EU/RO 2025/26, siehe Research). €/Einheit in CENT.
 *  Standardmäßig sind alle Blöcke INAKTIV (capexPlanActive leer) → Auto-Blöcke laufen, diese Zeilen
 *  sind reine Planung, bis ein Block im Editor scharfgeschaltet wird. Mengen/Preise editierbar. */
const cp = (
  id: string, block: CapexBlock, bezeichnung: string, anlagenklasse: AnlagenKlasse,
  driver: CapexDriverMode, menge: number, einheit: string, eurProEinheit: number, afaYears: number,
  o: Partial<CapexPlanItem> = {},
): CapexPlanItem => ({
  id, block, bezeichnung, anlagenklasse, driver, menge, einheit,
  eurProEinheitCent: Math.round(eurProEinheit * 100), afaYears,
  restwertPct: o.restwertPct ?? 0.1, jahr: o.jahr ?? 1, fkQuote: o.fkQuote ?? 0.5, zins: o.zins ?? 0.05,
  laufzeitJahre: o.laufzeitJahre ?? afaYears, subventionPct: o.subventionPct ?? 0, bestand: o.bestand ?? false,
  kategorie: o.kategorie, benchMinCent: o.benchMinCent, benchMaxCent: o.benchMaxCent, quelle: o.quelle, notiz: o.notiz,
});
const bench = (lo: number, hi: number) => ({ benchMinCent: Math.round(lo * 100), benchMaxCent: Math.round(hi * 100) });
// MENGEN AUF DEN SOLO-PLAN UMGESTELLT (31.07.2026). Der Katalog war auf den Endausbau des
//  GRUPPENMODELLS bemessen — 16.000 ha Pivots, 40 Pumpstationen, 40 Brunnen, 500.000 m³
//  Reservoir, 45.000 t Schüttlager. NEOTERRA bewirtschaftet im Endausbau 2.334 ha und erntet
//  rund 77.000 t Lagerkulturen. Die Blöcke rechnen zwar nur, wenn sie in `capexPlanActive`
//  scharfgeschaltet sind (heute nur „maschinen") — als Planungsregister las man sie aber als
//  NEOTERRAs Vorhaben. Mengen jetzt auf Fläche und Tonnage des Plans; Einheitspreise und
//  Benchmarks unverändert.
const CAPEX_PLAN_SEED: CapexPlanItem[] = [
  // — Bewässerung / Wasser-Infrastruktur (assetClass irrigation; AFIR 25 % möglich) —
  cp("bw-pivot", "bewaesserung", "Center-Pivot-Systeme (Valley/Reinke/Bauer)", "technik", "perHa", 2334, "ha", 1600, 12, { fkQuote: 0.5, subventionPct: 0.25, ...bench(1200, 2000), quelle: "Farmonaut 2026", notiz: "Nur relevant, wenn UNBEREGNETE Fläche zugepachtet wird — die heutige Pacht enthält die Pivots (750 €/ha)" }),
  cp("bw-main", "bewaesserung", "Verrohrung / Mainlines (unterirdisch)", "infrastruktur", "perHa", 2334, "ha", 500, 18, { subventionPct: 0.25, ...bench(300, 700) }),
  cp("bw-pump", "bewaesserung", "Pumpstationen (Pumpe, FU, Gebäude)", "technik", "perStueck", 6, "Stück", 60000, 12, { ...bench(30000, 90000) }),
  cp("bw-well", "bewaesserung", "Brunnen / Bohrungen", "infrastruktur", "perStueck", 6, "Stück", 30000, 25, { ...bench(15000, 45000) }),
  cp("bw-res", "bewaesserung", "Wasserspeicher / Reservoir (foliert)", "bau", "perM3", 73000, "m³", 10, 25, { ...bench(6, 15) }),
  cp("bw-filt", "bewaesserung", "Filtration + Fertigation (Kopfstation)", "technik", "perStueck", 6, "Stück", 45000, 12, { ...bench(20000, 70000) }),
  cp("bw-power", "bewaesserung", "Elektrifizierung / MS-Anschluss / Trafo", "infrastruktur", "fix", 1, "pauschal", 250000, 18, { notiz: "größter Unsicherheitsposten — mit Angebot kalibrieren" }),
  cp("bw-scada", "bewaesserung", "SCADA / Fernsteuerung", "elektronik", "perStueck", 6, "Stück", 1500, 6, { ...bench(500, 2000) }),
  // — Lager (Kartoffel + Zwiebel/Möhre; Tomate NICHT) (assetClass buildings) —
  // MENGEN AUF DAS ZIELBILD 2035 (Entscheidung Betrieb 03.08.2026: mit eigenem Lager).
  //  Erntemenge 2035: Kartoffel 115.500 t, Zwiebel/Möhre 25.700 t, Sellerie 4.200 t,
  //  Süßkartoffel 1.500 t, Knoblauch 450 t. Eingelagert wird NICHT alles — die
  //  Hauptkultur geht ab Feld zum Verarbeiter, die Zweitkultur und die Gemüseschiene
  //  ins Lager. Angesetzt sind rund 40 % der Kartoffel und die Lagerkulturen voll.
  //  BAUABSCHNITTE (`jahr`): der Lagerbau folgt dem Kartoffelhochlauf, er geht ihm
  //  nicht voraus. Ohne Staffelung fiel das gesamte Programm — rund 27 Mio EUR —
  //  im Jahr 2028 an, in dem der Betrieb 670 ha bewirtschaftet. Die Kasse stand
  //  danach sieben Jahre auf null und der Revolver war durchgezogen.
  //  Die hier gesetzten Abschnitte sind ein PLATZHALTER fuer die echte
  //  Projektplanung: Huelle und Schuettlager 2029, Curing 2031, Kuehllager 2032,
  //  Packhaus 2033/34. Sobald der Bauzeitenplan steht, gehoert er hierher.
  //
  //  Diese Zahlen sind PROJEKTPLANUNG und laufen bewusst getrennt von der Automatik:
  //  ein Lager wird gebaut, wie es gebaut wird, nicht wie eine Formel es ausrechnet.
  //  Gegen stilles Auseinanderlaufen schützt der Check `capex_plan_drift` (s. u.).
  cp("lg-bulk", "lager", "Schüttlager Kartoffel, belüftet (ambient)", "bau", "perTonne", 46000, "t", 160, 22, { ...bench(120, 200), jahr: 2 }),
  cp("lg-cool", "lager", "Kühl-/CA-Lager Kartoffel", "technik", "perTonne", 24000, "t", 320, 20, { ...bench(250, 550), jahr: 5 }),
  cp("lg-cure", "lager", "Zwiebel-Trocknung / Curing", "technik", "perTonne", 12000, "t", 200, 20, { ...bench(150, 250), jahr: 4 }),
  cp("lg-shell", "lager", "Gebäudehülle Lager (Stahl, isoliert)", "bau", "perM2", 12000, "m²", 500, 25, { ...bench(350, 800), jahr: 2 }),
  // — Packhaus / Aufbereitungslinien (assetClass buildings, kurze AfA) —
  cp("pk-line", "packhaus", "Verpackungslinie Kartoffel (20 t/h)", "technik", "perStueck", 2, "Linie", 1200000, 10, { ...bench(500000, 2000000), jahr: 6, quelle: "LONKIA 2026" }),
  cp("pk-optic", "packhaus", "Optische Sortierung / Grading", "technik", "perStueck", 1, "Modul", 150000, 10, { ...bench(80000, 250000), jahr: 6 }),
  cp("pk-wash", "packhaus", "Annahme / Waschen / Wasseraufbereitung", "technik", "perStueck", 1, "Modul", 80000, 10, { ...bench(25000, 100000), jahr: 6 }),
  cp("pk-pal", "packhaus", "Palettierung (halbautomatisch)", "technik", "perStueck", 1, "Stück", 120000, 10, { ...bench(60000, 250000), jahr: 7 }),
  cp("pk-onion", "packhaus", "Verpackungslinie Zwiebel/Möhre", "technik", "perStueck", 1, "Linie", 400000, 10, { ...bench(200000, 800000), jahr: 7 }),
  // — Maschinen & Fahrzeuge (Jahres-Planung): NUR für Positionen, die NICHT im Register/Bedarf−Bestand
  //  stehen — sonst Doppelzählung (LKW/Radlader etc. existieren dort bereits). IoT/FMS lebt HIER
  //  (aus dem Maschinenkatalog hierher verschoben; Block ist per Default AKTIV, damit es zählt).
  cp("ma-iot", "maschinen", "Sensorik · Telemetrie · Farm-Management-System", "elektronik", "fix", 1, "pauschal", 400000, 6, { jahr: 0, fkQuote: 0, restwertPct: 0.1, kategorie: "iot", notiz: "IoT/Digitalisierung — Netto nach Rabatt (Liste 500k)" }),
  // — Gebäude & allgemeine Infrastruktur (assetClass buildings) —
  cp("gb-hall", "gebaeude", "Maschinenhalle (Stahl, kalt)", "bau", "perM2", 2500, "m²", 350, 25, { jahr: 0, ...bench(250, 450) }),
  cp("gb-shop", "gebaeude", "Werkstatt (isoliert, Grube, Kran)", "bau", "perM2", 800, "m²", 700, 25, { jahr: 0, ...bench(500, 900) }),
  cp("gb-fuel", "gebaeude", "Diesel-Tankanlage (doppelwandig)", "technik", "perStueck", 1, "Stück", 80000, 12, { jahr: 0, ...bench(30000, 120000) }),
  cp("gb-office", "gebaeude", "Sozial- / Bürogebäude", "bau", "perM2", 600, "m²", 1100, 30, { jahr: 0, ...bench(700, 1400) }),
  // ENTFERNT 31.07.2026: Getreide-Silos — das Solo-Modell baut kein Getreide mehr an.
  cp("gb-yard", "gebaeude", "Hofbefestigung / Wege (Beton)", "infrastruktur", "perM2", 6000, "m²", 50, 18, { jahr: 0, ...bench(30, 80) }),
  cp("gb-scale", "gebaeude", "Wiegebrücke 60 t (geeicht)", "technik", "perStueck", 1, "Stück", 45000, 15, { jahr: 0, ...bench(25000, 60000) }),
  cp("gb-pv", "gebaeude", "PV-Anlage Eigenstrom", "technik", "perKWp", 300, "kWp", 900, 20, { ...bench(700, 1100) }),
  cp("gb-fence", "gebaeude", "Umzäunung / Sicherheit (Zaun, Tore, Kameras)", "infrastruktur", "perLfm", 2000, "lfm", 50, 12, { jahr: 0, ...bench(30, 80) }),
];

/* --------------------------------------------------------------------------
 * FINANZIERUNGSVERTRÄGE — INDIKATIVE NEOS-Platzhalterpakete für die NEOS-eigenen
 * Maschinen. Konditionen = markttypische RO-Leasing-Defaults (Avans/EURIBOR+Marge/
 * Restwert/Gebühren), editierbar. KEINE realen Verträge — die konkreten Lessoren/
 * Vertragsnummern werden bei Abschluss eingetragen. (Die hochgeladenen Danubia-Muster
 * dienten NUR der Ableitung der Vertragsmaske; sie sind KEINE NEOS-Verträge.)
 * Jeder Vertrag bündelt CAPEX-Positionen (objectIds); principal = live Σ Objektwerte.
 * ------------------------------------------------------------------------ */
const FINANCING_CONTRACTS: LeasingContract[] = [
  {
    id: "fc-zug-ernte", name: "Maschinen-Leasing · Zug- & Erntetechnik (Paket)",
    lessor: "Leasinggeber (offen)", contractNo: "", supplier: "John Deere / Händler",
    kind: "lease_fin",
    // maehdr existiert im Solo-Modell nicht mehr und wurde stillschweigend uebersprungen;
    //  zug_9r (JD 8R 410, 2,99 Mio CAPEX) stand in KEINEM Vertrag und lief als Barkauf
    //  direkt gegen den Revolver.
    objectIds: ["zug_8rx", "ops_6r", "zug_9r"],
    drawPeriod: 0, avansRate: 0.25, residualRate: 0.01, termMonths: 84,
    rateBasis: "floating", referenceRateKey: "macro.euribor", floatingSpread: 0.0355,
    frequency: "seasonal", seasonMonths: [7, 10], repayment: "annuity",
    currency: "RON", fxSource: "Bankkurs (offen)", vatRate: 0.21,
    feeAnalysisCent: 0, feeAdminRate: 0.005, feeRegistrationCent: 3000, feeClosingCent: 170000,
    prepaymentRate: 0.01, prepaymentMinCent: 20000, lateInterestDaily: 0.0025,
    ifrs16RightOfUse: true, active: true,
  },
  {
    id: "fc-spezial-rode", name: "Maschinen-Leasing · Spezial-/Rodetechnik (Paket)",
    lessor: "Leasinggeber (offen)", contractNo: "", supplier: "John Deere / ROPA / Händler",
    kind: "lease_fin",
    objectIds: ["roder_ropa", "onepass", "radlader", "shuttle"],
    drawPeriod: 0, avansRate: 0.30, residualRate: 0.01, termMonths: 60,
    rateBasis: "floating", referenceRateKey: "macro.euribor", floatingSpread: 0.034,
    frequency: "monthly", repayment: "annuity",
    currency: "RON", fxSource: "Bankkurs (offen)", vatRate: 0.21,
    feeAnalysisCent: 0, feeRegistrationCent: 170000, feeAdminRate: 0.005, feeClosingCent: 170000,
    prepaymentRate: 0.01, prepaymentMinCent: 20000, lateInterestDaily: 0.0025,
    ifrs16RightOfUse: true, active: true,
  },
  {
    id: "fc-invest-bewaesserung", name: "Investitionskredit · Bewässerung & Lager",
    lessor: "Bank (offen)", contractNo: "", supplier: "diverse (AFIR-kofinanziert)",
    kind: "loan",
    objectIds: ["irrig", "store", "store_tech", "spray_gz", "spray_sf"],
    drawPeriod: 0, avansRate: 0.20, residualRate: 0.0, termMonths: 120,
    rateBasis: "floating", referenceRateKey: "macro.euribor", floatingSpread: 0.032,
    frequency: "monthly", repayment: "annuity",
    currency: "EUR", vatRate: 0.21,
    feeAnalysisCent: 0, feeAdminRate: 0.005, prepaymentRate: 0.01,
    ifrs16RightOfUse: false, active: true,
  },
];

const REVOLVER: RevolverFacility = {
  // Funding-Linie deckt Saison-WC + CAPEX-/Avans-/USt-Timing über den Ramp.
  //  KORRIGIERT 31.07.2026: die Linie stand auf 245 Mio € — eine Größenordnung aus dem alten
  //  Gruppenmodell. Bei einem Betrieb mit 28 Mio € Umsatz und einem tatsächlichen
  //  Spitzenbedarf von rund 30 Mio € las sich die Liquiditätsplanung dadurch so, als stünden
  //  dauerhaft 246 Mio € zur Verfügung. Das ist keine Planung, das ist ein Rechenartefakt.
  //  Jetzt 40 Mio €: deckt die Augustspitze (~30 Mio in 2031) mit Reserve, bleibt aber eine
  //  Zahl, über die man mit einer Bank sprechen kann.
  limit: 4000000000, rateBasis: "floating", floatingSpread: 0.032,
  referenceRateKey: "macro.euribor", minCashTarget: 0,
};

const WORKING_CAPITAL: WorkingCapitalPolicy = {
  dsoAssumptionKey: "wc.dso",
  dpoAssumptionKey: "wc.dpo",
  inventoryDaysAssumptionKey: "wc.inv",
};

/* Anzahlungen der Off-taker — bemessen am GEPLANTEN ANBAU (Fläche × Ertrag × Mischpreis),
 * nicht am Einzelvertrag: jeder Vertrag ist individuell verhandelt, und über den Anbauplan
 * skaliert die Vorfinanzierung automatisch mit Wachstumsszenarien.
 * Zufluss im März — beim Legen, lange vor der Ernte: genau in das Liquiditätsloch, das die
 * Direktkosten von Februar bis September aufreißen.
 * Kulturen: die beiden Kartoffelkulturen, für die Abnahmeverträge vorliegen. Wird cropIds
 * geleert, gilt die Quote für ALLE Kulturen (Getreide wird real spot verkauft — bewusst aus). */
const HARVEST_ADVANCE: HarvestAdvancePolicy = {
  active: true,
  rateAssumptionKey: "advance.rate",
  month: 3,
  settlement: "firstDeliveries",
  costRateAssumptionKey: "advance.cost_rate",
  securityFeeRateAssumptionKey: "advance.aval_fee",
  security: "bilet la ordin",
  cropIds: ["kartoffel_pommes", "kartoffel_chips"],
  note: "Verhandlungsannahme, keine Vertragslage: keiner der drei geprüften Verträge sagt eine Anzahlung zu. PepsiCo verrechnet Vorschüsse gegen die ersten Lieferungen und sagt keinen Vorschuss zu; VIA AGRO verlangt ein bilet la ordin. Quote, Zeitpunkt und Preis der Vorfinanzierung sind bei PepsiCo und Bayer Strada anzufordern.",
};

const TAX: TaxPolicy = { corporateTaxRateKey: "tax.rate", lossCarryforward: true };

/* USt / TVA Rumänien (Stand 2026): Regelsatz 21 % (seit 08/2025), ermäßigt 11 %
 * (Nahrungsmittel). Getreide & technische Pflanzen inkl. Ölsaaten → taxare inversă
 * (Reverse-Charge, Art. 331 Cod Fiscal): keine Ausgangs-USt. Wertkulturen (Gemüse/
 * Kartoffeln als Nahrungsmittel) → 11 %. Maschinen/Inputs → 21 % Vorsteuer, abziehbar.
 * NEOTERRA ist strukturell Vorsteuer-Überhänger (rambursare) — v. a. CAPEX-USt. */
const VAT: VatPolicy = {
  enabled: true,
  standardRate: 0.21,
  reducedRate: 0.11,
  outputByCrop: {
    weizen: "reverse_charge",        // Getreide → Art. 331
    gerste_zw: "reverse_charge",     // Getreide (+ Doppel-Soja: Ölsaat) → Art. 331
    soja_luzerne: "reverse_charge",  // Soja = Ölsaat, Luzerne technische Pflanze → Art. 331
    winterraps: "reverse_charge",    // Ölsaat → Art. 331
    mais: "reverse_charge",          // Getreide → Art. 331
    tomate: "reduced",               // Nahrungsmittel → 11 %
    kartoffel_pommes: "reduced",     // Nahrungsmittel → 11 %
    kartoffel_chips: "reduced",      // Nahrungsmittel → 11 %
    zwiebel_moehre: "reduced",       // Nahrungsmittel → 11 %
    suesskartoffel: "reduced",       // Nahrungsmittel → 11 %
    knoblauch: "reduced",            // Nahrungsmittel → 11 %
    knollensellerie: "reduced",      // Nahrungsmittel → 11 %
  },
  inputRateCapex: 0.21,
  inputRateCost: 0.20,               // Mischsatz Inputs (Diesel/PSM/Dünger 21 %, Saatgut ermäßigt)
  recoverableCogsShare: 0.80,        // COGS: ~80 % vorsteuerbehaftete Inputs, Rest Feldlohn (ohne USt)
  recoverableOpexShare: 0.45,        // OpEx/SG&A: Dienstleistungen/IT mit USt; Personal/Zins/Pacht ohne
  settlementLagMonths: 1,            // Zahllast: monatliche Abführung
  refundLagMonths: 3,                // Vorsteuer-Überhang: Erstattung mit Prüf-Lag (~3 M)
};

/* EU-CAP 2023–2027 Rumänien — volle Struktur, editierbar. Sätze €/ha als Inline-CENT
 * (belastbare Defaults aus PNS/APIA 2026-Recherche; im Screen anpassbar). Auszahlungsprofil:
 * Vorschuss 70 % ab Oktober (Periode 9) + Rest 30 % Dezember (Periode 11) — reales APIA-Timing. */
const CAP_PAYOUT: { period: number; share: number }[] = [{ period: 9, share: 0.7 }, { period: 11, share: 0.3 }];
const SUBSIDIES: Subsidy[] = [
  // — Säule 1: Direktzahlungen —
  // SATZE NACHGEFUEHRT — Subventions-Monitor 01.08.2026 (Projektdoku
  //  `NEOS-FX-Subventions-Monitor-2026-08.md`). Freigabe Benedikt am 01.08.2026.
  { id: "s-biss", name: "BISS — Basisprämie (Sprijin de bază)", basis: "per_ha", ratePerHaCent: 8934,
    pillar: 1, category: "biss", receiptPeriods: [11], payout: CAP_PAYOUT, active: true },
  /* CRISS AUS — belegt. Die umverteilende Praemie ist auf Betriebe von 1 bis 50 ha
   *  GESAMTFLAECHE begrenzt; wer die Schwelle ueberschreitet, verliert den Anspruch fuer ALLE
   *  Hektar, nicht nur fuer die darueber liegenden („Exploatatiile care depasesc acest prag nu
   *  sunt eligibile"). NEOTERRA startet mit 300 ha. Satz AJ 2025: 53,5212 EUR/ha. */
  { id: "s-criss", name: "CRISS — umverteilende Prämie (nur Betriebe ≤ 50 ha, hier ohne Anspruch)", basis: "per_ha", ratePerHaCent: 5352,
    firstHaCap: 50, pillar: 1, category: "criss", receiptPeriods: [11], payout: CAP_PAYOUT, active: false },
  // Oeko-Regelung PD-04 (Ackerbau-Gutpraxis) 56,28 EUR/ha statt der Pauschale 70. PD-28
  //  (Brache) ist NICHT angesetzt: der Betrieb bewirtschaftet bewaesserte Wertkulturen und
  //  legt keine Flaeche still — und der Satz faellt 2026 ohnehin von 49,45 auf 20 EUR/ha.
  { id: "s-eco", name: "Öko-Regelung PD-04 (Ackerbau-Gutpraxis)", basis: "per_ha", ratePerHaCent: 5628,
    pillar: 1, category: "eco", receiptPeriods: [11], payout: CAP_PAYOUT, active: true },
  // — VCP / Gekoppelte Stützung (Voluntary Coupled Payments · Sprijin Cuplat Vegetal) — KULTURSPEZIFISCH —
  /* PD-17 „Legume cultivate in camp" — die EINZIGE Kopplung, die eine Kultur dieses Plans
   *  erreicht. Foerderfaehig sind vier Arten: tomate, castraveti, ardei, vinete.
   *  Mindestertrag Tomate 15.000 kg/ha (Plan: 88 t/ha) und Vermarktungsnachweis bis 1. November;
   *  Lieferung an eine registrierte Verarbeitungseinheit zaehlt, Industrietomate ist also drin.
   *
   *  SATZ = 1.448,10 EUR/ha, der TATSAECHLICH AUSGEZAHLTE Betrag fuer Antragsjahr 2025
   *  (OMADR 42/2026 i.d.F. 141/2026, Monitorul Oficial 28.04.2026). Die 1.607 bis 1.614 EUR/ha
   *  aus dem Monitor sind PLANWERTE des Strategieplans, keine Zahlbetraege. Der Satz ist keine
   *  feste Groesse: er ergibt sich Jahr fuer Jahr aus Sektorumschlag geteilt durch die
   *  tatsaechlich beantragte Flaeche und schwankt entsprechend — 1.607,00 (AJ 2024) gegen
   *  1.448,10 (AJ 2025), also knapp zehn Prozent in einem Jahr. Angesetzt ist der letzte
   *  belegte Zahlbetrag; er ist konservativer als der Planwert und der einzige mit Beleg. */
  { id: "vcp-tomate", name: "VCP — Industrietomate (PD-17 Freilandgemüse)", basis: "per_ha", ratePerHaCent: 144810,
    cropIds: ["tomate"], pillar: 1, category: "vcp", receiptPeriods: [11], payout: CAP_PAYOUT, active: true },
  /* GEKOPPELTE STUETZUNG FUER ZWIEBEL/MOEHRE, SELLERIE UND SUESSKARTOFFEL: ABGESCHALTET.
   *
   *  Entscheidungsverlauf, weil er fuer die Bankunterlage nachvollziehbar sein muss:
   *   · 31.07.2026 — eine erste Recherche fand fuer die Intervention PD-17 „legume cultivate
   *     in camp" nur Tomate, Gurke, Paprika und Aubergine. Benedikt entschied, die Foerderung
   *     fuer die uebrigen Gemuesekulturen stehen zu lassen: die Betriebsseite gehe davon aus,
   *     dass sie gefoerdert werden.
   *   · 01.08.2026 — der Subventions-Monitor bestaetigt denselben Befund mit mehreren Quellen
   *     und beziffert ihn als groessten Hebel des Reports. Benedikt gibt die Abschaltung frei.
   *
   *  WIRKUNG: Zwiebel/Moehre 467 ha und Sellerie/Suesskartoffel 150 ha im Endausbau,
   *  zusammen 617 ha x 1.607 EUR/ha = rund 0,99 Mio EUR/Jahr weniger Foerderung ab 2032.
   *
   *  QUELLENLAGE, unveraendert offen: alle Belege des Monitors sind Agrarnachrichtenportale
   *  (agrointel.ro, agroinfo.ro, agro-tv.ro), NICHT der MADR-Ordin oder der APIA-Rechtstext.
   *  Sie stuetzen sich gegenseitig, ersetzen den Rechtstext aber nicht. Vor der Bankunterlage
   *  gehoert der Kulturkatalog von PD-17 im Original geprueft. Zurueckdrehen ist ein Schalter:
   *  `active: true` an den beiden Zeilen unten.
   */
  { id: "vcp-zwiebel", name: "VCP — Zwiebel / Möhre (nicht in PD-17 gelistet)", basis: "per_ha", ratePerHaCent: 160700,
    cropIds: ["zwiebel_moehre"], pillar: 1, category: "vcp", receiptPeriods: [11], payout: CAP_PAYOUT, active: false },
  { id: "vcp-gemuese-neu", name: "VCP — Sellerie / Süßkartoffel (nicht in PD-17 gelistet)", basis: "per_ha", ratePerHaCent: 160700,
    cropIds: ["knollensellerie", "suesskartoffel"], pillar: 1, category: "vcp", receiptPeriods: [11], payout: CAP_PAYOUT, active: false },
  /* KNOBLAUCH: KEINE gekoppelte Stuetzung. Am 01.08.2026 stand hier noch die Vermutung, es
   *  gebe eine eigene Intervention „sprijin cuplat usturoi" neben PD-17. Die Recherche gegen
   *  den Interventionskatalog des Strategieplans widerlegt das: die pflanzlichen Kopplungen
   *  sind PD-09 Soja, PD-10 Luzerne, PD-11 Koernerleguminosen, PD-12 Hanf, PD-13 Reis,
   *  PD-14 Pflanzkartoffel, PD-15 Hopfen, PD-16 Zuckerruebe, PD-17 Freilandgemuese,
   *  PD-18 Gemuese unter Glas, PD-19 Obst, PD-20 Futterpflanzensaatgut. Knoblauch kommt in
   *  keiner davon vor. Die Zeile ist damit gegenstandslos. */
  { id: "vcp-knoblauch", name: "VCP — Knoblauch (in keiner Kopplung enthalten)", basis: "per_ha", ratePerHaCent: 0,
    cropIds: ["knoblauch"], pillar: 1, category: "vcp", receiptPeriods: [11], payout: CAP_PAYOUT, active: false },
  /* PROGRAMUL USTUROIUL — der Knoblauch-Topf, den es WIRKLICH gibt, aber als nationale
   *  De-minimis-Beihilfe statt als CAP-Kopplung (HG 402/2026, Monitorul Oficial 444 vom
   *  26.05.2026). 3.000 EUR/ha klingt gross, die Deckel machen ihn klein:
   *   · hoechstens SECHS Hektar je Beguenstigtem — der Plan hat 50 ha Knoblauch,
   *   · De-minimis-Obergrenze 50.000 EUR je Unternehmen in drei Jahren, also im Schnitt
   *     rund 16.700 EUR im Jahr, und dieser Rahmen gilt fuer ALLE De-minimis-Beihilfen
   *     zusammen,
   *   · Mindestertrag 3,5 t/ha und Mindestdichte 30 Pflanzen/m2,
   *   · beschlossen ist das Programm fuer 2026; der Plan beginnt 2027.
   *  INAKTIV im Basisfall: eine einjaehrige De-minimis-Zusage acht Jahre fortzuschreiben
   *  waere keine Planung. Als Upside sichtbar — Schalter umlegen ergibt 18.000 EUR/Jahr
   *  (6 ha x 3.000), wovon die De-minimis-Grenze im dritten Jahr wieder etwas abschneidet. */
  { id: "min-usturoi", name: "Programul Usturoiul — De-minimis (max. 6 ha, Deckel 50 T€/3 J.)", basis: "per_ha",
    ratePerHaCent: 300000, firstHaCap: 6, cropIds: ["knoblauch"],
    pillar: 2, category: "agri_env", receiptPeriods: [11], payout: CAP_PAYOUT, active: false },
  // Soja ist im Solo-Modell keine Kultur mehr. Die Zeile lag aktiv da und haette gezahlt,
  //  sobald jemand Soja wieder in den Anbauplan nimmt.
  { id: "vcp-soja", name: "VCP — Soja (Kultur nicht im Plan)", basis: "per_ha", ratePerHaCent: 14198,
    cropIds: ["soja_luzerne"], pillar: 1, category: "vcp", receiptPeriods: [11], payout: CAP_PAYOUT, active: false },
    // Bestaetigt: gekoppelt gefoerdert wird nur PFLANZKARTOFFEL (PD-14 „samanta de cartof",
  //  1.806,30 EUR/ha im Antragsjahr 2025). Verarbeitungskartoffel faellt nicht darunter.
  { id: "vcp-kartoffel", name: "VCP — Verarbeitungskartoffel (nur Pflanzkartoffel wäre PD-14)", basis: "per_ha", ratePerHaCent: 0,
    cropIds: ["kartoffel_pommes", "kartoffel_chips"], pillar: 1, category: "vcp", receiptPeriods: [11], payout: CAP_PAYOUT, active: false },
  { id: "s-young", name: "Junglandwirte-Zuschlag (erste 100 ha, falls berechtigt)", basis: "per_ha", ratePerHaCent: 2600,
    firstHaCap: 100, pillar: 1, category: "young", receiptPeriods: [11], payout: CAP_PAYOUT, active: false },
  { id: "s-ant", name: "ANT — nationale Übergangshilfe (falls berechtigt)", basis: "per_ha", ratePerHaCent: 0,
    pillar: 1, category: "ant", receiptPeriods: [11], payout: CAP_PAYOUT, active: false },
  // — Säule 2: Ländliche Entwicklung (Platzhalter, Standort meist nicht berechtigt) —
  { id: "s-anc", name: "ANC — naturbedingte Nachteile (Standort meist n/a)", basis: "per_ha", ratePerHaCent: 0,
    pillar: 2, category: "anc", receiptPeriods: [11], payout: CAP_PAYOUT, active: false },
  { id: "s-agrienv", name: "Agrarumwelt-/Klima- & Bio-Maßnahmen (optional)", basis: "per_ha", ratePerHaCent: 0,
    pillar: 2, category: "agri_env", receiptPeriods: [11], payout: CAP_PAYOUT, active: false },
];

// RO-Payroll: CAS 25 % + CASS 10 % (AN einbehalten) · Impozit 10 % · CAM 2,25 % (AG).
const PERSONNEL: PersonnelPlan = {
  rates: { cas: 0.25, cass: 0.1, incomeTax: 0.1, cam: 0.0225, personalDeductionMonthly: 0 },
  roles: [
    { id: "r-leitung", title: "Betriebsleitung & Agronomie", headcountKey: "pers.leitung.n", grossMonthlyKey: "pers.leitung.gross", category: "leitung" },
    { id: "r-stamm", title: "Stamm-Maschinenführer", headcountKey: "pers.stamm.n", grossMonthlyKey: "pers.stamm.gross", category: "stamm" },
    { id: "r-bewaesserung", title: "Bewässerung / Pivot-Steuerung", headcountKey: "pers.bewaesserung.n", grossMonthlyKey: "pers.bewaesserung.gross", category: "betrieb" },
    { id: "r-lager", title: "Lager & Aufbereitung", headcountKey: "pers.lager.n", grossMonthlyKey: "pers.lager.gross", category: "betrieb" },
    { id: "r-service", title: "Werkstatt & Service/Technik", headcountKey: "pers.service.n", grossMonthlyKey: "pers.service.gross", category: "betrieb" },
    { id: "r-saison", title: "Saisonkräfte (Kampagne)", headcountKey: "pers.saison.n", grossMonthlyKey: "pers.saison.gross", category: "saison" },
    { id: "r-prakt", title: "Praktikanten / Trainees", headcountKey: "pers.prakt.n", grossMonthlyKey: "pers.prakt.gross", category: "saison" },
  ],
};

// Reine Verwaltungsholding als DEUTSCHE GmbH ohne eigenen Geschäftsbetrieb: laufende Kosten
// für Geschäftsführung, Rechnungswesen und Compliance. Entscheidung 30.07.2026 (Benedikt):
// Zypern ist nach Prüfung zu komplex (Substanzanforderungen, Management & Control, CFC-Risiko,
// Bankfähigkeit) — die GmbH ist teurer im Steuersatz (~29,8 % statt 12,5 %), aber auf
// Beteiligungserträge greift § 8b KStG (95 % steuerfrei), und die Struktur ist unstrittig.
// Werte €/Monat (CENT), editierbar.
const HC = (id: string, label: string, monthlyEur: number) => ({ id, label, monthlyCent: Math.round(monthlyEur * 100) });
const HOLDING: HoldingPlan = {
  name: "NEOS Holding GmbH",
  costItems: [
    // — Geschäftsführung & Organe —
    HC("h-board", "Geschäftsführung (Bezüge, inkl. AG-Anteil)", 1200),
    HC("h-beirat", "Beirat / Advisory Board (Sitzungsgelder)", 200),
    HC("h-do", "D&O-Versicherung", 150),
    HC("h-domizil", "Geschäftsräume / Domizil & Büro", 250),
    HC("h-staff", "Personal Holding (Payroll, optional — brutto inkl. AG-Anteil)", 0),
    // — Rechnungswesen & Compliance —
    HC("h-account", "Buchhaltung / Lohnbuchhaltung", 120),
    HC("h-abschluss", "Jahresabschluss & Offenlegung (Bundesanzeiger)", 110),
    HC("h-audit", "Prüfung / prüfungsnahe Beratung (falls prüfungspflichtig)", 80),
    HC("h-tax", "Steuerberatung (KSt/GewSt/USt-Erklärungen)", 150),
    HC("h-tp", "Verrechnungspreis-Dokumentation (IC-Fee/Darlehen RO↔DE)", 200),
    // — Recht, Bank, IT —
    HC("h-legal", "Recht & Gesellschaftsrecht (Notar, HR-Änderungen)", 90),
    HC("h-ihk", "IHK-Beitrag, Kammern & Gebühren", 20),
    HC("h-bank", "Bankgebühren / Kontoführung", 40),
    HC("h-it", "IT / Kommunikation", 80),
  ],
  managementFeeKey: "hold.fee",
  taxRateKey: "hold.taxrate",
  dividendWithholdingKey: "hold.wht",
};

// Multi-Entity-Register (Startbestand) — CUI per ANAF-Lookup befüllbar/prüfbar.
//  Struktur: deutsche Holding-GmbH hält 100 % der RO-OpCo.
/** NEOTERRA-SOLO (Entscheidung 30.07.2026): eine operative Gesellschaft plus die Holding.
 *  Besitzgesellschaft (NEOTERRA Land SRL) und Isolde Farms sind aus dem Modell entfernt —
 *  keine Intercompany-Miete, kein Kultur-Split über mehrere OpCos.
 *  Die Holding wird abgebildet, aber als DEUTSCHE GmbH statt als CY Ltd. */
const ENTITIES: Entity[] = [
  { id: "ent-holding", name: "NEOS Holding GmbH", role: "holding", country: "DE", ownershipPct: 100, cui: "", note: "Konzernmutter (Deutschland) · Beteiligung an der NEOTERRA SRL, § 8b KStG" },
  { id: "ent-opco", name: "NEOTERRA SRL", role: "opco", country: "RO", ownershipPct: 100, cui: "", note: "Betriebsgesellschaft · Wertkulturen (Măceșu de Jos)" },
];

/** Operative Anbau-Entities (Kultur-Split). NEOTERRA-OpCo = Wertkulturen (Hauptentity),
 *  Isolde = Cash-/Trockenrotation. Default-Zuordnung, im Register frei überschreibbar. */
export const ENTITY_NEOTERRA = "ent-opco";
/** Alt-Konstante: im Solo-Modell existiert Isolde nicht mehr. Bleibt nur, damit gespeicherte
 *  Stände mit explizitem entityId nicht ins Leere zeigen — alles fällt auf NEOTERRA zurück. */
export const ENTITY_ISOLDE = "ent-opco";
/** Standard-Gesellschaft einer Kultur (falls kein explizites entityId gesetzt): Value → NEOTERRA,
 *  Cash/Trockenrotation → Isolde. */
export function defaultEntityOf(_cropId: string): string {
  return ENTITY_NEOTERRA;   // Solo-Modell: alle Kulturen gehören NEOTERRA
}
/** Effektive Entity einer Anbauplan-Zeile (explizit oder abgeleitet). */
export function entityOfEntry(e: AnbauEntry): string {
  return e.entityId ?? defaultEntityOf(e.cropId);
}

// HINWEIS (Engine-Limit): computeModel liest openingBalance.debt NICHT — bs.debt
// wird ausschließlich aus dem in-Model-Tilgungsplan (state.debt) gespeist. Damit die
// Eröffnungsbilanz ausbalanciert IST (Σ Aktiva = Σ Passiva) UND balance_zero grün
// bleibt, ist ein nicht modellierbarer Alt-Schuldenstock ins Eröffnungs-Eigenkapital
// gefaltet (debt → 0). Aktiva 7.000.000.000 = payables + shareCapital + retainedEarnings.
// SOLO-MODELL: schlanke Startbilanz der NEOTERRA SRL zum 01.01.2027. Land gehört der (nicht
// modellierten) Besitzgesellschaft → 0; Sachanlagen und Vorräte baut das Modell selbst auf.
// Aktiva = Passiva: 2.000.000 € Kasse = 2.000.000 € Stammkapital. KALIBRIERUNGSPUNKT —
// sobald der tatsächliche Eröffnungsstand vorliegt, hier eintragen.
const OPENING_BALANCE: OpeningBalance = {
  cash: 200000000, land: 0, ppeNet: 0, inventory: 0, receivables: 0,
  payables: 0, debt: 0, shareCapital: 200000000, retainedEarnings: 0,
};

const BIO: BiologicalAssetPolicy = { enabled: false, fairValueAssumptionKeys: {} };

/* --------------------------------------------------------------------------
 * Corporate-Gemeinkosten / SG&A (Struktur wie in Unternehmen üblich) — Monatswerte CENT.
 * Editierbar & erweiterbar (domain.overhead); der Composer summiert sie in opex.sga.
 * ------------------------------------------------------------------------ */
const OV = (group: string, label: string, monthlyEur: number): OverheadItem => ({
  id: `ov-${group.slice(0, 3).toLowerCase()}-${label.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 20).toLowerCase()}`,
  group, label, monthlyCent: Math.round(monthlyEur * 100),
});
const GA = "Geschäftsführung & Verwaltung (G&A)";
/** ID der OpCo-Gegenbuchung zur Holding-Management-Fee (Abgleich-Check). */
export const HOLDING_FEE_OVERHEAD_ID = "ov-ges-management-fee-an-di";
const FIN = "Finanzen, Recht & Compliance";
const IT = "IT, Software & Digitalisierung";
const HR = "Personal (HR-Gemeinkosten)";
const SM = "Vertrieb & Marketing (S&D)";
const INS = "Versicherungen & Gebühren";
const QA = "Qualität, Zertifizierung & Beratung";
const PH = "Nachernte & Packhaus (Post-Harvest)";
const WH = "Kühllager & Lagerung (Warehouse)";
const LOG = "Logistik & Distribution";
const MKT = "Vermarktung & Handel";
const OTH = "Sonstiges / Puffer";
const SEED_OVERHEAD: OverheadItem[] = [
  OV(GA, "Geschäftsführung / Board / Management", 5000),
  OV(GA, "Zentrale Verwaltung / Office & Sekretariat", 1500),
  OV(GA, "Reisekosten & Repräsentation", 800),
  // GEGENBUCHUNG zur Management-Fee der Holding (hold.fee, 4.167 €/Monat). Die Holding
  //  vereinnahmte sie als Intercompany-Ertrag, die OpCo trug sie nirgends — 50 T€ im Jahr
  //  Konzernergebnis aus dem Nichts. Der Check `ic_mgmt_fee` meldet ein Auseinanderlaufen.
  OV(GA, "Management-Fee an die Holding (IC)", 4167),
  OV(FIN, "Buchhaltung & Controlling", 1500),
  OV(FIN, "Wirtschaftsprüfung / Audit", 1000),
  OV(FIN, "Recht & Compliance", 1000),
  OV(FIN, "Steuerberatung", 800),
  OV(IT, "Software-Entwicklung (In-house Dev-Team)", 4000),
  OV(IT, "IT-Infrastruktur, Cloud & Support", 1200),
  OV(IT, "ERP / Warenwirtschaft (Lizenzen)", 1000),
  OV(IT, "Rückverfolgbarkeit / QS- & Lager-Software", 700),
  OV(HR, "Recruiting & Schulung", 800),
  OV(HR, "Arbeitsschutz & Arbeitsmedizin", 600),
  OV(SM, "Vertrieb & Key-Account", 1500),
  OV(SM, "Marketing & Kommunikation", 800),
  // — Nachernte & Packhaus —
  OV(PH, "Packhaus-Personal (Sortierung, Verpackung, QS)", 6000),
  OV(PH, "Verpackungsmaterial (Kisten, Folien, Etiketten, Paletten)", 5000),
  OV(PH, "Sortier-/Wasch-/Kalibrieranlagen (Betrieb & Wartung)", 1500),
  OV(PH, "Energie & Wasser Packhaus", 1200),
  OV(PH, "Ausschuss / Schwund (Post-Harvest-Verluste)", 2500),
  OV(PH, "Externe Lohn-Packung / Dienstleister", 1000),
  // — Kühllager & Lagerung —
  OV(WH, "Kühl-/CA-Lager Energie (Strom Kühlung)", 3500),
  OV(WH, "Lagerpersonal (Ein-/Auslagerung, Kommissionierung)", 2500),
  OV(WH, "Wartung Kühltechnik & Anlagen", 900),
  OV(WH, "CA-Gase / Kühlmittel", 500),
  OV(WH, "Lagerschwund / Qualitätsverlust", 1500),
  // — Logistik & Distribution —
  // ENTFERNT 31.07.2026: „Auslieferung / Fracht zum Handel (OpEx)", 4.000 €/Monat.
  //  Der Abtransport zum Abnehmer wird vollständig in `opex.transport` gerechnet — aus der
  //  Make-or-Buy-Entscheidung (Eigenflotte gegen Spedition, ~70 km, Tonnage der Wertkulturen).
  //  Die SG&A-Zeile war eine zweite, pauschale Erfassung derselben Fracht: 48 T€/Jahr doppelt.
  //  Der Kühltransport-Zuschlag bleibt — er ist ein Aufschlag AUF die Fracht, keine zweite Fracht.
  OV(LOG, "Kühltransport-Zuschlag", 800),
  OV(LOG, "Verladung & Ladungssicherung", 700),
  OV(LOG, "Export / Zoll / Dokumentation", 600),
  OV(LOG, "Paletten-Pool / EPAL-Tausch", 500),
  // — Vermarktung & Handel —
  OV(MKT, "Handelsprovisionen / Vermittler", 2500),
  OV(MKT, "Listungs- / Slotting-Gebühren (Handel)", 1500),
  OV(MKT, "Boni / Rückvergütungen (Handel)", 2000),
  OV(MKT, "Reklamationen / Retouren / Gutschriften", 1000),
  OV(MKT, "Messen, Kundenbindung & Sampling", 700),
  OV(INS, "Betriebsversicherungen (nicht-Maschine)", 3000),
  OV(INS, "Bank- / Finanzierungsgebühren (nicht-Zins)", 600),
  OV(INS, "Abgaben, Gebühren, Grundsteuer", 2000),
  OV(QA, "Zertifizierung (GlobalG.A.P. / IFS / Bio) & QA", 1500),
  OV(QA, "Labor / Rückstandsanalysen", 800),
  OV(QA, "Agronomie- / Fachberatung", 1000),
  OV(OTH, "Sonstige Gemeinkosten / Contingency", 1500),
];
export const OVERHEAD_GROUPS: string[] = [GA, FIN, IT, HR, PH, WH, LOG, MKT, SM, INS, QA, OTH];
/** Overhead-Gruppen, die mit der PRODUKTIONSMENGE laufen (Nachernte, Lager, Logistik, Handel) —
 *  im Gegensatz zum Corporate-Block (G&A, Finanzen, IT, HR, Vertrieb, Versicherung, QS, Sonstiges),
 *  der weitgehend fix ist. Die Seed-Beträge sind auf den ZIELZUSTAND des Programms kalibriert
 *  (letztes Planjahr), nicht auf das Startjahr — deshalb wird relativ zum Ziel skaliert und nicht
 *  vom Startjahr hochmultipliziert. Ohne diese Trennung trüge 2027 mit 300 ha den vollen
 *  Gemeinkostenblock eines 2.334-ha-Programms. */
export const OVERHEAD_VOLUME_GROUPS: ReadonlySet<string> = new Set([PH, WH, LOG, MKT]);
/** Gemeinkosten-Gruppen, die es NUR mit eigenem Lager/Packhaus gibt (Schalter `store.active`).
 *  Steht der Schalter auf 0 — dem heutigen Plan: die Ware geht Feld → Verarbeiter —, dann gibt
 *  es weder Kühlenergie noch Sortierlinie noch Packmaterial, und die beiden Blöcke müssen aus
 *  den SG&A verschwinden. Sie liefen bisher unabhängig davon voll mit. */
export const OVERHEAD_STORE_GROUPS: ReadonlySet<string> = new Set([PH, WH]);

/* --------------------------------------------------------------------------
 * ABNAHMEVERTRÄGE (Off-take) — aus den drei geprüften Kartoffelkontrakten.
 * Quelle: Projektdoku „NEOS-FX-Abnahmeverträge-Kartoffel". Alle Preise CENT/t.
 * Umrechnung RON → EUR mit 5,0 (Vertragskurs-Näherung).
 * Die Mechanik ist generisch über cropId — befüllt ist bislang nur Kartoffel.
 * ------------------------------------------------------------------------ */
export const OFFTAKE_SEED: OfftakeContract[] = [
  {
    // Rahmenvertrag bis 30.12.2026. Anexa 1 (Menge/Basispreis) ist UNBEFÜLLT →
    // Preis ist ein Platzhalter auf Höhe des Kulturpreises und in der Ansicht markiert.
    // Bonus/Malus-Leiter −0,15 … +0,11 RON/kg ist asymmetrisch nach unten → Erwartungswert 0.
    id: "ot-viaagro",
    buyer: "VIA AGRO S.R.L.",
    cropId: "kartoffel_pommes",
    active: false,   // Vertrag 2025 — Beleg, nicht Planungsgrundlage
    volumeMode: "share",
    share: 0.10,
    priceCentPerTonne: 23500,
    priceConfirmed: false,
    bonusCentPerTonne: 0,
    bonusDelayDays: 90,   // Qualitäts-/Lagerbonus separat fakturiert, frühestens ab 01.12.
    dsoDays: 47,          // 50 % @ 15 AT · 25 % @ 45 AT · 25 % @ 60 AT ≈ 21/63/84 KT
    rejectRate: 0,
    storage: "bonus",
    coverPurchase: true,  // 3.6 / 5.10 — Deckungskauf zulasten NEOTERRA
    assignable: false,    // 14.3 — Abtretung nur mit schriftlicher Zustimmung
    note: "Basispreis in Anexa 1 nicht befüllt — Platzhalter. Mengenanteil ist eine Planungsannahme. Dürre ist ausdrücklich KEIN Entschuldigungsgrund (§6.6).",
  },
  {
    // Vertrag NEO-19378495, 06.04.2026 – 31.01.2027, 1.000 t (2 × 500 t).
    // Basis 1.100 RON/t = 220 €/t. Bonus: +100 RON/t Menge (≥95 %) + 47,5–77 RON/t Defektstufe.
    // Angesetzt: Mengenbonus erreicht + mittlere Defektstufe 56 RON/t → 156 RON/t = 31,20 €/t.
    id: "ot-pepsico",
    buyer: "STAR FOODS E.M. S.R.L. (PepsiCo)",
    cropId: "kartoffel_chips",
    active: false,  // Vertrag 2025 — Beleg, nicht Planungsgrundlage
    volumeMode: "tonnes",
    tonnesPerYear: 1000,
    priceCentPerTonne: 22000,
    priceConfirmed: true,
    bonusCentPerTonne: 3120,
    dsoDays: 28,          // nominell 14 d, effektiv 14–28+ (Sperrfenster Monatsanfang/Feiertage/21.–31.12.)
    rejectRate: 0,
    storage: "atCost",    // bis ~6 Monate auf Kosten und Risiko NEOTERRA, ohne Prämie
    coverPurchase: true,  // ohne Deckelung
    assignable: true,
    note: "Kein Investitionsschutz (Art. 13.3), Kündigung beidseitig mit 30 Tagen. Carbon Credits vertraglich blockiert.",
  },
  {
    // SALES CONTRACT NO 03/2026, 17.03. – 01.10.2026, 28,2 ha × 36 t/ha = 1.015,2 t, 240 €/t FCA.
    id: "ot-pestova",
    buyer: "Pestova shpk (XK)",
    cropId: "kartoffel_chips",
    active: false,  // Vertrag 2025 — Beleg, nicht Planungsgrundlage
    volumeMode: "tonnes",
    tonnesPerYear: 1015.2,
    priceCentPerTonne: 24000,
    priceConfirmed: true,
    bonusCentPerTonne: 0,
    dsoDays: 14,
    rejectRate: 0,
    storage: "none",      // Lagerung beim Erzeuger ausdrücklich ausgeschlossen
    coverPurchase: false,
    assignable: false,    // Eigentumsgarantie + Aufrechnung gegen Kaufvertrag Nr. 4/2026
    note: "Zahlung ggf. per Aufrechnung gegen Maschinen-Kaufvertrag Nr. 4/2026 (Verpackungsanlage) — dann Sachleistung statt Cash. 36 t/ha sind vertraglich bindend.",
  },
];

/* --------------------------------------------------------------------------
 * SEED — die vollständig vorbefüllte Domäne (Default: Stufe 1).
 * ------------------------------------------------------------------------ */
/** Flotte auf die Wertkulturen zuschneiden: Feldmaschinen nur, wenn ein Arbeitsgang einer
 *  Wertkultur sie nutzt; Träger, wenn ihr Anbaugerät genutzt wird. Beregnung, Lager und
 *  Logistik (Radlader/Shuttle) bleiben immer. Gleiche Regel wie scopeToValueOnly — hier
 *  aber schon im SEED, weil das Solo-Modell gar keinen Ackerbau mehr kennt. */
function valueCropMachineCatalog(catalog: MachineType[]): MachineType[] {
  const used = new Set<string>();
  for (const cid of Object.keys(SKALIERUNG_HA)) for (const g of ARBEITSGAENGE[cid as CropId] ?? []) used.add(g.m);
  return catalog.filter((m) => {
    if (m.mode !== "fixedFleet") return true;
    // SPRITZEN bleiben IMMER. Ihre Stückzahl kommt aus deriveSprayFleet (Fenster-/Peak-Rechnung
    //  über alle Kulturen), nicht aus einem Arbeitsgang — die Arbeitsgänge nennen das
    //  Kostenprofil `spritze14`, das bewusst mit fleet 0 läuft, damit spray_gz/spray_sf den
    //  CAPEX allein tragen. Diese Filterzeile hat genau die beiden aber herausgeworfen, weil
    //  sie ein cEff haben und in keinem Arbeitsgang stehen: der gesamte Pflanzenschutz-
    //  Maschinenpark (5 gezogene + 2 Selbstfahrer) stand mit null Euro CAPEX im Plan,
    //  während der Betrieb ihre Diesel-, Reparatur- und Fahrerkosten voll verbuchte.
    if (m.sprayPart) return true;
    if (m.cEff) return used.has(m.id);
    if (m.serviceHoursLike) return used.has(m.serviceHoursLike);
    return true;
  });
}

/** STAMMDATEN-VERSION. Bei JEDER Änderung an Maschinenkatalog, Listenpreisen (`mprice.*`),
 *  Gemeinkosten-Register oder Subventionsregister um eins erhöhen.
 *
 *  WARUM DAS NÖTIG IST: Ein gespeicherter Stand (Cloud-Autosave, lokaler Browser-Stand,
 *  JSON-Import) trägt seinen EIGENEN Maschinenkatalog und überschreibt beim Laden den Seed.
 *  Am 01.08.2026 hieß der Schlepper im Modell längst „JD 8R 410" zu 523.813 €, auf dem
 *  Bildschirm stand weiter „JD 9R 590" zu 700.336 €; Einzelkorn-Sämaschine, Krautschläger und
 *  Mähdrescher waren im Modell gelöscht und in der Ansicht vorhanden. Jede Korrektur an den
 *  Stammdaten verpuffte still — man sah sie nur in einem frisch zurückgesetzten Stand.
 *
 *  Die Version trennt sauber: STAMMDATEN (Katalog, Listenpreise, Registerzeilen) gehören dem
 *  Modell und werden bei einem Versionssprung nachgezogen. PLANENTSCHEIDUNGEN (Flächen,
 *  Kulturpfade, Beschaffung je Klasse, Bestand, Handeingaben, Verträge, Szenariowerte) gehören
 *  dem Nutzer und bleiben unberührt. */
export const STAMMDATEN_VERSION = 5;   // 5 = Subventionen gegen den MADR-Ordin geprueft

/** Felder des Maschinenkatalogs, die dem NUTZER gehören und einen Versionssprung überleben. */
const MASCHINE_NUTZERFELDER = ["ownedUnits", "rentedUnits", "rentedFrom", "ownedAgeYears", "ownedHoursTotal"] as const;

export const SEED: Domain = {
  stammdatenVersion: STAMMDATEN_VERSION,
  meta: { id: "neos-fx", name: "NEOTERRA SRL · Wertkulturen (Skalierungspfad ab 2027)", reportingCurrency: "EUR" },
  stage: 1,
  scope: "full",
  timeline: TIMELINE,
  scenarios: SCENARIOS,
  baseScenarioId: base,
  assumptions: ASSUMPTIONS,
  catalog: CATALOG,
  // Flotte NUR die von den Wertkulturen genutzte Technik — Mähdrescher & Getreidekette
  //  gehörten zum Ackerbau (Isolde) und sind im Solo-Modell entfallen.
  machineCatalog: valueCropMachineCatalog(MACHINE_CATALOG),
  anbauplan: buildAnbauplan(1),
  arbeitsgaenge: ARBEITSGAENGE,
  // Lohnarbeit: Register je Kultur × Arbeitsgang, ALLE Zeilen inaktiv. Erst das Scharfschalten
  //  im Screen nimmt den Gang aus der Eigenmechanisierung und bucht den Satz je ha.
  lohnarbeit: buildLohnarbeit(),
  decisions: { transportToBuyer: "own" },
  debt: DEBT,
  financingContracts: FINANCING_CONTRACTS,
  revolver: REVOLVER,
  workingCapital: WORKING_CAPITAL,
  tax: TAX,
  vat: VAT,
  subsidies: SUBSIDIES,
  personnel: PERSONNEL,
  holding: HOLDING,   // NEOS Holding GmbH (DE) — Kosten & Steuer in der Holding-Ansicht
  entities: ENTITIES,
  consolidation: { active: false }, // opt-in: Konzern-Sicht erst per Schalter im Register einblenden
  openingBalance: OPENING_BALANCE,
  biologicalAssets: BIO,
  overhead: SEED_OVERHEAD,
  growth: GROWTH,
  standort: { name: "Măceșu de Jos · Süd-Dolj (Oltenien)", rainfallMm: 550, soil: "chernozem", summerHeat: "hoch" },
  // Kultur-Skalierungspolitik: EXPLIZITER Skalierungspfad (SKALIERUNG_HA) für alle Spezial-
  //  kulturen — 2027 nur 300 ha Kartoffel, Hochlauf auf 1.000 ha bis 2031, übrige Wertkulturen
  //  ab 2028. Ersetzt den bisherigen "ramp so schnell wie der Anbaupause-Cap erlaubt"-Automatismus
  //  (der 2027 sofort 1.000 ha Kartoffel gestellt hätte). Ackerbau füllt die Rotation als Residual.
  //  Marktanalyse 24.07.: Absatzobergrenzen bleiben als Sicherung ÜBER dem Pfad aktiv —
  //  Zwiebel/Möhre ~60 kt, Knollensellerie ~22 kt (HS-070690-Pool).
  cropPolicy: {
    ...skalierungPolicy(1),
    zwiebel_moehre: { ...skalierungPolicy(1).zwiebel_moehre, capTonnes: 60000 },
    knollensellerie: { ...skalierungPolicy(1).knollensellerie, capTonnes: 22000 },
  },
  // Bodenprobenahme (Handoff-SSOT): Default Precision (1 ha/Probe, 4-J-Turnus), Eigen wirtschaftlich überlegen.
  soilSampling: {
    active: false, // Opt-in: erst per Aktiv-Schalter im Bodenprobenahme-Rechner ins Modell übernehmen.
    mode: "eigen", flaecheHa: 10000, soilGrid: 1, soilTurnus: 4, soilPerDay: 80, soilDays: 60,
    pSamplerCent: 3400000, pUTVCent: 2100000, pITCent: 866000, pMiscCent: 250000,
    holdYears: 8, residPct: 0.35, zins: 0.04,
    fixInsurCent: 60000, fixRomposCent: 45000, fixMaintCent: 150000, fixFlowCent: 0,
    varPersCent: 275, varFuelCent: 80, varConsCent: 50, varLabCent: 1300,
    dlCent: 4300,
  },
  gesellschafterIst: { umsatzCent: 0, ebitdaCent: 0, netIncomeCent: 0, flaecheHa: 10000 },
  productCatalog: DEFAULT_PRODUCTS,
  capexPlan: CAPEX_PLAN_SEED,
  // maschinen-Block per Default AKTIV (trägt IoT/FMS, das aus dem Katalog hierher gezogen wurde);
  //  Infrastruktur-Blöcke inaktiv → deren Auto-Blöcke laufen, Detailzeilen sind reine Planung.
  // LAGER UND PACKHAUS SCHARF (Entscheidung Betrieb 03.08.2026). Damit laeuft die
  //  Investitionsplanung fuer beide Bloecke ueber das Detailregister — als eigenes
  //  Projekt mit eigenen Mengen, Preisen, Foerderquoten und Finanzierung — statt
  //  ueber die flaechengetriebene Automatik.
  capexPlanActive: { maschinen: true, lager: true, packhaus: true },
  // Fahrgassen-Ökonomie (Neoterra-Kartoffelplanung): 40 Kreispivots Ø 40 ha (25–60 ha).
  //  Kartoffel 75-cm-Reihen, Pflanzer 4 R = 3,0 m → gültige Spritzbreiten = Vielfache von 3 m.
  //  Fahrgassen-Schema: 2 ausgesparte Reihen je Spritzbreite (Radstand 2,25 m = 3 Reihen, 2 Dämme
  //  zwischen den Rädern). Fahrgassenverlust = 2·0,75 / Boom (36 m → 4,2 %, 48 m → 3,1 %).
  //  Randverlust (Kreis-Fit) editierbar über randFactor. Kapital: 250 k€ @36 m (40 % RW) vs. 275 k€
  //  @48 m (30 % RW) → +4.250 €/a Wertverlust. Quelle: Session „Spritze Kartoffel nicht erfasst".
  tramline: {
    // Modell-Stufe 1: 80 Pivots à 50 ha = 4.000 ha beregnet (Neoterra-Portfolio real Ø 40 ha, 25–60 ha).
    pivotHa: 50, pivots: 80, boomBase: 36, boomAlt: 48, planterM: 3, randFactor: 0.39,
    capPriceBaseCent: 25000000, capResBasePct: 0.40, capPriceAltCent: 27500000, capResAltPct: 0.30,
    crops: [
      { key: "kartoffel", label: "Kartoffel", areaHa: 667, rowM: 0.75, tramlineRows: 2, yieldT: 45, priceEurTCent: 23000 },
      { key: "tomate", label: "Industrietomate", areaHa: 667, rowM: 1.50, tramlineRows: 1, yieldT: 88, priceEurTCent: 12000 },
      { key: "zwiebel_moehre", label: "Zwiebel / Möhre", areaHa: 667, rowM: 0.75, tramlineRows: 2, yieldT: 60, priceEurTCent: 17500 },
    ],
    // Cash Crops @ Stufe 1: 6.000 ha Trockenrotation (Getreide/Raps) — 10.000 ha gesamt = 4.000 ha
    //  Wertkulturen (beregnet) + 6.000 ha Cash Crops. +33 % Schlagkraft (24,1 → 32,1 ha/h) am Spritz-Peak.
    // Cash-Crop-Block (6.000 ha Trockenrotation) gehörte Isolde — im Solo-Modell auf 0.
    cash: { areaHa: 0, passes: 4, cEffBaseHaH: 24.1, windowDays: 10, hoursDay: 16, sprayerCapexCent: 40000000, operatorYearCent: 5000000 },
  },
  transport: { ...TRANSPORT_DEFAULT },
  // Pacht: ~2.500 ha Eigentum der Besitzgesellschaft, an die OpCo verpachtet. Süd-Dolj-Arendă
  //  ~300 €/ha, Index-Stufe +8 % alle 5 Jahre (≈ 1,5 %/Jahr CPI-nah). Editierbar im Simulator.
  // Solo-Modell: NEOTERRA besitzt keine Fläche (die Besitzgesellschaft ist nicht Teil des Modells) —
  //  die gesamte bewirtschaftete Fläche ist Dritt-Pacht zum Süd-Dolj-Satz.
  pacht: { ratePerHaByYear: Array.from({ length: N_YEARS }, () => PACHT_PER_HA_CENT),
    ownedHa: 0, baseRentPerHaCent: 0, indexPct: 0, intervalYears: 5, indexBasis: "fixed",
    ifrs16: false, leaseTermYears: 15, discountRate: 0.05,
    payMonths: [{ month: 8, share: 0.6 }, { month: 10, share: 0.4 }] },
  // Tornado-Zeilen referenzieren die Treiber-Bibliothek des Szenario-Studios.
  // Trockenjahr / Preisverfall Kartoffel / Zins- & Kostenschock sind dort als
  // eingebaute Szenarien hinterlegt — hier stehen nur eigene Szenarien.
  sensitivity: {
    tornado: [
      { id: "priceValue", delta: 0.15 }, { id: "yieldValue", delta: 0.10 }, { id: "qualValue", delta: 0.08 },
      { id: "priceRot", delta: 0.15 }, { id: "price.diesel_l", delta: 0.20 }, { id: "fertAll", delta: 0.20 },
      { id: "wageAll", delta: 0.15 }, { id: "macro.euribor", delta: 0.30 }, { id: "subsidy.factor", delta: 0.20 },
    ],
    scenarios: [],
  },
  offtake: OFFTAKE_SEED,
  harvestAdvance: HARVEST_ADVANCE,
};

/* --------------------------------------------------------------------------
 * Skalar-Auflösung einer Annahme (konstante Profile, Szenario-Kette).
 * ------------------------------------------------------------------------ */
function scenarioChainOf(domain: Domain, scenarioId: string): string[] {
  const byId = new Map(domain.scenarios.map((s) => [s.id, s]));
  const chain: string[] = [];
  const guard = new Set<string>();
  let cur = byId.get(scenarioId);
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.push(cur.id);
    cur = cur.inheritsFrom ? byId.get(cur.inheritsFrom) : undefined;
  }
  if (!chain.includes(domain.baseScenarioId)) chain.push(domain.baseScenarioId);
  return chain;
}

/** Auflösen eines Annahmewerts (Periode 0 / konstant) für ein Szenario. */
export function resolveScalar(domain: Domain, key: string, scenarioId: string): number {
  const a = domain.assumptions[key];
  if (!a) return 0;
  for (const sid of scenarioChainOf(domain, scenarioId)) {
    const prof = a.scenarioProfiles[sid];
    if (prof) {
      switch (prof.kind) {
        case "constant": return prof.value;
        case "growth": return prof.base;
        case "ramp": return prof.from;
        case "curve": return prof.values[0] ?? 0;
        case "seasonal": return prof.annual * (prof.weights[0] ?? 0);
      }
    }
  }
  return 0;
}

/* --------------------------------------------------------------------------
 * Maschinen-Betriebskosten je ha (COGS) aus den Arbeitsgängen (Referenz C):
 *  €/ha_op = Überfahrten / C_eff × operating€/h  (operating = Vers+Rep+Diesel+Schmier).
 *  Quelle der Arbeitsgänge: domain.arbeitsgaenge (editierbar).
 * ------------------------------------------------------------------------ */
/** Maschinen-Betriebskosten je ha in CENT (Σ passes/C_eff × operating€/h). */
export function machineOpCostPerHaCent(domain: Domain, cropId: string, scenarioId: string, y = 0): number {
  const dieselPriceCent = resolveScalar(domain, "price.diesel_l", scenarioId);
  const bf = sprayBoomFactor(domain, scenarioId); // 48-m-Paket: breiteres Gestänge → weniger Spritz-Std/ha
  const byId = new Map(domain.machineCatalog.map((m) => [m.id, m]));
  const gaenge = domain.arbeitsgaenge[cropId] ?? [];
  // Fremdvergebene Gänge: Versicherung, Reparatur und Schmierstoff entfallen — der DIESEL nicht,
  //  denn die Lohnsätze sind ohne Kraftstoff kalkuliert (dieselIncluded kehrt das um).
  const lohn = lohnGaengeOf(domain, cropId, y);
  const dieselAuchWeg = new Set((domain.lohnarbeit ?? [])
    .filter((e) => e.cropId === cropId && e.dieselIncluded && lohnAktivIn(e, y)).map((e) => e.machineId));
  let cent = 0;
  for (const g of gaenge) {
    const m = byId.get(g.m);
    if (!m || !m.cEff) continue;
    // Spritze: effektive C_eff skaliert mit der Gestängebreite (36 m → 48 m = +33 % ha/h).
    const cEff = m.id === "spritze14" ? m.cEff * bf : m.cEff;
    const fremd = lohn.has(g.m);
    const opPerHourCent =
      (fremd ? 0 : (m.insurancePerHourCent ?? 0) + (m.repairPerHourCent ?? 0) + (m.lubePerHourCent ?? 0)) +
      (fremd && dieselAuchWeg.has(g.m) ? 0 : (m.dieselLPerHour ?? 0) * dieselPriceCent);
    cent += (g.passes / cEff) * opPerHourCent;
  }
  return cent; // CENT/ha
}

/** Maschinen-Fixkosten (AfA + kalk. Zins) je ha in CENT aus den Arbeitsgängen:
 *  Σ passes / C_eff × (AfA+Zins)€/h. Entspricht machineFull − machineOp (§3-Reconciliation). */
export function machineAfaZinsPerHaCent(domain: Domain, cropId: string, scenarioId: string, y = 0): number {
  const byId = new Map(domain.machineCatalog.map((m) => [m.id, m]));
  const gaenge = domain.arbeitsgaenge[cropId] ?? [];
  const lohn = lohnGaengeOf(domain, cropId, y);   // fremdvergeben ⇒ kein eigenes Kapital gebunden
  let cent = 0;
  for (const g of gaenge) {
    const m = byId.get(g.m);
    if (!m || !m.cEff || lohn.has(g.m)) continue;
    const afaZinsPerHourCent = (m.afaPerHourCent ?? 0) + (m.interestPerHourCent ?? 0);
    cent += (g.passes / m.cEff) * afaZinsPerHourCent;
  }
  return cent; // CENT/ha
}

/* --------------------------------------------------------------------------
 * deriveCropMassnahmen — je Kultur die vollständige, chronologische Maßnahmenkette
 *  (ab Grundbodenbearbeitung nach Vorernte): Maschine + Überfahrten + Betriebsmittel
 *  (mit Menge & Einheit) + Diesel (l/ha) + Fahrer (Ak-h/ha) + €/ha. Führt die Maschinen-
 *  kette (arbeitsgaenge) und die Betriebsmittelkette (catalog ops) zusammen. Basis für
 *  Kosten- UND Maschinenanforderung (→ Sizing → Investition − Bestand).
 * ------------------------------------------------------------------------ */
const MON_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const monLabel = (p: number) => MON_DE[((Math.round(p) % 12) + 12) % 12];
/** Realistische Aussaat-/Pflanzmonate (0=Jan) für die Maßnahmen-Timeline (Süd-Dolj).
 *  Winterkulturen im Herbst; Ernte aus CROP_CAL.harvest. Nur Anzeige/Reihenfolge. */
const SOW_MONTH: Record<string, number> = {
  weizen: 9, gerste_zw: 9, soja_luzerne: 3, winterraps: 8, mais: 3,
  tomate: 4, kartoffel_pommes: 3, kartoffel_chips: 3, zwiebel_moehre: 2,
};
/** Maßnahmen-Anker: BBCH-Stadium + Timing RELATIV zur Saat (S) bzw. Ernte (E) — der Kalender-
 *  monat ist nur abgeleitete Anzeige (sow + Offset). S−45 = 45 Tage vor Saat. */
const MACHINE_PHASE: Record<string, { phase: string; order: number; bbch: string; timing: string; when: (sow: number, harv: number) => number }> = {
  pflug: { phase: "Grundbodenbearbeitung (nach Vorernte)", order: 1, bbch: "— (Stoppel)", timing: "S − 60…40 T", when: (s) => s - 2 },
  saatbett: { phase: "Saatbettbereitung", order: 2, bbch: "—", timing: "S − 10…2 T", when: (s) => s - 0.4 },
  drille: { phase: "Aussaat (Drille)", order: 3, bbch: "00", timing: "S (Saat)", when: (s) => s },
  einzelkorn: { phase: "Aussaat (Einzelkorn)", order: 3, bbch: "00", timing: "S (Saat)", when: (s) => s },
  gem_saat: { phase: "Aussaat Feingemüse (Beet)", order: 3, bbch: "00", timing: "S (Saat)", when: (s) => s },
  knobl_lege: { phase: "Stecken (Knoblauch, Zehenausrichtung)", order: 3, bbch: "00", timing: "S (Legen)", when: (s) => s },
  onepass: { phase: "Legen/Pflanzung (One-Pass)", order: 3, bbch: "00", timing: "S (Legen)", when: (s) => s },
  tompflanz: { phase: "Pflanzung", order: 3, bbch: "00 (Jungpfl.)", timing: "S (Pflanzung)", when: (s) => s },
  streuer: { phase: "Düngung (Grund + Kopf, Streuer)", order: 4, bbch: "00–49", timing: "Gaben lt. BBCH-Programm", when: (s) => s },
  spritze14: { phase: "Pflanzenschutz (Überfahrten)", order: 5, bbch: "lt. Programm", timing: "Fenster je Überfahrt", when: (s, h) => (s + h) / 2 },
  krautschl: { phase: "Krautschlagen (Abreife einleiten)", order: 6, bbch: "91–95", timing: "E − 14…10 T", when: (_s, h) => h - 1 },
  maehdr: { phase: "Ernte (Mähdrusch)", order: 7, bbch: "87–92", timing: "E (Reife)", when: (_s, h) => h },
  roder_ropa: { phase: "Ernte (Rodung)", order: 7, bbch: "95–97", timing: "E (Schalenfest)", when: (_s, h) => h },
  tomernte: { phase: "Ernte (Vollernter)", order: 7, bbch: "89 (>90 % rot)", timing: "E (Reife/Brix)", when: (_s, h) => h },
  gem_schwad: { phase: "Ernte Zwiebel — Schwadlegen (Stufe 1)", order: 6.8, bbch: "48–49 (Schlotten kippen)", timing: "E − 10…5 T", when: (_s, h) => h - 0.3 },
  gem_lader: { phase: "Ernte Zwiebel — Aufnahme (Stufe 2)", order: 7, bbch: "49 (abgetrocknet)", timing: "E (nach Feldtrocknung)", when: (_s, h) => h },
  gem_moehre: { phase: "Ernte Möhre (Klemmbandroder)", order: 7, bbch: "49", timing: "E (Rodung)", when: (_s, h) => h },
  transport: { phase: "Abtransport (In-Field)", order: 8, bbch: "—", timing: "mit Ernte (E)", when: (_s, h) => h },
};
export type MassnahmeBM = {
  label: string; qty: number; unit: string; cent: number; physical: boolean;
  /** Editier-Referenzen (Kostenkatalog integriert): Katalog-Op + Zeilenindex + Preis-Assumption. */
  opCode: string; lineIdx: number; unitCostKey: string; unitPriceCent: number;
  /** Verknüpftes Produkt (Produktkatalog) — falls gesetzt. */
  productId?: string;
  /** Stabile Maßnahmen-ID der Zeile (für FMS-Abgleich). */
  mid?: string;
};
export type CropMassnahme = {
  order: number; phase: string; monat: string; kind: "machine" | "input";
  /** BBCH-Stadium + Timing relativ zu Saat (S) / Ernte (E) — der eigentliche Treiber. */
  bbch: string; timing: string;
  machineId?: string; machineLabel?: string; passes: number;
  /** Stabile Maßnahmen-ID (FMS-Abgleich Plan ↔ Ist) — eindeutig je geplanter Maßnahme. */
  measureId: string;
  /** Katalog-Op-Code dieser Maßnahme (falls sie Betriebsmittel führt) — für Add/Delete im Journal. */
  opCode?: string;
  /** Zeilen-Indizes im opCode-Op, die zu DIESER Maßnahme gehören (für gezieltes Löschen). */
  lineIdxs?: number[];
  /** Applikationsart-Hinweis (Fertigation/Unterfuß), wenn keine eigene Maschinen-Überfahrt. */
  applyHint?: string;
  bm: MassnahmeBM[]; dieselLHa: number; fahrerHHa: number;
  maschineCent: number; bmCent: number; totalCent: number;
};
export type CropCalc = {
  cropId: string; name: string; areaHa: number; rows: CropMassnahme[];
  totals: { maschineCent: number; bmCent: number; dieselLHa: number; dieselCent: number; fahrerHHa: number; totalCent: number;
    seedCent: number; fertCent: number; psmCent: number; waterCent: number; materialCent: number; handCent: number };
};
export function deriveCropMassnahmen(domain: Domain, cropId: string, scenarioId: string, jahrIdx = 0): CropCalc {
  const entry = domain.catalog.find((c) => c.cropId === cropId);
  const dieselPrice = resolveScalar(domain, "price.diesel_l", scenarioId);
  const bf = sprayBoomFactor(domain, scenarioId);
  const byId = new Map(domain.machineCatalog.map((m) => [m.id, m]));
  const gaenge = domain.arbeitsgaenge[cropId] ?? [];
  // FLÄCHE DES GEWÄHLTEN PLANJAHRES. `domain.anbauplan` trägt nur die Flächen des Startjahres;
  //  fünf der sieben Kulturen beginnen erst 2028 und standen dort mit 0 ha — die Je-ha-Kosten
  //  stimmten, die absoluten Summen waren null. Der Bezugspunkt ist jetzt ein Parameter, damit
  //  jede Ansicht ihn sichtbar wählen kann; Default ist das ERSTE Planjahr (2027), nicht der
  //  Endausbau: eine Summe ohne genanntes Jahr wird sonst als „heute" gelesen.
  const areaHa = (() => {
    const kurve = cropAreasMemo(domain).areas[cropId];
    const jahre = Math.max(1, domain.growth?.years ?? 1);
    const jy = Math.min(Math.max(0, Math.round(jahrIdx)), jahre - 1);
    if (kurve && kurve.length) return kurve[Math.min(jy, kurve.length - 1)] ?? 0;
    return domain.anbauplan.filter((a) => a.cropId === cropId).reduce((s, a) => s + a.areaHa, 0);
  })();
  // Timing-Anker: editierbarer Aussaat-/Pflanzmonat (Katalog) → alles hängt relativ an S/E.
  const sow = entry?.sowMonth ?? SOW_MONTH[cropId] ?? entry?.plantingPeriod ?? 0;
  const harvRaw = entry?.harvestPeriods?.[0] ?? sow + 4;
  const harv = harvRaw < sow ? harvRaw + 12 : harvRaw; // Winterkultur: Ernte im Folgejahr
  const linesOf = (code: string): MassnahmeBM[] => {
    const op = entry?.ops.find((o) => o.code === code);
    if (!op) return [];
    return op.lines.map((l, lineIdx) => {
      const up = resolveScalar(domain, l.unitCostKey, scenarioId);
      const physical = l.unitCostKey !== "price.per_euro";
      return { label: l.label, qty: l.quantityPerHa, unit: l.unit ?? "", cent: Math.round(l.quantityPerHa * up), physical,
        opCode: code, lineIdx, unitCostKey: l.unitCostKey, unitPriceCent: up, productId: l.productId, mid: l.mid };
    });
  };
  const giftKey = (b: MassnahmeBM) => b.mid ?? b.label.split(" · ")[0];
  const sum = (ls: { cent: number }[]) => ls.reduce((s, l) => s + l.cent, 0);
  const bbchOf = (label: string): string => {
    const m = label.match(/BBCH\s*([0-9]{1,2}(?:\s*[–\-]\s*[0-9]{1,2})?)/i);
    return m ? m[1].replace(/\s*-\s*/, "–").replace(/\s+/g, "") : "—";
  };
  /** Maschinenkosten einer Überfahrten-Gruppe (CENT + Diesel/Std) — SSOT wie bisher. */
  const machineCost = (g: { m: string; passes: number }) => {
    const m = byId.get(g.m); if (!m) return { maschineCent: 0, dieselLHa: 0, hours: 0 };
    const cEff = (g.m === "spritze14" ? (m.cEff ?? 0) * bf : (m.cEff ?? 0)) || 1;
    const hours = g.passes / cEff;
    const rate = (m.afaPerHourCent ?? 0) + (m.interestPerHourCent ?? 0) + (m.insurancePerHourCent ?? 0) + (m.repairPerHourCent ?? 0) + (m.lubePerHourCent ?? 0) + (m.dieselLPerHour ?? 0) * dieselPrice;
    return { maschineCent: Math.round(hours * rate), dieselLHa: (m.dieselLPerHour ?? 0) * hours, hours };
  };
  const isFertigation = (label: string) => /fertigation/i.test(label);
  const isUnterfuss = (label: string) => /unterfuß|unterfuss/i.test(label);

  const rows: CropMassnahme[] = [];

  // 1) Feld-Maschinen-Maßnahmen (Bodenbearbeitung, Aussaat, Ernte …) — je Arbeitsgang eine Zeile.
  //    Streuer & Spritze werden NICHT hier gebündelt, sondern unten je Einzelmaßnahme aufgelöst.
  for (const g of gaenge) {
    const m = byId.get(g.m); const meta = MACHINE_PHASE[g.m];
    if (!m || !meta) continue;
    if (g.m === "streuer" || g.m === "spritze14") continue;
    const { maschineCent, dieselLHa, hours } = machineCost(g);
    let bm: MassnahmeBM[] = []; let opCode: string | undefined; let lineIdxs: number[] | undefined;
    if (meta.order === 3) { opCode = "OP-SAAT"; bm = linesOf(opCode); lineIdxs = bm.map((b) => b.lineIdx); }
    const bmCent = sum(bm);
    const measureId = g.mid ?? (opCode === "OP-SAAT" ? (bm[0]?.mid ?? `${cropId}::saat`) : `${cropId}::mach::${g.m}`);
    rows.push({ order: meta.order, phase: meta.phase, monat: monLabel(meta.when(sow, harv)), bbch: meta.bbch, timing: meta.timing, kind: "machine", measureId,
      machineId: g.m, machineLabel: m.label, passes: g.passes, opCode, lineIdxs, bm, dieselLHa, fahrerHHa: hours, maschineCent, bmCent, totalCent: maschineCent + bmCent });
  }

  // 2) DÜNGUNG — je GABE (Streuer-Überfahrt bzw. Fertigation/Unterfuß) EINE Maßnahme.
  //    Nährstoffzeilen einer Gabe werden über das Label-Präfix (vor " · ") gruppiert.
  const streuerG = gaenge.find((g) => g.m === "streuer");
  const streuerCost = streuerG ? machineCost(streuerG) : { maschineCent: 0, dieselLHa: 0, hours: 0 };
  const streuerLabel = byId.get("streuer")?.label ?? "Düngerstreuer";
  const duengBm = linesOf("OP-DUENG");
  const giftOrder: string[] = []; const giftMap = new Map<string, MassnahmeBM[]>();
  duengBm.forEach((b) => {
    const key = giftKey(b);
    if (!giftMap.has(key)) { giftMap.set(key, []); giftOrder.push(key); }
    giftMap.get(key)!.push(b);
  });
  const giftLabel = (bm: MassnahmeBM[]) => bm[0]?.label.split(" · ")[0] ?? "Düngegabe";
  const streuerGifts = giftOrder.filter((k) => { const bm = giftMap.get(k)!; const lb = giftLabel(bm); return !isFertigation(lb) && !isUnterfuss(lb); });
  const nStreuer = Math.max(1, streuerGifts.length);
  giftOrder.forEach((key, gi) => {
    const bm = giftMap.get(key)!;
    const lb = giftLabel(bm);
    const viaStreuer = !isFertigation(lb) && !isUnterfuss(lb);
    const bmCent = sum(bm);
    const mc = viaStreuer ? Math.round(streuerCost.maschineCent / nStreuer) : 0;
    const dl = viaStreuer ? streuerCost.dieselLHa / nStreuer : 0;
    const fh = viaStreuer ? streuerCost.hours / nStreuer : 0;
    const applyHint = isFertigation(lb) ? "Fertigation (Pivot)" : isUnterfuss(lb) ? "Unterfuß (mit Aussaat)" : undefined;
    rows.push({ order: 4 + gi * 0.01, phase: lb, monat: monLabel(MACHINE_PHASE.streuer.when(sow, harv)), bbch: bbchOf(lb), timing: "Düngegabe", measureId: bm[0]?.mid ?? `${cropId}::dueng::${gi}`,
      kind: viaStreuer ? "machine" : "input", machineId: viaStreuer ? "streuer" : undefined, machineLabel: viaStreuer ? streuerLabel : undefined, applyHint,
      passes: viaStreuer ? 1 : 0, opCode: "OP-DUENG", lineIdxs: bm.map((b) => b.lineIdx), bm, dieselLHa: dl, fahrerHHa: fh, maschineCent: mc, bmCent, totalCent: mc + bmCent });
  });

  // 3) PFLANZENSCHUTZ — je Block/Anwendung (OP-PSM-Zeile) EINE Maßnahme; Maschinenkosten
  //    proportional zu den Überfahrten (line.passes) der Spritze verteilt (Summe = Bündel-Total).
  const spritzeG = gaenge.find((g) => g.m === "spritze14");
  const spritzeCost = spritzeG ? machineCost(spritzeG) : { maschineCent: 0, dieselLHa: 0, hours: 0 };
  const spritzeLabel = byId.get("spritze14")?.label ?? "Feldspritze";
  const psmBm = linesOf("OP-PSM");
  const psmOp = entry?.ops.find((o) => o.code === "OP-PSM");
  const passesArr = psmBm.map((_, i) => psmOp?.lines[i]?.passes ?? 1);
  const totPasses = passesArr.reduce((s, x) => s + x, 0) || 1;
  psmBm.forEach((b, pi) => {
    const passes = passesArr[pi];
    const share = passes / totPasses;
    const mc = Math.round(spritzeCost.maschineCent * share);
    const dl = spritzeCost.dieselLHa * share; const fh = spritzeCost.hours * share;
    rows.push({ order: 5 + pi * 0.01, phase: b.label, monat: monLabel(MACHINE_PHASE.spritze14.when(sow, harv)), bbch: bbchOf(b.label), timing: "Spritz-Überfahrt", measureId: b.mid ?? `${cropId}::psm::${pi}`,
      kind: "machine", machineId: "spritze14", machineLabel: spritzeLabel, passes, opCode: "OP-PSM", lineIdxs: [b.lineIdx], bm: [b], dieselLHa: dl, fahrerHHa: fh, maschineCent: mc, bmCent: b.cent, totalCent: mc + b.cent });
  });

  // 4) Bewässerung / Material / Handarbeit — je EINE Maßnahme.
  const addInput = (code: string, phase: string, order: number, month: number, bbch: string, timing: string) => {
    const bm = linesOf(code); const c = sum(bm);
    const op = entry?.ops.find((o) => o.code === code);
    if (op || c > 0) rows.push({ order, phase, monat: monLabel(month), bbch, timing, kind: "input", measureId: bm[0]?.mid ?? `${cropId}::${code.replace("OP-", "").toLowerCase()}`, passes: 0, opCode: code, lineIdxs: bm.map((b) => b.lineIdx), bm, dieselLHa: 0, fahrerHHa: 0, maschineCent: 0, bmCent: c, totalCent: c });
  };
  addInput("OP-BEREG", "Bewässerung (Pivot/Fertigation)", 4.5, (sow + harv) / 2, "30–80", "kritische Phasen (Blüte/Füllung)");
  addInput("OP-MAT", "Material / Lager", 8.5, harv, "—", "mit Ernte (E)");
  addInput("OP-HAND", "Handarbeit (nicht-maschinell)", 8.6, harv, "—", "Saison / Ernte");

  // Chronologische Sortierung nach TATSÄCHLICHEM Zeitpunkt (BBCH), nicht nach festen Maschinen-Blöcken:
  //  · Bodenbearbeitung vor Saat (1–2) · „vor Legen/Pflanzung"-Düngung VOR der Pflanzung (2,8)
  //  · Pflanzung/Aussaat = BBCH 00 (3,0) · Unterfußdüngung mit der Pflanzung (3,05)
  //  · alles mit BBCH linear: 0 → Pflanzung (3), 100 → Ernte (7) · Material/Handarbeit nach Ernte.
  const bbchStart = (s: string): number | null => { const m = String(s).match(/(\d{1,3})/); return m ? Number(m[1]) : null; };
  for (const r of rows) {
    const b0 = bbchStart(r.bbch);
    const l = r.phase.toLowerCase();
    const pre = /vor (dem )?(legen|pflanz|saat|aussaat)/.test(l);
    if (r.machineId === "pflug") r.order = 1;
    else if (r.machineId === "saatbett") r.order = 2;
    else if (r.opCode === "OP-DUENG" && r.applyHint && /unterf/i.test(r.applyHint)) r.order = 3.05;
    else if (r.opCode === "OP-DUENG" && (pre || (/grund/.test(l) && (b0 === 0 || b0 === null)))) r.order = 2.8;
    else if (b0 != null) r.order = 3 + Math.min(100, b0) / 100 * 4;
    else if (r.opCode === "OP-MAT") r.order = 7.6;
    else if (r.opCode === "OP-HAND") r.order = 7.7;
    // sonst: bestehende Reihenfolge (z. B. Transport ohne BBCH) beibehalten.
  }
  rows.sort((a, b) => a.order - b.order);

  // Summen unabhängig vom Zeilen-Layout (== bisheriges Aggregat; Composer/Flotte unberührt).
  const machTot = gaenge.reduce((s, g) => byId.get(g.m) ? s + machineCost(g).maschineCent : s, 0);
  const dieselLHaTot = gaenge.reduce((s, g) => byId.get(g.m) ? s + machineCost(g).dieselLHa : s, 0);
  const fahrerHHaTot = gaenge.reduce((s, g) => byId.get(g.m) ? s + machineCost(g).hours : s, 0);
  const seedCent = sum(linesOf("OP-SAAT")), fertCent = sum(linesOf("OP-DUENG")), psmCent = sum(linesOf("OP-PSM"));
  const waterCent = sum(linesOf("OP-BEREG")), materialCent = sum(linesOf("OP-MAT")), handCent = sum(linesOf("OP-HAND"));
  const bmTot = seedCent + fertCent + psmCent + waterCent + materialCent + handCent;
  const t = { maschineCent: machTot, bmCent: bmTot, dieselLHa: dieselLHaTot, dieselCent: Math.round(dieselLHaTot * dieselPrice),
    fahrerHHa: fahrerHHaTot, totalCent: machTot + bmTot, seedCent, fertCent, psmCent, waterCent, materialCent, handCent };
  return { cropId, name: entry?.name ?? cropId, areaHa, rows, totals: t };
}

/** Produktkatalog des Domains (mit Fallback auf den Seed-Katalog, falls nicht persistiert). */
export function getProductCatalog(domain: Domain): CatalogProduct[] {
  return domain.productCatalog && domain.productCatalog.length ? domain.productCatalog : DEFAULT_PRODUCTS;
}

/* --------------------------------------------------------------------------
 * VERSIONS-VERGLEICH — feldgenauer Diff zweier Domänen-Stände (Snapshot ↔ Snapshot
 *  bzw. ↔ aktuell). Gruppiert nach Bereich; Werte als „alt → neu". Treibt das
 *  Änderungs-Tracking im Versionen-Panel (KPI-Delta rechnet der Store separat).
 * ------------------------------------------------------------------------ */
export type DiffChange = { label: string; from: string; to: string; kind: "add" | "remove" | "change" };
export type DiffGroup = { area: string; changes: DiffChange[] };

const fnum = (x: number | null | undefined): string => {
  if (x == null) return "—";
  const r = Math.round(x * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(".", ",");
};
const assumptionVal = (a: Assumption | undefined): string => {
  if (!a) return "—";
  const v = constValueOf(a.scenarioProfiles[BASE_SCENARIO_ID] as { kind: string; value?: number });
  if (v == null) return "(abgeleitet)";
  return String(a.unit) === "money" ? `${fnum(v / 100)} €` : fnum(v);
};

export function diffDomains(a: Domain, b: Domain): DiffGroup[] {
  const groups: DiffGroup[] = [];
  const add = (area: string, changes: DiffChange[]) => { if (changes.length) groups.push({ area, changes }); };
  const chg = (label: string, from: string, to: string): DiffChange | null =>
    from === to ? null : { label, from, to, kind: from === "—" ? "add" : to === "—" ? "remove" : "change" };
  const push = (arr: DiffChange[], c: DiffChange | null) => { if (c) arr.push(c); };

  // 1) Annahmen (Base-Wert je Treiber)
  {
    const keys = [...new Set([...Object.keys(a.assumptions), ...Object.keys(b.assumptions)])].sort();
    const ch: DiffChange[] = [];
    for (const k of keys) {
      const av = a.assumptions[k], bv = b.assumptions[k];
      const label = (av ?? bv)?.label ?? k;
      push(ch, chg(`${label}`, assumptionVal(av), assumptionVal(bv)));
    }
    add("Annahmen", ch);
  }
  // 2) Anbauplan — Fläche je Kultur
  {
    const areaOf = (d: Domain) => { const m = new Map<string, number>(); for (const e of d.anbauplan) m.set(e.cropId, (m.get(e.cropId) ?? 0) + e.areaHa); return m; };
    const ma = areaOf(a), mb = areaOf(b);
    const ids = [...new Set([...ma.keys(), ...mb.keys()])];
    const ch: DiffChange[] = [];
    for (const id of ids) {
      const nm = (CROP_NAME as Record<string, string>)[id] ?? id;
      push(ch, chg(`${nm} · Fläche ha`, ma.has(id) ? fnum(ma.get(id)!) : "—", mb.has(id) ? fnum(mb.get(id)!) : "—"));
    }
    add("Anbauplan (Fläche)", ch);
  }
  // 3) Maschinen — Bestand / Flottenbasis / Rabatt je Maschine (+ hinzugefügt/entfernt)
  {
    const byId = (d: Domain) => new Map(d.machineCatalog.map((m) => [m.id, m]));
    const ma = byId(a), mb = byId(b);
    const ids = [...new Set([...ma.keys(), ...mb.keys()])];
    const ch: DiffChange[] = [];
    for (const id of ids) {
      const x = ma.get(id), y = mb.get(id);
      const nm = (y ?? x)?.label ?? id;
      if (!x) { push(ch, chg(`${nm}`, "—", "vorhanden")); continue; }
      if (!y) { push(ch, chg(`${nm}`, "vorhanden", "—")); continue; }
      push(ch, chg(`${nm} · Bestand`, fnum(x.ownedUnits ?? 0), fnum(y.ownedUnits ?? 0)));
      push(ch, chg(`${nm} · Flottenbasis`, fnum(x.fleetStage1 ?? 0), fnum(y.fleetStage1 ?? 0)));
      push(ch, chg(`${nm} · Rabatt %`, fnum((x.discountPct ?? 0) * 100), fnum((y.discountPct ?? 0) * 100)));
    }
    add("Maschinen", ch);
  }
  // 4) Arbeitsgänge — Überfahrten je Kultur × Maschine
  {
    const ch: DiffChange[] = [];
    const crops = [...new Set([...Object.keys(a.arbeitsgaenge), ...Object.keys(b.arbeitsgaenge)])];
    for (const c of crops) {
      const nm = (CROP_NAME as Record<string, string>)[c] ?? c;
      const pa = new Map((a.arbeitsgaenge[c] ?? []).map((g) => [g.m, g.passes]));
      const pb = new Map((b.arbeitsgaenge[c] ?? []).map((g) => [g.m, g.passes]));
      const ms = [...new Set([...pa.keys(), ...pb.keys()])];
      for (const m of ms) {
        const ml = MACHINE_LABELS[m] ?? m;
        push(ch, chg(`${nm} · ${ml} Überfahrten`, pa.has(m) ? fnum(pa.get(m)!) : "—", pb.has(m) ? fnum(pb.get(m)!) : "—"));
      }
    }
    add("Arbeitsgänge", ch);
  }
  // 5) Kultur-Kalkulation — Mengen & Produktlinks je Betriebsmittel-Zeile
  {
    const ch: DiffChange[] = [];
    const catA = new Map(a.catalog.map((c) => [c.cropId, c]));
    const catB = new Map(b.catalog.map((c) => [c.cropId, c]));
    const crops = [...new Set([...catA.keys(), ...catB.keys()])];
    for (const cid of crops) {
      const nm = (CROP_NAME as Record<string, string>)[cid] ?? cid;
      const lines = (c?: CatalogEntry) => { const m = new Map<string, { label: string; qty: number; pid?: string }>(); for (const op of c?.ops ?? []) op.lines.forEach((l, i) => m.set(`${op.code}#${l.mid ?? i}`, { label: l.label, qty: l.quantityPerHa, pid: l.productId })); return m; };
      const la = lines(catA.get(cid)), lb = lines(catB.get(cid));
      const keys = [...new Set([...la.keys(), ...lb.keys()])];
      for (const k of keys) {
        const x = la.get(k), y = lb.get(k);
        const label = `${nm} · ${(y ?? x)?.label ?? k}`;
        if (!x) { push(ch, chg(label, "—", `${fnum(y!.qty)}`)); continue; }
        if (!y) { push(ch, chg(label, `${fnum(x.qty)}`, "—")); continue; }
        push(ch, chg(`${label} · Menge`, fnum(x.qty), fnum(y.qty)));
        push(ch, chg(`${label} · Produkt`, x.pid ?? "—", y.pid ?? "—"));
      }
    }
    add("Kultur-Kalkulation", ch);
  }
  // 6) Struktur & Entscheidungen
  {
    const ch: DiffChange[] = [];
    push(ch, chg("Stufe (Wachstum)", String(a.growth?.stage ?? "—"), String(b.growth?.stage ?? "—")));
    push(ch, chg("Scope", String(a.scope ?? "full"), String(b.scope ?? "full")));
    push(ch, chg("Transport (Make-or-Buy)", String(a.decisions?.transportToBuyer ?? "—"), String(b.decisions?.transportToBuyer ?? "—")));
    push(ch, chg("Konsolidierung aktiv", String(a.consolidation?.active ?? false), String(b.consolidation?.active ?? false)));
    const cps = [...new Set([...Object.keys(a.cropPolicy ?? {}), ...Object.keys(b.cropPolicy ?? {})])];
    for (const c of cps) {
      const nm = (CROP_NAME as Record<string, string>)[c] ?? c;
      const pa = a.cropPolicy?.[c], pb = b.cropPolicy?.[c];
      push(ch, chg(`${nm} · Politik`, pa ? `${pa.mode}${pa.targetHa ? " " + pa.targetHa + " ha" : ""}` : "—", pb ? `${pb.mode}${pb.targetHa ? " " + pb.targetHa + " ha" : ""}` : "—"));
    }
    add("Struktur & Entscheidungen", ch);
  }
  return groups;
}

/* --------------------------------------------------------------------------
 * ANNAHMEN-REGISTER — alle Modell-Treiber als Team-Review-Blatt (Quelle/Owner/
 *  Konfidenz/Status/Notiz/Audit). Wert je Szenario, Kategorie aus Key-Präfix.
 * ------------------------------------------------------------------------ */
export type AssumptionRow = {
  key: string; label: string; category: string; unit: string;
  editable: boolean;              // konstantes Profil im aktiven Szenario → editierbar
  value: number | null;          // Wert im aktiven Szenario
  base: number | null; best: number | null; worst: number | null;
  meta: AssumptionMeta;
};

export const ASSUMPTION_CATEGORY: Record<string, string> = {
  price: "Preise (Verkauf & Input)", mprice: "Maschinenpreise", pers: "Personal",
  yield: "Erträge", spray: "Spritzstrategie", seed: "Saatgut/Pflanzgut", qual: "Qualität",
  loss: "Verluste", en: "Einsatz & Schlagkraft", hold: "Holding", tco: "Maschinen-TCO",
  fert: "Düngerpreise", val: "Bewertung & Leistung", opex: "Betriebskosten / SG&A",
  infl: "Inflation", wc: "Working Capital", tax: "Steuern", store: "Lager",
  subsidy: "Subventionen", covenant: "Covenants", capex: "CAPEX", transport: "Transport",
  rev: "Erlöse", rate: "Zinsen", market: "Markt", macro: "Makro", log: "Logistik",
  irrig: "Bewässerung", finance: "Finanzierung", farm: "Betrieb",
};
export function assumptionCategory(key: string): string {
  return ASSUMPTION_CATEGORY[key.split(".")[0]] ?? "Sonstige";
}
const constValueOf = (prof: { kind: string; value?: number } | undefined): number | null =>
  prof && prof.kind === "constant" && typeof prof.value === "number" ? prof.value : null;

export function deriveAssumptionRegister(domain: Domain, scenarioId: string): AssumptionRow[] {
  const rows: AssumptionRow[] = [];
  // Kulturbezogene Annahmen (yield./price./loss./qual./seed.<cropId>) nur für die Wertkulturen.
  //  Die Werte der übrigen Kulturen bleiben in domain.assumptions hinterlegt — sie erscheinen
  //  nur nicht mehr im Register, weil der Betrieb sie nicht anbaut.
  const fremdeKultur = (key: string) => {
    const cid = key.split(".").slice(1).join(".");
    return !!cid && !VALUE_CROP_IDS.includes(cid)
      && ["yield", "price", "loss", "qual", "seed"].includes(key.split(".")[0])
      && CROP_IDS.includes(cid as CropId);
  };
  for (const key of Object.keys(domain.assumptions)) {
    if (fremdeKultur(key)) continue;
    const a = domain.assumptions[key];
    const activeProf = a.scenarioProfiles[scenarioId] ?? a.scenarioProfiles[domain.baseScenarioId];
    rows.push({
      key, label: a.label, category: assumptionCategory(key), unit: String(a.unit ?? ""),
      editable: !!activeProf && activeProf.kind === "constant",
      value: constValueOf(activeProf as { kind: string; value?: number }),
      base: constValueOf(a.scenarioProfiles[BASE_SCENARIO_ID] as { kind: string; value?: number }),
      best: constValueOf(a.scenarioProfiles["sc-best"] as { kind: string; value?: number }),
      worst: constValueOf(a.scenarioProfiles["sc-worst"] as { kind: string; value?: number }),
      meta: a.meta ?? {},
    });
  }
  return rows.sort((x, y) => x.category.localeCompare(y.category) || x.label.localeCompare(y.label));
}

/** Maßnahmenplan-Export für den FMS-Abgleich (Plan ↔ Ist). Jede Maßnahme mit stabiler measureId,
 *  Timing, Produktverknüpfung, Aufwand und Kosten — matchbar mit der Ist-Ausführung im FMS. */
export function exportMassnahmenplan(domain: Domain, scenarioId: string) {
  const crops = [...new Set(domain.anbauplan.map((a) => a.cropId))];
  const measures = crops.flatMap((cropId) => {
    const calc = deriveCropMassnahmen(domain, cropId, scenarioId);
    return calc.rows.map((r) => ({
      measureId: r.measureId,
      cropId, crop: calc.name, areaHa: calc.areaHa,
      typ: r.opCode ?? "MACHINE",
      massnahme: r.phase, bbch: r.bbch, timing: r.timing, monat: r.monat,
      maschine: r.machineLabel ?? r.applyHint ?? null, ueberfahrten: r.passes,
      positionen: r.bm.map((b) => ({ bezeichnung: b.label, menge: b.qty, einheit: b.unit, productId: b.productId ?? null, kostenCent: b.cent })),
      maschineCent: r.maschineCent, betriebsmittelCent: r.bmCent, summeCent: r.totalCent,
    }));
  });
  return { schema: "neosfx.massnahmenplan/v1", exportedFrom: "NEOS FX", scenarioId, count: measures.length, measures };
}

/** Maschinen-Ist-Stunden/Jahr über alle Kulturen, die die Maschine nutzen (Referenz C). */
function machineHoursPerYear(domain: Domain, machineId: string, atYear?: number): number {
  const m = domain.machineCatalog.find((x) => x.id === machineId);
  if (!m || !m.cEff) return 0;
  // Bemessen wird auf ein BEZUGSJAHR mit den FLÄCHEN DIESES JAHRES — nicht mit denen des
  //  Startjahrs. Sonst bekommen Kulturen, die erst später anlaufen, nie Technik (0 ha in 2027
  //  ⇒ 0 Bedarfsstunden ⇒ Basis × Faktor bleibt für immer 0), und befristete Lohnarbeit kippt
  //  eine Maschine dauerhaft aus der Flotte.
  //  atYear MUSS von außen gesetzt werden, wenn mehrere Maschinen in EINE Bemessung eingehen
  //  (Zugmaschinen bündeln die Stunden ihrer Anbaugeräte): sonst mischen sich Bezugsjahre und
  //  der Schlepperbedarf wird auf Flächen gerechnet, die es im selben Jahr gar nicht gibt.
  const years = Math.max(1, domain.growth?.years ?? 1);
  const yStar = atYear ?? bedarfsJahrOf(domain, machineId, years);
  if (yStar < 0) return 0;
  const areas = cropAreasMemo(domain).areas;
  let h = 0;
  for (const a of domain.anbauplan) {
    if (lohnGaengeOf(domain, a.cropId, yStar).has(machineId)) continue;
    const g = (domain.arbeitsgaenge[a.cropId] ?? []).find((x) => x.m === machineId);
    if (!g) continue;
    const curve = areas[a.cropId];
    const haY = curve ? (curve[Math.min(yStar, curve.length - 1)] ?? 0) : a.areaHa;
    h += (g.passes * haY) / m.cEff;
  }
  return h;
}

/** Service-relevante Stunden/Jahr: eigene Arbeitsgang-Stunden, sonst die des gekoppelten
 *  Anbaugeräts (serviceHoursLike) — für CAPEX-only-Zugschlepper (8RX zieht One-Pass etc.). */
function serviceHoursPerYear(domain: Domain, m: MachineType): number {
  if (m.cEff) return machineHoursPerYear(domain, m.id);
  if (m.serviceHoursLike) return machineHoursPerYear(domain, m.serviceHoursLike);
  return 0;
}

/** Jahres-Wartungs-/Service-Aufwand der Flotte (CENT): Σ serviceRate €/h × Service-Stunden. */
function machineServiceAnnualCent(domain: Domain, scenarioId: string): number {
  let cent = 0;
  for (const m of domain.machineCatalog) {
    if (!m.serviceRateKey) continue;
    const rate = resolveScalar(domain, m.serviceRateKey, scenarioId); // CENT/h
    cent += rate * serviceHoursPerYear(domain, m);
  }
  return cent;
}

/* ENTFERNT 31.07.2026: machineRentAnnualCent — Intercompany-Maschinenmiete. Sie setzte eine
   zweite operative Gesellschaft (Isolde) als Verleiher voraus; im Solo-Modell hat keine
   Maschine rentedUnits > 0 und die Funktion lieferte konstant 0. */

/* --------------------------------------------------------------------------
 * Delta 21.07. (2): Spritzstrategie — fenstergetriebene Flotte (Mehrkultur-Sommerpeak).
 *  Je Kultur ein PSM-Fenster (KW) + Flächenleistung ha/Tag je Spritze. Bedarf je Woche =
 *  Σ ⌈Fläche/(rate·tf·6)⌉ über alle in der Woche aktiven Kulturen; Flotte = Wochen-Peak.
 *  Anteil Selbstfahrer aus spray.sf_share. Flächen kommen aus dem Anbauplan (stufen-skaliert).
 * ------------------------------------------------------------------------ */
export const SPRAY_WINDOWS: Record<string, { kwS: number; kwE: number; rate: number }> = {
  weizen:            { kwS: 15, kwE: 21, rate: 220 },
  gerste_zw:         { kwS: 14, kwE: 20, rate: 220 },
  soja_luzerne:      { kwS: 22, kwE: 26, rate: 220 },
  winterraps:        { kwS: 14, kwE: 20, rate: 220 },  // Frühjahr: Fungizid Sclerotinia (Blüte) + Insektizid
  mais:              { kwS: 20, kwE: 25, rate: 220 },  // Nachauflauf-Herbizid
  tomate:            { kwS: 21, kwE: 34, rate: 270 },
  kartoffel_pommes:  { kwS: 20, kwE: 33, rate: 270 },
  kartoffel_chips:   { kwS: 20, kwE: 33, rate: 270 },
  zwiebel_moehre:    { kwS: 20, kwE: 36, rate: 250 },
  // ERGÄNZT 31.07.2026: diese drei Wertkulturen hatten kein Spritzfenster und erzeugten
  //  deshalb selbst mit Fläche NIE Spritzenbedarf — 200 ha im Endausbau ohne Pflanzenschutz
  //  in der Flottenauslegung. Fenster aus den Arbeitsgängen: Sellerie 5 Überfahrten
  //  (Sept-Ernte), Süßkartoffel 3, Knoblauch 4 (Winterknoblauch, Frühjahrsbehandlung).
  knollensellerie:   { kwS: 22, kwE: 36, rate: 250 },
  suesskartoffel:    { kwS: 21, kwE: 32, rate: 250 },
  knoblauch:         { kwS: 12, kwE: 24, rate: 250 },
};

export type SprayFleet = {
  total: number; gz: number; sf: number;
  weekly: number[];                 // Index 1..52 = gleichzeitiger Spritzenbedarf
  peakWeek: number; peakDemand: number;
  haPerDayGz: number; haPerFillGz: number; coversPivot: boolean;
  perYearCent: number;              // TCO/Jahr der Spritzenflotte (net − Restwert / Haltedauer)
};

export function shiftFactorOf(domain: Domain, scenarioId: string): number {
  const shifts = resolveScalar(domain, "en.shifts", scenarioId) || 1;
  const shiftEff = resolveScalar(domain, "en.shift_eff", scenarioId);
  return 1 + (Math.max(1, shifts) - 1) * shiftEff;
}

/** Breitenfaktor der Spritze: Arbeitsbreite ÷ 36-m-Basis. 48 m → 1,333 (mehr ha/Tag, weniger Maschinen).
 *  Treibt sowohl die Flottenzahl (deriveSprayFleet) als auch die Spritz-Betriebskosten (spritze14). */
export function sprayBoomFactor(domain: Domain, scenarioId: string): number {
  // 48-m-Paket erzwingt 48 m; sonst der manuelle spray.boom_m-Lever.
  const boom = farmBoom48(domain, scenarioId) ? 48 : (resolveScalar(domain, "spray.boom_m", scenarioId) || 36);
  return boom / 36;
}

export function deriveSprayFleet(domain: Domain, scenarioId: string, jahrIdx?: number): SprayFleet {
  const tf = shiftFactorOf(domain, scenarioId);
  const bf = sprayBoomFactor(domain, scenarioId); // 48-m-Paket: breiteres Gestänge → weniger Spritzen
  const weekly: number[] = new Array(53).fill(0);
  // NULLBASIS-FALLE mit direkter CAPEX-Wirkung. Die Spritzenflotte wurde auf den Flächen des
  //  STARTJAHRES gesizt — 300 ha, davon nur Kartoffel. Ergebnis: 2 Spritzen, eingefroren über
  //  alle acht Planjahre, auch für die 2.334 ha des Endausbaus. Über machineFleetCount ging
  //  diese 2 direkt in deriveCapex. Jetzt: der Bedarf wird über die Flächenkurven je Planjahr
  //  bestimmt und die Flotte auf das MAXIMUM über den Horizont gesizt (eine Spritze, die 2031
  //  gebraucht wird, muss vorhanden sein — sie schrumpft nicht wieder).
  const areasMY = cropAreasMemo(domain).areas;
  const jahre = Math.max(1, domain.growth?.years ?? 1);
  //  `jahrIdx` gesetzt → Bedarf GENAU DIESES Planjahres. Ohne Angabe: Maximum über den
  //  Horizont (Endausbau — das ist die Zahl, die der Spritzen-Screen zeigt).
  //  Die Unterscheidung ist für den CAPEX entscheidend: die Bemessungsbasis der
  //  Vintage-Mechanik ist das ERSTE Jahr, und sie multipliziert diese Basis anschließend mit
  //  der Wachstumskurve. Wer dort die Endausbau-Flotte einsetzt, kauft sie achtmal.
  const areaByCrop = new Map<string, number>();
  for (const a of domain.anbauplan) {
    const c = areasMY[a.cropId];
    const ha = !c ? a.areaHa
      : jahrIdx != null ? (c[Math.min(Math.max(0, jahrIdx), c.length - 1)] ?? 0)
      : Math.max(...c.slice(0, jahre));
    areaByCrop.set(a.cropId, (areaByCrop.get(a.cropId) ?? 0) + ha);
  }
  // AUFRUNDEN ERST AM SCHLUSS. Vorher rundete jede Kultur einzeln auf eine GANZE Spritze auf
  //  und belegte sie über ihr ganzes Fenster: Knoblauch braucht 0,02 Spritzen und bekam eine.
  //  Bei sieben Kulturen mit überlappenden Sommerfenstern summierte sich das auf sieben
  //  Maschinen, obwohl der echte Wochenbedarf in der Spitze unter einer liegt. Eine Spritze
  //  kann in derselben Woche mehrere Schläge fahren, solange die Kapazität reicht — genau das
  //  bildet der gebrochene Bedarf ab. Gerundet wird einmal, auf der Wochenspitze.
  for (const [cropId, w] of Object.entries(SPRAY_WINDOWS)) {
    const area = areaByCrop.get(cropId) ?? 0;
    if (area <= 0) continue;
    const u = area / (w.rate * bf * tf * 6);          // Maschinen-Wochen, fraktioniert
    for (let k = w.kwS; k <= w.kwE; k++) weekly[k] += u;
  }
  let peakWeek = 0, peakDemand = 0;
  for (let k = 1; k <= 52; k++) if (weekly[k] > peakDemand) { peakDemand = weekly[k]; peakWeek = k; }
  // REDUNDANZ-RESERVE. Pflanzenschutz ist terminkritisch: ein Blight-Fenster wartet nicht auf
  //  die Werkstatt. Deshalb eine zweite Maschine, sobald überhaupt gespritzt wird — der
  //  Rechenbedarf allein ergäbe eine einzige Spritze für 2.334 ha ohne jeden Ausfallpuffer.
  //  Über spray.reserve abschaltbar (0 = reiner Rechenbedarf).
  const reserve = domain.assumptions["spray.reserve"]
    ? Math.max(0, Math.round(resolveScalar(domain, "spray.reserve", scenarioId))) : 1;
  const total = peakDemand > 0 ? Math.ceil(peakDemand) + reserve : 0;
  const sfShare = resolveScalar(domain, "spray.sf_share", scenarioId);
  const sf = total > 0 ? Math.min(total, Math.ceil(total * sfShare)) : 0;
  const gz = total - sf;

  const appl = resolveScalar(domain, "spray.appl_lha", scenarioId) || 1;
  const boom = resolveScalar(domain, "spray.boom_m", scenarioId);
  const speed = resolveScalar(domain, "spray.speed_kmh", scenarioId);
  const fieldEff = resolveScalar(domain, "spray.field_eff", scenarioId);
  const refill = resolveScalar(domain, "spray.refill_min", scenarioId);
  const hours = resolveScalar(domain, "spray.hours_day", scenarioId);
  const tankGz = resolveScalar(domain, "spray.tank_gz_l", scenarioId);
  const pivotHa = resolveScalar(domain, "spray.pivot_ha", scenarioId) || 1;
  const Reff = (boom * speed) / 10 * fieldEff;         // ha/h
  const haPerFillGz = tankGz / appl;
  const sT = Reff > 0 ? haPerFillGz / Reff : 0;
  const fr = sT + refill / 60 > 0 ? sT / (sT + refill / 60) : 0;
  const haPerDayGz = Reff * fr * hours;
  const coversPivot = haPerFillGz >= pivotHa;

  const discount = resolveScalar(domain, "tco.discount", scenarioId);
  const resTrail = resolveScalar(domain, "tco.res_trail", scenarioId);
  const resSelf = resolveScalar(domain, "tco.res_self", scenarioId);
  const holdY = resolveScalar(domain, "tco.hold_years", scenarioId) || 1;
  const pGz = resolveScalar(domain, "mprice.spray_gz", scenarioId);
  const pSf = resolveScalar(domain, "mprice.spray_sf", scenarioId);
  const effGz = gz * pGz * (1 - discount) - gz * pGz * resTrail;
  const effSf = sf * pSf * (1 - discount) - sf * pSf * resSelf;
  const perYearCent = Math.round((effGz + effSf) / holdY);

  return { total, gz, sf, weekly, peakWeek, peakDemand, haPerDayGz, haPerFillGz, coversPivot, perYearCent };
}

/** Spritzen-Dimensionierung für eine Konfiguration (Tank/Breite/Bauart) — Pivot-/Sweep-Tabellen.
 *  need = ⌈(Fläche/Fenster)/haProTag⌉; TCO/Jahr = need·Preis·(1−Rabatt) − need·Preis·Restwert / Haltedauer.
 *  48-m-Gestänge: Preisaufschlag spray.boom48_prem, Restwert-Abschlag spray.res48_hair. Preise in CENT. */
export function spraySizing(
  domain: Domain, scenarioId: string,
  opts: { cat: "gezogen" | "selbstf"; tankL: number; boomM: number; speedKmh: number; areaHa: number },
): { haPerDay: number; haPerFill: number; need: number; tcoYearCent: number; is48: boolean; priceCent: number } {
  const appl = resolveScalar(domain, "spray.appl_lha", scenarioId) || 1;
  const fieldEff = resolveScalar(domain, "spray.field_eff", scenarioId);
  const refill = resolveScalar(domain, "spray.refill_min", scenarioId);
  const hours = resolveScalar(domain, "spray.hours_day", scenarioId);
  const windowDays = resolveScalar(domain, "spray.window_days", scenarioId) || 1;
  const discount = resolveScalar(domain, "tco.discount", scenarioId);
  const resTrail = resolveScalar(domain, "tco.res_trail", scenarioId);
  const resSelf = resolveScalar(domain, "tco.res_self", scenarioId);
  const holdY = resolveScalar(domain, "tco.hold_years", scenarioId) || 1;
  const prem48 = resolveScalar(domain, "spray.boom48_prem", scenarioId);
  const hair48 = resolveScalar(domain, "spray.res48_hair", scenarioId);
  const listPrice = resolveScalar(domain, opts.cat === "gezogen" ? "mprice.spray_gz" : "mprice.spray_sf", scenarioId);

  const is48 = opts.boomM >= 44;
  const priceCent = listPrice * (is48 ? 1 + prem48 : 1);
  const Reff = (opts.boomM * opts.speedKmh) / 10 * fieldEff;   // ha/h
  const haPerFill = opts.tankL / appl;
  const sT = Reff > 0 ? haPerFill / Reff : 0;
  const fr = sT + refill / 60 > 0 ? sT / (sT + refill / 60) : 0;
  const haPerDay = Reff * fr * hours;
  const need = haPerDay > 0 ? Math.max(1, Math.ceil((opts.areaHa / windowDays) / haPerDay)) : 0;
  const resPct = ((opts.cat === "gezogen" ? resTrail : resSelf) - (is48 ? hair48 : 0));
  const effCent = need * priceCent * (1 - discount) - need * priceCent * resPct;
  return { haPerDay, haPerFill, need, tcoYearCent: Math.round(effCent / holdY), is48, priceCent };
}

/** Stückpreis (CENT) je Maschine: Inline-priceCent > unitPriceKey-Annahme > 0. */
export function machineUnitPriceCent(domain: Domain, m: MachineType, scenarioId: string): number {
  if (m.priceCent != null) return m.priceCent;
  if (m.unitPriceKey) return resolveScalar(domain, m.unitPriceKey, scenarioId);
  return 0;
}

/** 48-m-Paket aktiv? (farm.boom48 ≥ 0,5). Schaltet 48-m-Spritzenbreite, Streuer-Swap und Umrüst-CAPEX. */
export function farmBoom48(domain: Domain, scenarioId: string): boolean {
  return (resolveScalar(domain, "farm.boom48", scenarioId) || 0) >= 0.5;
}

/** Flottenzahl je Maschine: fenstergetrieben für Spritzen-Mischpark, sonst ⌈fleetStage1 × stageFactor⌉.
 *  activeWhen-Gate: Maschinen des 48-m-Pakets sind nur im passenden Paket-Zustand aktiv (sonst 0). */
export function machineFleetCount(domain: Domain, m: MachineType, scenarioId: string): number {
  if (m.activeWhen) {
    const on = farmBoom48(domain, scenarioId);
    if ((m.activeWhen === "boom48") !== on) return 0;
  }
  // Hybrid-Override: manuell fixierte Stückzahl schlägt alles.
  if (m.fleetOverride != null) return Math.max(0, Math.round(m.fleetOverride));
  // FRONTANBAU 1:1 zum Roder: Frontkrautschläger sitzt vorn am Roder (einphasige Ernte).
  // FRONTFRAESE sc360 folgt 1:1 dem One-Pass-Leger: sie faehrt im selben Gespann. Vorher
  //  stand sie mit fleetStage1 = 3 im Katalog-Fallback und skalierte mangels Arbeitsgang
  //  ueber die GESAMTflaeche (x7,8) statt ueber die Kartoffelflaeche (x3,3) — 1,26 Mio EUR
  //  CAPEX gegen 0,50 Mio fuer die Maschine, der sie folgt.
  if (m.id === "sc360") {
    const op = domain.machineCatalog.find((x) => x.id === "onepass");
    return op ? machineFleetCount(domain, op, scenarioId) : 0;
  }
  if (m.id === "krautschl") {
    const rod = domain.machineCatalog.find((x) => x.id === "roder_ropa");
    return rod ? machineFleetCount(domain, rod, scenarioId) : Math.ceil((m.fleetStage1 ?? 0) * stageFactorOf(domain.stage));
  }
  // LKW-SATTELZUEGE und FELD-SHUTTLES: Bedarf aus der TONNAGE, nicht aus einer festen Zahl.
  //  Beide standen mit fleetStage1 = 8 bzw. 9 im Katalog — Groessen aus dem alten
  //  Gruppenmodell (20.000 ha). Im Basisjahr mit 300 ha Kartoffeln kaufte das Modell damit
  //  acht Sattelzuege und neun Shuttles, und die Vintage-Mechanik skalierte diese Basis
  //  anschliessend mit der Flaechenkurve hoch: 7,30 Mio EUR LKW und 3,16 Mio Shuttles ueber
  //  den Horizont. Als einzige Klassen durchliefen sie nie eine Bedarfspruefung.
  // SATTELZUEGE: EINE Quelle — die Make-or-Buy-Entscheidung. Sie bemisst die Flotte aus
  //  Tonnage, Entfernung und Zyklus und ist der Ort, an dem "Eigenflotte oder Spedition"
  //  entschieden wird. Faellt die Entscheidung auf Spedition, gibt es keine eigenen LKW und
  //  damit auch keinen LKW-CAPEX. Bis 31.07.2026 rechneten hier ZWEI Stellen unabhaengig
  //  voneinander eine LKW-Zahl, und beide kauften: der Katalog ueber die Vintage-Mechanik,
  //  die Make-or-Buy-Entscheidung ueber einen eigenen CAPEX-Posten cx-transport-fleet.
  if (m.id === "lkw_sattel") {
    const td = deriveTransportDecision(domain, scenarioId);
    return td.chosen === "own" ? td.own.lkw : 0;
  }
  if (m.id === "shuttle") {
    const hpd = resolveScalar(domain, "en.hours_day", scenarioId) || 10;
    const tf = shiftFactorOf(domain, scenarioId);
    // Vermarktete Nettotonnage der Wertkulturen im Bemessungsjahr.
    const nettoT = domain.anbauplan.reduce((sum, a) => {
      const y = resolveScalar(domain, `yield.${a.cropId}`, scenarioId) || 0;
      const l = domain.assumptions[`loss.${a.cropId}`] ? resolveScalar(domain, `loss.${a.cropId}`, scenarioId) : 0;
      return sum + a.areaHa * y * (1 - l);
    }, 0);
    if (nettoT <= 0) return 0;
    // SHUTTLE: Feld -> Feldrand/Ueberladestation. Kurzer Zyklus, folgt der Rodeleistung.
    const shuttleTpH = 40;                                    // t/h je Shuttle im Pendelverkehr
    const tageRodung = 60;
    return Math.max(1, Math.ceil(nettoT / Math.max(1, shuttleTpH * hpd * tf * tageRodung)));
  }
  // ZUGMASCHINEN: Stueckzahl aus den STUNDEN IHRER ANBAUGERAETE, nicht aus fleetStage1 = 3.
  //  Der Maschinenpark rechnet diese Stunden bereits korrekt; jetzt treiben sie auch den CAPEX.
  if (SIZED_TRACTOR_IDS.has(m.id)) {
    const geraete = domain.machineCatalog.filter((im) => im.tractorId === m.id && im.cEff);
    if (!geraete.length) return Math.max(0, Math.round(m.fleetStage1 ?? 0));
    const cap = machineCapPerUnitHours(domain, m.id, scenarioId);
    if (cap <= 0) return Math.max(0, Math.round(m.fleetStage1 ?? 0));
    const h = geraete.reduce((sum, im) => sum + machineDemandHoursOfYear(domain, im.id, 0), 0);
    return h > 0 ? Math.max(1, Math.ceil(h / cap)) : 0;
  }
  // FIELDLOADER: Bedarf aus der ÜBERLADELEISTUNG — Kartoffel-/Süßkartoffel-Bruttotonnage ÷
  //  (t/h × Erntefenster). Eine Station puffert mehrere Roder (150 t/h ≫ 1 Roder ~36 t/h).
  if (m.id === "fieldloader") {
    const tph = resolveScalar(domain, "log.fieldloader_tph", scenarioId) || 150;
    const potatoIds = ["kartoffel_pommes", "kartoffel_chips", "suesskartoffel"];
    const grossT = domain.anbauplan
      .filter((a) => potatoIds.includes(a.cropId))
      .reduce((s, a) => s + a.areaHa * (resolveScalar(domain, `yield.${a.cropId}`, scenarioId) || 0), 0);
    const hpd = resolveScalar(domain, "en.hours_day", scenarioId) || 10;
    const tf = shiftFactorOf(domain, scenarioId);
    const windowDays = feldTageOf(domain, "roder_ropa");
    const capPerLoader = tph * hpd * tf * Math.max(1, windowDays);
    return capPerLoader > 0 ? Math.max(1, Math.ceil(grossT / capPerLoader)) : 1;
  }
  if (m.sprayPart) {
    // Bemessungsjahr = Planjahr 0. Den Ausbau bis zum Endausbau liefert die Vintage-Kurve
    //  (dMachOf), nicht diese Zahl — sonst steht die Flotte des Endausbaus schon 2027 im Hof
    //  und wird danach noch einmal mit der Fläche hochskaliert.
    const f = deriveSprayFleet(domain, scenarioId, 0);
    return m.sprayPart === "gz" ? f.gz : f.sf;
  }
  // Fenstergetriebenes Bottom-up (Schlagkraft, kalibriert): treibt Anbaugeräte, Ernte- &
  //  Spezialtechnik und die gepoolten Zugklassen. Übrige (Boden/Saatbett/Sonder) = Planzahl.
  if (isSizedId(m.id)) return sizedRequired(domain, m.id, scenarioId);
  return Math.ceil((m.fleetStage1 ?? 0) * stageFactorOf(domain.stage));
}

/* --------------------------------------------------------------------------
 * deriveCapex — Flotte aus fester Flottenzahl × stageFactor (KEINE Fläche/Kapazität).
 *  Feldmaschinen: count = ⌈fleetStage1 × stageFactor⌉, amount = count × Neupreis.
 *  Beregnung (perHa): count = beregnete Fläche, amount = €/ha × Fläche.
 *  Lager (perTonne): count = Tonnen, amount = €/t × Tonnen.
 * ------------------------------------------------------------------------ */
export function deriveCapex(domain: Domain, scenarioId: string): DerivedCapex[] {
  const discount = resolveScalar(domain, "tco.discount", scenarioId); // Einkaufsrabatt
  const totalArea = domain.anbauplan.reduce((s, a) => s + a.areaHa, 0);
  const yieldKeyOf = (cropId: string): string | undefined =>
    domain.catalog.find((c) => c.cropId === cropId)?.yieldKey;
  // Tonnage-Treiber je Maschine: driver 'crops' → nur die gelisteten Kulturen (z. B. Lager =
  //  nur lagerpflichtige Kartoffel + Zwiebel/Möhre); 'valueCrops' → alle Wertkulturen; sonst alle.
  // Einlagerungsquote je Kultur (nur Lager/store, driver 'crops'): Anteil der Ernte, der eingelagert
  //  wird. Rest fährt direkt Feld → Verarbeiter → keine Lager-CAPEX. Fehlt der Key → 100 %.
  const storeAktiv = !domain.assumptions["store.active"] || resolveScalar(domain, "store.active", scenarioId) >= 0.5;
  const storeShare = (cropId: string): number => {
    if (!storeAktiv) return 0;                   // Master-Schalter aus → keine Lager-CAPEX
    const k = `store.share.${cropId}`;
    return domain.assumptions[k] ? Math.max(0, Math.min(1, resolveScalar(domain, k, scenarioId))) : 1;
  };
  /* Gleichzeitige SPITZENBELEGUNG eines gemeinsamen Lagers (t).
   * Kartoffel, Zwiebel/Möhre, Süßkartoffel, Knollensellerie und Knoblauch teilen sich
   * dieselbe Halle. Zu bauen ist deshalb NICHT die Summe der Jahresmengen, sondern die
   * höchste Menge, die GLEICHZEITIG darin liegt. Wer die Jahresmenge baut, überinvestiert
   * um genau den Betrag, den die zeitliche Staffelung der Ernten einspart.
   *
   * Belegungskurve zyklisch über zwölf Monate im eingeschwungenen Zustand: eine Kultur
   * belegt die Monate ab ihrer Ernte für die Dauer der Lagerung. Läuft die Lagerung über
   * den Jahreswechsel, greift die zyklische Rechnung das korrekt ab. */
  const storePeakConcurrentT = (ids: string[]): number => {
    const monthsRaw = domain.assumptions["store.months"]
      ? Math.round(resolveScalar(domain, "store.months", scenarioId)) : 0;
    const months = Math.max(0, Math.min(12, monthsRaw));
    if (months <= 0) return 0;
    const occ = new Array(12).fill(0);
    for (const a of domain.anbauplan) {
      if (!ids.includes(a.cropId)) continue;
      const yk = yieldKeyOf(a.cropId);
      if (!yk) continue;
      const tons = a.areaHa * resolveScalar(domain, yk, scenarioId) * storeShare(a.cropId);
      if (tons <= 0) continue;
      const hs = ((CROP_CAL as Record<string, { harvest: number[] }>)[a.cropId]?.harvest ?? []).filter((h: number) => h >= 0);
      if (!hs.length) continue;
      const per = tons / hs.length;
      for (const h of hs) {
        for (let k = 0; k < months; k++) occ[(h + k) % 12] += per;
      }
    }
    return occ.reduce((m, v) => Math.max(m, v), 0);
  };

  const driverTonnes = (drv: MachineDriver): number => {
    if (drv.kind === "crops" && drv.peakConcurrent) return storePeakConcurrentT(drv.ids);
    let t = 0;
    for (const a of domain.anbauplan) {
      if (drv.kind === "crops" && !drv.ids.includes(a.cropId)) continue;
      if (drv.kind === "valueCrops" && !VALUE_CROP_IDS.includes(a.cropId)) continue;
      if (drv.kind === "irrigated" && a.pool === "dryland") continue;
      if (drv.kind === "crop" && a.cropId !== drv.cropId) continue;
      const yk = yieldKeyOf(a.cropId);
      if (yk) t += a.areaHa * resolveScalar(domain, yk, scenarioId) * (drv.kind === "crops" ? storeShare(a.cropId) : 1);
    }
    return t;
  };
  const driverArea = (drv: MachineDriver): number => {
    let ha = 0;
    for (const a of domain.anbauplan) {
      if (drv.kind === "crops" && !drv.ids.includes(a.cropId)) continue;
      if (drv.kind === "valueCrops" && !VALUE_CROP_IDS.includes(a.cropId)) continue;
      if (drv.kind === "irrigated" && a.pool === "dryland") continue;
      if (drv.kind === "crop" && a.cropId !== drv.cropId) continue;
      ha += a.areaHa;
    }
    return ha;
  };

  // Hybrid-Detailplanung: ist ein Block auf Detailplanung, unterdrückt er seinen Auto-Träger
  //  (Bewässerung → irrig; Lager → store) — die Detailzeilen übernehmen dann die CAPEX.
  const planActive = domain.capexPlanActive ?? {};
  const out: DerivedCapex[] = [];
  for (const m of domain.machineCatalog) {
    if (m.id === "irrig" && planActive.bewaesserung) continue;
    if ((m.id === "store" || m.id === "store_tech") && planActive.lager) continue;
    const unitPrice = machineUnitPriceCent(domain, m, scenarioId);
    let count: number;
    let amount: number;
    let area: number;
    let owned = 0;
    let newUnits = 0;
    let rentedOut = 0;
    if (m.mode === "fixedFleet") {
      count = machineFleetCount(domain, m, scenarioId);
      // Bestand-vs-Plan: bereits vorhandene Einheiten erzeugen KEINEN Neu-CAPEX/keine Finanzierung.
      // Neu zu beschaffen = ⌈benötigte Flotte − Bestand − Gemietet⌉. Gemietete Einheiten (Intercompany-
      //  Miete, z. B. von Isolde) sind KEIN CAPEX — ihre Kosten laufen als Miet-OPEX (machineRentAnnualCent).
      owned = Math.max(0, Math.round(m.ownedUnits ?? 0));
      rentedOut = Math.max(0, Math.min(Math.round(m.rentedUnits ?? 0), Math.max(0, count - owned)));
      newUnits = Math.max(0, count - owned - rentedOut);
      // Globale TCO: Netto-Einkauf = Listenpreis × (1 − Rabatt). Per-Maschine-Rabatt (reales
      // JD-Angebot) überschreibt den globalen Default. amount = Netto (bilanzieller Zugang, nur NEU).
      const disc = m.discountPct ?? discount;
      const list = newUnits * unitPrice;
      amount = Math.round(list * (1 - disc));
      area = totalArea;
    } else if (m.mode === "perHa") {
      area = driverArea(m.driver);
      count = area;
      amount = Math.round(unitPrice * area);
    } else if (m.mode === "perTonne") {
      const tonnes = driverTonnes(m.driver);
      area = driverArea(m.driver);
      count = tonnes;
      // Hülle und Technik einzeln abwählbar (z. B. Halle mieten, Packlinie selbst kaufen).
      const bauTeil = m.id === "store" ? "store.capex_shell" : m.id === "store_tech" ? "store.capex_tech" : null;
      const bauen = !bauTeil || !domain.assumptions[bauTeil] || resolveScalar(domain, bauTeil, scenarioId) >= 0.5;
      amount = bauen ? Math.round(unitPrice * tonnes) : 0;
    } else {
      // Legacy perUnit (nicht mehr genutzt): konservativ 0.
      area = totalArea;
      count = 0;
      amount = 0;
    }
    out.push({ machineId: m.id, label: m.label, areaHa: area, count, unitPrice, amount, assetClass: m.assetClass, ownedUnits: owned, newUnits, rentedUnits: rentedOut });
  }
  return out;
}

/* --------------------------------------------------------------------------
 * deriveEffectiveMachineCost — globale TCO-Effektivkosten der FELDMASCHINEN-Flotte.
 *  Je Maschine: list = count × Listenpreis; net = list × (1−discount);
 *  resPct = cat==='gezogen'? res_trail : res_self; residual = list × resPct;
 *  eff = net − residual (Wertverzehr über die Haltedauer); perYear = eff / hold_years.
 *  Nur Feldmaschinen (mode 'fixedFleet'); Beregnung/Lager haben KEIN TCO.
 *  Alle Geldwerte in CENT.
 * ------------------------------------------------------------------------ */
export function deriveEffectiveMachineCost(
  domain: Domain,
  scenarioId: string,
): {
  machines: { id: string; label: string; cat: string; count: number; listCent: number; netCent: number; resPct: number; residualCent: number; effCent: number; perYearCent: number }[];
  totals: { listCent: number; netCent: number; residualCent: number; effCent: number; perYearCent: number; resQuote: number };
} {
  const discount = resolveScalar(domain, "tco.discount", scenarioId);
  const resTrail = resolveScalar(domain, "tco.res_trail", scenarioId);
  const resSelf = resolveScalar(domain, "tco.res_self", scenarioId);
  const holdYears = resolveScalar(domain, "tco.hold_years", scenarioId) || 1;

  const machines: { id: string; label: string; cat: string; count: number; listCent: number; netCent: number; resPct: number; residualCent: number; effCent: number; perYearCent: number }[] = [];
  let tList = 0, tNet = 0, tRes = 0, tEff = 0, tPerYear = 0;
  for (const m of domain.machineCatalog) {
    if (m.mode !== "fixedFleet") continue; // nur Feldmaschinen
    const count = machineFleetCount(domain, m, scenarioId);
    const unitPrice = machineUnitPriceCent(domain, m, scenarioId);
    const listCent = count * unitPrice;
    // Per-Maschine-Overrides (reale JD-Angebote) schlagen die globalen tco.*-Defaults.
    const disc = m.discountPct ?? discount;
    const resPct = m.residualPctList ?? (m.cat === "gezogen" ? resTrail : resSelf);
    const netCent = listCent * (1 - disc);
    const residualCent = listCent * resPct;
    const effCent = netCent - residualCent;
    const perYearCent = effCent / holdYears;
    machines.push({
      id: m.id, label: m.label, cat: m.cat ?? "selbstf", count,
      listCent: Math.round(listCent), netCent: Math.round(netCent), resPct,
      residualCent: Math.round(residualCent), effCent: Math.round(effCent), perYearCent: Math.round(perYearCent),
    });
    tList += listCent; tNet += netCent; tRes += residualCent; tEff += effCent; tPerYear += perYearCent;
  }
  return {
    machines,
    totals: {
      listCent: Math.round(tList), netCent: Math.round(tNet), residualCent: Math.round(tRes),
      effCent: Math.round(tEff), perYearCent: Math.round(tPerYear),
      resQuote: tList > 0 ? tRes / tList : 0, // Restwert als Anteil des Listenpreises
    },
  };
}

/* --------------------------------------------------------------------------
 * IMPORT-ENGINE — Eröffnungsbilanz aus rumänischem Accounting (Plan de conturi /
 *  balanța de verificare) oder ANAF-Bilanz (F10). Ordnet Kontonummern nach
 *  Präfix den 9 Eröffnungsbilanz-Positionen zu (Aktiv-/Passivseite). Werte optional
 *  RON→EUR umgerechnet. Alles CENT. Reine Funktion → in der View getestet & übernehmbar.
 * ------------------------------------------------------------------------ */
export type OBField =
  | "cash" | "receivables" | "inventory" | "ppeNet" | "land"
  | "payables" | "debt" | "shareCapital" | "retainedEarnings";
export type OBSide = "asset" | "liab";
/** Präfix → (Position, Bilanzseite). Längste Übereinstimmung gewinnt. RO Plan de conturi general. */
const RO_ACCOUNT_MAP: { prefix: string; field: OBField; side: OBSide; note: string }[] = [
  { prefix: "211", field: "land", side: "asset", note: "Terenuri" },
  { prefix: "212", field: "ppeNet", side: "asset", note: "Construcții" },
  { prefix: "213", field: "ppeNet", side: "asset", note: "Instalații/Utilaje" },
  { prefix: "214", field: "ppeNet", side: "asset", note: "Mobilier/Aparatură" },
  { prefix: "231", field: "ppeNet", side: "asset", note: "Imob. corporale în curs" },
  { prefix: "4424", field: "receivables", side: "asset", note: "TVA de recuperat" },
  { prefix: "4426", field: "receivables", side: "asset", note: "TVA deductibilă" },
  { prefix: "4423", field: "payables", side: "liab", note: "TVA de plată" },
  { prefix: "4427", field: "payables", side: "liab", note: "TVA colectată" },
  { prefix: "461", field: "receivables", side: "asset", note: "Debitori diverși" },
  { prefix: "462", field: "payables", side: "liab", note: "Creditori diverși" },
  { prefix: "519", field: "debt", side: "liab", note: "Credite bancare TS" },
  { prefix: "512", field: "cash", side: "asset", note: "Conturi la bănci" },
  { prefix: "531", field: "cash", side: "asset", note: "Casa" },
  { prefix: "541", field: "cash", side: "asset", note: "Acreditive" },
  { prefix: "542", field: "cash", side: "asset", note: "Avansuri de trezorerie" },
  { prefix: "117", field: "retainedEarnings", side: "liab", note: "Rezultat reportat" },
  // 2-stellige Klassen (Fallback):
  { prefix: "20", field: "ppeNet", side: "asset", note: "Imob. necorporale" },
  { prefix: "21", field: "ppeNet", side: "asset", note: "Imob. corporale" },
  { prefix: "23", field: "ppeNet", side: "asset", note: "Imob. în curs" },
  { prefix: "26", field: "ppeNet", side: "asset", note: "Imob. financiare" },
  { prefix: "28", field: "ppeNet", side: "asset", note: "Amortizări (contra)" },
  { prefix: "29", field: "ppeNet", side: "asset", note: "Ajustări imob. (contra)" },
  { prefix: "39", field: "inventory", side: "asset", note: "Ajustări stocuri (contra)" },
  { prefix: "40", field: "payables", side: "liab", note: "Furnizori" },
  { prefix: "41", field: "receivables", side: "asset", note: "Clienți" },
  { prefix: "42", field: "payables", side: "liab", note: "Personal/decontări" },
  { prefix: "43", field: "payables", side: "liab", note: "Asigurări sociale" },
  { prefix: "44", field: "payables", side: "liab", note: "Buget stat/impozite" },
  { prefix: "45", field: "payables", side: "liab", note: "Grup/decontări" },
  { prefix: "50", field: "cash", side: "asset", note: "Investiții pe TS" },
  { prefix: "54", field: "cash", side: "asset", note: "Acreditive" },
  { prefix: "10", field: "shareCapital", side: "liab", note: "Capital/rezerve" },
  { prefix: "12", field: "retainedEarnings", side: "liab", note: "Rezultat" },
  { prefix: "15", field: "payables", side: "liab", note: "Provizioane" },
  { prefix: "16", field: "debt", side: "liab", note: "Împrumuturi TL" },
  { prefix: "3", field: "inventory", side: "asset", note: "Stocuri" },
];
export function classifyRoAccount(account: string): { field: OBField; side: OBSide; note: string } | null {
  const a = account.replace(/\D/g, "");
  if (!a) return null;
  let best: { field: OBField; side: OBSide; note: string } | null = null, bestLen = -1;
  for (const m of RO_ACCOUNT_MAP) if (a.startsWith(m.prefix) && m.prefix.length > bestLen) { best = { field: m.field, side: m.side, note: m.note }; bestLen = m.prefix.length; }
  return best;
}
/** RO/DE-Zahlenformat → Number (1.234.567,89 | 1234567.89 | 1234567). */
export function parseRoNumber(s: string): number {
  if (!s) return 0;
  let t = s.replace(/[^\d.,-]/g, "").trim();
  if (t === "" || t === "-") return 0;
  if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");   // 1.234,56
  else if (t.includes(",")) t = t.replace(",", ".");                                     // 1234,56
  const v = parseFloat(t);
  return isNaN(v) ? 0 : v;
}
export type ImportRow = { account: string; label: string; debit: number; credit: number; field: OBField | null; side: OBSide | null; note: string; net: number };
export type ImportResult = { rows: ImportRow[]; buckets: Record<OBField, number>; unmapped: ImportRow[]; sumA: number; sumL: number };
/** Parst eine eingefügte Balanță/Kontensaldenliste. fxDivide: RON→EUR-Teiler (1 = bereits EUR).
 *  Spalten toleriert: „cont  denumire  sold_debitor  sold_creditor" oder „cont  denumire  sold"
 *  (Vorzeichen: Debitor +). Ergebnis in CENT. */
export function parseRomanianBalance(text: string, fxDivide = 1): ImportResult {
  const emptyB = (): Record<OBField, number> => ({ cash: 0, receivables: 0, inventory: 0, ppeNet: 0, land: 0, payables: 0, debt: 0, shareCapital: 0, retainedEarnings: 0 });
  const buckets = emptyB();
  const rows: ImportRow[] = [];
  const fx = fxDivide && fxDivide > 0 ? fxDivide : 1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(/\t|;|\s{2,}|(?<=\d)\s*\|\s*(?=\d)|\|/).map((c) => c.trim()).filter((c) => c !== "");
    if (cells.length < 2) continue;
    const acc = cells[0].replace(/\s/g, "");
    if (!/^\d{2,6}/.test(acc)) continue;              // erste Spalte muss Kontonummer sein
    // numerische Spalten am Ende einsammeln
    const nums = cells.slice(1).filter((c) => /\d/.test(c) && /^[\d.,\s-]+$/.test(c)).map(parseRoNumber);
    const label = cells.slice(1).find((c) => /[A-Za-zĂÂÎȘȚăâîșț]/.test(c)) ?? "";
    let debit = 0, credit = 0;
    if (nums.length >= 2) { debit = nums[nums.length - 2]; credit = nums[nums.length - 1]; }
    else if (nums.length === 1) { debit = Math.max(0, nums[0]); credit = Math.max(0, -nums[0]); }
    const cls = classifyRoAccount(acc);
    const net = (cls?.side === "liab" ? (credit - debit) : (debit - credit)) * 100 / fx; // CENT
    const row: ImportRow = { account: acc, label, debit: Math.round(debit * 100 / fx), credit: Math.round(credit * 100 / fx), field: cls?.field ?? null, side: cls?.side ?? null, note: cls?.note ?? "", net: Math.round(net) };
    if (cls) buckets[cls.field] += row.net;
    rows.push(row);
  }
  const assetFields: OBField[] = ["cash", "receivables", "inventory", "ppeNet", "land"];
  const liabFields: OBField[] = ["payables", "debt", "shareCapital", "retainedEarnings"];
  const sumA = assetFields.reduce((s, f) => s + buckets[f], 0);
  const sumL = liabFields.reduce((s, f) => s + buckets[f], 0);
  return { rows, buckets, unmapped: rows.filter((r) => !r.field), sumA, sumL };
}

/* --------------------------------------------------------------------------
 * derivePersonnelProposal — „KI-Tool": schlägt Kopfzahlen aus dem MASCHINENREGISTER
 *  und der Fläche vor. Stammfahrer aus den Ist-Feldstunden der Flotte (Arbeitsgänge ÷
 *  verfügbare Fahrerstunden × Peak-Deckung), Betriebspositionen aus Maschinenzahl/Fläche,
 *  Saison aus Wertkultur-Fläche. Logistik (LKW) & Daily Workers werden NUR informativ
 *  ausgewiesen (Kosten stecken bereits in Transport-OpEx bzw. Ernte-Handarbeit/COGS).
 * ------------------------------------------------------------------------ */
export type PersonnelProposal = {
  recommend: Record<string, number>;   // headcountKey → FTE-Vorschlag
  info: { fieldHours: number; machineCount: number; drivers: number; irrigatedHa: number;
          valueCropHa: number; lkwCount: number; logistik: number; dailyPeak: number };
};
/* ENTFERNT 31.07.2026: derivePersonnelProposal — der "Personalplaner", der aus den
   Flaechen des STARTJAHRES eigene Kopfzahlen vorschlug und damit neben dem Treibermodell
   eine zweite, widerspruechliche Personalrechnung fuehrte. Der Screen ist geloescht; die
   Funktion hatte keinen Aufrufer mehr. Kopfzahlen kommen aus personalFteOfYear. */

/* ENTFERNT 31.07.2026: deriveMachineTCO — nur von der geloeschten TCO-Ansicht benutzt;
   die Kostenaufrisse stehen im Maschinenpark. */

/* --------------------------------------------------------------------------
 * Delta 21.07. (2): Einsatzplanung — Wochenkalender KW 1–52 über alle Kulturen.
 *  Maschinen-Auslastung je Klasse × Woche, Personalkurve, Operations-Gantt, Konflikte.
 *  Flächen aus dem Anbauplan; Flotte aus dem Bottom-up (Spritzen fenstergetrieben,
 *  Wertkultur-Pflanz/Ernte bottom-up, übrige aus dem Maschinen-Katalog). 2-Schicht + Staffelung.
 * ------------------------------------------------------------------------ */
export type EinsatzOp = { cropId: string; label: string; cls: string; kwS: number; kwE: number; rate: number; mode: "single" | "repeat"; laborPerUnit: number; hand: number };
export type EinsatzClass = { key: string; label: string; units: number };
export type EinsatzConflict = { clsLabel: string; kwS: number; kwE: number; peak: number; units: number; crops: string[] };
export type EinsatzPlan = {
  classes: EinsatzClass[];
  demand: Record<string, number[]>;        // key → [1..52]
  labor: number[];                          // [1..52]
  ops: (EinsatzOp & { units: number; color: string })[];
  conflicts: EinsatzConflict[];
  kpis: { conflictCount: number; peakClass: string; peakUtilPct: number; peakWeek: number; peakLabor: number; peakLaborWeek: number; staff: number; shifts: number; shiftFactor: number };
};

const EN_OPS: EinsatzOp[] = [
  // ENTFERNT 31.07.2026: 20 Zeilen Ackerbau (Weizen, Gerste, Soja/Luzerne, Winterraps, Mais).
  //  Diese Kulturen gehörten zum Gruppenmodell und stehen im Solo-Anbauplan mit 0 ha; die
  //  Schleife übersprang sie, aber ihre KLASSEN standen weiter in der Tabelle — allen voran
  //  der Mähdrescher mit drei Einheiten und leerem Balken. Mit ihnen entfällt die Klasse
  //  „combine" ganz: es gibt kein Getreide mehr zu dreschen.
  { cropId: "kartoffel_pommes", label: "Pflanzung One-Pass (Pommes)", cls: "gross", kwS: 12, kwE: 16, rate: 5, mode: "single", laborPerUnit: 2, hand: 0 },
  { cropId: "kartoffel_pommes", label: "PSM Blight (Pommes)", cls: "spray", kwS: 20, kwE: 33, rate: 270, mode: "repeat", laborPerUnit: 1, hand: 0 },
  { cropId: "kartoffel_pommes", label: "Krautschlagen (Pommes)", cls: "gross", kwS: 33, kwE: 35, rate: 40, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "kartoffel_pommes", label: "Rodung ROPA (Pommes)", cls: "roder", kwS: 37, kwE: 42, rate: 10, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "kartoffel_pommes", label: "Transport (Pommes)", cls: "transp", kwS: 37, kwE: 43, rate: 60, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "kartoffel_chips", label: "Pflanzung One-Pass (Chips)", cls: "gross", kwS: 13, kwE: 17, rate: 5, mode: "single", laborPerUnit: 2, hand: 0 },
  { cropId: "kartoffel_chips", label: "PSM Blight (Chips)", cls: "spray", kwS: 20, kwE: 33, rate: 270, mode: "repeat", laborPerUnit: 1, hand: 0 },
  { cropId: "kartoffel_chips", label: "Krautschlagen (Chips)", cls: "gross", kwS: 34, kwE: 36, rate: 40, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "kartoffel_chips", label: "Rodung ROPA (Chips)", cls: "roder", kwS: 38, kwE: 43, rate: 10, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "kartoffel_chips", label: "Transport (Chips)", cls: "transp", kwS: 38, kwE: 44, rate: 60, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "tomate", label: "Pflanzung Tomate", cls: "pflanz", kwS: 16, kwE: 20, rate: 8, mode: "single", laborPerUnit: 2, hand: 120 },
  { cropId: "tomate", label: "PSM Tomate", cls: "spray", kwS: 21, kwE: 34, rate: 270, mode: "repeat", laborPerUnit: 1, hand: 0 },
  { cropId: "tomate", label: "Ernte Tomate", cls: "tomh", kwS: 32, kwE: 39, rate: 15, mode: "single", laborPerUnit: 12, hand: 0 },
  { cropId: "tomate", label: "Transport Tomate", cls: "transp", kwS: 32, kwE: 39, rate: 55, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "zwiebel_moehre", label: "Pflanzung Zwiebel/Möhre", cls: "pflanz", kwS: 14, kwE: 24, rate: 10, mode: "single", laborPerUnit: 2, hand: 60 },
  { cropId: "zwiebel_moehre", label: "PSM Zwiebel/Möhre", cls: "spray", kwS: 20, kwE: 36, rate: 250, mode: "repeat", laborPerUnit: 1, hand: 0 },
  { cropId: "zwiebel_moehre", label: "Ernte Zwiebel/Möhre", cls: "tomh", kwS: 26, kwE: 40, rate: 6, mode: "single", laborPerUnit: 4, hand: 140 },
  // NEU: Import-Substitutions-Kulturen (Marktanalyse 24.07.)
  { cropId: "suesskartoffel", label: "Pflanzung Süßkartoffel (Slips)", cls: "pflanz", kwS: 19, kwE: 22, rate: 8, mode: "single", laborPerUnit: 3, hand: 80 },
  { cropId: "suesskartoffel", label: "PSM Süßkartoffel", cls: "spray", kwS: 22, kwE: 34, rate: 250, mode: "repeat", laborPerUnit: 1, hand: 0 },
  { cropId: "suesskartoffel", label: "Ernte Süßkartoffel (Siebkette)", cls: "roder", kwS: 40, kwE: 44, rate: 5, mode: "single", laborPerUnit: 3, hand: 120 },
  { cropId: "knoblauch", label: "Stecken Knoblauch", cls: "drill", kwS: 40, kwE: 43, rate: 12, mode: "single", laborPerUnit: 2, hand: 40 },
  { cropId: "knoblauch", label: "PSM Knoblauch", cls: "spray", kwS: 14, kwE: 24, rate: 250, mode: "repeat", laborPerUnit: 1, hand: 0 },
  { cropId: "knoblauch", label: "Ernte Knoblauch (Siebkette)", cls: "roder", kwS: 27, kwE: 30, rate: 6, mode: "single", laborPerUnit: 3, hand: 100 },
  { cropId: "knollensellerie", label: "Pflanzung Knollensellerie", cls: "pflanz", kwS: 16, kwE: 20, rate: 9, mode: "single", laborPerUnit: 2, hand: 60 },
  { cropId: "knollensellerie", label: "PSM Knollensellerie", cls: "spray", kwS: 20, kwE: 38, rate: 250, mode: "repeat", laborPerUnit: 1, hand: 0 },
  { cropId: "knollensellerie", label: "Ernte Knollensellerie (Klemmband)", cls: "tomh", kwS: 41, kwE: 45, rate: 5, mode: "single", laborPerUnit: 3, hand: 90 },
  // ERGÄNZT 31.07.2026 — DÜNGUNG. Der Plan kannte Düngeüberfahrten nur für die entfallenen
  //  Ackerbaukulturen; für die sieben Wertkulturen fehlten sie vollständig, obwohl der
  //  Bredal K135 in jedem Arbeitsgang steht. Fenster: von der Pflanzung bis kurz vor die
  //  Ernte (Kulturkalender). Leistung 180 ha/Tag = 18,62 ha/h × 10 Feldstunden.
  { cropId: "kartoffel_pommes", label: "Düngung (Pommes)", cls: "fert", kwS: 11, kwE: 26, rate: 180, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "kartoffel_chips", label: "Düngung (Chips)", cls: "fert", kwS: 12, kwE: 27, rate: 180, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "tomate", label: "Düngung Tomate", cls: "fert", kwS: 14, kwE: 30, rate: 180, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "zwiebel_moehre", label: "Düngung Zwiebel/Möhre", cls: "fert", kwS: 13, kwE: 28, rate: 180, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "suesskartoffel", label: "Düngung Süßkartoffel", cls: "fert", kwS: 18, kwE: 34, rate: 180, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "knoblauch", label: "Düngung Knoblauch (Frühjahr)", cls: "fert", kwS: 8, kwE: 20, rate: 180, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "knollensellerie", label: "Düngung Knollensellerie", cls: "fert", kwS: 15, kwE: 34, rate: 180, mode: "single", laborPerUnit: 1, hand: 0 },
  // ERGÄNZT 31.07.2026 — ABTRANSPORT. Transportzeilen gab es nur für Kartoffel, Tomate und
  //  den entfallenen Mais. Vier Wertkulturen ernteten, ohne dass jemand die Ware wegfuhr —
  //  und genau ihre Erntefenster liegen im Oktober übereinander.
  { cropId: "zwiebel_moehre", label: "Transport Zwiebel/Möhre", cls: "transp", kwS: 26, kwE: 40, rate: 55, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "suesskartoffel", label: "Transport Süßkartoffel", cls: "transp", kwS: 40, kwE: 45, rate: 55, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "knoblauch", label: "Transport Knoblauch", cls: "transp", kwS: 27, kwE: 31, rate: 55, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "knollensellerie", label: "Transport Knollensellerie", cls: "transp", kwS: 41, kwE: 46, rate: 55, mode: "single", laborPerUnit: 1, hand: 0 },
];

/** Kanonisches NEOS_CROP-Farbsystem (assets/crop-colors.js) — je Kultur eine Marke.
 *  Für Zwiebel/Möhre wird das gut sichtbare Karotten-Orange gewählt (Zwiebel-Beige wäre zu blass). */
export const CROP_COLOR: Record<string, string> = {
  weizen: "#E8AB30",           // Weizen · golden-ochre
  gerste_zw: "#C2A278",        // Gerste · root-beige
  soja_luzerne: "#C79A2E",     // Soja · soy-ochre
  winterraps: "#E9EE2C",       // Raps · rapeseed-yellow
  mais: "#009A17",             // Mais · grass-green
  tomate: "#D6402C",           // Industrietomate · tomato-red
  kartoffel_pommes: "#FAD201", // Kartoffel · accent-yellow
  kartoffel_chips: "#E0B900",  // Kartoffel (Chips) · abgedunkelt zur Unterscheidung
  zwiebel_moehre: "#E8621A",   // Karotte · carrot-orange (Zwiebel/Möhre)
  suesskartoffel: "#C46A2B",   // Süßkartoffel · kupfer-braun
  knoblauch: "#D9D4C7",        // Knoblauch · papierweiß-beige
  // Kanonisch getauscht (Beschluss 07/26): Knollensellerie ↔ Erbsen — gilt überall.
  knollensellerie: "#95C11F",  // Sellerie · war #026634, getauscht → hell-limone (Erbsen-Ton)
  erbsen: "#026634",           // Erbsen · war #95C11F, getauscht → flaschengrün (Sellerie-Ton)
  sonnenblume: "#F5A623",      // Sonnenblume · sonnen-amber (distinkt zu Raps-Gelb/Weizen-Ocker)
};
const EN_CROP_COLOR = CROP_COLOR;

/** Staffelungs-Endwoche: Ernte/Rodung → +erntStaffel, Aussaat → +saatStaffel. */
function enKwEnd(op: EinsatzOp, harvestStaffel: number, saatStaffel: number): number {
  if (/Ernte|Rodung/.test(op.label)) return op.kwE + harvestStaffel;
  if (/Aussaat/.test(op.label)) return op.kwE + saatStaffel;
  return op.kwE;
}

/** BEDARF eines Arbeitsgangs in MASCHINEN — bewusst FRAKTIONIERT.
 *
 *  Bis 31.07.2026 rundete diese Funktion jeden Arbeitsgang auf eine GANZE Maschine auf, und
 *  zwar für jede Woche seines Fensters. Eine Kultur, die rechnerisch 0,03 Streuer über sechzehn
 *  Wochen braucht, belegte damit sechzehn Wochen lang einen ganzen Streuer. Bei sieben Kulturen
 *  mit überlappenden Fenstern kam die Ampel auf 700 % Auslastung — nicht, weil es eng wäre,
 *  sondern weil siebenmal aufgerundet wurde. Genau dagegen waren die Flottenkonstanten
 *  (en.fert = 2, en.transp = 3 …) hochgesetzt worden: „damit die Einsatzplanung out-of-the-box
 *  engpassfrei ist". Zwei Fehler, die sich gegenseitig verdeckten.
 *
 *  Der Bedarf bleibt jetzt gebrochen und wird erst je KLASSE und WOCHE summiert und dann gegen
 *  die Flotte gestellt. Eine Maschine kann in derselben Woche mehrere Kulturen bedienen, solange
 *  ihre Kapazität reicht — genau so arbeitet der Betrieb auch. */
function enDemandOf(op: EinsatzOp, area: number, tf: number, kwEnd: number): number {
  if (area <= 0) return 0;
  // "repeat": jede Woche des Fensters eine Überfahrt (PSM-Spritzfolge).
  if (op.mode === "repeat") return area / (op.rate * tf * 6);
  // "single": EINE Überfahrt, verteilt über die Wochen des Fensters.
  const weeks = Math.max(1, kwEnd - op.kwS + 1);
  return area / (op.rate * tf * 6 * weeks);
}

/** Bottom-up Wertkultur-Flotte: Pflanzmaschinen + Ernter (Tomate + Zwiebel/Möhre, ohne Kartoffel). */
export function deriveValueFleet(domain: Domain, scenarioId: string): { plant: number; harv: number; plantArea: number; harvArea: number } {
  const tf = shiftFactorOf(domain, scenarioId);
  // NULLBASIS-FALLE, die letzte im Bestand. Tomate und Zwiebel/Möhre stehen im Anbauplan
  //  des STARTJAHRES mit 0 ha — sie beginnen 2028. plantArea war damit 0, plant und harv
  //  fielen auf 0, und der Einsatzplan zeigte für „Gemüse-/Tomaten-Pflanzmaschinen" und
  //  „Tomaten-/Gemüseernter" die Notfallzahl 1 aus Math.max(1, …) statt des echten Bedarfs.
  //  Bemessen wird auf dem ZIELJAHR — der Einsatzplan zeigt die Saisonspitze des ausgebauten
  //  Betriebs, genauso wie deriveEinsatzplan es weiter unten schon tut.
  const areasVF = cropAreasMemo(domain).areas;
  const zielVF = Math.max(0, (domain.growth?.years ?? 1) - 1);
  const areaByCrop = new Map<string, number>();
  for (const a of domain.anbauplan) {
    const c = areasVF[a.cropId];
    const ha = c ? (c[Math.min(zielVF, c.length - 1)] ?? 0) : a.areaHa;
    areaByCrop.set(a.cropId, (areaByCrop.get(a.cropId) ?? 0) + ha);
  }
  const plantArea = (areaByCrop.get("tomate") ?? 0) + (areaByCrop.get("zwiebel_moehre") ?? 0);
  const harvArea = plantArea;
  const transRate = resolveScalar(domain, "val.trans_rate", scenarioId) || 1;
  const transWin = resolveScalar(domain, "val.trans_win", scenarioId) || 1;
  const tomhRate = resolveScalar(domain, "val.tomh_rate", scenarioId) || 1;
  const tomhWin = resolveScalar(domain, "val.tomh_win", scenarioId) || 1;
  const plant = plantArea > 0 ? Math.max(1, Math.ceil(plantArea / (transRate * tf * 6 * transWin))) : 0;
  const harv = harvArea > 0 ? Math.max(1, Math.ceil(harvArea / (tomhRate * tf * 6 * tomhWin))) : 0;
  return { plant, harv, plantArea, harvArea };
}

export function deriveEinsatzplan(domain: Domain, scenarioId: string): EinsatzPlan {
  const shifts = Math.max(1, resolveScalar(domain, "en.shifts", scenarioId) || 1);
  const tf = shiftFactorOf(domain, scenarioId);
  const harvestStaffel = resolveScalar(domain, "en.harvest_staffel", scenarioId);
  const saatStaffel = resolveScalar(domain, "en.saat_staffel", scenarioId);
  // PERSONALKAPAZITAET aus der Personalplanung statt aus der Altkonstante en.staff (45).
  //  Die 45 stammten aus dem alten Kombimodell und hatten mit der treiberbasierten
  //  Personalplanung nichts mehr zu tun — dort stehen 38,1 FTE im Endausbau. Zwei Zahlen
  //  fuer dieselbe Groesse, und die Engpass-Ampel verglich gegen die falsche.
  //  Gezaehlt wird, wer im Feld arbeiten kann: Stammfahrer, Bewaesserung und Saisonkraefte.
  //  Leitung, Werkstatt, Lager und Praktikanten stehen fuer die Erntespitze nicht bereit.
  const zielJahrEP = Math.max(0, (domain.growth?.years ?? 1) - 1);
  const staff = ["pers.stamm.n", "pers.bewaesserung.n", "pers.saison.n"]
    .reduce((sum, k) => sum + personalFteOfYear(domain, k, zielJahrEP, scenarioId), 0);

  // NULLBASIS-FALLE: die Flaechen des STARTJAHRES. Tomate, Zwiebel/Moehre, Sellerie,
  //  Suesskartoffel und Knoblauch stehen dort mit 0 ha und wurden von der Schleife unten
  //  (area <= 0 -> continue) komplett uebersprungen — der Einsatzplan zeigte ausschliesslich
  //  Kartoffel, samt fehlender Handarbeit der fuenf Kulturen. Jetzt: Flaechen des ZIELJAHRES,
  //  denn der Einsatzplan bemisst die Saisonspitze des ausgebauten Betriebs.
  const areasEP = cropAreasMemo(domain).areas;
  const jahreEP = Math.max(1, domain.growth?.years ?? 1);
  const areaByCrop = new Map<string, number>();
  for (const a of domain.anbauplan) {
    const c = areasEP[a.cropId];
    const ha = c ? (c[Math.min(jahreEP - 1, c.length - 1)] ?? 0) : a.areaHa;
    areaByCrop.set(a.cropId, (areaByCrop.get(a.cropId) ?? 0) + ha);
  }
  const cnt = (id: string): number => {
    const m = domain.machineCatalog.find((x) => x.id === id);
    return m ? machineFleetCount(domain, m, scenarioId) : 0;
  };
  const spray = deriveSprayFleet(domain, scenarioId);
  const vf = deriveValueFleet(domain, scenarioId);
  const sfac = stageFactorOf(domain.stage);
  const scaled = (key: string): number => Math.max(1, Math.ceil(resolveScalar(domain, key, scenarioId) * sfac));

  // Bottom-up-getriebene Klassen: Spritzen (fenstergetrieben), Legekombi/Roder (Kartoffel-Kette),
  // Pflanz/Ernter (Wertkultur-Bottom-up). Übrige Klassen: editierbare Basiszahl × stageFactor.
  const classes: EinsatzClass[] = [
    // ALLE Klassen zählen jetzt echte Maschinen aus dem Katalog. Sä-/Legetechnik,
    //  Düngerstreuer und Transport standen zuvor auf Basiszahlen (en.drill/en.fert/
    //  en.transp) aus dem Gruppenmodell und stimmten mit dem Maschinenpark nicht überein:
    //  „Transport / Hakenlift" zeigte 3 Einheiten, im Katalog stehen 1 Hakenlift und
    //  1 Shuttle. Der Mähdrescher ist ganz entfallen (kein Getreide mehr).
    { key: "gross", label: "Großschlepper / Legekombi", units: Math.max(1, cnt("onepass") + scaled("en.gross_extra")) },
    { key: "drill", label: "Sä-/Legetechnik (Knoblauch, Beetsaat)", units: Math.max(1, cnt("knobl_lege") + cnt("gem_saat")) },
    { key: "pflanz", label: "Gemüse-/Tomaten-Pflanzmasch.", units: Math.max(1, vf.plant) },
    { key: "spray", label: "Spritzen (Mischpark)", units: Math.max(1, spray.total) },
    { key: "fert", label: "Düngerstreuer", units: Math.max(1, cnt("streuer")) },
    { key: "roder", label: "Kartoffelroder", units: Math.max(1, cnt("roder_ropa")) },
    { key: "tomh", label: "Tomaten-/Gemüseernter", units: Math.max(1, vf.harv) },
    { key: "transp", label: "Transport / Hakenlift", units: Math.max(1, cnt("transport") + cnt("shuttle")) },
  ];
  const demand: Record<string, number[]> = {};
  for (const c of classes) demand[c.key] = new Array(53).fill(0);
  const labor: number[] = new Array(53).fill(0);
  const ops: (EinsatzOp & { units: number; color: string })[] = [];

  for (const op of EN_OPS) {
    const area = areaByCrop.get(op.cropId) ?? 0;
    if (area <= 0) continue;
    const kwEnd = enKwEnd(op, harvestStaffel, saatStaffel);
    const bedarf = enDemandOf(op, area, tf, kwEnd);
    // Anzeige: aufgerundet auf ganze Maschinen (man fährt keine halbe). Gerechnet wird mit dem
    //  gebrochenen Bedarf — sonst zählt jede Kultur eine ganze Maschine, die sie nie auslastet.
    const u = Math.max(1, Math.ceil(bedarf));
    ops.push({ ...op, kwE: kwEnd, units: u, color: EN_CROP_COLOR[op.cropId] ?? "#7BB661" });
    for (let w = op.kwS; w <= kwEnd && w <= 52; w++) {
      if (demand[op.cls]) demand[op.cls][w] += bedarf;
      labor[w] += bedarf * op.laborPerUnit * shifts + (op.hand ? (op.hand * shifts) / Math.max(1, kwEnd - op.kwS + 1) : 0);
    }
  }

  // Peak-Auslastung
  let peakUtil = 0, peakClass = "", peakWeek = 0;
  for (const c of classes) {
    for (let w = 1; w <= 52; w++) {
      const u = c.units ? demand[c.key][w] / c.units : 0;
      if (u > peakUtil) { peakUtil = u; peakClass = c.label; peakWeek = w; }
    }
  }
  let peakLabor = 0, peakLaborWeek = 0;
  for (let w = 1; w <= 52; w++) if (labor[w] > peakLabor) { peakLabor = labor[w]; peakLaborWeek = w; }

  // Konflikte (Bedarf > Flotte)
  const conflicts: EinsatzConflict[] = [];
  for (const c of classes) {
    let cur: { a: number; b: number; mx: number } | null = null;
    for (let w = 1; w <= 52; w++) {
      const over = demand[c.key][w] > c.units;
      if (over && !cur) cur = { a: w, b: w, mx: demand[c.key][w] };
      else if (over && cur) { cur.b = w; cur.mx = Math.max(cur.mx, demand[c.key][w]); }
      else if (!over && cur) { conflicts.push(finalizeConflict(c, cur, ops, harvestStaffel, saatStaffel)); cur = null; }
    }
    if (cur) conflicts.push(finalizeConflict(c, cur, ops, harvestStaffel, saatStaffel));
  }
  conflicts.sort((a, b) => b.peak / b.units - a.peak / a.units);

  return {
    classes, demand, labor, ops, conflicts,
    kpis: {
      conflictCount: conflicts.length, peakClass: peakClass || "—", peakUtilPct: Math.round(peakUtil * 100),
      peakWeek, peakLabor: Math.round(peakLabor), peakLaborWeek, staff, shifts, shiftFactor: tf,
    },
  };
  function finalizeConflict(c: EinsatzClass, r: { a: number; b: number; mx: number }, allOps: (EinsatzOp & { units: number })[], hs: number, ss: number): EinsatzConflict {
    const crops = allOps.filter((o) => o.cls === c.key && o.kwS <= r.b && enKwEnd(o, hs, ss) >= r.a).map((o) => o.label);
    return { clsLabel: c.label, kwS: r.a, kwE: r.b, peak: r.mx, units: c.units, crops };
  }
}

/* --------------------------------------------------------------------------
 * deriveFleetSizing — BOTTOM-UP-Maschinensizing (Leistungsparameter → Stückzahl).
 *  Für jede Maschinenklasse: Bedarf je Woche = Σ ⌈Fläche/(ha·Tag × 6 × Fenster × Schicht)⌉
 *  über alle Kulturen, die die Maschine im jeweiligen Zeitfenster nutzen; Flotte = Wochen-Peak.
 *  Traktoren betriebsweit gepoolt: Bedarf = Peak gleichzeitig gezogener Anbaugeräte je Zugklasse.
 *  Bestand-Abgleich: Neu = max(0, Bedarf − Bestand). Treibt CAPEX (deriveCapex) & Personal.
 *  Spritzen (deriveSprayFleet) haben eigene Tank-/Fensterlogik; Boden/Saatbett bleiben Planzahl.
 * ------------------------------------------------------------------------ */
export type FleetSize = {
  machineId: string; label: string; manufacturer?: string; crops: string[]; cEff: number;
  feldTage: number; demandHours: number; capPerUnitHours: number;
  required: number; owned: number; newUnits: number; park: number;
  utilOwnedPct: number; utilParkPct: number; reserve: number;
  status: "under" | "min" | "reserve"; isTractor: boolean;
};

/** Maschinen-ids, deren Flotte fenstergetrieben (bottom-up) gesizt wird. */
// krautschl NICHT mehr fenstergesizt: als Frontanbau am Roder folgt die Stückzahl 1:1 dem Roder (s. machineFleetCount).
/** Maschinenklassen OHNE eigenen Arbeitsgang, deren Zugang der TONNAGE folgt, nicht der Fläche.
 *  Sie liefen bisher über die Gesamtflächen-Skalierung — der einzige Treiber, der übrig bleibt,
 *  wenn eine Maschine in keinem Arbeitsgang steht. Für Verlade- und Transporttechnik ist das
 *  der falsche: sie bewegt Tonnen, nicht Hektar. */
export const LOGISTIK_TONNAGE_TREIBER: Record<string, string[]> = {
  // Sattelzug ab Hof/Feld zum Abnehmer → gesamte vermarktete Wertkultur-Tonnage.
  lkw_sattel: VALUE_CROP_IDS,
  // Field-Shuttle Feld → Überladestation: nur die Hackfrüchte, die im Bunker anfallen.
  shuttle: ["kartoffel_pommes", "kartoffel_chips", "suesskartoffel", "zwiebel_moehre", "knollensellerie"],
  // Überladetrichter am Feldrand — dieselbe Kette wie das Shuttle, Kartoffelseite.
  fieldloader: ["kartoffel_pommes", "kartoffel_chips", "suesskartoffel"],
  // Radlader auf dem Hof: Verladung ein-/ausgehender Ware.
  radlader: VALUE_CROP_IDS,
};

export const SIZED_MACHINE_IDS = new Set(["pflug", "saatbett", "drille", "einzelkorn", "streuer", "maehdr", "roder_ropa", "gem_schwad", "gem_lader", "gem_moehre", "gem_saat", "knobl_lege", "tomernte", "tompflanz", "onepass", "transport"]);
export const SIZED_TRACTOR_IDS = new Set(["zug_9r", "zug_8rx", "ops_6r"]);
export const isSizedId = (id: string) => SIZED_MACHINE_IDS.has(id) || SIZED_TRACTOR_IDS.has(id);

/** Bearbeitbare Feldtage je Maschine im kritischen Einsatzfenster (wetter-/logistikbereinigt).
 *  Fallback, wenn die Maschine kein eigenes windowDays trägt (v. a. gepoolte Zugklassen).
 *  Kalibriert, so dass das @4.000-ha-Bottom-up den validierten Research-Park reproduziert. */
export const WINDOW_FELDTAGE: Record<string, number> = {
  pflug: 24, saatbett: 30, drille: 30, einzelkorn: 23, streuer: 41, maehdr: 97, roder_ropa: 18,
  tomernte: 24, tompflanz: 18, krautschl: 16, onepass: 31, transport: 44,
  gem_schwad: 20, gem_lader: 20, gem_moehre: 28, gem_saat: 20, knobl_lege: 25,
  zug_9r: 40, zug_8rx: 31, ops_6r: 76,
};
/** Feldtage einer Maschine: eigenes windowDays (editierbar) sonst Fallback-Tabelle. */
export function feldTageOf(domain: Domain, id: string): number {
  const m = domain.machineCatalog.find((x) => x.id === id);
  return m?.windowDays ?? WINDOW_FELDTAGE[id] ?? 30;
}

/** Bedarfsstunden/Jahr einer Maschine (Σ passes × Fläche / C_eff). Für Traktoren:
 *  Σ Stunden aller gezogenen Anbaugeräte (Pooling). */
function fleetDemandHours(domain: Domain, id: string): number {
  if (SIZED_TRACTOR_IDS.has(id)) {
    // Zugmaschine: EIN gemeinsames Bezugsjahr für alle angehängten Geräte — das früheste Jahr,
    //  in dem irgendeines von ihnen gebraucht wird. Ohne diese Klammer würde jedes Anbaugerät
    //  mit den Flächen SEINES eigenen Bedarfsjahrs zählen und der Schlepperbedarf wäre die
    //  Summe von Flächen, die nie gleichzeitig bestehen (z. B. Kartoffel 2027 + Tomate 2031).
    const years = Math.max(1, domain.growth?.years ?? 1);
    const impl = domain.machineCatalog.filter((im) => im.tractorId === id && im.cEff);
    const ys = impl.map((im) => bedarfsJahrOf(domain, im.id, years)).filter((y) => y >= 0);
    if (!ys.length) return 0;
    const yStar = Math.min(...ys);
    let h = 0;
    for (const im of impl) h += machineHoursPerYear(domain, im.id, yStar);
    return h;
  }
  return machineHoursPerYear(domain, id);
}
/** Minimale Stückzahl (Schlagkraft): ⌈Bedarfsstunden / (h/Tag·feldTage·Schicht)⌉. */
export function sizedRequired(domain: Domain, id: string, scenarioId: string): number {
  const tf = shiftFactorOf(domain, scenarioId);
  const hpd = resolveScalar(domain, "en.hours_day", scenarioId) || 10;
  const feldTage = feldTageOf(domain, id);
  const cap = hpd * tf * Math.max(1, feldTage);
  const hours = fleetDemandHours(domain, id);
  return cap > 0 ? Math.max(0, Math.ceil(hours / cap)) : 0;
}

/* ENTFERNT 31.07.2026: deriveFleetSizing — Sizing-Werkbank geloescht, kein Aufrufer. */

/* ==========================================================================
 * MASCHINENPARK — Bedarf je Planjahr, Eigenkosten je ha, Kauf-/Miet-Vergleich.
 *
 *  Eine Stelle für die drei Fragen, die bisher auf sechs Ansichten verteilt waren:
 *  Was brauche ich, wann kommt es dazu, und lohnt es sich überhaupt selbst zu besitzen.
 * ========================================================================== */

/** Bedarfsstunden einer Maschinenklasse im Planjahr y — EXAKT, nicht hochskaliert.
 *
 *  Σ über die Kulturen, die diese Maschine nutzen: Überfahrten × Fläche des Jahres ÷ C_eff.
 *  Ein Basiswert mit einem Flächenfaktor hochzurechnen scheitert zweifach: an der falschen
 *  Bezugsfläche (die Betriebsfläche wächst 300 → 2.334 ha, die Kartoffel aber nur
 *  300 → 1.000 ha — der Roder würde um Faktor 2,3 zu groß) und an der Nullbasis (Kulturen,
 *  die erst 2028 anfangen, haben im Startjahr 0 ha und blieben für immer bei null).
 *  Fremdvergebene Arbeitsgänge zählen NICHT: was der Lohnunternehmer fährt, braucht keine
 *  eigene Maschine. */
export function machineDemandHoursOfYear(domain: Domain, machineId: string, y: number): number {
  const spec = domain.machineCatalog.find((m) => m.id === machineId);
  const cEff = spec?.cEff ?? 0;
  if (!cEff) return 0;
  const areas = cropAreasMemo(domain).areas;
  let h = 0;
  for (const a of domain.anbauplan) {
    const gaenge = (domain.arbeitsgaenge[a.cropId] ?? []).filter((g) => g.m === machineId);
    if (!gaenge.length) continue;
    if (lohnGaengeOf(domain, a.cropId, y).has(machineId)) continue;   // fremdvergeben
    const curve = areas[a.cropId];
    const ha = curve ? (curve[Math.min(y, curve.length - 1)] ?? 0) : a.areaHa;
    h += gaenge.reduce((n, g) => n + g.passes, 0) * ha / cEff;
  }
  return h;
}

/** Fläche der Kulturen, die diese Maschine bedient, im Planjahr y. Der richtige Nenner für
 *  jede €/ha-Aussage: durch die Betriebsfläche zu teilen macht jeden Spezialroder künstlich
 *  billig — der Möhren-Klemmbandroder fährt 467 ha, nicht 2.334. */
export function machineServedHaOfYear(domain: Domain, machineId: string, y: number): number {
  const areas = cropAreasMemo(domain).areas;
  let ha = 0;
  for (const a of domain.anbauplan) {
    if (!(domain.arbeitsgaenge[a.cropId] ?? []).some((g) => g.m === machineId)) continue;
    const curve = areas[a.cropId];
    ha += curve ? (curve[Math.min(y, curve.length - 1)] ?? 0) : a.areaHa;
  }
  return ha;
}

/** Kapazität EINER Einheit in Stunden je Saison: Feldstunden/Tag × Feldtage × Schichtfaktor. */
export function machineCapPerUnitHours(domain: Domain, machineId: string, scenarioId: string): number {
  const hpd = resolveScalar(domain, "en.hours_day", scenarioId) || 10;
  return hpd * shiftFactorOf(domain, scenarioId) * Math.max(1, feldTageOf(domain, machineId));
}

export type MaschinenPfad = {
  machineId: string; label: string; manufacturer?: string; category?: string;
  crops: string[]; cEff: number; widthM: number; speedKmh: number; fieldEff: number;
  feldTage: number; capPerUnitHours: number; preisCent: number;
  /** Stückzahl je Planjahr (Index 0 = START_YEAR). */
  units: number[];
  /** Bedarfsstunden, bediente Fläche und Auslastung je Planjahr. */
  hours: number[]; servedHa: number[]; utilPct: number[];
  /** Eigenkosten je ha und Planjahr (null, wenn keine Fläche/keine Einheit). */
  ownPerHa: (number | null)[];
  /** DREI WEGE zur selben Arbeit, alle drei als €/ha im Endausbau und alle drei
   *  VOLLSTÄNDIG — sonst vergleicht man Äpfel mit Birnen:
   *    kaufen  = AfA + Zins + Vers + Rep + Schmier + Diesel + eigener Fahrer
   *    mieten  = Mietsatz je Stunde (Maschinenkosten + Vermietermarge) + Diesel + eigener Fahrer
   *    Lohn    = Satz je Hektar (Maschine + Fahrer des Unternehmers) + Diesel
   *  Bei Miete bekommt man nur das Gerät, also bleiben Fahrer und Diesel beim Betrieb.
   *  Beim Lohn kommt der Fahrer mit, der Diesel nach den hinterlegten Sätzen nicht. */
  rentPerHa: number | null;      // Lohnarbeit je ha, inkl. Diesel
  mietePerHa: number | null;     // Maschinenmiete je ha, inkl. Diesel und eigenem Fahrer
  /** Mietsatz je Betriebsstunde (Maschine ohne Fahrer). */
  rentPerHour: number | null;
  /** Gewählter Weg. Zugmaschinen kennen kein "lohn" — einen Schlepper vergibt man nicht
   *  als Arbeitsgang, man mietet ihn. */
  beschaffung: "kauf" | "miete" | "lohn";
  /** Fixkosten je Einheit und Jahr, variable Kosten je Stunde (für den Kostenaufriss). */
  fixPerYear: number; varPerHour: number;
  /** Ist die Klasse aktuell vollständig fremdvergeben? */
  gemietet: boolean;
  /** Gepoolte Zugklasse — keine eigene Flächenleistung, Bedarf aus den Anbaugeräten. */
  istZug: boolean;
};

/** Der ganze Maschinenpark als Pfad über die Planjahre — die Datengrundlage des
 *  Maschinenpark-Screens. Ersetzt das Nebeneinander aus Sizing, Investitionsvorschlag,
 *  Anlagenregister und Lohnarbeitstabelle. */
export function deriveMaschinenpark(domain: Domain, scenarioId: string, years: number): MaschinenPfad[] {
  const dieselEur = (domain.assumptions["price.diesel_l"] ? resolveScalar(domain, "price.diesel_l", scenarioId) : 0) / 100;
  const lohnFaktor = domain.assumptions["lohn.factor"] ? resolveScalar(domain, "lohn.factor", scenarioId) : 1;
  const out: MaschinenPfad[] = [];

  for (const spec of domain.machineCatalog) {
    const istZug = SIZED_TRACTOR_IDS.has(spec.id);
    if (!SIZED_MACHINE_IDS.has(spec.id) && !istZug) continue;
    if (!istZug && !spec.cEff) continue;

    // ZUGMASCHINEN haben keine eigene Flächenleistung — sie ziehen. Ihr Bedarf ist die Summe
    //  der Stunden ihrer Anbaugeräte, ihre bediente Fläche die Vereinigung von deren Kulturen.
    //  Wird ein Gerät fremdvergeben, bringt der Lohnunternehmer seinen eigenen Schlepper mit:
    //  machineDemandHoursOfYear lässt diese Stunden weg, also sinkt auch der Zugbedarf.
    const geraete = istZug ? domain.machineCatalog.filter((im) => im.tractorId === spec.id && im.cEff) : [];
    const crops = istZug
      ? [...new Set(geraete.flatMap((im) => domain.anbauplan
          .filter((a) => (domain.arbeitsgaenge[a.cropId] ?? []).some((g) => g.m === im.id))
          .map((a) => a.cropId)))]
      : [...new Set(domain.anbauplan
          .filter((a) => (domain.arbeitsgaenge[a.cropId] ?? []).some((g) => g.m === spec.id))
          .map((a) => a.cropId))];
    if (!crops.length) continue;                       // keine Wertkultur nutzt sie → nicht im Park

    const cap = machineCapPerUnitHours(domain, spec.id, scenarioId);
    const hours = Array.from({ length: years }, (_, y) => istZug
      ? geraete.reduce((h, im) => h + machineDemandHoursOfYear(domain, im.id, y), 0)
      : machineDemandHoursOfYear(domain, spec.id, y));
    const servedHa = Array.from({ length: years }, (_, y) => {
      if (!istZug) return machineServedHaOfYear(domain, spec.id, y);
      const areas = cropAreasMemo(domain).areas;
      return crops.reduce((ha, cid) => {
        const c = areas[cid];
        return ha + (c ? (c[Math.min(y, c.length - 1)] ?? 0) : 0);
      }, 0);
    });
    const units = hours.map((h) => (cap > 0 ? Math.ceil(h / cap) : 0));
    const utilPct = units.map((n, y) => (n > 0 && spec.refHoursPerYear ? Math.min(100, (hours[y] / (n * spec.refHoursPerYear)) * 100) : 0));

    // AfA, Zins und Versicherung fallen je Einheit und JAHR an — unabhängig von den Stunden.
    // Reparatur, Schmierstoff und Diesel je STUNDE. Genau diese Trennung macht sichtbar, warum
    // eine Maschine im Anlaufjahr auf wenig Fläche unwirtschaftlich ist und später nicht mehr.
    const refH = spec.refHoursPerYear ?? 0;
    const fixPerYear = (((spec.afaPerHourCent ?? 0) + (spec.interestPerHourCent ?? 0) + (spec.insurancePerHourCent ?? 0)) / 100) * refH;
    // FAHRER GEHÖRT DAZU. Der Lohnunternehmer stellt Maschine UND Fahrer — die Eigenkosten
    // enthielten bisher nur die Maschine. Ohne diese Zeile sieht Selbstmechanisierung
    // systematisch zu billig aus, und zwar genau um den Posten, den man bei Fremdvergabe
    // tatsächlich einspart. Stundenlohn aus dem Bruttomonatsgehalt des Maschinenführers
    // bei 143,3 Monatsstunden (die Kalibrierung, aus der auch das „7 €/h" im Label stammt).
    const fahrerEurH = (domain.assumptions["pers.stamm.gross"]
      ? resolveScalar(domain, "pers.stamm.gross", scenarioId) / 100 : 0) / 143.3;
    const varPerHour = ((spec.repairPerHourCent ?? 0) + (spec.lubePerHourCent ?? 0)) / 100
      + (spec.dieselLPerHour ?? 0) * dieselEur + fahrerEurH;
    const ownPerHa = units.map((n, y) => (n > 0 && servedHa[y] > 0 ? (n * fixPerYear + hours[y] * varPerHour) / servedHa[y] : null));

    // Lohnsatz der Klasse: höchster hinterlegter Satz über die Kulturen (die Sätze sind je
    // Arbeitsgang identisch). PLUS Diesel — die Sätze sind ausdrücklich exklusive Diesel, und
    // wer sie roh gegen die Eigenkosten stellt, rechnet die Lohnarbeit systematisch zu billig.
    const eintrag = (domain.lohnarbeit ?? []).find((e) => e.machineId === spec.id);
    const dieselProHa = (spec.cEff ?? 0) > 0 ? ((spec.dieselLPerHour ?? 0) * dieselEur) / (spec.cEff as number) : 0;
    const rentPerHa = eintrag ? (eintrag.ratePerHaCent / 100) * lohnFaktor + (eintrag.dieselIncluded ? 0 : dieselProHa) : null;

    const relevant = (domain.lohnarbeit ?? []).filter((e) => e.machineId === spec.id && crops.includes(e.cropId));
    const imLohn = !istZug && relevant.length > 0 && relevant.every((e) => e.active);
    const inMiete = (spec.rentedUnits ?? 0) > 0;
    const beschaffung: "kauf" | "miete" | "lohn" = imLohn ? "lohn" : inMiete ? "miete" : "kauf";
    const gemietet = imLohn || inMiete;

    // Maschinenmiete: NUR das Gerät je Betriebsstunde. Diesel und Fahrer bleiben beim Betrieb,
    //  also müssen beide oben drauf, sonst sähe Miete gegen Kauf künstlich billig aus.
    const rentPerHour = machineRentPerHourCent(domain, spec, scenarioId) / 100;
    const letztesJahr = years - 1;
    const dieselUndFahrerH = (spec.dieselLPerHour ?? 0) * dieselEur + fahrerEurH;
    const mietePerHa = servedHa[letztesJahr] > 0
      ? (hours[letztesJahr] * (rentPerHour + dieselUndFahrerH)) / servedHa[letztesJahr] : null;

    out.push({
      machineId: spec.id, label: spec.label, manufacturer: spec.manufacturer, category: spec.category,
      crops, cEff: spec.cEff ?? 0, widthM: spec.widthM ?? 0, speedKmh: spec.speedKmh ?? 0, fieldEff: spec.fieldEff ?? 0,
      istZug,
      feldTage: feldTageOf(domain, spec.id), capPerUnitHours: cap,
      preisCent: machineUnitPriceCent(domain, spec, scenarioId),
      units, hours, servedHa, utilPct, ownPerHa,
      rentPerHa: istZug ? null : rentPerHa, mietePerHa, rentPerHour, beschaffung,
      fixPerYear, varPerHour, gemietet,
    });
  }
  // Zugmaschinen zuerst: sie tragen alles andere.
  return out.sort((a, b) => Number(b.istZug) - Number(a.istZug)
    || (a.category ?? "").localeCompare(b.category ?? "") || a.label.localeCompare(b.label));
}

/* ==========================================================================
 * PERSONAL — Kopfzahlen aus TREIBERN, nicht aus Phantom-Zahlen.
 *
 *  Der alte Weg: je Position eine editierbare FTE-Zahl, die im Screen wie die Mannschaft
 *  aussah, tatsächlich aber die Kalibrierungsbasis für den Endausbau war und über eine
 *  Wachstumskurve auf die Jahre verteilt wurde. Daneben ein "Personalplaner", der aus den
 *  Zahlen des STARTJAHRES eigene Vorschläge rechnete. Drei Darstellungen derselben Größe,
 *  keine davon beschriftet — und bei den Maschinenführern steuerte das Feld seit der
 *  Umstellung auf gefahrene Stunden gar nichts mehr.
 *
 *  Der neue Weg: jede Position hat EINEN benannten Treiber und EIN Verhältnis. Wie viele
 *  Hektar betreut eine Kraft, wie viele Stunden faehrt ein Fahrer, wie viele Maschinen
 *  betreut ein Techniker. Daraus faellt die Kopfzahl je Planjahr — und sie reagiert
 *  automatisch, wenn Flaeche waechst oder Arbeit fremdvergeben wird.
 * ========================================================================== */

export type PersonalTreiberArt = "flaeche" | "stunden" | "maschinen" | "gedaempft";
export type PersonalPosition = {
  key: string; label: string; grossKey: string;
  art: PersonalTreiberArt; treiberLabel: string;
  /** Anzeige-Einheit des Verhältnisses (Kurzzeichen kommt aus dem Einheiten-Register). */
  einheit: string; einheitId: Unit;
  standard: number;
  /** Position existiert nur mit eigenem Lager/Packhaus (`store.active` = 1). Ohne Anlage
   *  gibt es niemanden ein- und auszulagern — die Ware geht ab Feld an den Verarbeiter. */
  nurMitLager?: boolean;
};
export const PERSONAL_POSITIONEN: PersonalPosition[] = [
  { key: "pers.leitung.n", label: "Betriebsleitung & Agronomie", grossKey: "pers.leitung.gross",
    art: "gedaempft", treiberLabel: "Ziel-FTE im Endausbau (gedämpft: Sockel + Fläche)", einheit: "FTE", einheitId: "fte", standard: 3 },
  { key: "pers.stamm.n", label: "Stamm-Maschinenführer", grossKey: "pers.stamm.gross",
    art: "stunden", treiberLabel: "selbst gefahrene Feldstunden je Fahrer und Jahr", einheit: "h/FTE", einheitId: "hours", standard: 1240 },
  { key: "pers.bewaesserung.n", label: "Bewässerung / Pivot-Steuerung", grossKey: "pers.bewaesserung.gross",
    art: "flaeche", treiberLabel: "betreute Fläche je Kraft", einheit: "ha/FTE", einheitId: "hectare", standard: 584 },
  { key: "pers.lager.n", label: "Lager & Aufbereitung", grossKey: "pers.lager.gross",
    art: "flaeche", treiberLabel: "Fläche je Kraft (nur mit eigenem Lager)", einheit: "ha/FTE", einheitId: "hectare", standard: 584, nurMitLager: true },
  { key: "pers.service.n", label: "Werkstatt & Service/Technik", grossKey: "pers.service.gross",
    art: "maschinen", treiberLabel: "betreute Maschinen je Techniker", einheit: "Stk/FTE", einheitId: "count", standard: 14 },
  { key: "pers.saison.n", label: "Saisonkräfte (Kampagne)", grossKey: "pers.saison.gross",
    art: "flaeche", treiberLabel: "Fläche je Saison-FTE", einheit: "ha/FTE", einheitId: "hectare", standard: 199 },
  { key: "pers.prakt.n", label: "Praktikanten / Trainees", grossKey: "pers.prakt.gross",
    art: "flaeche", treiberLabel: "Fläche je Trainee", einheit: "ha/FTE", einheitId: "hectare", standard: 584 },
];

export function personalRatioOf(domain: Domain, key: string): number {
  const def = PERSONAL_POSITIONEN.find((p) => p.key === key)?.standard ?? 1;
  const v = domain.personalRatio?.[key];
  return v != null && v > 0 ? v : def;
}
export function setPersonalRatio(d: Domain, key: string, wert: number): void {
  d.personalRatio = { ...(d.personalRatio ?? {}), [key]: Math.max(0.0001, wert) };
}
/** Kopfzahl von Hand setzen (oder mit null wieder dem Treiber ueberlassen). */
export function setPersonalOverride(d: Domain, key: string, y: number, wert: number | null): void {
  const jahre = Math.max(1, d.growth?.years ?? 1);
  const alt = d.personalOverride?.[key] ?? [];
  const neu = Array.from({ length: jahre }, (_, i) => (i === y ? wert : (alt[i] ?? null)));
  d.personalOverride = { ...(d.personalOverride ?? {}), [key]: neu };
}
/** Traegt die Position in irgendeinem Jahr eine Handeingabe? */
export function hasPersonalOverride(domain: Domain, key: string): boolean {
  return (domain.personalOverride?.[key] ?? []).some((v) => v != null);
}

/** Kopfzahl (FTE) einer Position im Planjahr y — die EINE Wahrheit, die Engine und Ansicht
 *  gemeinsam benutzen. Vorher rechneten beide getrennt und kamen auf verschiedene Zahlen. */
export function personalFteOfYear(domain: Domain, key: string, y: number, scenarioId: string): number {
  const pos = PERSONAL_POSITIONEN.find((p) => p.key === key);
  if (!pos) return 0;
  const manuell = domain.personalOverride?.[key]?.[y];
  if (manuell != null && isFinite(manuell)) return manuell;   // Hand schlaegt Treiber
  // Lagerpersonal ohne Lager: der Master-Schalter store.active steht auf 0, das Modell trug
  //  aber vier Kraefte "Lager & Aufbereitung" — ein drittes Mal dieselben Leute neben den
  //  SG&A-Zeilen "Lagerpersonal" und "Packhaus-Personal".
  if (pos.nurMitLager) {
    const aktiv = !domain.assumptions["store.active"] || resolveScalar(domain, "store.active", scenarioId) >= 0.5;
    if (!aktiv) return 0;
  }
  const r = personalRatioOf(domain, key);
  const areas = cropAreasMemo(domain).areas;
  const haOf = (yy: number) => domain.anbauplan.reduce((sum, a) => {
    const c = areas[a.cropId];
    return sum + (c ? (c[Math.min(yy, c.length - 1)] ?? 0) : a.areaHa);
  }, 0);
  const haY = haOf(y);
  const haZiel = haOf(Math.max(0, (domain.growth?.years ?? 1) - 1)) || 1;

  switch (pos.art) {
    case "stunden":
      return Math.max(1, Math.ceil(selfOperatedFieldHoursOfYear(domain, y) / Math.max(1, r)));
    case "flaeche":
      return haY > 0 ? haY / Math.max(1, r) : 0;
    case "maschinen": {
      // Nur Maschinen, die der Betrieb SELBST haelt — gemietete und im Lohn gefahrene
      // Technik wartet der Vermieter bzw. der Lohnunternehmer.
      let n = 0;
      for (const m of domain.machineCatalog) {
        if (!m.cEff || (m.rentedUnits ?? 0) > 0) continue;
        const cap = machineCapPerUnitHours(domain, m.id, scenarioId);
        if (cap > 0) n += Math.ceil(machineDemandHoursOfYear(domain, m.id, y) / cap);
      }
      return n > 0 ? Math.max(1, n / Math.max(1, r)) : 0;
    }
    case "gedaempft":
    default: {
      // Skaleneffekt: ein achtmal so grosser Betrieb braucht keine achtfache Leitung.
      //  Sockel 45 % + 55 % flaechenproportional, normiert auf den Endausbau.
      const rel = haZiel > 0 ? haY / haZiel : 1;
      return r * (0.45 + 0.55 * rel);
    }
  }
}

/** Mietsatz je Betriebsstunde (CENT) einer Maschinenklasse.
 *
 *  Bewusst NICHT aus einer eigenen Preisliste, sondern aus den Stundenkosten der Maschine
 *  plus Vermietermarge (machine.rent_markup): der Vermieter trägt dieselben Kosten und will
 *  daran verdienen. Diesel und Fahrer bleiben beim Betrieb — gemietet wird die Maschine,
 *  nicht die Dienstleistung. Genau das unterscheidet MIETE von LOHNARBEIT: der Lohnsatz je
 *  Hektar enthält Fahrer und Diesel, der Mietsatz je Stunde nicht.
 *
 *  Der ökonomische Kern: gemietet zahlt man NUR die gefahrenen Stunden. Die Fixkosten einer
 *  eigenen Maschine laufen auch dann weiter, wenn sie steht — deshalb gewinnt Miete bei
 *  niedriger Auslastung und verliert bei hoher. */
export function machineRentPerHourCent(domain: Domain, spec: MachineType, scenarioId: string): number {
  const markup = domain.assumptions["machine.rent_markup"]
    ? resolveScalar(domain, "machine.rent_markup", scenarioId) : 0.15;
  const stundenkosten = (spec.afaPerHourCent ?? 0) + (spec.interestPerHourCent ?? 0)
    + (spec.insurancePerHourCent ?? 0) + (spec.repairPerHourCent ?? 0) + (spec.lubePerHourCent ?? 0);
  return stundenkosten * (1 + markup);
}

/** Betriebsstunden einer Klasse im Planjahr y — Zugmaschinen aus den Stunden ihrer Geräte. */
export function machineOrTractorHoursOfYear(domain: Domain, machineId: string, y: number): number {
  if (!SIZED_TRACTOR_IDS.has(machineId)) return machineDemandHoursOfYear(domain, machineId, y);
  return domain.machineCatalog
    .filter((im) => im.tractorId === machineId && im.cEff)
    .reduce((h, im) => h + machineDemandHoursOfYear(domain, im.id, y), 0);
}

/** Ganze Klasse mieten statt kaufen. Nutzt den vorhandenen rentedUnits-Pfad: der CAPEX
 *  rechnet Neu = ⌈benötigt − owned − rented⌉, ein sehr großer rentedUnits-Wert klemmt das
 *  also sauber auf null, ohne einen zweiten CAPEX-Pfad einzuführen. */
export function setMachineRented(d: Domain, machineId: string, mieten: boolean): void {
  const m = d.machineCatalog.find((x) => x.id === machineId);
  if (m) m.rentedUnits = mieten ? 9999 : 0;
}

/** Feldstunden, die der Betrieb im Planjahr y SELBST fährt — fremdvergebene Arbeitsgänge
 *  sind ausgenommen, denn dort stellt der Lohnunternehmer den Fahrer mit. Das ist die
 *  Bemessungsgrundlage der Stamm-Maschinenführer: Personal folgt der Arbeit, nicht der
 *  Fläche. Vorher skalierte die Kopfzahl allein mit dem Flächenwachstum — wer eine ganze
 *  Klasse fremdvergab, sparte die Maschine, behielt aber ihren Fahrer in der Lohnliste. */
export function selfOperatedFieldHoursOfYear(domain: Domain, y: number): number {
  let h = 0;
  for (const m of domain.machineCatalog) {
    if (!m.cEff || m.mode !== "fixedFleet") continue;
    h += machineDemandHoursOfYear(domain, m.id, y);
  }
  return h;
}

/** Eine ganze Maschinenklasse fremdvergeben oder zurückholen: schaltet alle Lohnarbeits-Zeilen
 *  dieser Maschine über alle Kulturen. Die Engine zieht daraus beides — die Kosten je ha UND
 *  den Wegfall des CAPEX (bedarfsJahrOf überspringt fremdvergebene Arbeitsgänge). */
export function setMachineOutsourced(d: Domain, machineId: string, aktiv: boolean): void {
  for (const e of d.lohnarbeit ?? []) if (e.machineId === machineId) e.active = aktiv;
}

/* --------------------------------------------------------------------------
 * deriveTransportDecision — Transport ZUM ABNEHMER (~70 km), Make-or-Buy.
 *  KEIN Doppelzählen mit dem In-Field-Transport (Maschine 'transport' in COGS):
 *  dies ist der SEPARATE Abtransport der vermarkteten Ware zum Abnehmer.
 *
 *  Eigenflotte-Vollkosten (wie Excel „Transport Make-or-Buy"):
 *    Zyklus/Fahrt = 2×Distanz/Speed + Lade/Entlade → Fahrten/Jahr/LKW = h_kap/Zyklus,
 *    Jahresleistung/LKW = Fahrten × Nutzlast; LKW nötig = ⌈Menge ÷ Jahresleistung⌉.
 *    Fix: AfA + kalk. Zins + Vers (je LKW). Betrieb: Rep (%/J) + Diesel (Flotten-
 *    Kapazitätsstunden × l/h) + Fahrer (Kapazitätsstunden × Lohn). €/t = Gesamt/Menge.
 *  Vermarktete Tonnage = Σ WERTKULTUREN (Tomate, Kartoffel Pommes+Chips, Zwiebel/Möhre)
 *    areaHa × Ertrag — BRUTTO (Fläche×Ertrag, vor Verlust). Alle Geldwerte in CENT.
 * ------------------------------------------------------------------------ */
// Alle sieben Wertkulturen — Suesskartoffel, Knoblauch und Sellerie fehlten und damit rd.
//  5.500 t Jahresmenge in der LKW-Zahl und in opex.transport.
const TRANSPORT_VALUE_CROPS = VALUE_CROP_IDS;
// Eigenflotte-Parameter (inline-Konstanten, Referenz F).
const LKW: TransportConfig = TRANSPORT_DEFAULT;

/** Effektiver Speditionssatz €/t (CENT): der kalibrierte €/t-Satz gilt für `dist_ref_km`
 *  und skaliert linear mit der tatsächlichen Entfernung zum Abnehmer. Fehlen die
 *  Entfernungs-Keys (Altstände), bleibt es beim reinen €/t-Satz. */
export function speditionRateCent(domain: Domain, scenarioId: string): number {
  const base = resolveScalar(domain, "transport.spedition_rate", scenarioId);
  if (!domain.assumptions["transport.distance_km"] || !domain.assumptions["transport.dist_ref_km"]) return base;
  const km = resolveScalar(domain, "transport.distance_km", scenarioId);
  const ref = resolveScalar(domain, "transport.dist_ref_km", scenarioId);
  if (!isFinite(km) || !isFinite(ref) || ref <= 0 || km <= 0) return base;
  return base * (km / ref);
}

export function deriveTransportDecision(
  domain: Domain,
  scenarioId: string,
): {
  tonnage: number;
  own: { perTCent: number; capexCent: number; totalCent: number; opexCent: number; lkw: number };
  spedition: { perTCent: number; totalCent: number };
  chosen: "own" | "spedition";
} {
  // Vermarktete Tonnage (brutto Fläche×Ertrag über Wertkulturen).
  const yieldKeyOf = (cropId: string): string | undefined =>
    domain.catalog.find((c) => c.cropId === cropId)?.yieldKey;
  let tonnage = 0;
  for (const a of domain.anbauplan) {
    if (!TRANSPORT_VALUE_CROPS.includes(a.cropId)) continue;
    const yk = yieldKeyOf(a.cropId);
    if (yk) tonnage += a.areaHa * resolveScalar(domain, yk, scenarioId);
  }

  // Eigenflotte-Vollkosten (Parameter editierbar via domain.transport).
  const L = domain.transport ?? LKW;
  const cycleH = (2 * L.distanceKm) / L.speedKmh + L.loadUnloadH;
  const capacityHoursPerTruck = L.operatingDays * L.hoursPerDay;
  const tripsPerTruck = capacityHoursPerTruck / cycleH;
  const tonnagePerTruck = tripsPerTruck * L.payloadT;
  const lkw = tonnage > 0 ? Math.max(1, Math.ceil(tonnage / tonnagePerTruck)) : 0;
  const capacityHoursFleet = lkw * capacityHoursPerTruck;

  const afa = (L.priceCent * (1 - L.residualPct)) / L.lifeYears;
  const interest = (L.priceCent * (1 + L.residualPct) / 2) * L.interestRate;
  const vers = L.priceCent * L.versPctYear;
  const fixPerTruck = afa + interest + vers;
  const repAnnual = lkw * L.priceCent * L.repPctYear;
  const dieselPriceCent = resolveScalar(domain, "price.diesel_l", scenarioId);
  const dieselAnnual = capacityHoursFleet * L.dieselLPerHour * dieselPriceCent;
  const driverAnnual = capacityHoursFleet * L.driverEurPerHourCent;
  const ownTotalCent = Math.round(lkw * fixPerTruck + repAnnual + dieselAnnual + driverAnnual);
  const ownCapexCent = Math.round(lkw * L.priceCent);
  const ownPerTCent = tonnage > 0 ? ownTotalCent / tonnage : 0;
  // ZWEI verschiedene Zahlen, bewusst getrennt:
  //  · totalCent  = VOLLKOSTEN inkl. AfA und kalkulatorischem Zins. Nur so ist der Vergleich
  //    gegen die Spedition fair — die Spedition trägt ihre Abschreibung im Satz.
  //  · opexCent   = was in die GuV-Zeile opex.transport gehört: AfA und Zins entstehen dort
  //    NICHT noch einmal, sie kommen über die aktivierten LKW (PPE) und die Finanzierung.
  //    Vorher stand der Vollkostenbetrag in der OpEx UND der LKW im Anlagevermögen UND ein
  //    zweiter LKW-Posten aus dem Maschinenkatalog: dieselbe Flotte dreimal.
  const ownOpexCent = Math.round(lkw * vers + repAnnual + dieselAnnual + driverAnnual);

  // Spedition.
  const rateCent = speditionRateCent(domain, scenarioId);
  const spedTotalCent = Math.round(rateCent * tonnage);

  return {
    tonnage,
    own: { perTCent: ownPerTCent, capexCent: ownCapexCent, totalCent: ownTotalCent, opexCent: ownOpexCent, lkw },
    spedition: { perTCent: rateCent, totalCent: spedTotalCent },
    chosen: domain.decisions.transportToBuyer,
  };
}

export type ContributionCrop = {
  cropId: string; name: string; group: "value" | "break"; areaHa: number;
  revenueCent: number; subsidyCent: number; cogsCent: number;
  contributionCent: number; contribPerHaCent: number;
  // --- Vollkosten-Sicht (analytisch, reconciled auf §3 / Referenz A) ---
  machineAfaZinsPerHaCent: number; personnelPerHaCent: number; fixPerHaCent: number;
  betriebsergebnisCent: number; bePerHaCent: number;
};

/* --------------------------------------------------------------------------
 * deriveContribution — Ergebnisbeitrag je Kultur, für den Contribution-Chart.
 *  IMMER über die VOLLE Rotation (buildAnbauplan(stage)), UNABHÄNGIG vom scope.
 *
 *  ZWEI Sichten je Kultur:
 *   1) Deckungsbeitrag (DB): contribution = Revenue + Subvention − COGS(Agronomie +
 *      Maschinen-Betrieb). Engine-konsistent (Netto-Ertrag nach Ernteverlust).
 *   2) Vollkosten-Betriebsergebnis (BE), reconciled auf §3 / Referenz A:
 *      BE = contribution + Ernteverlust-Rückrechnung − area × (Maschinen-AfA/Zins +
 *      Personal(§3) + Fix(Pacht+Overhead+Beregnung-Pivot)).
 *      Die Ernteverlust-Rückrechnung (netRev→grossRev) reconciled auf §3, das den
 *      Ernteverlust NICHT modelliert (Referenz A rechnet Brutto-Ertrag×Preis).
 *  Alle Geldwerte in CENT.
 * ------------------------------------------------------------------------ */
export function deriveContribution(
  domain: Domain,
  scenarioId: string,
): {
  crops: ContributionCrop[];
  totals: { valueCent: number; breakCent: number; totalCent: number; valueBeCent: number; breakBeCent: number; totalBeCent: number };
  breakShare: number;
  breakShareBe: number;
} {
  const sc = scenarioId;
  // Flächen aus dem TATSÄCHLICHEN (ggf. gescopten) Anbauplan — nicht aus dem fixen buildAnbauplan(stage),
  //  sonst zeigt der Kulturmix bei STUFE 1 (Cash-only) Wertkulturen, die in der GuV nicht existieren.
  const areaByCrop = new Map(domain.anbauplan.map((a) => [a.cropId, a.areaHa]));
  // FÖRDERUNG AUS DEM SUBVENTIONS-REGISTER, nicht aus zwei losgelösten Annahmen.
  //  Bis 31.07.2026 rechnete diese Ansicht mit `subsidy.per_ha` (205 €/ha) und
  //  `subsidy.coupled_freilandgemuese` (1.612 €/ha, nur Tomate und Zwiebel/Möhre). Beide Keys
  //  liest die Engine nirgends — sie zahlt BISS 100,66 + Öko 70,00 = 170,66 €/ha auf die
  //  gesamte Fläche und die gekoppelte Stützung auf FÜNF Kulturen (Tomate, Zwiebel/Möhre,
  //  Sellerie, Süßkartoffel, Knoblauch). Der Deckungsbeitrag je ha wich damit für drei
  //  Kulturen um 1.607 €/ha von der GuV ab, in die andere Richtung um 34 €/ha.
  const subsidyFactor = domain.assumptions["subsidy.factor"] ? resolveScalar(domain, "subsidy.factor", sc) : 1;
  const subsidyPerHaOf = (cropId: string): number => {
    let cent = 0;
    for (const s of domain.subsidies ?? []) {
      if (s.active === false || s.basis !== "per_ha") continue;
      // Staffelprämien (firstHaCap) lassen sich nicht je Hektar ausweisen — sie hängen an der
      //  Betriebsgröße, nicht an der Kultur. Sie bleiben hier außen vor (heute alle inaktiv).
      if (s.firstHaCap != null && s.firstHaCap > 0) continue;
      if (s.cropIds && s.cropIds.length && !s.cropIds.includes(cropId)) continue;
      cent += s.ratePerHaCent ?? 0;
    }
    return cent * subsidyFactor;
  };
  const agronomyPerHaCent = (cat: CatalogEntry): number => {
    let cent = 0;
    for (const op of cat.ops) for (const ln of op.lines) cent += ln.quantityPerHa * resolveScalar(domain, ln.unitCostKey, sc);
    return cent;
  };

  const crops: ContributionCrop[] = [];
  let valueCent = 0, breakCent = 0, valueBeCent = 0, breakBeCent = 0;
  for (const cat of domain.catalog) {
    const cropId = cat.cropId;
    const area = areaByCrop.get(cropId) ?? 0;
    // Kulturen ohne Fläche im Plan erzeugen keine Zeile. Der Katalog trägt weiterhin die
    //  Stammdaten der Ackerbau-Kulturen (Weizen/Gerste/Mais/Raps/Soja) als Referenz — sie
    //  sollen aber nicht als Nullzeilen in Contribution-Tabelle und -Chart auftauchen.
    if (area <= 0) continue;
    const y = resolveScalar(domain, cat.yieldKey, sc);       // t/ha
    const price = resolveScalar(domain, cat.priceKey, sc);   // CENT/t
    const loss = resolveScalar(domain, cat.lossKey, sc);     // Rate
    const revenueCent = Math.round(area * y * price * (1 - loss));
    const isValue = VALUE_CROP_IDS.includes(cropId);
    const subsidyCent = Math.round(area * subsidyPerHaOf(cropId));
    const cogsCent = Math.round(area * (agronomyPerHaCent(cat) + machineOpCostPerHaCent(domain, cropId, sc)));
    const contributionCent = revenueCent + subsidyCent - cogsCent;
    const contribPerHaCent = area > 0 ? contributionCent / area : 0;

    // --- Vollkosten-Allokation (§3) ---
    const machAfaZins = machineAfaZinsPerHaCent(domain, cropId, sc);
    const personnelPerHa = PERSONNEL_MASCH_PER_HA_CENT[cropId as CropId] ?? 0;
    const fixPerHa = (PACHT_PER_HA + (OVERHEAD_PER_HA[cropId as CropId] ?? 0) + (BEREGNUNG_PIVOT_PER_HA[cropId as CropId] ?? 0)) * 100;
    // Ernteverlust-Rückrechnung netto→brutto (§3 modelliert keinen Verlust):
    const lossAddbackCent = Math.round(area * y * price * loss);
    const extraFullCostCent = Math.round(area * (machAfaZins + personnelPerHa + fixPerHa));
    const betriebsergebnisCent = contributionCent + lossAddbackCent - extraFullCostCent;
    const bePerHaCent = area > 0 ? betriebsergebnisCent / area : 0;

    const group: "value" | "break" = isValue ? "value" : "break";
    crops.push({
      cropId, name: cat.name, group, areaHa: area,
      revenueCent, subsidyCent, cogsCent, contributionCent, contribPerHaCent,
      machineAfaZinsPerHaCent: machAfaZins, personnelPerHaCent: personnelPerHa, fixPerHaCent: fixPerHa, betriebsergebnisCent, bePerHaCent,
    });
    if (isValue) { valueCent += contributionCent; valueBeCent += betriebsergebnisCent; }
    else { breakCent += contributionCent; breakBeCent += betriebsergebnisCent; }
  }

  const totalCent = valueCent + breakCent;
  const totalBeCent = valueBeCent + breakBeCent;
  return {
    crops,
    totals: { valueCent, breakCent, totalCent, valueBeCent, breakBeCent, totalBeCent },
    breakShare: totalCent > 0 ? breakCent / totalCent : 0,
    breakShareBe: totalBeCent > 0 ? breakBeCent / totalBeCent : 0,
  };
}

/* ENTFERNT 31.07.2026 (Aufräumen Solo-Modell): scopeToValueOnly · scopeToEntity ·
   scaleGrowthToEntity · scopeToCashOnly · VALUE_ONLY_MACHINE_IDS · deriveValueCropCase ·
   scopedDomain. Nach der Solo-Umstellung waren das reine Identitätsfunktionen oder sie
   bauten Zustände auf, die es nicht mehr gibt:
    · scopeToValueOnly filterte auf Wertkulturen — der Anbauplan BESTEHT nur aus Wertkulturen;
      den Maschinenfilter wendet valueCropMachineCatalog bereits im SEED an.
    · scopeToEntity/scaleGrowthToEntity filterten auf EINE Gesellschaft — es gibt nur eine
      operative Gesellschaft, der Filter traf immer alle Zeilen.
    · scopeToCashOnly baute einen synthetischen Ackerbau-Betrieb aus Kulturen, die aus dem
      Modell entfernt sind; erreichbar war das nur über den gelöschten Stufen-Umschalter.
    · deriveValueCropCase leitete "den Wertkultur-Fall" aus dem Kombimodell ab — das SEED IST
      dieser Fall.
   Aufrufer arbeiten jetzt direkt auf der Domäne. */


/** Entity-Sicht: filtert das Kombimodell auf EINE Gesellschaft (Vollkosten-Standalone) — nur ihre
 *  Kulturen (entityOfEntry), nur die davon genutzten Maschinen, Wachstum flach auf die Entity-Fläche
 *  (Zwei-Pool: beregnet + trocken erhalten). Die Engine rechnet daraus ALLE Sektionen voll (P&L,
 *  Bilanz, Cashflow, Liquidität, Demand). Read-only-Transform (mutiert die gespeicherte Domäne nicht). */






/* --------------------------------------------------------------------------
 * Finanzierung: Vertrag → DebtTranche + abgeleitete Kennzahlen (Composer + View).
 * principal = entryValueCent (falls gesetzt) sonst live Σ Objektwerte (netto Einkauf).
 * ------------------------------------------------------------------------ */
/** Netto-Einkaufswerte je Maschinen-id (CENT) — identisch zur CAPEX-Bildung im Composer. */
export function machineCapexAmounts(
  domain: Domain,
  scenarioId: string,
): Map<string, { label: string; amountCent: number; assetClass: string }> {
  const derived = deriveCapex(domain, scenarioId).filter((d) => d.amount > 0);
  const machineById = new Map(domain.machineCatalog.map((m) => [m.id, m]));
  const effById = new Map(deriveEffectiveMachineCost(domain, scenarioId).machines.map((e) => [e.id, e]));
  const out = new Map<string, { label: string; amountCent: number; assetClass: string }>();
  for (const d of derived) {
    const m = machineById.get(d.machineId)!;
    const amountCent = m.mode === "fixedFleet" ? (effById.get(d.machineId)?.netCent ?? d.amount) : d.amount;
    out.set(d.machineId, { label: d.label, amountCent, assetClass: d.assetClass });
  }
  return out;
}

export type FinancingObject = { id: string; label: string; amountCent: number };
export type FinancingDerived = {
  contract: LeasingContract;
  objects: FinancingObject[];
  entryValueCent: number;   // Objektwert netto (Σ oder override)
  avansCent: number;        // Anzahlung
  financedCent: number;     // finanzierter Betrag (entry − avans)
  residualCent: number;     // Restwert-Ballon
  feesUpfrontCent: number;  // Σ Einmalgebühren (Analyse+Registrierung+Verwaltung+Abschluss)
  tranche: DebtTranche;     // für die 3-Statement-Engine
};

/** Ein Finanzierungsvertrag → abgeleitete Werte + DebtTranche. */
export function deriveFinancingContract(
  c: LeasingContract,
  amounts: Map<string, { label: string; amountCent: number; assetClass: string }>,
): FinancingDerived {
  const objects: FinancingObject[] = c.objectIds
    .map((id) => { const a = amounts.get(id); return a ? { id, label: a.label, amountCent: a.amountCent } : null; })
    .filter((x): x is FinancingObject => !!x);
  const sumObjects = objects.reduce((s, o) => s + o.amountCent, 0);
  const entryValueCent = c.entryValueCent && c.entryValueCent > 0 ? c.entryValueCent : sumObjects;
  const avansCent = Math.round(entryValueCent * (c.avansRate ?? 0));
  const residualCent = Math.round(entryValueCent * (c.residualRate ?? 0));
  const financedCent = entryValueCent - avansCent;
  const feesUpfrontCent =
    (c.feeAnalysisCent ?? 0) + (c.feeRegistrationCent ?? 0) + (c.feeClosingCent ?? 0) +
    (c.feeAdminCent ?? 0) + Math.round((financedCent) * (c.feeAdminRate ?? 0));
  const tranche: DebtTranche = {
    id: `dbt-${c.id}`,
    name: `${c.lessor} · ${c.name}`,
    principal: entryValueCent,
    drawPeriod: c.drawPeriod ?? 0,
    termMonths: c.termMonths,
    rateBasis: c.rateBasis,
    fixedRate: c.fixedRate,
    floatingSpread: c.floatingSpread,
    referenceRateKey: c.referenceRateKey,
    repayment: c.repayment,
    avansRate: c.avansRate,
    residualRate: c.residualRate,
    frequency: c.frequency,
    seasonMonths: c.seasonMonths,
  };
  return { contract: c, objects, entryValueCent, avansCent, financedCent, residualCent, feesUpfrontCent, tranche };
}

/** Alle aktiven Verträge → abgeleitete Werte (für Finanzierungs-Screen + Composer). */
export function deriveFinancing(domain: Domain, scenarioId: string): FinancingDerived[] {
  const amounts = machineCapexAmounts(domain, scenarioId);
  return (domain.financingContracts ?? [])
    .filter((c) => c.active !== false)
    .map((c) => deriveFinancingContract(c, amounts));
}

/* --------------------------------------------------------------------------
 * Ersatzinvestitionen (revolvierende Flottenerneuerung).
 *  Tauschzyklus je Maschine C = min(Haltedauer, Bh-Kappung / Bh je Jahr) [Jahre].
 *  Jährliche Ersatzinvestition (revolvierend, 1/C der Flotte) = (Netto − Restwert)/C.
 *  Aus dem operativen Cashflow finanziert; skaliert mit der Fläche (Ramp).
 * ------------------------------------------------------------------------ */
export type ReplacementMachine = {
  id: string; label: string; hoursPerYear: number; cycleYears: number; afaYears: number; enabled: boolean;
  fleetNetCent: number; fleetResidualCent: number;
  annualReplaceCent: number;   // Brutto-Ersatzinvestition (Neukauf) je Jahr = Netto/Zyklus
  annualProceedsCent: number;  // Verkaufserlös Ausmusterung je Jahr = Restwert/Zyklus
  annualLossCent: number;      // Buchergebnis Ausmusterung je Jahr (negativ = Verlust)
};
/** Ersatzinvestitionen je Maschine — Tauschzyklus, AfA-Dauer, Neukauf/Verkauf/Buchergebnis. */
export function deriveReplacementCapex(domain: Domain, scenarioId: string): {
  machines: ReplacementMachine[]; totalReplaceCent: number; totalProceedsCent: number; totalLossCent: number;
} {
  const holdYears = Math.max(1, resolveScalar(domain, "tco.hold_years", scenarioId));
  const replaceHours = Math.max(500, resolveScalar(domain, "capex.replace_hours", scenarioId));
  const defAfa = Math.max(1, resolveScalar(domain, "capex.afa_years", scenarioId));
  const eff = deriveEffectiveMachineCost(domain, scenarioId).machines;
  const byId = new Map(domain.machineCatalog.map((m) => [m.id, m]));
  const cfgAll = domain.replacement ?? {};
  const machines: ReplacementMachine[] = [];
  let tRepl = 0, tProc = 0, tLoss = 0;
  for (const e of eff) {
    if (e.netCent <= 0) continue;
    const cfg = cfgAll[e.id] ?? {};
    const hours = cfg.hoursPerYear ?? byId.get(e.id)?.refHoursPerYear ?? 400;
    const hoursCycle = hours > 0 ? replaceHours / hours : holdYears;
    const cycleYears = Math.max(2, Math.min(25, Math.round(cfg.cycleYears ?? Math.min(holdYears, hoursCycle))));
    const afaYears = Math.max(cycleYears, Math.round(cfg.afaYears ?? defAfa));
    const enabled = cfg.enabled ?? true;
    const annualReplace = enabled ? Math.round(e.netCent / cycleYears) : 0;
    const annualProceeds = enabled ? Math.round(e.residualCent / cycleYears) : 0;
    // Restbuchwert bei Ausmusterung (Alter = Zyklus, lineare AfA über afaYears auf 0):
    const bookAtCycle = e.netCent * Math.max(0, 1 - cycleYears / afaYears);
    const annualLoss = enabled ? Math.round((e.residualCent - bookAtCycle) / cycleYears) : 0;
    machines.push({ id: e.id, label: e.label, hoursPerYear: hours, cycleYears, afaYears, enabled,
      fleetNetCent: e.netCent, fleetResidualCent: e.residualCent,
      annualReplaceCent: annualReplace, annualProceedsCent: annualProceeds, annualLossCent: annualLoss });
    tRepl += annualReplace; tProc += annualProceeds; tLoss += annualLoss;
  }
  return { machines, totalReplaceCent: tRepl, totalProceedsCent: tProc, totalLossCent: tLoss };
}

/* --------------------------------------------------------------------------
 * buildModelState — Composer: Domäne → gültiger ModelState.
 * ------------------------------------------------------------------------ */
export function buildModelState(domainIn: Domain, scenarioId: string = domainIn.baseScenarioId): ModelState {
  // SOLO-MODELL: keine Entity-Filterung, kein Scope, keine Stufen-Umschaltung mehr.
  //  Es gibt eine operative Gesellschaft, der Anbauplan besteht ausschließlich aus
  //  Wertkulturen, und Intercompany-Maschinenmiete existiert nicht (rentedUnits immer 0).
  const isCombined = true;
  const domain: Domain = domainIn;
  const fullArea = domain.anbauplan.reduce((s, a) => s + a.areaHa, 0);
  const usedArea = fullArea;
  // Personal skaliert mit der genutzten Fläche (bevorzugt); die verbleibende Flotte bleibt
  // je Typ konservativ voll (Spitzenmonat-Sizing skaliert nicht linear) — nur Break-only-
  // Maschinen entfallen. areaFactor = genutzte/volle Fläche.
  const areaFactor = fullArea > 0 ? usedArea / fullArea : 1;
  const scopeFactor = 1;   // Solo-Modell: kein Scope-Abschlag mehr (areaFactor bleibt für die Flotte)

  const sf = stageFactorOf(domain.stage);
  const farmId = "farm-neos";
  const farms: Farm[] = [{ id: farmId, name: domain.meta.name, currency: domain.meta.reportingCurrency }];

  // Kulturen: eine je Katalog-Eintrag.
  const crops: Crop[] = domain.catalog.map((c) => ({ id: c.cropId, name: c.name, type: c.type }));

  // Parzellen: eine je Anbauplan-Zeile.
  const parcels: Parcel[] = domain.anbauplan.map((a) => {
    const cat = domain.catalog.find((c) => c.cropId === a.cropId);
    return { id: `parcel-${a.id}`, farmId, name: `${cat?.name ?? a.cropId} · ${a.areaHa} ha`, areaHa: a.areaHa };
  });

  // CropPlans: eine je Anbauplan-Zeile; Agronomie aus Katalog + composer-Maschinen-Operation.
  const cropPlans: CropPlan[] = domain.anbauplan.map((a) => {
    const cat = domain.catalog.find((c) => c.cropId === a.cropId);
    const operations: Operation[] = (cat?.ops ?? []).map((op) => {
      // Ernte-/Nachernte-Blöcke an den (variablen) Anbauplan koppeln.
      let costPeriods = op.costPeriods;
      if (op.code === "OP-MAT" || op.code === "OP-HAND") costPeriods = a.harvestPeriods.slice();
      const lines: CostLine[] = op.lines.map((ln, i) => ({
        id: `${a.id}-${op.code}-${i}`,
        label: ln.label,
        costType: ln.costType,
        quantityPerHa: ln.quantityPerHa,
        unitCostKey: ln.unitCostKey,
      }));
      return { id: `${a.id}-${op.code}`, label: op.label, costPeriods, lines };
    });

    // Maschinen-Betriebskosten (Vers+Rep+Diesel+Schmier) als EINE zusätzliche COGS-Operation.
    // Cent → EUR/ha, da unitCostKey 'price.per_euro' (100 ct = 1 €) wieder auf CENT hochskaliert.
    const machineOpEur = machineOpCostPerHaCent(domain, a.cropId, scenarioId) / 100;
    operations.push({
      id: `${a.id}-OP-MASCH`,
      label: "Maschinen-Betriebskosten (Vers+Rep+Diesel+Schmier)",
      costPeriods: [clampP(a.plantingPeriod)],
      lines: [{
        id: `${a.id}-OP-MASCH-0`,
        label: "Maschinen-Betrieb (aus Arbeitsgängen)",
        costType: "machine",
        quantityPerHa: machineOpEur,
        unitCostKey: "price.per_euro",
      }],
    });

    // Lohnarbeit (Dienstleistungs-Einkauf) als eigene COGS-Operation — Satz × Überfahrten × ha,
    //  exkl. Diesel. Wird wie jede Feldmaßnahme im Feldbestand aktiviert und bei Ernte aufgelöst.
    //  Der Betrag ist JAHRESABHÄNGIG (ab/bis Planjahr) und wird in cropPlansMY je Jahr neu gesetzt.
    const lohnEur0 = lohnarbeitPerHaCent(domain, a.cropId, scenarioId, 0) / 100;
    operations.push({
      id: `${a.id}-OP-LOHN`,
      label: "Lohnarbeit (Dienstleistung, exkl. Diesel)",
      costPeriods: [clampP(a.plantingPeriod)],
      lines: [{
        id: `${a.id}-OP-LOHN-0`,
        label: "Fremdvergebene Arbeitsgänge",
        costType: "machine",
        quantityPerHa: lohnEur0,
        unitCostKey: "price.per_euro",
      }],
    });

    return {
      id: `cp-${a.id}`,
      parcelId: `parcel-${a.id}`,
      cropId: a.cropId,
      areaHa: a.areaHa,
      plantingPeriod: a.plantingPeriod,
      harvestPeriods: a.harvestPeriods.slice(),
      yieldAssumptionKey: cat?.yieldKey ?? "",
      priceAssumptionKey: cat?.priceKey ?? "",
      lossRateAssumptionKey: cat?.lossKey,
      qualityAssumptionKey: cat?.qualityKey,
      operations,
      variableCostKeysPerHa: [],
      // Doppelfruchtsystem: nach Wintergerste-Ernte (Juni) Zweitfrucht-Soja (Ernte ~Okt, Periode 9),
      //  verifiziert nur beregnet machbar (~2,1 t/ha, 000/00-Sorte). Maschinenarbeit (Einzelkorn/
      //  Mähdrusch) steckt bereits in ARBEITSGAENGE[gerste_zw]; hier nur Zusatz-Betriebsmittel ~430 €/ha.
      secondCrop: a.cropId === "gerste_zw" ? {
        label: "Zweitfrucht-Soja (Doppelfrucht)",
        yieldAssumptionKey: "yield.soja_zw",
        priceAssumptionKey: "price.soja_luzerne",
        lossRateAssumptionKey: "loss.soja_luzerne",
        harvestPeriod: 9,
        extraCostPerHaCent: 43000,
      } : undefined,
    };
  });

  // CapEx: ABGELEITET aus machineCatalog (feste Flotte × stageFactor) + Beregnung + Lager.
  //  Feldmaschinen (fixedFleet): globale TCO — amount = Netto-Einkauf, salvageValue = Restwert,
  //  Nutzungsdauer = Haltedauer (tco.hold_years); Engine-AfA = (net − residual)/holdY.
  //  Beregnung/Lager: unverändert auf ihrer Nutzungsdauer, KEIN TCO.
  const derived = deriveCapex(domain, scenarioId);
  const machineById = new Map(domain.machineCatalog.map((m) => [m.id, m]));
  const effCost = deriveEffectiveMachineCost(domain, scenarioId);
  const effById = new Map(effCost.machines.map((e) => [e.id, e]));
  const holdMonths = Math.max(12, Math.round(resolveScalar(domain, "tco.hold_years", scenarioId)) * 12);
  // Innenfinanzierung: Neuanschaffungen aus Cash statt Kredit/Leasing (Revolver = automatischer
  //  „genug Cash?"-Check). Bei aktivem selfFund werden die Maschinen-Finanzierungsverträge NICHT
  //  gezogen → CAPEX zahlungswirksam aus Cash; Deckungslücken fängt der Revolver.
  const selfFundCapex = resolveScalar(domain, "finance.capex_selffund", scenarioId) >= 0.5;
  // Finanzierung: welches Objekt hängt an welchem Vertrag? (financingMode je CAPEX-Position)
  const financing = deriveFinancing(domain, scenarioId);
  const modeByMachine = new Map<string, FinancingMode>();
  if (!selfFundCapex) for (const f of financing) {
    const mode: FinancingMode = f.contract.kind === "loan" ? "loan"
      : f.contract.kind === "lease_op" ? "lease_op" : "lease_fin";
    for (const o of f.objects) modeByMachine.set(o.id, mode);
  }
  const capex: CapexItem[] = derived
    .filter((d) => d.amount > 0)
    .map((d) => {
      const m = machineById.get(d.machineId)!;
      const financingMode: FinancingMode = modeByMachine.get(d.machineId) ?? "cash";
      if (m.mode === "fixedFleet") {
        const e = effById.get(d.machineId)!;
        // Gemietete Einheiten NICHT kapitalisieren — nur der nicht-gemietete Flottenanteil wird PPE.
        //  rf = 1 bei rentedUnits=0 (kein Verhaltensänderung für bestehende Modelle).
        const rf = d.count && d.count > 0 ? (d.count - (d.rentedUnits ?? 0)) / d.count : 1;
        return {
          id: `cx-${d.machineId}`,
          name: d.label,
          assetClass: d.assetClass as AssetClass,
          amount: Math.round(e.netCent * rf),        // Netto-Einkauf (ohne gemietete Einheiten)
          salvageValue: Math.round(e.residualCent * rf), // Restwert bleibt als PPE stehen
          purchasePeriod: 0,
          usefulLifeMonths: holdMonths,
          usefulLifeFiscalMonths: Math.max(12, holdMonths - 12),
          financingMode,
        };
      }
      return {
        id: `cx-${d.machineId}`,
        name: d.label,
        assetClass: d.assetClass as AssetClass,
        amount: d.amount,
        purchasePeriod: 0,
        usefulLifeMonths: m.afaCommercialYears * 12,
        usefulLifeFiscalMonths: m.afaFiscalYears * 12,
        financingMode,
      };
    });

  // IFRS 16 — anfängliche direkte Kosten (Einmalgebühren) werden in den Right-of-Use-Asset
  // aktiviert und über die kürzeste Vertragslaufzeit abgeschrieben (kein sofortiger Aufwand).
  const feesTotalCent = financing.reduce((s, f) => s + f.feesUpfrontCent, 0);
  if (!selfFundCapex && feesTotalCent > 0) { // Cash-first: keine Verträge → keine Vertragsgebühren
    const termsM = financing.map((f) => f.contract.termMonths).filter((t) => t > 0);
    const feeLifeM = termsM.length ? Math.min(...termsM) : 60;
    capex.push({
      id: "cx-fin-fees",
      name: "Finanzierungs-Nebenkosten (aktiviert, IFRS 16)",
      assetClass: "other",
      amount: feesTotalCent,
      purchasePeriod: 0,
      usefulLifeMonths: feeLifeM,
      usefulLifeFiscalMonths: feeLifeM,
      financingMode: "cash",
    });
  }

  // --- Transport zum Abnehmer (Make-or-Buy): opex.transport + ggf. LKW-CAPEX ----
  const transport = deriveTransportDecision(domain, scenarioId);
  //  In die GuV geht der OPEX-Anteil (Versicherung, Reparatur, Diesel, Fahrer). AfA und Zins
  //  der Eigenflotte entstehen NICHT hier, sondern über den aktivierten Sattelzug im
  //  Maschinenkatalog (`cx-lkw_sattel`, Stückzahl = deriveTransportDecision.own.lkw) und die
  //  zugehörige Finanzierung. Der frühere Zusatzposten `cx-transport-fleet` ist damit
  //  entfallen: er kaufte dieselben LKW ein zweites Mal.
  const transportTotalCent = transport.chosen === "own" ? transport.own.opexCent : transport.spedition.totalCent;

  // --- Assumptions-Overrides (composer-seitig, deterministisch) --------------
  const assumptions: Record<string, Assumption> = { ...domain.assumptions };
  const overrideConst = (key: string, value: number) => {
    const b = domain.assumptions[key];
    assumptions[key] = {
      id: b?.id ?? key,
      key,
      label: b?.label ?? key,
      unit: b?.unit ?? "money",
      scenarioProfiles: { [domain.baseScenarioId]: { kind: "constant", value } },
      meta: b?.meta,
    };
  };

  // Basiswerte (Jahr-1) für OpEx/Personal; die eigentliche Zuweisung (Konstante ODER
  // Jahres-Kurve je nach Horizont) erfolgt unten via setScaled im Ramp-Block.
  // Pacht ist aus opex.fix herausgelöst (eigene Zeile opex.pacht, s. u.) → hier NUR Overhead.
  let annualFixEur = 0;
  for (const a of domain.anbauplan) {
    const overhead = OVERHEAD_PER_HA[a.cropId as CropId] ?? 0;
    annualFixEur += overhead * a.areaHa;
  }
  // LAGER- UND PACKHAUS-GEMEINKOSTEN folgen dem Master-Schalter `store.active`.
  //  Er steht auf 0 (kein Lager, kein Packhaus — die Ware geht Feld → Verarbeiter), die
  //  beiden Blöcke liefen aber trotzdem voll mit: Kühllager 8.900 €/Monat und Packhaus
  //  17.200 €/Monat, zusammen rund 313 T€ im Jahr für Anlagen, die im Plan nicht existieren.
  //  Darin standen obendrein „Packhaus-Personal" und „Lagerpersonal" ein zweites Mal neben
  //  `pers.lager.n` aus dem FTE-Modell. Wird das Lager aktiviert, kommen beide Blöcke
  //  vollständig zurück.
  const storeAktivSga = !domain.assumptions["store.active"] || resolveScalar(domain, "store.active", scenarioId) >= 0.5;
  const overheadItems = (domain.overhead ?? []).filter((o) => storeAktivSga || !OVERHEAD_STORE_GROUPS.has(o.group));
  const overheadMonthly = overheadItems.reduce((s, o) => s + (o.monthlyCent || 0), 0);
  const personnelScale = sf * scopeFactor;

  // --- Subventionen ---------------------------------------------------------
  //  · CAP-Basisprämie (alle Parzellen)   → aus domain.subsidies.
  //  · Gekoppelte Stützung 1.612 €/ha     → NUR Tomate + Zwiebel/Möhre-Parzellen.
  //  · Zweitkultur-Beitrag Gerste 505 €/ha → als eigene Erlöszeile (Subsidy-artig),
  //    NUR Gerste-Parzellen. Bewusste Wahl: als Subvention/Ertrag modelliert, damit
  //    er getrennt vom §3-Kostenblock in der GuV ausgewiesen wird (kein neg. Kostenblock).
  const parcelsFor = (cropIds: string[]): string[] =>
    domain.anbauplan.filter((a) => cropIds.includes(a.cropId)).map((a) => `parcel-${a.id}`);
  const areaFor = (cropIds?: string[]): number =>
    cropIds && cropIds.length
      ? domain.anbauplan.filter((a) => cropIds.includes(a.cropId)).reduce((s, a) => s + a.areaHa, 0)
      : usedArea;

  const debtBase: DebtTranche[] = [...(selfFundCapex ? [] : financing.map((f) => f.tranche)), ...domain.debt];

  /* ================= Mehrjahres-Ausbau (Ramp) ==============================
   * yearScale[y] = Ziel-ha[y] / Basisfläche. Skaliert Fläche/Umsatz, OpEx/Personal,
   * Subventionen; CAPEX & Finanzierung werden als Jahrgänge (Vintages) mit
   * deltaScale phasiert (Zukauf bei Skalierung). Die Bilanz-Identität erzwingt die Engine. */
  const years = Math.max(1, domain.growth?.years ?? 1);
  // Effektiver Wachstumsplan nach aktiver Stufe (s1/s2/s3b) — treibt alle Ramp-Blöcke.
  const gEff = effectiveGrowth(domain.growth);
  const baseArea = usedArea > 0 ? usedArea : 1;
  const scale: number[] = Array.from({ length: years }, (_, y) => {
    const a = gEff?.areaByYear?.[y];
    return a && a > 0 ? a / baseArea : 1;
  });
  const dScale = scale.map((s, y) => s - (y > 0 ? scale[y - 1] : 0));
  // Maschinen-Skalierung: ohne Betriebsübernahmen (entfallen) identisch mit der Flächen-
  //  Skalierung — es gibt keine mitgekaufte Fremdflotte mehr herauszurechnen.
  const machScale = scale.slice();
  const dMachScale = machScale.map((s, y) => s - (y > 0 ? machScale[y - 1] : 0));
  // Kultur-Politik-Kurven (Kartoffel-Ramp/Tomaten-Fix/Residual) — EINMAL hier abgeleitet, treiben
  //  Umsatz (cropPlansMY), Subventionen, OPEX-Fix, Lager-/Maschinen-Vintages und Finanzierungs-Vintages.
  const cropAreasMY = deriveCropAreasMY(domain);
  const cropBaseHa = new Map<string, number>();
  for (const e of domain.anbauplan) cropBaseHa.set(e.cropId, (cropBaseHa.get(e.cropId) ?? 0) + e.areaHa);
  const cropFactor = (cropId: string, y: number): number => {
    const base = cropBaseHa.get(cropId) ?? 0;
    const curve = cropAreasMY.areas[cropId];
    return base > 0 && curve ? curve[Math.min(y, curve.length - 1)] / base : scale[y];
  };
  /** ABSOLUTE Fläche der Kultur im Planjahr y (ha). Ersetzt das Faktor-Modell überall dort,
   *  wo eine Kultur im Startjahr 0 ha hat: base = 0 ⇒ jeder Faktor bleibt 0 und die Kultur
   *  taucht NIE auf. Genau das passiert im Skalierungspfad (Tomate/Zwiebel/Sellerie/
   *  Süßkartoffel/Knoblauch starten erst 2028) — ohne diese Funktion rechnet das Modell
   *  acht Jahre lang nur Kartoffel. */
  const cropHaOfYear = (cropId: string, y: number): number => {
    const curve = cropAreasMY.areas[cropId];
    if (curve) return curve[Math.min(y, curve.length - 1)] ?? 0;
    return (cropBaseHa.get(cropId) ?? 0) * scale[y];
  };
  // Kulturscharfe Vintage-Treiber: Lager folgt Lager-Tonnage, Maschinen ihren Nutzer-Kulturen.
  const yieldOfCropMY = (cid: string) => { const yk = domain.catalog.find((c) => c.cropId === cid)?.yieldKey; return yk ? resolveScalar(domain, yk, scenarioId) : 0; };
  const storeAktivMY = !domain.assumptions["store.active"] || resolveScalar(domain, "store.active", scenarioId) >= 0.5;
  const shareOfStoreMY = (cid: string) => {
    if (!storeAktivMY) return 0;                 // Master-Schalter aus → keine Lager-Vintages
    const k = `store.share.${cid}`;
    return domain.assumptions[k] ? Math.max(0, Math.min(1, resolveScalar(domain, k, scenarioId))) : 1;
  };
  /** Spitzenbelegung des gemeinsamen Lagers im Jahr y (t) — die zu bauende Kapazität.
   *  Analog zu storePeakConcurrentT, aber auf den Mehrjahres-Flächenkurven. */
  const storeMonthsMY = Math.max(0, Math.min(12, domain.assumptions["store.months"]
    ? Math.round(resolveScalar(domain, "store.months", scenarioId)) : 0));
  const storeTMY = (y: number) => {
    if (storeMonthsMY <= 0) return 0;
    const occ = new Array(12).fill(0);
    for (const cid of STORAGE_CROP_IDS) {
      const tons = (cropAreasMY.areas[cid]?.[y] ?? 0) * yieldOfCropMY(cid) * shareOfStoreMY(cid);
      if (tons <= 0) continue;
      const hs = ((CROP_CAL as Record<string, { harvest: number[] }>)[cid]?.harvest ?? []).filter((h: number) => h >= 0);
      if (!hs.length) continue;
      const per = tons / hs.length;
      for (const h of hs) for (let k = 0; k < storeMonthsMY; k++) occ[(h + k) % 12] += per;
    }
    return occ.reduce((m, v) => Math.max(m, v), 0);
  };
  const storeBaseTMY = storeTMY(0);
  const storeScaleMY = Array.from({ length: years }, (_, y) => storeBaseTMY > 0 ? storeTMY(y) / storeBaseTMY : scale[y]);
  const dStoreScale = storeScaleMY.map((s, y) => s - (y > 0 ? storeScaleMY[y - 1] : 0));
  const adjAsset = scale.map((s, y) => (s > 0 ? machScale[y] / s : 1));
  const dMachOf = (machineId: string): number[] => {
    // LOGISTIK-KLASSEN haben keinen Arbeitsgang und fielen deshalb auf dMachScale zurück —
    //  die GESAMTE Betriebsfläche. Ein Sattelzug wächst aber nicht mit der Fläche, sondern
    //  mit der TONNAGE, die er fährt: Weizen auf 100 ha erzeugt einen Bruchteil der Fuhren
    //  einer Kartoffelfläche gleicher Größe. Über den Horizont (×7,8 Fläche gegen ×5,1
    //  Tonnage der Wertkulturen) lag der Unterschied bei rund einem Drittel des Zugangs.
    // SPRITZEN wachsen NICHT mit der Fläche. Ihr Bedarf kommt aus dem Fenster-Peak über alle
    //  Kulturen — 2 Stück bei 300 ha, 7 bei 2.334 ha, also ×3,5 gegen ×7,8 Fläche. Und der
    //  Mix verschiebt sich: bei kleiner Basis rundet der Selbstfahrer-Anteil auf 1 von 2 auf,
    //  im Endausbau sind es 2 von 7. Über die Flächenkurve gerechnet stünden am Ende rund
    //  16 Spritzen im Hof statt 7. Deshalb ist die Bezugsgröße hier die eigene Bedarfskurve.
    if (machineId === "spray_gz" || machineId === "spray_sf") {
      const teil: "gz" | "sf" = machineId === "spray_gz" ? "gz" : "sf";
      const need = Array.from({ length: years }, (_, y) => deriveSprayFleet(domain, scenarioId, y)[teil]);
      const b0 = need[0];
      if (b0 <= 0) return Array.from({ length: years }, () => 0);
      const kurve = need.map((n, y) => (n / b0) * adjAsset[y]);
      return kurve.map((s, y) => s - (y > 0 ? kurve[y - 1] : 0));
    }
    const tonCrops = LOGISTIK_TONNAGE_TREIBER[machineId];
    const users = tonCrops ?? (Object.keys(ARBEITSGAENGE) as CropId[]).filter((cid) => (ARBEITSGAENGE[cid] ?? []).some((st) => st.m === machineId));
    if (!users.length) return dMachScale; // geteilte/unspezifische Technik → Gesamtfläche (asset-korrigiert)
    const at = tonCrops
      ? (y: number) => tonCrops.reduce((s, cid) => s + (cropAreasMY.areas[cid]?.[y] ?? 0) * yieldOfCropMY(cid), 0)
      : (y: number) => users.reduce((s, cid) => s + (cropAreasMY.areas[cid]?.[y] ?? 0), 0);
    const b = at(0);
    if (b <= 0) return dMachScale;
    const curve = Array.from({ length: years }, (_, y) => (at(y) / b) * adjAsset[y]);
    const d = curve.map((s, y) => s - (y > 0 ? curve[y - 1] : 0));
    // BEDARFSJAHR: vor dem ersten Jahr, in dem die Maschine gebraucht wird (Fläche vorhanden und
    //  nicht fremdvergeben), wird nichts angeschafft. Die Basis ist auf dieses Jahr bemessen
    //  (machineHoursPerYear), also wird die Kurve auch darauf normiert — sonst kauft das Modell
    //  im Bedarfsjahr ein Vielfaches oder ein Bruchteil dessen, was es braucht.
    const yStar = SIZED_TRACTOR_IDS.has(machineId)
      ? (() => {
          const ys = domain.machineCatalog.filter((im) => im.tractorId === machineId && im.cEff)
            .map((im) => bedarfsJahrOf(domain, im.id, years)).filter((v) => v >= 0);
          return ys.length ? Math.min(...ys) : -1;
        })()
      : bedarfsJahrOf(domain, machineId, years);
    if (yStar < 0) return d.map(() => 0);          // nie gebraucht → kein CAPEX
    if (yStar > 0) {
      const bStar = at(yStar);
      if (bStar <= 0) return d.map(() => 0);
      const cStar = Array.from({ length: years }, (_, y) => (at(y) / bStar) * adjAsset[y]);
      const dStar = cStar.map((v, y) => v - (y > 0 ? cStar[y - 1] : 0));
      let acc = 0;
      for (let y = 0; y < yStar && y < years; y++) { acc += dStar[y]; dStar[y] = 0; }
      dStar[yStar] += acc;
      return dStar;
    }
    return d;
  };
  const yearOf = (p: number) => Math.floor(p / 12);
  const nPer = years * 12;

  // Assumption-Overrides ODER Jahres-Kurven je nach Horizont.
  const setScaled = (key: string, baseMonthly: number, factor: (y: number) => number, unit = "money") => {
    const b = domain.assumptions[key];
    if (years <= 1) { overrideConst(key, Math.round(baseMonthly)); return; }
    const values = Array.from({ length: nPer }, (_, p) => Math.round(baseMonthly * factor(yearOf(p))));
    assumptions[key] = { id: b?.id ?? key, key, label: b?.label ?? key, unit: (b?.unit ?? unit) as any,
      scenarioProfiles: { [domain.baseScenarioId]: { kind: "curve", values } }, meta: b?.meta };
  };
  // Overhead-Faktor RELATIV ZUM ZIELZUSTAND (letztes Planjahr), nicht zum Startjahr:
  //  · Corporate-Block (fix): 55 % Sockel + 45 % mit der Fläche — ein 300-ha-Start braucht
  //    Geschäftsführung, Buchhaltung und IT, aber nicht die Struktur des Endausbaus.
  //  · Volumen-Block (Packhaus/Lager/Logistik/Handel): linear mit der Erntemenge des Jahres.
  const ovVolumeMonthly = overheadItems.filter((o) => OVERHEAD_VOLUME_GROUPS.has(o.group))
    .reduce((sum, o) => sum + (o.monthlyCent || 0), 0);
  const ovFixedMonthly = Math.max(0, overheadMonthly - ovVolumeMonthly);
  const tonnesOfYear = (y: number) => Object.entries(cropAreasMY.areas)
    .reduce((sum, [cid, curve]) => sum + (curve[Math.min(y, curve.length - 1)] ?? 0) * yieldOfCropMY(cid), 0);
  const tTarget = tonnesOfYear(years - 1) || 1;
  const aTarget = scale[years - 1] || 1;
  /** Fläche des Jahres relativ zum Zielzustand (letztes Planjahr). */
  const relToTarget = (y: number) => (scale[years - 1] > 0 ? scale[y] / scale[years - 1] : 1);
  /** Gedämpft: 55 % Sockel + 45 % mit der Fläche (Leitung/Werkstatt skalieren unterproportional). */
  const persDamp = (y: number) => 0.55 + 0.45 * relToTarget(y);
  const sgaDamp = (y: number) => {
    if (overheadMonthly <= 0) return 1;
    const fixedY = ovFixedMonthly * (0.55 + 0.45 * (scale[y] / aTarget));
    const volY = ovVolumeMonthly * (tonnesOfYear(y) / tTarget);
    return (fixedY + volY) / overheadMonthly;
  };
  // Phase 8 — Inflationsindizes je Jahr (getrennt Output/Input/Lohn/CAPEX). Jahr 0 = 1,0 (keine Inflation Jahr 1).
  const inflPow = (r: number) => (y: number) => Math.pow(1 + r, y);
  const iOut = inflPow(resolveScalar(domain, "infl.output", scenarioId));
  const iIn = inflPow(resolveScalar(domain, "infl.input", scenarioId));
  const iWage = inflPow(resolveScalar(domain, "infl.wage", scenarioId));
  const iCap = inflPow(resolveScalar(domain, "infl.capex", scenarioId));
  // Erstes Planjahr mit EIGENEM Beregnungs-CAPEX. Davor wird bereits beregnete Fläche gepachtet
  //  (höherer Pachtzins statt Investition). Voll variabel über die Annahme.
  const irrigFromYear = Math.max(0, Math.round(
    domain.assumptions["irrig.capex_from_year"] ? resolveScalar(domain, "irrig.capex_from_year", scenarioId) : 0));
  // Basiswerte (Jahr-1 / scale=1) → Monatswerte:
  const baseFixMonthly = Math.round((annualFixEur * 100) / 12);
  const baseMachMonthly = Math.round(machineServiceAnnualCent(domain, scenarioId) / 12);
  // MASCHINENMIETE (extern). Die Zeile lag auf 0, weil sie ursprünglich die Intercompany-
  //  Miete von Isolde abbildete — die gibt es im Solo-Modell nicht. Gemietet wird jetzt am
  //  Markt: gemietete Klassen zahlen gefahrene Stunden × Mietsatz statt CAPEX und AfA.
  const mietKostenJahrCent = (y: number): number => {
    let c = 0;
    for (const m of domain.machineCatalog) {
      if (!((m.rentedUnits ?? 0) > 0)) continue;
      c += machineOrTractorHoursOfYear(domain, m.id, y) * machineRentPerHourCent(domain, m, scenarioId);
    }
    return c;
  };
  const baseRentMonthly = 0;
  // Intercompany-Miet-ERTRAG entfällt im Solo-Modell: es gibt keine zweite operative
  //  Gesellschaft, die Maschinen verleiht.
  const rentIncomeCent = 0;
  const baseRentIncomeMonthly = Math.round(-rentIncomeCent / 12);
  const baseTransMonthly = Math.round(transportTotalCent / 12);
  const baseSgaMonthly = Math.round(overheadMonthly * scopeFactor);
  // OPEX-Fix KULTURSCHARF: Overhead je Kultur × Politik-Flächenkurve (statt pauschal × Gesamtfläche —
  //  sonst trägt z. B. die fixierte Tomate 680 €/ha Overhead-Wachstum, das nie entsteht).
  const fixFactor = (y: number): number => {
    if (annualFixEur <= 0) return scale[y];
    let eur = 0;
    for (const [cid, curve] of Object.entries(cropAreasMY.areas)) eur += (OVERHEAD_PER_HA[cid as CropId] ?? 0) * (curve[Math.min(y, curve.length - 1)] ?? 0);
    return eur / annualFixEur;
  };
  setScaled("opex.fix", baseFixMonthly, (y) => fixFactor(y) * iIn(y));
  setScaled("opex.machines", baseMachMonthly, (y) => scale[y] * iIn(y));
  if (years <= 1) { overrideConst("opex.machine_rent", Math.round(mietKostenJahrCent(0) / 12)); }
  else {
    const values = Array.from({ length: nPer }, (_, p) => Math.round(mietKostenJahrCent(yearOf(p)) / 12 * iIn(yearOf(p))));
    assumptions["opex.machine_rent"] = { id: "opex.machine_rent", key: "opex.machine_rent",
      label: "Maschinen-Miete (extern) /Monat", unit: "money",
      scenarioProfiles: { [domain.baseScenarioId]: { kind: "curve", values } } };
  }
  setScaled("opex.machine_rent_income", baseRentIncomeMonthly, (y) => scale[y] * iIn(y));
  setScaled("opex.transport", baseTransMonthly, (y) => scale[y] * iIn(y));
  setScaled("opex.sga", baseSgaMonthly, (y) => sgaDamp(y) * iWage(y));
  // Pacht: Dritt-Pacht (bewirtschaftete Fläche − Eigentum, skaliert, input-inflationiert) +
  //  Besitzgesellschaft-Pacht (Eigentum fix, Index-Stufe alle N Jahre). Nicht in opex.fix (kein Doppel).
  {
    const pc = domain.pacht;
    const ownHa = pc?.ownedHa ?? 0, besitzRate = pc?.baseRentPerHaCent ?? 0;
    // Jahres-Pacht (CENT): Dritt-Pacht (skaliert) + Besitz-Pacht (nur wenn NICHT IFRS 16 kapitalisiert).
    //  Satz je Planjahr aus der Pacht-Tabelle. KEINE zusätzliche Input-Inflation mehr: der
    //  Satz IST die Eingabe, eine Steigerung gehört in die Tabelle und nicht in einen
    //  unsichtbaren Faktor — sonst zahlt man 2034 mehr, als in der Zeile steht.
    const rateOf = (y: number) => {          // CENT je ha
      const tbl = pc?.ratePerHaByYear;
      if (!tbl?.length) return PACHT_PER_HA_CENT;
      return tbl[Math.min(y, tbl.length - 1)] ?? PACHT_PER_HA_CENT;
    };
    const pachtAnnual = (y: number) => {
      const areaY = baseArea * scale[y];
      const thirdCent = Math.max(0, areaY - ownHa) * rateOf(y);
      const besitzCent = (pc && !pc.ifrs16) ? ownHa * besitzRate * pachtIndexFactor(pc, y) : 0;
      return thirdCent + besitzCent;
    };
    // Auszahlungstranchen (Monat 1–12 → Anteil); ohne Konfiguration gleichmäßig über 12 Monate.
    const pm = pc?.payMonths && pc.payMonths.length ? pc.payMonths : null;
    const shareOf = (m0: number) => pm ? (pm.find((x) => x.month === m0 + 1)?.share ?? 0) : 1 / 12;
    if (years <= 1) { overrideConst("opex.pacht", Math.round(pachtAnnual(0) / 12)); }
    else {
      const values = Array.from({ length: nPer }, (_, p) => Math.round(pachtAnnual(yearOf(p)) * shareOf(p % 12)));
      assumptions["opex.pacht"] = { id: "opex.pacht", key: "opex.pacht", label: "Pacht (Dritt + Besitzgesellschaft)", unit: "money",
        scenarioProfiles: { [domain.baseScenarioId]: { kind: "curve", values } } };
    }
  }
  // Personal-Kopfzahlen: Basiswert × personnelScale × yearScale (Kurve über die Jahre).
  //  Leitung & Service (Overhead-nah) skalieren GEDÄMPFT wie SG&A (Skaleneffekte: 1+0,55·(scale−1)) —
  //  ein 5×-Betrieb braucht keine 5× Geschäftsführung/Werkstatt. Bewässerung, Lager, Saison, Stamm und
  //  Praktikanten bleiben LINEAR (echte Flächen-/Tonnage-/Maschinen-Treiber).
  // PERSONAL: eine einzige Quelle — personalFteOfYear. Vorher rechnete der Composer mit
  //  Basiswert x Wachstumskurve, die Ansicht zeigte den Basiswert, und ein "Planer" schlug
  //  aus den Zahlen des Startjahres etwas Drittes vor. Drei Zahlen fuer dieselbe Groesse.
  for (const pos of PERSONAL_POSITIONEN) {
    const b = domain.assumptions[pos.key];
    if (years <= 1) {
      assumptions[pos.key] = { id: b?.id ?? pos.key, key: pos.key, label: b?.label ?? pos.key,
        unit: (b?.unit ?? "count") as any,
        scenarioProfiles: { [domain.baseScenarioId]: { kind: "constant", value: personalFteOfYear(domain, pos.key, 0, scenarioId) * personnelScale } },
        meta: b?.meta };
    } else {
      const values = Array.from({ length: nPer }, (_, p) => personalFteOfYear(domain, pos.key, yearOf(p), scenarioId) * personnelScale);
      assumptions[pos.key] = { id: b?.id ?? pos.key, key: pos.key, label: b?.label ?? pos.key,
        unit: (b?.unit ?? "count") as any,
        scenarioProfiles: { [domain.baseScenarioId]: { kind: "curve", values } }, meta: b?.meta };
    }
  }

  // Phase 8 — Preise/Löhne als Inflations-Kurven: Menge×Preis-Assumptions ziehen dann per Periode.
  //  Output-Preise (Erlöse), Input-Preise (Dünger/PSM/Saatgut/Diesel/Wasser), Löhne/Gehälter getrennt.
  //  Hinweis: im Mehrjahres-Horizont wird der Preis auf das Base-Szenario + Inflation gesetzt (Best/Worst
  //  der Einzelpreise entfällt — analog zu den bereits gecurvten opex.*). CAPEX-Inflation s. capexMY.
  const curveInfl = (key: string, fac: (y: number) => number) => {
    const b = domain.assumptions[key]; if (!b) return;
    const base = resolveScalar(domain, key, domain.baseScenarioId);
    const values = Array.from({ length: nPer }, (_, p) => Math.round(base * fac(yearOf(p))));
    assumptions[key] = { id: b.id ?? key, key, label: b.label ?? key, unit: (b.unit ?? "money") as any,
      scenarioProfiles: { [domain.baseScenarioId]: { kind: "curve", values } }, meta: b.meta };
  };
  if (years > 1) {
    for (const cr of CROP_IDS) curveInfl(`price.${cr}`, iOut);
    for (const k of ["price.per_euro", "psm.per_euro", "price.diesel_l", "irrig.eur_mm",
      "fert.n", "fert.p", "fert.k", "fert.s", "fert.n_fert", "fert.p_fert", "fert.k_fert"]) curveInfl(k, iIn);
    for (const cr of CROP_IDS) curveInfl(`seed.${cr}`, iIn);
    for (const k of ["rate.labor_h", "pers.leitung.gross", "pers.stamm.gross", "pers.bewaesserung.gross", "pers.lager.gross", "pers.service.gross", "pers.saison.gross", "pers.prakt.gross"]) curveInfl(k, iWage);
  }

  /* ------------------------------------------------------------------------
   * Phase 8b — RISIKO- & MARKT-OVERLAY (Szenario-Studio).
   *  Läuft bewusst NACH curveInfl: die Faktoren multiplizieren die bereits
   *  inflationierten Kurven, nicht die Nominalwerte des Startjahrs. Alle Treiber
   *  sind neutral vorbelegt — ohne Reglerbewegung ist dieser Block ein No-op.
   *  Weil die Treiber selbst normale Assumptions sind, greift das nicht-destruktive
   *  Perturbations-Muster der Sensitivität (Domain klonen → Profil skalieren) direkt.
   * ---------------------------------------------------------------------- */
  {
    const ov = studioOverlay(domain, scenarioId);
    /** Skaliert ALLE Szenario-Profile eines Keys (Best/Worst-Spreizung bleibt erhalten). */
    const scaleAssum = (key: string, f: number) => {
      if (!isFinite(f) || Math.abs(f - 1) < 1e-12) return;
      const b = assumptions[key] ?? domain.assumptions[key]; if (!b) return;
      const profiles: Assumption["scenarioProfiles"] = {};
      for (const [sid, prof] of Object.entries(b.scenarioProfiles)) {
        profiles[sid] = (prof as any).kind === "curve"
          ? { kind: "curve", values: ((prof as any).values as number[]).map((v) => v * f) }
          : { kind: "constant", value: (prof as any).value * f };
      }
      assumptions[key] = { ...b, scenarioProfiles: profiles };
    };
    /** Additiver Shift (Zinsen — multiplikativ wäre bei Nahe-Null-Zins unbrauchbar). */
    const addAssum = (key: string, d: number) => {
      if (!isFinite(d) || d === 0) return;
      const b = assumptions[key] ?? domain.assumptions[key]; if (!b) return;
      const profiles: Assumption["scenarioProfiles"] = {};
      for (const [sid, prof] of Object.entries(b.scenarioProfiles)) {
        profiles[sid] = (prof as any).kind === "curve"
          ? { kind: "curve", values: ((prof as any).values as number[]).map((v) => v + d) }
          : { kind: "constant", value: (prof as any).value + d };
      }
      assumptions[key] = { ...b, scenarioProfiles: profiles };
    };

    // (1) BEREGNUNGSAUSFALL + (2) MARKT/QUALITÄT — Faktoren kommen aus studioOverlay (SSOT).
    for (const cr of CROP_IDS) {
      scaleAssum(`yield.${cr}`, ov.yieldFactor(cr));
      scaleAssum(`price.${cr}`, ov.priceFactor(cr));
    }
    scaleAssum("yield.soja_zw", ov.yieldFactor("soja_luzerne"));      // Zweitfrucht-Soja (secondCrop)

    // (3) WASSERNORM. Die mm/ha je Kultur sind Stammdaten; kostenseitig ist eine höhere
    //  Norm äquivalent zu einem proportional höheren €/mm·ha-Satz.
    scaleAssum("irrig.eur_mm", ov.irrigNormScale);

    // (4) ZINSSCHOCK — additiv auf den Referenzzins aller Floating-Verträge und des Revolvers.
    addAssum("macro.euribor", ov.rateShock);
  }

  // Subventionen — je Jahr als Pauschale, Anspruchsfläche KULTURSCHARF (Politik-Kurven), Cap absolut.
  //  HINWEIS: Der frühere synthetische "sub-gerste-zw"-Strom ist ENTFERNT — der Doppel-Soja-Erlös
  //  läuft vollständig über secondCrop in der Engine (SSOT, sonst Doppelzählung ~+1,7 M€/a im Endausbau).
  // Ein Regler auf alle Registersaetze (Foerderrisiko-Szenario), Default 1,0.
  const subsidyFactorMY = domain.assumptions["subsidy.factor"] ? resolveScalar(domain, "subsidy.factor", scenarioId) : 1;
  const baseSubs: { s: Subsidy; baseHa: number; perHa: number }[] =
    domain.subsidies.map((s) => ({ s, baseHa: areaFor(s.cropIds), perHa: (s.ratePerHaCent ?? 0) * subsidyFactorMY }));
  // Förderfähige GESAMTfläche je Jahr = beregnet + trocken (Σ aller Kultur-Flächenkurven). Die
  //  flächenpauschalen CAP-Direktzahlungen (BISS/Eco) gelten für die gesamte bewirtschaftete
  //  Ackerfläche — auch die Trockenrotation ist förderfähig (sonst ~1 Mio€/a Unterzählung).
  const fullFarmHaOf = (y: number) =>
    Object.values(cropAreasMY.areas).reduce((sum, curve) => sum + (curve[Math.min(y, years - 1)] ?? 0), 0);
  const subsidies: Subsidy[] = [];
  for (let y = 0; y < years; y++) {
    for (const { s, baseHa, perHa } of baseSubs) {
      if (s.active === false) continue;
      // Kulturgebundene Subventionen (VCP etc.) folgen der Politik-Fläche der Kultur(en);
      //  flächenpauschale (BISS/Öko) der gesamten förderfähigen Fläche (beregnet + trocken).
      let elig = (s.cropIds && s.cropIds.length)
        ? s.cropIds.reduce((sum, cid) => sum + (cropAreasMY.areas[cid]?.[Math.min(y, years - 1)] ?? (cropBaseHa.get(cid) ?? 0) * scale[y]), 0)
        : fullFarmHaOf(y);
      if (s.firstHaCap != null && s.firstHaCap > 0) elig = Math.min(elig, s.firstHaCap);
      let amt = s.basis === "per_ha" ? Math.round(perHa * elig) : (s.lumpSumCent ?? 0);
      // GAP-PERIODENBRUCH 2028. Die laufende Förderperiode endet 2027; das Modell rechnet bis
      //  2034 und schrieb die Sätze bisher stillschweigend acht Jahre unverändert fort. Der
      //  Kommissionsvorschlag für den MFR 2028–2034 sieht eine vereinfachte Flächenprämie mit
      //  verpflichtender Degressivität und einer KAPPUNG je Betrieb vor. Das Modell rechnete
      //  für 2032 allein an Flächenprämien rd. 400 T€ — das Vierfache der vorgeschlagenen
      //  Obergrenze. Der Cap gilt für die FLÄCHENPAUSCHALEN (Säule 1, ohne VCP), betriebsweit.
      //  Über cap.per_farm_from_2028 abschaltbar (0 = keine Kappung).
      amt = Math.max(0, amt);
      const prof = (s.payout && s.payout.length ? s.payout : s.receiptPeriods.map((pp) => ({ period: pp, share: 1 / Math.max(1, s.receiptPeriods.length) })));
      if (amt === 0) continue;
      subsidies.push({
        id: `${s.id}-y${y}`, name: s.name, basis: "lump_sum", lumpSumCent: amt,
        receiptPeriods: s.receiptPeriods.map((pp) => pp + y * 12),
        payout: prof.map((x) => ({ period: x.period + y * 12, share: x.share })),
        pillar: s.pillar, category: s.category, active: true,
      });
    }
  }
  // KAPPUNG der Flächenpauschalen ab 2028 (Säule 1 ohne VCP), betriebsweit je Jahr.
  {
    // ACHTUNG EINHEIT: "money"-Assumptions liefern CENT, nicht Euro.
    const capCent = domain.assumptions["cap.per_farm_from_2028"]
      ? resolveScalar(domain, "cap.per_farm_from_2028", scenarioId) : 0;
    if (capCent > 0) {
      for (let y = 1; y < years; y++) {                       // greift ab dem 2. Planjahr (2028)
        const flaeche = subsidies.filter((x) => x.id.endsWith(`-y${y}`) && x.category !== "vcp");
        const summe = flaeche.reduce((a, x) => a + (x.lumpSumCent ?? 0), 0);
        if (summe > capCent && summe > 0) {
          const f = capCent / summe;                          // anteilig kürzen
          for (const x of flaeche) x.lumpSumCent = Math.round((x.lumpSumCent ?? 0) * f);
        }
      }
    }
  }

  // Wachstum — Deckungsbeitrag der UNBEREGNETEN Fläche (Break-Crop-Rotation, Rain-fed).
  //  Analog zur Gerste-Zweitfrucht als eigener Ertragsstrom modelliert (DB je ha ist bereits
  //  netto der variablen Kosten). Fließt in Bruttoergebnis + Cash; finanziert den Landzukauf-
  //  Kapitaldienst. Ernte der Break Crops ~Juli. Output-Inflation je Jahr.
  /* ENTFERNT 31.07.2026: Deckungsbeitrags-Pauschale der unberegneten Trockenrotation.
     Sie war der Fallback für Stände ohne native Dryland-Kulturen; im Solo-Modell gibt es
     weder Trockenrotation noch unberegnete Restfläche (totalByYear === areaByYear). */
  // CropPlans über die Jahre replizieren (Fläche × scale, Perioden + y·12).
  // Kultur-Skalierungspolitik: je Kultur eigener Flächenpfad (cropFactor, oben abgeleitet).
  const cropPlansMY: CropPlan[] = years <= 1 ? cropPlans : cropPlans.flatMap((cp) =>
    Array.from({ length: years }, (_, y) => ({
      // Absolute Jahresfläche, anteilig auf die Anbauplan-Zeilen derselben Kultur verteilt.
      ...cp, id: `${cp.id}-y${y}`,
      areaHa: cropHaOfYear(cp.cropId, y) * ((cropBaseHa.get(cp.cropId) ?? 0) > 0 ? cp.areaHa / (cropBaseHa.get(cp.cropId) as number) : 1 / Math.max(1, cropPlans.filter((x) => x.cropId === cp.cropId).length)),
      plantingPeriod: cp.plantingPeriod + y * 12,
      harvestPeriods: cp.harvestPeriods.map((h) => h + y * 12),
      secondCrop: cp.secondCrop ? { ...cp.secondCrop, harvestPeriod: cp.secondCrop.harvestPeriod + y * 12 } : undefined,
      // Maschinen-Betriebskosten und Lohnarbeit hängen am Planjahr (Lohnarbeit kann befristet
      //  sein; fällt ein Gang weg, entfallen Versicherung/Reparatur/Schmierstoff der Maschine).
      //  Beide werden deshalb je Jahrgang NEU bewertet statt nur kopiert.
      operations: (cp.operations ?? []).map((op) => {
        const isMasch = op.id.endsWith("-OP-MASCH"), isLohn = op.id.endsWith("-OP-LOHN");
        const perHaEur = isMasch ? machineOpCostPerHaCent(domain, cp.cropId, scenarioId, y) / 100
          : isLohn ? lohnarbeitPerHaCent(domain, cp.cropId, scenarioId, y) / 100 : null;
        return {
          ...op, id: `${op.id}-y${y}`, costPeriods: op.costPeriods.map((c) => c + y * 12),
          lines: op.lines.map((ln) => ({
            ...ln, id: `${ln.id}-y${y}`,
            ...(perHaEur != null ? { quantityPerHa: perHaEur } : {}),
          })),
        };
      }),
    })),
  );

  // Finanzierungs-Jahrgänge: VERTRAGSSCHARF — Vintage-Prinzipal folgt den tatsächlichen Objekt-
  //  Zugängen des Jahres (Lager → dStoreScale, Maschinen → dMachOf, Beregnung → 0, denn der Ausbau
  //  hat seinen eigenen Beregnungs-Investitionskredit). Sonst entsteht Phantom-Fremdkapital
  //  (Kredit-Ziehungen ohne zugehörige Assets — vorher ~30 M€ Doppel-Finanzierung Beregnung).
  // Die Verträge werden auf dem CAPEX bemessen, der TATSÄCHLICH IM PLAN STEHT — nicht auf den
  //  Rohbeträgen aus deriveCapex. Beregnung ist der Fall, an dem der Unterschied auffiel: der
  //  Investitionskredit „Bewässerung & Lager" zog 900 T€ im ersten Jahr, obwohl der Plan seit
  //  der Pachtentscheidung (Pivots im Pachtzins) keinen Beregnungs-CAPEX mehr enthält —
  //  Fremdkapital ohne Gegenstand.
  const capexBaseAmt = new Map(capex.map((ci) =>
    [ci.id, ci.assetClass === "irrigation" && irrigFromYear > 0 ? 0 : ci.amount] as [string, number]));
  const contractDVec = (t: DebtTranche): number[] => {
    const f = financing.find((x) => x.tranche.id === t.id);
    if (!f) return dScale; // manuelle Tranchen (domain.debt): bisheriges Verhalten
    const objs = f.objects.map((o) => o.id);
    const baseSum = objs.reduce((s, id) => s + (capexBaseAmt.get(`cx-${id}`) ?? 0), 0);
    // Vertrag ohne planwirksamen Gegenstand → keine Ziehung. Vorher fiel er auf die
    //  Flächen-Skalierung zurück und zog den vollen Nominalbetrag.
    if (baseSum <= 0) return Array.from({ length: years }, () => 0);
    const addAt = (y: number): number => {
      if (y === 0) return baseSum;
      let s = 0;
      for (const id of objs) {
        const base = capexBaseAmt.get(`cx-${id}`) ?? 0;
        if (base <= 0) continue;
        s += base * ((id === "store" || id === "store_tech") ? dStoreScale[y] : dMachOf(id)[y]);
      }
      return s;
    };
    // Bezugsgröße ist der VERTRAGSWERT (Σ Objektwerte laut deriveCapex), nicht der planwirksame
    //  Anteil. Nur so schrumpft die Ziehung mit, wenn ein Objekt des Vertrags gar nicht gekauft
    //  wird: dVec[0] = planwirksam / vertraglich ≤ 1 statt konstant 1.
    const ref = f.entryValueCent > 0 ? f.entryValueCent : baseSum;
    return Array.from({ length: years }, (_, y) => addAt(y) / ref);
  };
  const debtMY: DebtTranche[] = years <= 1 ? debtBase : debtBase.flatMap((t) => {
    const dVec = contractDVec(t);
    return dVec.map((d, y) => ({ d, y })).filter((v) => v.d > 1e-9).map((v) => ({
      ...t, id: `${t.id}-y${v.y}`, principal: Math.round(t.principal * v.d), drawPeriod: v.y * 12,
    }));
  });

  // CAPEX-Jahrgänge + revolvierende Ersatzinvestition mit Ausmusterung.
  //  · Maschinen: als Kohorten (1/Zyklus je Jahr) mit AfA über afa_years und Ausmusterung am
  //    Zyklusende (Verkauf zu Restwert, Buchgewinn/-verlust). Flotte bleibt bis zum Zyklus intakt,
  //    danach revolvierend 1/Zyklus je Jahr — kein Komplett-Tausch in einem Jahr.
  //  · Nicht-Maschinen (Beregnung/Lager/Nebenkosten): einfache Vintages ohne Tausch.
  const capexMY: CapexItem[] = [];
  if (years <= 1) {
    capexMY.push(...capex);
  } else {
    const repl = deriveReplacementCapex(domain, scenarioId);
    const cfgById = new Map(repl.machines.map((r) => [`cx-${r.id}`, r]));
    // Kulturscharfe Vintage-Treiber (dStoreScale/dMachOf) sind oben zentral abgeleitet.
    for (const ci of capex) {
      const r = cfgById.get(ci.id);
      const isMachine = ci.assetClass === "machinery" && r && r.enabled;
      if (!isMachine) {
        // BESTAND vs. INVESTITION: Beregnung (assetClass 'irrigation') wird NICHT über die
        //  Flächen-Ramp skaliert — die Erweiterung besitzt ausschließlich der explizite
        //  „Beregnungsausbau"-Block unten (eigene Neu-Beregnung, ohne übernommene Pivots).
        //  Hier nur die t0-Basis (Bestand der heute beregneten Fläche), keine Zukauf-Vintages.
        const isIrrig = ci.assetClass === "irrigation";
        // Lager folgt der Lager-Tonnage (kulturscharf), übrige Nicht-Maschinen der Gesamtfläche.
        const dVec = ci.id === "cx-store" ? dStoreScale : dScale;
        for (let y = 0; y < years; y++) {
          if (dVec[y] <= 1e-9) continue;
          if (isIrrig && y > 0) continue; // Beregnungs-Ausbau ausschließlich über expliziten Block
          // Gepachtete Flächen sind bereits beregnet: vor irrig.capex_from_year kein eigenes
          //  Beregnungs-CAPEX — auch nicht für den Bestand (die Pivots gehören dem Verpächter).
          if (isIrrig && y < irrigFromYear) continue;
          capexMY.push({ ...ci, id: `${ci.id}-y${y}`, amount: Math.round(ci.amount * dVec[y] * iCap(y)),
            salvageValue: ci.salvageValue != null ? Math.round(ci.salvageValue * dVec[y] * iCap(y)) : undefined,
            purchasePeriod: y * 12 });
        }
        continue;
      }
      // Maschine: Kohorten mit Ausmusterung. Zyklus C, AfA-Dauer L (Monate).
      const C = r.cycleYears, L = r.afaYears * 12;
      // ANSCHAFFUNGSMONAT. Bisher fiel der gesamte Jahres-CAPEX im JANUAR an — ein Betrieb
      //  kauft die Maschinen eines Jahres aber nicht am 1. Januar. Realistisch ist die
      //  Lieferung kurz VOR dem ersten Einsatz: die Pflanzmaschine im März, der Roder im
      //  August, die Bodenbearbeitung im Februar. Das verschiebt Kapitalbindung, Revolver-
      //  Spitze und Zinslast spürbar — und zwar in die richtige Richtung, weil das Geld
      //  später abfließt.
      //  Regel (Entscheidung 31.07.2026): Bedarfsmonat minus 1. Der Bedarfsmonat kommt aus
      //  der Arbeitsgang-Phase der Maschine über den Kulturkalender; ist keiner hinterlegt
      //  (Zugmaschinen, Logistik), bleibt es beim Januar, weil sie ganzjährig laufen.
      const midK = ci.id.startsWith("cx-") ? ci.id.slice(3) : ci.id;
      const kaufMonat = (() => {
        const ph = MACHINE_PHASE[midK];
        if (!ph) return 0;
        let frueh = 13;
        for (const a of domain.anbauplan) {
          if (!(domain.arbeitsgaenge[a.cropId] ?? []).some((g) => g.m === midK)) continue;
          const cat = domain.catalog.find((c) => c.cropId === a.cropId);
          const sow = cat?.sowMonth ?? SOW_MONTH[a.cropId as CropId] ?? 0;
          const hRaw = cat?.harvestPeriods?.[0] ?? sow + 4;
          const harv = hRaw < sow ? hRaw + 12 : hRaw;
          const m = ph.when(sow, harv);
          if (isFinite(m)) frueh = Math.min(frueh, m);
        }
        if (frueh > 12) return 0;
        return Math.max(0, Math.min(11, Math.round(frueh) - 2));   // Bedarfsmonat − 1, 0-basiert
      })();
      const mkChain = (startY: number, netCent: number, resCent: number, firstDispAge: number) => {
        let py = startY, age = firstDispAge, guard = 0;
        while (py < years && guard++ < 40) {
          const dispY = py + age;
          const disposed = dispY < years;
          const inf = iCap(py); // CAPEX-Inflation je Anschaffungsjahr (auch revolvierende Ersatzkäufe)
          capexMY.push({
            ...ci, id: `${ci.id}-c${py}-${age}-${capexMY.length}`, amount: Math.round(netCent * inf), salvageValue: 0,
            usefulLifeMonths: L, usefulLifeFiscalMonths: L, purchasePeriod: py * 12 + kaufMonat,
            disposalPeriod: disposed ? dispY * 12 : undefined,
            disposalProceedsCent: disposed ? Math.round(resCent * inf) : undefined,
            financingMode: py === startY ? ci.financingMode : "cash",   // Erstanschaffung finanziert, Ersatz aus Cash
          });
          if (!disposed) break;
          py = dispY; age = C; // Folgetausche im Zyklus
        }
      };
      // BASISFLOTTE im BEDARFSJAHR, nicht pauschal im Startjahr.
      //  Vorher stand hier mkChain(0, …): jede Maschine des Katalogs wurde im Jahr 0 angeschafft,
      //  auch wenn die Kultur, die sie braucht, erst Jahre später anläuft. Im Skalierungspfad
      //  kaufte das Modell damit 2027 auf 300 ha Kartoffel bereits den Tomaten-Vollernter, die
      //  Zwiebel-Erntekette und den Möhrenroder — Technik für Kulturen mit 0 ha. Das war der
      //  Hauptteil der überhöhten Anlaufinvestition.
      //  bedarfsJahrOf liefert das erste Jahr, in dem die Maschine wirklich gebraucht wird
      //  (Nutzer-Kultur hat Fläche und der Gang ist nicht fremdvergeben); ci.amount ist auf genau
      //  dieses Jahr bemessen (machineHoursPerYear). -1 = wird nie gebraucht ⇒ gar kein CAPEX.
      const mid = ci.id.startsWith("cx-") ? ci.id.slice(3) : ci.id;
      const yStart = bedarfsJahrOf(domain, mid, years);
      if (yStart < 0) continue;
      for (let k = 0; k < C; k++) mkChain(yStart, Math.round(ci.amount / C), Math.round((ci.salvageValue ?? 0) / C), C + k);
      // Ausbau-Zugänge NACH dem Bedarfsjahr. dMachOf ist auf dasselbe Jahr normiert und hat die
      //  davor aufgelaufenen Zugänge dort gebündelt — dieser Jahrgang steckt bereits in der
      //  Basisflotte oben und darf hier nicht noch einmal kommen (sonst doppelte Anschaffung).
      const dM = dMachOf(mid);
      for (let v = yStart + 1; v < years; v++) {
        if (dM[v] <= 1e-9) continue;
        const addNet = ci.amount * dM[v], addRes = (ci.salvageValue ?? 0) * dM[v];
        for (let k = 0; k < C; k++) mkChain(v, Math.round(addNet / C), Math.round(addRes / C), C + k);
      }
    }
  }

  /* ENTFERNT 31.07.2026: Land-/Betriebszukauf und das Stufe-3b-Akquiseprofil (Land-CAPEX,
     Übernahme-/Bodenkredit, Betriebskauf mit Maschinenbestand, Pacht-Ablöse). NEOTERRA wächst
     über zusätzliche PACHTFLÄCHE — Landerwerb ist nicht Teil des Plans. */
  const gp = gEff;

  // Wachstum — Beregnungsausbau (Pivot/Verrohrung/Pumpe): Δ eigene beregnete ha × €/ha als
  //  Irrigation-CAPEX (assetClass 'irrigation', AfA). Greift erst ab irrig.capex_from_year —
  //  davor wird bereits beregnete Fläche gepachtet. Finanzierung: 50 % Investitionskredit.
  if (years > 1 && gp?.areaByYear && (gp.irrigEurPerHaCent ?? 0) > 0 && !(domain.capexPlanActive?.bewaesserung)) {
    const perHa = gp.irrigEurPerHaCent ?? 0;
    // Beregnungs-Investitionskredit: 40 % FK, Rest Eigenmittel. Der Wert kam bisher aus
    //  growth.acqDebtShare (0,4) — der Parameter gehörte zum entfernten Flächenzukauf und
    //  steht hier jetzt als eigener Wert, damit sich die Finanzierung nicht still verschiebt.
    const ltv = 0.4;
    let prevIrr = gp.startIrrigatedHa ?? gp.areaByYear[0] ?? 0;
    for (let y = 0; y < years; y++) {
      const irrY = gp.areaByYear[y] ?? prevIrr;
      const dOwn = Math.max(0, irrY - prevIrr);   // neu zu beregnende Fläche des Jahres
      prevIrr = irrY;
      if (dOwn <= 0) continue;
      if (y < irrigFromYear) continue;   // bis dahin wird beregnete Fläche gepachtet, nicht gebaut
      const amt = Math.round(dOwn * perHa * iCap(y));
      capexMY.push({
        id: `cx-irrig-y${y}`, name: `Beregnungsausbau (${Math.round(dOwn)} ha Pivot)`,
        assetClass: "irrigation", amount: amt, purchasePeriod: y * 12,
        usefulLifeMonths: 180, usefulLifeFiscalMonths: 180,
        financingMode: ltv > 0 ? "loan" : "cash",
      });
      if (ltv > 0) {
        debtMY.push({
          id: `debt-irrig-y${y}`, name: `Beregnungs-Investitionskredit ${START_YEAR + y}`,
          principal: Math.round(amt * ltv), drawPeriod: y * 12, termMonths: 180,
          rateBasis: "fixed", fixedRate: 0.05, repayment: "annuity",
        });
      }
    }
  }

  // Detail-CAPEX-Planung (Infrastruktur) — aktive Blöcke zählen: je Position Netto-CAPEX
  //  (Menge × €/Einheit × (1−Subvention); Bestand → 0), assetClass nach Block, AfA nach Nutzungsdauer,
  //  Finanzierung FK (Investitionskredit, Annuität) / Rest bar, Phasing über das Anschaffungsjahr,
  //  Restwert bilanziell. Inflationsindex iCap je Anschaffungsjahr. Kein Doppelzählen: der jeweilige
  //  Auto-Block (Beregnung/Lager) ist bei aktivem Detailblock oben bereits unterdrückt.
  {
    const active = domain.capexPlanActive ?? {};
    const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
    for (const it of (domain.capexPlan ?? [])) {
      if (!active[it.block]) continue;         // nur aktive Blöcke fließen ins Modell
      if (it.bestand) continue;                // bereits vorhanden → kein Neu-CAPEX
      const gross = Math.round((it.menge || 0) * (it.eurProEinheitCent || 0));
      const net = Math.round(gross * (1 - clamp01(it.subventionPct || 0)));
      if (net <= 0) continue;
      const y = Math.max(0, Math.min(years - 1, Math.round(it.jahr || 0)));
      const inf = iCap(y);
      // Kategorie (explizit) schlägt Block-Ableitung: maschinen→machinery, iot→other, bewässerung→irrigation.
      // Anlagenklasse: explizite Kategorie schlägt alles. Sonst Block-Ableitung — ABER innerhalb
      //  der Bau-Blöcke (lager/packhaus/gebaeude) entscheidet die `anlagenklasse`: Technik und
      //  Elektronik sind `echipamente tehnologice` (machinery) und qualifizieren für die
      //  RO-Reinvestitionsbefreiung, Bau und Infrastruktur nicht. Vorher wurde alles in diesen
      //  Blöcken pauschal zu 'buildings' — die Kühl-/CA-Anlage und die Packlinien verloren
      //  dadurch die Steuerbefreiung.
      const kat = it.kategorie ?? (it.block === "bewaesserung" ? "bewaesserung" : it.block === "maschinen" ? "maschinen" : "gebaeude");
      const techLike = it.anlagenklasse === "technik" || it.anlagenklasse === "elektronik";
      const ac: AssetClass = kat === "bewaesserung" ? "irrigation"
        : kat === "maschinen" ? "machinery"
        : kat === "iot" ? "other"
        : techLike ? "machinery" : "buildings";
      const life = Math.max(1, Math.round(it.afaYears || 15)) * 12;
      const amt = Math.round(net * inf);
      const salv = Math.round(net * clamp01(it.restwertPct || 0) * inf);
      const fk = clamp01(it.fkQuote || 0);
      capexMY.push({
        id: `cx-plan-${it.id}`, name: it.bezeichnung || "CAPEX-Position", assetClass: ac,
        amount: amt, purchasePeriod: y * 12, usefulLifeMonths: life, usefulLifeFiscalMonths: life,
        salvageValue: salv, financingMode: fk > 0 ? "loan" : "cash",
      });
      if (fk > 0) {
        debtMY.push({
          id: `debt-plan-${it.id}`, name: `Investitionskredit · ${it.bezeichnung || "CAPEX"}`,
          principal: Math.round(amt * fk), drawPeriod: y * 12,
          termMonths: Math.max(12, Math.round(it.laufzeitJahre || 12) * 12),
          rateBasis: "fixed", fixedRate: it.zins ?? 0.05, repayment: "annuity",
        });
      }
    }
  }

  // Bodenprobenahme (Make-or-Buy) — in die 3 Statements verdrahtet. Skaliert mit der GESAMTfläche
  //  (Trockenrotation + beregnet), nicht mit der beregneten `scale`. Eigen: CAPEX (Rigs → AfA/Bilanz/
  //  Cashflow) + zahlungswirksame OPEX (Fix+Var, OHNE kalk. Zins/AfA → kein Doppelzählen). DL: nur OPEX
  //  (soilN × €/Probe). Additiv (nicht in machHa). Flotte je Jahr aus der skalierten Fläche abgeleitet.
  if (domain.soilSampling?.active) {
    const ss = domain.soilSampling;
    const baseTot = gEff?.totalByYear?.[0] ?? gEff?.startTotalHa ?? (ss.flaecheHa || 1);
    const soilRatio = (y: number) => baseTot > 0 ? (gEff?.totalByYear?.[y] ?? baseTot) / baseTot : 1;
    const resY = (y: number) => computeSoilSampling({ ...ss, flaecheHa: ss.flaecheHa * soilRatio(y) });
    // OPEX-Kurve (zahlungswirksam): Eigen = Fix+Var, DL = Dienstleister. Input-inflationiert.
    {
      const values = Array.from({ length: nPer }, (_, p) => {
        const y = yearOf(p); const rr = resY(y);
        const annual = ss.mode === "eigen" ? rr.eigenOpexCashCent : rr.dlJahrCent;
        return Math.round(annual / 12 * iIn(y));
      });
      assumptions["opex.soil"] = { id: "opex.soil", key: "opex.soil", label: "Bodenprobenahme (Betrieb)", unit: "money",
        scenarioProfiles: { [domain.baseScenarioId]: { kind: "curve", values } } };
    }
    // CAPEX (nur Eigen): Basis-Rigs t0 + Zuwachs-Rigs je Wachstumsjahr; AfA über Nutzungsdauer; Ersatz revolvierend.
    if (ss.mode === "eigen") {
      const price = resY(0).pSoilRigCent;
      const L = Math.max(1, ss.holdYears) * 12;
      const salv = Math.round(price * ss.residPct);
      const mkSoil = (startY: number, rigs: number) => {
        let py = startY, guard = 0;
        while (py < years && guard++ < 40) {
          const disposed = py + ss.holdYears < years;
          const inf = iCap(py);
          capexMY.push({ id: `cx-soil-c${py}-${capexMY.length}`, name: `Bodenprobenahme ${rigs} Rig(s)`, assetClass: "machinery",
            amount: Math.round(rigs * price * inf), purchasePeriod: py * 12, usefulLifeMonths: L, usefulLifeFiscalMonths: L,
            salvageValue: 0, financingMode: "cash",
            disposalPeriod: disposed ? (py + ss.holdYears) * 12 : undefined,
            disposalProceedsCent: disposed ? Math.round(rigs * salv * inf) : undefined });
          if (!disposed) break;
          py = py + ss.holdYears;
        }
      };
      let prevRigs = 0;
      for (let y = 0; y < years; y++) {
        const rigs = resY(y).nRigs;
        const add = Math.max(0, rigs - prevRigs); prevRigs = rigs;
        if (add > 0) mkSoil(y, add);
      }
    }
  }

  // IFRS 16 — Besitzgesellschaft-Pacht als Leasing: Right-of-Use-Asset (AfA über Laufzeit) +
  //  Leasingverbindlichkeit (Zins, Annuität). Ersterfassung zum Index bei Vertragsbeginn;
  //  Neubewertung als Increment-Vintage an jeder Index-Stufe. ROU-Kauf ist bar-neutral
  //  (Capex-Auszahlung = Darlehensziehung), also echter Non-Cash-Zugang wie IFRS 16.
  const pc16 = domain.pacht;
  if (years > 1 && pc16?.ifrs16 && pc16.ownedHa > 0) {
    const T = Math.max(1, pc16.leaseTermYears ?? 15), r = pc16.discountRate ?? 0.05;
    const own = pc16.ownedHa, baseRate = pc16.baseRentPerHaCent;
    const addLease = (startY: number, annualPaymentCent: number, remTerm: number) => {
      if (annualPaymentCent <= 0 || remTerm <= 0) return;
      const pv = Math.round(annuityPV(annualPaymentCent, remTerm, r));
      capexMY.push({ id: `cx-rou-pacht-y${startY}`, name: `ROU Pacht (${START_YEAR + startY})`, assetClass: "other",
        amount: pv, purchasePeriod: startY * 12, usefulLifeMonths: remTerm * 12, usefulLifeFiscalMonths: remTerm * 12, financingMode: "cash" });
      const payM = (pc16.payMonths && pc16.payMonths.length) ? pc16.payMonths.map((x) => x.month) : undefined;
      debtMY.push({ id: `debt-rou-pacht-y${startY}`, name: `Leasingverbindlichkeit Pacht ${START_YEAR + startY}`,
        principal: pv, drawPeriod: startY * 12, termMonths: remTerm * 12, rateBasis: "fixed", fixedRate: r, repayment: "annuity",
        frequency: payM ? "seasonal" : undefined, seasonMonths: payM });
    };
    addLease(0, own * baseRate * pachtIndexFactor(pc16, 0), T);
    for (const s of (pc16.indexSteps ?? [])) {
      if (s.atYear <= 0 || s.atYear >= T || s.atYear >= years) continue;
      const incr = own * baseRate * (pachtIndexFactor(pc16, s.atYear) - pachtIndexFactor(pc16, s.atYear - 1));
      addLease(s.atYear, incr, T - s.atYear);
    }
  }

  return {
    id: domain.meta.id,
    name: domain.meta.name,
    reportingCurrency: domain.meta.reportingCurrency,
    timeline: domain.timeline,
    scenarios: domain.scenarios,
    baseScenarioId: domain.baseScenarioId,
    assumptions,
    farms,
    parcels,
    crops,
    cropPlans: cropPlansMY,
    capex: capexMY,
    debt: debtMY,
    revolver: domain.revolver,
    workingCapital: domain.workingCapital,
    tax: domain.tax,
    vat: domain.vat,
    subsidies,
    // Abnahmeverträge: nur aktive, und nur solche mit einer Kultur im Katalog.
    offtake: (domain.offtake ?? []).filter((c) => c.active !== false && domain.catalog.some((k) => k.cropId === c.cropId)),
    harvestAdvance: domain.harvestAdvance,
    biologicalAssets: domain.biologicalAssets,
    personnel: domain.personnel,
    holding: domain.holding,
    openingBalance: domain.openingBalance,
    /** FRUCHTFOLGE — die gemeinsame Stelle, an der Anbaupausen durchgesetzt werden.
     *  Konvention: `pauseYears` ist die Laenge der Rotation, der Hoechstanteil also
     *  1/pauseYears. Vier Jahre Kartoffelpause heissen: Kartoffel auf jedem Schlag
     *  jedes vierte Jahr, also hoechstens ein Viertel der Flaeche.
     *
     *  Bei den Alliaceen und Apiaceen steht ein strengerer Anteil, weil die
     *  Dauerstadien laenger leben als die Rotation: Sclerotium cepivorum bleibt
     *  ueber 15 Jahre keimfaehig, Sclerotinia-Sklerotien jahrelang. Fuenf Jahre
     *  Pause heissen dort: Rueckkehr im sechsten Jahr, also ein Sechstel.
     *  Beide Gruppen teilen sich die Pause ueber zwei Kulturen hinweg —
     *  Knoblauch und Zwiebel sind beide Alliaceen, Sellerie und Moehre beide
     *  Apiaceen (NEOS Crops, Entscheidung 2026-08-03). */
    // Bezugsflaeche: die ROTATIONSflaeche ueber alle Planjahre, nicht die Summe der
    //  Wertkulturen. Die Bruchkulturen gehoeren zur Rotation, auch wenn sie im
    //  Anbauplan fehlen — sonst misst die Regel gegen eine zu kleine Flaeche und
    //  meldet einen Verstoss, den es nicht gibt.
    rotationAreaHa: ROTATION_TOTAL_HA.reduce((a, b) => a + b, 0),
    rotationRules: [
      {
        id: "kartoffel",
        label: "Kartoffel",
        cropWeights: { kartoffel_pommes: 1, kartoffel_chips: 1 },
        pauseYears: KARTOFFEL_PAUSE_JAHRE,
      },
      {
        id: "alliaceen",
        label: "Alliaceen (Zwiebel + Knoblauch)",
        // zwiebel_moehre ist eine Mischposition; nur der Zwiebelanteil zaehlt.
        cropWeights: { zwiebel_moehre: 0.5, knoblauch: 1 },
        pauseYears: 5,
        maxShare: 1 / 6,
      },
      {
        id: "apiaceen",
        label: "Apiaceen (Möhre + Knollensellerie)",
        cropWeights: { zwiebel_moehre: 0.5, knollensellerie: 1 },
        pauseYears: 5,
        maxShare: 1 / 6,
      },
    ],
  };
}

/* --------------------------------------------------------------------------
 * PRICE_GROUPS — für den Preise/Treiber-Screen.
 * ------------------------------------------------------------------------ */
export const PRICE_GROUPS: { group: string; keys: string[] }[] = [
  { group: "Makro & Steuer", keys: ["macro.euribor", "macro.rate_shock", "tax.rate", "opex.admin"] },
  { group: "Steuer-Optimierung & Finanzierung", keys: ["tax.reinvest_on", "tax.reinvest_share", "finance.capex_selffund"] },
  { group: "Inflation (real ↔ nominal)", keys: ["infl.output", "infl.input", "infl.wage", "infl.capex"] },
  { group: "Stücksätze (Inputs)", keys: ["price.per_euro", "psm.per_euro", "price.diesel_l", "rate.labor_h"] },
  // Ertrag, Preis/Verlust und Kontrakt-Qualität führen NUR die Wertkulturen. Die Annahmen der
  //  übrigen Kulturen bleiben im Modell hinterlegt (yield./price./loss./qual.<id> existieren
  //  unverändert) — sie stehen nur nicht mehr im Treiber-Screen, weil der Betrieb sie nicht anbaut.
  { group: "Ertrag (t/ha)", keys: [
    "yield.tomate", "yield.kartoffel_pommes", "yield.kartoffel_chips", "yield.zwiebel_moehre",
    "yield.suesskartoffel", "yield.knollensellerie", "yield.knoblauch",
  ]},
  { group: "Preis & Verlust (€/t · %)", keys: [
    "price.tomate", "loss.tomate",
    "price.kartoffel_pommes", "loss.kartoffel_pommes",
    "price.kartoffel_chips", "loss.kartoffel_chips",
    "price.zwiebel_moehre", "loss.zwiebel_moehre",
    "price.suesskartoffel", "loss.suesskartoffel",
    "price.knollensellerie", "loss.knollensellerie",
    "price.knoblauch", "loss.knoblauch",
  ]},
  { group: "Kontrakt-Qualität (Erfüllung 0..1)", keys: [
    "qual.tomate", "qual.kartoffel_pommes", "qual.kartoffel_chips", "qual.zwiebel_moehre",
    "qual.suesskartoffel", "qual.knollensellerie", "qual.knoblauch",
  ]},
  { group: "Maschinen-Neupreise (CENT)", keys: [
    "mprice.pflug", "mprice.saatbett", "mprice.drille", "mprice.einzelkorn", "mprice.streuer",
    "mprice.spritze14", "mprice.krautschl", "mprice.onepass", "mprice.sc360", "mprice.roder_ropa",
    "mprice.zug_8rx", "mprice.ops_6r", "mprice.radlader", "mprice.shuttle", "mprice.fieldloader",
    "mprice.tompflanz", "mprice.tomernte", "mprice.gem_schwad", "mprice.gem_lader", "mprice.gem_moehre",
    "mprice.gem_saat", "mprice.knobl_lege", "mprice.maehdr", "mprice.transport",
    "mprice.spray_gz", "mprice.spray_sf",
    "mprice.irrig_perha", "irrig.capex_from_year", "mprice.store_pert", "mprice.store_tech_pert",
  ]},
  { group: "Spritzstrategie (fenstergetrieben)", keys: [
    "spray.appl_lha", "spray.window_days", "spray.boom_m", "spray.speed_kmh", "spray.refill_min",
    "spray.field_eff", "spray.hours_day", "spray.sf_share", "spray.tank_gz_l",
    "spray.pivot_ha", "spray.boom48_prem", "spray.res48_hair",
  ]},
  { group: "Einsatzplanung & Wertkultur-Bottom-up", keys: [
    "en.shifts", "en.shift_eff", "en.hours_day", "en.harvest_staffel", "en.saat_staffel", "en.avail_h_year",
    "en.gross_extra",
    "val.trans_rate", "val.trans_win", "val.tomh_rate", "val.tomh_win",
  ]},
  { group: "TCO Maschinenkosten", keys: ["tco.discount", "tco.res_trail", "tco.res_self", "tco.hold_years", "tco.zug_8rx.service_h", "tco.ops_6r.service_h", "tco.maehdr.service_h"] },
  { group: "Personal (Kopfzahl & Brutto/Monat)", keys: [
    "pers.leitung.n", "pers.leitung.gross", "pers.stamm.n", "pers.stamm.gross",
    "pers.bewaesserung.n", "pers.bewaesserung.gross", "pers.lager.n", "pers.lager.gross",
    "pers.service.n", "pers.service.gross", "pers.saison.n", "pers.saison.gross",
    "pers.prakt.n", "pers.prakt.gross",
  ]},
  { group: "Transport/Logistik", keys: ["transport.spedition_rate", "transport.distance_km", "transport.dist_ref_km", "opex.transport"] },
  { group: "Klima- & Infrastrukturrisiko", keys: [
    "risk.irrig_outage_d", "risk.yield_per_outage_d", "risk.outage_break_share",
    "farm.intake_direct", "risk.intake_mitigation", "irrig.norm_scale", "irrig.eur_mm",
  ]},
  { group: "Markt & Qualität (Kontrakt vs. Spot)", keys: [
    "market.contract_share", "market.spot_delta", "market.brix_premium", "market.potato_grade", "market.tomate_cap_t",
  ]},
  { group: "Working Capital", keys: ["wc.dso", "wc.dpo", "wc.inv"] },
  { group: "Anzahlungen Off-taker (Annahme)", keys: ["advance.rate", "advance.cost_rate", "advance.aval_fee"] },
  { group: "Downside (Zurückweisung & Deckungskauf)", keys: ["quality.reject", "market.cover_premium"] },
  { group: "Lagerkanal (Feld vs. Lager)", keys: [
    "store.share.kartoffel_pommes", "store.share.kartoffel_chips", "store.share.zwiebel_moehre",
    "store.share.suesskartoffel", "store.share.knoblauch", "store.share.knollensellerie",
    "store.active", "store.capex_shell", "store.capex_tech", "store.months", "store.from_month", "store.service_mode", "store.fee_per_t_month", "store.energy_per_t_month",
    "store.handling_per_t", "store.loss_rate",
  ] },
  { group: "Subventionen", keys: ["subsidy.factor"] },
  { group: "Covenants", keys: ["covenant.dscr_min", "covenant.leverage_max"] },
];
