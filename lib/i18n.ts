/** Minimaler i18n-Layer. Der DEUTSCHE Text ist der Schlüssel: `t("Anbauplan & Erträge")`.
 *  Fehlt eine Übersetzung, wird der deutsche Original-Text zurückgegeben (grazil, für den
 *  schrittweisen Rollout). Reaktivität: der App-Baum remountet bei Sprachwechsel (key), daher
 *  genügt eine Modul-globale Sprache; `t` liest sie synchron. */
import B1 from "./i18n_b1";
import B2 from "./i18n_b2";
import B3 from "./i18n_b3";
import B4 from "./i18n_b4";
import B5 from "./i18n_b5";
import B6 from "./i18n_b6";
import B7 from "./i18n_b7";
import B8 from "./i18n_b8";
import B9 from "./i18n_b9";
import B10 from "./i18n_b10";

export type Lang = "de" | "en";

let LANG: Lang = "de";
export function setLang(l: Lang): void { LANG = l; }
export function getLang(): Lang { return LANG; }
export function localeFor(l: Lang): string { return l === "en" ? "en-US" : "de-DE"; }

/** DE → EN. Nur Einträge, die aktiv übersetzt sind; alles andere fällt auf DE zurück. */
const SHELL: Record<string, string> = {
  // — Sidebar-Gruppen —
  "Steuerung": "Control",
  "Annahmen & Kulturen": "Assumptions & Crops",
  "Maschinen & Flotte": "Machinery & Fleet",
  "Wachstum": "Growth",
  "Personal": "Personnel",
  "Financials": "Financials",
  "Analyse": "Analysis",
  "Verwaltung": "Administration",
  // — Sidebar-Einträge —
  "Executive Dashboard": "Executive Dashboard",
  "Anbauplan & Erträge": "Cropping Plan & Yields",
  "Kultur-Kalkulation (Maßnahmen + Katalog)": "Crop Costing (Operations + Catalog)",
  "Anbaustrategie & Fruchtfolge": "Cropping Strategy & Rotation",
  "Wertkulturen-Hebel (Gesellschafter)": "Value-Crop Lever (Shareholder)",
  "Arbeitsgänge": "Field Operations",
  "Maschinen-Register (Bestand)": "Machinery Register (Owned)",
  "Investitionen (Neuanschaffungen)": "Investments (New Purchases)",
  "CAPEX Szenarien": "CAPEX Scenarios",
  "Leistungsparameter": "Performance Parameters",
  "Einsatzplanung": "Deployment Planning",
  "Ersatzinvestitionen": "Replacement CAPEX",
  "Wachstum & Mehrjahresplan": "Growth & Multi-Year Plan",
  "Personalplanung": "Personnel Planning",
  "Overhead / SG&A": "Overhead / SG&A",
  "Arbeitszeitkonto": "Working-Time Account",
  "Finanzierung": "Financing",
  "Subventionen": "Subsidies",
  "Gesellschaften-Register": "Entities Register",
  "Holding (Zypern)": "Holding (Cyprus)",
  "Eröffnungsbilanz": "Opening Balance Sheet",
  "Pacht-Simulator": "Lease Simulator",
  "Makro & Finanzen": "Macro & Finance",
  "GuV": "P&L",
  "Bilanz": "Balance Sheet",
  "Cashflow": "Cash Flow",
  "Liquidität & USt/TVA": "Liquidity & VAT",
  "Contribution": "Contribution",
  "Sensitivität": "Sensitivity",
  "Bewertung (DCF)": "Valuation (DCF)",
  "Equity & Ausschüttung": "Equity & Distribution",
  "Speichern & Versionen": "Save & Versions",
  "Hauptnavigation": "Main navigation",
  "NEOS FX · powered by": "NEOS FX · powered by",
  // — TopBar —
  "Szenario": "Scenario",
  "Stufe": "Stage",
  "Umfang": "Scope",
  "Zeit": "Time",
  "Voll-Rotation": "Full Rotation",
  "Nur Wertkulturen": "Value Crops Only",
  "Monat": "Month",
  "Quartal": "Quarter",
  "Jahr": "Year",
  "Hell": "Light",
  "Dunkel": "Dark",
  "Theme umschalten": "Toggle theme",
  "● Neu berechnet": "● Recalculated",
  "Aktuell": "Current",
  "Nicht konvergiert": "Not converged",
  "Bilanz = 0": "Balance = 0",
  "Bilanz Δ": "Balance Δ",
  "Cloud: lädt …": "Cloud: loading …",
  "Cloud: speichert …": "Cloud: saving …",
  "Cloud: gespeichert": "Cloud: saved",
  "Cloud: offline (JSON-Export nutzen)": "Cloud: offline (use JSON export)",
  "Automatisches Speichern in der Team-Cloud (Supabase). Beim Start wird der letzte Stand geladen.": "Automatic save to the team cloud (Supabase). The last state loads on startup.",
  "1 = nur Ackerbau (Benchmark) · 1a = + Wertkulturen · 2b = + Vollberegnung · 3c = + Fläche & Beregnung":
    "1 = arable only (benchmark) · 1a = + value crops · 2b = + full irrigation · 3c = + area & irrigation",
  // — KpiBand —
  "Kennzahlen": "Key Figures",
  "Umsatz p.a.": "Revenue p.a.",
  "Jahresüberschuss": "Net Income",
  "Free Cash Flow": "Free Cash Flow",
  "EBITDA-Marge": "EBITDA Margin",
  "operatives Ergebnis": "operating result",
  "nach Abschreibung": "after depreciation",
  "nach Zins & Steuer": "after interest & tax",
  "EBIT / eing. Kapital": "EBIT / capital employed",
  // — Stufen-Semantik —
  "Stufen-Semantik · der Buchstabe kodiert die zusätzliche Stellschraube":
    "Stage semantics · the letter encodes the added lever",
  "Basis · nur Ackerbau": "Base · arable only",
  "+ Wertkulturen": "+ value crops",
  "+ Vollberegnung": "+ full irrigation",
  "+ Fläche & Beregnung": "+ area & irrigation",
  "Status quo ohne Wertkulturen — reine Cash-Crop-Rotation (Getreide/Raps/Mais/Soja). Benchmark.":
    "Status quo without value crops — pure cash-crop rotation (cereals/rapeseed/maize/soy). Benchmark.",
  "a = Anbau der Wertkulturen (Gemüse/Kartoffel) auf der heutigen Beregnungsfläche.":
    "a = growing value crops (vegetables/potatoes) on today's irrigated area.",
  "b = Beregnung: gesamte Betriebsfläche unter Beregnung, keine Flächenzukäufe.":
    "b = irrigation: entire farm area under irrigation, no land acquisitions.",
  "c = Fläche + Beregnung: Zukauf/Übernahme bis zum Zielausbau (20.000 ha).":
    "c = area + irrigation: acquisition/takeover up to the target build-out (20,000 ha).",
  // — KpiBand-Bausteine —
  "inkl.": "incl.",
  "Subv.": "subsidies",
};

/** Gesamtwörterbuch: Shell + alle View-Blöcke (Spread-Merge, spätere gewinnen bei Kollision). */
const EN: Record<string, string> = { ...SHELL, ...B1, ...B2, ...B3, ...B4, ...B5, ...B6, ...B7, ...B8, ...B9, ...B10 };

export function t(de: string): string {
  if (LANG === "de") return de;
  return EN[de] ?? de;
}
