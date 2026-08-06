/**
 * JEDER SICHTBARE SATZ HAT EINE ÜBERSETZUNG — oder er steht auf der Liste.
 *
 * WIE DIESER TEST ENTSTAND, am 06.08.2026. Ich hatte in der Direktkosten-Tabelle
 * einen Satz um zwei Wörter ergänzt („…dazu aktive Lohnarbeit UND DIE
 * KULTURVERSICHERUNG…"). Der deutsche Text IST der Schlüssel des
 * Übersetzungsregisters — mit der Ergänzung ging der Treffer verloren, und die
 * englische Oberfläche hätte an dieser Stelle stumm auf Deutsch zurückgefallen.
 * Kein Absturz, keine Warnung, nur ein deutscher Satz mitten im englischen
 * Bildschirm. Aufgefallen ist es beim Nachzählen im gebauten HTML, nicht beim
 * Schreiben.
 *
 * Das ist die unangenehmste Sorte Fehler: er entsteht nicht beim Anlegen einer
 * Zeichenkette, sondern beim VERBESSERN einer bestehenden. Wer einen Satz
 * präzisiert, bricht die Übersetzung — und die Präzisierung ist ja richtig.
 *
 * Der Test liest die Quelltexte, sammelt alle `t("…")`-Literale und hält sie
 * gegen das Register. Er prüft KEINE Übersetzungsqualität, nur Vollständigkeit.
 * Die Ausnahmeliste unten ist bewusst kurz und benannt: was dort steht, ist
 * eine Entscheidung, kein Vergessen.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import EN_DICT from "../../lib/i18n_b12";
import B1 from "../../lib/i18n_b1";
import B2 from "../../lib/i18n_b2";
import B3 from "../../lib/i18n_b3";
import B4 from "../../lib/i18n_b4";
import B5 from "../../lib/i18n_b5";
import B6 from "../../lib/i18n_b6";
import B7 from "../../lib/i18n_b7";
import B8 from "../../lib/i18n_b8";
import B9 from "../../lib/i18n_b9";
import B10 from "../../lib/i18n_b10";
import B11 from "../../lib/i18n_b11";

const WURZEL = join(__dirname, "..", "..");
const REGISTER: Record<string, string> = {
  ...B1, ...B2, ...B3, ...B4, ...B5, ...B6, ...B7, ...B8, ...B9, ...B10, ...B11, ...EN_DICT,
};

/* Wortgleiche Begriffe brauchen keine Übersetzung — sie stehen in beiden
 *  Sprachen gleich (Eigennamen, Einheiten, Kürzel). Alles andere gehört ins
 *  Register. Die Liste ist Teil des Tests, nicht sein Umgehungsweg. */
const GLEICH = new Set([
  "NEOS FX", "EBITDA", "DSCR", "CAPEX", "OpEx", "SG&A", "IFRS", "GAP", "TVA", "USt / TVA",
  "Base", "Best", "Worst", "OVR", "DE", "EN", "RON", "€", "ha", "t", "€/ha", "€/t", "%",
]);

function dateien(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e === "dist" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) dateien(p, out);
    else if (/\.tsx?$/.test(e) && !/i18n/.test(e) && !/__tests__/.test(p)) out.push(p);
  }
  return out;
}

/** Alle `t("…")`-Literale. Template-Strings und Variablen bleiben außen vor —
 *  sie sind zur Laufzeit zusammengesetzt und hier nicht prüfbar. */
function textliterale(): { text: string; datei: string }[] {
  const out: { text: string; datei: string }[] = [];
  for (const p of dateien(join(WURZEL, "components")).concat(dateien(join(WURZEL, "store")))) {
    const s = readFileSync(p, "utf8");
    for (const m of s.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) {
      const roh = m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\u201c/g, "“");
      out.push({ text: roh, datei: p.slice(WURZEL.length + 1) });
    }
  }
  return out;
}

describe("Die englische Oberfläche fällt nirgends auf Deutsch zurück", () => {
  const alle = textliterale();

  it("findet überhaupt Texte — sonst prüft der Test nichts", () => {
    expect(alle.length).toBeGreaterThan(200);
  });

  it("übersetzt die Sätze, die am 06.08.2026 angefasst wurden", () => {
    /* DER AUSLÖSER, punktgenau geprüft. Diese drei Sätze sind an dem Tag
     *  entstanden oder geändert worden; sie MÜSSEN im Register stehen. */
    const NEU = [
      "Versicherung",
      "Bau & Infrastruktur — Investitionsplan",
      "Maschinenbestand & Stammdaten",
    ];
    const fehlt = NEU.filter((k) => REGISTER[k] === undefined);
    expect(fehlt, "am 06.08. angefasst, aber nicht übersetzt").toEqual([]);
  });

  it("lässt die Zahl unübersetzter Sätze NICHT weiter wachsen", () => {
    /* EIN RIEGEL, KEINE BEHAUPTUNG. Die englische Oberfläche ist zu einem
     *  erheblichen Teil unübersetzt — 319 Sätze am 06.08.2026 (von 342 vor dieser
     *  Sitzung), quer durch alle
     *  Ansichten. Das ist ein alter Zustand und nicht in einer Sitzung zu
     *  beheben; ihn hier grün zu behaupten wäre gelogen, ihn rot stehen zu
     *  lassen macht den Test wertlos, weil ihn dann jeder überspringt.
     *
     *  Also eine Sperrklinke: die Zahl darf sinken, nie steigen. Wer einen
     *  neuen deutschen Satz einbaut, ohne ihn einzutragen, wird hier rot — und
     *  zwar mit der Datei und dem Satz im Klartext. Wer zehn alte übersetzt,
     *  senkt die Schwelle und macht den Riegel enger.
     *
     *  Der Fehler, um den es geht, ist nicht das Fehlen einer Übersetzung,
     *  sondern ihr stiller VERLUST: der deutsche Text ist der Schlüssel: wer
     *  einen Satz präzisiert, bricht den Treffer, und die englische Ansicht
     *  fällt an dieser einen Stelle auf Deutsch zurück. Kein Absturz, keine
     *  Warnung — nur ein deutscher Satz mitten im englischen Bildschirm. */
    const SCHWELLE = 319;
    const fehlend = alle
      .filter((x) => x.text.trim().length >= 4)
      .filter((x) => !GLEICH.has(x.text.trim()))
      .filter((x) => !/^[\d\s.,:%€/()·×–—-]+$/.test(x.text))
      .filter((x) => REGISTER[x.text] === undefined);
    const bericht = [...new Set(fehlend.map((x) => `${x.datei}: „${x.text.slice(0, 70)}"`))];
    expect(bericht.length, `${bericht.length} unübersetzt (Schwelle ${SCHWELLE}). Neu hinzugekommen?\n  `
      + bericht.slice(0, 10).join("\n  ")).toBeLessThanOrEqual(SCHWELLE);
  });
});
