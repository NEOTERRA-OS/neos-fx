/**
 * Sprechende, positionsfreie Maßnahmen-IDs.
 *
 * Warum es diese Datei gibt: `measureId` entstand bis 03.08.2026 aus dem Index im
 * Seed-Array (`kartoffel_pommes::psm::2`). Wer eine Anwendung VOR einer anderen
 * einfügt, verschiebt damit still die ID jeder folgenden — und mit ihr jede
 * Ist-Rückmeldung, die daran hing. Dieselbe Fehlerklasse wie bei den
 * CAPEX-Vintages (`capexMY.length`) und den Pseudo-Parzellen
 * (`parcel-${anbauplan.id}`). Eine ID, die von einer Array-Position abhängt, ist
 * als Schnittstelle wertlos: sie sagt nichts, und sie hält nichts.
 *
 * Die Form folgt dem Kompendium:
 *
 *     <cropId>.<FACHBEREICH>.<SLUG>
 *     kartoffel_pommes.PFLANZENSCHUTZ.F_KRAUTFAEULE_SERIE
 *
 * Der Kompendium-Schlüssel (`potFryVHK`) bleibt bewusst außen vor: er trägt die
 * Konfiguration (vorgezogene Hauptkultur / Zweitkultur) mit, die FX über den
 * Anbauplan und nicht über die Kultur-ID führt. Die Brücke ist später eine
 * einmalige Zuordnungstabelle cropId → Kompendium-Schlüssel — genau wie
 * `F-014 → "Nedeia Nord 3"` bei den Feldern.
 *
 * ZWEI REGELN, ohne die das Ganze wieder kippt:
 *
 *  1. Der Slug wird EINMAL beim Seed aus der Beschriftung abgeleitet und dann als
 *     Datum geführt (`OpLineSeed.mid`, `Arbeitsgang.mid`). Er wird NICHT bei jeder
 *     Anzeige neu berechnet. Sonst hinge die ID an der Beschriftung, und ein
 *     korrigierter Tippfehler im Label bräche den Ist-Bezug — dieselbe Falle,
 *     nur eine Etage höher.
 *  2. Die ID ist frei von allem, was sich im laufenden Betrieb ändert: kein
 *     Index, kein Jahr, keine Fläche, keine Sorte. Das Jahr und die Fläche kommen
 *     über den Schlagbezug dazu (siehe `store/schlaege.ts`), nicht über die ID.
 */

/** Fachbereich einer Maßnahme — zweites Segment der ID, Ordnungsebene im Kompendium. */
export type Fachbereich =
  | "BODENBEARBEITUNG"
  | "AUSSAAT"
  | "DUENGUNG"
  | "PFLANZENSCHUTZ"
  | "BEWAESSERUNG"
  | "ERNTE"
  | "TRANSPORT"
  | "MATERIAL"
  | "HANDARBEIT";

export const FACHBEREICHE: Fachbereich[] = [
  "BODENBEARBEITUNG", "AUSSAAT", "DUENGUNG", "PFLANZENSCHUTZ",
  "BEWAESSERUNG", "ERNTE", "TRANSPORT", "MATERIAL", "HANDARBEIT",
];

/**
 * Bezugsebene je Fachbereich — Feld oder Schlag.
 *
 * „Roden" zeigt auf den Schlag, „spritzen" darf auf das Feld zeigen. Der
 * Unterschied ist nicht kosmetisch: Markies und eine second early auf demselben
 * Feld sind zwei Schläge mit getrennten Rode- und Sikkationsterminen, aber EINER
 * Spritzüberfahrt. Wer die Ernte auf das Feld bucht, verliert die Sortentrennung;
 * wer die Spritzung auf den Schlag bucht, zählt die Überfahrt doppelt.
 */
export const BEZUG_JE_FACH: Record<Fachbereich, "feld" | "schlag"> = {
  BODENBEARBEITUNG: "feld",
  AUSSAAT: "schlag",        // Sorte wird gelegt, nicht Kultur
  DUENGUNG: "feld",
  PFLANZENSCHUTZ: "feld",
  BEWAESSERUNG: "feld",
  ERNTE: "schlag",          // Rodetermin ist sortenabhängig
  TRANSPORT: "schlag",      // folgt der Ernte, Partie bleibt sortenrein
  MATERIAL: "schlag",
  HANDARBEIT: "schlag",
};

/** Katalog-Op-Code → Fachbereich. */
export const FACH_JE_OP: Record<string, Fachbereich> = {
  "OP-SAAT": "AUSSAAT",
  "OP-DUENG": "DUENGUNG",
  "OP-PSM": "PFLANZENSCHUTZ",
  "OP-BEREG": "BEWAESSERUNG",
  "OP-MAT": "MATERIAL",
  "OP-HAND": "HANDARBEIT",
};

/** Fester Slug je Op, das nur EINE Maßnahme trägt (Saatgut, Bewässerung, …). */
export const SLUG_JE_OP: Record<string, string> = {
  "OP-SAAT": "SAATGUT",
  "OP-BEREG": "NORM",
  "OP-MAT": "MATERIAL_LAGER",
  "OP-HAND": "SAISON",
};

/**
 * Maschinen-Arbeitsgang → Fachbereich + Slug.
 *
 * Bewusst eine explizite Tabelle und keine Ableitung aus dem Maschinen-Label:
 * das Label ist Stammdatum und wird beim Versionssprung aus dem Seed nachgezogen
 * (siehe `migrateDomain`) — eine ID darf davon nicht abhängen.
 */
export const MASCHINE_MEASURE: Record<string, { fach: Fachbereich; slug: string }> = {
  pflug:      { fach: "BODENBEARBEITUNG", slug: "GRUNDBODENBEARBEITUNG" },
  saatbett:   { fach: "BODENBEARBEITUNG", slug: "SAATBETT" },
  drille:     { fach: "AUSSAAT", slug: "DRILLSAAT" },
  einzelkorn: { fach: "AUSSAAT", slug: "EINZELKORNSAAT" },
  gem_saat:   { fach: "AUSSAAT", slug: "FEINGEMUESESAAT" },
  knobl_lege: { fach: "AUSSAAT", slug: "STECKEN" },
  onepass:    { fach: "AUSSAAT", slug: "LEGEN_ONEPASS" },
  tompflanz:  { fach: "AUSSAAT", slug: "PFLANZUNG" },
  streuer:    { fach: "DUENGUNG", slug: "STREUER" },
  spritze14:  { fach: "PFLANZENSCHUTZ", slug: "SPRITZUEBERFAHRT" },
  krautschl:  { fach: "ERNTE", slug: "KRAUTSCHLAGEN" },
  maehdr:     { fach: "ERNTE", slug: "MAEHDRUSCH" },
  roder_ropa: { fach: "ERNTE", slug: "RODUNG" },
  tomernte:   { fach: "ERNTE", slug: "VOLLERNTER" },
  gem_schwad: { fach: "ERNTE", slug: "SCHWADLEGEN" },
  gem_lader:  { fach: "ERNTE", slug: "AUFNAHME" },
  gem_moehre: { fach: "ERNTE", slug: "KLEMMBANDRODER" },
  transport:  { fach: "TRANSPORT", slug: "ABFUHR_INFIELD" },
};

/** Umlaute und Sonderzeichen nach ASCII — sonst hängt die ID an der Kodierung. */
const TRANSLIT: Record<string, string> = {
  "ä": "AE", "ö": "OE", "ü": "UE", "Ä": "AE", "Ö": "OE", "Ü": "UE", "ß": "SS",
  "×": "X", "·": " ", "–": "-", "—": "-",
  "₂": "2", "₃": "3", "₄": "4", "₅": "5",
};

/**
 * Beschriftung → Slug. Deterministisch, ASCII, ohne Klammerzusatz.
 *
 * Weggeschnitten wird, was den Wirkstoff, das BBCH-Fenster oder die Anzahl der
 * Überfahrten nennt: das sind Parameter der Maßnahme und ändern sich, wenn ein
 * Mittel getauscht oder ein Fenster verschoben wird. Übrig bleibt, WAS getan
 * wird — „F Krautfäule-Serie 12× (BBCH 20–89, Cymoxanil/…)" → `F_KRAUTFAEULE_SERIE`.
 */
export function slugify(label: string): string {
  let s = String(label ?? "");
  // Zusatz in Klammern ab der ERSTEN Klammer weg (Wirkstoffe, BBCH, Gerät).
  const klammer = s.indexOf("(");
  if (klammer > 0) s = s.slice(0, klammer);
  s = s.replace(/BBCH\s*[0-9]{1,2}(\s*[–\-]\s*[0-9]{1,2})?/gi, " ");
  // Multiplizität (12×, 2x) — sie ist ein Parameter der Maßnahme, nicht ihr Name.
  //  Kein `\b` hinter dem ×: zwischen „×" und Leerzeichen steht keine Wortgrenze.
  s = s.replace(/(^|[^A-Za-z0-9])\d+\s*[×xX](?![A-Za-z0-9])/g, "$1 ");
  s = s.split("").map((ch) => TRANSLIT[ch] ?? ch).join("");
  // Restliche Diakritika (é, ă, ș, î …) über die Unicode-Zerlegung entfernen.
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (s.length > 44) s = s.slice(0, 44).replace(/_+$/g, "");
  return s || "UNBENANNT";
}

/** Zusammensetzen. Trennzeichen ist der Punkt — wie im Kompendium. */
export function measureId(cropId: string, fach: Fachbereich, slug: string): string {
  return `${cropId}.${fach}.${slug}`;
}

/** Zerlegen. `null`, wenn die ID nicht dem Schema folgt (Altbestand, Nutzer-ID). */
export function parseMeasureId(id: string): { cropId: string; fach: Fachbereich; slug: string } | null {
  const parts = String(id ?? "").split(".");
  if (parts.length < 3) return null;
  const fach = parts[1] as Fachbereich;
  if (!FACHBEREICHE.includes(fach)) return null;
  return { cropId: parts[0], fach, slug: parts.slice(2).join(".") };
}

/** Bezugsebene einer Maßnahme (Feld oder Schlag) — aus der ID, sonst Schlag als
 *  strengere Annahme: lieber zu fein zugeordnet als sortenblind gebucht. */
export function bezugOf(id: string): "feld" | "schlag" {
  const p = parseMeasureId(id);
  return p ? BEZUG_JE_FACH[p.fach] : "schlag";
}

/** Fachbereich einer Maßnahme aus der ID (für Filter und Gruppierung). */
export function fachOf(id: string): Fachbereich | null {
  return parseMeasureId(id)?.fach ?? null;
}

/**
 * ID für eine Katalogzeile aus Op-Code und Beschriftung.
 *
 * Bei der Düngung zählt nur das Präfix vor „ · ": die Zeilen N, P₂O₅, K₂O und S
 * EINER Gabe sind eine einzige Maßnahme (eine Streuer-Überfahrt) und teilen sich
 * deshalb die ID. Genau das macht die Gruppierung in `deriveCropMassnahmen`
 * unabhängig von der Zeilenreihenfolge.
 */
export function measureIdForLine(cropId: string, opCode: string, label: string): string {
  const fach = FACH_JE_OP[opCode];
  if (!fach) return measureId(cropId, "MATERIAL", slugify(label));
  const fest = SLUG_JE_OP[opCode];
  if (fest) return measureId(cropId, fach, fest);
  const basis = opCode === "OP-DUENG" ? String(label ?? "").split(" · ")[0] : label;
  return measureId(cropId, fach, slugify(basis));
}

/** ID für einen Maschinen-Arbeitsgang. */
export function measureIdForMachine(cropId: string, machineId: string): string {
  const m = MASCHINE_MEASURE[machineId];
  return m ? measureId(cropId, m.fach, m.slug)
           : measureId(cropId, "BODENBEARBEITUNG", slugify(machineId));
}

/** Alt-IDs aus der Positionslogik: `crop::psm::2`, `crop::dueng::0`, `crop::mach::pflug`, … */
export function istAltId(id: string | undefined): boolean {
  return !!id && id.includes("::");
}

/** Frei vergebene ID für eine im Betrieb neu angelegte Maßnahme. Kein Index, keine
 *  Position — der Zufallsanteil ist genau der Punkt: er kann sich nicht verschieben. */
export function neueMeasureId(cropId: string, fach: Fachbereich, label?: string): string {
  const stamm = label ? slugify(label) : "NEU";
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return measureId(cropId, fach, `${stamm}_${suffix}`);
}
