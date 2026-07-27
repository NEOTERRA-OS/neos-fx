/** DE → EN · Block 10 — Kulturnamen + neue Anbauplan-/Beregnungs-Strings (Full-Review). */
const B10: Record<string, string> = {
  // Kulturnamen (CROP_NAME + Katalog + Dryland-Labels)
  "Winterweizen": "Winter wheat",
  "Wintergerste + Doppel-Soja": "Winter barley + double soy",
  "Wintergerste": "Winter barley",
  "Soja / Luzerne": "Soybean / Alfalfa",
  "Winterraps": "Winter rapeseed",
  "Körnermais": "Grain maize",
  "Industrietomate": "Processing tomato",
  "Kartoffel (Pommes)": "Potato (fries)",
  "Kartoffel (Chips)": "Potato (chips)",
  "Zwiebel / Möhre": "Onion / Carrot",
  "Süßkartoffel": "Sweet potato",
  "Knoblauch": "Garlic",
  "Knollensellerie": "Celeriac",
  "Winterweizen (trocken)": "Winter wheat (rain-fed)",
  "Wintergerste (trocken)": "Winter barley (rain-fed)",
  "Winterraps (trocken)": "Winter rapeseed (rain-fed)",

  // Tabs / Ansicht
  "Ansicht": "View",
  "Anbauplan": "Cropping plan",
  "Erträge": "Yields",
  "Preise": "Prices",

  // Anbauplan — zusammengeführte Tabelle
  "Anbauplan — Kulturen & Flächen": "Cropping plan — crops & areas",
  "Anbauplan (Stufe 1: reiner Ackerbau)": "Cropping plan (Stage 1: arable only)",
  "Beregnete Kulturen + unberegnete Trockenrotation in einer Tabelle. Agronomie aus dem Katalog; Trockenfläche als Netto-Deckungsbeitrag.":
    "Irrigated crops + rain-fed dryland rotation in one table. Agronomy from the catalog; dryland as net contribution margin.",
  "Agronomie-Kosten aus dem Katalog (Maschinen separat).": "Agronomy costs pulled from the catalog (machinery separate).",
  "Gesamtbetrieb · Σ": "Whole farm · Σ",
  "Gesamtbetrieb": "Whole farm",
  "Beregnung": "Irrigation",
  "beregnet": "irrigated",
  "trocken": "rain-fed",
  "Fläche": "Area",
  "€/ha": "€/ha",
  "Σ €": "Σ €",
  "Beregnet ·": "Irrigated ·",
  "Trocken ·": "Rain-fed ·",
  "Kulturen": "crops",
  "Stufe 1 zeigt die abgeleitete Benchmark-Rotation (reiner Ackerbau, ohne Wertkulturen) — schreibgeschützt. Zum Bearbeiten des Basis-Plans Stufe 1a / 2b / 3c wählen.":
    "Stage 1 shows the derived benchmark rotation (arable only, no value crops) — read-only. To edit the base plan, choose Stage 1a / 2b / 3c.",
  "Stufe 1: reine Cash-Crop-Rotation (abgeleitet, nicht editierbar).": "Stage 1: pure cash-crop rotation (derived, not editable).",
  "Fläche ändern → Kosten & Maschinen rechnen automatisch nach.": "Change area → costs & machinery recalculate automatically.",
  "Trockenzeilen sind aus dem Wachstumsplan abgeleitet; DB bereits in EBITDA/Cashflow.":
    "Rain-fed rows are derived from the growth plan; margin already in EBITDA/cash flow.",

  // Produktion
  "Anbaustruktur & Produktion": "Cropping structure & production",
  "Fläche (ha)": "Area (ha)",
  "Anteil": "Share",
  "Ertrag (t/ha)": "Yield (t/ha)",
  "Verlust": "Loss",
  "Produktion netto (t)": "Net production (t)",
  "Netto-Erntemenge nach Feld-/Lagerverlust. Beregnete Kulturen: Basis für Umsatz (× Preis × Kontrakt-Qualität). Trockenkulturen (☀): Rain-fed-Ertrag mit eigener Bottom-up-Kalkulation — volle Kosten (Agronomie, Maschinen, Personal, Fixkosten) über die gesamte Fläche gerechnet, nicht als Pauschale. Flächenentwicklung über die Jahre steht im Wachstumsplan.":
    "Net harvest after field/storage loss. Irrigated crops: basis for revenue (× price × contract quality). Dryland crops (☀): rain-fed yield with their own bottom-up costing — full costs (agronomy, machinery, personnel, fixed costs) computed over the entire area, not as a lump sum. Area development over the years is in the growth plan.",

  // Logo / Nav
  "Zum Dashboard": "To dashboard",
  "Neu berechnet": "Recalculated",

  // Rotations-Optimierer
  "Rotations-Optimierer (Trockenrotation)": "Rotation optimizer (dryland)",
  "DB-maximal unter Anbaupausen · deterministisch": "Margin-maximal under rotation breaks · deterministic",
  "Sonnenblume": "Sunflower",
  "wirtschaftlich attraktiv": "economically attractive",
  "kein Vorteil": "no advantage",
  "vs.": "vs.",
  "Ist-Rotation": "Current rotation",
  "Optimierte Rotation": "Optimized rotation",
  "Σ Deckungsbeitrag": "Σ contribution margin",
  "Mehr-Deckungsbeitrag": "Additional contribution margin",
  "In Anbauplan übernehmen": "Apply to cropping plan",
  "Übernimmt die optimierte Trockenrotation in den Anbauplan": "Applies the optimized dryland rotation to the cropping plan",
  "Betrachter-Modus: Änderungen gesperrt": "Viewer mode: editing locked",
  "Die aktuelle Trockenrotation ist bereits DB-optimal.": "The current dryland rotation is already margin-optimal.",
  "Bindende Anbaupausen:": "Binding rotation breaks:",
  "Die Ölsaaten (Raps + Sonnenblume) teilen sich als Sclerotinia-Wirte einen Break-Slot; Getreide ist auf 2/3 der Trockenfläche begrenzt.": "Oilseeds (rapeseed + sunflower), both Sclerotinia hosts, share one break slot; cereals are capped at 2/3 of the dryland area.",
  "Keine Trockenrotation im aktuellen Anbauplan — der Optimierer greift auf der unberegneten Fläche.": "No dryland rotation in the current plan — the optimizer operates on the rain-fed area.",
};
export default B10;
