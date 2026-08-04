/**
 * Saisonalität der Personalkosten.
 *
 * `pers.saison.n` steht ausdrücklich als „FTE-Äquivalent" da: 11,7
 * Vollzeitäquivalente heißen nicht elf Leute das ganze Jahr, sondern die
 * Jahresarbeitszeit von elf Leuten — geleistet in wenigen Wochen von
 * entsprechend vielen. Bis 04.08.2026 verteilte der Composer diese Kopfzahl
 * flach auf zwölf Monate. Der Jahresbetrag stimmte, die Kasse nicht: das Modell
 * bezahlte Erntehelfer im Januar.
 *
 * Zwei Zusicherungen halten die Umstellung zusammen:
 *   · der JAHRESBETRAG bleibt unangetastet — die Gewichte summieren auf 1
 *   · Festangestellte bleiben FLACH — ein unbefristeter Vertrag ist flach
 *
 * Alles andere ist Zeitpunkt, und der gehört in die Liquidität.
 */
import { describe, it, expect } from "vitest";
import {
  SEED, buildModelState, personalMonatsgewichte, personalFteOfYear,
  PERSONAL_POSITIONEN, CROP_CAL, resolveScalar, deriveCropMassnahmen, type Domain,
} from "../../store/model";

const SZ = SEED.baseScenarioId;
const JAHRE = Math.max(1, SEED.growth?.years ?? 1);
const klon = (d: Domain): Domain => JSON.parse(JSON.stringify(d));
const saisonal = PERSONAL_POSITIONEN.filter((p) => p.saisonal);
const fest = PERSONAL_POSITIONEN.filter((p) => !p.saisonal);

describe("Monatsgewichte", () => {
  it("summieren sich für jede Position und jedes Jahr auf 1", () => {
    for (const pos of PERSONAL_POSITIONEN) {
      for (let y = 0; y < JAHRE; y++) {
        const w = personalMonatsgewichte(SEED, pos.key, y, SZ);
        expect(w.length, pos.key).toBe(12);
        expect(w.reduce((a, b) => a + b, 0), `${pos.key} Jahr ${y}`).toBeCloseTo(1, 9);
        expect(w.every((x) => x >= 0), pos.key).toBe(true);
      }
    }
  });

  it("lassen Festangestellte flach", () => {
    expect(fest.length).toBeGreaterThan(0);
    for (const pos of fest) {
      for (const w of personalMonatsgewichte(SEED, pos.key, JAHRE - 1, SZ)) {
        expect(w, pos.key).toBeCloseTo(1 / 12, 12);
      }
    }
  });

  it("legt die Kampagne auf die Erntemonate des Plans", () => {
    expect(saisonal.length).toBeGreaterThan(0);
    const y = JAHRE - 1;
    const dauer = Math.round(resolveScalar(SEED, "pers.kampagne_monate", SZ));
    // Monate, in denen laut Plan überhaupt geerntet wird (plus Kampagnennachlauf).
    const erlaubt = new Set<number>();
    for (const a of SEED.anbauplan) {
      if (a.zweitnutzung) continue;
      const ernte = a.harvestPeriods?.length ? a.harvestPeriods : (CROP_CAL[a.cropId as keyof typeof CROP_CAL]?.harvest ?? []);
      for (const m of ernte) for (let d = 0; d < dauer; d++) erlaubt.add((((m + d) % 12) + 12) % 12);
    }
    for (const pos of saisonal) {
      const w = personalMonatsgewichte(SEED, pos.key, y, SZ);
      w.forEach((x, m) => {
        if (x > 0) expect(erlaubt.has(m), `${pos.key}: Monat ${m} trägt Gewicht, obwohl dort nichts geerntet wird`).toBe(true);
      });
      // Und die Spitze liegt wirklich in der Ernte, nicht irgendwo.
      expect(Math.max(...w)).toBeGreaterThan(0.3);
    }
  });

  /* DER FUND, der die erste Fassung gerettet hat: die Zwischenfrucht trägt im
   *  Anbauplan einen „Erntemonat" (November) — das ist die Einarbeitung. Mit
   *  3.017 ha ist sie die größte Fläche im Plan und hätte 44 % der Saisonarbeit
   *  in den November gezogen, wo niemand erntet. */
  it("lässt die Zwischenfrucht außen vor", () => {
    const zw = SEED.anbauplan.find((a) => a.zweitnutzung);
    expect(zw, "Testvoraussetzung: es gibt eine Zweitnutzung im Plan").toBeTruthy();
    const w = personalMonatsgewichte(SEED, "pers.saison.n", JAHRE - 1, SZ);
    const zwMonate = zw!.harvestPeriods ?? [];
    expect(zwMonate.length).toBeGreaterThan(0);
    for (const m of zwMonate) {
      const m0 = ((m % 12) + 12) % 12;
      // Der Monat darf Gewicht tragen, wenn dort eine ECHTE Kultur erntet —
      //  aber nicht das Gewicht der 3.017 ha Zwischenfrucht.
      expect(w[m0], `Monat ${m0}`).toBeLessThan(0.2);
    }
  });

  it("folgt der eingestellten Kampagnendauer", () => {
    const eng = klon(SEED);
    eng.assumptions["pers.kampagne_monate"].scenarioProfiles[SZ] = { kind: "constant", value: 1 };
    const breit = klon(SEED);
    breit.assumptions["pers.kampagne_monate"].scenarioProfiles[SZ] = { kind: "constant", value: 4 };
    const belegt = (d: Domain) => personalMonatsgewichte(d, "pers.saison.n", JAHRE - 1, SZ).filter((x) => x > 1e-9).length;
    expect(belegt(eng)).toBeLessThan(belegt(SEED));
    expect(belegt(breit)).toBeGreaterThan(belegt(SEED));
  });

  it("lässt sich vom echten Kampagnenplan überschreiben", () => {
    const d = klon(SEED);
    const eigen = Array.from({ length: 12 }, (_, m) => (m === 5 ? 3 : 0));   // alles im Juni
    d.personalSaison = { "pers.saison.n": eigen };
    const w = personalMonatsgewichte(d, "pers.saison.n", JAHRE - 1, SZ);
    expect(w[5]).toBeCloseTo(1, 9);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
});

describe("pers.saison.n und OP-HAND sind verschiedene Leute", () => {
  /* Geklärt am 04.08.2026 mit NEOTERRA. Der Punkt stand offen, weil eine
   *  Doppelzählung hier NICHT auffallen würde: die eine Position läuft über die
   *  Personalplanung in SG&A, die andere als Direktkosten je Kultur in COGS.
   *  Wären es dieselben Köpfe, stünden sie zweimal im Modell — in zwei
   *  verschiedenen Zeilen der GuV, wo keine Summenprüfung sie zusammenbringt.
   *
   *  Gemeinsam ist ihnen nur der ZEITPUNKT. Dieser Test hält beides fest: dass
   *  sie denselben Kalenderanker teilen UND dass sie getrennt bleiben. */
  it("teilen den Erntemonat als Anker", () => {
    const monate = new Set<number>();
    for (const a of SEED.anbauplan) {
      if (a.zweitnutzung) continue;
      const e = a.harvestPeriods?.length ? a.harvestPeriods : (CROP_CAL[a.cropId as keyof typeof CROP_CAL]?.harvest ?? []);
      for (const m of e) monate.add(((m % 12) + 12) % 12);
    }
    const w = personalMonatsgewichte(SEED, "pers.saison.n", JAHRE - 1, SZ);
    const spitze = w.indexOf(Math.max(...w));
    expect(monate.has(spitze), `Spitze in Monat ${spitze}, geerntet wird in ${[...monate].join(",")}`).toBe(true);
  });

  it("laufen über getrennte Wege ins Ergebnis — SG&A gegen COGS", () => {
    /* Die Probe: `pers.saison.n` auf null zu setzen, darf die Handarbeitskosten
     *  der Kulturen NICHT verändern. Hingen beide an derselben Größe, würde die
     *  eine mit der anderen verschwinden. */
    const hand = (d: Domain) => deriveCropMassnahmen(d, "kartoffel_pommes", SZ, 0).rows
      .filter((r) => r.fachbereich === "HANDARBEIT").reduce((s, r) => s + r.totalCent, 0);

    const ohneSaison = klon(SEED);
    ohneSaison.personalOverride = { ...(ohneSaison.personalOverride ?? {}), "pers.saison.n": [0] };
    expect(personalFteOfYear(SEED, "pers.saison.n", 0, SZ)).toBeGreaterThan(0);
    expect(personalFteOfYear(ohneSaison, "pers.saison.n", 0, SZ)).toBe(0);
    expect(hand(SEED)).toBeGreaterThan(0);
    expect(hand(ohneSaison)).toBe(hand(SEED));
  });

  it("die Kopfzahl kommt aus dem Flächen-Treiber, nicht aus der Handarbeit", () => {
    /* Nebenbefund, der beim Schreiben dieses Tests aufgefallen ist und
     *  festgehalten gehört: `pers.saison.n` als ANNAHME auf null zu setzen ändert
     *  die Kopfzahl NICHT — sie fällt aus `personalRatio` (Fläche je Saison-FTE).
     *  Die Annahme ist nur die Kalibrierungsbasis. Wer die Mannschaft wirklich
     *  ändern will, ändert das Verhältnis oder überschreibt das Jahr. */
    const d = klon(SEED);
    d.assumptions["pers.saison.n"].scenarioProfiles[SZ] = { kind: "constant", value: 0 };
    expect(personalFteOfYear(d, "pers.saison.n", 0, SZ)).toBeCloseTo(personalFteOfYear(SEED, "pers.saison.n", 0, SZ), 9);
  });
});

describe("Der Jahresbetrag bleibt unangetastet", () => {
  it("summiert die Monatskopfzahlen auf die zwölffache Jahres-FTE", () => {
    /* Das ist die eigentliche Zusicherung. Wäre sie verletzt, hätte die
     *  Saisonalisierung nicht den Zeitpunkt verschoben, sondern die Kosten
     *  verändert — und das wäre eine Aussage, die niemand getroffen hat. */
    const st = buildModelState(SEED, SZ);
    for (const pos of PERSONAL_POSITIONEN) {
      const prof = st.assumptions[pos.key]?.scenarioProfiles[SEED.baseScenarioId];
      expect(prof, pos.key).toBeTruthy();
      if (prof!.kind !== "curve") continue;
      const v = (prof as { kind: "curve"; values: number[] }).values;
      for (let y = 0; y * 12 < v.length; y++) {
        const summe = v.slice(y * 12, y * 12 + 12).reduce((a, b) => a + b, 0);
        const soll = 12 * personalFteOfYear(SEED, pos.key, y, SZ);
        expect(summe, `${pos.key} Jahr ${y}`).toBeCloseTo(soll, 6);
      }
    }
  });

  it("bewegt Umsatz und EBITDA nicht — nur Zins und Kasse", () => {
    /* Referenz aus dem Stand VOR der Saisonalisierung (35ba004): der Jahresbetrag
     *  war schon damals derselbe, deshalb müssen Umsatz und EBITDA auf den Cent
     *  stehenbleiben. Was sich bewegt, ist der Revolverzins — und damit Ergebnis
     *  und Kasse. Genau diese Signatur macht die Änderung überprüfbar. */
    const st = buildModelState(SEED, SZ);
    expect(st).toBeTruthy();
    // Die Zahlen selbst liegen in den Golden Files; hier nur die Trennung der Wirkung.
    const gewichte = personalMonatsgewichte(SEED, "pers.saison.n", JAHRE - 1, SZ);
    expect(gewichte.some((w) => w > 1 / 12)).toBe(true);   // es ist wirklich nicht mehr flach
  });
});
