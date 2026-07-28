/** Block 11 — Sprach-Review: nachgezogene DE→EN-Übersetzungen (Team/Zugriff, Login/Auth,
 *  Sensitivität, CAPEX-Editor, Sidebar/TopBar, diverse Panel-Labels). Deutscher Text = Schlüssel. */
const B11: Record<string, string> = {
  // — Team & Zugriff / Rollen —
  "Team & Zugriff": "Team & Access",
  "Deine Rolle": "Your role",
  "Rolle": "Role",
  "Rolle aktualisiert.": "Role updated.",
  "Mitglied": "Member",
  "Mitglied entfernt.": "Member removed.",
  "Noch keine weiteren Mitglieder.": "No further members yet.",
  "Einladen": "Invite",
  "E-Mail einladen": "Invite by email",
  "Eingeladen / hinzugefügt.": "Invited / added.",
  "Entfernen": "Remove",
  "entfernen": "remove",
  "Betrachter": "Viewer",
  "Betrachter (nur lesen)": "Viewer (read-only)",
  "Editor (bearbeiten)": "Editor (edit)",
  "Owner (Admin)": "Owner (admin)",
  "= volle Verwaltung · ": "= full administration · ",
  "= darf das Modell ändern · ": "= may edit the model · ",
  "= nur lesen & kommentieren (App startet automatisch im Betrachter-Modus).":
    "= read & comment only (the app starts in viewer mode automatically).",
  "Mitglieder einladen und Rollen vergeben — ohne SQL. Nur der Owner kann verwalten.":
    "Invite members and assign roles — no SQL. Only the owner can manage.",
  "Bereits registrierte Personen werden direkt hinzugefügt; neue bekommen eine Einladung per E-Mail (sofern E-Mail-Versand konfiguriert ist).":
    "Already-registered people are added directly; new ones receive an email invitation (if email delivery is configured).",
  "Supabase ist nicht konfiguriert — Team-Verwaltung inaktiv.": "Supabase is not configured — team administration inactive.",
  "Supabase ist nicht konfiguriert.": "Supabase is not configured.",
  "Bitte zuerst anmelden. Danach erscheint hier die Team-Verwaltung.":
    "Please sign in first. Team administration then appears here.",
  "Nur der Owner des geteilten Modells kann Mitglieder verwalten.":
    "Only the owner of the shared model can manage members.",
  "Noch kein geteiltes Modell vorhanden. So wirst du zum Owner: einmal unter »Speichern & Versionen« speichern (oder einen Wert ändern) — das legt das Team-Modell an und macht dich automatisch zum Owner. Danach Seite neu laden, dann erscheint hier die Verwaltung.":
    "No shared model exists yet. How to become owner: save once under »Save & Versions« (or change a value) — that creates the team model and makes you the owner automatically. Then reload the page and administration appears here.",
  "Nicht angemeldet — im Betrachter-Modus. Zum Speichern in der Cloud bitte über das Login anmelden; Mitglieder und Rollen verwaltest du im Modul »Team & Zugriff«.":
    "Not signed in — in viewer mode. To save to the cloud, please sign in via the login; you manage members and roles in the »Team & Access« module.",

  // — Login / Auth —
  "Finanz-Cockpit — planen, prüfen, entscheiden.": "Finance cockpit — plan, review, decide.",
  "Konto erstellen": "Create account",
  "Registriere dich mit deiner @neoterra.ag-Adresse.": "Register with your @neoterra.ag address.",
  "Registriert — bitte E-Mail bestätigen, dann anmelden.": "Registered — please confirm your email, then sign in.",
  "Anmeldung fehlgeschlagen.": "Sign-in failed.",
  "Melde dich an, um fortzufahren.": "Sign in to continue.",
  "Noch kein Konto?": "No account yet?",
  "Schon registriert?": "Already registered?",
  "Nur ansehen?": "Just viewing?",
  "Betrachter-Modus öffnen": "Open viewer mode",
  "Betrachter-Modus": "Viewer mode",
  "GoBD-konform · Daten in der EU": "GoBD-compliant · Data in the EU",
  "angemeldet als": "signed in as",
  "du": "you",

  // — TopBar / Shell —
  "Granularität": "Granularity",
  "Währung": "Currency",
  "Skalierungsstufe": "Scaling stage",
  "Lädt …": "Loading …",

  // — Produktion / Anbau —
  "Beregnete Kulturen + unberegnete Trockenrotation in einer Tabelle. Jede Kultur mit eigener Bottom-up-Kalkulation.":
    "Irrigated crops + rain-fed dryland rotation in one table. Each crop with its own bottom-up costing.",
  "Trockenkulturen laufen nativ mit eigener Kalkulation (☀ trocken); Maschinen über die volle Fläche.":
    "Dryland crops run natively with their own costing (☀ rain-fed); machinery over the full area.",

  // — Sensitivität / Financials / diverse Panels —
  "Aufwand": "Expense",
  "Behobene Hinweise": "Resolved notes",
  "Alle Konten zugeordnet": "All accounts assigned",
  "ausgeglichen": "balanced",
  "außerh. Benchmark": "outside benchmark",
  "Agronomie-Wächter OK (alle Pflicht-Maßnahmen je Kultur vorhanden)":
    "Agronomy guard OK (all mandatory operations present per crop)",
  "Gemietet": "Rented",
  "Intercompany-Miete (z. B. von Isolde): gemietete Einheiten, kein CAPEX — stundenbasierte Miet-OPEX":
    "Intercompany rental (e.g. from Isolde): rented units, no CAPEX — hours-based rental OPEX",
  "Maschinen-Miete (Intercompany) /Monat": "Machinery rental (intercompany) /month",
  "Miet-Aufschlag Intercompany (auf Stundenkosten)": "Rental markup intercompany (on hourly cost)",
  "Gesellschafts-Case ableiten": "Derive entity case",
  "→ NEOTERRA (Value Crops) ableiten": "→ Derive NEOTERRA (Value Crops)",
  "Erzeugt aus dem Kombimodell einen eigenständigen Wertkultur-Case (nur Value Crops, eigene Spezialflotte, Vollkosten). Das aktuelle Kombimodell bleibt unberührt, bis du speicherst.":
    "Derives a standalone value-crop case from the combined model (value crops only, own specialized fleet, full costs). The current combined model stays untouched until you save.",
  "neoterra-Value-Crop-Case abgeleitet — Zahlen prüfen, dann unten »Als neues Modell speichern«.":
    "neoterra value-crop case derived — check the figures, then use »Save as new model« below.",
  "Finanzierung & Funding": "Financing & Funding",
  "Kapitalbedarf im Jahresverlauf": "Capital requirement over the year",
  "zilieri FTE": "day-laborer FTE",

  // — Sensitivität-Szenarien / diverse Panel-Labels & Dropdowns —
  "Trockenjahr": "Dry year",
  "Preisverfall Kartoffel": "Potato price drop",
  "Zins- & Kostenschock": "Interest & cost shock",
  "Begründung": "Rationale",
  "Ernte": "Harvest",
  "Getreide/Ölsaat": "Cereals/oilseed",
  "Getreide/Ölsaat/Soja/Mais": "Cereals/oilseed/soy/maize",
  "Gründer": "Founder",
  "Gründer / Management": "Founders / Management",
  "Kontrakt-Qualität (Erfüllung 0..1)": "Contract quality (fulfillment 0..1)",
  "Makro & Steuer": "Macro & Tax",
  "Preis & Verlust (€/t · %)": "Price & loss (€/t · %)",
  "Steuer-Optimierung & Finanzierung": "Tax optimization & financing",
  "Stück": "Units",
  "Stücksätze (Inputs)": "Unit rates (inputs)",
  "Rumänien": "Romania",
  "Keine Übernahmen — „+ Übernahme\".": "No acquisitions — \"+ Acquisition\".",
  " J). „+ Stufe\" für individuelle Anhebungen.": " yrs). \"+ Stage\" for individual increases.",
  "\" hinzufügen": "\" add",

  // — Längere Fußnoten/Hilfetexte (Fragmente aus t()-Konkatenation) —
  "Setze mit „Baseline = aktueller Plan\" einen Referenzstand. Danach zeigt dieses Panel bei jeder Änderung, wie sich Deckungsbeitrag, agronomisches Risiko und Wasserbedarf verschieben — und welche Hinweise neu entstehen oder wegfallen.":
    "Set a reference state with \"Baseline = current plan\". This panel then shows, for every change, how contribution margin, agronomic risk and water demand shift — and which notes newly appear or disappear.",
  " entfällt die große Mähdrescher-Flotte. Die CAPEX-Wirkung je Szenario ist oben („Voll durchgerechnet je Szenario\") bereits real aus dem Schlagkraft-Sizing gerechnet.":
    " the large combine fleet is dropped. The CAPEX effect per scenario is already computed for real above (\"Fully modeled per scenario\") from the capacity sizing.",
  "/Probe. Labor fällt bei Eigen & DL an → kürzt sich im Delta; Ersparnis-Treiber ist die Entnahme. Bei „Eigen\" fließt CAPEX (":
    "/sample. Labor accrues for both in-house & contractor → cancels out in the delta; the savings driver is the extraction. For \"in-house\", CAPEX flows (",
  "Effektive Kosten = Netto-Einkauf (Liste − Rabatt) − Rücknahme/Restwert am Ende der Haltedauer. Rabatt/Restwert-Sätze im View „Preise & Treiber\" (TCO). JD-Schlepper 8RX 410 / 6R 260 mit realen Angebotswerten. Cash-Effekte (Rabatt beim Einkauf → Netto-CAPEX; AfA auf den Restwert) sind in GuV/Bilanz verdrahtet.":
    "Effective cost = net purchase (list − discount) − buy-back/residual value at end of holding period. Discount/residual rates in the \"Prices & drivers\" view (TCO). JD tractors 8RX 410 / 6R 260 with real quotation values. Cash effects (discount at purchase → net CAPEX; depreciation on the residual value) are wired into P&L/balance sheet.",
  "J; bei „Dienstleister\" nur laufende OPEX. Volle Aufschlüsselung & Parameter im Rechner (CAPEX Szenarien → Bodenprobenahme).":
    "yrs; for \"contractor\" only ongoing OPEX. Full breakdown & parameters in the calculator (CAPEX scenarios → soil sampling).",
  " Monate: Anfangskasse → operativer + investiver + USt- + Finanzierungs-Cashflow → Revolver gleicht Lücken bis zur Linie aus → Endkasse. „Verfügbare Liquidität\" = Endkasse + freie Kreditlinie; der Tiefpunkt zeigt den maximalen Finanzierungsbedarf (Saison-Swing, CAPEX-/Avans-/USt-Spitzen).":
    " months: opening cash → operating + investing + VAT + financing cash flow → revolver bridges gaps up to the line → closing cash. \"Available liquidity\" = closing cash + free credit line; the low point shows the maximum funding need (seasonal swing, CAPEX/advance/VAT peaks).",
  "= Hybrid-Override (manuelle Stückzahl, „×\" löst ihn). Zugklassen sind gepoolt (C_eff aus den Anbaugeräten), daher ohne Breite/Speed.":
    "= hybrid override (manual unit count, \"×\" clears it). Tractor classes are pooled (C_eff from the implements), hence without width/speed.",
  "= Bestand reicht nicht (Zukauf n). „Bestand trägt bis\" = Fläche, bis zu der der heutige Bestand ohne Zukauf ausreicht — die kleinste Zahl ist dein erster Engpass.":
    "= existing fleet insufficient (purchase n). \"Fleet covers up to\" = area up to which today's fleet suffices without purchase — the smallest number is your first bottleneck.",
  "(2.000–3.000 €/ha → Land+Gebäude + Maschinen-Zeitwert). FK = Akquisitionskredit-Anteil je Deal. „In Flächen-Ramp übernehmen\" leitet die Fläche aus heute + Akquisitionen ab.":
    "(2,000–3,000 €/ha → land+buildings + machinery book value). Debt = acquisition-loan share per deal. \"Apply to area ramp\" derives the area from today + acquisitions.",
  "gesetzlich gedeckelt, jährlicher „indice national des fermages\" (Betriebseinkommen + Preisniveau).":
    "legally capped, annual \"indice national des fermages\" (farm income + price level).",
  "üblich als eigene Zeile „Pacht & Mieten\" bzw. sonstige betriebliche Aufwendungen — über dem EBIT, kein COGS.":
    "usually as a separate line \"leases & rents\" or other operating expenses — above EBIT, not COGS.",
  ". Die Flotte fließt über den TCO-Pfad in CAPEX/Bilanz. Alle operativen Größen unter „Preise & Treiber → Spritzstrategie\".":
    ". The fleet flows via the TCO path into CAPEX/balance sheet. All operating figures under \"Prices & drivers → spraying strategy\".",
  "€/ha): Wertkulturen binden mehr Kapital (Spezialtechnik, Lager) und mehr Arbeit, erwirtschaften je Hektar aber ein Vielfaches. Der reine Ackerbau (Stufe 1) ist der faire, effiziente Vergleichsmaßstab — kein „Schlechtrechnen\", sondern der belastbare Boden, auf dem der Wertkultur-Aufschlag steht.":
    "€/ha): value crops tie up more capital (specialized machinery, storage) and more labor, but earn a multiple per hectare. Pure arable farming (stage 1) is the fair, efficient benchmark — not \"talking it down\", but the solid ground on which the value-crop premium stands.",
};
export default B11;
