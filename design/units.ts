import type { Unit } from "../core/types";

/* --------------------------------------------------------------------------
 * EINHEITEN-REGISTER — die EINZIGE Stelle, an der steht, wie eine Größe aussieht.
 *
 *  Bis 31.07.2026 gab es drei: `UNIT_LABEL` im Annahme-Feld (sagte `rate → "×"`),
 *  `EINHEIT` im Annahmen-Register (sagte `rate → "%"`) und je Aufrufer ein frei gesetztes
 *  `suffix` am rohen Zahlenfeld. Derselbe Ernteverlust stand dadurch auf dem einen Bildschirm
 *  als „0,08 ×" und auf dem anderen als „8,00 %". Dazu kamen uneinheitliche Nachkommastellen
 *  („höchstens zwei" ⇒ 0,1 neben 0,08 in derselben Spalte) und 42 Treiber ohne jede Einheit.
 *
 *  Vertrag je Einheit:
 *   · `kurz`   — Kurzzeichen. Steht IMMER in einem eigenen Slot, nie im Eingabefeld: ein
 *                Zeichen hinter der Zahl verschiebt sonst jede Zelle um seine Breite, und die
 *                Kommaachse einer Spalte steht nicht mehr.
 *   · `faktor` — Speicherwert × faktor = Anzeigewert. Geld liegt in Cent (×0,01), Anteile als
 *                Dezimalbruch (×100 → Prozent), alles andere 1:1.
 *   · `dez`    — feste Nachkommastellen. Fest, nicht „höchstens": nur so haben die Zahlen
 *                einer Spalte eine gemeinsame Achse.
 *   · `lang`   — ausgeschriebene Bedeutung für den Tooltip.
 * ------------------------------------------------------------------------ */

export type EinheitSpec = {
  /** Kurzzeichen für die Einheiten-Spalte. */
  kurz: string;
  /** Speicherwert × faktor = Anzeigewert (Umkehrung beim Schreiben). */
  faktor: number;
  /** Feste Nachkommastellen der Anzeige. */
  dez: number;
  /** Ausgeschriebene Bedeutung (Tooltip). */
  lang: string;
};

export const EINHEITEN: Record<Unit, EinheitSpec> = {
  // — Geld: gespeichert in Cent —
  money:            { kurz: "€",        faktor: 0.01, dez: 2, lang: "Euro" },
  money_per_ha:     { kurz: "€/ha",     faktor: 0.01, dez: 2, lang: "Euro je Hektar" },
  money_per_tonne:  { kurz: "€/t",      faktor: 0.01, dez: 2, lang: "Euro je Tonne" },

  // — Verhältnisgrößen: gespeichert als Dezimalbruch —
  rate:             { kurz: "%",        faktor: 100,  dez: 2, lang: "Prozent (Alt-Einheit rate)" },
  percent:          { kurz: "%",        faktor: 100,  dez: 2, lang: "Prozent" },
  factor:           { kurz: "×",        faktor: 1,    dez: 2, lang: "Faktor — 1,00 lässt den Wert unverändert" },
  ratio:            { kurz: "×",        faktor: 1,    dez: 2, lang: "Verhältniszahl" },
  flag:             { kurz: "0/1",      faktor: 1,    dez: 0, lang: "Schalter — 0 aus, 1 an" },

  // — Mengen —
  count:            { kurz: "Stk",      faktor: 1,    dez: 0, lang: "Stück" },
  fte:              { kurz: "FTE",      faktor: 1,    dez: 2, lang: "Vollzeitäquivalente" },
  hectare:          { kurz: "ha",       faktor: 1,    dez: 0, lang: "Hektar" },
  tonne:            { kurz: "t",        faktor: 1,    dez: 0, lang: "Tonnen" },
  tonne_per_ha:     { kurz: "t/ha",     faktor: 1,    dez: 2, lang: "Tonnen je Hektar" },
  ha_per_day:       { kurz: "ha/Tag",   faktor: 1,    dez: 2, lang: "Hektar je Tag (Schlagkraft)" },
  litre:            { kurz: "l",        faktor: 1,    dez: 0, lang: "Liter" },
  litre_per_ha:     { kurz: "l/ha",     faktor: 1,    dez: 0, lang: "Liter je Hektar" },
  metre:            { kurz: "m",        faktor: 1,    dez: 2, lang: "Meter" },
  km:               { kurz: "km",       faktor: 1,    dez: 0, lang: "Kilometer" },
  kmh:              { kurz: "km/h",     faktor: 1,    dez: 2, lang: "Kilometer je Stunde" },

  // — Zeit —
  minutes:          { kurz: "min",      faktor: 1,    dez: 0, lang: "Minuten" },
  hours:            { kurz: "h",        faktor: 1,    dez: 0, lang: "Stunden" },
  days:             { kurz: "Tage",     faktor: 1,    dez: 0, lang: "Tage" },
  weeks:            { kurz: "Wochen",   faktor: 1,    dez: 0, lang: "Wochen" },
  months:           { kurz: "Monate",   faktor: 1,    dez: 0, lang: "Monate" },
  years:            { kurz: "Jahre",    faktor: 1,    dez: 0, lang: "Jahre" },
  year:             { kurz: "Planjahr", faktor: 1,    dez: 0, lang: "Planjahr (0 = erstes Planjahr)" },
  month:            { kurz: "Planmon.", faktor: 1,    dez: 0, lang: "Planmonat (1 = erster Planmonat)" },
};

const FALLBACK: EinheitSpec = { kurz: "", faktor: 1, dez: 2, lang: "" };

/** Vertrag einer Einheit. Unbekannte Einheit → neutraler Fallback statt Absturz. */
export function einheit(u: Unit | string | undefined): EinheitSpec {
  return (u && (EINHEITEN as Record<string, EinheitSpec>)[u]) || FALLBACK;
}

/** Speicherwert → Anzeigewert. */
export function zurAnzeige(u: Unit | string | undefined, gespeichert: number): number {
  return gespeichert * einheit(u).faktor;
}

/** Anzeigewert → Speicherwert. Geld wird auf ganze Cent gerundet, damit keine
 *  Bruchteil-Cent in die Bilanz laufen; alles andere bleibt exakt. */
export function ausAnzeige(u: Unit | string | undefined, angezeigt: number): number {
  const spec = einheit(u);
  const roh = angezeigt / spec.faktor;
  return spec.faktor === 0.01 ? Math.round(roh) : roh;
}
