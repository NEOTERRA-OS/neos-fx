/** Block 12 — Szenario-Studio (Scenario Planning Studio): Treiber, Presets, KPI-Band,
 *  Saison-Cashflow, Sensitivitäts-Matrix, CapEx-Rechner. Deutscher Text = Schlüssel. */
const B12: Record<string, string> = {
  // — Rahmen / Steuerung —
  "Szenario-Studio": "Scenario Studio",
  "Szenario-Preset": "Scenario preset",
  "Szenario-Kennzahlen": "Scenario KPIs",
  "Headline-Jahr · Δ gegen Base Case": "Headline year · Δ vs. base case",
  "Eigene Einstellung": "Custom setting",
  "Zurücksetzen": "Reset",
  "Auf Modellwert zurücksetzen": "Reset to model value",
  "Ins Modell übernehmen": "Commit to model",
  "Reglerstand fest in die Annahmen des aktiven Szenarios schreiben":
    "Write the current slider state into the assumptions of the active scenario",
  "Betrachter-Modus: Modell schreibgeschützt": "Viewer mode: model is read-only",
  "Treiber": "Drivers",
  "aktiv": "active",

  // — Presets —
  "Base Case": "Base case",
  "Modell-Baseline — alle Treiber auf den hinterlegten Annahmen.":
    "Model baseline — every driver on the stored assumptions.",
  "Infrastruktur-Ausfall": "Infrastructure failure",
  "Netz-/Pumpenausfall des ANIF-Zentralnetzes in der Hitzespitze (12 Tage), erhöhte Wassernorm — ohne Donau-Direktentnahme rd. −35 % Ertrag auf den Wertkulturen.":
    "Grid/pump failure of the central ANIF network during peak heat (12 days) plus a higher water norm — without the direct Danube intake roughly −35 % yield on the high-value crops.",
  "Stagflation": "Stagflation",
  "Stagflation / Input-Schock": "Stagflation / input shock",
  "+30 % auf Dünger, Pflanzenschutz und Energie/Diesel, −15 % Spotpreise, +200 bp Zins, Input-Inflation 4,5 % p. a. (Basis 2,5 %).":
    "+30 % on fertiliser, crop protection and energy/diesel, −15 % spot prices, +200 bps interest, input inflation 4.5 % p.a. (base 2.5 %).",
  "Bull / Vertikal": "Bull / vertical",
  "Bull / Max. Vertikalisierung": "Bull / max. vertical integration",
  "Hohe Erträge, volle lokale Verarbeitung (25 km), maximale Brix-/Sortierprämien, Donau-Direktentnahme als Redundanz.":
    "High yields, full local processing (25 km), maximum Brix/grading premiums, direct Danube intake as redundancy.",

  // — Treibergruppen —
  "Ertrag (Agronomie)": "Yield (agronomy)",
  "Preis, Kontrakt & Qualität": "Price, contract & quality",
  "Subventionen (GAP/PNS)": "Subsidies (CAP/PNS)",
  "Klima- & Infrastrukturrisiko": "Climate & infrastructure risk",
  "Input-Preise (OPEX)": "Input prices (OPEX)",
  "Logistik & Verarbeitung": "Logistics & processing",
  "Makro, Steuer & Working Capital": "Macro, tax & working capital",

  // — Treiber: Ertrag —
  "Ertrag Industrietomate": "Yield processing tomato",
  "Ertrag Kartoffel (Pommes/Markies)": "Yield potato (fries/Markies)",
  "Ertrag Kartoffel (Chips)": "Yield potato (chips)",
  "Ertrag Zwiebel/Möhre": "Yield onion/carrot",
  "Ertrag Rotations-/Break Crops (alle)": "Yield rotation/break crops (all)",
  "Verlust / Schwund (alle Kulturen)": "Losses / shrinkage (all crops)",
  "Basisbereich Kontrakt 75–90 t/ha": "contract base range 75–90 t/ha",
  "Basisbereich 45–50 t/ha": "base range 45–50 t/ha",
  "Getreide, Raps, Soja, Mais, Trockenanbau": "cereals, rapeseed, soy, maize, dryland",

  // — Treiber: Preis / Qualität —
  "Kontraktanteil Wertkulturen": "Contract share high-value crops",
  "Rest wird zum Spotpreis vermarktet": "remainder is sold at spot",
  "Spotpreis-Delta": "Spot price delta",
  "wirkt voll auf Break Crops, anteilig (1 − Kontraktanteil) auf Wertkulturen":
    "full effect on break crops, pro rata (1 − contract share) on high-value crops",
  "Brix-Prämie / -Abzug Tomate": "Brix premium / penalty tomato",
  "Qualitätsstaffel des Verarbeiters (°Brix)": "processor quality scale (°Brix)",
  "Sortier-/Qualitätsprämie Kartoffel": "Grading/quality premium potato",
  "Stärke, Untergrößen, Zuckergehalt (Chips)": "starch, undersize, sugar content (chips)",
  "Kontraktpreis Industrietomate": "Contract price processing tomato",
  "Kontraktpreis Kartoffel (P + C)": "Contract price potato (fries + chips)",
  "Preis Rotations-/Break Crops (alle)": "Price rotation/break crops (all)",

  // — Treiber: Subventionen —
  "GAP-Basisprämie": "CAP basic payment",
  "Gekoppelte Stützung Freilandgemüse (PNS)": "Coupled support field vegetables (PNS)",
  "Tomate + Zwiebel/Möhre, bewässert": "tomato + onion/carrot, irrigated",

  // — Treiber: Klima & Infrastruktur —
  "Beregnungsausfall in der Hitzespitze": "Irrigation downtime during peak heat",
  "ANIF-Zentralnetz: Pumpen-/Netzausfall in Juli/August":
    "central ANIF network: pump/grid outage in July/August",
  "Direktentnahme Donau aktiv": "Direct Danube intake active",
  "eigene Entnahme + Pumpstation als Redundanz zum ANIF-Netz":
    "own intake + pumping station as redundancy to the ANIF network",
  "Redundanz-Wirkung der Direktentnahme": "Mitigation effect of the direct intake",
  "Ertragsverlust je Ausfalltag (Wertkultur)": "Yield loss per outage day (high-value crop)",
  "Ausfall-Wirkung auf Break Crops": "Outage effect on break crops",
  "Wassernorm (Skalierung der Plan-mm)": "Water norm (scaling of planned mm)",
  "Trockenjahr = höhere Norm → mehr m³/ha und Energie":
    "dry year = higher norm → more m³/ha and energy",
  "Bewässerung Energie + Wasser": "Irrigation energy + water",

  // — Treiber: OPEX —
  "Düngerpreise N / P / K / S": "Fertiliser prices N / P / K / S",
  "Saat-/Pflanzgut (inkl. Jungpflanzen)": "Seed/planting material (incl. transplants)",
  "Pflanzenschutz (Mittelkosten)": "Crop protection (product cost)",
  "eigener Stücksatz — unabhängig von Material/Handarbeit":
    "separate unit rate — independent of materials/manual labour",
  "Dieselpreis": "Diesel price",
  "Lohnsatz (Saison)": "Wage rate (seasonal)",
  "Material / Handarbeit (Stücksatz)": "Materials / manual labour (unit rate)",

  // — Treiber: Logistik —
  "Entfernung zum Abnehmer": "Distance to off-taker",
  "lokale Verarbeitung ↓ vs. Dritt-Abnehmer ↑ — skaliert den €/t-Satz linear":
    "local processing ↓ vs. third-party off-take ↑ — scales the €/t rate linearly",
  "Speditionssatz (Referenz-Entfernung)": "Haulage rate (reference distance)",
  "Werkskapazität Tomate": "Plant capacity tomato",
  "Transport-Fixkosten p.a.": "Transport fixed cost p.a.",

  // — Treiber: Makro —
  "Zinsschock auf EURIBOR (additiv)": "Interest-rate shock on EURIBOR (additive)",
  "0,25 = +25 bp · 2,00 = +200 bp": "0.25 = +25 bps · 2.00 = +200 bps",
  "EURIBOR 3M (Basis)": "EURIBOR 3M (base)",
  "Körperschaftsteuer (RO)": "Corporate income tax (RO)",
  "Input-Inflation p.a.": "Input inflation p.a.",
  "Output-Inflation p.a.": "Output inflation p.a.",
  "DSO — Forderungstage": "DSO — receivable days",
  "DPO — Verbindlichkeitstage": "DPO — payable days",
  "Lagertage Fertigerzeugnisse": "Inventory days finished goods",
  "einheitlich für den gesamten Umsatz — Base 14 d ist das Verhandlungsziel":
    "unified across all revenue — base 14 d is the negotiation target",
  "ohne Wirkung, solange der Umsatz im Erntemonat gebucht wird — die wachsende Kultur steckt im Feldbestand":
    "no effect while revenue is booked in the harvest month — the growing crop sits in work in progress",

  // — KPI-Band —
  "Umsatz Wertkulturen": "Revenue high-value crops",
  "Umsatz Rotation/Break": "Revenue rotation/break",
  "vom Erlös": "of revenue",
  "Marge": "Margin",
  "nach Zins & Steuer": "after interest & tax",
  "Working-Capital-Peak": "Working capital peak",
  "min. Liquidität": "min. liquidity",
  "Cash-Runway": "Cash runway",
  "min. Liquidität / Ø Monatsburn": "min. liquidity / avg. monthly burn",
  "Mon.": "mo.",
  "Covenant": "covenant",

  // — Saisonaler Cashflow —
  "Saisonaler Cashflow — Vorfinanzierung H1 vs. Ernte-Zufluss H2":
    "Seasonal cash flow — H1 pre-financing vs. H2 harvest inflow",
  "operativer Zufluss": "operating inflow",
  "operativer Abfluss": "operating outflow",
  "Liquidität (Szenario)": "liquidity (scenario)",
  "Base Case (gestrichelt)": "base case (dashed)",

  // — Sensitivitäts-Matrix —
  "Sensitivitäts-Matrix — Jahres-EBITDA bei Ertrag × Preis":
    "Sensitivity matrix — annual EBITDA over yield × price",
  "Szenario-Mitte": "scenario centre",
  "Ertrag \\ Preis": "Yield \\ price",
  "Zeilen = Ertragsauslenkung aller Kulturen, Spalten = Preisauslenkung. Die Matrix rechnet auf dem AKTUELLEN Reglerstand — die Mitte entspricht dem Szenario oben.":
    "Rows = yield deflection across all crops, columns = price deflection. The matrix computes on the CURRENT slider state — the centre equals the scenario above.",

  // — CapEx-Rechner —
  "CapEx-Rechner — Amortisation & Rendite": "CapEx calculator — payback & return",
  "Investitionsobjekt": "Investment",
  "Pivot-Beregnung": "Pivot irrigation",
  "Lokale Verarbeitung": "Local processing",
  "CapEx je Einheit": "CapEx per unit",
  "Nutzen p.a.": "Benefit p.a.",
  "Nutzungsdauer": "Useful life",
  "Kalkulationszins": "Discount rate",
  "Investition": "Investment",
  "Payback statisch": "Payback (static)",
  "Payback dynamisch": "Payback (discounted)",
  "NPV / IRR": "NPV / IRR",
  "Vorbelegung aus dem Modell: Bewässerung €/ha, Lager/Packhaus €/t, EURIBOR + Zinsschock.":
    "Seeded from the model: irrigation €/ha, storage/pack house €/t, EURIBOR + rate shock.",

  // — Login: Passwort-Sichtbarkeit & Fehlermeldungen —
  "Passwort anzeigen": "Show password",
  "Passwort verbergen": "Hide password",
  "Verbindung wird geprüft …": "Checking connection …",
  "Keine Internetverbindung — der Browser ist offline.":
    "No internet connection — the browser is offline.",
  "Die Datei wurde lokal geöffnet (file://) und erreicht den Anmelde-Server nicht. Ohne Anmeldung lässt sich das Modell lokal voll nutzen — nur die Team-Cloud fehlt.":
    "The file was opened locally (file://) and cannot reach the sign-in server. Without signing in the model still works fully offline — only the team cloud is missing.",
  "Der Server ist erreichbar, aber der Anmelde-Aufruf wurde blockiert — meist durch eine Browser-Erweiterung (Adblocker/Privacy-Tool) oder ein Firmen-Netzwerk. Bitte im privaten Fenster ohne Erweiterungen erneut versuchen.":
    "The server is reachable, but the sign-in call was blocked — usually by a browser extension (ad blocker/privacy tool) or a corporate network. Please try again in a private window without extensions.",
  "Server nicht erreichbar (supabase.co wird blockiert). Bitte Netzwerk/VPN/Firewall prüfen oder ein anderes Netz verwenden.":
    "Server unreachable (supabase.co is being blocked). Please check network/VPN/firewall or use a different network.",
  "E-Mail oder Passwort stimmt nicht.": "Email or password is incorrect.",
  "E-Mail noch nicht bestätigt — bitte den Bestätigungslink im Postfach öffnen.":
    "Email not confirmed yet — please open the confirmation link in your inbox.",
  "Für diese E-Mail existiert bereits ein Konto — bitte anmelden.":
    "An account already exists for this email — please sign in.",
  "Zu viele Versuche — bitte einen Moment warten.": "Too many attempts — please wait a moment.",
  "Lokale Datei (file://) — die Anmeldung kann hier je nach Browser und Netzwerk fehlschlagen. Das Modell rechnet lokal vollständig; ohne Anmeldung wird der Stand in diesem Browser gesichert statt in der Team-Cloud.":
    "Local file (file://) — sign-in may fail here depending on browser and network. The model computes fully offline; without signing in your work is saved in this browser instead of the team cloud.",
  "Ohne Anmeldung öffnen": "Open without signing in",
  "Lokal arbeiten?": "Work locally?",
  "Lokal gespeichert (dieser Browser)": "Saved locally (this browser)",
  "Nicht gespeichert — JSON-Export nutzen": "Not saved — use JSON export",
  "Automatisches Speichern in der Team-Cloud (Supabase). Ist die Cloud nicht erreichbar, sichert die App lokal in diesem Browser — der Stand überlebt einen Reload, wird aber nicht mit dem Team geteilt.":
    "Automatic saving to the team cloud (Supabase). If the cloud is unreachable the app saves locally in this browser — your work survives a reload but is not shared with the team.",

  /* --- Zusammenführung Sensitivität → Szenario-Studio -------------------- */
  "Ansicht": "View",
  "Simulation": "Simulation",
  "Tornado": "Tornado",
  "Szenario-Vergleich": "Scenario comparison",
  "Szenarien": "Scenarios",
  "Als Szenario speichern": "Save as scenario",
  "Aktuellen Reglerstand als eigenes Szenario im Register ablegen": "Store the current slider state as your own scenario in the register",
  "Name des Szenarios": "Scenario name",
  "Speichern": "Save",
  "Abbrechen": "Cancel",
  "Treiber ausgelenkt": "drivers deflected",
  "Szenario löschen": "Delete scenario",
  "Tornado — Δ EBITDA je Treiber": "Tornado — Δ EBITDA per driver",
  "gerechnet um den aktuellen Reglerstand": "computed around the current slider state",
  "gerechnet um die Modell-Basis": "computed around the model baseline",
  "Keine Treiber ausgewählt.": "No drivers selected.",
  "Treiber entfernen": "Remove driver",
  "Treiber hinzufügen": "Add driver",
  "Treiber hinzufügen …": "Add driver …",
  "Jede Zeile lenkt den Treiber ±x % aus und rechnet das vollständige Modell neu.": "Each row deflects the driver by ±x % and recomputes the full model.",
  "Alle Szenarien des Registers gegen die Modell-Basis — Headline-Jahr": "All scenarios in the register against the model baseline — headline year",
  "Szenario": "Scenario",
  "EBITDA / J.": "EBITDA / yr",
  "Δ vs. Basis": "Δ vs. baseline",
  "Umsatz / J.": "Revenue / yr",
  "Modell-Basis": "Model baseline",
  "eigen": "custom",
  "Laden": "Load",
  "Szenario in die Regler laden": "Load scenario into the sliders",
  "Trockenjahr": "Drought year",
  "Preisverfall Kartoffel": "Potato price slump",
  "Zins- & Kostenschock": "Rate & cost shock",
  "Ertrag Wertkulturen (alle)": "Yield value crops (all)",
  "Ertrag alle Kulturen": "Yield all crops",
  "Preis Wertkulturen (alle)": "Price value crops (all)",
  "Preis Zwiebel/M\u00f6hre": "Price onion/carrot",
  "Kontrakt-Qualit\u00e4t Wertkulturen": "Contract quality value crops",
  "Qualit\u00e4t Kartoffel (St\u00e4rke/Zucker)": "Potato quality (starch/sugar)",
  "Qualit\u00e4t Tomate (Brix)": "Tomato quality (Brix)",
  "L\u00f6hne gesamt (Stamm + Saison)": "Total wages (core + seasonal)",
  "Maschinen-Einkaufsrabatt (TCO)": "Machinery purchase discount (TCO)",
  "Sammeltreiber \u00fcber alle Wertkulturen": "Aggregate driver across all value crops",
  "Trockenjahr-Sammeltreiber": "Drought-year aggregate driver",
  "realisierter Preis nach Bonus/Malus \u00d7 akzeptierte Menge": "realised price after bonus/malus \u00d7 accepted volume",
  "−15 % Ertrag über alle Kulturen, −6 % Kontrakt-Qualität der Wertkulturen, +15 % Bewässerungskosten je mm.":
    "−15 % yield across all crops, −6 % contract quality on the value crops, +15 % irrigation cost per mm.",
  "−25 % Kontraktpreis Kartoffel (Pommes + Chips), −5 % Qualitätserfüllung.":
    "−25 % potato contract price (fries + chips), −5 % quality fulfilment.",
  "+50 % EURIBOR, +30 % Diesel, +25 % Dünger.": "+50 % EURIBOR, +30 % diesel, +25 % fertiliser.",
  "Tornado — Wirkung je Treiber": "Tornado — impact per driver",
  "Zielgröße": "Target metric",

  /* --- Abnahmeverträge (Off-taker) --- */
  "Abnahmeverträge (Off-taker)": "Off-take contracts (buyers)",
  "Vertrag hinzufügen": "Add contract",
  "Vertrag löschen": "Delete contract",
  "Mischpreis & Zahlungsziel je Kultur": "Blended price & payment term per crop",
  "Je Kultur wird die Erntemenge auf die aktiven Verträge aufgeteilt; die Restmenge geht zum Kulturpreis aus den Annahmen weg (Spot). Ohne Vertrag rechnet das Modell unverändert mit dem Kulturpreis. Die unten gepflegten Preise sind die des ":
    "Per crop the harvest is allocated across the active contracts; the remainder is sold at the crop price from the assumptions (spot). Without a contract the model calculates exactly as before, at the crop price. The prices maintained below are those of the ",
  "ersten Planjahrs": "first plan year",
  " — der unterschriebene Vertragspreis.": " — the signed contract price.",
  "Indexierung: Es sind Jahresverträge — im Mehrjahresplan wird jedes Jahr neu kontrahiert. Die Kontraktpreise wachsen deshalb ab Jahr 2 mit ":
    "Indexation: these are annual contracts — in the multi-year plan they are re-contracted every year. Contract prices therefore grow from year 2 at ",
  " p. a. (Output-Inflation)": " p.a. (output inflation)",
  ", also mit demselben Satz wie der Spotpreis. Der Abstand Mischpreis ↔ Spot bleibt damit über den Horizont proportional. Satz änderbar unter Makro & Finanzen (infl.output) bzw. im Szenario-Studio.":
    ", i.e. at the same rate as the spot price. The gap between blended price and spot therefore stays proportional across the horizon. The rate can be changed under Macro & Finance (infl.output) or in the Scenario Studio.",
  " — der Basispreis ist im Vertrag nicht befüllt. Der angesetzte Wert ist eine Annahme und muss nachgefordert werden.":
    " — the base price is not filled in the contract. The value used is an assumption and must be requested.",
  "Keine Abnahmeverträge hinterlegt — der Umsatz rechnet vollständig mit dem Kulturpreis.":
    "No off-take contracts on file — revenue is calculated entirely at the crop price.",
  "Erntemenge des ersten Planjahrs im aktuellen Szenario.": "Harvest volume of the first plan year in the current scenario.",
  "Erntemenge": "Harvest volume",
  "kontrahiert": "contracted",
  "Kontraktpreis Ø": "Contract price Ø",
  "Spotpreis": "Spot price",
  "Mischpreis": "Blended price",
  "Δ vs. Spot": "Δ vs. spot",
  "Zahlungsziel Ø": "Payment term Ø",
  "Zahlungsziel": "Payment term",
  "Mengenbindung": "Volume commitment",
  "feste Tonnage": "fixed tonnage",
  "Anteil der Ernte": "share of harvest",
  "der Erntemenge": "of the harvest",
  "Kontraktmenge": "Contract volume",
  "t/Jahr": "t/year",
  "Basispreis": "Base price",
  "Bonus/Malus": "Bonus/malus",
  "Preis bestätigt": "Price confirmed",
  "Platzhalterpreis": "Placeholder price",
  "Platzhalter": "Placeholder",
  "Zurückweisung": "Rejection rate",
  "Lagerung": "Storage",
  "Deckungskauf zulasten NEOTERRA. ": "Cover purchase at NEOTERRA's expense. ",
  "Forderung nicht abtretbar (kein Factoring). ": "Receivable not assignable (no factoring). ",
  "kein Lager": "no storage",
  "auf eigene Kosten, ohne Prämie": "at own cost, no premium",
  "Lagerbonus": "Storage bonus",

  // --- Paket B: Zahlungs-Timing und Anzahlungen der Off-taker ---
  "Bonus-Verzug": "Bonus delay",
  // --- Paket C: Downside ---
  "davon: Deckungskauf (Untererfüllung Kontrakt)": "of which: cover purchase (contract shortfall)",
  "Zurückweisungsquote am Werkstor": "Rejection rate at the factory gate",
  "Erlösabschlag; die Kosten bleiben, die Ware ist gewachsen":
    "revenue deduction; costs remain — the crop was grown",
  "Deckungskauf-Aufschlag je t Fehlmenge": "Cover-purchase premium per t of shortfall",
  "greift erst, wenn die Ernte unter die kontrahierte Menge fällt":
    "bites only once the harvest falls below the contracted volume",
  // --- Feldbestand-Aktivierung / Working Capital Kostenseite ---
  "Feldbestand (wachsende Kultur, zu Herstellungskosten)": "Growing crop (work in progress, at cost)",
  "davon: Aufbau/Auflösung Feldbestand": "of which: growing-crop build-up / release",
  "Bei der Ernte aus dem Feldbestand entlastet — nicht bei Kostenentstehung. Der Zahlungsstrom folgt den entstandenen Kosten (Verbindlichkeiten), nicht dieser Zeile.":
    "Released from the growing crop at harvest, not when the cost is incurred. Cash follows the incurred cost (payables), not this line.",
  "Zahlungsziel Forderungen (DSO)": "Payment term receivables (DSO)",
  "Lagertage Fertigerzeugnisse (erst mit Lieferplan wirksam)": "Inventory days finished goods (effective only with a delivery plan)",
  "Zahlungsziel (Plan)": "Payment term (plan)",
  "laut Vertrag Ø": "per contract, avg.",
  "Zahlungsziel laut Vertrag": "Payment term per contract",
  "dokumentarisch": "documentary",
  "Die Engine rechnet mit dem einheitlichen Planungsziel wc.dso, nicht mit diesem Wert.":
    "The engine computes with the unified planning term wc.dso, not with this value.",
  "(+": "(+",
  " zu verhandeln)": " to negotiate)",
  "Tagen": "days",
  "Zahlungsziel: Plan liegt unter der Vertragslage": "Payment term: plan is below what is contracted",
  ". Gerechnet wird mit ": ". The model computes with ",
  " für den gesamten Umsatz — das ist das Verhandlungsziel, nicht der Bestand. Länger vereinbart: ":
    " across all revenue — that is the negotiation target, not the current position. Longer terms agreed: ",
  ". Solange diese Ziele gelten, ist der Liquiditätsverlauf zu optimistisch. Zum Gegenrechnen den Worst Case ziehen oder wc.dso hochsetzen.":
    ". As long as those terms stand, the liquidity profile is too optimistic. To counter-check, run the worst case or raise wc.dso.",
  "Zahlungswirkung": "Cash effect",
  "Forderung läuft ": "Receivable clears ",
  " Monate nach der Ernte aus": " months after harvest",
  "Erntemenge des ersten Planjahrs im aktuellen Szenario. Das Zahlungsziel wirkt zahlungswirksam: die Forderung entsteht mit der Lieferung und läuft erst nach dem Zahlungsziel als Kasse zu. Gerechnet wird mit EINEM einheitlichen Ziel für den gesamten Umsatz — die Spalte „laut Vertrag\" zeigt daneben, was heute tatsächlich vereinbart ist.":
    "Harvest volume of the first plan year in the current scenario. Payment terms are cash-effective: the receivable arises on delivery and only converts to cash once the term has run. The model computes with ONE unified term across all revenue — the \"per contract\" column shows what is actually agreed today.",
  "Anzahlungen der Off-taker": "Off-taker advances",
  "Quote auf den geplanten Erntewert — nicht je Vertrag, damit sie mit dem Anbauplan skaliert.":
    "Share of the planned harvest value — not per contract, so it scales with the cropping plan.",
  "inaktiv": "inactive",
  "Verhandlungsannahme, keine Vertragslage": "Negotiation assumption, not contractual",
  ": Keiner der geprüften Verträge sagt eine Anzahlung zu. PepsiCo verrechnet Vorschüsse ausdrücklich gegen die ersten Lieferungen und sagt keinen Vorschuss zu; VIA AGRO verlangt ein bilet la ordin als Sicherheit. Quote, Zeitpunkt und Preis der Vorfinanzierung sind bei den Abnehmern anzufordern.":
    ": None of the reviewed contracts grants an advance. PepsiCo explicitly offsets any advance against the first deliveries and commits to none; VIA AGRO requires a bilet la ordin as security. Rate, timing and the price of the prefinancing must be requested from the buyers.",
  "Eine Anzahlung ist kein Umsatz, sondern eine Vertragsverbindlichkeit (IFRS 15): sie erhöht Kasse und Passiva und wird bei Lieferung gegen die entstehende Forderung verrechnet. Die Wirkung sitzt nicht im EBITDA, sondern im Liquiditätsverlauf — niedrigerer Revolver-Höchststand, geringerer Zinsaufwand, besserer DSCR im Anlaufjahr.":
    "An advance is not revenue but a contract liability (IFRS 15): it raises cash and liabilities alike and is offset against the receivable on delivery. The effect sits in liquidity, not EBITDA — lower peak revolver, lower interest expense, better DSCR in the ramp-up year.",
  "Quote (Anteil geplanter Erntewert)": "Rate (share of planned harvest value)",
  "Annahme advance.rate": "assumption advance.rate",
  "Preis der Vorfinanzierung": "Price of the prefinancing",
  "p. a.": "p.a.",
  "advance.cost_rate": "advance.cost_rate",
  "unbelegt — Benchmark Revolver ≈ 5,8 %": "not evidenced — revolver benchmark ≈ 5.8 %",
  "unbelegt — EBITDA bleibt unberührt": "not evidenced — EBITDA unaffected",
  "Avalprovision": "Guarantee fee",
  "advance.aval_fee": "advance.aval_fee",
  "Zuflussmonat": "Inflow month",
  "Verrechnung": "Settlement",
  "gegen die ersten Lieferungen": "against first deliveries",
  "gegen die Schlussrechnung": "against final invoice",
  "Sicherheit": "Security",
  "keine": "none",
  "Bankaval": "bank guarantee",
  "Vorfinanzierte Kultur": "Prefinanced crop",
  "Geplanter Erntewert (Jahr 1)": "Planned harvest value (year 1)",
  "Anzahlung": "Advance",
  "Summe": "Total",
  "Keine Kultur einbezogen — der Erntewert der ausgewählten Kulturen ist null.":
    "No crop included — the harvest value of the selected crops is zero.",
  "Anzahlungen sind inaktiv — das Modell rechnet ohne Vorfinanzierung.":
    "Advances are inactive — the model computes without prefinancing.",
  "Einbezogene Kulturen und die Quote sind unter Preise & Treiber (Gruppe „Anzahlungen Off-taker\") bzw. im Szenario-Studio verstellbar. Worst Case steht auf 0 — im Stressfall zahlt niemand vor.":
    "Included crops and the rate are adjustable under Prices & Drivers (group \"Off-taker advances\") or in the Scenario Studio. Worst case is set to 0 — under stress nobody pays up front.",
};
export default B12;
