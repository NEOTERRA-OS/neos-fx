/**
 * Golden Files je Szenario.
 *
 * Zweck: eine Änderung am Modell darf die Zahlen bewegen — aber niemand darf es
 * versehentlich tun. Reisst dieser Test, ist das kein Fehler, sondern eine Frage:
 * war die Bewegung gewollt? Wenn ja, `npm run golden:update` und der Diff im
 * Commit zeigt jedem Leser genau, was sich geändert hat.
 *
 * Bewusst auf Jahreskennzahlen beschränkt. Ein Golden File über alle 96 Perioden
 * und jede Zeile wäre bei jeder Änderung rot und damit wertlos.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { jahreskennzahlen, rechneSzenario, SZENARIEN } from "./kennzahlen";

const DIR = join(__dirname, "golden");
const AKTUALISIEREN = process.env.GOLDEN_UPDATE === "1";

describe.each(SZENARIEN)("Golden File · $name", ({ id, name }) => {
  it("die Jahreskennzahlen entsprechen dem hinterlegten Stand", () => {
    const ist = jahreskennzahlen(rechneSzenario(id));
    const datei = join(DIR, `${id}.json`);

    if (AKTUALISIEREN || !existsSync(datei)) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(datei, JSON.stringify(ist, null, 2) + "\n", "utf-8");
      if (!AKTUALISIEREN) {
        console.warn(`Golden File für ${name} neu angelegt: ${datei}`);
      }
      return;
    }

    const soll = JSON.parse(readFileSync(datei, "utf-8")) as typeof ist;
    // Zeilenweise vergleichen, damit die Fehlermeldung das Jahr nennt und nicht
    // nur "Objekte ungleich".
    expect(ist.length).toBe(soll.length);
    ist.forEach((zeile, i) => {
      expect(zeile, `Abweichung im Jahr ${zeile.jahr} (Szenario ${name}). `
        + `Gewollt? Dann: GOLDEN_UPDATE=1 npm test`).toEqual(soll[i]);
    });
  });
});
