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
  UUID,
  CheckResult,
} from "../core/types";
export type { OfftakeContract } from "../core/types";
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
/** Semantik-Beschreibung der Stufen (für Legenden/Tooltips). */
export const STAGE_SEMANTICS: { sel: StageSel; growth: string; short: string; desc: string }[] = [
  { sel: "1",  growth: "s1a", short: "Basis · nur Ackerbau",     desc: "Status quo ohne Wertkulturen — reine Cash-Crop-Rotation (Getreide/Raps/Mais/Soja). Benchmark." },
  { sel: "1a", growth: "s1",  short: "+ Wertkulturen",           desc: "a = Anbau der Wertkulturen (Gemüse/Kartoffel) auf der heutigen Beregnungsfläche." },
  { sel: "2b", growth: "s2",  short: "+ Vollberegnung",          desc: "b = Beregnung: gesamte Betriebsfläche unter Beregnung, keine Flächenzukäufe." },
  { sel: "3c", growth: "s3b", short: "+ Fläche & Beregnung",     desc: "c = Fläche + Beregnung: Zukauf/Übernahme bis zum Zielausbau (20.000 ha)." },
];
export const STAGES: Record<string, { label: string; beregneteFlaecheHa: number; stageFactor: number; feldHa: number }> = {
  "1":  { label: "Stufe 1 (2026)",  beregneteFlaecheHa: 4000,  stageFactor: 1,   feldHa: 667 },
  "2":  { label: "Stufe 2 (2035)",  beregneteFlaecheHa: 10000, stageFactor: 2.5, feldHa: 1667 },
  "3b": { label: "Stufe 3b (Ziel)", beregneteFlaecheHa: 20000, stageFactor: 5,   feldHa: 3333 },
};
const stageFactorOf = (stage: Stage): number => STAGES[String(stage)]?.stageFactor ?? 1;

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
  | { kind: "crops"; ids: string[] }
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
  /** Intercompany-Miete (z. B. von Isolde): Einheiten, die NICHT gekauft, sondern gemietet werden.
   *  Kein CAPEX/AfA — stattdessen stundenbasierte Miet-OPEX (gemietete Stück × Stunden/Stück ×
   *  €/h aus Stundenkosten × (1 + machine.rent_markup)). Neu-CAPEX = ⌈benötigt − owned − rented⌉. */
  rentedUnits?: number;
  /** Verleiher-Gesellschaft der gemieteten Einheiten (Entity.id) — explizite Mietrichtung.
   *  Fehlt → Default-Verleiher Isolde (ENTITY_ISOLDE). Steuert, welcher Gesellschaft in der
   *  Entity-Sicht der Miet-ERTRAG gutgeschrieben wird (Mieter zahlt, Verleiher verdient). */
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
 *             (Anbaupause: Kartoffel ≤ 25 % der beregneten Fläche, Wirtsgruppen-weit). */
export type CropPolicy = {
  mode: "scale" | "fix" | "ramp";
  targetHa?: number;      // Ziel-Fläche (nur ramp)
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

/** Pacht-Simulator: OpCo pachtet Eigentumsflächen von der Besitzgesellschaft; Index-Stufen alle N Jahre. */
export type PachtConfig = {
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

/** Baut das Assumptions-Record aus einer Liste (key = Index). */
function asRecord(list: Assumption[]): Record<string, Assumption> {
  const o: Record<string, Assumption> = {};
  for (const a of list) o[a.key] = a;
  return o;
}

/* --------------------------------------------------------------------------
 * Timeline: Mehrjahresplan, monatlich, Basisjahr 2026. N_YEARS Jahre × 12 Monate.
 * ------------------------------------------------------------------------ */
const START_YEAR = 2026;
const N_YEARS = 8;
const N = N_YEARS * 12;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad2 = (x: number) => (x < 10 ? `0${x}` : `${x}`);
const MONTH_END: string[] = Array.from({ length: N }, (_, i) => {
  const y = START_YEAR + Math.floor(i / 12), m = i % 12;
  return `${y}-${pad2(m + 1)}-${pad2(DAYS[m])}`;
});
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

/** Unberegnete (Trocken-)Rotation — Break Crops, geringere Erträge (Rain-fed). DB je ha (CENT).
 *  HARTE REGEL (Agronomie Süd-Dolj): Soja (auch Doppel-Soja als Zweitfrucht) und Mais sind
 *  reine BEWÄSSERUNGS-Kulturen — sie dürfen NIE in der Trockenrotation stehen.
 *  `label` überschreibt den Katalognamen (z. B. Wintergerste OHNE das Doppel-Soja-Suffix). */
export type DrylandCrop = { cropId: CropId; sharePct: number; dbPerHaCent: number; label?: string;
  /** Rain-fed Ertrag (t/ha) & Feld-/Lagerverlust — nur für die physische Produktions-Anzeige
   *  (Ökonomie läuft über dbPerHaCent, nicht über Ertrag × Preis). */
  yieldTHa?: number; lossPct?: number };
export type GrowthPlan = {
  years: number;
  /** BEREGNETE Fläche je Jahr = Irrigations-Ramp (Stufe 1→3b). Treibt das Kern-Modell (Wertrotation). */
  areaByYear: number[];
  /** GESAMT-Betriebsfläche je Jahr (beregnet + unberegnet). Wächst über Zukauf/Übernahme. */
  totalByYear?: number[];
  /** Startpunkt heute (t0): Gesamt ~10.000 ha, davon ~4.000 ha beregnet. */
  startTotalHa?: number;
  startIrrigatedHa?: number;
  /** Zukauf / Übernahme Betrieb €/ha (Land + Übernahme) → Land-CAPEX. */
  acqEurPerHaCent?: number;
  /** Fremdfinanzierungsanteil des Zukaufs (LTV, 0..1) über Übernahme-/Bodenkredit. Default 1. */
  acqDebtShare?: number;
  /** Laufzeit des Übernahme-/Bodenkredits (Monate). Default 144 (12 J.). */
  acqLoanTermMonths?: number;
  /** Bewässerungs-Ausbau €/ha (Pivot/Verrohrung) — Planwert für neu beregnete ha. */
  irrigEurPerHaCent?: number;
  /** Unberegnete Rotation (Break Crops) — Anteile & DB/ha (Rain-fed). */
  drylandRotation?: DrylandCrop[];
  /** Stufe-3b Akquiseprofil: Übernahme ganzer Betriebe (Fläche + Beregnung + Maschinenbestand). */
  acquisitions?: FarmDeal[];
  /** Aktive Wachstumsstufe (Szenario der Flächenstrategie):
   *  s1  = Status Quo heute (kein Flächenwachstum, keine Beregnungserweiterung),
   *  s2  = Vollberegnung (gesamte Fläche unter Beregnung, kein Flächenzukauf),
   *  s3b = Flächen-Ramp (Akquiseprofil, Zukauf + Beregnungsausbau bis Ziel).
   *  s1a = wie s1 (flach, Status Quo), aber NUR Cash-Crop-Rotation (kein Gemüse) — Benchmark
   *        „Ackerbaubetrieb vor Wertkulturen" für die Gesellschafter-Analyse. */
  stage?: "s1" | "s1a" | "s2" | "s3b";
};

/** Effektiver Wachstumsplan nach aktiver Stufe. Leitet areaByYear/totalByYear/acquisitions
 *  aus der gewählten Stufe ab — treibt Umsatz, OpEx, Dryland-DB, CAPEX & Finanzierung. */
export function effectiveGrowth(gp: GrowthPlan | undefined): GrowthPlan | undefined {
  if (!gp) return gp;
  const stage = gp.stage ?? "s3b";
  if (stage === "s3b") {
    // PHYSIK-GUARD: beregnete Fläche kann die Gesamtfläche nie übersteigen — der Beregnungs-Ramp
    //  darf dem Flächenzukauf nicht vorauslaufen (sonst Beregnungsgrad > 100 % und Phantom-Umsatz).
    if (gp.totalByYear?.length) {
      const area = gp.areaByYear.map((a, y) => Math.min(a, gp.totalByYear![Math.min(y, gp.totalByYear!.length - 1)] ?? a));
      return { ...gp, areaByYear: area };
    }
    return gp;
  }
  const n = Math.max(1, gp.years);
  const startTot = gp.startTotalHa ?? gp.totalByYear?.[0] ?? 0;
  const startIrr = gp.startIrrigatedHa ?? gp.areaByYear[0] ?? 0;
  if (stage === "s1" || stage === "s1a") {
    // Status Quo: alles flach auf heute, keine Übernahmen. (s1a = Cash-only-Kulturmix, s. buildModelState.)
    return { ...gp, areaByYear: Array.from({ length: n }, () => startIrr), totalByYear: Array.from({ length: n }, () => startTot), acquisitions: [] };
  }
  // s2 — Beregnungsausbau bis gesamte Betriebsfläche beregnet ist; Gesamtfläche bleibt konstant.
  //  TEMPO = der geplante Beregnungs-Ramp (areaByYear, editierbar), gedeckelt auf die Gesamtfläche —
  //  Vollberegnung wird also ~2029 erreicht (wie im s3b-Pfad), nicht künstlich über den Horizont gestreckt.
  const area = Array.from({ length: n }, (_, y) =>
    Math.min(startTot, gp.areaByYear[Math.min(y, gp.areaByYear.length - 1)] ?? startIrr));
  return { ...gp, areaByYear: area, totalByYear: Array.from({ length: n }, () => startTot), acquisitions: [] };
}
/** Farm-Akquisition — zwei Modi:
 *  · "lease" = Übernahme von Pachtflächen (Ablöse ~500 €/ha, asset-light): keine Land-/Maschinen-
 *    Assets, dafür laufende Pacht auf die übernommene Fläche.
 *  · "asset" = Kauf ganzer Betriebe (2.000–3.000 €/ha): Land + Gebäude als Asset, Maschinen-Zeitwert
 *    als Bestand (mindert Neu-CAPEX), keine laufende Pacht. */
export type FarmDeal = {
  id: string; year: number; name: string;
  dealType: "lease" | "asset";
  totalHa: number; irrHa: number;      // übernommene Fläche gesamt / davon beregnet
  eurPerHaCent: number;                // Ablöse/Kaufpreis je ha (CENT) — ~500 lease / 2.000–3.000 asset
  machineValueCent: number;            // Zeitwert übernommener Maschinen (nur asset; mindert Neu-CAPEX)
  leaseRentPerHaCent?: number;         // laufende Pacht €/ha (nur lease); fehlt → Pacht-Basissatz
  /** Fremdfinanzierungsquote der Übernahme (0..1, Akquisitionskredit/Leasing); Rest aus Cash/EK. */
  debtShare?: number;
};
/** Ersatzinvestitions-Konfiguration je Maschine (überschreibt globale Defaults). */
export type ReplCfg = { cycleYears?: number; afaYears?: number; hoursPerYear?: number; enabled?: boolean };
const GROWTH: GrowthPlan = {
  years: N_YEARS,
  // BEREGNUNGS-Ramp 4.000 → 20.000 ha (= Stufen 1/2/3b; geglättet, kein Verdopplungssprung).
  areaByYear: [4002, 6000, 9000, 12000, 15000, 18000, 20000, 20000],
  // GESAMTFLÄCHE (beregnet + unberegnet). Heute ~10.000 ha; wächst über Zukauf, so dass
  // neben dem Beregnungsausbau ~6.000 ha Trockenrotation erhalten bleibt/mitwächst.
  //  Covenant-schonend gepaced: Gesamtfläche wächst auf ~20.500 ha (≈ beregnete 20.000 +
  //  schlanker Trocken-Tail 500 ha), damit Net Debt/EBITDA ≤ 3,5 hält. Editierbar.
  totalByYear: [10000, 10800, 11800, 12800, 14000, 15500, 17500, 20000],
  startTotalHa: 10000,
  startIrrigatedHa: 4000,
  acqEurPerHaCent: 1000000,   // 10.000 €/ha Zukauf/Übernahme (Süd-Dolj, inkl. Übernahme)
  acqDebtShare: 0.4,          // 40 % Übernahme-/Bodenkredit, 60 % Eigenmittel (Covenant-schonend)
  acqLoanTermMonths: 360,     // 30 J. Laufzeit → niedriger Kapitaldienst, bessere DSCR
  irrigEurPerHaCent: 300000,  // 3.000 €/ha Beregnungsausbau (Pivot + Verrohrung + Pumpe)
  // REGEL: Soja (inkl. Doppel-Soja) & Mais NUR beregnet → Trockenrotation ist reine
  //  Getreide-/Raps-Rotation (Weizen–Gerste–Raps). Gerste hier OHNE Doppel-Soja (Label!).
  drylandRotation: [
    { cropId: "weizen",     sharePct: 0.40, dbPerHaCent: 55000, yieldTHa: 5.5, lossPct: 0.05 },                          // 550 €/ha rain-fed
    { cropId: "gerste_zw",  sharePct: 0.35, dbPerHaCent: 45000, label: "Wintergerste", yieldTHa: 4.8, lossPct: 0.05 },   // 450 €/ha — OHNE Doppel-Soja (trocken!)
    { cropId: "winterraps", sharePct: 0.25, dbPerHaCent: 60000, yieldTHa: 2.8, lossPct: 0.05 },                          // 600 €/ha
  ],
  // Stufe 3b — Akquiseprofil: Mix aus Pachtübernahme (asset-light) und Betriebskauf (mit Assets).
  acquisitions: [
    { id: "d1", year: 5, name: "Pachtpaket Ost", dealType: "lease", totalHa: 4000, irrHa: 2000, eurPerHaCent: 50000, machineValueCent: 0, leaseRentPerHaCent: 30000, debtShare: 0.5 },
    { id: "d2", year: 7, name: "Betrieb Süd (Kauf)", dealType: "asset", totalHa: 5000, irrHa: 2500, eurPerHaCent: 250000, machineValueCent: 900000000, debtShare: 0.65 },
  ],
  stage: "s1", // Default-Start: Stufe 1 (Status quo, 4.000 ha beregnet / 10.000 ha gesamt).
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
const CROP_CAL: Record<CropId, { plant: number; harvest: number[]; dueng?: number; psm?: number; bereg?: number }> = {
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
const PACHT_PER_HA = 250;
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
    { m: "pflug", passes: 1 }, { m: "saatbett", passes: 1 }, { m: "einzelkorn", passes: 1 },
    // Ernte gesplittet: Zwiebel-Hälfte 2-stufig (Schwadleger + Ladeeroder), Möhren-Hälfte Klemmband → je 0,5 Passes.
    { m: "streuer", passes: 1 }, { m: "spritze14", passes: 8 },
    { m: "gem_schwad", passes: 0.5 }, { m: "gem_lader", passes: 0.5 }, { m: "gem_moehre", passes: 0.5 },
    { m: "transport", passes: 1 },
  ],
  // NEU: Süßkartoffel — Slips-Pflanzung (Gemüse-Pflanzmaschine), Rodung Siebkette (ROPA).
  suesskartoffel: [
    { m: "pflug", passes: 1 }, { m: "saatbett", passes: 1 }, { m: "tompflanz", passes: 1 },
    { m: "streuer", passes: 1 }, { m: "spritze14", passes: 3 },
    { m: "roder_ropa", passes: 1 }, { m: "transport", passes: 1 },
  ],
  // NEU: Winterknoblauch — Stecken via Einzelkorn-/Legetechnik, Rodung Siebkette.
  knoblauch: [
    { m: "pflug", passes: 1 }, { m: "saatbett", passes: 1 }, { m: "einzelkorn", passes: 1 },
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
  A("macro.euribor", "macro.euribor", "EURIBOR 3M", "rate", 0.026, 0.02, 0.036),
  A("tax.rate", "tax.rate", "Körperschaftsteuersatz (RO)", "rate", 0.16),
  // Reinvestitions-Befreiung (RO): reinvestierter Gewinn in qual. Ausrüstung (Maschinen/Bewässerung/
  //  Verarbeitungstechnik) ist von der 16 %-KSt befreit. Jahres-Pooling: befreit = min(Gewinn, qual. CAPEX).
  A("tax.reinvest_on", "tax.reinvest_on", "Reinvestitions-Befreiung aktiv (0/1)", "count", 0),
  A("tax.reinvest_share", "tax.reinvest_share", "Qualifizierender Anteil der Ausrüstungs-CAPEX", "rate", 1.0),
  // Innenfinanzierung: Neuanschaffungen (Maschinen) aus Cash statt Kredit — der Revolver deckt nur echte
  //  Deckungslücken (= automatischer „genug Cash?"-Check). 1 = Cash-first, 0 = Kredit-/Leasingverträge.
  A("finance.capex_selffund", "finance.capex_selffund", "Neuanschaffungen aus Cash (0/1)", "count", 0),
  // opex.admin: Legacy-Zentralverwaltung — jetzt 0, weil die Gemeinkosten strukturiert und
  // dynamisch über domain.overhead (SG&A) laufen; der Composer setzt deren Summe in opex.sga.
  A("opex.admin", "opex.admin", "Zentralverwaltung (Legacy, in SG&A überführt) /Monat", "money", 0),
  // opex.sga: Summe der strukturierten Corporate-Gemeinkosten (domain.overhead) — Composer setzt sie je Build.
  A("opex.sga", "opex.sga", "Gemeinkosten / SG&A (Summe) /Monat", "money", 0),
  // opex.machines: NUR Wartung/Service (separater Pfad, reale JD-€/h). Betrieb steckt in COGS,
  // AfA/Zins in CAPEX/Finanzierung. Composer überschreibt je Build aus den Service-Sätzen.
  A("opex.machines", "opex.machines", "Maschinen-Wartung/Service /Monat", "money", 0),
  // opex.machine_rent: Intercompany-Maschinenmiete (gemietete Einheiten × Stunden × €/h). Composer-gesetzt.
  A("opex.machine_rent", "opex.machine_rent", "Maschinen-Miete (Intercompany) /Monat", "money", 0),
  // opex.machine_rent_income: Miet-ERTRAG des Verleihers (negativ in OpEx → hebt EBITDA). Composer-gesetzt.
  A("opex.machine_rent_income", "opex.machine_rent_income", "Maschinen-Miet-Ertrag (Intercompany) /Monat", "money", 0),
  // Aufschlag auf die Stundenkosten (AfA/h + Service/h) für die Intercompany-Miete (z. B. +15 % Isolde-Marge).
  A("machine.rent_markup", "machine.rent_markup", "Miet-Aufschlag Intercompany (auf Stundenkosten)", "rate", 0.15),
  // opex.fix: Pacht + Overhead je Kultur — wird im Composer je Build aus dem Anbauplan
  // deterministisch als Monatswert überschrieben.
  A("opex.fix", "opex.fix", "Fixkosten/Monat (Pacht + Overhead/Versich./Zins)", "money", 0),
  // opex.transport: Transport ZUM ABNEHMER — wird im Composer aus der Make-or-Buy-
  // Entscheidung (deriveTransportDecision) je Build als Monatswert überschrieben.
  A("opex.transport", "opex.transport", "Transport zum Abnehmer /Monat (Make-or-Buy)", "money", 0),
  A("transport.spedition_rate", "transport.spedition_rate", "Spedition €/t (Transport zum Abnehmer)", "money", 900),
  // --- Globale TCO-Maschinenkosten (ALLE Feldmaschinen) ---
  A("tco.discount", "tco.discount", "Einkaufsrabatt auf Listenpreis", "rate", 0.20),
  A("tco.res_trail", "tco.res_trail", "Restwert-Quote gezogene Maschinen (nach Haltedauer)", "rate", 0.55),
  A("tco.res_self", "tco.res_self", "Restwert-Quote Selbstfahrer (nach Haltedauer)", "rate", 0.45),
  A("tco.hold_years", "tco.hold_years", "Haltedauer / Tauschzyklus (Jahre)", "months", 6),
  // Ersatzinvestitionen: Tauschzyklus je Maschine = min(hold_years, replace_hours / Bh je Jahr).
  A("capex.replace_hours", "capex.replace_hours", "Tauschzyklus — Betriebsstunden-Kappung (Bh)", "count", 6000),
  // Bilanzielle AfA-Dauer der Maschinen (Standard). Länger als der Tauschzyklus ⇒ Buchverlust bei Tausch.
  A("capex.afa_years", "capex.afa_years", "AfA-Dauer Maschinen (Jahre, bilanziell)", "count", 8),
  // Wartung/Service €/h (CENT) — reale JD-Angebotswerte; SEPARAT vom CAPEX (Netto-Einkauf).
  // Fließt über den Service-Pfad in opex.machines (Monats-Overhead) und in deriveMachineTCO.
  A("tco.zug_8rx.service_h", "tco.zug_8rx.service_h", "Wartung/Service Zug JD 8RX €/h", "money", 291),
  A("tco.ops_6r.service_h", "tco.ops_6r.service_h", "Wartung/Service Pflege/Ernte JD 6R €/h", "money", 220),
  A("tco.maehdr.service_h", "tco.maehdr.service_h", "Wartung/Service Mähdrescher S7 900 €/h", "money", 644),
  A("wc.dso", "wc.dso", "DSO (Forderungstage)", "days", 45),
  A("wc.dpo", "wc.dpo", "DPO (Verb.-Tage)", "days", 30),
  A("wc.inv", "wc.inv", "Lagertage", "days", 60),
  // --- Förderung ---
  A("subsidy.per_ha", "subsidy.per_ha", "GAP/CAP-Basisprämie €/ha (alle)", "money_per_ha", 20500),
  A("subsidy.coupled_freilandgemuese", "subsidy.coupled_freilandgemuese", "Gekoppelte Stützung Tomate + Zwiebel/Möhre €/ha", "money_per_ha", 161200),
  A("rev.gerste_zweitfrucht", "rev.gerste_zweitfrucht", "Zweitkultur-Beitrag Gerste — Doppel-Soja €/ha", "money_per_ha", 50000),
  A("covenant.dscr_min", "covenant.dscr_min", "DSCR min. (Agrar-Projektfin. 1,10)", "rate", 1.10),
  A("covenant.leverage_max", "covenant.leverage_max", "Leverage max.", "rate", 3.5),

  // --- Shared Stücksätze (CENT je Einheit) ---
  A("price.diesel_l", "price.diesel_l", "Diesel €/l", "money", 100),
  A("rate.labor_h", "rate.labor_h", "Lohn Saison/zilier €/h", "money", 520),
  // Phase 8 — Inflation p.a. (getrennt, real vs. nominal). Auf 0 = konstante Preise (real).
  A("infl.output", "infl.output", "Inflation Output-Preise (Ernteerlöse) p.a.", "rate", 0.02),
  A("infl.input", "infl.input", "Inflation Input-Kosten (Dünger/PSM/Saatgut/Diesel/OpEx) p.a.", "rate", 0.025),
  A("infl.wage", "infl.wage", "Inflation Löhne/Gehälter p.a.", "rate", 0.03),
  A("infl.capex", "infl.capex", "Inflation CAPEX (Maschinen/Anlagen) p.a.", "rate", 0.02),
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
  A("seed.knollensellerie", "seed.knollensellerie", "Sellerie-Jungpflanzen €/1.000 Stk (50 T/ha, Erdpressballen)", "money", 6500),
  // Phase 5 — Bewässerung Energie+Wasser €/mm·ha (CENT). Norm mm je Kultur × Preis (Center-Pivot Süd-Dolj).
  A("irrig.eur_mm", "irrig.eur_mm", "Bewässerung Energie+Wasser €/mm·ha", "money", 150),

  // --- Ertrag / Preis / Verlust je Kultur (Referenz A) ---
  A("yield.weizen", "yield.weizen", "Ertrag Winterweizen", "tonne_per_ha", 8.5, 9.4, 7.2),
  A("price.weizen", "price.weizen", "Preis Winterweizen", "money_per_tonne", 17000, 19000, 15000),
  A("loss.weizen", "loss.weizen", "Verlust Winterweizen", "rate", 0.05),
  A("yield.gerste_zw", "yield.gerste_zw", "Ertrag Wintergerste", "tonne_per_ha", 7.0, 7.7, 6.0),
  A("yield.soja_zw", "yield.soja_zw", "Ertrag Zweitfrucht-Soja (nach Gerste, beregnet)", "tonne_per_ha", 2.1, 2.5, 1.6),
  A("price.gerste_zw", "price.gerste_zw", "Preis Wintergerste", "money_per_tonne", 18000, 20000, 16000),
  A("loss.gerste_zw", "loss.gerste_zw", "Verlust Wintergerste", "rate", 0.05),
  A("yield.soja_luzerne", "yield.soja_luzerne", "Ertrag Soja/Luzerne", "tonne_per_ha", 4.0, 4.6, 3.4),
  A("price.soja_luzerne", "price.soja_luzerne", "Preis Soja/Luzerne", "money_per_tonne", 43000, 47000, 38000),
  A("loss.soja_luzerne", "loss.soja_luzerne", "Verlust Soja/Luzerne", "rate", 0.05),
  A("yield.winterraps", "yield.winterraps", "Ertrag Winterraps", "tonne_per_ha", 4.0, 4.6, 3.2),
  A("price.winterraps", "price.winterraps", "Preis Winterraps", "money_per_tonne", 47000, 52000, 41000),
  A("loss.winterraps", "loss.winterraps", "Verlust Winterraps", "rate", 0.05),
  A("yield.mais", "yield.mais", "Ertrag Körnermais (bewässert)", "tonne_per_ha", 14.0, 15.5, 11.5),
  A("price.mais", "price.mais", "Preis Körnermais", "money_per_tonne", 19000, 21000, 16500),
  A("loss.mais", "loss.mais", "Verlust Körnermais", "rate", 0.10),
  A("yield.tomate", "yield.tomate", "Ertrag Industrietomate", "tonne_per_ha", 88, 95, 74),
  A("price.tomate", "price.tomate", "Preis Industrietomate", "money_per_tonne", 12000, 13800, 10200),
  A("loss.tomate", "loss.tomate", "Verlust Industrietomate", "rate", 0.08),
  A("yield.kartoffel_pommes", "yield.kartoffel_pommes", "Ertrag Kartoffel (Pommes)", "tonne_per_ha", 45, 50, 38),
  // Preisband aus den geprüften Abnahmeverträgen (PepsiCo Basis 220 €/t, max. 255,40;
  //  Pestova 240 €/t flat; VIA AGRO Leiter −0,15…+0,11 RON/kg). Spot/Rest-Menge.
  A("price.kartoffel_pommes", "price.kartoffel_pommes", "Preis Kartoffel (Pommes)", "money_per_tonne", 23500, 25500, 22000),
  A("loss.kartoffel_pommes", "loss.kartoffel_pommes", "Verlust Kartoffel (Pommes)", "rate", 0.10),
  A("yield.kartoffel_chips", "yield.kartoffel_chips", "Ertrag Kartoffel (Chips)", "tonne_per_ha", 42, 47, 35),
  A("price.kartoffel_chips", "price.kartoffel_chips", "Preis Kartoffel (Chips)", "money_per_tonne", 23500, 25500, 22000),
  A("loss.kartoffel_chips", "loss.kartoffel_chips", "Verlust Kartoffel (Chips)", "rate", 0.10),
  A("yield.zwiebel_moehre", "yield.zwiebel_moehre", "Ertrag Zwiebel/Möhre", "tonne_per_ha", 60, 66, 51),
  A("price.zwiebel_moehre", "price.zwiebel_moehre", "Preis Zwiebel/Möhre", "money_per_tonne", 17500, 20125, 14875),
  A("loss.zwiebel_moehre", "loss.zwiebel_moehre", "Verlust Zwiebel/Möhre", "rate", 0.08),
  // NEU (Marktanalyse 24.07.): Import-Substitutions-Kulturen — konservative Preise (Großhandel ab Hof).
  A("yield.suesskartoffel", "yield.suesskartoffel", "Ertrag Süßkartoffel (bewässert, Dăbuleni-Versuche 23–53 t)", "tonne_per_ha", 25, 32, 18),
  A("price.suesskartoffel", "price.suesskartoffel", "Preis Süßkartoffel (Großhandel, Importparität)", "money_per_tonne", 70000, 85000, 55000),
  A("loss.suesskartoffel", "loss.suesskartoffel", "Verlust Süßkartoffel (Curing/Sortierung)", "rate", 0.10),
  A("yield.knoblauch", "yield.knoblauch", "Ertrag Knoblauch (bewässert)", "tonne_per_ha", 9, 11, 7),
  A("price.knoblauch", "price.knoblauch", "Preis Knoblauch (Erzeuger RO)", "money_per_tonne", 250000, 287500, 212500),
  A("loss.knoblauch", "loss.knoblauch", "Verlust Knoblauch (Trocknung/Putzen)", "rate", 0.08),
  A("yield.knollensellerie", "yield.knollensellerie", "Ertrag Knollensellerie (bewässert; Upside 48–50 t Süd-Standort)", "tonne_per_ha", 38, 48, 31),
  A("price.knollensellerie", "price.knollensellerie", "Preis Knollensellerie (Erzeuger; Importparität ~0,74 USD/kg)", "money_per_tonne", 48000, 55200, 40800),
  A("loss.knollensellerie", "loss.knollensellerie", "Verlust Knollensellerie (Putzen/Lager)", "rate", 0.07),
  // Rain-fed (Trockenrotation) — eigene, niedrigere Erträge; Preise = beregnet.
  A("yield.weizen_dry", "yield.weizen_dry", "Ertrag Winterweizen (trocken/rain-fed)", "tonne_per_ha", 5.5, 6.2, 4.2),
  A("price.weizen_dry", "price.weizen_dry", "Preis Winterweizen (trocken)", "money_per_tonne", 17000, 19000, 15000),
  A("loss.weizen_dry", "loss.weizen_dry", "Verlust Winterweizen (trocken)", "rate", 0.05),
  A("yield.gerste_dry", "yield.gerste_dry", "Ertrag Wintergerste (trocken/rain-fed)", "tonne_per_ha", 4.8, 5.4, 3.8),
  A("price.gerste_dry", "price.gerste_dry", "Preis Wintergerste (trocken)", "money_per_tonne", 18000, 20000, 16000),
  A("loss.gerste_dry", "loss.gerste_dry", "Verlust Wintergerste (trocken)", "rate", 0.05),
  A("yield.raps_dry", "yield.raps_dry", "Ertrag Winterraps (trocken/rain-fed)", "tonne_per_ha", 2.8, 3.3, 2.2),
  A("price.raps_dry", "price.raps_dry", "Preis Winterraps (trocken)", "money_per_tonne", 47000, 52000, 41000),
  A("loss.raps_dry", "loss.raps_dry", "Verlust Winterraps (trocken)", "rate", 0.05),
  A("qual.weizen_dry", "qual.weizen_dry", "Qualitätserfüllung Winterweizen (trocken)", "rate", 0.98, 1.00, 0.92),
  A("qual.gerste_dry", "qual.gerste_dry", "Qualitätserfüllung Wintergerste (trocken)", "rate", 0.98, 1.00, 0.92),
  A("qual.raps_dry", "qual.raps_dry", "Qualitätserfüllung Winterraps (trocken)", "rate", 0.98, 1.00, 0.92),
  // Sonnenblume (rain-fed Break Crop) — Ertrag Oltenien ~3,0 t/ha, Ölsaatpreis knapp unter Raps.
  A("yield.sonnenblume", "yield.sonnenblume", "Ertrag Sonnenblume (trocken/rain-fed)", "tonne_per_ha", 3.0, 3.5, 2.2),
  A("price.sonnenblume", "price.sonnenblume", "Preis Sonnenblume (Ölsaat)", "money_per_tonne", 46000, 52000, 40000),
  A("loss.sonnenblume", "loss.sonnenblume", "Verlust Sonnenblume (Ernte/Trocknung)", "rate", 0.05),
  A("qual.sonnenblume", "qual.sonnenblume", "Qualitätserfüllung Sonnenblume (Ölgehalt)", "rate", 0.98, 1.00, 0.92),

  // --- Kontrakt-Qualitätserfüllung (0..1): realisierter Preis nach Qualitäts-Bonus/Malus ×
  //     akzeptierte Menge. 1 = 100 % Kontrakterfüllung. Best/Worst = Qualitäts-Upside/-Downside.
  //     Treiber je Kultur: Getreide Protein/Fallzahl, Raps Ölgehalt, Tomate Brix/Farbe,
  //     Kartoffel Stärke/Zucker/Fritierfarbe/Sortierung, Zwiebel/Möhre Kaliber/Sortierung.
  A("qual.weizen", "qual.weizen", "Qualitätserfüllung Weizen (Protein/Fallzahl)", "rate", 0.99, 1.00, 0.94),
  A("qual.gerste_zw", "qual.gerste_zw", "Qualitätserfüllung Gerste", "rate", 0.99, 1.00, 0.94),
  A("qual.soja_luzerne", "qual.soja_luzerne", "Qualitätserfüllung Soja/Luzerne", "rate", 0.99, 1.00, 0.95),
  A("qual.winterraps", "qual.winterraps", "Qualitätserfüllung Raps (Ölgehalt)", "rate", 0.99, 1.00, 0.94),
  A("qual.mais", "qual.mais", "Qualitätserfüllung Mais (Feuchte/Bruch)", "rate", 0.99, 1.00, 0.95),
  A("qual.tomate", "qual.tomate", "Qualitätserfüllung Tomate (Brix/Farbe)", "rate", 0.98, 1.00, 0.88),
  A("qual.kartoffel_pommes", "qual.kartoffel_pommes", "Qualitätserfüllung Kartoffel Pommes (Länge/Zucker/Sortierung)", "rate", 0.97, 1.00, 0.86),
  A("qual.kartoffel_chips", "qual.kartoffel_chips", "Qualitätserfüllung Kartoffel Chips (Fritierfarbe/Zucker)", "rate", 0.97, 1.00, 0.85),
  A("qual.zwiebel_moehre", "qual.zwiebel_moehre", "Qualitätserfüllung Zwiebel/Möhre (Kaliber/Sortierung)", "rate", 0.97, 1.00, 0.87),
  A("qual.suesskartoffel", "qual.suesskartoffel", "Qualitätserfüllung Süßkartoffel (Kaliber/Schale)", "rate", 0.95, 1.00, 0.85),
  A("qual.knoblauch", "qual.knoblauch", "Qualitätserfüllung Knoblauch (Kaliber/Trocknung)", "rate", 0.97, 1.00, 0.88),
  A("qual.knollensellerie", "qual.knollensellerie", "Qualitätserfüllung Knollensellerie (Kaliber/Putz)", "rate", 0.97, 1.00, 0.88),

  // --- Maschinen-Neupreise (CENT) — Referenz B ---
  // Anbaugeräte-Preise = NUR das Gerät (ohne Schlepper — Traktoren sind eigene Positionen zug_9r/8rx/6r).
  A("mprice.pflug", "mprice.pflug", "Universalgrubber HORSCH Fortis 6.4 LT (6,20 m, bis 30 cm; Liste ~71,2 T€)", "money", 7200000),
  A("mprice.saatbett", "mprice.saatbett", "Saatbettkombi 12 m", "money", 7000000),
  A("mprice.drille", "mprice.drille", "Getreidedrille 9–12 m (HORSCH Pronto)", "money", 13000000),
  A("mprice.einzelkorn", "mprice.einzelkorn", "Einzelkornsämaschine HORSCH Maestro 12 TX", "money", 24000000),
  A("mprice.streuer", "mprice.streuer", "Düngerstreuer RAUCH AERO GT 36 m", "money", 8500000),
  A("mprice.streuer_xeric", "mprice.streuer_xeric", "Düngerstreuer HORSCH Leeb Xeric 14 FS (48 m, 14.000 l)", "money", 16500000),
  A("mprice.boom48_pkg", "mprice.boom48_pkg", "48-m-Paket: Gestänge-Umrüstung PT/TD + Fahrgassen-Terminal", "money", 17000000),
  A("mprice.spritze14", "mprice.spritze14", "Spritzen-Kostenprofil 36 m (Mischpark, €/Einheit)", "money", 38000000),
  A("mprice.krautschl", "mprice.krautschl", "Krautschläger ROPA KS 475 (4-reihig, 75–80 cm)", "money", 4500000),
  // Kartoffel One-Pass-Kette (Delta 21.07.) — ersetzt Legemaschine/Dammformer/Vollernter SF.
  A("mprice.onepass", "mprice.onepass", "Dewulf CP 42 Smart Float Becherlegemaschine", "money", 8000000),
  A("mprice.sc360", "mprice.sc360", "Dewulf SC-Front Frontfräse", "money", 6000000),
  A("mprice.roder_ropa", "mprice.roder_ropa", "Roder ROPA Keiler II (Liste netto o. MwSt, mit WD-Triebachse)", "money", 22500000),
  // Reale John-Deere-Angebotswerte (Liste) — Overrides für Rabatt/Restwert an der MachineType.
  A("mprice.zug_8rx", "mprice.zug_8rx", "Zugschlepper JD 8RX 410 (Liste, JD-Angebot)", "money", 68644700),
  A("mprice.zug_9r", "mprice.zug_9r", "Zugschlepper JD 9R 590 (Liste, JD-Angebot; Prime Mover 12-m-Boden/Saat)", "money", 70033600),
  A("mprice.ops_6r", "mprice.ops_6r", "Pflege/Ernte-Schlepper JD 6R 260 (Liste = 6R 250 +3 %)", "money", 32509400),
  A("mprice.lkw_sattel", "mprice.lkw_sattel", "LKW mit Sattelauflieger (Straßentransport/Auslieferung)", "money", 13000000),
  A("mprice.radlader", "mprice.radlader", "JCB Radlader (Lager/Verladung)", "money", 10000000),
  A("mprice.shuttle", "mprice.shuttle", "Field-Shuttle 8×8 (Überladewagen)", "money", 5000000),
  A("mprice.fieldloader", "mprice.fieldloader", "DEMA Fieldloader OL-COMBI (Feldrand-Überladetrichter, 9-m-Elevator, elektr.)", "money", 20000000),
  A("log.fieldloader_tph", "log.fieldloader_tph", "Fieldloader-Überladeleistung (t/h) — treibt den Bedarf", "tonne_per_ha", 150),
  A("mprice.tompflanz", "mprice.tompflanz", "Tomaten-Pflanzmaschine Checchi & Magli", "money", 14000000),
  A("mprice.tomernte", "mprice.tomernte", "Tomaten-Vollernter SF", "money", 45000000),
  A("mprice.gem_schwad", "mprice.gem_schwad", "Zwiebel-Schwadleger ASA-LIFT WR-180", "money", 9500000),
  A("mprice.gem_lader", "mprice.gem_lader", "Zwiebel-Ladeeroder ASA-LIFT SP-400", "money", 26500000),
  A("mprice.gem_moehre", "mprice.gem_moehre", "Möhren-Klemmbandroder ASA-LIFT T-300 DF (2-reihig)", "money", 34000000),
  A("mprice.maehdr", "mprice.maehdr", "Mähdrescher JD S7 900 + Bandschneidwerk HD40X 12,19 m (Liste; JD-Angebot)", "money", 85877800),
  A("mprice.transport", "mprice.transport", "Kipper/Anhänger (Transport)", "money", 4000000),
  A("mprice.irrig_perha", "mprice.irrig_perha", "Bewässerung/Pivot €/ha", "money_per_ha", 200000),
  A("mprice.store_pert", "mprice.store_pert", "Lager/Packhaus €/t", "money_per_tonne", 12000),
  // Absatz-/Kapazitätsgrenzen: Verarbeitungskapazität des kontrahierten Tomatenwerks (t/Kampagne).
  //  Mittelgroßes EU-Werk ≈ 100–250 kt/Kampagne (2.000–4.000 t/Tag × 60–80 Tage). Advisor warnt darüber.
  A("market.tomate_cap_t", "market.tomate_cap_t", "Tomatenwerk-Kapazität (t/Kampagne)", "count", 150000),
  // Einlagerungsquote je lagerpflichtiger Kultur (0..1): Anteil der Ernte, der eingelagert wird.
  //  Rest geht direkt Feld → Verarbeiter (keine Lager-CAPEX). Treibt die Lager-Bemessung (store).
  A("store.share.kartoffel_pommes", "store.share.kartoffel_pommes", "Einlagerungsquote Kartoffel Pommes", "rate", 1.0),
  A("store.share.kartoffel_chips", "store.share.kartoffel_chips", "Einlagerungsquote Kartoffel Chips", "rate", 1.0),
  A("store.share.zwiebel_moehre", "store.share.zwiebel_moehre", "Einlagerungsquote Zwiebel/Möhre", "rate", 1.0),

  // --- Personal (headcount / Bruttomonatsgehalt CENT) — Referenz D, Stufe 1 ---
  // Kopfzahlen skaliert der Composer mit stageFactor.
  A("pers.leitung.n", "pers.leitung.n", "Betriebsleitung & Agronomie (FTE)", "count", 3),
  A("pers.leitung.gross", "pers.leitung.gross", "Leitung/Agronomie Brutto/Monat", "money", 250000),
  A("pers.stamm.n", "pers.stamm.n", "Stamm-Maschinenführer (FTE)", "count", 12),
  A("pers.stamm.gross", "pers.stamm.gross", "Maschinenführer Brutto/Monat (7 €/h)", "money", 100333),
  A("pers.bewaesserung.n", "pers.bewaesserung.n", "Bewässerung / Pivot-Steuerung (FTE)", "count", 4),
  A("pers.bewaesserung.gross", "pers.bewaesserung.gross", "Bewässerung Brutto/Monat", "money", 90000),
  A("pers.lager.n", "pers.lager.n", "Lager & Aufbereitung (FTE)", "count", 4),
  A("pers.lager.gross", "pers.lager.gross", "Lager Brutto/Monat", "money", 88000),
  A("pers.service.n", "pers.service.n", "Werkstatt & Service/Technik (FTE)", "count", 3),
  A("pers.service.gross", "pers.service.gross", "Werkstatt/Service Brutto/Monat", "money", 115000),
  A("pers.saison.n", "pers.saison.n", "Saisonkräfte (Kampagne, FTE-Äq.)", "count", 11.72),
  A("pers.saison.gross", "pers.saison.gross", "Saisonkraft Brutto/Monat (5,20 €/h)", "money", 74550),
  A("pers.prakt.n", "pers.prakt.n", "Praktikanten / Trainees (FTE)", "count", 4),
  A("pers.prakt.gross", "pers.prakt.gross", "Praktikant Brutto/Monat", "money", 45000),

  // --- Holding (CENT je Periode / Raten) ---
  A("hold.audit", "hold.audit", "Holding Wirtschaftsprüfung", "money", 100000),
  A("hold.legal", "hold.legal", "Holding Legal", "money", 83000),
  A("hold.board", "hold.board", "Holding Board/D&O", "money", 208000),
  A("hold.domizil", "hold.domizil", "Holding Domizil", "money", 66000),
  A("hold.it", "hold.it", "Holding IT", "money", 125000),
  A("hold.tax", "hold.tax", "Holding Steuerberatung", "money", 83000),
  A("hold.fee", "hold.fee", "Management-Fee (IC)", "money", 416700),
  A("hold.taxrate", "hold.taxrate", "Holding-Steuersatz (CY)", "rate", 0.15),
  A("hold.wht", "hold.wht", "Quellensteuer Dividende", "rate", 0),

  // --- Delta 21.07. (2): Spritzstrategie (fenstergetriebene Flotte, Mischpark) ---
  // Die Spritzenzahl ist der Mehrkultur-Sommerpeak (max. gleichzeitiger PSM-Bedarf ALLER
  // Kulturen), nicht mehr pauschal. Fließt über spray_gz/spray_sf in CAPEX/TCO/Bilanz.
  A("spray.appl_lha", "spray.appl_lha", "Wasseraufwand l/ha (Kartoffel-Blight 200–400)", "count", 200),
  A("spray.window_days", "spray.window_days", "PSM-Fenster je Runde (Tage)", "days", 5),
  A("spray.boom_m", "spray.boom_m", "Gestängebreite m (36 = Bestand · 48 = 48-m-Paket → weniger Spritzen + −25 % Spritz-€/ha)", "count", 36),
  // 48-m-Paket-Schalter: aktiviert kohärent 48-m-Spritzenbreite + Streuer-Swap AERO GT→Leeb Xeric 14 FS
  // + 48-m-Umrüst-CAPEX (Gestänge PT/TD + Fahrgassen-Terminal). Boden/Saat/Drusch (12 m) bereits kompatibel.
  A("farm.boom48", "farm.boom48", "48-m-Paket aktiv (0 = 36 m Bestand · 1 = 48 m Paket)", "count", 0),
  A("spray.speed_kmh", "spray.speed_kmh", "Fahrtempo km/h", "count", 12),
  A("spray.refill_min", "spray.refill_min", "Befüllzeit min", "count", 20),
  A("spray.field_eff", "spray.field_eff", "Feldeffizienz", "rate", 0.80),
  A("spray.hours_day", "spray.hours_day", "Einsatzstunden/Tag", "count", 11),
  A("spray.sf_share", "spray.sf_share", "Selbstfahrer-Anteil der Spritzenflotte", "rate", 0.25),
  A("spray.tank_gz_l", "spray.tank_gz_l", "Tank gezogen (Dammann) l", "count", 14000),
  A("spray.tank_sf_l", "spray.tank_sf_l", "Tank Selbstfahrer l", "count", 12000),
  A("spray.pivot_ha", "spray.pivot_ha", "Pivot-Fläche ha (1 Kreis)", "count", 70),
  A("spray.boom48_prem", "spray.boom48_prem", "48-m-Preisaufschlag", "rate", 0.15),
  A("spray.res48_hair", "spray.res48_hair", "48-m-Restwert-Abschlag (pp)", "rate", 0.08),
  A("mprice.spray_gz", "mprice.spray_gz", "Spritze gezogen (Dammann 14.000 l)", "money", 25000000),
  A("mprice.spray_sf", "mprice.spray_sf", "Spritze Selbstfahrer (12.000 l)", "money", 56000000),

  // --- Delta 21.07. (2): Wertkultur-Maschinen bottom-up (Einsatzplanung) ---
  A("mprice.transplant", "mprice.transplant", "Tom/Gem-Pflanzmaschine (bottom-up)", "money", 9000000),
  A("mprice.tomharv", "mprice.tomharv", "Tom/Gem-Ernter (bottom-up)", "money", 45000000),
  A("val.trans_rate", "val.trans_rate", "Setzleistung ha/Tag je Pflanzmaschine", "count", 8),
  A("val.trans_win", "val.trans_win", "Setzfenster Wochen", "count", 5),
  A("val.tomh_rate", "val.tomh_rate", "Ernteleistung ha/Tag je Ernter", "count", 15),
  A("val.tomh_win", "val.tomh_win", "Erntefenster Wochen", "count", 8),
  A("val.seas_labor_ha", "val.seas_labor_ha", "Saisonarbeit €/ha (Default 0 — erst reconcilen)", "money_per_ha", 0),

  // --- Delta 21.07. (2): Einsatzplanung (Schichten, Staffelung, Stammpersonal) ---
  A("en.shifts", "en.shifts", "Schichten (1 oder 2)", "count", 2),
  A("en.shift_eff", "en.shift_eff", "Schicht-Effekt (0–1, Zweitschicht-Durchsatz)", "rate", 0.70),
  A("en.hours_day", "en.hours_day", "Feldstunden je Tag (1 Schicht)", "count", 10),
  A("en.harvest_staffel", "en.harvest_staffel", "Ernte-Staffelung (Wochen, Reifegruppen)", "count", 3),
  A("en.saat_staffel", "en.saat_staffel", "Aussaat-Staffelung (Wochen)", "count", 2),
  A("en.avail_h_year", "en.avail_h_year", "Verfügbare Feld-Betriebsstunden je Maschine & Jahr (1-Schicht)", "count", 2000),
  A("en.staff", "en.staff", "Stammpersonal (Kapazität, Personen)", "count", 45),
  // Einsatz-Flottenklassen ohne Bottom-up-Treiber: editierbare Basiszahl (× stageFactor).
  // Defaults so gewählt, dass die Einsatzplanung out-of-the-box engpassfrei ist.
  A("en.drill", "en.drill", "Sä-/Einzelkorntechnik (Einheiten, Basis)", "count", 2),
  A("en.fert", "en.fert", "Düngerstreuer (Einheiten, Basis)", "count", 2),
  A("en.combine", "en.combine", "Mähdrescher (Einheiten, Basis)", "count", 2),
  A("en.transp", "en.transp", "Transport/Hakenlift (Einheiten, Basis)", "count", 3),
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
  A("risk.irrig_outage_d", "risk.irrig_outage_d", "Beregnungsausfall in der Hitzespitze (Tage)", "count", 0, 0, 10),
  A("risk.yield_per_outage_d", "risk.yield_per_outage_d", "Ertragsverlust je Ausfalltag (Wertkultur)", "rate", 0.030),
  A("risk.outage_break_share", "risk.outage_break_share", "Ausfall-Wirkung auf Break Crops (Anteil)", "rate", 0.40),
  A("farm.intake_direct", "farm.intake_direct", "Direktentnahme Donau aktiv (0/1)", "count", 0),
  A("risk.intake_mitigation", "risk.intake_mitigation", "Redundanz-Wirkung Direktentnahme (0..1)", "rate", 0.85),
  A("irrig.norm_scale", "irrig.norm_scale", "Wassernorm-Skalierung (1,0 = Plan-mm)", "rate", 1.0),
  // Markt & Qualität — Kontrakt vs. Spot. Kontrahierte Menge ist preisfest; nur der
  //  Spot-Anteil (1 − contract_share) trägt die Spot-Delta. Break Crops sind voll spot-exponiert.
  A("market.contract_share", "market.contract_share", "Kontraktanteil Wertkulturen (0..1)", "rate", 0.80),
  A("market.spot_delta", "market.spot_delta", "Spotpreis-Delta (±)", "rate", 0),
  A("market.brix_premium", "market.brix_premium", "Brix-Prämie/-Abzug Industrietomate (±)", "rate", 0),
  A("market.potato_grade", "market.potato_grade", "Sortier-/Qualitätsprämie Kartoffel (±)", "rate", 0),
  // Logistik — Entfernung zum Abnehmer. Der €/t-Speditionssatz ist auf `dist_ref_km`
  //  kalibriert und skaliert linear mit der tatsächlichen Entfernung.
  A("transport.distance_km", "transport.distance_km", "Entfernung zum Abnehmer (km)", "count", 120),
  A("transport.dist_ref_km", "transport.dist_ref_km", "Referenz-Entfernung des €/t-Satzes (km)", "count", 120),
  // Zinsschock ADDITIV in Basispunkten-Dezimal (0,02 = +200 bps) — multiplikativ auf den
  //  EURIBOR wäre als Regler unbrauchbar (Vorzeichenwechsel bei Negativzins).
  A("macro.rate_shock", "macro.rate_shock", "Zinsschock auf EURIBOR (additiv, 0,02 = +200 bp)", "rate", 0),
  // Pflanzenschutz-Stücksatz — bis hierher teilte sich PSM den Pauschalsatz mit Material und
  //  Handarbeit, ein PSM-Regler hätte zwei fremde Kostenblöcke mitgezogen. Jetzt eigener Satz.
  A("psm.per_euro", "psm.per_euro", "Pflanzenschutz-Stücksatz (1 € = 100 ct)", "money", 100),
]);

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
        ? `Doldenblütler-Anbaupause verletzt: ${Math.round(worst * 100)} % Apiaceae (Jahr ${2026 + worstY}) > 20 %`
        : `Doldenblütler-Anbaupause OK (Apiaceae max. ${Math.round(worst * 100)} % ≤ 20 % — Sellerie + ½ Möhre)`,
      passed: worst <= DOLDEN_CAP_DEFAULT + 1e-6,
      maxDeviation: Math.max(0, worst - DOLDEN_CAP_DEFAULT),
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

const CATALOG: CatalogEntry[] = CROP_IDS.map((cropId) => ({
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
  { id: "saatbett",   label: "Saatbettkombi HORSCH Cruiser 12 XL · 12,0 m",              priceKey: "mprice.saatbett",   cat: "gezogen", neupreis: 7000000, nutzung: 10, hJ: 500, restw: 0.25, dieselLh: 18, afa: 2400, zins: 800, vers: 640, rep: 2240, schmier: 270, cEff: 9.60, fleet: 1, tractorId: "zug_9r" },
  { id: "drille",     label: "Getreidedrille HORSCH Pronto 9 DC · 9,0 m", priceKey: "mprice.drille", cat: "gezogen", neupreis: 13000000, nutzung: 12, hJ: 350, restw: 0.25, dieselLh: 14, afa: 3036, zins: 1214, vers: 971, rep: 2429, schmier: 210, cEff: 6.00, fleet: 1, tractorId: "zug_9r" },
  { id: "einzelkorn", label: "Einzelkorn HORSCH Maestro 24.50 SX · 24 R 50 cm (12,0 m)", priceKey: "mprice.einzelkorn", cat: "gezogen", neupreis: 24000000, nutzung: 12, hJ: 300, restw: 0.25, dieselLh: 12, afa: 3958, zins: 1583, vers: 1267, rep: 3167, schmier: 180, cEff: 4.02, fleet: 2, tractorId: "zug_9r" },
  // BESTAND 2× RAUCH AERO GT 36 m (pneum. Balkenstreuer) — decken die Düngung @ Stufe 1.
  { id: "streuer",    label: "Düngerstreuer Bredal K135 gezogen · 36,0 m",  priceKey: "mprice.streuer",    cat: "gezogen", neupreis: 8500000, nutzung: 10, hJ: 400, restw: 0.20, dieselLh: 10, afa: 2800, zins: 840, vers: 700, rep: 1750, schmier: 150, cEff: 18.62, fleet: 1, owned: 2, activeWhen: "base", tractorId: "ops_6r" },
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
  { id: "roder_ropa", label: "Wurzelernter ROPA Keiler 2 · 2 R (1,5 m, einphasig m. Frontkrautschläger)", priceKey: "mprice.roder_ropa", cat: "gezogen", neupreis: 22500000, nutzung: 10, hJ: 300, restw: 0.20, dieselLh: 36, afa: 5333, zins: 1600, vers: 1333, rep: 5333, schmier: 480, cEff: 0.81, fleet: 6, owned: 1, residualPctList: 0.60 },
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
  { id: "zug_9r",   label: "Zug JD 9R 590 (12-m-Boden/Saat)", priceKey: "mprice.zug_9r", cat: "selbstf", nutzung: 10, restw: 0.25, fleet: 3,
    discountPct: 0.3503, residualPctList: 0.2924, serviceRateKey: "tco.zug_8rx.service_h", serviceHoursLike: "pflug", owned: 3 },
  // Reale JD-Angebotswerte: Liste 686.447 € / Rabatt 36,05 % / Restwert 30,06 % v. Liste / Wartung 2,91 €/h.
  { id: "zug_8rx",  label: "Zug JD 8RX 410",       priceKey: "mprice.zug_8rx",  cat: "selbstf", nutzung: 10, restw: 0.25, fleet: 3,
    discountPct: 0.3605, residualPctList: 0.3006, serviceRateKey: "tco.zug_8rx.service_h", serviceHoursLike: "onepass", owned: 1 },
  // Reale JD-Angebotswerte: Liste 325.094 € (6R 250 +3 %) / Rabatt 31,75 % / Restwert 36,90 % v. Liste / Wartung 2,20 €/h.
  { id: "ops_6r",   label: "Pflege/Ernte JD 6R 260", priceKey: "mprice.ops_6r", cat: "selbstf", nutzung: 10, restw: 0.25, fleet: 3,
    discountPct: 0.3175, residualPctList: 0.3690, serviceRateKey: "tco.ops_6r.service_h", serviceHoursLike: "roder_ropa", owned: 1 },
  { id: "radlader", label: "JCB Radlader",         priceKey: "mprice.radlader", cat: "selbstf", nutzung: 10, restw: 0.25, fleet: 1, owned: 1 },
  { id: "shuttle",  label: "Field-Shuttle 8×8",    priceKey: "mprice.shuttle",  cat: "selbstf", nutzung: 8,  restw: 0.25, fleet: 9, owned: 1 },
  // Ernte-Logistik Kartoffel: Shuttles laden am Feldrand in den DEMA Fieldloader, der die LKW befüllt (→ Lager/Fabrik).
  //  Eine Verladestation je Rode-Linie → Stückzahl folgt dem Roder (s. machineFleetCount). Elektrisch, kein eigener Antrieb.
  { id: "fieldloader", label: "DEMA Fieldloader OL-COMBI (Feldrand-Überladetrichter)", priceKey: "mprice.fieldloader", cat: "gezogen", nutzung: 10, restw: 0.20, fleet: 4, owned: 0 },
  // Straßentransport/Auslieferung — BESTAND 8× (kein Neu-CAPEX; Make-or-Buy vs. Spedition via opex.transport).
  { id: "lkw_sattel", label: "LKW mit Sattelauflieger (Auslieferung)", priceKey: "mprice.lkw_sattel", cat: "selbstf", nutzung: 8, restw: 0.30, fleet: 8, owned: 8 },
];

/** Strukturierte Register-Metadaten je Maschine: Kategorie · Hersteller · Produkt. */
//  Klare Struktur nach Feld-Arbeitsfolge (Bodenbearbeitung → Aussaat/Pflanzung → Düngung →
//  Pflanzenschutz → Ernte) plus Trag-/Infrastruktur-Klassen. Kanonisch via CAT_ORDER sortiert.
const MACHINE_META: Record<string, { category: string; manufacturer: string; product: string }> = {
  zug_9r:      { category: "Zugmaschinen", manufacturer: "John Deere", product: "9R 590" },
  zug_8rx:     { category: "Zugmaschinen", manufacturer: "John Deere", product: "8RX 410" },
  ops_6r:      { category: "Zugmaschinen", manufacturer: "John Deere", product: "6R 260" },
  pflug:       { category: "Bodenbearbeitung", manufacturer: "HORSCH", product: "Fortis 6.4 LT · Universalgrubber bis 30 cm (6,20 m)" },
  saatbett:    { category: "Bodenbearbeitung", manufacturer: "HORSCH", product: "Cruiser 12 XL · Flachgrubber/Saatbett (max 15 cm)" },
  sc360:       { category: "Bodenbearbeitung", manufacturer: "Dewulf", product: "SC-Front Frontfräse (Kartoffelbeet)" },
  drille:      { category: "Aussaat & Pflanzung", manufacturer: "HORSCH", product: "Getreidedrille Pronto 9 DC · 9,0 m" },
  einzelkorn:  { category: "Aussaat & Pflanzung", manufacturer: "HORSCH", product: "Maestro 24.50 SX · 24-reihig 50 cm (12,0 m)" },
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
    cat: "selbstf", sprayPart: "sf", ownedUnits: 3,
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
    cat: "gezogen", cEff: 18.62, ownedUnits: 1, tractorId: "ops_6r",
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
  { id: "store", label: "Lager/Packhaus", unitPriceKey: "mprice.store_pert",
    category: "Gebäude & Infrastruktur", manufacturer: "—", productName: "Lager / Packhaus",
    mode: "perTonne", driver: { kind: "crops", ids: STORAGE_CROP_IDS }, assetClass: "buildings",
    afaFiscalYears: 20, afaCommercialYears: 25, insurancePct: 0.008 },
];

/* --------------------------------------------------------------------------
 * ANBAUPLAN (6-Feld-Rotation) — je Feld = beregnete Fläche ÷ 6.
 *  Kartoffel-Feld auf Pommes + Chips gesplittet.
 * ------------------------------------------------------------------------ */
export function buildAnbauplan(stage: Stage): AnbauEntry[] {
  const feld = Math.round(STAGES[String(stage)].beregneteFlaecheHa / 6);
  const pommes = Math.floor(feld / 2);
  const chips = feld - pommes;
  // Ackerbau-Break-Slot (bisher 1 Feld Soja/Luzerne) Kompendium-konform gedrittelt:
  // Soja/Luzerne · Winterraps · Körnermais (Ölsaaten-/Break-Rotation, Sclerotinia-Entzerrung).
  const sojaA = Math.round(feld / 3);
  const rapsA = Math.round(feld / 3);
  const maisA = feld - sojaA - rapsA;
  const mk = (cropId: CropId, area: number): AnbauEntry => ({
    id: `ab-${cropId}`,
    cropId,
    areaHa: area,
    plantingPeriod: CROP_CAL[cropId].plant,
    harvestPeriods: CROP_CAL[cropId].harvest.slice(),
  });
  const mkDry = (cropId: CropId, area: number): AnbauEntry => ({ ...mk(cropId, area), pool: "dryland" });
  // Unberegnete Trockenrotation (~1,5× beregnete Fläche in Süd-Dolj: 4.000 → 6.000 ha):
  //  Weizen 40 % · Gerste 35 % · Raps 25 % (Rain-fed-Varianten mit eigener Kalkulation).
  const dryBase = Math.round(STAGES[String(stage)].beregneteFlaecheHa * 1.5);
  const wDry = Math.round(dryBase * 0.40), gDry = Math.round(dryBase * 0.35), rDry = dryBase - wDry - gDry;
  // Marktanalyse 24.07.: Zwiebel/Möhre-Feld teilt sich mit den neuen Import-Substitutions-Kulturen
  //  (Celeriac läuft bereits im Betrieb; Süßkartoffel/Knoblauch als skalierbare Pilotflächen).
  const sellerie = Math.round(feld * 0.15);   // ~100 ha @ Stufe 1
  const suess = Math.round(feld * 0.075);     // ~50 ha
  const knobl = Math.round(feld * 0.075);     // ~50 ha
  const zwiebel = feld - sellerie - suess - knobl;
  return [
    mk("weizen", feld),
    mk("gerste_zw", feld),
    mk("soja_luzerne", sojaA),
    mk("winterraps", rapsA),
    mk("mais", maisA),
    mk("tomate", feld),
    mk("kartoffel_pommes", pommes),
    mk("kartoffel_chips", chips),
    mk("zwiebel_moehre", zwiebel),
    mk("knollensellerie", sellerie),
    mk("suesskartoffel", suess),
    mk("knoblauch", knobl),
    mkDry("weizen_dry", wDry),
    mkDry("gerste_dry", gDry),
    mkDry("raps_dry", rDry),
  ];
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

export function migrateDomain(dIn: Domain): Domain {
  const d = dIn && dIn.assumptions ? migrateStudio(dIn) : dIn;
  if (!d || !Array.isArray(d.anbauplan) || !Array.isArray(d.catalog)) return d;
  // Kandidaten mit Kultur-Stammdaten (Katalog/Arbeitsgänge/Assumptions), die aus SEED nachgezogen
  //  werden — inkl. Sonnenblume als Rotations-Kandidat (der Optimierer braucht ihre Kalkulation).
  const CANDIDATE_IDS: CropId[] = ["weizen_dry", "gerste_dry", "raps_dry", "sonnenblume"];
  // Nur diese werden bei fehlendem Dryland aktiv in den Anbauplan aufgenommen (Sonnenblume NICHT —
  //  sie ist Kandidat, kein Default-Rotationsglied; der Optimierer/Nutzer platziert sie bewusst).
  const DRY_IDS: CropId[] = ["weizen_dry", "gerste_dry", "raps_dry"];
  const hasDryland = d.anbauplan.some((a) => a.pool === "dryland");
  const hasAllCandidateData = CANDIDATE_IDS.every((id) => d.catalog.some((c) => c.cropId === id));
  const hasIsolde = Array.isArray(d.entities) && d.entities.some((e) => e.id === ENTITY_ISOLDE);
  if (hasDryland && hasAllCandidateData && hasIsolde) return d; // bereits migriert

  // (1) Katalog: fehlende Kandidaten-Einträge aus SEED.
  const catalog = [...d.catalog];
  for (const id of CANDIDATE_IDS) {
    if (!catalog.some((c) => c.cropId === id)) {
      const seedCat = SEED.catalog.find((c) => c.cropId === id);
      if (seedCat) catalog.push(seedCat);
    }
  }
  // (2) Arbeitsgänge: fehlende Kandidaten-Programme aus SEED.
  const arbeitsgaenge: Record<string, Arbeitsgang[]> = { ...(d.arbeitsgaenge ?? {}) };
  for (const id of CANDIDATE_IDS) if (!arbeitsgaenge[id] && SEED.arbeitsgaenge[id]) arbeitsgaenge[id] = SEED.arbeitsgaenge[id];
  // (3) Assumptions: fehlende Kandidaten-Schlüssel (yield./price./loss./qual./seed.<id>) aus SEED.
  const assumptions: Record<string, Assumption> = { ...(d.assumptions ?? {}) };
  for (const [k, v] of Object.entries(SEED.assumptions)) {
    if (!assumptions[k] && CANDIDATE_IDS.some((id) => k.endsWith("." + id))) assumptions[k] = v;
  }
  // (4) Anbauplan: native Trockeneinträge anhängen, falls keine vorhanden.
  let anbauplan = d.anbauplan;
  if (!hasDryland) {
    const irrHa = d.anbauplan.filter((a) => a.pool !== "dryland").reduce((s, a) => s + a.areaHa, 0);
    const dryBase = Math.round(irrHa * 1.5);
    const wDry = Math.round(dryBase * 0.40), gDry = Math.round(dryBase * 0.35), rDry = dryBase - wDry - gDry;
    const mkDry = (cropId: CropId, area: number): AnbauEntry => ({
      id: `ab-${cropId}`, cropId, areaHa: area,
      plantingPeriod: CROP_CAL[cropId].plant, harvestPeriods: CROP_CAL[cropId].harvest.slice(), pool: "dryland",
    });
    anbauplan = [...d.anbauplan, mkDry("weizen_dry", wDry), mkDry("gerste_dry", gDry), mkDry("raps_dry", rDry)];
  }
  // (5) Entity-Register: Isolde (Cash-Crop-Gesellschaft) nachziehen, falls sie fehlt.
  const entities = Array.isArray(d.entities) && d.entities.length ? [...d.entities] : ENTITIES.slice();
  if (!entities.some((e) => e.id === ENTITY_ISOLDE)) {
    const seedIsolde = ENTITIES.find((e) => e.id === ENTITY_ISOLDE);
    if (seedIsolde) entities.push(seedIsolde);
  }
  return { ...d, catalog, arbeitsgaenge, assumptions, anbauplan, entities };
}

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
const CAPEX_PLAN_SEED: CapexPlanItem[] = [
  // — Bewässerung / Wasser-Infrastruktur (assetClass irrigation; AFIR 25 % möglich) —
  cp("bw-pivot", "bewaesserung", "Center-Pivot-Systeme (Valley/Reinke/Bauer)", "technik", "perHa", 16000, "ha", 1600, 12, { fkQuote: 0.5, subventionPct: 0.25, ...bench(1200, 2000), quelle: "Farmonaut 2026", notiz: "Ausbau 4.000 → 20.000 ha beregnet" }),
  cp("bw-main", "bewaesserung", "Verrohrung / Mainlines (unterirdisch)", "infrastruktur", "perHa", 16000, "ha", 500, 18, { subventionPct: 0.25, ...bench(300, 700) }),
  cp("bw-pump", "bewaesserung", "Pumpstationen (Pumpe, FU, Gebäude)", "technik", "perStueck", 40, "Stück", 60000, 12, { ...bench(30000, 90000) }),
  cp("bw-well", "bewaesserung", "Brunnen / Bohrungen", "infrastruktur", "perStueck", 40, "Stück", 30000, 25, { ...bench(15000, 45000) }),
  cp("bw-res", "bewaesserung", "Wasserspeicher / Reservoir (foliert)", "bau", "perM3", 500000, "m³", 10, 25, { ...bench(6, 15) }),
  cp("bw-filt", "bewaesserung", "Filtration + Fertigation (Kopfstation)", "technik", "perStueck", 40, "Stück", 45000, 12, { ...bench(20000, 70000) }),
  cp("bw-power", "bewaesserung", "Elektrifizierung / MS-Anschluss / Trafo", "infrastruktur", "fix", 1, "pauschal", 1500000, 18, { notiz: "größter Unsicherheitsposten — mit Angebot kalibrieren" }),
  cp("bw-scada", "bewaesserung", "SCADA / Fernsteuerung", "elektronik", "perStueck", 40, "Stück", 1500, 6, { ...bench(500, 2000) }),
  // — Lager (Kartoffel + Zwiebel/Möhre; Tomate NICHT) (assetClass buildings) —
  cp("lg-bulk", "lager", "Schüttlager Kartoffel, belüftet (ambient)", "bau", "perTonne", 45000, "t", 160, 22, { ...bench(120, 200) }),
  cp("lg-cool", "lager", "Kühl-/CA-Lager Kartoffel", "technik", "perTonne", 20000, "t", 320, 20, { ...bench(250, 550) }),
  cp("lg-cure", "lager", "Zwiebel-Trocknung / Curing", "technik", "perTonne", 20000, "t", 200, 20, { ...bench(150, 250) }),
  cp("lg-shell", "lager", "Gebäudehülle Lager (Stahl, isoliert)", "bau", "perM2", 8000, "m²", 500, 25, { ...bench(350, 800) }),
  // — Packhaus / Aufbereitungslinien (assetClass buildings, kurze AfA) —
  cp("pk-line", "packhaus", "Verpackungslinie Kartoffel (20 t/h)", "technik", "perStueck", 1, "Linie", 1200000, 10, { ...bench(500000, 2000000), quelle: "LONKIA 2026" }),
  cp("pk-optic", "packhaus", "Optische Sortierung / Grading", "technik", "perStueck", 1, "Modul", 150000, 10, { ...bench(80000, 250000) }),
  cp("pk-wash", "packhaus", "Annahme / Waschen / Wasseraufbereitung", "technik", "perStueck", 1, "Modul", 80000, 10, { ...bench(25000, 100000) }),
  cp("pk-pal", "packhaus", "Palettierung (halbautomatisch)", "technik", "perStueck", 1, "Stück", 120000, 10, { ...bench(60000, 250000) }),
  cp("pk-onion", "packhaus", "Verpackungslinie Zwiebel/Möhre", "technik", "perStueck", 1, "Linie", 400000, 10, { ...bench(200000, 800000) }),
  // — Maschinen & Fahrzeuge (Jahres-Planung): NUR für Positionen, die NICHT im Register/Bedarf−Bestand
  //  stehen — sonst Doppelzählung (LKW/Radlader etc. existieren dort bereits). IoT/FMS lebt HIER
  //  (aus dem Maschinenkatalog hierher verschoben; Block ist per Default AKTIV, damit es zählt).
  cp("ma-iot", "maschinen", "Sensorik · Telemetrie · Farm-Management-System", "elektronik", "fix", 1, "pauschal", 400000, 6, { jahr: 0, fkQuote: 0, restwertPct: 0.1, kategorie: "iot", notiz: "IoT/Digitalisierung — Netto nach Rabatt (Liste 500k)" }),
  // — Gebäude & allgemeine Infrastruktur (assetClass buildings) —
  cp("gb-hall", "gebaeude", "Maschinenhalle (Stahl, kalt)", "bau", "perM2", 6000, "m²", 350, 25, { jahr: 0, ...bench(250, 450) }),
  cp("gb-shop", "gebaeude", "Werkstatt (isoliert, Grube, Kran)", "bau", "perM2", 800, "m²", 700, 25, { jahr: 0, ...bench(500, 900) }),
  cp("gb-fuel", "gebaeude", "Diesel-Tankanlage (doppelwandig)", "technik", "perStueck", 1, "Stück", 80000, 12, { jahr: 0, ...bench(30000, 120000) }),
  cp("gb-office", "gebaeude", "Sozial- / Bürogebäude", "bau", "perM2", 600, "m²", 1100, 30, { jahr: 0, ...bench(700, 1400) }),
  cp("gb-silo", "gebaeude", "Getreide-Silos (Stahl, inkl. Technik)", "bau", "perTonne", 20000, "t", 120, 20, { ...bench(65, 180), quelle: "Agri-Systems 2026" }),
  cp("gb-yard", "gebaeude", "Hofbefestigung / Wege (Beton)", "infrastruktur", "perM2", 20000, "m²", 50, 18, { jahr: 0, ...bench(30, 80) }),
  cp("gb-scale", "gebaeude", "Wiegebrücke 60 t (geeicht)", "technik", "perStueck", 1, "Stück", 45000, 15, { jahr: 0, ...bench(25000, 60000) }),
  cp("gb-pv", "gebaeude", "PV-Anlage Eigenstrom", "technik", "perKWp", 1000, "kWp", 900, 20, { ...bench(700, 1100) }),
  cp("gb-fence", "gebaeude", "Umzäunung / Sicherheit (Zaun, Tore, Kameras)", "infrastruktur", "perLfm", 5000, "lfm", 50, 12, { jahr: 0, ...bench(30, 80) }),
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
    objectIds: ["zug_8rx", "ops_6r", "maehdr"],
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
    objectIds: ["irrig", "store", "spray_gz", "spray_sf"],
    drawPeriod: 0, avansRate: 0.20, residualRate: 0.0, termMonths: 120,
    rateBasis: "floating", referenceRateKey: "macro.euribor", floatingSpread: 0.032,
    frequency: "monthly", repayment: "annuity",
    currency: "EUR", vatRate: 0.21,
    feeAnalysisCent: 0, feeAdminRate: 0.005, prepaymentRate: 0.01,
    ifrs16RightOfUse: false, active: true,
  },
];

const REVOLVER: RevolverFacility = {
  // Funding-Linie deckt Saison-WC + CAPEX-/Avans-/USt-Timing über den Ramp; großzügig
  // dimensioniert, damit der Peak-Bedarf sichtbar wird (Dashboard „Peak Revolver-Bedarf"),
  // ohne die Kasse ins Negative zu treiben.
  limit: 24500000000, rateBasis: "floating", floatingSpread: 0.032,
  referenceRateKey: "macro.euribor", minCashTarget: 0,
};

const WORKING_CAPITAL: WorkingCapitalPolicy = {
  dsoAssumptionKey: "wc.dso",
  dpoAssumptionKey: "wc.dpo",
  inventoryDaysAssumptionKey: "wc.inv",
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
  { id: "s-biss", name: "BISS — Basisprämie (Sprijin de bază)", basis: "per_ha", ratePerHaCent: 10066,
    pillar: 1, category: "biss", receiptPeriods: [11], payout: CAP_PAYOUT, active: true },
  { id: "s-criss", name: "CRISS — umverteilende Prämie (erste 50 ha)", basis: "per_ha", ratePerHaCent: 5300,
    firstHaCap: 50, pillar: 1, category: "criss", receiptPeriods: [11], payout: CAP_PAYOUT, active: true },
  { id: "s-eco", name: "Öko-Regelungen / Eco-Schemes (PD, Ø)", basis: "per_ha", ratePerHaCent: 7000,
    pillar: 1, category: "eco", receiptPeriods: [11], payout: CAP_PAYOUT, active: true },
  // — VCP / Gekoppelte Stützung (Voluntary Coupled Payments · Sprijin Cuplat Vegetal) — KULTURSPEZIFISCH —
  { id: "vcp-tomate", name: "VCP — Industrietomate (Freilandgemüse)", basis: "per_ha", ratePerHaCent: 160700,
    cropIds: ["tomate"], pillar: 1, category: "vcp", receiptPeriods: [11], payout: CAP_PAYOUT, active: true },
  { id: "vcp-zwiebel", name: "VCP — Zwiebel / Möhre (Freilandgemüse)", basis: "per_ha", ratePerHaCent: 160700,
    cropIds: ["zwiebel_moehre"], pillar: 1, category: "vcp", receiptPeriods: [11], payout: CAP_PAYOUT, active: true },
  { id: "vcp-gemuese-neu", name: "VCP — Sellerie / Süßkartoffel (Freilandgemüse)", basis: "per_ha", ratePerHaCent: 160700,
    cropIds: ["knollensellerie", "suesskartoffel"], pillar: 1, category: "vcp", receiptPeriods: [11], payout: CAP_PAYOUT, active: true },
  { id: "vcp-knoblauch", name: "VCP — Knoblauch (Sprijin cuplat usturoi)", basis: "per_ha", ratePerHaCent: 160700,
    cropIds: ["knoblauch"], pillar: 1, category: "vcp", receiptPeriods: [11], payout: CAP_PAYOUT, active: true },
  { id: "vcp-soja", name: "VCP — Soja (Eiweißpflanzen)", basis: "per_ha", ratePerHaCent: 20000,
    cropIds: ["soja_luzerne"], pillar: 1, category: "vcp", receiptPeriods: [11], payout: CAP_PAYOUT, active: true },
  { id: "vcp-kartoffel", name: "VCP — Verarbeitungskartoffel (falls berechtigt)", basis: "per_ha", ratePerHaCent: 0,
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

// Reine Verwaltungsholding (Zypern) OHNE eigenen Geschäftsbetrieb: laufende Kosten für
// Substanz (Management & Control in CY → Steuerresidenz), Compliance & Governance.
// Werte €/Monat (CENT), editierbar. CY-Kalibrierung 2026.
const HC = (id: string, label: string, monthlyEur: number) => ({ id, label, monthlyCent: Math.round(monthlyEur * 100) });
const HOLDING: HoldingPlan = {
  name: "NEOS Holding Ltd",
  costItems: [
    // — Governance & Organe (Substanz) —
    HC("h-board", "Verwaltungsrat / Directors (inkl. lokale CY-Directors, Substanz)", 1500),
    HC("h-secretary", "Company Secretary (CY-Pflicht)", 40),
    HC("h-domizil", "Registered Office / Domizil & Agent", 40),
    HC("h-do", "D&O-Versicherung", 167),
    HC("h-substance", "Substanz / lokale Präsenz (Büro, Board-Meetings CY)", 300),
    HC("h-staff", "Lokales Personal / Payroll (Substanz, optional — brutto inkl. CY-Abgaben)", 0),
    // — Compliance & Reporting —
    HC("h-audit", "Statutory Audit (CY-Pflicht)", 120),
    HC("h-account", "Buchhaltung / Accounting", 150),
    HC("h-tax", "Steuer-Compliance / CIT-Erklärung", 70),
    HC("h-levy", "Annual Levy (Registrar) & Filings (HE32/UBO)", 30),
    HC("h-aml", "AML / KYC / Compliance", 50),
    // — Legal & Struktur —
    HC("h-legal", "Legal & Corporate Governance", 100),
    HC("h-tp", "Transfer-Pricing-Dokumentation (IC-Fee/Darlehen)", 250),
    // — Banking & IT —
    HC("h-bank", "Bankgebühren / Kontoführung", 50),
    HC("h-it", "IT / Kommunikation", 80),
  ],
  managementFeeKey: "hold.fee",
  taxRateKey: "hold.taxrate",
  dividendWithholdingKey: "hold.wht",
};

// Multi-Entity-Register (Startbestand) — CUI per ANAF-Lookup befüllbar/prüfbar.
//  Struktur: CY-Holding hält 100 % der RO-OpCo; PropCo (Eigentumsflächen) für Pacht-Modell.
const ENTITIES: Entity[] = [
  { id: "ent-holding", name: "NEOS Holding Ltd", role: "holding", country: "CY", ownershipPct: 100, cui: "", note: "Konzernmutter · Management & Control (Substanz CY)" },
  { id: "ent-opco", name: "NEOTERRA SRL", role: "opco", country: "RO", ownershipPct: 100, cui: "", note: "Betriebsgesellschaft · Anbau & Vermarktung (Măceșu de Jos)" },
  { id: "ent-propco", name: "NEOTERRA Land SRL", role: "propco", country: "RO", ownershipPct: 100, cui: "", note: "Besitzgesellschaft · Eigentumsflächen (Pacht an OpCo)" },
  { id: "ent-isolde", name: "Isolde Farms SRL", role: "opco", country: "RO", ownershipPct: 100, cui: "", note: "Betriebsgesellschaft · Cash-Crop-/Trockenrotation (Getreide/Raps/Sonnenblume)" },
];

/** Operative Anbau-Entities (Kultur-Split). NEOTERRA-OpCo = Wertkulturen (Hauptentity),
 *  Isolde = Cash-/Trockenrotation. Default-Zuordnung, im Register frei überschreibbar. */
export const ENTITY_NEOTERRA = "ent-opco";
export const ENTITY_ISOLDE = "ent-isolde";
/** Standard-Gesellschaft einer Kultur (falls kein explizites entityId gesetzt): Value → NEOTERRA,
 *  Cash/Trockenrotation → Isolde. */
export function defaultEntityOf(cropId: string): string {
  return VALUE_CROP_IDS.includes(cropId) ? ENTITY_NEOTERRA : ENTITY_ISOLDE;
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
const OPENING_BALANCE: OpeningBalance = {
  cash: 500000000, land: 4000000000, ppeNet: 2000000000, inventory: 300000000, receivables: 200000000,
  payables: 300000000, debt: 0, shareCapital: 6000000000, retainedEarnings: 700000000,
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
  OV(LOG, "Auslieferung / Fracht zum Handel (OpEx)", 4000),
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
    active: true,
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
    active: true,
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
    active: true,
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
export const SEED: Domain = {
  meta: { id: "neos-fx", name: "NEOTERRA · Eigenmechanisierung (Stufe 1, 4.000 ha beregnet)", reportingCurrency: "EUR" },
  stage: 1,
  scope: "full",
  timeline: TIMELINE,
  scenarios: SCENARIOS,
  baseScenarioId: base,
  assumptions: ASSUMPTIONS,
  catalog: CATALOG,
  machineCatalog: MACHINE_CATALOG,
  anbauplan: buildAnbauplan(1),
  arbeitsgaenge: ARBEITSGAENGE,
  decisions: { transportToBuyer: "own" },
  debt: DEBT,
  financingContracts: FINANCING_CONTRACTS,
  revolver: REVOLVER,
  workingCapital: WORKING_CAPITAL,
  tax: TAX,
  vat: VAT,
  subsidies: SUBSIDIES,
  personnel: PERSONNEL,
  holding: HOLDING,
  entities: ENTITIES,
  consolidation: { active: false }, // opt-in: Konzern-Sicht erst per Schalter im Register einblenden
  openingBalance: OPENING_BALANCE,
  biologicalAssets: BIO,
  overhead: SEED_OVERHEAD,
  growth: GROWTH,
  standort: { name: "Măceșu de Jos · Süd-Dolj (Oltenien)", rainfallMm: 550, soil: "chernozem", summerHeat: "hoch" },
  // Kultur-Skalierungspolitik: Kartoffel PRIO 1 — schnellstmöglich auf 3.000 ha (2×1.500), aber
  //  gedeckelt auf 25 % der beregneten Fläche (4-J-Anbaupause). Tomate FIX auf heutiger Fläche
  //  (~59 kt ≈ kontrahierbare Menge EINES mittelgroßen Werks — nicht mit der Fläche skalieren).
  //  Alle übrigen Kulturen füllen die Rotation proportional (Residual).
  cropPolicy: {
    kartoffel_pommes: { mode: "ramp", targetHa: 1500 },
    kartoffel_chips: { mode: "ramp", targetHa: 1500 },
    tomate: { mode: "fix" },
    // Marktanalyse 24.07.: Absatzobergrenzen (Import-Substitution + Marktführer-Anteil, editierbar).
    //  Zwiebel/Möhre ~60 kt (statt 225 kt!), Knollensellerie ~22 kt (HS-070690-Pool).
    zwiebel_moehre: { mode: "scale", capTonnes: 60000 },
    knollensellerie: { mode: "scale", capTonnes: 22000 },
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
  capexPlanActive: { maschinen: true },
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
    cash: { areaHa: 6000, passes: 4, cEffBaseHaH: 24.1, windowDays: 10, hoursDay: 16, sprayerCapexCent: 40000000, operatorYearCent: 5000000 },
  },
  transport: { ...TRANSPORT_DEFAULT },
  // Pacht: ~2.500 ha Eigentum der Besitzgesellschaft, an die OpCo verpachtet. Süd-Dolj-Arendă
  //  ~300 €/ha, Index-Stufe +8 % alle 5 Jahre (≈ 1,5 %/Jahr CPI-nah). Editierbar im Simulator.
  pacht: { ownedHa: 2500, baseRentPerHaCent: 30000, indexPct: 0.08, intervalYears: 5, indexBasis: "cpi",
    indexSteps: [{ atYear: 5, pct: 0.08 }, { atYear: 10, pct: 0.08 }, { atYear: 15, pct: 0.08 }],
    ifrs16: true, leaseTermYears: 15, discountRate: 0.05,
    payMonths: [{ month: 8, share: 0.6 }, { month: 10, share: 0.4 }] },
  // Tornado-Zeilen referenzieren die Treiber-Bibliothek des Szenario-Studios.
  // Trockenjahr / Preisverfall Kartoffel / Zins- & Kostenschock sind dort als
  // eingebaute Szenarien hinterlegt — hier stehen nur eigene Szenarien.
  sensitivity: {
    tornado: [
      { id: "priceValue", delta: 0.15 }, { id: "yieldValue", delta: 0.10 }, { id: "qualValue", delta: 0.08 },
      { id: "priceRot", delta: 0.15 }, { id: "price.diesel_l", delta: 0.20 }, { id: "fertAll", delta: 0.20 },
      { id: "wageAll", delta: 0.15 }, { id: "macro.euribor", delta: 0.30 }, { id: "subsidy.coupled_freilandgemuese", delta: 0.20 },
    ],
    scenarios: [],
  },
  offtake: OFFTAKE_SEED,
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
export function machineOpCostPerHaCent(domain: Domain, cropId: string, scenarioId: string): number {
  const dieselPriceCent = resolveScalar(domain, "price.diesel_l", scenarioId);
  const bf = sprayBoomFactor(domain, scenarioId); // 48-m-Paket: breiteres Gestänge → weniger Spritz-Std/ha
  const byId = new Map(domain.machineCatalog.map((m) => [m.id, m]));
  const gaenge = domain.arbeitsgaenge[cropId] ?? [];
  let cent = 0;
  for (const g of gaenge) {
    const m = byId.get(g.m);
    if (!m || !m.cEff) continue;
    // Spritze: effektive C_eff skaliert mit der Gestängebreite (36 m → 48 m = +33 % ha/h).
    const cEff = m.id === "spritze14" ? m.cEff * bf : m.cEff;
    const opPerHourCent =
      (m.insurancePerHourCent ?? 0) +
      (m.repairPerHourCent ?? 0) +
      (m.lubePerHourCent ?? 0) +
      (m.dieselLPerHour ?? 0) * dieselPriceCent;
    cent += (g.passes / cEff) * opPerHourCent;
  }
  return cent; // CENT/ha
}

/** Maschinen-Fixkosten (AfA + kalk. Zins) je ha in CENT aus den Arbeitsgängen:
 *  Σ passes / C_eff × (AfA+Zins)€/h. Entspricht machineFull − machineOp (§3-Reconciliation). */
export function machineAfaZinsPerHaCent(domain: Domain, cropId: string, scenarioId: string): number {
  const byId = new Map(domain.machineCatalog.map((m) => [m.id, m]));
  const gaenge = domain.arbeitsgaenge[cropId] ?? [];
  let cent = 0;
  for (const g of gaenge) {
    const m = byId.get(g.m);
    if (!m || !m.cEff) continue;
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
export function deriveCropMassnahmen(domain: Domain, cropId: string, scenarioId: string): CropCalc {
  const entry = domain.catalog.find((c) => c.cropId === cropId);
  const dieselPrice = resolveScalar(domain, "price.diesel_l", scenarioId);
  const bf = sprayBoomFactor(domain, scenarioId);
  const byId = new Map(domain.machineCatalog.map((m) => [m.id, m]));
  const gaenge = domain.arbeitsgaenge[cropId] ?? [];
  const areaHa = domain.anbauplan.filter((a) => a.cropId === cropId).reduce((s, a) => s + a.areaHa, 0);
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
  for (const key of Object.keys(domain.assumptions)) {
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
function machineHoursPerYear(domain: Domain, machineId: string): number {
  const m = domain.machineCatalog.find((x) => x.id === machineId);
  if (!m || !m.cEff) return 0;
  let h = 0;
  for (const a of domain.anbauplan) {
    const g = (domain.arbeitsgaenge[a.cropId] ?? []).find((x) => x.m === machineId);
    if (g) h += (g.passes * a.areaHa) / m.cEff;
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

/** Intercompany-Maschinenmiete (CENT/Jahr): für jede Maschine mit rentedUnits > 0 laufen die
 *  gemieteten Einheiten NICHT über CAPEX, sondern stundenbasiert als Miet-OPEX.
 *   Miete = gemietete Stück × (Maschinenstunden/Jahr ÷ benötigte Flotte) × Satz€/h;
 *   Satz€/h = (AfA/h + Service/h) × (1 + machine.rent_markup) — Stundenkosten × Aufschlag. */
export function machineRentAnnualCent(domain: Domain, scenarioId: string, lessorId?: string): number {
  const markup = 1 + resolveScalar(domain, "machine.rent_markup", scenarioId);
  let cent = 0;
  for (const m of domain.machineCatalog) {
    const rentedReq = Math.round(m.rentedUnits ?? 0);
    if (m.mode !== "fixedFleet" || rentedReq <= 0) continue;
    // Verleiher-Filter (explizite Mietrichtung): nur Maschinen zählen, deren rentedFrom == lessorId
    //  (fehlt → Default-Verleiher Isolde). Ohne lessorId: gesamte Miete (Mieter-Sicht/Elimination).
    if (lessorId && (m.rentedFrom ?? ENTITY_ISOLDE) !== lessorId) continue;
    const required = machineFleetCount(domain, m, scenarioId);
    const owned = Math.max(0, Math.round(m.ownedUnits ?? 0));
    const rented = Math.max(0, Math.min(rentedReq, Math.max(0, required - owned)));
    if (rented <= 0 || required <= 0) continue;
    const hoursTotal = serviceHoursPerYear(domain, m);              // Ist-Stunden der Flotte (cEff/Träger)
    const hoursPerUnit = hoursTotal / required;
    const afaH = m.afaPerHourCent ?? 0;                             // AfA €/h (CENT)
    const serviceH = m.serviceRateKey ? resolveScalar(domain, m.serviceRateKey, scenarioId) : 0;
    const ratePerH = (afaH + serviceH) * markup;                   // Stundenkosten × Aufschlag
    cent += rented * hoursPerUnit * ratePerH;
  }
  return Math.round(cent);
}

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

export function deriveSprayFleet(domain: Domain, scenarioId: string): SprayFleet {
  const tf = shiftFactorOf(domain, scenarioId);
  const bf = sprayBoomFactor(domain, scenarioId); // 48-m-Paket: breiteres Gestänge → weniger Spritzen
  const weekly: number[] = new Array(53).fill(0);
  const areaByCrop = new Map<string, number>();
  for (const a of domain.anbauplan) areaByCrop.set(a.cropId, (areaByCrop.get(a.cropId) ?? 0) + a.areaHa);
  for (const [cropId, w] of Object.entries(SPRAY_WINDOWS)) {
    const area = areaByCrop.get(cropId) ?? 0;
    if (area <= 0) continue;
    const u = Math.max(1, Math.ceil(area / (w.rate * bf * tf * 6)));
    for (let k = w.kwS; k <= w.kwE; k++) weekly[k] += u;
  }
  let peakWeek = 0, peakDemand = 0;
  for (let k = 1; k <= 52; k++) if (weekly[k] > peakDemand) { peakDemand = weekly[k]; peakWeek = k; }
  const total = Math.max(0, peakDemand);
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
  if (m.id === "krautschl") {
    const rod = domain.machineCatalog.find((x) => x.id === "roder_ropa");
    return rod ? machineFleetCount(domain, rod, scenarioId) : Math.ceil((m.fleetStage1 ?? 0) * stageFactorOf(domain.stage));
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
    const f = deriveSprayFleet(domain, scenarioId);
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
  const storeShare = (cropId: string): number => {
    const k = `store.share.${cropId}`;
    return domain.assumptions[k] ? Math.max(0, Math.min(1, resolveScalar(domain, k, scenarioId))) : 1;
  };
  const driverTonnes = (drv: MachineDriver): number => {
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
    if (m.id === "store" && planActive.lager) continue;
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
      amount = Math.round(unitPrice * tonnes);
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
export function derivePersonnelProposal(domain: Domain, scenarioId: string): PersonnelProposal {
  const availH = resolveScalar(domain, "en.avail_h_year", scenarioId) || 2000;
  const totalArea = domain.anbauplan.reduce((s, a) => s + a.areaHa, 0);
  const areaByCrop = new Map<string, number>();
  for (const a of domain.anbauplan) areaByCrop.set(a.cropId, (areaByCrop.get(a.cropId) ?? 0) + a.areaHa);
  const valueCropHa = ["tomate", "kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre"]
    .reduce((s, c) => s + (areaByCrop.get(c) ?? 0), 0);

  // Feld-Fahrerstunden: Σ Ist-Stunden aller Feldmaschinen (Arbeitsgänge). Ein Gespann = 1 Fahrer.
  let fieldHours = 0, machineCount = 0;
  for (const m of domain.machineCatalog) {
    if (m.mode !== "fixedFleet") continue;
    machineCount += machineFleetCount(domain, m, scenarioId);
    fieldHours += machineHoursPerYear(domain, m.id); // nur cEff-Maschinen liefern > 0
  }
  // Peak-Deckung: Saison-Ballung → nur ~62 % der Jahresstunden je Fahrer nutzbar für Feldarbeit.
  const drivers = Math.max(1, Math.ceil(fieldHours / (availH * 0.62)));

  const lkwCount = (() => { const m = domain.machineCatalog.find((x) => x.id === "lkw_sattel"); return m ? machineFleetCount(domain, m, scenarioId) : 0; })();
  const logistik = Math.max(0, Math.ceil(lkwCount * 1.2)); // Schicht-/Reservefaktor
  const irrigatedHa = totalArea; // Stufe 1: Anbauplan = beregnete Fläche

  const recommend: Record<string, number> = {
    "pers.leitung.n": Math.max(2, Math.round(2 + totalArea / 8000)),
    "pers.stamm.n": drivers,
    "pers.bewaesserung.n": Math.max(2, Math.round(irrigatedHa / 1100)),
    "pers.lager.n": Math.max(2, Math.round(valueCropHa / 320)),
    "pers.service.n": Math.max(1, Math.round(machineCount / 6)),
    "pers.saison.n": Math.round((valueCropHa / 170) * 10) / 10,
    "pers.prakt.n": Math.max(2, Math.round(totalArea / 1600)),
  };
  const dailyPeak = Math.round(valueCropHa * 0.9); // Ernte-Spitze Tagelöhner (in COGS)
  return { recommend, info: { fieldHours: Math.round(fieldHours), machineCount, drivers, irrigatedHa, valueCropHa, lkwCount, logistik, dailyPeak } };
}

/* --------------------------------------------------------------------------
 * deriveMachineTCO — Maschinen-Vollkosten / TCO je Maschine (Anzeige).
 *  Fix (Flotte/Jahr): AfA (Neupreis×(1−Restw)/Nutzung) + kalk. Zins (Ø geb. Kapital × 4 %).
 *  Variabel €/h: Wartung/Vers/Rep/Schmier + Diesel + Fahrer + optional Service.
 *  hoursPerYear = Ist-Stunden aus den Arbeitsgängen (Referenz C). Alle Werte CENT.
 * ------------------------------------------------------------------------ */
export function deriveMachineTCO(domain: Domain, scenarioId: string): TCOBreakdown[] {
  const derived = deriveCapex(domain, scenarioId);
  const dById = new Map(derived.map((d) => [d.machineId, d]));
  const dieselPerL = resolveScalar(domain, "price.diesel_l", scenarioId);
  const operatorPerH = resolveScalar(domain, "rate.labor_h", scenarioId);

  const out: TCOBreakdown[] = [];
  for (const m of domain.machineCatalog) {
    const d = dById.get(m.id);
    const amount = d?.amount ?? 0;   // CENT, Flotte gesamt
    const count = d?.count ?? 0;

    if (m.mode === "fixedFleet") {
      const neupreis = machineUnitPriceCent(domain, m, scenarioId);
      const restw = m.restwertPct ?? 0;
      const yrs = m.nutzungYears ?? m.afaCommercialYears;
      const afa = yrs > 0 ? count * (neupreis * (1 - restw)) / yrs : 0;
      const interest = count * (neupreis * (1 + restw) / 2) * 0.04;
      const insurance = 0; // Vers ist Betriebskosten (variabel), nicht fix
      const fixedTotal = afa + interest + insurance;

      // Service-Stunden: eigene Arbeitsgang-Stunden, sonst die des gekoppelten Anbaugeräts.
      const hoursPerYear = serviceHoursPerYear(domain, m);
      const isCarrier = !m.cEff; // CAPEX-only Zugschlepper (Diesel/Fahrer im Anbaugerät gefaltet)
      let variablePerHour = { service: 0, repair: 0, diesel: 0, operator: 0, total: 0 };
      let eurPerHour: number | null = null;
      let eurPerHa: number | null = null;
      if (hoursPerYear > 0) {
        const service = m.serviceRateKey ? resolveScalar(domain, m.serviceRateKey, scenarioId) : 0;
        // Träger zeigen NUR Fix + Service (Diesel/Rep/Fahrer stecken im Anbaugerät → kein Doppelzählen).
        const repair = isCarrier ? 0 : (m.repairPerHourCent ?? 0) + (m.insurancePerHourCent ?? 0) + (m.lubePerHourCent ?? 0);
        const diesel = isCarrier ? 0 : (m.dieselLPerHour ?? 0) * dieselPerL;
        const operator = isCarrier ? 0 : operatorPerH;
        const total = service + repair + diesel + operator;
        variablePerHour = { service, repair, diesel, operator, total };
        eurPerHour = fixedTotal / hoursPerYear + total;
        eurPerHa = m.cEff ? eurPerHour / m.cEff : null;
      }

      out.push({
        machineId: m.id, label: m.label, count, assetClass: m.assetClass,
        hoursPerYear: hoursPerYear > 0 ? hoursPerYear : null,
        fixedPerYear: { afa, interest, insurance, total: fixedTotal },
        variablePerHour, eurPerHour, eurPerHa, serviceRateKey: m.serviceRateKey,
      });
    } else {
      // Beregnung / Lager — nur Fixkosten (AfA + kalk. Zins + Versicherung), kein Stundenbezug.
      const yrs = m.afaCommercialYears;
      const afa = yrs > 0 ? (amount * 0.9) / yrs : 0;
      const interest = amount * 0.02;
      const insurance = amount * (m.insurancePct ?? 0);
      const fixedTotal = afa + interest + insurance;
      out.push({
        machineId: m.id, label: m.label, count, assetClass: m.assetClass,
        hoursPerYear: null,
        fixedPerYear: { afa, interest, insurance, total: fixedTotal },
        variablePerHour: { service: 0, repair: 0, diesel: 0, operator: 0, total: 0 },
        eurPerHour: null, eurPerHa: null, serviceRateKey: m.serviceRateKey,
      });
    }
  }
  return out;
}

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
  { cropId: "weizen", label: "Aussaat Weizen", cls: "drill", kwS: 40, kwE: 43, rate: 60, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "weizen", label: "N-Düngung Weizen", cls: "fert", kwS: 8, kwE: 14, rate: 90, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "weizen", label: "PSM Weizen", cls: "spray", kwS: 15, kwE: 21, rate: 220, mode: "repeat", laborPerUnit: 1, hand: 0 },
  { cropId: "weizen", label: "Ernte Weizen", cls: "combine", kwS: 27, kwE: 30, rate: 28, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "gerste_zw", label: "Aussaat Gerste", cls: "drill", kwS: 39, kwE: 42, rate: 55, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "gerste_zw", label: "Düngung Gerste", cls: "fert", kwS: 8, kwE: 14, rate: 85, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "gerste_zw", label: "PSM Gerste", cls: "spray", kwS: 14, kwE: 20, rate: 220, mode: "repeat", laborPerUnit: 1, hand: 0 },
  { cropId: "gerste_zw", label: "Ernte Gerste", cls: "combine", kwS: 26, kwE: 29, rate: 26, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "soja_luzerne", label: "Aussaat Soja/Luzerne", cls: "drill", kwS: 16, kwE: 19, rate: 45, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "soja_luzerne", label: "PSM Soja/Luzerne", cls: "spray", kwS: 22, kwE: 26, rate: 220, mode: "repeat", laborPerUnit: 1, hand: 0 },
  { cropId: "soja_luzerne", label: "Ernte Soja/Luzerne", cls: "combine", kwS: 39, kwE: 42, rate: 30, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "winterraps", label: "Aussaat Winterraps", cls: "drill", kwS: 35, kwE: 38, rate: 50, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "winterraps", label: "Düngung Winterraps", cls: "fert", kwS: 8, kwE: 14, rate: 90, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "winterraps", label: "PSM Winterraps", cls: "spray", kwS: 14, kwE: 20, rate: 220, mode: "repeat", laborPerUnit: 1, hand: 0 },
  { cropId: "winterraps", label: "Ernte Winterraps", cls: "combine", kwS: 27, kwE: 29, rate: 28, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "mais", label: "Aussaat Körnermais", cls: "drill", kwS: 15, kwE: 18, rate: 40, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "mais", label: "Düngung Körnermais", cls: "fert", kwS: 17, kwE: 21, rate: 80, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "mais", label: "PSM Körnermais", cls: "spray", kwS: 20, kwE: 25, rate: 220, mode: "repeat", laborPerUnit: 1, hand: 0 },
  { cropId: "mais", label: "Ernte Körnermais", cls: "combine", kwS: 40, kwE: 43, rate: 24, mode: "single", laborPerUnit: 1, hand: 0 },
  { cropId: "mais", label: "Transport Körnermais", cls: "transp", kwS: 40, kwE: 44, rate: 60, mode: "single", laborPerUnit: 1, hand: 0 },
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

function enUnitsOf(op: EinsatzOp, area: number, tf: number, kwEnd: number): number {
  if (area <= 0) return 0;
  if (op.mode === "repeat") return Math.max(1, Math.ceil(area / (op.rate * tf * 6)));
  const weeks = Math.max(1, kwEnd - op.kwS + 1);
  return Math.max(1, Math.ceil(area / (op.rate * tf * 6 * weeks)));
}

/** Bottom-up Wertkultur-Flotte: Pflanzmaschinen + Ernter (Tomate + Zwiebel/Möhre, ohne Kartoffel). */
export function deriveValueFleet(domain: Domain, scenarioId: string): { plant: number; harv: number; plantArea: number; harvArea: number } {
  const tf = shiftFactorOf(domain, scenarioId);
  const areaByCrop = new Map<string, number>();
  for (const a of domain.anbauplan) areaByCrop.set(a.cropId, (areaByCrop.get(a.cropId) ?? 0) + a.areaHa);
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
  const staff = resolveScalar(domain, "en.staff", scenarioId);

  const areaByCrop = new Map<string, number>();
  for (const a of domain.anbauplan) areaByCrop.set(a.cropId, (areaByCrop.get(a.cropId) ?? 0) + a.areaHa);
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
    { key: "gross", label: "Großschlepper / Legekombi", units: Math.max(1, cnt("onepass") + scaled("en.gross_extra")) },
    { key: "drill", label: "Sä-/Einzelkorntechnik", units: scaled("en.drill") },
    { key: "pflanz", label: "Gemüse-/Tomaten-Pflanzmasch.", units: Math.max(1, vf.plant) },
    { key: "spray", label: "Spritzen (Mischpark)", units: Math.max(1, spray.total) },
    { key: "fert", label: "Düngerstreuer", units: scaled("en.fert") },
    { key: "combine", label: "Mähdrescher", units: scaled("en.combine") },
    { key: "roder", label: "Kartoffelroder", units: Math.max(1, cnt("roder_ropa")) },
    { key: "tomh", label: "Tomaten-/Gemüseernter", units: Math.max(1, vf.harv) },
    { key: "transp", label: "Transport / Hakenlift", units: scaled("en.transp") },
  ];
  const demand: Record<string, number[]> = {};
  for (const c of classes) demand[c.key] = new Array(53).fill(0);
  const labor: number[] = new Array(53).fill(0);
  const ops: (EinsatzOp & { units: number; color: string })[] = [];

  for (const op of EN_OPS) {
    const area = areaByCrop.get(op.cropId) ?? 0;
    if (area <= 0) continue;
    const kwEnd = enKwEnd(op, harvestStaffel, saatStaffel);
    const u = enUnitsOf(op, area, tf, kwEnd);
    ops.push({ ...op, kwE: kwEnd, units: u, color: EN_CROP_COLOR[op.cropId] ?? "#7BB661" });
    for (let w = op.kwS; w <= kwEnd && w <= 52; w++) {
      if (demand[op.cls]) demand[op.cls][w] += u;
      labor[w] += u * op.laborPerUnit * shifts + (op.hand ? (op.hand * shifts) / Math.max(1, kwEnd - op.kwS + 1) : 0);
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
export const SIZED_MACHINE_IDS = new Set(["pflug", "saatbett", "drille", "einzelkorn", "streuer", "maehdr", "roder_ropa", "gem_schwad", "gem_lader", "gem_moehre", "tomernte", "tompflanz", "onepass", "transport"]);
export const SIZED_TRACTOR_IDS = new Set(["zug_9r", "zug_8rx", "ops_6r"]);
export const isSizedId = (id: string) => SIZED_MACHINE_IDS.has(id) || SIZED_TRACTOR_IDS.has(id);

/** Bearbeitbare Feldtage je Maschine im kritischen Einsatzfenster (wetter-/logistikbereinigt).
 *  Fallback, wenn die Maschine kein eigenes windowDays trägt (v. a. gepoolte Zugklassen).
 *  Kalibriert, so dass das @4.000-ha-Bottom-up den validierten Research-Park reproduziert. */
export const WINDOW_FELDTAGE: Record<string, number> = {
  pflug: 24, saatbett: 30, drille: 30, einzelkorn: 23, streuer: 41, maehdr: 97, roder_ropa: 18,
  tomernte: 24, tompflanz: 18, krautschl: 16, onepass: 31, transport: 44,
  gem_schwad: 20, gem_lader: 20, gem_moehre: 28,
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
    let h = 0;
    for (const im of domain.machineCatalog) if (im.tractorId === id && im.cEff) h += machineHoursPerYear(domain, im.id);
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

/** Bottom-up-Maschinensizing + Auslastungs-/Reserve-Analyse (über-/untermechanisiert?).
 *  Je Klasse: benötigtes Minimum (Schlagkraft), Bestand, Plan-Park, Auslastung ggü. Bestand
 *  und Park, Reserve/Defizit, Status. Treibt CAPEX & Personal (machineFleetCount). */
export function deriveFleetSizing(domain: Domain, scenarioId: string): { machines: FleetSize[]; tractors: FleetSize[] } {
  const tf = shiftFactorOf(domain, scenarioId);
  const hpd = resolveScalar(domain, "en.hours_day", scenarioId) || 10;
  const specById = new Map(domain.machineCatalog.map((m) => [m.id, m]));
  const uniqCrops = (id: string): string[] => {
    const s = new Set<string>();
    for (const a of domain.anbauplan) if ((domain.arbeitsgaenge[a.cropId] ?? []).some((x) => x.m === id)) s.add(a.cropId);
    return [...s];
  };
  const mk = (id: string, isT: boolean): FleetSize => {
    const m = specById.get(id);
    const feldTage = feldTageOf(domain, id);
    const cEff = m?.cEff ?? 0;
    const demandHours = fleetDemandHours(domain, id);
    const capPerUnitHours = hpd * tf * Math.max(1, feldTage);
    const required = capPerUnitHours > 0 ? Math.max(0, Math.ceil(demandHours / capPerUnitHours)) : 0;
    const owned = Math.max(0, Math.round(m?.ownedUnits ?? 0));
    const park = m ? machineFleetCount(domain, m, scenarioId) : required;
    const utilOwnedPct = owned > 0 ? (demandHours / (owned * capPerUnitHours)) * 100 : Infinity;
    const utilParkPct = park > 0 ? (demandHours / (park * capPerUnitHours)) * 100 : 0;
    const reserve = park - required;
    const status: FleetSize["status"] = required > owned ? "under" : park > required ? "reserve" : "min";
    return {
      machineId: id, label: m?.label ?? id, manufacturer: m?.manufacturer, crops: isT ? [] : uniqCrops(id),
      cEff, feldTage, demandHours: Math.round(demandHours), capPerUnitHours: Math.round(capPerUnitHours),
      required, owned, newUnits: Math.max(0, required - owned), park, utilOwnedPct, utilParkPct, reserve, status, isTractor: isT,
    };
  };
  // Nur Maschinen zeigen, die im (ggf. gescopten) Katalog existieren — in Stufe 1 (nur Ackerbau)
  //  sind die Wertkultur-Maschinen (Roder/Pflanz/Gemüse) aus dem Katalog entfernt und tauchen NICHT auf.
  return {
    machines: [...SIZED_MACHINE_IDS].filter((id) => specById.has(id)).map((id) => mk(id, false)),
    tractors: [...SIZED_TRACTOR_IDS].filter((id) => specById.has(id)).map((id) => mk(id, true)),
  };
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
const TRANSPORT_VALUE_CROPS = ["tomate", "kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre"];
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
  own: { perTCent: number; capexCent: number; totalCent: number; lkw: number };
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

  // Spedition.
  const rateCent = speditionRateCent(domain, scenarioId);
  const spedTotalCent = Math.round(rateCent * tonnage);

  return {
    tonnage,
    own: { perTCent: ownPerTCent, capexCent: ownCapexCent, totalCent: ownTotalCent, lkw },
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
  const capPerHa = resolveScalar(domain, "subsidy.per_ha", sc);
  const coupledPerHa = resolveScalar(domain, "subsidy.coupled_freilandgemuese", sc);
  const gersteZwPerHa = resolveScalar(domain, "rev.gerste_zweitfrucht", sc); // 0 falls fehlend
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
    const y = resolveScalar(domain, cat.yieldKey, sc);       // t/ha
    const price = resolveScalar(domain, cat.priceKey, sc);   // CENT/t
    const loss = resolveScalar(domain, cat.lossKey, sc);     // Rate
    let revenueCent = Math.round(area * y * price * (1 - loss));
    if (cropId === "gerste_zw" && gersteZwPerHa) revenueCent += Math.round(area * gersteZwPerHa);
    const isValue = VALUE_CROP_IDS.includes(cropId);
    const coupled = cropId === "tomate" || cropId === "zwiebel_moehre" ? coupledPerHa : 0;
    const subsidyCent = Math.round(area * (capPerHa + coupled));
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

/* --------------------------------------------------------------------------
 * scopeToValueOnly — Domäne auf die Wertkulturen stand-alone reduzieren.
 *  Anbauplan → nur VALUE_CROP_IDS. Maschinen, die von KEINER genutzten (Wert-)Kultur
 *  gebraucht werden, fallen aus der Flotte (z. B. Mähdrescher/Getreidedrille — nur Break
 *  Crops). Beregnung/Lager (perHa/perTonne) sowie CAPEX-only-Träger, deren Anbaugerät
 *  genutzt wird, bleiben. Verbleibende fixe Flotte bleibt je Typ konservativ voll.
 * ------------------------------------------------------------------------ */
function scopeToValueOnly(domain: Domain): Domain {
  const anbauplan = domain.anbauplan.filter((a) => VALUE_CROP_IDS.includes(a.cropId));
  const usedCropIds = new Set(anbauplan.map((a) => a.cropId));
  const usedMachineIds = new Set<string>();
  for (const cid of usedCropIds) {
    for (const g of domain.arbeitsgaenge[cid] ?? []) usedMachineIds.add(g.m);
  }
  const machineCatalog = domain.machineCatalog.filter((m) => {
    if (m.mode !== "fixedFleet") return true;         // Beregnung/Lager immer
    if (m.cEff) return usedMachineIds.has(m.id);       // Feldmaschine: nur wenn genutzt
    if (m.serviceHoursLike) return usedMachineIds.has(m.serviceHoursLike); // Träger: wenn Anbaugerät genutzt
    return true;                                        // Radlader/Shuttle (Lager/Logistik)
  });
  return { ...domain, anbauplan, machineCatalog };
}

/** Entity-Sicht: filtert das Kombimodell auf EINE Gesellschaft (Vollkosten-Standalone) — nur ihre
 *  Kulturen (entityOfEntry), nur die davon genutzten Maschinen, Wachstum flach auf die Entity-Fläche
 *  (Zwei-Pool: beregnet + trocken erhalten). Die Engine rechnet daraus ALLE Sektionen voll (P&L,
 *  Bilanz, Cashflow, Liquidität, Demand). Read-only-Transform (mutiert die gespeicherte Domäne nicht). */
/** Skaliert den KOMBINIERTEN Wachstumspfad proportional auf eine Gesellschaft herunter — die Entity
 *  folgt damit derselben aktiven Stufe (1a/2b/3c) wie das Gesamtmodell, statt flach zu bleiben:
 *   · Gesamtfläche der Entity wächst mit dem Footprint-Ramp des Konzerns (totalByYear-Verhältnis),
 *   · Beregnungsgrad der Entity läuft vom EIGENEN Startwert (irrHa/totHa) auf 100 %, im selben Tempo,
 *     in dem der Konzern Vollberegnung erreicht (Penetrations-Fortschritt 0→1).
 *  Die aufgelösten Kurven werden vorgebacken und als s3b zurückgegeben (Physik-Guard area≤total,
 *  keine erneute s1/s2-Neuberechnung). Keine Konzern-Akquisen (Ramp trägt das Wachstum, kein Doppel). */
function scaleGrowthToEntity(g: GrowthPlan, irrHa: number, totHa: number): GrowthPlan {
  const years = Math.max(1, g.years ?? 1);
  const eff = effectiveGrowth(g)!;                                   // aufgelöste Kurven der aktiven Stufe
  const cStartIrr = eff.startIrrigatedHa ?? eff.areaByYear?.[0] ?? irrHa;
  const cStartTot = eff.startTotalHa ?? eff.totalByYear?.[0] ?? totHa;
  const at = (arr: number[] | undefined, y: number, fb: number) => arr?.[Math.min(y, (arr?.length ?? 1) - 1)] ?? fb;
  const totRatio = (y: number) => (cStartTot > 0 ? at(eff.totalByYear, y, cStartTot) / cStartTot : 1);
  const irrShare0 = cStartTot > 0 ? Math.min(1, cStartIrr / cStartTot) : 1;   // Konzern-Startpenetration
  const irrShareY = (y: number) => { const tt = at(eff.totalByYear, y, cStartTot); return tt > 0 ? Math.min(1, at(eff.areaByYear, y, cStartIrr) / tt) : irrShare0; };
  const prog = (y: number) => (irrShare0 < 1 ? Math.max(0, Math.min(1, (irrShareY(y) - irrShare0) / (1 - irrShare0))) : 1);
  const entShare0 = totHa > 0 ? Math.min(1, irrHa / totHa) : 1;      // EIGENE Startpenetration der Entity
  const totalByYear = Array.from({ length: years }, (_, y) => Math.max(1, Math.round(totHa * totRatio(y))));
  const areaByYear = Array.from({ length: years }, (_, y) => {
    const share = entShare0 + prog(y) * (1 - entShare0);
    return Math.max(1, Math.min(totalByYear[y], Math.round(totalByYear[y] * share)));
  });
  return { ...g, years, stage: "s3b", areaByYear, totalByYear, startIrrigatedHa: irrHa, startTotalHa: totHa, acquisitions: [] };
}

export function scopeToEntity(domain: Domain, entityId: string): Domain {
  const anbauplan = domain.anbauplan.filter((a) => entityOfEntry(a) === entityId);
  if (!anbauplan.length) return domain; // leere Entity → unverändert (Fallback)
  const usedCropIds = new Set(anbauplan.map((a) => a.cropId));
  const usedMachineIds = new Set<string>();
  for (const cid of usedCropIds) for (const g of domain.arbeitsgaenge[cid] ?? []) usedMachineIds.add(g.m);
  const machineCatalog = domain.machineCatalog.filter((m) => {
    if (m.mode !== "fixedFleet") return true;
    if (m.cEff) return usedMachineIds.has(m.id);
    if (m.serviceHoursLike) return usedMachineIds.has(m.serviceHoursLike);
    return true;
  });
  const irrHa = anbauplan.filter((a) => a.pool !== "dryland").reduce((s, a) => s + a.areaHa, 0) || 1;
  const totHa = anbauplan.reduce((s, a) => s + a.areaHa, 0) || irrHa;
  // Per-Entity-Wachstumspfad: proportional zum aktiven Konzern-Ramp (nicht mehr flach) — die
  //  Gesellschaft rampt in derselben Stufe (2b/3c) wie das Gesamtmodell, auf ihre Basisfläche skaliert.
  const growth = domain.growth ? scaleGrowthToEntity(domain.growth, irrHa, totHa) : domain.growth;
  return { ...domain, anbauplan, machineCatalog, growth, scope: "full", stage: 1 };
}

/** Leitet aus dem Kombimodell (Isolde = Cash/Trocken · neoterra = Value Crops) einen EIGENSTÄNDIGEN
 *  neoterra-Value-Crop-Case ab, der als separates Modell gespeichert werden kann:
 *   · Anbauplan nur Wertkulturen (Isolde-Cash/Trockenrotation entfällt),
 *   · Maschinenpark nur die von den Wertkulturen genutzte Spezialtechnik (Tomaten-/Kartoffel-/
 *     Gemüse-Erntekette, Pflanzer + geteilte Feldtechnik) — auf die Wertkultur-Fläche dimensioniert,
 *   · `scope: "full"` → VOLLKOSTEN (eigene Flotte + eigene Struktur, KEINE anteilige Verwässerung),
 *   · Wachstum flach auf die Wertkultur-Fläche (kein Cash-Ramp, keine Trockenrotation/Zukäufe).
 *  Overhead/Personal bleiben editierbar — für den Standalone bewusst zu prüfen. */
export function deriveValueCropCase(domain: Domain): Domain {
  const vco = scopeToValueOnly(domain);                              // Anbauplan + Maschinen gefiltert
  const vcHa = vco.anbauplan.reduce((s, a) => s + a.areaHa, 0) || 1;
  const years = Math.max(1, domain.growth?.years ?? 1);
  const growth = domain.growth ? {
    ...domain.growth,
    stage: "s1" as const,                                            // flach, Status quo (kein Cash-Ramp)
    areaByYear: Array.from({ length: years }, () => vcHa),
    totalByYear: Array.from({ length: years }, () => vcHa),
    startTotalHa: vcHa, startIrrigatedHa: vcHa,
    drylandRotation: [], acquisitions: [],
  } : domain.growth;
  return {
    ...vco,
    meta: { ...domain.meta, name: "NEOTERRA (Value Crops)" },
    scope: "full",                                                   // Vollkosten-Standalone
    stage: 1,
    growth,
  };
}

/** Value-crop-spezifische Maschinen (Gemüse/Kartoffel-Kette) — entfallen im reinen Ackerbau (1a). */
const VALUE_ONLY_MACHINE_IDS = new Set([
  "tomernte", "roder_ropa", "krautschl", "gem_schwad", "gem_lader", "gem_moehre",
  "tompflanz", "onepass", "sc360", "fieldloader",
]);

/* --------------------------------------------------------------------------
 * scopeToCashOnly — Stufe 1a: reiner Ackerbaubetrieb VOR den Wertkulturen.
 *  Die gesamte beregnete Fläche läuft eine Cash-Crop-Rotation (Mais/Soja auf Beregnung +
 *  Getreide/Raps), KEIN Gemüse. Value-crop-Maschinen (Ernter/Roder/Gemüse/Pflanz) entfallen.
 *  Benchmark „Betrieb ohne Wertkulturen" für die Gesellschafter-Analyse (Hebel des Gemüsebaus).
 * ------------------------------------------------------------------------ */
function scopeToCashOnly(domain: Domain): Domain {
  // NUR der beregnete Block wird zur Cash-Crop-Rotation umgebaut (Wasser bevorzugt Mais/Soja).
  //  Die Trockenrotation (pool:"dryland") ist bereits reine Getreide-/Raps-Cash-Crop und bleibt
  //  UNVERÄNDERT erhalten — sonst rollt sie in die beregnete Fläche und der Ramp-scale (areaByYear ÷
  //  Basisfläche) zieht sie ab Jahr 1 wieder heraus (Y0-Spike + Kollaps auf die beregnete Fläche).
  const dry = domain.anbauplan.filter((a) => a.pool === "dryland");
  const irrHa = domain.anbauplan.filter((a) => a.pool !== "dryland").reduce((s, a) => s + a.areaHa, 0);
  const rot: { cropId: CropId; share: number }[] = [
    { cropId: "mais", share: 0.25 },
    { cropId: "soja_luzerne", share: 0.20 },
    { cropId: "weizen", share: 0.25 },
    { cropId: "winterraps", share: 0.15 },
    { cropId: "gerste_zw", share: 0.15 },
  ];
  const irrPlan: AnbauEntry[] = rot.map((r) => ({
    id: `ab-cash-${r.cropId}`,
    cropId: r.cropId,
    areaHa: Math.round(irrHa * r.share),
    plantingPeriod: CROP_CAL[r.cropId].plant,
    harvestPeriods: CROP_CAL[r.cropId].harvest.slice(),
  }));
  const anbauplan: AnbauEntry[] = [...irrPlan, ...dry];
  const machineCatalog = domain.machineCatalog.filter((m) => !VALUE_ONLY_MACHINE_IDS.has(m.id));
  // Kultur-Politik (Kartoffel-Ramp/Markt-Caps) greift ohne Wertkulturen nicht — leeren.
  return { ...domain, anbauplan, machineCatalog, cropPolicy: {} };
}

/** Effektive Domäne nach aktiver Stufe/Scope — DIESELBE Transformation wie im Composer, damit
 *  direkte Ableitungen (Dashboard-Kultur-Karten: Anbaustruktur, Contribution, Stufen-Board)
 *  bei Stufe 1 (nur Ackerbau) bzw. Scope valueOnly konsistent zur GuV rechnen. */
export function scopedDomain(domain: Domain): Domain {
  // Entity-Sicht zuerst (Vollkosten-Standalone der Gesellschaft), dann Stage/Scope darauf.
  const ev = domain.entityView;
  const d = (ev && ev !== "combined") ? scopeToEntity(domain, ev) : domain;
  if (d.growth?.stage === "s1a") return scopeToCashOnly(d);
  if ((d.scope ?? "full") === "valueOnly") return scopeToValueOnly(d);
  return d;
}

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
  // Scope 'valueOnly': Anbauplan auf Wertkulturen filtern und Maschinen, die NUR Break Crops
  // nutzen (z. B. Mähdrescher, Getreidedrille), aus der Flotte nehmen. Alle Downstream-Rechnungen
  // (Fläche, Flotte/CAPEX, opex.fix, Beregnung/Lager, P&L) laufen dann auf `domain`.
  // Entity-Sicht (Header) zuerst: auf die gewählte Gesellschaft filtern (Vollkosten-Standalone) —
  //  danach greifen Scope/Stage auf dem gefilterten Modell. 'combined'/leer → Gesamtmodell.
  const entityView = domainIn.entityView;
  const isCombined = !entityView || entityView === "combined";
  // Kombiniert: Intercompany-Maschinenmiete ELIMINIEREN — gemietete Einheiten als EIGEN behandeln
  //  (rentedUnits→0), da Verleiher & Mieter dieselbe Gruppe sind. In den Entity-Sichten bleibt die Miete.
  const domainE: Domain = isCombined
    ? { ...domainIn, machineCatalog: domainIn.machineCatalog.map((m) => (m.rentedUnits ? { ...m, rentedUnits: 0 } : m)) }
    : scopeToEntity(domainIn, entityView!);
  const scope = domainE.scope ?? "full";
  // Zwei-Pool: der Beregnungs-Ramp (scale/usedArea) bezieht sich NUR auf die beregneten Kulturen.
  //  Dryland-Einträge (pool:"dryland") skalieren separat (totalByYear − areaByYear) und dürfen den
  //  Beregnungs-scale nicht verwässern. Solange kein Dryland im Plan steht, ist der Filter ein No-Op.
  const isIrr = (a: AnbauEntry) => a.pool !== "dryland";
  const fullArea = domainE.anbauplan.filter(isIrr).reduce((s, a) => s + a.areaHa, 0);
  // Stufe 1a (nur Ackerbau) hat Vorrang vor dem Scope: reine Cash-Crop-Rotation, kein Gemüse.
  const cashOnly = domainE.growth?.stage === "s1a";
  const domain: Domain = cashOnly ? scopeToCashOnly(domainE)
    : scope === "valueOnly" ? scopeToValueOnly(domainE) : domainE;
  const usedArea = domain.anbauplan.filter(isIrr).reduce((s, a) => s + a.areaHa, 0);
  // Personal skaliert mit der genutzten Fläche (bevorzugt); die verbleibende Flotte bleibt
  // je Typ konservativ voll (Spitzenmonat-Sizing skaliert nicht linear) — nur Break-only-
  // Maschinen entfallen. areaFactor = genutzte/volle Fläche.
  const areaFactor = fullArea > 0 ? usedArea / fullArea : 1;
  const scopeFactor = scope === "valueOnly" ? areaFactor : 1;

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
  const transportTotalCent = transport.chosen === "own" ? transport.own.totalCent : transport.spedition.totalCent;
  if (transport.chosen === "own" && transport.own.capexCent > 0) {
    capex.push({
      id: "cx-transport-fleet",
      name: "Transport-LKW-Flotte",
      assetClass: "machinery",
      amount: transport.own.capexCent,
      purchasePeriod: 0,
      usefulLifeMonths: 96,
      usefulLifeFiscalMonths: 84,
      financingMode: "loan",
    });
  }

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
  const overheadMonthly = (domain.overhead ?? []).reduce((s, o) => s + (o.monthlyCent || 0), 0);
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
  // Maschinen-Skalierung (Anti-Doppelzählung): übernommene Betriebe (asset-Deals) bringen ihre
  //  Flotte MIT (Maschinen-Zeitwert im Deal) → ihre beregnete Fläche wird aus der Flotten-Vintage-
  //  Skalierung herausgerechnet. Pacht-Übernahmen (asset-light, ohne Maschinen) bleiben enthalten.
  const assetIrrCum = (y: number) => (gEff?.acquisitions ?? [])
    .filter((d) => d.dealType === "asset" && Math.round(d.year) <= y)
    .reduce((s, d) => s + (d.irrHa ?? 0), 0);
  const machScale = scale.map((sc, y) => Math.max(0, (baseArea * sc - assetIrrCum(y)) / baseArea));
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
  // Kulturscharfe Vintage-Treiber: Lager folgt Lager-Tonnage, Maschinen ihren Nutzer-Kulturen.
  const yieldOfCropMY = (cid: string) => { const yk = domain.catalog.find((c) => c.cropId === cid)?.yieldKey; return yk ? resolveScalar(domain, yk, scenarioId) : 0; };
  const shareOfStoreMY = (cid: string) => { const k = `store.share.${cid}`; return domain.assumptions[k] ? Math.max(0, Math.min(1, resolveScalar(domain, k, scenarioId))) : 1; };
  const storeTMY = (y: number) => STORAGE_CROP_IDS.reduce((s, cid) => s + (cropAreasMY.areas[cid]?.[y] ?? 0) * yieldOfCropMY(cid) * shareOfStoreMY(cid), 0);
  const storeBaseTMY = storeTMY(0);
  const storeScaleMY = Array.from({ length: years }, (_, y) => storeBaseTMY > 0 ? storeTMY(y) / storeBaseTMY : scale[y]);
  const dStoreScale = storeScaleMY.map((s, y) => s - (y > 0 ? storeScaleMY[y - 1] : 0));
  const adjAsset = scale.map((s, y) => (s > 0 ? machScale[y] / s : 1));
  const dMachOf = (machineId: string): number[] => {
    const users = (Object.keys(ARBEITSGAENGE) as CropId[]).filter((cid) => (ARBEITSGAENGE[cid] ?? []).some((st) => st.m === machineId));
    if (!users.length) return dMachScale; // geteilte/unspezifische Technik → Gesamtfläche (asset-korrigiert)
    const at = (y: number) => users.reduce((s, cid) => s + (cropAreasMY.areas[cid]?.[y] ?? 0), 0);
    const b = at(0);
    if (b <= 0) return dMachScale;
    const curve = Array.from({ length: years }, (_, y) => (at(y) / b) * adjAsset[y]);
    return curve.map((s, y) => s - (y > 0 ? curve[y - 1] : 0));
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
  const sgaDamp = (y: number) => 1 + 0.55 * (scale[y] - 1); // Corporate-Overhead wächst gedämpft
  // Phase 8 — Inflationsindizes je Jahr (getrennt Output/Input/Lohn/CAPEX). Jahr 0 = 1,0 (keine Inflation Jahr 1).
  const inflPow = (r: number) => (y: number) => Math.pow(1 + r, y);
  const iOut = inflPow(resolveScalar(domain, "infl.output", scenarioId));
  const iIn = inflPow(resolveScalar(domain, "infl.input", scenarioId));
  const iWage = inflPow(resolveScalar(domain, "infl.wage", scenarioId));
  const iCap = inflPow(resolveScalar(domain, "infl.capex", scenarioId));
  // Basiswerte (Jahr-1 / scale=1) → Monatswerte:
  const baseFixMonthly = Math.round((annualFixEur * 100) / 12);
  const baseMachMonthly = Math.round(machineServiceAnnualCent(domain, scenarioId) / 12);
  const baseRentMonthly = Math.round(machineRentAnnualCent(domain, scenarioId) / 12);
  // Intercompany-Miet-ERTRAG: in der Verleiher-Sicht der Gesellschaft, die die Einheiten verleiht
  //  (rentedFrom je Maschine, Default Isolde). Gemietete Maschinen laufen beim MIETER → aus der VOLLEN
  //  Domäne (domainIn) gerechnet, gefiltert auf lessor == aktuelle Entity. Negativ in OpEx → hebt EBITDA
  //  des Verleihers. In 'combined' 0 (eliminiert). Konsistent zur Mieter-OPEX (Summe über alle Verleiher).
  const rentIncomeCent = !isCombined ? machineRentAnnualCent(domainIn, scenarioId, entityView!) : 0;
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
  setScaled("opex.machine_rent", baseRentMonthly, (y) => scale[y] * iIn(y));
  setScaled("opex.machine_rent_income", baseRentIncomeMonthly, (y) => scale[y] * iIn(y));
  setScaled("opex.transport", baseTransMonthly, (y) => scale[y] * iIn(y));
  setScaled("opex.sga", baseSgaMonthly, (y) => sgaDamp(y) * iWage(y));
  // Pacht: Dritt-Pacht (bewirtschaftete Fläche − Eigentum, skaliert, input-inflationiert) +
  //  Besitzgesellschaft-Pacht (Eigentum fix, Index-Stufe alle N Jahre). Nicht in opex.fix (kein Doppel).
  {
    const pc = domain.pacht;
    const ownHa = pc?.ownedHa ?? 0, besitzRate = pc?.baseRentPerHaCent ?? 0;
    // Jahres-Pacht (CENT): Dritt-Pacht (skaliert) + Besitz-Pacht (nur wenn NICHT IFRS 16 kapitalisiert).
    const pachtAnnual = (y: number) => {
      const areaY = baseArea * scale[y];
      const thirdCent = Math.max(0, areaY - ownHa) * PACHT_PER_HA * 100 * iIn(y);
      const besitzCent = (pc && !pc.ifrs16) ? ownHa * besitzRate * pachtIndexFactor(pc, y) : 0;
      // Wiring: laufende Pacht der Pacht-Übernahmen (Lease-Deals) ab dem Übernahmejahr.
      const leaseCent = (gEff?.acquisitions ?? [])
        .filter((dd) => dd.dealType === "lease" && dd.year <= y)
        .reduce((s, dd) => s + dd.totalHa * (dd.leaseRentPerHaCent ?? 30000) * iIn(y), 0);
      return thirdCent + besitzCent + leaseCent;
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
  const DAMPED_PERS = new Set(["pers.leitung.n", "pers.service.n"]);
  for (const key of ["pers.leitung.n", "pers.stamm.n", "pers.bewaesserung.n", "pers.lager.n", "pers.service.n", "pers.saison.n", "pers.prakt.n"]) {
    const b = domain.assumptions[key];
    const baseVal = resolveScalar(domain, key, domain.baseScenarioId) * personnelScale;
    const persScaleY = (y: number) => DAMPED_PERS.has(key) ? sgaDamp(y) : scale[y];
    if (years <= 1) {
      if (personnelScale !== 1) assumptions[key] = { id: b?.id ?? key, key, label: b?.label ?? key, unit: (b?.unit ?? "count") as any,
        scenarioProfiles: { [domain.baseScenarioId]: { kind: "constant", value: baseVal } }, meta: b?.meta };
    } else {
      const values = Array.from({ length: nPer }, (_, p) => baseVal * persScaleY(yearOf(p)));
      assumptions[key] = { id: b?.id ?? key, key, label: b?.label ?? key, unit: (b?.unit ?? "count") as any,
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
    curveInfl("rev.gerste_zweitfrucht", iOut);
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
    scaleAssum("rev.gerste_zweitfrucht", ov.priceFactor("gerste_zw"));

    // (3) WASSERNORM. Die mm/ha je Kultur sind Stammdaten; kostenseitig ist eine höhere
    //  Norm äquivalent zu einem proportional höheren €/mm·ha-Satz.
    scaleAssum("irrig.eur_mm", ov.irrigNormScale);

    // (4) ZINSSCHOCK — additiv auf den Referenzzins aller Floating-Verträge und des Revolvers.
    addAssum("macro.euribor", ov.rateShock);
  }

  // Subventionen — je Jahr als Pauschale, Anspruchsfläche KULTURSCHARF (Politik-Kurven), Cap absolut.
  //  HINWEIS: Der frühere synthetische "sub-gerste-zw"-Strom ist ENTFERNT — der Doppel-Soja-Erlös
  //  läuft vollständig über secondCrop in der Engine (SSOT, sonst Doppelzählung ~+1,7 M€/a im Endausbau).
  const baseSubs: { s: Subsidy; baseHa: number; perHa: number }[] =
    domain.subsidies.map((s) => ({ s, baseHa: areaFor(s.cropIds), perHa: s.ratePerHaCent ?? 0 }));
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
      const amt = s.basis === "per_ha" ? Math.round(perHa * elig) : (s.lumpSumCent ?? 0);
      if (amt === 0) continue;
      const prof = (s.payout && s.payout.length ? s.payout : s.receiptPeriods.map((pp) => ({ period: pp, share: 1 / Math.max(1, s.receiptPeriods.length) })));
      subsidies.push({
        id: `${s.id}-y${y}`, name: s.name, basis: "lump_sum", lumpSumCent: amt,
        receiptPeriods: s.receiptPeriods.map((pp) => pp + y * 12),
        payout: prof.map((x) => ({ period: x.period + y * 12, share: x.share })),
        pillar: s.pillar, category: s.category, active: true,
      });
    }
  }

  // Wachstum — Deckungsbeitrag der UNBEREGNETEN Fläche (Break-Crop-Rotation, Rain-fed).
  //  Analog zur Gerste-Zweitfrucht als eigener Ertragsstrom modelliert (DB je ha ist bereits
  //  netto der variablen Kosten). Fließt in Bruttoergebnis + Cash; finanziert den Landzukauf-
  //  Kapitaldienst. Ernte der Break Crops ~Juli. Output-Inflation je Jahr.
  const gpFwd = gEff;
  // Ab der Vollintegration laufen die Trockenkulturen NATIV als Rain-fed-Kulturvarianten durch die
  //  Erlös−Kosten-Maschinen-Rechnung (pool:"dryland" im Anbauplan). Der alte DB-Lump-Sum darf dann
  //  NICHT mehr laufen (sonst Doppelzählung). Nur Fallback, wenn kein natives Dryland im Plan steht.
  const hasNativeDryland = domain.anbauplan.some((a) => a.pool === "dryland");
  if (!hasNativeDryland && years > 1 && gpFwd?.totalByYear && gpFwd.drylandRotation?.length) {
    const dryDbPerHa = gpFwd.drylandRotation.reduce((s, r) => s + r.sharePct * r.dbPerHaCent, 0);
    let prevTot = gpFwd.startTotalHa ?? gpFwd.totalByYear[0] ?? 0;
    for (let y = 0; y < years; y++) {
      const totHa = gpFwd.totalByYear[y] ?? prevTot; prevTot = totHa;
      const dryHa = Math.max(0, totHa - (gpFwd.areaByYear[y] ?? 0));
      const amt = Math.round(dryHa * dryDbPerHa * iOut(y));
      if (amt <= 0) continue;
      subsidies.push({
        id: `dryland-db-y${y}`, name: "Deckungsbeitrag unberegnete Fläche (Trockenrotation)",
        basis: "lump_sum", lumpSumCent: amt,
        receiptPeriods: [6 + y * 12],
        payout: [{ period: 6 + y * 12, share: 0.6 }, { period: 8 + y * 12, share: 0.4 }],
        category: "national", active: true,
      });
    }
  }

  // CropPlans über die Jahre replizieren (Fläche × scale, Perioden + y·12).
  // Kultur-Skalierungspolitik: je Kultur eigener Flächenpfad (cropFactor, oben abgeleitet).
  const cropPlansMY: CropPlan[] = years <= 1 ? cropPlans : cropPlans.flatMap((cp) =>
    Array.from({ length: years }, (_, y) => ({
      ...cp, id: `${cp.id}-y${y}`, areaHa: cp.areaHa * cropFactor(cp.cropId, y),
      plantingPeriod: cp.plantingPeriod + y * 12,
      harvestPeriods: cp.harvestPeriods.map((h) => h + y * 12),
      secondCrop: cp.secondCrop ? { ...cp.secondCrop, harvestPeriod: cp.secondCrop.harvestPeriod + y * 12 } : undefined,
      operations: (cp.operations ?? []).map((op) => ({
        ...op, id: `${op.id}-y${y}`, costPeriods: op.costPeriods.map((c) => c + y * 12),
        lines: op.lines.map((ln) => ({ ...ln, id: `${ln.id}-y${y}` })),
      })),
    })),
  );

  // Finanzierungs-Jahrgänge: VERTRAGSSCHARF — Vintage-Prinzipal folgt den tatsächlichen Objekt-
  //  Zugängen des Jahres (Lager → dStoreScale, Maschinen → dMachOf, Beregnung → 0, denn der Ausbau
  //  hat seinen eigenen Beregnungs-Investitionskredit). Sonst entsteht Phantom-Fremdkapital
  //  (Kredit-Ziehungen ohne zugehörige Assets — vorher ~30 M€ Doppel-Finanzierung Beregnung).
  const capexBaseAmt = new Map(capex.map((ci) => [ci.id, ci.amount] as [string, number]));
  const contractDVec = (t: DebtTranche): number[] => {
    const f = financing.find((x) => x.tranche.id === t.id);
    if (!f) return dScale; // manuelle Tranchen (domain.debt): bisheriges Verhalten
    const objs = f.objects.map((o) => o.id);
    const baseSum = objs.reduce((s, id) => s + (capexBaseAmt.get(`cx-${id}`) ?? 0), 0);
    if (baseSum <= 0) return dScale;
    const addAt = (y: number): number => {
      if (y === 0) return baseSum;
      let s = 0;
      for (const id of objs) {
        const base = capexBaseAmt.get(`cx-${id}`) ?? 0;
        if (base <= 0 || id === "irrig") continue;
        s += base * (id === "store" ? dStoreScale[y] : dMachOf(id)[y]);
      }
      return s;
    };
    return Array.from({ length: years }, (_, y) => addAt(y) / baseSum);
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
          capexMY.push({ ...ci, id: `${ci.id}-y${y}`, amount: Math.round(ci.amount * dVec[y] * iCap(y)),
            salvageValue: ci.salvageValue != null ? Math.round(ci.salvageValue * dVec[y] * iCap(y)) : undefined,
            purchasePeriod: y * 12 });
        }
        continue;
      }
      // Maschine: Kohorten mit Ausmusterung. Zyklus C, AfA-Dauer L (Monate).
      const C = r.cycleYears, L = r.afaYears * 12;
      const mkChain = (startY: number, netCent: number, resCent: number, firstDispAge: number) => {
        let py = startY, age = firstDispAge, guard = 0;
        while (py < years && guard++ < 40) {
          const dispY = py + age;
          const disposed = dispY < years;
          const inf = iCap(py); // CAPEX-Inflation je Anschaffungsjahr (auch revolvierende Ersatzkäufe)
          capexMY.push({
            ...ci, id: `${ci.id}-c${py}-${age}-${capexMY.length}`, amount: Math.round(netCent * inf), salvageValue: 0,
            usefulLifeMonths: L, usefulLifeFiscalMonths: L, purchasePeriod: py * 12,
            disposalPeriod: disposed ? dispY * 12 : undefined,
            disposalProceedsCent: disposed ? Math.round(resCent * inf) : undefined,
            financingMode: py === startY && startY === 0 ? ci.financingMode : "cash",
          });
          if (!disposed) break;
          py = dispY; age = C; // Folgetausche im Zyklus
        }
      };
      // Basisflotte (Jahr 0): C Kohorten, Ausmusterung gestaffelt Jahr C..2C-1 (intakt bis C, dann revolvierend).
      for (let k = 0; k < C; k++) mkChain(0, Math.round(ci.amount / C), Math.round((ci.salvageValue ?? 0) / C), C + k);
      // Ausbau-Zugänge je Skalierungsjahr v: zusätzliche C Kohorten. KULTURSCHARF — jede Maschine
      //  folgt der Flächenkurve ihrer Nutzer-Kulturen (Kultur-Politik); geteilte Technik folgt der
      //  Gesamtfläche. Asset-Deal-Flotten bleiben herausgerechnet (adj), keine Doppelzählung.
      const dM = dMachOf(ci.id.startsWith("cx-") ? ci.id.slice(3) : ci.id);
      for (let v = 1; v < years; v++) {
        if (dM[v] <= 1e-9) continue;
        const addNet = ci.amount * dM[v], addRes = (ci.salvageValue ?? 0) * dM[v];
        for (let k = 0; k < C; k++) mkChain(v, Math.round(addNet / C), Math.round(addRes / C), C + k);
      }
    }
  }

  // Wachstum — Land-/Betriebszukauf (Übernahme): Δ Gesamtfläche je Jahr × €/ha als Land-CAPEX
  //  (assetClass 'land' → keine AfA). Wirkt auf Bilanz (PPE-Land) & Cashflow (Investition),
  //  die Bilanz-Identität erzwingt die Engine strukturell.
  //  Finanzierung: eigener Übernahme-/Bodenkredit (acquisition facility), im Kaufjahr gezogen
  //  (LTV editierbar via growth.acqDebtShare; Default 100 % zunächst — Landkäufe hypothekarisch/
  //  über Übernahmekredit finanziert, damit die Liquidität trägt). Rest (1−LTV) aus Kasse/Equity.
  const gp = gEff;
  // Bei konfiguriertem Akquiseprofil steuern die Deals die Akquise-CAPEX (s. u.) → generischer
  //  ha-Zukauf entfällt, um Doppelzählung zu vermeiden.
  if (years > 1 && gp?.totalByYear && (gp.acqEurPerHaCent ?? 0) > 0 && !(gp.acquisitions?.length)) {
    const acq = gp.acqEurPerHaCent ?? 0;
    const ltv = gp.acqDebtShare != null ? Math.max(0, Math.min(1, gp.acqDebtShare)) : 1;
    let prevTotal = gp.startTotalHa ?? gp.totalByYear[0] ?? 0;
    for (let y = 0; y < years; y++) {
      const tot = gp.totalByYear[y] ?? prevTotal;
      const dHa = Math.max(0, tot - prevTotal);
      prevTotal = tot;
      if (dHa <= 0) continue;
      const amt = Math.round(dHa * acq * iCap(y));
      capexMY.push({
        id: `cx-land-acq-y${y}`,
        name: `Flächen-Zukauf/Übernahme (${Math.round(dHa)} ha)`,
        assetClass: "land",
        amount: amt,
        purchasePeriod: y * 12,
        usefulLifeMonths: 1200, usefulLifeFiscalMonths: 1200,
        financingMode: ltv > 0 ? "loan" : "cash",
      });
      if (ltv > 0) {
        debtMY.push({
          id: `debt-land-acq-y${y}`,
          name: `Übernahme-/Bodenkredit ${START_YEAR + y}`,
          principal: Math.round(amt * ltv),
          drawPeriod: y * 12,
          termMonths: gp.acqLoanTermMonths ?? 144,   // Default 12 J. Annuität (editierbar)
          rateBasis: "fixed", fixedRate: 0.05,
          repayment: "annuity",
        });
      }
    }
  }

  // Wiring: Farm-Akquiseprofil (Stufe 3b) — je Deal Assets + Finanzierung.
  //  · asset (Betriebskauf): Land/Gebäude (kein AfA) + Maschinen-Zeitwert (AfA 8 J.).
  //  · lease (Pacht-Übernahme): Ablöse als immaterieller Wert (AfA 10 J.); laufende Pacht s. opex.pacht.
  //  Finanzierung: debtShare × Gesamtinvest als Akquisitionskredit (Annuität 10 J.); Rest bar/EK.
  //  Capex-Auszahlung − Kreditziehung = Eigenmittelanteil (korrekter Cash-Effekt).
  if (years > 1 && gp?.acquisitions?.length) {
    for (const d of gp.acquisitions) {
      const y = Math.max(0, Math.min(years - 1, Math.round(d.year)));
      const price = Math.round(d.totalHa * d.eurPerHaCent * iCap(y));
      const mach = d.dealType === "asset" ? Math.round(d.machineValueCent * iCap(y)) : 0;
      const invest = price + mach;
      if (invest <= 0) continue;
      const dShare = Math.max(0, Math.min(1, d.debtShare ?? 0));
      if (d.dealType === "asset") {
        capexMY.push({ id: `cx-farm-land-${d.id}`, name: `${d.name} — Land/Gebäude`, assetClass: "land",
          amount: price, purchasePeriod: y * 12, usefulLifeMonths: 1200, usefulLifeFiscalMonths: 1200, financingMode: "cash" });
        if (mach > 0) capexMY.push({ id: `cx-farm-mach-${d.id}`, name: `${d.name} — Maschinen (Zeitwert)`, assetClass: "machinery",
          amount: mach, purchasePeriod: y * 12, usefulLifeMonths: 96, usefulLifeFiscalMonths: 84, financingMode: "cash" });
      } else {
        capexMY.push({ id: `cx-farm-lease-${d.id}`, name: `${d.name} — Pacht-Ablöse`, assetClass: "other",
          amount: price, purchasePeriod: y * 12, usefulLifeMonths: 120, usefulLifeFiscalMonths: 120, financingMode: "cash" });
      }
      if (dShare > 0) {
        debtMY.push({ id: `debt-farm-${d.id}`, name: `Akquisitionskredit ${d.name}`,
          principal: Math.round(invest * dShare), drawPeriod: y * 12, termMonths: 120,
          rateBasis: "fixed", fixedRate: 0.05, repayment: "annuity" });
      }
    }
  }

  // Wachstum — Beregnungsausbau (Pivot/Verrohrung/Pumpe): Δ eigene beregnete ha × €/ha als
  //  Irrigation-CAPEX (assetClass 'irrigation', AfA). Nur EIGENE Umwandlung Trocken→beregnet —
  //  bereits beregnete ha aus Übernahmen (deal.irrHa) bringen ihre Pivots mit → nicht doppelt.
  //  Finanzierung: acqDebtShare als Investitionskredit; Rest bar/EK.
  if (years > 1 && gp?.areaByYear && (gp.irrigEurPerHaCent ?? 0) > 0 && !(domain.capexPlanActive?.bewaesserung)) {
    const perHa = gp.irrigEurPerHaCent ?? 0;
    const ltv = gp.acqDebtShare != null ? Math.max(0, Math.min(1, gp.acqDebtShare)) : 0.5;
    const dealIrrIn = (y: number) => (gp.acquisitions ?? []).filter((d) => Math.round(d.year) === y).reduce((s, d) => s + (d.irrHa ?? 0), 0);
    let prevIrr = gp.startIrrigatedHa ?? gp.areaByYear[0] ?? 0;
    for (let y = 0; y < years; y++) {
      const irrY = gp.areaByYear[y] ?? prevIrr;
      const dOwn = Math.max(0, (irrY - prevIrr) - dealIrrIn(y)); // eigene Neu-Beregnung
      prevIrr = irrY;
      if (dOwn <= 0) continue;
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
      const kat = it.kategorie ?? (it.block === "bewaesserung" ? "bewaesserung" : it.block === "maschinen" ? "maschinen" : "gebaeude");
      const ac: AssetClass = kat === "bewaesserung" ? "irrigation" : kat === "maschinen" ? "machinery" : kat === "iot" ? "other" : "buildings";
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
    biologicalAssets: domain.biologicalAssets,
    personnel: domain.personnel,
    holding: domain.holding,
    openingBalance: domain.openingBalance,
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
  { group: "Ertrag (t/ha)", keys: [
    "yield.weizen", "yield.gerste_zw", "yield.soja_luzerne", "yield.winterraps", "yield.mais",
    "yield.tomate", "yield.kartoffel_pommes", "yield.kartoffel_chips", "yield.zwiebel_moehre",
    "yield.suesskartoffel", "yield.knollensellerie", "yield.knoblauch",
  ]},
  { group: "Preis & Verlust (€/t · %)", keys: [
    "price.weizen", "loss.weizen",
    "price.gerste_zw", "loss.gerste_zw",
    "price.soja_luzerne", "loss.soja_luzerne",
    "price.winterraps", "loss.winterraps",
    "price.mais", "loss.mais",
    "price.tomate", "loss.tomate",
    "price.kartoffel_pommes", "loss.kartoffel_pommes",
    "price.kartoffel_chips", "loss.kartoffel_chips",
    "price.zwiebel_moehre", "loss.zwiebel_moehre",
    "price.suesskartoffel", "loss.suesskartoffel",
    "price.knollensellerie", "loss.knollensellerie",
    "price.knoblauch", "loss.knoblauch",
  ]},
  { group: "Kontrakt-Qualität (Erfüllung 0..1)", keys: [
    "qual.weizen", "qual.gerste_zw", "qual.soja_luzerne", "qual.winterraps", "qual.mais",
    "qual.tomate", "qual.kartoffel_pommes", "qual.kartoffel_chips", "qual.zwiebel_moehre",
    "qual.suesskartoffel", "qual.knollensellerie", "qual.knoblauch",
  ]},
  { group: "Maschinen-Neupreise (CENT)", keys: [
    "mprice.pflug", "mprice.saatbett", "mprice.drille", "mprice.einzelkorn", "mprice.streuer",
    "mprice.spritze14", "mprice.krautschl", "mprice.onepass", "mprice.sc360", "mprice.roder_ropa",
    "mprice.zug_8rx", "mprice.ops_6r", "mprice.radlader", "mprice.shuttle", "mprice.fieldloader",
    "mprice.tompflanz", "mprice.tomernte", "mprice.gem_schwad", "mprice.gem_lader", "mprice.gem_moehre", "mprice.maehdr", "mprice.transport",
    "mprice.spray_gz", "mprice.spray_sf",
    "mprice.irrig_perha", "mprice.store_pert",
  ]},
  { group: "Spritzstrategie (fenstergetrieben)", keys: [
    "spray.appl_lha", "spray.window_days", "spray.boom_m", "spray.speed_kmh", "spray.refill_min",
    "spray.field_eff", "spray.hours_day", "spray.sf_share", "spray.tank_gz_l",
    "spray.pivot_ha", "spray.boom48_prem", "spray.res48_hair",
  ]},
  { group: "Einsatzplanung & Wertkultur-Bottom-up", keys: [
    "en.shifts", "en.shift_eff", "en.hours_day", "en.harvest_staffel", "en.saat_staffel", "en.staff", "en.avail_h_year",
    "en.drill", "en.fert", "en.combine", "en.transp", "en.gross_extra",
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
  { group: "Subventionen", keys: ["subsidy.per_ha", "subsidy.coupled_freilandgemuese", "rev.gerste_zweitfrucht"] },
  { group: "Covenants", keys: ["covenant.dscr_min", "covenant.leverage_max"] },
];
