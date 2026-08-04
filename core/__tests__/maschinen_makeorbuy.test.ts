/**
 * Make-or-Buy: kaufen, mieten, im Lohn — und die Stundensätze dahinter.
 *
 * Zwei Befunde stehen hinter dieser Datei.
 *
 * ERSTENS war „mieten" strukturell zu teuer. `machineOpCostPerHaCent` prüfte für
 * den Fremd-Ausschluss nur die Lohnarbeit und nicht die Miete — Versicherung,
 * Reparatur und Schmierstoff wurden deshalb als COGS gebucht UND steckten
 * gleichzeitig im Mietsatz, der als `opex.machine_rent` läuft. Je nach Klasse
 * waren das 93 bis 250 k€/a, die zweimal in der Rechnung standen. Der
 * Maschinenpark empfiehlt auf Basis dieser Zahlen einen Weg; eine Entscheidung
 * auf doppelt gezählten Kosten ist schlimmer als keine, weil sie geprüft aussieht.
 *
 * ZWEITENS hingen die Stundensätze an nichts. Sie standen als feste Zahlen neben
 * dem Neupreis, und sechs von dreizehn Feldmaschinen trafen damit die Formel
 * exakt, sieben nicht — bis +200 %. Wer `mprice.*` ändert, bewegte CAPEX und
 * Bilanz-AfA, aber nicht den Vergleich, auf dem die Entscheidung beruht.
 */
import { describe, it, expect } from "vitest";
import {
  SEED, buildModelState, machineRatesPerHour, machineRentPerHourCent, mietAnteilOf,
  machineOpCostPerHaCent, setMachineRented, setMachineOutsourced, setScenarioConst, deriveMaschinenpark,
  resolveScalar, type Domain,
} from "../../store/model";
import { computeModel } from "../engine";
import { jahreskennzahlen } from "./kennzahlen";

const SZ = SEED.baseScenarioId;
const klon = (d: Domain): Domain => JSON.parse(JSON.stringify(d));
const letztesJahr = (d: Domain) => {
  const z = jahreskennzahlen(computeModel(buildModelState(d, SZ), SZ));
  return z[z.length - 1];
};
const maschine = (d: Domain, id: string) => d.machineCatalog.find((m) => m.id === id)!;

describe("Stundensätze · an den Preis gebunden", () => {
  it("rechnet die AfA je Stunde aus Preis, Restwert, Nutzungsdauer und Referenzstunden", () => {
    for (const m of SEED.machineCatalog) {
      if (!m.refHoursPerYear || !m.nutzungYears || !m.unitPriceKey) continue;
      const preis = resolveScalar(SEED, m.unitPriceKey, SZ);
      if (!preis) continue;
      const soll = Math.round((preis * (1 - (m.restwertPct ?? 0))) / (m.nutzungYears * m.refHoursPerYear));
      expect(machineRatesPerHour(SEED, m, SZ).afaCent, m.id).toBe(soll);
    }
  });

  /* DER EIGENTLICHE TEST: der Listenpreis ist editierbar, also müssen die Sätze mit. */
  it("zieht alle fünf Sätze mit, wenn der Listenpreis steigt", () => {
    const m = maschine(SEED, "roder_ropa");
    const vorher = machineRatesPerHour(SEED, m, SZ);
    const d = klon(SEED);
    const alt = resolveScalar(SEED, m.unitPriceKey!, SZ);
    setScenarioConst(d, m.unitPriceKey!, SZ, Math.round(alt * 1.2));
    const nachher = machineRatesPerHour(d, maschine(d, "roder_ropa"), SZ);
    for (const k of ["afaCent", "zinsCent", "versCent", "repCent", "lubeCent"] as const) {
      expect(nachher[k] / vorher[k], k).toBeCloseTo(1.2, 2);
    }
    // Und der Mietsatz, der darauf aufsetzt, ebenfalls.
    expect(machineRentPerHourCent(d, maschine(d, "roder_ropa"), SZ)
      / machineRentPerHourCent(SEED, m, SZ)).toBeCloseTo(1.2, 2);
  });

  it("hält Versicherung, Reparatur und Schmierstoff bei unverändertem Preis exakt fest", () => {
    /* Die Prozentsätze sind aus dem Seed abgeleitet — bei gleichem Preis muss
     *  derselbe Cent-Betrag herauskommen, sonst hätte die Umstellung den Base
     *  Case bewegt, ohne dass jemand eine Entscheidung getroffen hätte. */
    for (const m of SEED.machineCatalog) {
      if (!m.refHoursPerYear || !m.unitPriceKey || !resolveScalar(SEED, m.unitPriceKey, SZ)) continue;
      const r = machineRatesPerHour(SEED, m, SZ);
      expect(r.versCent, `${m.id} Vers`).toBe(m.insurancePerHourCent ?? 0);
      expect(r.repCent, `${m.id} Rep`).toBe(m.repairPerHourCent ?? 0);
      expect(r.lubeCent, `${m.id} Schmier`).toBe(m.lubePerHourCent ?? 0);
    }
  });

  it("folgt dem kalkulatorischen Zinssatz statt einer Faustregel", () => {
    const m = maschine(SEED, "roder_ropa");
    const i = resolveScalar(SEED, "tco.calc_interest", SZ);
    expect(i).toBeGreaterThan(0);
    const soll = Math.round(
      (resolveScalar(SEED, m.unitPriceKey!, SZ) * (1 + (m.restwertPct ?? 0)) / 2 * i) / m.refHoursPerYear!);
    expect(machineRatesPerHour(SEED, m, SZ).zinsCent).toBe(soll);
    const d = klon(SEED);
    setScenarioConst(d, "tco.calc_interest", SZ, i * 2);
    expect(machineRatesPerHour(d, maschine(d, "roder_ropa"), SZ).zinsCent).toBe(soll * 2);
  });
});

describe("Make-or-Buy · mieten", () => {
  const GEMIETET = "roder_ropa";

  it("nimmt die Maschine aus dem CAPEX", () => {
    const d = klon(SEED);
    setMachineRented(d, GEMIETET, true);
    const vorher = buildModelState(SEED, SZ).capex.filter((c) => c.id.startsWith(`cx-${GEMIETET}.`));
    const nachher = buildModelState(d, SZ).capex.filter((c) => c.id.startsWith(`cx-${GEMIETET}.`));
    expect(vorher.reduce((s, c) => s + c.amount, 0)).toBeGreaterThan(0);
    expect(nachher.reduce((s, c) => s + c.amount, 0)).toBe(0);
    expect(mietAnteilOf(d, GEMIETET, SZ)).toBe(1);
  });

  /* DER EIGENTLICHE TEST: Versicherung, Reparatur und Schmierstoff dürfen NICHT
   *  mehr als COGS erscheinen — sie stecken im Mietsatz. */
  it("bucht Versicherung, Reparatur und Schmierstoff nicht zweimal", () => {
    const d = klon(SEED);
    setMachineRented(d, GEMIETET, true);
    const m = maschine(SEED, GEMIETET);
    const r = machineRatesPerHour(SEED, m, SZ);
    for (const cropId of Object.keys(SEED.arbeitsgaenge)) {
      const g = (SEED.arbeitsgaenge[cropId] ?? []).find((x) => x.m === GEMIETET);
      if (!g || !m.cEff) continue;
      const vorher = machineOpCostPerHaCent(SEED, cropId, SZ, 0);
      const nachher = machineOpCostPerHaCent(d, cropId, SZ, 0);
      const entfallen = (g.passes / m.cEff) * (r.versCent + r.repCent + r.lubeCent);
      expect(vorher - nachher, cropId).toBeCloseTo(entfallen, 4);
    }
  });

  it("lässt den Diesel beim Betrieb — gemietet wird die Maschine, nicht die Arbeit", () => {
    const d = klon(SEED);
    setMachineRented(d, GEMIETET, true);
    const m = maschine(SEED, GEMIETET);
    expect(m.dieselLPerHour ?? 0).toBeGreaterThan(0);
    const cropId = Object.keys(SEED.arbeitsgaenge).find((c) =>
      (SEED.arbeitsgaenge[c] ?? []).some((g) => g.m === GEMIETET))!;
    const g = SEED.arbeitsgaenge[cropId].find((x) => x.m === GEMIETET)!;
    const diesel = (g.passes / m.cEff!) * (m.dieselLPerHour ?? 0) * resolveScalar(SEED, "price.diesel_l", SZ);
    expect(machineOpCostPerHaCent(d, cropId, SZ, 0)).toBeGreaterThanOrEqual(diesel - 1);
  });

  it("verbessert das Ergebnis gegenüber der doppelt gezählten Fassung", () => {
    /* Referenz aus dem Stand VOR der Behebung (ca997fe + cc4a122): EBITDA 2035
     *  16,08 Mio bei gemietetem Roder. Der Betrag, der zweimal in der Rechnung
     *  stand, lag bei rund 250 k€/a. */
    const d = klon(SEED);
    setMachineRented(d, GEMIETET, true);
    const z = letztesJahr(d);
    expect(z.ebitda / 1e6).toBeGreaterThan(16.2);
    // Und Mieten bleibt trotzdem teurer als Kaufen — die Behebung dreht das
    //  Vorzeichen nicht um, sie nimmt nur die doppelte Buchung heraus.
    expect(z.ebitda).toBeLessThan(letztesJahr(SEED).ebitda);
  });
});

describe("Make-or-Buy · im Lohn", () => {
  const LOHN = "roder_ropa";

  it("nimmt CAPEX und eigene Betriebskosten heraus", () => {
    const d = klon(SEED);
    setMachineOutsourced(d, LOHN, true);
    const capex = buildModelState(d, SZ).capex.filter((c) => c.id.startsWith(`cx-${LOHN}.`));
    expect(capex.reduce((s, c) => s + c.amount, 0)).toBe(0);
  });

  it("bleibt gegenüber dem Kauf eine echte Entscheidung — die Zahlen bewegen sich", () => {
    const d = klon(SEED);
    setMachineOutsourced(d, LOHN, true);
    expect(letztesJahr(d).ebitda).not.toBe(letztesJahr(SEED).ebitda);
  });
});

describe("Base Case", () => {
  it("steht auf dem Stand von Verfahren C", () => {
    /* Die Umstellung der STUNDENSÄTZE (9e3cb3b) war bewusst so gebaut, dass sie
     *  den Base Case nicht bewegt — dieser Test hat das festgehalten: 16,75 Mio
     *  EBITDA, 10,08 Mio Ergebnis.
     *
     *  AM 04.08.2026 BEWEGT SIE SICH, und zwar absichtlich. Verfahren C
     *  (Entscheidung 02.08.2026) tauscht die Legetechnik, streicht Frontfräse
     *  und 8RX-Schlepper und korrigiert die Flächenleistung beim Legen von 0,50
     *  auf 1,26 ha/h. Weniger Maschinen heissen weniger AfA, weniger Zins,
     *  weniger Diesel — EBITDA und Ergebnis steigen, ohne dass am Umsatz etwas
     *  geändert wurde. Genau diese Signatur macht die Änderung überprüfbar:
     *  der UMSATZ muss stehenbleiben.
     *
     *  vorher   16,75 EBITDA · 10,08 Ergebnis
     *  nachher  17,01 EBITDA · 10,98 Ergebnis   (Umsatz beide Male 46,44 Mio) */
    const z = letztesJahr(SEED);
    expect(Math.round(z.umsatz / 1e4)).toBe(4644);     // 46,44 Mio — UNVERÄNDERT
    expect(Math.round(z.ebitda / 1e4)).toBe(1701);     // 17,01 Mio
    expect(Math.round(z.ergebnis / 1e4)).toBe(1098);   // 10,98 Mio
    /* Die KASSE steht hier bewusst NICHT: sie haengt am Zeitpunkt jeder Zahlung und
     *  bewegt sich damit bei jeder Aenderung an der Saisonalitaet, ohne dass an den
     *  Stundensaetzen etwas falsch waere. Wer sie hier festnagelt, bekommt einen Test,
     *  der bei fremden Aenderungen rot wird und deshalb irgendwann ignoriert wird.
     *  Fuer die Kasse sind die Golden Files zustaendig. */
  });
});

describe("Kein Knopf ohne Wirkung", () => {
  it("meldet für jede Klasse, ob eine Lohnvergabe überhaupt bewertbar ist", () => {
    const park = deriveMaschinenpark(SEED, SZ, Math.max(1, SEED.growth?.years ?? 1));
    expect(park.length).toBeGreaterThan(0);
    for (const m of park) {
      const saetze = (SEED.lohnarbeit ?? []).filter((e) => e.machineId === m.machineId && m.crops.includes(e.cropId));
      expect(m.lohnMoeglich, m.machineId).toBe(!m.istZug && saetze.length > 0);
      /* Und der gemeldete Zustand muss halten: wo `lohnMoeglich` steht, muss ein
       *  Klick auf „Lohn" die Zahlen auch wirklich bewegen. */
      if (m.lohnMoeglich) {
        const d = klon(SEED);
        setMachineOutsourced(d, m.machineId, true);
        const park2 = deriveMaschinenpark(d, SZ, Math.max(1, SEED.growth?.years ?? 1));
        expect(park2.find((x) => x.machineId === m.machineId)!.beschaffung, m.machineId).toBe("lohn");
      }
    }
  });
});
