/** DE → EN · Block 7 — Produktkatalog (Dünger/PSM/Blattdünger/Beizung/Sorten) + Produkt-Picker. */
const B7: Record<string, string> = {
  // — Sidebar —
  "Produktkatalog (Dünger · PSM · Sorten)": "Product Catalog (Fertilizer · CPP · Varieties)",

  // — Kategorien / PSM-Typen —
  "Mineraldünger": "Mineral fertilizer",
  "Blattdünger": "Foliar fertilizer",
  "Biostimulans": "Biostimulant",
  "Pflanzenschutz": "Crop protection",
  "Beizung": "Seed treatment",
  "Sorte": "Variety",
  "Herbizid": "Herbicide",
  "Fungizid": "Fungicide",
  "Insektizid": "Insecticide",
  "Wachstumsregler": "Growth regulator",

  // — Produkt-Picker —
  "Produkt vorschlagen": "Suggest product",
  "Produkt ändern": "Change product",
  "Suche: Produkt, Hersteller, Wirkstoff …": "Search: product, manufacturer, active ingredient …",
  "alle passenden anzeigen": "show all matching",
  "Keine passenden Produkte gefunden.": "No matching products found.",
  "Entscheidungshilfe — vor Einsatz Zulassung & Auflagen im RO-Register prüfen (PSM/Beizung: MADR/PMDR; Sorten: ISTIS).":
    "Decision aid — before use, check authorization & conditions in the RO register (CPP/seed treatment: MADR/PMDR; varieties: ISTIS).",
  "nicht zugel.": "not authorized",
  "Wartezeit": "Pre-harvest interval",
  "Tage": "days",
  "gewählt": "selected",
  "übernehmen": "apply",

  // — Produktkatalog-Admin —
  "Produktkatalog": "Product Catalog",
  "Entscheidungshilfe je Maßnahme (Dünger, PSM, Blattdünger, Beizung, Sorten) — pflegbar & sync-ready für die NEOS Web App.":
    "Decision aid per operation (fertilizer, CPP, foliar, seed treatment, varieties) — maintainable & sync-ready for the NEOS Web App.",
  "Produkte": "products",
  "Export JSON": "Export JSON",
  "+ Produkt": "+ Product",
  "Zulassungen ändern sich. Vor Einsatz jedes Produkt gegen das aktuelle rumänische Register prüfen — PSM/Beizung: MADR/PMDR (produse omologate); Sorten: ISTIS Catalog oficial. Als verboten/ausgelaufen markierte Produkte (rot) nicht einsetzen.":
    "Authorizations change. Before use, check every product against the current Romanian register — CPP/seed treatment: MADR/PMDR (authorized products); varieties: ISTIS official catalog. Do not use products flagged as banned/expired (red).",
  "Alle": "All",
  "Alle Kulturen": "All crops",
  "Suche …": "Search …",
  "Typ": "Type",
  "Wirkstoff / Nährstoffe": "Active ingredient / nutrients",
  "Kulturen": "Crops",
  "alle": "all",
  "Bearbeiten": "Edit",
  "Löschen": "Delete",
  "Keine Produkte für diesen Filter.": "No products for this filter.",
  "Quelle: Herstellerlabel & RO-Register-Recherche (2026-07). Änderungen werden im Modell gespeichert.":
    "Source: manufacturer labels & RO register research (2026-07). Changes are saved in the model.",
  "Auf recherchierten Seed-Katalog zurücksetzen": "Reset to the researched seed catalog",
  "Katalog zurücksetzen": "Reset catalog",
  "Neues Produkt": "New product",
  "Aufwand min": "Rate min",
  "Aufwand max": "Rate max",
  "Einheit": "Unit",
  "Zulassungsnr.": "Auth. no.",
  "Kulturen (Komma, * = alle)": "Crops (comma, * = all)",
  "Indikationen / Ziele (Komma)": "Indications / targets (comma)",
  "Hinweis": "Note",

  // — Maßnahmen-Journal (einzelne Maßnahmen) —
  "+ Düngegabe": "+ Fertilizer dose",
  "+ PSM-Anwendung": "+ CPP application",
  "+ Maschinen-Maßnahme …": "+ Machinery operation …",
  "Jede Maßnahme einzeln — für den späteren Abgleich Plan ↔ Ist im Farm-Management-System.":
    "Each operation individually — for later plan vs. actual reconciliation in the farm management system.",
  "Fertigation (Pivot)": "Fertigation (pivot)",
  "Unterfuß (mit Aussaat)": "Sub-seed placement (with sowing)",
  "Plan exportieren": "Export plan",
  "Maßnahmenplan als JSON exportieren (stabile IDs für den FMS-Abgleich)": "Export operations plan as JSON (stable IDs for FMS reconciliation)",
  "Stabile Maßnahmen-ID für den FMS-Abgleich": "Stable operation ID for FMS reconciliation",
  "Stufe 1 · nur Ackerbau": "Stage 1 · arable only",
  "Stufe 1a · + Wertkulturen": "Stage 1a · + value crops",
};
export default B7;
