/**
 * KULTURVERSICHERUNG — die Prämie hängt an der Ernte, nicht am Hektar.
 *
 * Sie ist am 04.08.2026 als eigene Position dazugekommen, und die
 * Entscheidung, die dabei zählt, ist keine Zahl, sondern eine Form: eine
 * PROZENTUALE Prämie auf den Erntewert statt einer €/ha-Pauschale.
 *
 * Der Unterschied wird erst im Szenario sichtbar. Die Versicherungssumme ist
 * „valoarea recoltei" — Netto-Ertrag × Preis, so steht es in den rumänischen
 * Bedingungen. Eine Pauschale würde im Best Case dieselbe Prämie für eine um
 * 20 % wertvollere Ernte behaupten und im Worst Case eine zu hohe für eine
 * Ernte, die es nicht gibt. Beides wäre nicht bloß ungenau, sondern falsch
 * herum: es würde die Versicherung ausgerechnet dort billig aussehen lassen,
 * wo der versicherte Wert am größten ist.
 *
 * Die zweite Entscheidung steckt im Szenarioband des Zuschusses. sM 17.1
 * erstattet 70 % der gezahlten Prämie — aber nachträglich, auf Antrag, in
 * einer Session mit begrenzter Mittelzuweisung. Base und Best rechnen mit den
 * 70 %, WORST mit null. Wer die Erstattung als sicher einplant, hat einen
 * Zuschuss im Basisfall, dessen Ausfall er nirgends sieht.
 */
import { describe, it, expect } from "vitest";
import {
  SEED, versicherungPerHaCent, versicherungssummePerHaCent, resolveScalar,
  buildModelState, setScenarioConst, type Domain,
} from "../../store/model";
import { computeModel } from "../engine";

const SZ = SEED.baseScenarioId;
const klon = (d: Domain): Domain => JSON.parse(JSON.stringify(d));
const VERSICHERT = ["kartoffel_pommes", "kartoffel_chips", "tomate", "zwiebel_moehre",
  "suesskartoffel", "knoblauch", "knollensellerie"];

describe("Die Prämie folgt der Versicherungssumme", () => {
  it("versichert jede Wertkultur des Katalogs", () => {
    for (const c of VERSICHERT) {
      expect(SEED.assumptions[`ins.rate.${c}`], c).toBeTruthy();
      expect(versicherungPerHaCent(SEED, c, SZ), c).toBeGreaterThan(0);
    }
  });

  it("rechnet Summe × Satz × (1 − Zuschuss), auf den Cent", () => {
    const zuschuss = resolveScalar(SEED, "ins.subsidy", SZ);
    for (const c of VERSICHERT) {
      const summe = versicherungssummePerHaCent(SEED, c, SZ);
      const satz = resolveScalar(SEED, `ins.rate.${c}`, SZ);
      expect(versicherungPerHaCent(SEED, c, SZ), c).toBe(Math.round(summe * satz * (1 - zuschuss)));
    }
  });

  it("nimmt die NETTO-Ernte als Versicherungssumme, nicht die Feldernte", () => {
    /* Versichert ist, was vermarktet wird — und es ist DIESELBE Menge, mit der
     *  auch der Umsatz rechnet. Zwei Mengenbegriffe für dieselbe Ernte wären
     *  genau die stille Differenz, die dieses Modell an anderen Stellen teuer
     *  gelernt hat. Probe: den Ernteverlust verdoppeln senkt die Summe. */
    const c = "kartoffel_pommes";
    const d = klon(SEED);
    const verlust = resolveScalar(d, `loss.${c}`, SZ);
    expect(verlust).toBeGreaterThan(0);
    const vorher = versicherungssummePerHaCent(d, c, SZ);
    setScenarioConst(d, `loss.${c}`, SZ, verlust * 2);
    expect(versicherungssummePerHaCent(d, c, SZ)).toBeLessThan(vorher);
  });

  it("steigt mit dem Ertrag und mit dem Preis — das ist der ganze Punkt", () => {
    /* DIE EIGENSCHAFT, DERENTWEGEN ES EIN PROZENTSATZ IST. Eine €/ha-Pauschale
     *  bliebe hier stehen und würde behaupten, eine um die Hälfte wertvollere
     *  Ernte koste dieselbe Prämie. */
    const c = "tomate";
    const basis = versicherungPerHaCent(SEED, c, SZ);
    const mehrErtrag = klon(SEED);
    setScenarioConst(mehrErtrag, `yield.${c}`, SZ, resolveScalar(SEED, `yield.${c}`, SZ) * 1.5);
    expect(versicherungPerHaCent(mehrErtrag, c, SZ)).toBeCloseTo(basis * 1.5, -1);

    const mehrPreis = klon(SEED);
    setScenarioConst(mehrPreis, `price.${c}`, SZ, resolveScalar(SEED, `price.${c}`, SZ) * 2);
    expect(versicherungPerHaCent(mehrPreis, c, SZ)).toBeCloseTo(basis * 2, -1);
  });

  it("versichert die Zwischenfrucht und die Trockenrotation NICHT", () => {
    /* Kein Vergessen, sondern zwei verschiedene Gründe: die Zwischenfrucht wird
     *  eingearbeitet und hat keinen Erntewert, die Trockenrotation ist der
     *  bewusst unversicherte Teil des Betriebs — dort trägt der Betrieb das
     *  Witterungsrisiko selbst, weil es der billigere Weg ist als eine
     *  Dürrepolice auf einen unberegneten Hektar. */
    for (const c of ["zwischenfrucht", "weizen_dry", "gerste_dry", "raps_dry", "sonnenblume"]) {
      expect(versicherungPerHaCent(SEED, c, SZ), c).toBe(0);
    }
  });
});

describe("Der Zuschuss ist eine Annahme, kein Automatismus", () => {
  it("halbiert die Belastung nicht heimlich — 70 % stehen als Zahl da", () => {
    expect(resolveScalar(SEED, "ins.subsidy", SZ)).toBeCloseTo(0.70, 3);
  });

  it("lässt den Betrieb im Worst Case die volle Prämie tragen", () => {
    /* DAS EIGENTLICHE RISIKO DIESER POSITION ist nicht der Prämiensatz, sondern
     *  der Antrag: geschlossenes Fenster, ausgeschöpfte Zuweisung, Formfehler.
     *  Deshalb steht im Worst Case null. Der Test prüft, dass das Band
     *  tatsächlich trägt — eine Annahme mit gleichem Wert in allen drei
     *  Szenarien wäre ein Band ohne Aussage. */
    const worst = SEED.scenarios.find((s) => s.id === "sc-worst")!;
    expect(resolveScalar(SEED, "ins.subsidy", worst.id)).toBe(0);
    for (const c of VERSICHERT) {
      // Ohne Zuschuss ist die Prämie mehr als das Doppelte (1 gegen 0,3).
      const ohne = versicherungssummePerHaCent(SEED, c, SZ) * resolveScalar(SEED, `ins.rate.${c}`, SZ);
      expect(ohne / versicherungPerHaCent(SEED, c, SZ), c).toBeGreaterThan(3);
    }
  });
});

describe("Die Position kommt in der Rechnung an", () => {
  it("steht als eigene Kostenart in der GuV, nicht unter Sonstiges", () => {
    /* Eine eigene Kostenart und keine „other"-Zeile: sonst verschwindet die
     *  Versicherung zwischen Kisten, Netzen und Beregnungswasser, und niemand
     *  könnte fragen, ob sie zu teuer ist. */
    const st = buildModelState(SEED, SZ);
    const ops = st.cropPlans.flatMap((p) => p.operations ?? []);
    const versLines = ops.flatMap((o) => o.lines).filter((l) => l.costType === "insurance");
    expect(versLines.length).toBeGreaterThan(0);
    expect(versLines.every((l) => l.quantityPerHa > 0)).toBe(true);
  });

  it("kostet Ergebnis, ohne den Umsatz anzufassen", () => {
    /* DIE PRÜFSIGNATUR, dieselbe wie bei jeder anderen Kostenänderung dieses
     *  Tages: eine Versicherungsprämie darf den Erlös nicht bewegen. Wenn doch,
     *  ist sie irgendwo als Ertrag verbucht. */
    const ohne = klon(SEED);
    for (const c of VERSICHERT) setScenarioConst(ohne, `ins.rate.${c}`, SZ, 0);
    const sum = (m: ReturnType<typeof computeModel>, k: string) =>
      ((m.pnl as unknown as Record<string, { values: number[] }>)[k]?.values ?? [])
        .reduce((a, b) => a + b, 0);
    const mit = computeModel(buildModelState(SEED, SZ), SZ);
    const nix = computeModel(buildModelState(ohne, SZ), SZ);
    expect(sum(mit, "revenue")).toBeCloseTo(sum(nix, "revenue"), 0);
    expect(sum(mit, "ebitda")).toBeLessThan(sum(nix, "ebitda"));
  });
});
