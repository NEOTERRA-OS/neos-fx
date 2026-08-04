import type { Domain } from "./model";

/**
 * DIE ÄNDERUNGSHISTORIE EINER ANNAHME — an EINER Stelle, für ALLE Ansichten.
 *
 * WARUM DIESE DATEI ENTSTANDEN IST. `logMeta` stand bis 04.08.2026 lokal in
 * `AnnahmenView.tsx`. Damit wurde eine Zahl protokolliert, wenn man sie im
 * Annahmen-Register änderte — und NICHT protokolliert, wenn man dieselbe Zahl
 * über dasselbe `<Feld akey="…" />` in der Personalplanung, im Anbauplan, in
 * der Finanzierung oder im Maschinenpark änderte. Beide Wege schreiben in
 * `assumptions[key].scenarioProfiles[…]`, beide ändern das Ergebnis; nur einer
 * hinterließ eine Spur.
 *
 * Das ist die schlechteste Sorte Audit: eine Historie, die aussieht, als wäre
 * sie vollständig. Wer sie liest und dort nichts findet, schließt „wurde nicht
 * geändert" — obwohl „wurde woanders geändert" genauso wahrscheinlich ist.
 *
 * Der Eintrag hängt jetzt am Baustein `Feld`, nicht an der Ansicht. Jede
 * Wertänderung einer Annahme läuft durch ihn hindurch, gleich von wo.
 */

/** Ein Eintrag der Historie. Bewusst Text und nicht Zahl: er soll lesbar
 *  bleiben, auch wenn sich Einheit oder Formatierung des Feldes später ändern. */
export type AuditFeld = string;

/** Wie viele Einträge je Annahme aufbewahrt werden. Die Historie reist im
 *  gespeicherten Stand mit; unbegrenzt wächst sie in die Dateigröße. */
const HISTORIE_MAX = 25;

/**
 * Änderung mit Bearbeiter und Zeitstempel in der Historie der Annahme ablegen.
 *
 * `from`/`to` sind ANZEIGETEXTE (also schon in der Einheit des Feldes, mit den
 * Nachkommastellen, die der Nutzer gesehen hat). Wer hier den Rohwert in Cent
 * ablegt, produziert eine Historie, die niemand gegen den Bildschirm halten
 * kann, den er in Erinnerung hat.
 *
 * Aufruf NUR innerhalb eines `patch(...)` — `d` ist der Entwurf.
 */
export function logMeta(d: Domain, key: string, by: string, field: string, from: string, to: string): void {
  const a = d.assumptions[key];
  if (!a) return;
  a.meta = a.meta ?? {};
  a.meta.updatedBy = by;
  a.meta.updatedAt = new Date().toISOString();
  a.meta.history = a.meta.history ?? [];
  a.meta.history.push({ ts: a.meta.updatedAt, by, field, from: from || undefined, to: to || undefined });
  if (a.meta.history.length > HISTORIE_MAX) a.meta.history = a.meta.history.slice(-HISTORIE_MAX);
}
