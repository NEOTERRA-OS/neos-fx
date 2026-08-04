/**
 * Die Düngung kommt aus dem Kompendium, nicht aus einem Mischpreis.
 *
 * Bis 04.08.2026 rechnete NEOS FX jede Gabe als Nährstoffmenge × Mischpreis.
 * Zwei Fehler steckten darin, und beide waren unsichtbar:
 *
 *   DER PREIS. `fert.n` = 1,30 €/kg N ist die „Mischkalkulation KAS/Harnstoff".
 *   Die Anbautelegramme fahren Calciumnitrat zu 3,16 €/kg N — wegen des
 *   Calciums, nicht wegen des Stickstoffs. Der Mischpreis kann diesen Grund
 *   nicht kennen. Gemessen: Weißkohl 842 €/ha zu niedrig, Zwiebel 236, Chips 124.
 *
 *   DIE BEGLEITNÄHRSTOFFE. 100 kg P₂O₅ als MAP 12-52-0 bringen 23 kg N mit. Das
 *   Mengengerüst zählte nur die N-Gaben (215 kg N/ha), die Nitratrichtlinie
 *   verlangt die Gesamtzufuhr (254). Ohne Produkte ist die Frage nicht stellbar.
 *
 * DIESE TESTS SIND EINE KLAMMER ÜBER ZWEI REPOSITORIES. Der Plan entsteht im
 * Kompendium und wird nach FX exportiert. Zwei Stände, die dieselbe Zahl tragen
 * müssen, laufen ohne Prüfung immer auseinander — und zwar still, weil beide für
 * sich plausibel bleiben. Die Referenzen unten stammen aus
 * `neos-compendium/dist/plans/duenger_plan.csv`, Stand 04.08.2026.
 */
import { describe, it, expect } from "vitest";
import {
  SEED, deriveCropMassnahmen, naehrstoffZufuhr, duengerPreisKey,
  DUENGERPLAN_KULTUREN, resolveScalar,
} from "../../store/model";
import { DUENGER_GABEN, DUENGER_PRODUKTE } from "../../store/duengerplan.generated";

const SZ = SEED.baseScenarioId;
const duengungEurHa = (crop: string) =>
  deriveCropMassnahmen(SEED, crop, SZ, 0).rows
    .filter((r) => r.fachbereich === "DUENGUNG")
    .reduce((s, r) => s + r.totalCent, 0) / 100;

describe("Der Plan aus dem Kompendium ist angekommen", () => {
  it("führt jede Kultur des Kostenkatalogs", () => {
    /* Der Export kennt zusätzlich Weizen, Gerste und Mais. Die fährt der Betrieb
     *  seit der Entscheidung NEOTERRA-Solo (30.07.2026) nicht mehr — sie stehen
     *  im Export für den Fall, dass der Ackerbaublock zurückkommt, und schaden
     *  dort nicht. Geprüft wird deshalb gegen den KATALOG, nicht gegen den Export. */
    for (const e of SEED.catalog) {
      expect(DUENGERPLAN_KULTUREN.has(e.cropId), e.cropId).toBe(true);
    }
  });

  it("gibt jedem Produkt einen Preis und einen Belegstatus", () => {
    expect(DUENGER_PRODUKTE.length).toBeGreaterThan(10);
    for (const p of DUENGER_PRODUKTE) {
      expect(p.preisCentKg, p.kurz).toBeGreaterThan(0);
      expect(p.evidence, p.kurz).toBeTruthy();
      // Der Preis muss als AUFLÖSBARE Annahme dastehen — sonst ist er Zierde.
      expect(resolveScalar(SEED, duengerPreisKey(p.kurz), SZ), p.kurz).toBe(p.preisCentKg);
    }
  });

  it("nennt jede Gabe mit Produkt und Warenmenge, nicht mit einer Nährstoffzahl", () => {
    for (const g of DUENGER_GABEN) {
      expect(g.kurz, `${g.cfgId} ${g.nr}`).toBeTruthy();
      expect(g.wareKgHa, `${g.cfgId} ${g.nr}`).toBeGreaterThan(0);
    }
  });
});

describe("Die Kosten stimmen mit dem Kompendium überein", () => {
  /* Referenz: Summe EUR_ha je Konfiguration aus duenger_plan.csv.
   *
   *  TOLERANZ 2 %, und der Grund ist ein Befund, kein Rundungsfehler. Das
   *  Kompendium preist eine POSITION, FX preist ein PRODUKT — ein Produkt hat
   *  in FX genau einen Preis. Im Kompendiumsplan tragen neun Produkte mehr als
   *  einen: Bor Solubor schwankt über 5,0 %, Zinksulfat über 3,0 %, der Rest
   *  unter 0,2 % (reine Rundung der Ausgangsdatei). Bei Knoblauch schlägt das
   *  mit +1,8 % durch, weil dort eine Borgabe im Verhältnis schwer wiegt.
   *
   *  Das ist zurückzugeben: derselbe Dünger sollte im selben Planjahr denselben
   *  Preis haben. Bis das geklärt ist, mittelt der Export — sichtbar hier, nicht
   *  still. Deshalb 2 % und nicht 5: bei mehr als 2 % ist es kein Preisdetail
   *  mehr, sondern eine andere Produktwahl. */
  const REF: Record<string, number> = {
    kartoffel_pommes: 1672.02,
    kartoffel_chips: 1526.06,
    tomate: 1449.64,
    knoblauch: 536.55,
    knollensellerie: 1796.00,
    suesskartoffel: 1327.54,
    // Mischposition: onDry 1227,50 und carSum 1342,46, je zur Hälfte.
    zwiebel_moehre: (1227.50 + 1342.46) / 2,
  };
  it.each(Object.keys(REF))("rechnet %s wie der Kompendium-Plan", (crop) => {
    const ist = duengungEurHa(crop);
    expect(Math.abs(ist - REF[crop]) / REF[crop], `${crop}: ${ist.toFixed(2)} gegen ${REF[crop].toFixed(2)}`)
      .toBeLessThan(0.02);
  });
});

describe("Begleitnährstoffe werden mitgezählt", () => {
  it("weist für Pommes die Gesamtzufuhr aus, nicht nur die N-Gaben", () => {
    /* DIE ZAHL, UM DIE ES GEHT. Das Mengengerüst nennt 215 kg N/ha, weil es nur
     *  die N-Gaben zählt. Der produktscharfe Plan kommt auf 254 — die Differenz
     *  von 39 kg ist das N, das mit MAP (Grunddüngung und Bandablage) und
     *  Calciumnitrat (Fertigation) mitkommt. Wer nach der Nitratrichtlinie
     *  bilanziert, muss mit 254 rechnen. */
    const z = naehrstoffZufuhr("kartoffel_pommes");
    expect(z.n).toBeGreaterThan(240);
    expect(z.n).toBeLessThan(265);
    expect(z.n).toBeGreaterThan(215);          // mehr als das reine Mengengerüst
    // Und die Begleiter sind da, statt zu fehlen:
    expect(z.cao, "Calcium aus dem Calciumnitrat").toBeGreaterThan(0);
    expect(z.so3, "Schwefel aus ASS, SOP und Kieserit").toBeGreaterThan(0);
    expect(z.mgo, "Magnesium aus dem Kieserit").toBeGreaterThan(0);
  });

  it("liefert für jede Plan-Kultur eine vollständige Zufuhr", () => {
    for (const c of DUENGERPLAN_KULTUREN) {
      const z = naehrstoffZufuhr(c);
      expect(z.n + z.p2o5 + z.k2o, c).toBeGreaterThan(0);
    }
  });
});

describe("Maßnahmen-IDs bleiben eindeutig", () => {
  /* DER FUND BEIM EINBAU. Eine Grunddüngung „P/K/Mg/S" besteht aus DREI Gaben
   *  mit derselben Nummer und demselben Text — MAP, SOP, Kieserit. Bei der
   *  Mischposition Zwiebel/Möhre überschneiden sich zusätzlich die Nummern der
   *  beiden Konfigurationen. Aus `<Nr> <Maßnahme>` wurden so vier Zeilen mit
   *  EINER ID, und der Plan-Ist-Abgleich hätte sie nie auseinanderhalten können.
   *  Die ID trägt jetzt cfgId, Nummer und Produkt — und zwar VORNE, weil der
   *  Slug bei 44 Zeichen kappt. */
  it("vergibt in keiner Kultur und keinem Block eine ID zweimal", () => {
    for (const e of SEED.catalog) {
      for (const op of e.ops) {
        const gesehen = new Map<string, number>();
        for (const l of op.lines) {
          const mid = (l as { mid?: string }).mid;
          if (!mid) continue;
          gesehen.set(mid, (gesehen.get(mid) ?? 0) + 1);
        }
        for (const [mid, n] of gesehen) {
          expect(n, `${e.cropId} ${op.code}: ${mid}`).toBe(1);
        }
      }
    }
  });
});

describe("Kulturen ohne Plan rechnen weiter über den Mischpreis", () => {
  it("hat für die Zwischenfrucht gar keinen Plan — und auch keinen Kostenkatalog", () => {
    /* BEFUND BEIM SCHREIBEN DIESES TESTS. Die Zwischenfrucht steht im Anbauplan
     *  (3.017 ha, die größte Fläche des Betriebs), hat aber KEINEN Eintrag im
     *  Kostenkatalog — also weder Düngung noch Pflanzenschutz noch Saatgut als
     *  Maßnahmenzeile. Ihre Kosten laufen über einen anderen Weg.
     *
     *  Das ist kein Fehler dieses Umbaus, sondern ein älterer Zustand, den er
     *  sichtbar macht: eine Kultur ohne Katalog erscheint in keiner
     *  Maßnahmenkette, in keinem Maßnahmenplan-Export und in keinem Plan-Ist-
     *  Abgleich. Für die größte Einzelfläche des Betriebs ist das eine Lücke.
     *  Der Test hält den Zustand fest, damit er nicht unbemerkt bleibt — er
     *  schlägt an, sobald jemand ihn ändert. */
    expect(DUENGERPLAN_KULTUREN.has("zwischenfrucht")).toBe(false);
    expect(SEED.anbauplan.some((a) => a.cropId === "zwischenfrucht")).toBe(true);
    expect(SEED.catalog.some((c) => c.cropId === "zwischenfrucht")).toBe(false);
  });
});
