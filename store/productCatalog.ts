/* ==========================================================================
 * NEOS FX · Produktkatalog (Dünger, PSM, Blattdünger/Biostimulanzien, Beizung, Sorten)
 * ------------------------------------------------------------------------
 * Entscheidungshilfe je Maßnahme: schlägt zur jeweiligen Maßnahme (Düngung, PSM,
 * Aussaat) passende reale Produkte vor. Rumänien-Anker (MADR/PMDR-Register)
 * priorisiert, EU-/Hersteller-Alternativen als Zusatz mit Flag.
 *
 * SYNC-READY: jede Position hat eine stabile id + source + updatedAt, damit der
 * Katalog später mit dem Produktkatalog der NEOS Web App abgeglichen/gemerged
 * werden kann (exportProductCatalog()).
 *
 * ⚠ RECHTLICHER HINWEIS: Zulassungen ändern sich. Vor Einsatz jedes Produkt gegen
 * das aktuelle rumänische Register prüfen — PSM/Beizung: baza de date MADR/PMDR
 * (produse de protecția plantelor omologate); Sorten: ISTIS Catalog oficial.
 * ======================================================================== */

export type ProductCategory =
  | "fertilizer"      // Mineraldünger (Boden)
  | "foliar"          // Blattdünger / Mikronährstoffe
  | "biostimulant"    // Biostimulanzien
  | "psm"             // Pflanzenschutzmittel
  | "seed_treatment"  // Beizung / Saatgutbehandlung
  | "seed_variety";   /* Sorte / Hybride — NUR NOCH fuer Kulturen ohne Sortenplan.
                        *
                        * Die Kartoffelsorten sind am 04.08.2026 hier ausgezogen. Sie
                        * standen als reine Vorschlagsliste da (Innovator, Lady Rosetta),
                        * ohne Wirkung auf irgendeine Zahl, und widersprachen dem
                        * Sortenplan (Markies/Quintera/Zorba), der die Schlagbildung
                        * treibt. Zwei Register fuer dieselbe Frage, ohne Beruehrung.
                        *
                        * Der Ort der Sortenkunde ist das KOMPENDIUM: 55 Sorten mit
                        * Fakten, Quellen und Ranking. FX liest sie ueber
                        * `store/sorten.generated.ts` und waehlt daraus im Anbauplan.
                        * Ebenfalls entfernt: Weizen, Gerste, Raps, Mais und Soja —
                        * Kulturen, die der Betrieb seit NEOTERRA-Solo nicht faehrt. */

export type PsmType = "herbicide" | "fungicide" | "insecticide" | "growth_regulator";
export type RoAuth = "yes" | "no" | "unknown";

export type ActiveIngredient = { name: string; content: string };
export type Nutrients = Partial<Record<"N" | "P2O5" | "K2O" | "S" | "MgO" | "CaO" | "B" | "Zn" | "Mn" | "Cu" | "Mo", number>>;

export type CatalogProduct = {
  id: string;                         // stabiler Slug (Sync-Schlüssel)
  source: "neosfx" | "neos-web" | "user" | "merged";
  category: ProductCategory;
  psmType?: PsmType | null;
  name: string;
  manufacturer: string;
  activeIngredients?: ActiveIngredient[];
  formulation?: string | null;
  nutrients?: Nutrients;              // fertilizer/foliar (% bzw. g/l — s. note)
  rateMin?: number | null;
  rateMax?: number | null;
  rateUnit?: string | null;          // l/ha, kg/ha, …
  crops: string[];                    // cropIds oder ["*"] (breit)
  targets?: string[];                 // Indikationen / Nährstofffunktion
  bbchFrom?: number | null;
  bbchTo?: number | null;
  roAuthorized: RoAuth;               // in RO zugelassen?
  authNumber?: string | null;         // RO-Omologare-Nr. (falls belegt)
  phiDays?: number | null;            // Wartezeit (PHI)
  priceCentPerUnit?: number | null;   // optional (editierbar)
  note?: string;
  updatedAt?: string;                 // ISO / YYYY-MM-DD
};

const D = "2026-07-27";
const N = (p: Omit<CatalogProduct, "source" | "updatedAt">): CatalogProduct => ({ source: "neosfx", updatedAt: D, ...p });

/* --------------------------------------------------------------------------
 * SEED-KATALOG — recherchiert 2026-07 (RO-Anker). Zahlen nach Herstellerlabel.
 * ------------------------------------------------------------------------ */
export const DEFAULT_PRODUCTS: CatalogProduct[] = [
  // ===== MINERALDÜNGER =====
  N({ id: "fert-azomures-uree-46", category: "fertilizer", name: "Uree 46 (Harnstoff)", manufacturer: "Azomureș", formulation: "granuliert", nutrients: { N: 46 }, rateMin: 100, rateMax: 250, rateUnit: "kg/ha", crops: ["*"], targets: ["N-Grunddüngung", "N-Kopf"], roAuthorized: "yes", note: "Höchstkonzentrierter N-Feststoff; möglichst eingearbeitet (NH₃-Verluste)." }),
  N({ id: "fert-azomures-an-335", category: "fertilizer", name: "Azotat de amoniu 33,5 (AN)", manufacturer: "Azomureș", formulation: "granuliert/prilliert", nutrients: { N: 33.5 }, rateMin: 100, rateMax: 300, rateUnit: "kg/ha", crops: ["*"], targets: ["N-Kopf", "N-Grunddüngung"], roAuthorized: "yes", note: "RO-Standard-Ammoniumnitrat (halb Nitrat/halb Ammonium)." }),
  N({ id: "fert-azomures-can-27", category: "fertilizer", name: "Nitrocalcar CAN 27", manufacturer: "Azomureș", formulation: "granuliert", nutrients: { N: 27, CaO: 7, MgO: 5 }, rateMin: 150, rateMax: 350, rateUnit: "kg/ha", crops: ["*"], targets: ["N-Kopf", "Ca", "Mg"], roAuthorized: "yes", note: "Kalkammonsalpeter mit Dolomit; bodenschonende N-Kopfdüngung." }),
  N({ id: "fert-as-21-24s", category: "fertilizer", name: "Sulfat de amoniu 21+24S", manufacturer: "diverse (Handelsware)", formulation: "kristallin/granuliert", nutrients: { N: 21, S: 24 }, rateMin: 100, rateMax: 300, rateUnit: "kg/ha", crops: ["*"], targets: ["N-Kopf", "S"], roAuthorized: "unknown", note: "Reiner Ammonium-N + hoher Schwefel; leicht ansäuernd (Raps)." }),
  N({ id: "fert-azomures-uan-32", category: "fertilizer", name: "URAN / UAN 32 (Lösung)", manufacturer: "Azomureș", formulation: "Lösung", nutrients: { N: 32 }, rateMin: 150, rateMax: 350, rateUnit: "kg/ha", crops: ["*"], targets: ["N-Kopf", "N-Grunddüngung"], roAuthorized: "yes", note: "Flüssige N-Lösung für Schleppschlauch/Injektion; auch mit ATS (S)." }),
  N({ id: "fert-azomures-npk-161616", category: "fertilizer", name: "NPK 16-16-16 (AZOStart)", manufacturer: "Azomureș", formulation: "granuliert", nutrients: { N: 16, P2O5: 16, K2O: 16 }, rateMin: 200, rateMax: 400, rateUnit: "kg/ha", crops: ["*"], targets: ["N-Grunddüngung", "P/K-Grund"], roAuthorized: "yes", note: "Ausgewogener Volldünger für Grunddüngung aller Kulturen." }),
  N({ id: "fert-azomures-npk-2020", category: "fertilizer", name: "NPK 20-20-0 (AZOStart)", manufacturer: "Azomureș", formulation: "granuliert", nutrients: { N: 20, P2O5: 20 }, rateMin: 150, rateMax: 350, rateUnit: "kg/ha", crops: ["*"], targets: ["N-Grunddüngung", "P/K-Grund"], roAuthorized: "yes", note: "NP-Starter/Grunddünger; auch als plusSULF (mit S)." }),
  N({ id: "fert-azomures-npk-2713", category: "fertilizer", name: "NPK 27-13,5-0", manufacturer: "Azomureș", formulation: "granuliert", nutrients: { N: 27, P2O5: 13.5 }, rateMin: 150, rateMax: 350, rateUnit: "kg/ha", crops: ["*"], targets: ["N-Grunddüngung", "P/K-Grund"], roAuthorized: "yes", note: "N-betonter NP-Dünger für Getreide-Frühjahrsstart." }),
  N({ id: "fert-dap-1846", category: "fertilizer", name: "DAP 18-46-0", manufacturer: "diverse (EuroChem/OCP)", formulation: "granuliert", nutrients: { N: 18, P2O5: 46 }, rateMin: 100, rateMax: 200, rateUnit: "kg/ha", crops: ["*"], targets: ["P/K-Grund", "P-Start"], roAuthorized: "unknown", note: "Diammoniumphosphat, hochkonzentrierter P-Grunddünger mit Start-N." }),
  N({ id: "fert-map-1252", category: "fertilizer", name: "MAP 12-52-0", manufacturer: "diverse (Handelsware)", formulation: "granuliert", nutrients: { N: 12, P2O5: 52 }, rateMin: 80, rateMax: 150, rateUnit: "kg/ha", crops: ["*"], targets: ["P-Start", "P/K-Grund"], roAuthorized: "unknown", note: "Monoammoniumphosphat, leicht sauer; guter Reihen-Startdünger." }),
  N({ id: "fert-mop-060", category: "fertilizer", name: "Kaliumchlorid / MOP 0-0-60", manufacturer: "diverse (EuroChem/K+S/ICL)", formulation: "granuliert", nutrients: { K2O: 60 }, rateMin: 100, rateMax: 400, rateUnit: "kg/ha", crops: ["*"], targets: ["K-Grund"], roAuthorized: "unknown", note: "Preiswerteste K-Quelle; chloridhaltig — nicht für chloridempfindliche Kulturen." }),
  N({ id: "fert-sop-050", category: "fertilizer", name: "Kaliumsulfat / SOP 0-0-50 +S", manufacturer: "K+S / Tessenderlo", formulation: "granuliert", nutrients: { K2O: 50, S: 18 }, rateMin: 100, rateMax: 300, rateUnit: "kg/ha", crops: ["tomate", "kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre", "knoblauch", "knollensellerie", "suesskartoffel"], targets: ["K-Grund", "S"], roAuthorized: "unknown", note: "Chloridfreies Kalium + S; für chloridempfindliche Kartoffel/Gemüse." }),
  N({ id: "fert-kornkali-40", category: "fertilizer", name: "Korn-Kali 40 (+6MgO +4S)", manufacturer: "K+S", formulation: "granuliert", nutrients: { K2O: 40, MgO: 6, S: 4 }, rateMin: 200, rateMax: 500, rateUnit: "kg/ha", crops: ["*"], targets: ["K-Grund", "Mg", "S"], roAuthorized: "unknown", note: "K-Grunddünger mit Mg und S (teils chloridhaltig)." }),
  N({ id: "fert-kieserit", category: "fertilizer", name: "ESTA Kieserit GRAN. (25MgO +S)", manufacturer: "K+S", formulation: "granuliert", nutrients: { MgO: 25, S: 20.8 }, rateMin: 100, rateMax: 300, rateUnit: "kg/ha", crops: ["*"], targets: ["Mg", "S"], roAuthorized: "unknown", note: "Wasserlösliches Magnesiumsulfat, chloridfrei; gezielte Mg+S-Versorgung." }),
  N({ id: "fert-polysulphate", category: "fertilizer", name: "Polysulphate 0-0-14 (+MgO/CaO/S)", manufacturer: "ICL", formulation: "granuliert", nutrients: { K2O: 14, S: 19.2, MgO: 6, CaO: 17 }, rateMin: 100, rateMax: 300, rateUnit: "kg/ha", crops: ["*"], targets: ["S", "K-Grund", "Mg", "Ca"], roAuthorized: "unknown", note: "Natürlicher Polyhalit; S/K/Mg/Ca mit langer Freisetzung, chloridarm." }),
  N({ id: "fert-yarabela-sulfan", category: "fertilizer", name: "YaraBela SULFAN 24 (+6S)", manufacturer: "Yara", formulation: "granuliert", nutrients: { N: 24, S: 6, CaO: 10.6 }, rateMin: 150, rateMax: 350, rateUnit: "kg/ha", crops: ["*"], targets: ["N-Kopf", "S"], roAuthorized: "unknown", note: "Ammonsulfatsalpeter (N:S 4:1); hohe S-Versorgung für Raps/Getreide." }),
  N({ id: "fert-yarabela-axan", category: "fertilizer", name: "YaraBela AXAN 27 (+3,6S)", manufacturer: "Yara", formulation: "granuliert", nutrients: { N: 27, S: 3.6 }, rateMin: 150, rateMax: 350, rateUnit: "kg/ha", crops: ["*"], targets: ["N-Kopf", "S"], roAuthorized: "unknown", note: "CAN-Typ mit etwas S; gleichmäßiges Streubild, Nitratanteil." }),
  N({ id: "fert-yaramila-complex", category: "fertilizer", name: "YaraMila COMPLEX 12-11-18 (+S/Mg)", manufacturer: "Yara", formulation: "granuliert", nutrients: { N: 12, P2O5: 11, K2O: 18, S: 8, MgO: 2.7 }, rateMin: 200, rateMax: 500, rateUnit: "kg/ha", crops: ["*"], targets: ["N-Grunddüngung", "P/K-Grund", "S", "Mg"], roAuthorized: "unknown", note: "K-betonter Volldünger mit S/Mg + Mikronährstoffe (jedes Korn NPK)." }),
  N({ id: "fert-yaraliva-nitrabor", category: "fertilizer", name: "YaraLiva Nitrabor 15,4 (+Ca/B)", manufacturer: "Yara", formulation: "granuliert", nutrients: { N: 15.4, CaO: 25.9, B: 0.3 }, rateMin: 100, rateMax: 300, rateUnit: "kg/ha", crops: ["winterraps", "tomate", "zwiebel_moehre", "knoblauch", "knollensellerie", "suesskartoffel"], targets: ["Ca", "N-Kopf", "B"], roAuthorized: "unknown", note: "Kalksalpeter mit Bor für Ca/B-Versorgung von Gemüse & Raps." }),
  N({ id: "fert-yaraliva-calcinit", category: "fertilizer", name: "YaraLiva Calcinit 15,5 (+Ca)", manufacturer: "Yara", formulation: "wasserlöslich", nutrients: { N: 15.5, CaO: 26.5 }, rateMin: 50, rateMax: 200, rateUnit: "kg/ha", crops: ["tomate", "kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre", "knoblauch", "knollensellerie", "suesskartoffel"], targets: ["Ca", "N-Kopf", "Fertigation"], roAuthorized: "unknown", note: "Voll wasserlöslicher Kalksalpeter für Fertigation/Tröpfchen (Ca-Mangel)." }),
  N({ id: "fert-entec-26", category: "fertilizer", name: "ENTEC 26 (26N +13S)", manufacturer: "EuroChem", formulation: "granuliert", nutrients: { N: 26, S: 13 }, rateMin: 150, rateMax: 350, rateUnit: "kg/ha", crops: ["*"], targets: ["N-Kopf", "N-Grunddüngung", "S"], roAuthorized: "unknown", note: "Stabilisierter N+S-Dünger mit Nitrifikationshemmer DMPP." }),
  N({ id: "fert-nitroammofoska-161616", category: "fertilizer", name: "Nitroammofoska NPK 16-16-16", manufacturer: "EuroChem", formulation: "granuliert", nutrients: { N: 16, P2O5: 16, K2O: 16 }, rateMin: 200, rateMax: 400, rateUnit: "kg/ha", crops: ["*"], targets: ["N-Grunddüngung", "P/K-Grund"], roAuthorized: "unknown", note: "Ausgewogener Komplexdünger; Alternative zum Azomureș-16-16-16." }),
  N({ id: "fert-timac-sulfammo", category: "fertilizer", name: "Sulfammo 25 MPPA DUO (+S/Mg)", manufacturer: "Timac Agro", formulation: "granuliert", nutrients: { N: 25, S: 12.4, MgO: 2 }, rateMin: 150, rateMax: 350, rateUnit: "kg/ha", crops: ["*"], targets: ["N-Kopf", "S", "Mg"], roAuthorized: "yes", note: "NS(Mg)-Dünger mit MPPA-DUO-Technologie (N-Effizienz)." }),
  N({ id: "fert-timac-start-201005", category: "fertilizer", name: "Timac Start 20-10-5 MPPA DUO", manufacturer: "Timac Agro", formulation: "granuliert (Microgran)", nutrients: { N: 20, P2O5: 10, K2O: 5, S: 10.4, B: 0.1 }, rateMin: 80, rateMax: 200, rateUnit: "kg/ha", crops: ["mais", "kartoffel_pommes", "kartoffel_chips", "tomate", "zwiebel_moehre", "knollensellerie", "suesskartoffel"], targets: ["P-Start", "N-Grunddüngung", "S"], roAuthorized: "yes", note: "Reihen-/Mikrogranulat-Starter mit S + Spurennährstoffen (Zn/Mn)." }),

  // ===== PSM · GETREIDE =====
  N({ id: "psm-pallas-75wg", category: "psm", psmType: "herbicide", name: "Pallas 75 WG", manufacturer: "Corteva", activeIngredients: [{ name: "Pyroxsulam", content: "75 g/kg" }], formulation: "WG", rateMin: 0.11, rateMax: 0.25, rateUnit: "kg/ha", crops: ["weizen"], targets: ["Ungräser", "Windhalm", "Flughafer", "Unkräuter"], bbchFrom: 12, bbchTo: 32, roAuthorized: "yes", authNumber: "2829/30.04.2009", note: "Nachauflauf-Breitband (Ungräser + Unkräuter), nur Weizen; +Adjuvans." }),
  N({ id: "psm-axial-050ec", category: "psm", psmType: "herbicide", name: "Axial 050 EC", manufacturer: "Syngenta", activeIngredients: [{ name: "Pinoxaden", content: "50 g/l" }], formulation: "EC", rateMin: 0.9, rateMax: 0.9, rateUnit: "l/ha", crops: ["weizen", "gerste_zw"], targets: ["Ungräser", "Flughafer", "Windhalm"], roAuthorized: "yes", authNumber: "2748/19.12.2007", note: "Selektives Nachauflauf-Graminizid in Weizen/Gerste/Triticale/Roggen." }),
  N({ id: "psm-sekator-progress", category: "psm", psmType: "herbicide", name: "Sekator Progress OD", manufacturer: "Bayer", activeIngredients: [{ name: "Amidosulfuron", content: "100 g/l" }, { name: "Iodosulfuron-methyl-Na", content: "25 g/l" }], formulation: "OD", rateMin: 0.1, rateMax: 0.15, rateUnit: "l/ha", crops: ["weizen", "gerste_zw"], targets: ["Unkräuter", "Klettenlabkraut", "Ackerdistel", "Kamille"], roAuthorized: "yes", authNumber: "2550/21.04.2005", note: "Nachauflauf gegen breitblättrige Unkräuter; nicht in Hafer." }),
  N({ id: "psm-mustang", category: "psm", psmType: "herbicide", name: "Mustang", manufacturer: "Corteva", activeIngredients: [{ name: "Florasulam", content: "6,25 g/l" }, { name: "2,4-D EHE", content: "300 g/l" }], formulation: "SE", rateMin: 0.4, rateMax: 0.6, rateUnit: "l/ha", crops: ["weizen", "gerste_zw"], targets: ["Unkräuter", "Amaranthus", "Ambrosia", "Ackerdistel"], roAuthorized: "yes", authNumber: "1862/29.09.1998", phiDays: 21, note: "Nachauflauf gegen ein-/mehrjährige breitblättrige Unkräuter." }),
  N({ id: "psm-floramix", category: "psm", psmType: "herbicide", name: "Floramix", manufacturer: "BASF", activeIngredients: [{ name: "Pyroxsulam", content: "70,8 g/kg" }, { name: "Florasulam", content: "14,2 g/kg" }], formulation: "WG", rateMin: 0.12, rateMax: 0.26, rateUnit: "kg/ha", crops: ["weizen"], targets: ["Ungräser", "Windhalm", "Flughafer", "Unkräuter"], bbchFrom: 13, bbchTo: 32, roAuthorized: "unknown", note: "Kombiniertes Nachauflauf (Ungräser + Unkräuter); RO-Nr. nicht verifiziert." }),
  N({ id: "psm-lancelot-super", category: "psm", psmType: "herbicide", name: "Lancelot Super", manufacturer: "Corteva", activeIngredients: [{ name: "Aminopyralid", content: "300 g/kg" }, { name: "Florasulam", content: "150 g/kg" }], formulation: "WG", rateMin: 0.033, rateMax: 0.033, rateUnit: "kg/ha", crops: ["weizen", "gerste_zw"], targets: ["Unkräuter", "Ackerdistel", "Klettenlabkraut", "Kamille"], roAuthorized: "yes", note: "Nachauflauf gegen dikotyle Unkräuter; RO-Nr. nicht belegt." }),
  N({ id: "psm-priaxor-ec", category: "psm", psmType: "fungicide", name: "Priaxor EC", manufacturer: "BASF", activeIngredients: [{ name: "Fluxapyroxad", content: "75 g/l" }, { name: "Pyraclostrobin", content: "150 g/l" }], formulation: "EC", rateMin: 0.75, rateMax: 1.0, rateUnit: "l/ha", crops: ["weizen", "gerste_zw"], targets: ["Septoria", "Braunrost", "Mehltau", "Netzflecken"], bbchFrom: 25, bbchTo: 69, roAuthorized: "yes", note: "Blattfungizid (SDHI + Strobilurin) für Weizen/Gerste." }),
  N({ id: "psm-prosaro-250ec", category: "psm", psmType: "fungicide", name: "Prosaro 250 EC", manufacturer: "Bayer", activeIngredients: [{ name: "Prothioconazol", content: "125 g/l" }, { name: "Tebuconazol", content: "125 g/l" }], formulation: "EC", rateMin: 0.75, rateMax: 0.9, rateUnit: "l/ha", crops: ["weizen", "gerste_zw"], targets: ["Fusarium", "Septoria", "Rost", "Mehltau"], roAuthorized: "yes", authNumber: "2517/22.02.2005", phiDays: 35, note: "Azol-Kombi Blatt/Ähre; 0,9 l/ha bei Fusarium." }),
  N({ id: "psm-nativo-forte", category: "psm", psmType: "fungicide", name: "Nativo Forte 280 EC", manufacturer: "Bayer", activeIngredients: [{ name: "Prothioconazol", content: "93,3 g/l" }, { name: "Spiroxamin", content: "107 g/l" }, { name: "Trifloxystrobin", content: "80 g/l" }], formulation: "EC", rateMin: 1.2, rateMax: 1.5, rateUnit: "l/ha", crops: ["weizen", "gerste_zw"], targets: ["Septoria", "Gelbrost", "Braunrost", "Fusarium", "Netzflecken", "Ramularia"], bbchFrom: 30, bbchTo: 69, roAuthorized: "yes", authNumber: "722PC/07.12.2021", note: "Dreifach-Wirkstoff, breites Spektrum; max. 2 Behandlungen." }),
  N({ id: "psm-elatus-era", category: "psm", psmType: "fungicide", name: "Elatus Era", manufacturer: "Syngenta", activeIngredients: [{ name: "Benzovindiflupyr", content: "75 g/l" }, { name: "Prothioconazol", content: "150 g/l" }], formulation: "EC", rateMin: 0.5, rateMax: 1.0, rateUnit: "l/ha", crops: ["weizen", "gerste_zw"], targets: ["Fusarium", "Braunrost", "Gelbrost", "Septoria", "Rhynchosporium", "Ramularia"], bbchFrom: 31, bbchTo: 69, roAuthorized: "yes", note: "SDHI-Azol, 1 Behandlung/Jahr." }),
  N({ id: "psm-custodia-320sc", category: "psm", psmType: "fungicide", name: "Custodia 320 SC", manufacturer: "Adama", activeIngredients: [{ name: "Azoxystrobin", content: "120 g/l" }, { name: "Tebuconazol", content: "200 g/l" }], formulation: "SC", rateMin: 1.0, rateMax: 1.25, rateUnit: "l/ha", crops: ["weizen", "gerste_zw", "winterraps"], targets: ["Fusarium", "Rost", "Septoria", "Netzflecken"], bbchFrom: 30, bbchTo: 69, roAuthorized: "yes", phiDays: 35, note: "Strobilurin-Azol Ready-Mix für Getreide/Raps." }),
  N({ id: "psm-ascra-xpro", category: "psm", psmType: "fungicide", name: "Ascra Xpro", manufacturer: "Bayer", activeIngredients: [{ name: "Bixafen", content: "65 g/l" }, { name: "Fluopyram", content: "65 g/l" }, { name: "Prothioconazol", content: "130 g/l" }], formulation: "EC", rateMin: 1.2, rateMax: 1.5, rateUnit: "l/ha", crops: ["weizen", "gerste_zw"], targets: ["Septoria", "Braunrost", "Gelbrost", "Netzflecken", "Ramularia"], bbchFrom: 30, bbchTo: 61, roAuthorized: "unknown", note: "EU-Fungizid (2×SDHI + Azol); RO-Zulassung prüfen." }),
  N({ id: "psm-karate-zeon", category: "psm", psmType: "insecticide", name: "Karate Zeon", manufacturer: "Syngenta", activeIngredients: [{ name: "Lambda-Cyhalothrin", content: "50 g/l" }], formulation: "CS", rateMin: 0.1, rateMax: 0.2, rateUnit: "l/ha", crops: ["weizen", "gerste_zw", "winterraps", "mais", "kartoffel_pommes", "kartoffel_chips", "tomate", "zwiebel_moehre"], targets: ["Blattläuse", "Thrips", "Rapsglanzkäfer", "Kartoffelkäfer", "Maiszünsler"], roAuthorized: "yes", authNumber: "1812", phiDays: 7, note: "Pyrethroid (Zeon-Mikrokapsel); Aufwand je Kultur/Schädling variabel — Rotationspartner." }),
  N({ id: "psm-decis-expert", category: "psm", psmType: "insecticide", name: "Decis Expert 100 EC", manufacturer: "Bayer", activeIngredients: [{ name: "Deltamethrin", content: "100 g/l" }], formulation: "EC", rateMin: 0.0625, rateMax: 0.125, rateUnit: "l/ha", crops: ["weizen", "gerste_zw", "winterraps", "mais"], targets: ["Blattläuse", "Rapsglanzkäfer", "Rüssler", "Maiszünsler"], roAuthorized: "yes", authNumber: "123PC/22.07.2015", phiDays: 7, note: "Pyrethroid Kontakt/Fraß; Raps 0,075, Mais 0,125 l/ha." }),
  N({ id: "psm-mospilan-20sg", category: "psm", psmType: "insecticide", name: "Mospilan 20 SG", manufacturer: "Sumi Agro", activeIngredients: [{ name: "Acetamiprid", content: "200 g/kg" }], formulation: "SG", rateMin: 0.06, rateMax: 0.25, rateUnit: "kg/ha", crops: ["weizen", "gerste_zw", "winterraps", "kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre", "tomate"], targets: ["Getreidewanze", "Blattläuse", "Rapsglanzkäfer", "Kartoffelkäfer", "Thrips"], roAuthorized: "yes", authNumber: "2616/02.03.2006", phiDays: 14, note: "Systemisches Neonicotinoid; Aufwand je Kultur; nicht in die Blüte." }),
  N({ id: "psm-kaiso-sorbie", category: "psm", psmType: "insecticide", name: "Kaiso Sorbie 5 EG", manufacturer: "Nufarm", activeIngredients: [{ name: "Lambda-Cyhalothrin", content: "50 g/kg" }], formulation: "EG", rateMin: 0.15, rateMax: 0.15, rateUnit: "kg/ha", crops: ["weizen", "gerste_zw"], targets: ["Blattläuse", "Getreidewanze", "Getreidehähnchen"], roAuthorized: "yes", authNumber: "2739/19.12.2007", phiDays: 28, note: "Pyrethroid-Granulat gegen Getreideschädlinge." }),
  N({ id: "psm-fastac-active", category: "psm", psmType: "insecticide", name: "Fastac Active", manufacturer: "BASF", activeIngredients: [{ name: "Alpha-Cypermethrin", content: "50 g/l" }], formulation: "EC", rateMin: 0.2, rateMax: 0.2, rateUnit: "l/ha", crops: ["weizen", "gerste_zw"], targets: ["Blattläuse", "Getreidehähnchen"], roAuthorized: "no", phiDays: 21, note: "⚠ RO-Zulassung 2020 ausgelaufen — Status prüfen, nicht ohne Freigabe einsetzen." }),
  N({ id: "psm-optimus-175ec", category: "psm", psmType: "growth_regulator", name: "Optimus 175 EC", manufacturer: "Nufarm", activeIngredients: [{ name: "Trinexapac-ethyl", content: "175 g/l" }], formulation: "EC", rateMin: 0.4, rateMax: 0.8, rateUnit: "l/ha", crops: ["weizen", "gerste_zw"], targets: ["Halmverkürzung", "Lagerungsschutz"], bbchFrom: 30, bbchTo: 39, roAuthorized: "yes", note: "Halmverkürzer; Weizen 0,4, Gerste 0,8 l/ha." }),
  N({ id: "psm-moddus-evo", category: "psm", psmType: "growth_regulator", name: "Moddus Evo", manufacturer: "Syngenta", activeIngredients: [{ name: "Trinexapac-ethyl", content: "250 g/l" }], formulation: "EC", rateMin: 0.3, rateMax: 0.6, rateUnit: "l/ha", crops: ["weizen", "gerste_zw"], targets: ["Halmverkürzung", "Lagerungsschutz"], bbchFrom: 25, bbchTo: 49, roAuthorized: "yes", authNumber: "192PC/03.06.2016", note: "Halmverkürzer; max. 1 Anwendung/Saison." }),
  N({ id: "psm-medax-top", category: "psm", psmType: "growth_regulator", name: "Medax Top", manufacturer: "BASF", activeIngredients: [{ name: "Mepiquatchlorid", content: "300 g/l" }, { name: "Prohexadion-Ca", content: "50 g/l" }], formulation: "SC", rateMin: 0.6, rateMax: 1.0, rateUnit: "l/ha", crops: ["weizen", "gerste_zw"], targets: ["Halmverkürzung", "Lagerungsschutz"], roAuthorized: "yes", note: "Halmverkürzer, fördert zusätzlich Wurzelentwicklung." }),
  N({ id: "psm-ephon-top", category: "psm", psmType: "growth_regulator", name: "Ephon Top", manufacturer: "Nufarm", activeIngredients: [{ name: "Ethephon", content: "660 g/l" }], formulation: "SL", rateMin: 0.5, rateMax: 0.75, rateUnit: "l/ha", crops: ["weizen", "gerste_zw"], targets: ["Halmverkürzung", "Lagerungsschutz"], bbchFrom: 31, bbchTo: 49, roAuthorized: "yes", note: "Später Halmverkürzer (Ethephon)." }),

  // ===== PSM · RAPS / MAIS / SOJA =====
  N({ id: "psm-butisan-avant", category: "psm", psmType: "herbicide", name: "Butisan Avant", manufacturer: "BASF", activeIngredients: [{ name: "Metazachlor", content: "300 g/l" }, { name: "Dimethenamid-P", content: "100 g/l" }, { name: "Quinmerac", content: "100 g/l" }], formulation: "SE", rateMin: 2.5, rateMax: 2.5, rateUnit: "l/ha", crops: ["winterraps"], targets: ["Ungräser", "dikotyle Unkräuter", "Klettenlabkraut"], bbchFrom: 0, bbchTo: 17, roAuthorized: "yes", note: "Vorauflauf / frühes Nachauflauf bis 7 Laubblätter." }),
  N({ id: "psm-kalif-480ec", category: "psm", psmType: "herbicide", name: "Kalif 480 EC", manufacturer: "Adama", activeIngredients: [{ name: "Clomazone", content: "480 g/l" }], formulation: "EC", rateMin: 0.2, rateMax: 0.25, rateUnit: "l/ha", crops: ["winterraps"], targets: ["Klettenlabkraut", "dikotyle Unkräuter"], bbchFrom: 0, bbchTo: 9, roAuthorized: "yes", note: "Vorauflauf (Clomazone), Schwerpunkt Galium." }),
  N({ id: "psm-galera-super", category: "psm", psmType: "herbicide", name: "Galera Super", manufacturer: "Corteva", activeIngredients: [{ name: "Clopyralid", content: "240 g/l" }, { name: "Picloram", content: "80 g/l" }, { name: "Aminopyralid", content: "40 g/l" }], formulation: "SL", rateMin: 0.2, rateMax: 0.25, rateUnit: "l/ha", crops: ["winterraps"], targets: ["Distel", "Kamille", "Kornblume", "Klatschmohn"], bbchFrom: 13, bbchTo: 50, roAuthorized: "yes", authNumber: "2862", note: "Nachauflauf gegen dikotyle Unkräuter (0,2 Herbst / 0,25 Frühjahr)." }),
  N({ id: "psm-pictor", category: "psm", psmType: "fungicide", name: "Pictor", manufacturer: "BASF", activeIngredients: [{ name: "Boscalid", content: "200 g/l" }, { name: "Dimoxystrobin", content: "200 g/l" }], formulation: "SC", rateMin: 0.5, rateMax: 0.5, rateUnit: "l/ha", crops: ["winterraps"], targets: ["Sclerotinia", "Alternaria", "Botrytis"], bbchFrom: 60, bbchTo: 69, roAuthorized: "yes", note: "Blütenfungizid gegen Weißstängeligkeit." }),
  N({ id: "psm-filan", category: "psm", psmType: "fungicide", name: "Filan", manufacturer: "BASF", activeIngredients: [{ name: "Boscalid", content: "500 g/kg" }], formulation: "WG", rateMin: 0.5, rateMax: 0.5, rateUnit: "kg/ha", crops: ["winterraps"], targets: ["Sclerotinia", "Phoma", "Alternaria"], bbchFrom: 60, bbchTo: 69, roAuthorized: "yes", note: "Boscalid-Blütenfungizid Raps/Sonnenblume." }),
  N({ id: "psm-propulse-250se", category: "psm", psmType: "fungicide", name: "Propulse 250 SE", manufacturer: "Bayer", activeIngredients: [{ name: "Fluopyram", content: "125 g/l" }, { name: "Prothioconazol", content: "125 g/l" }], formulation: "SE", rateMin: 0.8, rateMax: 1.0, rateUnit: "l/ha", crops: ["winterraps", "mais"], targets: ["Sclerotinia", "Phoma", "Alternaria", "Helminthosporium"], bbchFrom: 30, bbchTo: 69, roAuthorized: "yes", note: "Raps 1,0 (Sclerotinia in Blüte), Mais 0,8–1,0 l/ha." }),
  N({ id: "psm-toprex", category: "psm", psmType: "growth_regulator", name: "Toprex", manufacturer: "Syngenta", activeIngredients: [{ name: "Difenoconazol", content: "250 g/l" }, { name: "Paclobutrazol", content: "125 g/l" }], formulation: "SC", rateMin: 0.3, rateMax: 0.5, rateUnit: "l/ha", crops: ["winterraps"], targets: ["Wachstumsregulierung", "Phoma"], bbchFrom: 14, bbchTo: 55, roAuthorized: "yes", note: "Wachstumsregler + Fungizidwirkung (Phoma); Herbst/Frühjahr." }),
  N({ id: "psm-caramba-turbo", category: "psm", psmType: "growth_regulator", name: "Caramba Turbo", manufacturer: "BASF", activeIngredients: [{ name: "Metconazol", content: "30 g/l" }, { name: "Mepiquatchlorid", content: "210 g/l" }], formulation: "SL", rateMin: 0.7, rateMax: 1.4, rateUnit: "l/ha", crops: ["winterraps"], targets: ["Wachstumsregulierung", "Phoma", "Lagerneigung"], bbchFrom: 14, bbchTo: 55, roAuthorized: "yes", note: "Kombi Wachstumsregler/Fungizid Raps." }),
  N({ id: "psm-elumis", category: "psm", psmType: "herbicide", name: "Elumis", manufacturer: "Syngenta", activeIngredients: [{ name: "Mesotrion", content: "75 g/l" }, { name: "Nicosulfuron", content: "30 g/l" }], formulation: "OD", rateMin: 1.0, rateMax: 2.0, rateUnit: "l/ha", crops: ["mais"], targets: ["Ungräser", "Hirse", "Amarant", "Quecke", "Nachtschatten"], bbchFrom: 12, bbchTo: 18, roAuthorized: "yes", authNumber: "008PC/20.12.2011", note: "Nachauflauf Mais 2–8 Blätter; max. 1 Behandlung." }),
  N({ id: "psm-adengo-465sc", category: "psm", psmType: "herbicide", name: "Adengo 465 SC", manufacturer: "Bayer", activeIngredients: [{ name: "Isoxaflutol", content: "225 g/l" }, { name: "Thiencarbazone-methyl", content: "90 g/l" }], formulation: "SC", rateMin: 0.3, rateMax: 0.44, rateUnit: "l/ha", crops: ["mais"], targets: ["dikotyle Unkräuter", "Ungräser", "Hirse"], bbchFrom: 0, bbchTo: 13, roAuthorized: "yes", authNumber: "2789/26.06.2008", note: "Vorauflauf / frühes Nachauflauf bis 3-Blatt." }),
  N({ id: "psm-lumax-5375se", category: "psm", psmType: "herbicide", name: "Lumax 537,5 SE", manufacturer: "Syngenta", activeIngredients: [{ name: "S-Metolachlor", content: "375 g/l" }, { name: "Terbuthylazin", content: "125 g/l" }, { name: "Mesotrion", content: "37,5 g/l" }], formulation: "SE", rateMin: 3.5, rateMax: 4.0, rateUnit: "l/ha", crops: ["mais"], targets: ["Ungräser", "Hirse", "dikotyle Unkräuter"], bbchFrom: 0, bbchTo: 16, roAuthorized: "yes", note: "Vorauflauf / frühes Nachauflauf." }),
  N({ id: "psm-frontier-forte", category: "psm", psmType: "herbicide", name: "Frontier Forte", manufacturer: "BASF", activeIngredients: [{ name: "Dimethenamid-P", content: "720 g/l" }], formulation: "EC", rateMin: 0.8, rateMax: 1.4, rateUnit: "l/ha", crops: ["mais", "soja_luzerne"], targets: ["Hirse", "Amarant", "Ungräser"], bbchFrom: 0, bbchTo: 0, roAuthorized: "yes", note: "Vorauflauf; Aufwand nach Humusgehalt." }),
  N({ id: "psm-coragen", category: "psm", psmType: "insecticide", name: "Coragen", manufacturer: "FMC", activeIngredients: [{ name: "Chlorantraniliprol", content: "200 g/l" }], formulation: "SC", rateMin: 0.05, rateMax: 0.175, rateUnit: "l/ha", crops: ["mais", "kartoffel_pommes", "kartoffel_chips", "tomate"], targets: ["Maiszünsler", "Kartoffelkäfer", "Tuta absoluta"], roAuthorized: "yes", authNumber: "2724/2007", phiDays: 14, note: "Diamid; Mais/Kartoffel 50–125 ml, Tomate 175 ml/ha." }),
  N({ id: "psm-pulsar-40", category: "psm", psmType: "herbicide", name: "Pulsar 40", manufacturer: "BASF", activeIngredients: [{ name: "Imazamox", content: "40 g/l" }], formulation: "SL", rateMin: 0.75, rateMax: 1.0, rateUnit: "l/ha", crops: ["soja_luzerne"], targets: ["dikotyle Unkräuter", "Amarant", "Ambrosia", "Ungräser"], bbchFrom: 12, bbchTo: 14, roAuthorized: "yes", authNumber: "1859/29.09.1998", phiDays: 0, note: "Nachauflauf Soja 2–4 Blätter; oft mit Basagran (Corum)." }),
  N({ id: "psm-basagran-sl", category: "psm", psmType: "herbicide", name: "Basagran SL", manufacturer: "BASF", activeIngredients: [{ name: "Bentazon", content: "480 g/l" }], formulation: "SL", rateMin: 2.0, rateMax: 2.0, rateUnit: "l/ha", crops: ["soja_luzerne"], targets: ["dikotyle Unkräuter", "Chenopodium"], bbchFrom: 12, bbchTo: 14, roAuthorized: "yes", note: "Kontaktherbizid, Partner zu Pulsar 40." }),
  N({ id: "psm-dual-gold-960ec", category: "psm", psmType: "herbicide", name: "Dual Gold 960 EC", manufacturer: "Syngenta", activeIngredients: [{ name: "S-Metolachlor", content: "960 g/l" }], formulation: "EC", rateMin: 1.0, rateMax: 1.5, rateUnit: "l/ha", crops: ["mais", "soja_luzerne"], targets: ["Hirse", "Ungräser", "Amarant"], bbchFrom: 0, bbchTo: 0, roAuthorized: "yes", note: "Vorauflauf-Bodenherbizid." }),
  N({ id: "psm-fusilade-forte", category: "psm", psmType: "herbicide", name: "Fusilade Forte", manufacturer: "Syngenta", activeIngredients: [{ name: "Fluazifop-P-butyl", content: "150 g/l" }], formulation: "EC", rateMin: 0.8, rateMax: 2.0, rateUnit: "l/ha", crops: ["winterraps", "soja_luzerne"], targets: ["Ausfallgetreide", "Hirse", "Quecke", "Ungräser"], roAuthorized: "yes", note: "Selektives Graminizid (Nachauflauf)." }),
  N({ id: "psm-agil-100ec", category: "psm", psmType: "herbicide", name: "Agil 100 EC", manufacturer: "Adama", activeIngredients: [{ name: "Propaquizafop", content: "100 g/l" }], formulation: "EC", rateMin: 0.5, rateMax: 1.5, rateUnit: "l/ha", crops: ["winterraps", "soja_luzerne", "kartoffel_pommes", "kartoffel_chips", "tomate", "zwiebel_moehre", "knollensellerie", "suesskartoffel"], targets: ["Einjährige Gräser", "Quecke", "Ausfallgetreide"], roAuthorized: "yes", note: "Selektives Gräserherbizid für breitblättrige Kulturen." }),

  // ===== PSM · KARTOFFEL / GEMÜSE =====
  N({ id: "psm-zorvec-endavia", category: "psm", psmType: "fungicide", name: "Zorvec Endavia", manufacturer: "Corteva", activeIngredients: [{ name: "Oxathiapiprolin", content: "30 g/l" }, { name: "Benthiavalicarb-isopropyl", content: "12,5 g/l" }], formulation: "OD", rateMin: 0.4, rateMax: 0.5, rateUnit: "l/ha", crops: ["kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre", "knoblauch"], targets: ["Phytophthora infestans", "Peronospora destructor"], roAuthorized: "yes", phiDays: 7, note: "Mana-Standard, RO für Kartoffel/Zwiebel/Knoblauch; PHI je Kultur prüfen." }),
  N({ id: "psm-revus-250sc", category: "psm", psmType: "fungicide", name: "Revus 250 SC", manufacturer: "Syngenta", activeIngredients: [{ name: "Mandipropamid", content: "250 g/l" }], formulation: "SC", rateMin: 0.6, rateMax: 0.6, rateUnit: "l/ha", crops: ["kartoffel_pommes", "kartoffel_chips", "tomate", "zwiebel_moehre"], targets: ["Phytophthora infestans", "Peronospora"], roAuthorized: "yes", phiDays: 3, note: "Regenfest, gute Anlagerung; PHI Kartoffel/Tomate 3 Tage." }),
  N({ id: "psm-ranman-top", category: "psm", psmType: "fungicide", name: "Ranman Top", manufacturer: "Belchim (ISK)", activeIngredients: [{ name: "Cyazofamid", content: "160 g/l" }], formulation: "SC", rateMin: 0.5, rateMax: 0.5, rateUnit: "l/ha", crops: ["kartoffel_pommes", "kartoffel_chips", "tomate"], targets: ["Phytophthora infestans"], roAuthorized: "yes", authNumber: "105PC/22.07.2015", phiDays: 7, note: "Sporizid, regenfest bis 80 mm; PHI Kartoffel 7 / Tomate 3." }),
  N({ id: "psm-infinito", category: "psm", psmType: "fungicide", name: "Infinito 687,5 SC", manufacturer: "Bayer", activeIngredients: [{ name: "Fluopicolid", content: "62,5 g/l" }, { name: "Propamocarb-HCl", content: "625 g/l" }], formulation: "SC", rateMin: 1.4, rateMax: 1.4, rateUnit: "l/ha", crops: ["kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre"], targets: ["Phytophthora infestans", "Peronospora destructor"], roAuthorized: "yes", authNumber: "2698/19.04.2007", phiDays: 7, note: "Systemisch, auch knollenschützend." }),
  N({ id: "psm-proxanil", category: "psm", psmType: "fungicide", name: "Proxanil", manufacturer: "Adama", activeIngredients: [{ name: "Propamocarb", content: "400 g/l" }, { name: "Cymoxanil", content: "50 g/l" }], formulation: "SC", rateMin: 2.0, rateMax: 2.5, rateUnit: "l/ha", crops: ["kartoffel_pommes", "kartoffel_chips", "tomate"], targets: ["Phytophthora infestans"], roAuthorized: "yes", phiDays: 14, note: "Systemisch/kurativ (Cymoxanil), mancozebfreie Alternative." }),
  N({ id: "psm-ridomil-gold-mz", category: "psm", psmType: "fungicide", name: "Ridomil Gold MZ 68 WG", manufacturer: "Syngenta", activeIngredients: [{ name: "Metalaxyl-M", content: "40 g/kg" }, { name: "Mancozeb", content: "640 g/kg" }], formulation: "WG", rateMin: 2.5, rateMax: 2.5, rateUnit: "kg/ha", crops: ["kartoffel_pommes", "kartoffel_chips", "tomate", "zwiebel_moehre"], targets: ["Phytophthora infestans", "Alternaria", "Peronospora"], roAuthorized: "no", phiDays: 14, note: "⚠ Mancozeb EU-Zulassung 2021 ausgelaufen — nur als Referenz, mancozebfreie Alternative wählen (Proxanil)." }),
  N({ id: "psm-quadris", category: "psm", psmType: "fungicide", name: "Quadris", manufacturer: "Syngenta", activeIngredients: [{ name: "Azoxystrobin", content: "250 g/l" }], formulation: "SC", rateMin: 0.75, rateMax: 1.0, rateUnit: "l/ha", crops: ["kartoffel_pommes", "kartoffel_chips", "tomate", "zwiebel_moehre"], targets: ["Alternaria", "Echter Mehltau"], roAuthorized: "yes", note: "Strobilurin gegen Alternaria/Dürrfleckenkrankheit; PHI je Kultur." }),
  N({ id: "psm-score-250ec", category: "psm", psmType: "fungicide", name: "Score 250 EC", manufacturer: "Syngenta", activeIngredients: [{ name: "Difenoconazol", content: "250 g/l" }], formulation: "EC", rateMin: 0.4, rateMax: 0.5, rateUnit: "l/ha", crops: ["zwiebel_moehre", "knollensellerie"], targets: ["Alternaria", "Septoria"], roAuthorized: "yes", phiDays: 14, note: "Triazol gegen Blattflecken bei Möhre/Sellerie." }),
  N({ id: "psm-dagonis", category: "psm", psmType: "fungicide", name: "Dagonis", manufacturer: "BASF", activeIngredients: [{ name: "Difenoconazol", content: "50 g/l" }, { name: "Fluxapyroxad", content: "75 g/l" }], formulation: "SC", rateMin: 0.5, rateMax: 1.0, rateUnit: "l/ha", crops: ["tomate", "zwiebel_moehre"], targets: ["Alternaria", "Echter Mehltau", "Septoria"], roAuthorized: "yes", phiDays: 3, note: "SDHI+Triazol, breites Blattkrankheiten-Spektrum im Gemüse." }),
  N({ id: "psm-signum", category: "psm", psmType: "fungicide", name: "Signum", manufacturer: "BASF", activeIngredients: [{ name: "Boscalid", content: "267 g/kg" }, { name: "Pyraclostrobin", content: "67 g/kg" }], formulation: "WG", rateMin: 0.75, rateMax: 1.5, rateUnit: "kg/ha", crops: ["zwiebel_moehre", "knollensellerie", "tomate"], targets: ["Alternaria", "Sclerotinia", "Botrytis"], roAuthorized: "yes", authNumber: "2758/27.03.2008", phiDays: 28, note: "⚠ Lange Wartezeit Möhre 28 Tage (Tomate 3)." }),
  N({ id: "psm-switch-625wg", category: "psm", psmType: "fungicide", name: "Switch 62,5 WG", manufacturer: "Syngenta", activeIngredients: [{ name: "Cyprodinil", content: "375 g/kg" }, { name: "Fludioxonil", content: "250 g/kg" }], formulation: "WG", rateMin: 0.8, rateMax: 1.0, rateUnit: "kg/ha", crops: ["zwiebel_moehre", "tomate"], targets: ["Botrytis", "Sclerotinia"], roAuthorized: "yes", phiDays: 7, note: "Gegen Weiß-/Grauschimmel; PHI je Kultur." }),
  N({ id: "psm-benevia", category: "psm", psmType: "insecticide", name: "Benevia", manufacturer: "FMC", activeIngredients: [{ name: "Cyantraniliprol", content: "100 g/l" }], formulation: "OD", rateMin: 0.125, rateMax: 0.75, rateUnit: "l/ha", crops: ["kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre", "knoblauch", "knollensellerie"], targets: ["Thrips", "Möhrenfliege", "Kartoffelkäfer"], roAuthorized: "yes", phiDays: 14, note: "Breites Gemüse-Label; Kartoffel 125, Zwiebel/Knoblauch 750 ml/ha." }),
  N({ id: "psm-movento-100sc", category: "psm", psmType: "insecticide", name: "Movento 100 SC", manufacturer: "Bayer", activeIngredients: [{ name: "Spirotetramat", content: "100 g/l" }], formulation: "SC", rateMin: 0.45, rateMax: 0.75, rateUnit: "l/ha", crops: ["kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre", "tomate"], targets: ["Blattläuse", "Thrips", "Weiße Fliege"], roAuthorized: "yes", phiDays: 7, note: "Voll systemisch gegen saugende Schädlinge." }),
  N({ id: "psm-affirm", category: "psm", psmType: "insecticide", name: "Affirm", manufacturer: "Syngenta", activeIngredients: [{ name: "Emamectin-Benzoat", content: "9,5 g/kg" }], formulation: "SG", rateMin: 1.5, rateMax: 1.5, rateUnit: "kg/ha", crops: ["tomate"], targets: ["Tuta absoluta", "Schmetterlingsraupen"], roAuthorized: "yes", phiDays: 3, note: "Spezialist gegen Tuta absoluta / Eulenraupen." }),
  N({ id: "psm-laser-240sc", category: "psm", psmType: "insecticide", name: "Laser 240 SC", manufacturer: "Corteva", activeIngredients: [{ name: "Spinosad", content: "240 g/l" }], formulation: "SC", rateMin: 0.2, rateMax: 0.4, rateUnit: "l/ha", crops: ["zwiebel_moehre", "tomate", "kartoffel_pommes", "kartoffel_chips"], targets: ["Thrips", "Tuta absoluta"], roAuthorized: "yes", phiDays: 7, note: "Spinosad gegen Thrips/Raupen; PHI je Kultur." }),
  N({ id: "psm-teppeki", category: "psm", psmType: "insecticide", name: "Teppeki", manufacturer: "ISK / Belchim", activeIngredients: [{ name: "Flonicamid", content: "500 g/kg" }], formulation: "WG", rateMin: 0.14, rateMax: 0.16, rateUnit: "kg/ha", crops: ["kartoffel_pommes", "kartoffel_chips", "tomate"], targets: ["Blattläuse"], roAuthorized: "yes", phiDays: 14, note: "Selektiv gegen Blattläuse (Virusvektoren), bienenschonend." }),
  N({ id: "psm-sencor-600sc", category: "psm", psmType: "herbicide", name: "Sencor Liquid 600 SC", manufacturer: "Bayer", activeIngredients: [{ name: "Metribuzin", content: "600 g/l" }], formulation: "SC", rateMin: 0.3, rateMax: 0.75, rateUnit: "l/ha", crops: ["kartoffel_pommes", "kartoffel_chips", "tomate"], targets: ["Einjährige Dikotyle", "Einjährige Gräser"], roAuthorized: "yes", note: "Vor-/Nachauflauf Kartoffel/Tomate; Sortenverträglichkeit beachten." }),
  N({ id: "psm-proman", category: "psm", psmType: "herbicide", name: "Proman", manufacturer: "Belchim", activeIngredients: [{ name: "Metobromuron", content: "500 g/l" }], formulation: "SC", rateMin: 2.0, rateMax: 4.0, rateUnit: "l/ha", crops: ["kartoffel_pommes", "kartoffel_chips"], targets: ["Einjährige Dikotyle"], roAuthorized: "yes", note: "Bodenherbizid Vorauflauf Kartoffel." }),
  N({ id: "psm-stomp-aqua", category: "psm", psmType: "herbicide", name: "Stomp Aqua", manufacturer: "BASF", activeIngredients: [{ name: "Pendimethalin", content: "455 g/l" }], formulation: "CS", rateMin: 2.0, rateMax: 3.5, rateUnit: "l/ha", crops: ["zwiebel_moehre", "kartoffel_pommes", "kartoffel_chips", "tomate", "knoblauch"], targets: ["Einjährige Dikotyle", "Einjährige Gräser"], roAuthorized: "yes", note: "Bodenherbizid Vorauflauf in Zwiebel/Gemüse/Kartoffel." }),
  N({ id: "psm-boxer-800ec", category: "psm", psmType: "herbicide", name: "Boxer 800 EC", manufacturer: "Syngenta", activeIngredients: [{ name: "Prosulfocarb", content: "800 g/l" }], formulation: "EC", rateMin: 3.0, rateMax: 5.0, rateUnit: "l/ha", crops: ["kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre"], targets: ["Einjährige Dikotyle", "Einjährige Gräser"], roAuthorized: "yes", note: "Vorauflauf / früher Nachauflauf Kartoffel/Zwiebel/Möhre." }),
  N({ id: "psm-spotlight-plus", category: "psm", psmType: "herbicide", name: "Spotlight Plus", manufacturer: "FMC", activeIngredients: [{ name: "Carfentrazone-ethyl", content: "60 g/l" }], formulation: "EC", rateMin: 1.0, rateMax: 1.0, rateUnit: "l/ha", crops: ["kartoffel_pommes", "kartoffel_chips"], targets: ["Krautabtötung/Sikkation"], roAuthorized: "yes", phiDays: 7, note: "Krautabtötung (Sikkation) in der Kartoffel." }),

  // ===== BLATTDÜNGER / MIKRONÄHRSTOFFE =====
  N({ id: "foliar-yaravita-gramitrel", category: "foliar", name: "YaraVita GRAMITREL", manufacturer: "Yara", formulation: "SC (flowable)", nutrients: { N: 64, MgO: 250, Mn: 150, Zn: 80, Cu: 50 }, rateMin: 1, rateMax: 3, rateUnit: "l/ha", crops: ["weizen", "gerste_zw", "mais"], targets: ["Getreide Mehrnährstoff", "Mangan", "Zink", "Magnesium"], bbchFrom: 12, bbchTo: 32, roAuthorized: "yes", note: "Werte in g/l; Getreide-Blattdünger Mn/Zn/Mg/Cu." }),
  N({ id: "foliar-yaravita-mantrac", category: "foliar", name: "YaraVita MANTRAC PRO", manufacturer: "Yara", formulation: "SC (flowable)", nutrients: { Mn: 500 }, rateMin: 0.5, rateMax: 2, rateUnit: "l/ha", crops: ["*"], targets: ["Mangan", "Manganmangel"], roAuthorized: "yes", note: "500 g/l Mn; reiner Mangan-Blattdünger." }),
  N({ id: "foliar-yaravita-zintrac", category: "foliar", name: "YaraVita ZINTRAC 700", manufacturer: "Yara", formulation: "SC (flowable)", nutrients: { Zn: 700 }, rateMin: 0.15, rateMax: 1, rateUnit: "l/ha", crops: ["*"], targets: ["Zink", "Zinkmangel", "Mais"], roAuthorized: "yes", note: "700 g/l Zn; wichtig bei Mais." }),
  N({ id: "foliar-yaravita-bortrac", category: "foliar", name: "YaraVita BORTRAC 150", manufacturer: "Yara", formulation: "SL (Bor-Ethanolamin)", nutrients: { B: 150 }, rateMin: 1, rateMax: 3, rateUnit: "l/ha", crops: ["winterraps", "zwiebel_moehre", "knollensellerie"], targets: ["Bor", "Bormangel"], roAuthorized: "yes", note: "150 g/l B; v.a. Raps und Wurzelgemüse." }),
  N({ id: "foliar-icl-agroleaf-total", category: "foliar", name: "ICL Agroleaf Power Total 20-20-20+TE", manufacturer: "ICL", formulation: "WSF", nutrients: { N: 20, P2O5: 20, K2O: 20 }, rateMin: 2, rateMax: 5, rateUnit: "kg/ha", crops: ["*"], targets: ["Ausgewogen NPK", "Mikronährstoffe TE"], roAuthorized: "yes", note: "Werte in %; Blattdünger mit Spurenelementen." }),
  N({ id: "foliar-icl-nova-peak", category: "foliar", name: "ICL Nova PeaK 0-52-34 (MKP)", manufacturer: "ICL", formulation: "WSF", nutrients: { P2O5: 52, K2O: 34 }, crops: ["*"], targets: ["Phosphor", "Kalium", "Blüh-/Kornphase"], roAuthorized: "yes", note: "MKP für Blatt/Fertigation, chloridfrei." }),
  N({ id: "foliar-timac-fertiactyl-starter", category: "foliar", name: "Fertiactyl Starter", manufacturer: "Timac Agro", formulation: "Flüssig (Fertiactyl-Komplex)", nutrients: { N: 13, P2O5: 5, K2O: 8 }, rateMin: 2, rateMax: 4, rateUnit: "l/ha", crops: ["*"], targets: ["Starterdüngung", "Wurzelbildung"], roAuthorized: "yes", note: "Werte in %; Starter mit Huminstoff-/Zeatin-Komplex." }),
  N({ id: "foliar-haifa-polyfeed", category: "foliar", name: "Haifa Poly-Feed GG 19-19-19+ME", manufacturer: "Haifa", formulation: "WSF", nutrients: { N: 19, P2O5: 19, K2O: 19 }, crops: ["*"], targets: ["Ausgewogen NPK", "Fertigation", "Mikroelemente"], roAuthorized: "yes", note: "Werte in %; wasserlöslich für Fertigation/Blatt." }),
  N({ id: "foliar-compo-basfoliar-36", category: "foliar", name: "COMPO Basfoliar 36 Extra", manufacturer: "COMPO Expert", formulation: "SL (harnstoffbasiert)", nutrients: { N: 36 }, rateUnit: "l/ha", crops: ["weizen", "gerste_zw", "mais", "winterraps"], targets: ["Stickstoff Blatt", "N-Nachlieferung"], roAuthorized: "yes", note: "ca. 36% N; Blatt-Stickstoffdünger." }),

  // ===== BIOSTIMULANZIEN =====
  N({ id: "biostim-fertileader-vital", category: "biostimulant", name: "Fertileader Vital", manufacturer: "Timac Agro", formulation: "SL (Seactiv-Komplex)", rateMin: 2, rateMax: 3, rateUnit: "l/ha", crops: ["*"], targets: ["Stressminderung", "Bor", "Molybdän", "Blüte/Fruchtansatz"], roAuthorized: "yes", note: "Biostimulans (Seactiv + B/Mo); Nährstoffgehalte unsicher." }),
  N({ id: "biostim-megafol", category: "biostimulant", name: "Megafol", manufacturer: "Valagro (Syngenta)", formulation: "SL", nutrients: { N: 3, K2O: 8 }, rateMin: 2, rateMax: 2.5, rateUnit: "l/ha", crops: ["*"], targets: ["Trockenstress", "Hitzestress", "Regeneration"], roAuthorized: "yes", note: "Anti-Stress mit Aminosäuren/Betainen (~28% AS)." }),
  N({ id: "biostim-radifarm", category: "biostimulant", name: "Radifarm", manufacturer: "Valagro (Syngenta)", formulation: "SL", rateMin: 2, rateMax: 2.5, rateUnit: "l/ha", crops: ["tomate", "kartoffel_pommes", "kartoffel_chips", "zwiebel_moehre", "knollensellerie"], targets: ["Wurzelbildung", "Anwachsphase", "Transplant-Stress"], roAuthorized: "yes", note: "Wurzel-Biostim (Polysaccharide/AS, Zn+B), oft Fertigation." }),
  N({ id: "biostim-delfan-plus", category: "biostimulant", name: "Delfan Plus", manufacturer: "Tradecorp", formulation: "SL (freie L-Aminosäuren)", nutrients: { N: 9 }, rateMin: 1.5, rateMax: 3, rateUnit: "l/ha", crops: ["*"], targets: ["Trockenstress", "Aminosäuren", "Stresserholung"], roAuthorized: "yes", note: "~24% freie Aminosäuren; universelles Anti-Stress-Biostim." }),
  N({ id: "biostim-quantis", category: "biostimulant", name: "Quantis", manufacturer: "Syngenta Biologicals", formulation: "SL (Fermentation, Ca/K)", rateMin: 2, rateMax: 2, rateUnit: "l/ha", crops: ["mais", "tomate", "kartoffel_pommes", "kartoffel_chips"], targets: ["Hitzestress", "Trockenstress"], roAuthorized: "yes", note: "Zuckerrohr-Fermentation mit Ca/K gegen Hitze/Trockenheit." }),
  N({ id: "biostim-kelpak", category: "biostimulant", name: "Kelpak", manufacturer: "Kelp Products / BASF", formulation: "SL (Ecklonia-maxima-Extrakt)", rateMin: 2, rateMax: 4, rateUnit: "l/ha", crops: ["*"], targets: ["Wurzelbildung", "Trockenstress", "Auxine/Cytokinine"], roAuthorized: "unknown", note: "Seetang-Extrakt; RO-Verfügbarkeit prüfen." }),

  // ===== BEIZUNG / SAATGUTBEHANDLUNG =====
  N({ id: "beize-redigo", category: "seed_treatment", psmType: "fungicide", name: "Redigo", manufacturer: "Bayer", activeIngredients: [{ name: "Prothioconazol", content: "100 g/l" }], formulation: "FS", crops: ["weizen", "gerste_zw"], targets: ["Beizung Fungizid", "Steinbrand", "Flugbrand", "Schneeschimmel"], roAuthorized: "yes", note: "Getreide-Fungizidbeize; Aufwand je Saatgut-t." }),
  N({ id: "beize-gaucho-600", category: "seed_treatment", psmType: "insecticide", name: "Gaucho 600 FS", manufacturer: "Bayer", activeIngredients: [{ name: "Imidacloprid", content: "600 g/l" }], formulation: "FS", crops: ["mais", "winterraps"], targets: ["Bodenschädlinge", "Blattläuse"], roAuthorized: "no", note: "⚠ Neonicotinoid: Freiland-Anwendung EU-weit VERBOTEN — nicht einsetzen." }),
  N({ id: "beize-vibrance-duo", category: "seed_treatment", psmType: "fungicide", name: "Vibrance Duo", manufacturer: "Syngenta", activeIngredients: [{ name: "Sedaxan", content: "25 g/l" }, { name: "Fludioxonil", content: "25 g/l" }], formulation: "FS", crops: ["weizen", "gerste_zw"], targets: ["Beizung Fungizid", "Wurzelgesundheit", "Fusarium"], roAuthorized: "yes", note: "Getreidebeize; Sedaxan (SDHI) fördert Wurzelbildung." }),
  N({ id: "beize-celest", category: "seed_treatment", psmType: "fungicide", name: "Celest", manufacturer: "Syngenta", activeIngredients: [{ name: "Fludioxonil", content: "25 g/l" }], formulation: "FS", crops: ["mais", "soja_luzerne", "weizen"], targets: ["Beizung Fungizid", "Fusarium", "Auflaufkrankheiten"], roAuthorized: "yes", note: "Kontakt-Fungizidbeize; Celest-Top enthält Neonic (verboten)." }),
  N({ id: "beize-force-20cs", category: "seed_treatment", psmType: "insecticide", name: "Force 20 CS", manufacturer: "Syngenta", activeIngredients: [{ name: "Tefluthrin", content: "200 g/l" }], formulation: "CS", crops: ["mais"], targets: ["Bodenschädlinge", "Drahtwurm"], roAuthorized: "yes", note: "Pyrethroid (kein Neonic) gegen Bodenschädlinge im Mais." }),
  N({ id: "beize-systiva", category: "seed_treatment", psmType: "fungicide", name: "Systiva", manufacturer: "BASF", activeIngredients: [{ name: "Fluxapyroxad", content: "333 g/l" }], formulation: "FS", crops: ["gerste_zw", "weizen"], targets: ["Beizung Fungizid", "Netzflecken", "Rhynchosporium"], roAuthorized: "yes", note: "SDHI-Beize v.a. Gerste, mit Früh-Blattschutz (ersetzt teils T1)." }),
  N({ id: "beize-lumiposa", category: "seed_treatment", psmType: "insecticide", name: "Lumiposa", manufacturer: "Corteva", activeIngredients: [{ name: "Cyantraniliprol", content: "625 g/l" }], formulation: "FS", crops: ["winterraps"], targets: ["Erdfloh", "Rapsschädlinge"], roAuthorized: "yes", note: "Diamid (kein Neonic), Rapsbeize gegen Erdfloh." }),
  N({ id: "beize-histick-soy", category: "seed_treatment", psmType: null, name: "HiStick Soy (Rhizobium)", manufacturer: "BASF", activeIngredients: [{ name: "Bradyrhizobium japonicum", content: "—" }], formulation: "Inokulant", crops: ["soja_luzerne"], targets: ["Rhizobium-Inokulant", "N-Fixierung", "Soja Erstanbau"], roAuthorized: "unknown", note: "Knöllchenbakterien-Impfung, wichtig auf Flächen ohne Soja-Vorgeschichte." }),

  // ===== SORTEN / HYBRIDEN =====
  N({ id: "seed-heinz-h1015", category: "seed_variety", name: "Heinz H1015 (Industrietomate)", manufacturer: "HeinzSeed", crops: ["tomate"], targets: ["determiniert", "Verarbeitung/Paste"], roAuthorized: "unknown", note: "Determinierter Verarbeitungs-Hybrid (Alt.: HM.Clause/ISI)." }),
  N({ id: "seed-bejo-hystar", category: "seed_variety", name: "Zwiebel-Hybride Hystar F1", manufacturer: "Bejo", crops: ["zwiebel_moehre"], targets: ["Speisezwiebel Hybride", "Lagerfähigkeit"], roAuthorized: "unknown", note: "Beispielhafter Bejo-Zwiebelhybrid; Sorte mit Berater festlegen." }),
];

/* --------------------------------------------------------------------------
 * MATCHING — schlägt je Maßnahme passende Produkte vor.
 * ------------------------------------------------------------------------ */
export const PRODUCT_CATEGORY_LABEL: Record<ProductCategory, string> = {
  fertilizer: "Mineraldünger", foliar: "Blattdünger", biostimulant: "Biostimulans",
  psm: "Pflanzenschutz", seed_treatment: "Beizung", seed_variety: "Sorte",
};
export const PSM_TYPE_LABEL: Record<PsmType, string> = {
  herbicide: "Herbizid", fungicide: "Fungizid", insecticide: "Insektizid", growth_regulator: "Wachstumsregler",
};

/** Kategorien, die zu einer Maßnahme (op-Code) passen. */
export function categoriesForOp(opCode?: string): ProductCategory[] {
  switch (opCode) {
    case "OP-SAAT": return ["seed_variety", "seed_treatment"];
    case "OP-DUENG": return ["fertilizer", "foliar", "biostimulant"];
    case "OP-PSM": return ["psm"];
    case "OP-BEREG": return ["foliar", "biostimulant", "fertilizer"]; // Fertigation
    default: return [];
  }
}

function psmTypeFromLabel(label: string): PsmType | null {
  const s = label.toLowerCase();
  if (/(herbizid|herbicide|ungr|unkraut|graminizid|sikkation|krautab)/.test(s)) return "herbicide";
  if (/(fungizid|fungicide|mehltau|septoria|rost|phytophthora|alternaria|sclerotinia|botrytis|fusarium|peronospora|krautf)/.test(s)) return "fungicide";
  if (/(insektizid|insecticide|käfer|kaefer|laus|läuse|thrips|zünsler|zuensler|wanze|glanzkäfer|tuta|erdfloh|schädl)/.test(s)) return "insecticide";
  if (/(wachstumsreg|halmverk|einkürz|growth|regulator)/.test(s)) return "growth_regulator";
  return null;
}

const NUTRIENT_HINTS: { re: RegExp; keys: (keyof Nutrients)[] }[] = [
  { re: /p\s*\/\s*k|p₂o₅|p2o5|phosph|grund/i, keys: ["P2O5", "K2O"] },
  { re: /\bk\b|kali|k₂o|k2o/i, keys: ["K2O"] },
  { re: /\bn\b|andüng|andueng|kopf|schoss|ähre|aehre|stickstoff|azot|harnstoff/i, keys: ["N"] },
  { re: /\bs\b|schwefel|sulf/i, keys: ["S"] },
  { re: /\bca\b|kalk|calc/i, keys: ["CaO"] },
  { re: /\bmg\b|magnesium/i, keys: ["MgO"] },
  { re: /\bb\b|bor\b/i, keys: ["B"] },
  { re: /zink|\bzn\b/i, keys: ["Zn"] },
  { re: /mangan|\bmn\b/i, keys: ["Mn"] },
];

function nutrientWishFromLabel(label: string): (keyof Nutrients)[] {
  const out = new Set<keyof Nutrients>();
  for (const h of NUTRIENT_HINTS) if (h.re.test(label)) h.keys.forEach((k) => out.add(k));
  return [...out];
}

export type SuggestOpts = { cropId: string; opCode?: string; label?: string; limit?: number };

/** Rankt passende Produkte für eine Maßnahme. RO-zugelassen zuerst, dann Kultur- & Ziel-Treffer. */
export function suggestProducts(products: CatalogProduct[], opts: SuggestOpts): CatalogProduct[] {
  const cats = categoriesForOp(opts.opCode);
  if (!cats.length) return [];
  const label = opts.label ?? "";
  const wantType = psmTypeFromLabel(label);
  const wantNut = nutrientWishFromLabel(label);
  const cropOK = (p: CatalogProduct) => p.crops.includes(opts.cropId) || p.crops.includes("*");

  const scored = products
    .filter((p) => cats.includes(p.category) && cropOK(p))
    .map((p) => {
      let s = 0;
      if (p.roAuthorized === "yes") s += 100; else if (p.roAuthorized === "unknown") s += 40; else s -= 60; // banned last
      if (p.crops.includes(opts.cropId)) s += 30; // kulturspezifisch > generisch
      // Kategorie-Präferenz je op
      if (opts.opCode === "OP-DUENG" && p.category === "fertilizer") s += 20;
      if (opts.opCode === "OP-SAAT" && p.category === "seed_variety") s += 20;
      // PSM-Typ-Treffer
      if (p.category === "psm" && wantType) s += p.psmType === wantType ? 60 : -25;
      // Nährstoff-Treffer (Dünger/Blatt)
      if ((p.category === "fertilizer" || p.category === "foliar") && wantNut.length) {
        const hit = wantNut.filter((k) => (p.nutrients?.[k] ?? 0) > 0).length;
        s += hit * 30;
        if (hit === 0) s -= 10;
      }
      // Ziel-Keyword-Overlap
      if (label && p.targets) {
        const ls = label.toLowerCase();
        s += Math.min(3, p.targets.filter((t) => ls.includes(t.toLowerCase().split(" ")[0]) || t.toLowerCase().includes(ls.split(" ")[0])).length) * 8;
      }
      return { p, s };
    })
    .sort((a, b) => b.s - a.s);

  return scored.slice(0, opts.limit ?? 10).map((x) => x.p);
}

export function findProduct(products: CatalogProduct[], id?: string | null): CatalogProduct | undefined {
  if (!id) return undefined;
  return products.find((p) => p.id === id);
}

/** Export für den Abgleich mit der NEOS Web App (stabile ids + source + updatedAt). */
export function exportProductCatalog(products: CatalogProduct[]): string {
  return JSON.stringify({ schema: "neosfx.productCatalog/v1", exportedFrom: "NEOS FX", count: products.length, products }, null, 2);
}
