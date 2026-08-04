/* ERZEUGT — NICHT VON HAND AENDERN.
 *
 * Quelle:  neos-compendium — data/plans/sorten/bonituren.csv, facts/facts.csv,
 *          dist/plans/sortenranking.csv
 * Erzeugt: build/export_fx_sorten.py  ·  2026-08-04
 *
 * Das Sortenregister. NEOS FX WAEHLT daraus, es pflegt keine Sortenkunde —
 * die liegt im Kompendium mit Quelle, Belegstatus und Historie.
 *
 * `faktenBelegt` ist die ehrliche Zahl: wie viele der Aussagen ueber diese
 * Sorte eine Primaerquelle hinter sich haben. Eine Sorte mit Rang 2 und
 * 34 % Datenbasis ist eine Hypothese, keine Empfehlung.
 */

export interface SortenRang { rang: number; punkte: number; punkteBelegt: number; datenbasisPct: number }

export interface SortenEintrag {
  /** Anzeigename. Er geht in die Schlag-ID und ist damit Teil des Arbeitsauftrags. */
  sorte: string;
  /** Kultur in NEOS FX, fuer die diese Sorte in Frage kommt. */
  cropId: string;
  segment: string;
  /** Anzahl Fakten im Kompendium (ohne widerlegte) und davon belegte. */
  fakten: number; faktenBelegt: number;
  /** Rang je Standort aus dem Punktmodell. Fehlt, wenn die Sorte nicht bewertet ist. */
  rang?: Record<string, SortenRang>;
}

export const SORTEN_REGISTER: SortenEintrag[] = [
  { sorte: "Chipsy", cropId: "kartoffel_chips", segment: "crisps", fakten: 4, faktenBelegt: 4, rang: { "NEDEIA": { rang: 1, punkte: 8.33, punkteBelegt: 8.38, datenbasisPct: 96 }, "OSTROVU": { rang: 1, punkte: 8.25, punkteBelegt: 8.36, datenbasisPct: 90 } } },
  { sorte: "Lady Alicia", cropId: "kartoffel_chips", segment: "crisps", fakten: 1, faktenBelegt: 1, rang: { "NEDEIA": { rang: 2, punkte: 8.04, punkteBelegt: 8.63, datenbasisPct: 48 }, "OSTROVU": { rang: 2, punkte: 7.73, punkteBelegt: 9.43, datenbasisPct: 34 } } },
  { sorte: "Lady Avalon", cropId: "kartoffel_chips", segment: "crisps", fakten: 5, faktenBelegt: 5, rang: { "NEDEIA": { rang: 3, punkte: 7.86, punkteBelegt: 7.86, datenbasisPct: 100 }, "OSTROVU": { rang: 4, punkte: 7.0, punkteBelegt: 7.0, datenbasisPct: 100 } } },
  { sorte: "Lady Britta", cropId: "kartoffel_chips", segment: "crisps", fakten: 1, faktenBelegt: 1, rang: { "NEDEIA": { rang: 7, punkte: 6.65, punkteBelegt: 5.7, datenbasisPct: 54 }, "OSTROVU": { rang: 7, punkte: 6.25, punkteBelegt: 5.16, datenbasisPct: 48 } } },
  { sorte: "Lady Rosetta", cropId: "kartoffel_chips", segment: "crisps", fakten: 0, faktenBelegt: 0, rang: { "NEDEIA": { rang: 6, punkte: 6.98, punkteBelegt: 6.42, datenbasisPct: 48 }, "OSTROVU": { rang: 6, punkte: 6.34, punkteBelegt: 5.33, datenbasisPct: 34 } } },
  { sorte: "Norman", cropId: "kartoffel_chips", segment: "crisps", fakten: 0, faktenBelegt: 0, rang: { "NEDEIA": { rang: 4, punkte: 7.37, punkteBelegt: 7.06, datenbasisPct: 58 }, "OSTROVU": { rang: 5, punkte: 6.79, punkteBelegt: 6.46, datenbasisPct: 58 } } },
  { sorte: "SH C 2030", cropId: "kartoffel_chips", segment: "crisps", fakten: 0, faktenBelegt: 0, rang: { "NEDEIA": { rang: 8, punkte: 5.23, punkteBelegt: 5.23, datenbasisPct: 100 }, "OSTROVU": { rang: 9, punkte: 5.71, punkteBelegt: 5.71, datenbasisPct: 100 } } },
  { sorte: "SH C 909", cropId: "kartoffel_chips", segment: "crisps", fakten: 0, faktenBelegt: 0, rang: { "NEDEIA": { rang: 9, punkte: 5.16, punkteBelegt: 5.16, datenbasisPct: 100 }, "OSTROVU": { rang: 8, punkte: 6.0, punkteBelegt: 6.0, datenbasisPct: 100 } } },
  { sorte: "Triple7", cropId: "kartoffel_chips", segment: "crisps", fakten: 1, faktenBelegt: 1, rang: { "NEDEIA": { rang: 5, punkte: 7.01, punkteBelegt: 6.48, datenbasisPct: 48 }, "OSTROVU": { rang: 3, punkte: 7.02, punkteBelegt: 7.33, datenbasisPct: 34 } } },
  { sorte: "Agria", cropId: "kartoffel_pommes", segment: "fries", fakten: 0, faktenBelegt: 0, rang: { "NEDEIA": { rang: 12, punkte: 5.24, punkteBelegt: 5.24, datenbasisPct: 100 }, "OSTROVU": { rang: 12, punkte: 5.71, punkteBelegt: 5.71, datenbasisPct: 100 } } },
  { sorte: "Arsenal", cropId: "kartoffel_pommes", segment: "fries", fakten: 3, faktenBelegt: 3, rang: { "NEDEIA": { rang: 4, punkte: 6.65, punkteBelegt: 6.63, datenbasisPct: 96 }, "OSTROVU": { rang: 2, punkte: 6.99, punkteBelegt: 6.97, datenbasisPct: 90 } } },
  { sorte: "Challenger", cropId: "kartoffel_pommes", segment: "fries", fakten: 5, faktenBelegt: 5, rang: { "NEDEIA": { rang: 7, punkte: 6.22, punkteBelegt: 6.22, datenbasisPct: 100 }, "OSTROVU": { rang: 6, punkte: 6.36, punkteBelegt: 6.36, datenbasisPct: 100 } } },
  { sorte: "Diamant", cropId: "kartoffel_pommes", segment: "fries", fakten: 3, faktenBelegt: 3, rang: { "NEDEIA": { rang: 8, punkte: 6.16, punkteBelegt: 6.16, datenbasisPct: 100 }, "OSTROVU": { rang: 7, punkte: 6.3, punkteBelegt: 6.3, datenbasisPct: 100 } } },
  { sorte: "Fontane", cropId: "kartoffel_pommes", segment: "fries", fakten: 5, faktenBelegt: 5, rang: { "NEDEIA": { rang: 6, punkte: 6.45, punkteBelegt: 6.45, datenbasisPct: 100 }, "OSTROVU": { rang: 3, punkte: 6.6, punkteBelegt: 6.6, datenbasisPct: 100 } } },
  { sorte: "Francis", cropId: "kartoffel_pommes", segment: "fries", fakten: 6, faktenBelegt: 6, rang: { "NEDEIA": { rang: 2, punkte: 6.74, punkteBelegt: 7.38, datenbasisPct: 76 }, "OSTROVU": { rang: 4, punkte: 6.58, punkteBelegt: 7.15, datenbasisPct: 76 } } },
  { sorte: "Innovator", cropId: "kartoffel_pommes", segment: "fries", fakten: 0, faktenBelegt: 0, rang: { "NEDEIA": { rang: 9, punkte: 5.82, punkteBelegt: 5.82, datenbasisPct: 100 }, "OSTROVU": { rang: 13, punkte: 5.41, punkteBelegt: 5.41, datenbasisPct: 100 } } },
  { sorte: "Ivory Russet", cropId: "kartoffel_pommes", segment: "fries", fakten: 3, faktenBelegt: 3, rang: { "NEDEIA": { rang: 5, punkte: 6.58, punkteBelegt: 6.57, datenbasisPct: 74 }, "OSTROVU": { rang: 1, punkte: 6.99, punkteBelegt: 7.13, datenbasisPct: 74 } } },
  { sorte: "Markies", cropId: "kartoffel_pommes", segment: "fries", fakten: 13, faktenBelegt: 11, rang: { "NEDEIA": { rang: 13, punkte: 5.21, punkteBelegt: 5.21, datenbasisPct: 100 }, "OSTROVU": { rang: 11, punkte: 5.8, punkteBelegt: 5.8, datenbasisPct: 100 } } },
  { sorte: "Palace", cropId: "kartoffel_pommes", segment: "fries", fakten: 0, faktenBelegt: 0, rang: { "NEDEIA": { rang: 10, punkte: 5.63, punkteBelegt: 5.63, datenbasisPct: 100 }, "OSTROVU": { rang: 9, punkte: 6.25, punkteBelegt: 6.25, datenbasisPct: 100 } } },
  { sorte: "Quintera", cropId: "kartoffel_pommes", segment: "fries", fakten: 2, faktenBelegt: 2, rang: { "NEDEIA": { rang: 3, punkte: 6.7, punkteBelegt: 6.72, datenbasisPct: 96 }, "OSTROVU": { rang: 5, punkte: 6.56, punkteBelegt: 6.6, datenbasisPct: 88 } } },
  { sorte: "Sagitta", cropId: "kartoffel_pommes", segment: "fries", fakten: 3, faktenBelegt: 3, rang: { "NEDEIA": { rang: 11, punkte: 5.47, punkteBelegt: 4.95, datenbasisPct: 70 }, "OSTROVU": { rang: 10, punkte: 6.02, punkteBelegt: 5.61, datenbasisPct: 64 } } },
  { sorte: "Zorba", cropId: "kartoffel_pommes", segment: "fries", fakten: 6, faktenBelegt: 5, rang: { "NEDEIA": { rang: 1, punkte: 6.96, punkteBelegt: 7.66, datenbasisPct: 76 }, "OSTROVU": { rang: 8, punkte: 6.25, punkteBelegt: 6.72, datenbasisPct: 76 } } },
];
