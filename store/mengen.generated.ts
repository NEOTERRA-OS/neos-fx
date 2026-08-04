/* ERZEUGT — NICHT VON HAND AENDERN.
 *
 * Quelle:  neos-compendium — data/legacy/cfg_mengen.csv
 * Erzeugt: build/export_fx_mengen.py  ·  2026-08-04
 *
 * Das Mengengeruest je Anbaukonfiguration. NEOS FX LIEST daraus; es pflegt
 * keine Aussaatstaerken und keine Beregnungsnormen — die haben hier einen
 * Belegstatus und eine Historie.
 *
 * `beregnungBruttoMm` ist die Zahl, auf die Wasser und Energie bezahlt
 * werden. `beregnungNettoMm` ist, was bei der Pflanze ankommt. Wer mit netto
 * kalkuliert, unterschaetzt die Beregnungskosten um den Systemwirkungsgrad.
 */

export interface MengenGeruest {
  cfgId: string;
  kultur: string;
  konfiguration: string;
  /** Aussaat-/Pflanzgutmenge in der Einheit, die zu dieser Kultur passt. */
  saatMenge: number;
  saatEinheit: string;
  /** Ertragserwartung und Spanne (t/ha) — die Basis der Konfiguration. */
  ertragTHa: number; ertragVon: number; ertragBis: number;
  /** Beregnung: netto an der Pflanze, brutto durch die Pumpe. */
  beregnungNettoMm: number; beregnungBruttoMm: number; beregnungGaben: number;
  /** Arbeitszeit je Hektar (Akh) — Schlepperarbeit und Handarbeit getrennt. */
  akhSchlepper: number; akhHand: number;
  ueberfahrten: number;
  evidence: string;
}

export const MENGEN_GERUEST: MengenGeruest[] = [
  { cfgId: "potFryVHK", kultur: "Kartoffel", konfiguration: "Pommes vorgezogene Hauptkultur (Konfig A)", saatMenge: 2.3, saatEinheit: "t Pflanzgut/ha", ertragTHa: 45.0, ertragVon: 40.0, ertragBis: 50.0, beregnungNettoMm: 387.0, beregnungBruttoMm: 613.0, beregnungGaben: 50.0, akhSchlepper: 8.7, akhHand: 3.3, ueberfahrten: 37.0, evidence: "PROVEN" },
  { cfgId: "potChpVHK", kultur: "Kartoffel", konfiguration: "Chips vorgezogene Hauptkultur (Konfig A)", saatMenge: 2.5, saatEinheit: "t Pflanzgut/ha", ertragTHa: 42.0, ertragVon: 38.0, ertragBis: 46.0, beregnungNettoMm: 405.0, beregnungBruttoMm: 643.0, beregnungGaben: 50.0, akhSchlepper: 8.69, akhHand: 3.31, ueberfahrten: 36.0, evidence: "PROVEN" },
  { cfgId: "potFrySEC", kultur: "Kartoffel", konfiguration: "Pommes Zweitkultur nach Wintergerste (Konfig B)", saatMenge: 2.6, saatEinheit: "t Pflanzgut/ha (Kaltlagerware)", ertragTHa: 30.0, ertragVon: 25.0, ertragBis: 35.0, beregnungNettoMm: 287.0, beregnungBruttoMm: 455.0, beregnungGaben: 45.0, akhSchlepper: 7.23, akhHand: 4.77, ueberfahrten: 31.0, evidence: "PROVEN" },
  { cfgId: "potChpSEC", kultur: "Kartoffel", konfiguration: "Chips Zweitkultur nach Wintergerste (Konfig B)", saatMenge: 2.6, saatEinheit: "t Pflanzgut/ha (Kaltlagerware)", ertragTHa: 28.0, ertragVon: 24.0, ertragBis: 32.0, beregnungNettoMm: 300.0, beregnungBruttoMm: 475.0, beregnungGaben: 45.0, akhSchlepper: 7.21, akhHand: 4.79, ueberfahrten: 30.0, evidence: "DERIVED" },
  { cfgId: "potFresh", kultur: "Kartoffel", konfiguration: "Fruehkartoffel Frischmarkt unter Vlies (Konfig C)", saatMenge: 2.0, saatEinheit: "t Pflanzgut/ha", ertragTHa: 32.0, ertragVon: 26.0, ertragBis: 36.0, beregnungNettoMm: 261.0, beregnungBruttoMm: 413.0, beregnungGaben: 27.0, akhSchlepper: 6.43, akhHand: 9.57, ueberfahrten: 21.0, evidence: "PROVEN" },
  { cfgId: "potNorm", kultur: "Kartoffel", konfiguration: "Hauptkultur Normaltermin (nur Referenz, verworfen)", saatMenge: 2.3, saatEinheit: "t Pflanzgut/ha", ertragTHa: 45.0, ertragVon: 35.0, ertragBis: 50.0, beregnungNettoMm: 401.0, beregnungBruttoMm: 635.0, beregnungGaben: 50.0, akhSchlepper: 8.7, akhHand: 3.3, ueberfahrten: 37.0, evidence: "DERIVED" },
  { cfgId: "tomInd", kultur: "Industrietomate", konfiguration: "Verarbeitungstomate Once-over-Ernte", saatMenge: 32000.0, saatEinheit: "Jungpflanzen/ha (+3 % Reserve)", ertragTHa: 82.0, ertragVon: 70.0, ertragBis: 95.0, beregnungNettoMm: 542.0, beregnungBruttoMm: 860.0, beregnungGaben: 51.0, akhSchlepper: 10.4, akhHand: 14.6, ueberfahrten: 45.0, evidence: "PROVEN" },
  { cfgId: "onDry", kultur: "Zwiebel", konfiguration: "Trockenzwiebel aus Steckzwiebel", saatMenge: 900.0, saatEinheit: "kg Steckzwiebel/ha (14/21 mm)", ertragTHa: 45.0, ertragVon: 38.0, ertragBis: 52.0, beregnungNettoMm: 413.0, beregnungBruttoMm: 655.0, beregnungGaben: 38.0, akhSchlepper: 12.12, akhHand: 17.88, ueberfahrten: 31.0, evidence: "PROVEN" },
  { cfgId: "carSum", kultur: "Moehre", konfiguration: "Moehre Sommersaat (Berlicum/Flakkee)", saatMenge: 1.45, saatEinheit: "Mio Korn/ha (Praezisionssaatgut)", ertragTHa: 60.0, ertragVon: 50.0, ertragBis: 70.0, beregnungNettoMm: 330.0, beregnungBruttoMm: 523.0, beregnungGaben: 35.0, akhSchlepper: 14.09, akhHand: 20.91, ueberfahrten: 19.0, evidence: "PROVEN" },
  { cfgId: "beeRed", kultur: "Rote Bete", konfiguration: "Rote Bete Sommersaat", saatMenge: 0.78, saatEinheit: "Mio Korn/ha (monogerm)", ertragTHa: 50.0, ertragVon: 42.0, ertragBis: 58.0, beregnungNettoMm: 284.0, beregnungBruttoMm: 450.0, beregnungGaben: 17.0, akhSchlepper: 11.85, akhHand: 13.15, ueberfahrten: 27.0, evidence: "PROVEN" },
  { cfgId: "cabAut", kultur: "Weisskohl", konfiguration: "Weisskohl Herbst, Verarbeitungsschiene", saatMenge: 33000.0, saatEinheit: "Jungpflanzen/ha", ertragTHa: 70.0, ertragVon: 60.0, ertragBis: 85.0, beregnungNettoMm: 368.0, beregnungBruttoMm: 583.0, beregnungGaben: 20.0, akhSchlepper: 13.54, akhHand: 31.46, ueberfahrten: 28.0, evidence: "PROVEN" },
  { cfgId: "swePot", kultur: "Suesskartoffel", konfiguration: "Suesskartoffel orangefleischig, Dammkultur", saatMenge: 38000.0, saatEinheit: "Stecklinge (Slips)/ha", ertragTHa: 32.0, ertragVon: 25.0, ertragBis: 38.0, beregnungNettoMm: 452.0, beregnungBruttoMm: 717.0, beregnungGaben: 22.0, akhSchlepper: 15.27, akhHand: 44.73, ueberfahrten: 19.0, evidence: "PROVEN" },
  { cfgId: "watMel", kultur: "Wassermelone", konfiguration: "Wassermelone veredelt, Pivot ohne Mulchfolie (Option B)", saatMenge: 4500.0, saatEinheit: "veredelte Jungpflanzen/ha (inkl. Bestaeuber)", ertragTHa: 30.0, ertragVon: 24.0, ertragBis: 36.0, beregnungNettoMm: 180.0, beregnungBruttoMm: 285.0, beregnungGaben: 12.0, akhSchlepper: 10.75, akhHand: 59.25, ueberfahrten: 17.0, evidence: "PROVEN" },
  { cfgId: "maize", kultur: "Koernermais", konfiguration: "Koernermais bewaessert FAO 400-500", saatMenge: 85000.0, saatEinheit: "Koerner/ha", ertragTHa: 12.0, ertragVon: 10.0, ertragBis: 14.0, beregnungNettoMm: 432.0, beregnungBruttoMm: 574.0, beregnungGaben: 25.0, akhSchlepper: 0.9, akhHand: 0.1, ueberfahrten: 16.0, evidence: "PROVEN" },
  { cfgId: "wheat", kultur: "Winterweizen", konfiguration: "Winterweizen bewaessert", saatMenge: 395.0, saatEinheit: "Koerner/m2", ertragTHa: 7.0, ertragVon: 6.0, ertragBis: 8.0, beregnungNettoMm: 299.0, beregnungBruttoMm: 397.0, beregnungGaben: 15.0, akhSchlepper: 0.89, akhHand: 0.11, ueberfahrten: 19.0, evidence: "PROVEN" },
  { cfgId: "barley", kultur: "Wintergerste", konfiguration: "Wintergerste mehrzeilig, Vorfrucht der Kartoffel-Zweitkultur", saatMenge: 305.0, saatEinheit: "Koerner/m2", ertragTHa: 6.5, ertragVon: 5.5, ertragBis: 7.5, beregnungNettoMm: 120.0, beregnungBruttoMm: 190.0, beregnungGaben: 6.0, akhSchlepper: 0.9, akhHand: 0.1, ueberfahrten: 19.0, evidence: "DERIVED" },
  { cfgId: "sunFlw", kultur: "Sonnenblume", konfiguration: "Sonnenblume Clearfield/ExpressSun, Orobanche-resistent", saatMenge: 65000.0, saatEinheit: "Pflanzen/ha", ertragTHa: 3.8, ertragVon: 3.2, ertragBis: 4.4, beregnungNettoMm: 233.0, beregnungBruttoMm: 369.0, beregnungGaben: 14.0, akhSchlepper: 1.03, akhHand: 0.17, ueberfahrten: 18.0, evidence: "DERIVED" },
  { cfgId: "soyBn", kultur: "Soja", konfiguration: "Soja RG I, IDC-tolerant, geimpft", saatMenge: 550000.0, saatEinheit: "Koerner/ha", ertragTHa: 3.5, ertragVon: 2.8, ertragBis: 4.2, beregnungNettoMm: 310.0, beregnungBruttoMm: 491.0, beregnungGaben: 18.0, akhSchlepper: 0.96, akhHand: 0.24, ueberfahrten: 17.0, evidence: "DERIVED" },
  { cfgId: "covCrop", kultur: "Zwischenfrucht", konfiguration: "Sudangras/Sorghum-Sudan-Hybride als Gruenduengung", saatMenge: 30.0, saatEinheit: "kg/ha", ertragTHa: 0.0, ertragVon: 0.0, ertragBis: 0.0, beregnungNettoMm: 138.0, beregnungBruttoMm: 219.0, beregnungGaben: 9.0, akhSchlepper: 0.74, akhHand: 0.06, ueberfahrten: 8.0, evidence: "DERIVED" },
  { cfgId: "cucEarly", kultur: "Feldgurke", konfiguration: "Einlegegurke Fruehkultur, Einmalernte unter Vlies", saatMenge: 150000.0, saatEinheit: "Koerner/ha (Direktsaat)", ertragTHa: 15.0, ertragVon: 12.0, ertragBis: 18.0, beregnungNettoMm: 263.0, beregnungBruttoMm: 417.0, beregnungGaben: 29.0, akhSchlepper: 9.39, akhHand: 40.61, ueberfahrten: 24.0, evidence: "DERIVED" },
  { cfgId: "garWin", kultur: "Knoblauch", konfiguration: "Winterknoblauch, Herbststeckung", saatMenge: 1000.0, saatEinheit: "kg/ha Pflanzknoblauch (ca. 300.000 Zehen)", ertragTHa: 9.0, ertragVon: 7.0, ertragBis: 11.0, beregnungNettoMm: 180.0, beregnungBruttoMm: 285.0, beregnungGaben: 6.0, akhSchlepper: 12.55, akhHand: 46.55, ueberfahrten: 16.0, evidence: "DERIVED" },
  { cfgId: "celRoot", kultur: "Knollensellerie", konfiguration: "Knollensellerie Verarbeitungsschiene", saatMenge: 50000.0, saatEinheit: "Jungpflanzen/ha (Presstoepfe)", ertragTHa: 42.0, ertragVon: 34.0, ertragBis: 50.0, beregnungNettoMm: 395.0, beregnungBruttoMm: 626.0, beregnungGaben: 11.0, akhSchlepper: 15.26, akhHand: 50.3, ueberfahrten: 23.0, evidence: "DERIVED" },
];
