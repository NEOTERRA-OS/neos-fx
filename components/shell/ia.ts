/**
 * DIE INFORMATIONSARCHITEKTUR — als Daten, nicht als JSX.
 *
 * WARUM EIGENE DATEI. Die Menuestruktur steckte im Sidebar-Bauteil, zwischen
 * Icons und Klassennamen. Sie ist aber eine AUSSAGE ueber das Modell: welche
 * Ansichten es gibt, in welcher Reihenfolge man sie bearbeitet, und welche
 * davon nur ausgeben. Diese Aussage muss pruefbar sein, ohne React zu laden —
 * `core/__tests__/ia.test.ts` haelt seit 04.08.2026 fest, dass jede ViewId
 * genau einen Menueeintrag hat und keiner ins Leere zeigt.
 *
 * Am 04.08.2026 hatten von 39 ViewIds ZWOELF keinen Eintrag (preise, leistung,
 * arbeitszeit, investitionen, contribution, mehrjahr, ersatz, gesellschaften,
 * lohnarbeit, capexScenarien, annahmen, abnahme) und sechs davon zeigten
 * dieselbe Maschinenpark-Ansicht unter verschiedenen Namen. Genau das las sich
 * im Menue als „doppelt".
 */

export type ViewId =
  | "dashboard" | "anbauplan" | "maschinen" | "maschinenBestand" | "bauInvest"
  | "annahmenSheet" | "personal" | "finanzierung" | "subventionen" | "holding" | "eroeffnung" | "kulturkalk"
  | "einsatz" | "bewertung" | "overhead" | "verwaltung"
  | "liquiditaet" | "vat" | "shareholder" | "pacht"
  | "pnl" | "balance" | "cashflow" | "produktkatalog" | "kommentare" | "team"
  | "studio" | "lagerkst" | "wiedervorlage" | "istabgleich";

/* Ein Eintrag. `ausgabe` markiert Ansichten, in denen man NICHTS eingibt —
 *  acht der neunundzwanzig. Ohne die Kennzeichnung sucht der Nutzer in GuV und
 *  Bilanz nach Eingabefeldern, die dort nicht sind. Die Marke ist eine
 *  Daempfung, keine eigene Gruppe: die Arbeitsreihenfolge bleibt zusammen.
 *  `trenner` setzt eine Zwischenueberschrift VOR den Eintrag. */
export type IaItem = { id: string; label: string; view: ViewId; ausgabe?: boolean; trenner?: string };
export type IaGroup = { title: string; items: IaItem[] };

export const IA: IaGroup[] = [
  { title: "Steuerung", items: [
    { id: "dashboard", label: "Executive Dashboard", view: "dashboard", ausgabe: true },
  ]},
  /* ANNAHMEN & KULTUREN. Die Wiedervorlage steht jetzt HIER und nicht mehr in
     einer eigenen Top-Level-Gruppe: sie leitet aus derselben Zeilenmenge ab wie
     das Annahmen-Register (seit 04.08. beweisbar — identische Schluesselmenge)
     und ist inhaltlich dessen Filter „was ist noch offen". Zwei Menuegruppen
     fuer eine Tabelle waren eine Ebene zu viel. */
  { title: "Annahmen & Kulturen", items: [
    { id: "annahmenSheet", label: "Annahmen", view: "annahmenSheet" },
    { id: "wiedervorlage", label: "Wiedervorlage — was ist belegt?", view: "wiedervorlage", ausgabe: true },
    { id: "anbauplan", label: "Anbauplan · Flächen, Erträge, Sorten", view: "anbauplan" },
    { id: "kulturkalk", label: "Maßnahmen & Kosten je Kultur", view: "kulturkalk" },
    { id: "produktkatalog", label: "Produktkatalog (Dünger · PSM · Pflanzgut)", view: "produktkatalog" },
  ]},
  { title: "Investitionen & Flotte", items: [
    { id: "maschinen", label: "Maschinenpark", view: "maschinen" },
    /* Der Bestands-Editor war die einzige Stelle, an der Alter, Betriebsstunden,
       Rabatt und Ruecknahmewert eigener Maschinen bearbeitbar sind — und er war
       nicht erreichbar. Die Eroeffnungsbilanz stellte eine Differenz gegen den
       Bestand fest, die der Nutzer von keiner Seite schliessen konnte. */
    { id: "maschinenBestand", label: "Maschinenbestand & Stammdaten", view: "maschinenBestand" },
    /* Bau & Infrastruktur hatte bis 04.08.2026 GAR KEINEN Editor: 16 Positionen
       (Bewaesserung, Gebaeude) standen im Modell und waren von keiner Ansicht
       aus aenderbar. Sie stehen hier und nicht bei den Financials, weil die
       Frage „was bauen wir" der Frage „wie finanzieren wir es" vorausgeht. */
    { id: "bauInvest", label: "Bau & Infrastruktur (Investitionsplan)", view: "bauInvest" },
    { id: "einsatz", label: "Einsatzplanung", view: "einsatz", ausgabe: true },
  ]},
  { title: "Personal", items: [
    { id: "personal", label: "Personalplanung", view: "personal" },
    { id: "overhead", label: "Overhead / SG&A", view: "overhead" },
  ]},
  /* NACHERNTE. Lager & Packhaus stand bei „Annahmen & Kulturen" und ist weder
     Kultur noch Annahme, sondern eine Kostenstelle mit eigener Investition,
     eigenem Personal und eigenem Deckungsbeitrag — strukturell dasselbe wie der
     Maschinenpark, nur fuer Gebaeude. */
  { title: "Nachernte", items: [
    { id: "lagerkst", label: "Lager & Packhaus (Kostenstelle)", view: "lagerkst" },
  ]},
  { title: "Financials", items: [
    { id: "finanzierung", label: "Finanzierung", view: "finanzierung" },
    { id: "subventionen", label: "Subventionen", view: "subventionen" },
    { id: "holding", label: "Holding (Deutschland)", view: "holding" },
    { id: "eroeffnung", label: "Eröffnungsbilanz", view: "eroeffnung" },
    { id: "pacht", label: "Pacht", view: "pacht" },
    /* Bis 04.08. hiess dieser Eintrag „Liquiditaet & USt/TVA" — der Name verriet
       schon, dass zwei Dinge darin stecken. Der USt-Teil ist das einzige
       Eingabestueck einer sonst reinen Ausgabeansicht und stand darin versteckt. */
    { id: "vat", label: "USt / TVA", view: "vat" },
    { id: "pnl", label: "GuV", view: "pnl", ausgabe: true, trenner: "Abschlüsse" },
    { id: "balance", label: "Bilanz", view: "balance", ausgabe: true },
    { id: "cashflow", label: "Cashflow", view: "cashflow", ausgabe: true },
    { id: "liquiditaet", label: "Liquidität", view: "liquiditaet", ausgabe: true },
  ]},
  /* Was von „Beleg & Rueckmeldung" bleibt, ist die Rueckmeldung aus dem Feld —
     und die kommt aus NEOS Farm, das noch nicht steht. Eine Top-Level-Gruppe
     mitten zwischen Kulturen und Maschinen hat den Arbeitsfluss unterbrochen. */
  { title: "Rückmeldung", items: [
    { id: "istabgleich", label: "Plan ↔ Ist (Rückmeldung aus dem Feld)", view: "istabgleich", ausgabe: true },
  ]},
  { title: "Analyse", items: [
    { id: "studio", label: "Szenario-Studio", view: "studio" },
    { id: "shareholder", label: "Equity & Ausschüttung", view: "shareholder" },
    /* Die DCF-Bewertung stand VOR „Equity & Ausschuettung" und ist doch deren
       Ergebnis: sie liest Ausschuettungspolitik und Kapitalkosten und rechnet
       daraus einen Wert. Ein Reiner-Ausgabe-Schirm mitten zwischen zwei
       Eingaben laesst den Nutzer dort nach dem Stellrad suchen. */
    { id: "bewertung", label: "Bewertung (DCF)", view: "bewertung", ausgabe: true },
  ]},
  { title: "Verwaltung", items: [
    { id: "kommentare", label: "Kommentare", view: "kommentare" },
    { id: "team", label: "Team & Zugriff", view: "team" },
    { id: "verwaltung", label: "Speichern & Versionen", view: "verwaltung" },
  ]},
];

/** Alle ViewIds, die im Menue vorkommen — in Menuereihenfolge. */
export const IA_VIEWS: ViewId[] = IA.flatMap((g) => g.items.map((i) => i.view));

/** Anzeigename einer Ansicht (fuer Titel, Audit, Sprungmarken). */
export const VIEW_LABEL: Record<string, string> =
  Object.fromEntries(IA.flatMap((g) => g.items.map((i) => [i.view, i.label])));
