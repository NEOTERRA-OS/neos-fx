/**
 * CAPEX-Jahrgänge: sprechende, positionsfreie IDs.
 *
 * Die letzte der drei Stellen, an denen eine ID aus einer Array-Position kam.
 * Sie hieß:
 *
 *     cx-roder_ropa-c5-4-217
 *                        ^^^ capexMY.length zum Zeitpunkt des Einfügens
 *
 * Das letzte Segment war die Länge des Zielarrays. Es stand dort aus einem
 * echten Grund — ohne es kollidieren zwei Ketten, sobald ein Ausbau-Jahrgang
 * genau in dem Jahr beginnt, in dem eine Basiskohorte ihren Ersatz kauft — aber
 * es löst das Problem an der falschen Stelle: eine Position im Array beschreibt
 * nicht die Anlage, sondern die Reihenfolge, in der sie zufällig entstanden ist.
 * Ändert sich irgendwo davor etwas, verschieben sich alle folgenden IDs.
 *
 * Dieselbe Fehlerklasse hat in diesem Modell schon einmal 11,7 Mio € CAPEX
 * bewegt, bis die Ursache klar war — und anders als bei den Maßnahmen-IDs hängt
 * hier eine Zahl in der Bilanz daran, nicht nur eine Schnittstelle.
 *
 * Jetzt beschreibt die ID die Anlage:
 *
 *     cx-roder_ropa.J2029.K2.G1
 *     │             │     │  └── Glied der Ersatzkette (0 = Erstanschaffung)
 *     │             │     └───── Kohorte innerhalb des Zyklus
 *     │             └─────────── Jahrgang als KALENDERJAHR
 *     └───────────────────────── Basis: die Anlage aus dem Maschinenkatalog
 *
 * Der Jahrgang steht als Kalenderjahr da und nicht als Planjahr-Index. Ein
 * Index verschiebt sich, wenn der Modellstart wandert oder der Horizont wächst —
 * 2029 bleibt 2029. Das ist derselbe Gedanke wie beim Erntejahr an den Ist-Daten.
 *
 * Kohorte und Glied zusammen sind eindeutig, weil eine Kette durch ihren
 * Ursprung bestimmt ist: Basisflotte und Ausbau-Jahrgänge starten nie im selben
 * Jahr in derselben Kohorte. Damit braucht es keinen Zähler mehr.
 */

/** Präfix aller CAPEX-Positionen, die aus dem Maschinen-/Anlagenkatalog kommen. */
export const CX = "cx-";

export type CapexVintage = {
  /** Basis-ID der Anlage, z. B. `cx-roder_ropa` oder `cx-store`. */
  basisId: string;
  /** Jahrgang als Kalenderjahr. Fehlt bei einer Basisposition ohne Jahrgang. */
  jahr?: number;
  /** Kohorte innerhalb des Ersatzzyklus. Fehlt, wo es keine Kohorten gibt. */
  kohorte?: number;
  /** Glied der Ersatzkette: 0 = Erstanschaffung, 1 = erster Ersatz, … */
  glied?: number;
};

/**
 * ID eines Jahrgangs zusammensetzen.
 *
 * `kohorte` und `glied` sind einzeln weglassbar: eine Beregnungs- oder
 * Lagerposition hat einen Jahrgang, aber keine Kohorten und keine Ersatzkette.
 * Weggelassene Segmente stehen nicht als `K0`/`G0` da — eine ID soll sagen, was
 * es gibt, und nicht, was es nicht gibt.
 */
export function capexVintageId(basisId: string, jahr: number, kohorte?: number, glied?: number): string {
  let id = `${basisId}.J${jahr}`;
  if (kohorte != null) id += `.K${kohorte}`;
  if (glied != null) id += `.G${glied}`;
  return id;
}

/** Zerlegen. Unbekannte Formen ergeben `{ basisId: id }` — nie `null`, weil jede
 *  CAPEX-Position mindestens ihre Basis hat. */
export function parseCapexId(id: string): CapexVintage {
  const s = String(id ?? "");
  const teile = s.split(".");
  const out: CapexVintage = { basisId: teile[0] };
  for (const t of teile.slice(1)) {
    const m = /^([JKG])(\d+)$/.exec(t);
    if (!m) continue;
    if (m[1] === "J") out.jahr = Number(m[2]);
    else if (m[1] === "K") out.kohorte = Number(m[2]);
    else out.glied = Number(m[2]);
  }
  return out;
}

/** Basis-ID einer CAPEX-Position — die Anlage hinter dem Jahrgang. */
export function capexBasisId(id: string): string {
  return parseCapexId(id).basisId;
}

/** Maschinen-ID hinter einer CAPEX-Position (`cx-roder_ropa.J2029.K0.G0` → `roder_ropa`).
 *  Ersetzt das Zerschneiden per Regex an den Aufrufstellen: wer eine ID zerlegt,
 *  soll dieselbe Stelle benutzen, die sie gebaut hat. */
export function machineIdOfCapex(id: string): string {
  const b = capexBasisId(id);
  return b.startsWith(CX) ? b.slice(CX.length) : b;
}

/** Alt-IDs aus der Positionslogik: `cx-roder_ropa-c5-4-217`, `cx-store-y3`. */
export function istAlteCapexId(id: string): boolean {
  return /-(c\d+-\d+-\d+|y\d+)$/.test(String(id ?? ""));
}
