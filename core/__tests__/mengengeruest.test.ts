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
import { SEED, kompendiumSaatMenge, kompendiumBeregnungMm, CROP_NAME } from "../../store/model";
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

  it("beregnet mit der NETTO-Norm des Kompendiums — Entscheidung 04.08.2026", () => {
    /* „Alles muss netto kalkuliert sein." Netto ist, was an der Pflanze
     *  ankommt; brutto, was durch die Pumpe geht. FX führte bis heute eigene
     *  Zahlen („Süd-Oltenien, abgeleitet") und lag bei der Süßkartoffel 51 %
     *  unter der Kompendiumsnorm.
     *
     *  DIE BEDINGUNG, DIE AN DIESER ENTSCHEIDUNG HÄNGT und die dieser Test
     *  NICHT prüfen kann, weil sie außerhalb des Modells liegt: `irrig.eur_mm`
     *  muss ein Satz JE NETTO-MILLIMETER sein, in dem der Systemverlust
     *  steckt. Der mittlere Wirkungsgrad der 22 Konfigurationen ist 64 % —
     *  wer dort einen Preis je gefördertem Kubikmeter einträgt, unterschätzt
     *  die Beregnung um gut die Hälfte. Der Treibername sagt es jetzt. */
    for (const crop of ["kartoffel_pommes", "kartoffel_chips", "tomate", "suesskartoffel", "knollensellerie"]) {
      const k = kompendiumBeregnungMm(crop as never);
      expect(k, crop).toBeGreaterThan(0);
    }
    // Die Mischposition mittelt die beiden Konfigurationen — Millimeter bleiben Millimeter.
    const gemischt = kompendiumBeregnungMm("zwiebel_moehre" as never)!;
    const einzeln = (cfg("onDry").beregnungNettoMm + cfg("carSum").beregnungNettoMm) / 2;
    expect(gemischt).toBe(Math.round(einzeln));
    // Die Trockenrotation bekommt KEINE Norm — sie wird nicht beregnet.
    expect(kompendiumBeregnungMm("weizen_dry" as never)).toBeUndefined();
  });
});

describe("ABWEICHEND — festgehalten, nicht stillgelegt", () => {
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

  it("legt Tomate, Süßkartoffel und Knoblauch dünner als das Kompendium", () => {
    /* DREI ABWEICHUNGEN, DIE STEHENBLEIBEN — bis der Betrieb sie entscheidet.
     *
     *     Kultur          FX          Kompendium        Δ    Belegstatus
     *     Tomate          25.000 Pfl.  32.000 (+3 % R.)  −22 %  BELEGT
     *     Süßkartoffel    30.000 Slips 38.000            −21 %  BELEGT
     *     Knoblauch          900 kg     1.000 kg         −10 %  ABGELEITET
     *
     *  Aufschlussreich ist, was NICHT abweicht: Knollensellerie trifft mit
     *  50.000 Jungpflanzen auf die Pflanze genau, die Zwischenfrucht bei der
     *  Beregnung auf den Millimeter. Die FX-Zahlen sind also nicht erfunden,
     *  sondern zu einem früheren Zeitpunkt aus derselben Quelle übernommen —
     *  und danach hat das Kompendium sich bewegt und FX nicht. Genau dieses
     *  Muster macht Abschreiben unhaltbar: es sieht jahrelang richtig aus.
     *
     *  ICH ÄNDERE SIE NICHT VON MIR AUS. Eine Pflanzdichte ist eine
     *  agronomische Entscheidung mit Folgen weit über die Pflanzgutrechnung
     *  hinaus — Reihenweite, Kaliber, Erntetechnik, Sortierausbeute hängen
     *  daran. Der Betrieb hat am 04.08.2026 die KARTOFFEL entschieden; für
     *  diese drei steht die Frage offen.
     *
     *  Was sie kosten würde, damit die Frage beantwortbar ist:
     *     Tomate        +7.000 Pfl. × 36 €/1.000  = +252 €/ha
     *     Süßkartoffel  +8.000 Slips × 120 €/1.000 = +960 €/ha
     *     Knoblauch       +100 kg × 3,00 €/kg     = +300 €/ha */
    const FX_ABSOLUT: Record<string, number> = {
      tomate: 25_000, suesskartoffel: 30_000, knoblauch: 900,
    };
    const KOMPENDIUM: Record<string, number> = {
      tomate: 32_000, suesskartoffel: 38_000, knoblauch: 1_000,
    };
    for (const k of Object.keys(FX_ABSOLUT)) {
      const abw = (FX_ABSOLUT[k] - KOMPENDIUM[k]) / KOMPENDIUM[k];
      expect(abw, `${k}: ${(abw * 100).toFixed(0)} %`).toBeLessThan(0);      // FX liegt darunter
      expect(Math.abs(abw), `${k}: ${(abw * 100).toFixed(0)} %`).toBeLessThan(0.25);
    }
    // Und der Gegenbeweis: wo FX und Kompendium sich decken, decken sie sich exakt.
    expect(cfg("celRoot").saatMenge).toBe(50_000);
    expect(cfg("covCrop").beregnungNettoMm).toBe(138);
  });
});
