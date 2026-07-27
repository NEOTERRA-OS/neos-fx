/** Locale-/Währungs-bewusste Formatierung. Engine-Geld = Minor-Units (Cent).
 *  Modul-globale LOCALE/CURRENCY werden vom Store gesetzt (setFormatLocale) und von
 *  allen Formatierern gelesen — so wirkt der Sprach-/Währungs-Umschalter app-weit,
 *  ohne dass jeder Aufruf die Locale durchreichen muss. Reaktivität: die App remountet
 *  den Baum bei Sprach-/Währungswechsel (key), sodass alle Formatierungen neu laufen. */
export const FX_EUR_RON = 4.98;

let LOCALE = "de-DE";
let CURRENCY: "EUR" | "RON" = "EUR";

/** Vom Store aufgerufen, wenn Sprache/Währung wechseln. */
export function setFormatLocale(locale: string, currency: "EUR" | "RON"): void {
  LOCALE = locale; CURRENCY = currency;
}
export function currentLocale(): string { return LOCALE; }
export function currentCurrency(): "EUR" | "RON" { return CURRENCY; }
const isEn = () => LOCALE.startsWith("en");

export function fmtMoney(cent: number, currency: "EUR" | "RON" = CURRENCY): string {
  const eur = cent / 100;
  const val = currency === "RON" ? eur * FX_EUR_RON : eur;
  if (val === 0) return "–";
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(Math.round(val));
}

export function fmtNumber(v: number, digits = 2): string {
  if (v === 0) return "–";
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

export function fmtFactor(v: number): string {
  if (!isFinite(v)) return "–";
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

export function fmtPct(rate: number): string {
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rate * 100) + " %";
}

/* --- Editier-Format für Eingabefelder (Locale-abhängig: Tausender/Dezimaltrenner) --- */
/** Zahl → String im aktiven Locale-Format (für Eingabefelder). */
export function fmtEditable(v: number, maxFrac = 6): string {
  if (!isFinite(v)) return "";
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: maxFrac, useGrouping: true }).format(v);
}
/** Locale-Eingabe → Zahl. EN: „,"=Tausender (entfernt), „."=Dezimale.
 *  DE: „."=Tausender (entfernt), „,"=Dezimale. Gibt null bei leerer/ungültiger Eingabe. */
export function parseDe(s: string): number | null {
  const trimmed = s.trim().replace(/\s| /g, "");
  const cleaned = isEn()
    ? trimmed.replace(/,/g, "")            // Tausender-Komma raus, Punkt bleibt Dezimale
    : trimmed.replace(/\./g, "").replace(",", "."); // Tausender-Punkt raus, Komma → Punkt
  if (cleaned === "" || cleaned === "-" || cleaned === "+") return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}
