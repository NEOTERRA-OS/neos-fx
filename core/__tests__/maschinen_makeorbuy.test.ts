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

/* NETTO-EINKAUF — dieselbe Rechnung wie im Modell (Entscheidung 04.08.2026).
 *  Der Rabatt kommt aus dem realen Angebot, wo es eins gibt, sonst aus
 *  `tco.discount`. Der Restwert bleibt ein Prozentsatz der LISTE: er bemisst
 *  sich am Neuwert der Klasse, nicht am ausgehandelten Preis. */
const netto = (d: Domain, m: { unitPriceKey?: string; discountPct?: number }) => {
  const liste = resolveScalar(d, m.unitPriceKey!, SZ);
  const disc = m.discountPct ?? resolveScalar(d, "tco.discount", SZ) ?? 0;
  return liste * (1 - disc);
};
const restwert = (d: Domain, m: { unitPriceKey?: string; restwertPct?: number }) =>
  resolveScalar(d, m.unitPriceKey!, SZ) * (m.restwertPct ?? 0);

describe("Stundensätze · an den Preis gebunden", () => {
  it("rechnet die AfA je Stunde aus Preis, Restwert, Nutzungsdauer und Referenzstunden", () => {
    for (const m of SEED.machineCatalog) {
      if (!m.refHoursPerYear || !m.nutzungYears || !m.unitPriceKey) continue;
      const preis = resolveScalar(SEED, m.unitPriceKey, SZ);
      if (!preis) continue;
      /* NETTO-EINKAUF minus Restwert, verteilt auf Nutzungsdauer × Jahresstunden.
       *  Bis 04.08.2026 stand hier die LISTE — der Rabatt (20 bis 35 %) fiel
       *  unter den Tisch, obwohl CAPEX und Bilanz ihn längst rechneten. */
      const soll = Math.round(Math.max(0, netto(SEED, m) - restwert(SEED, m)) / (m.nutzungYears * m.refHoursPerYear));
      expect(machineRatesPerHour(SEED, m, SZ).afaCent, m.id).toBe(soll);
    }
  });

  it("hat keine handgesetzte Ausnahme mehr — Entscheidung 04.08.2026", () => {
    /* DIE ENTSCHEIDUNG, DIE DIESER TEST FESTHÄLT. Sieben der dreizehn
     *  Feldmaschinen trugen einen AfA-Satz, der nicht zu ihrem Preis passte:
     *
     *      Feldrand-Kipper 24 t     15,00 €/h  gegen Formel  5,00   +200 %
     *      Saatbettkombi 9 m        24,00              10,50        +129 %
     *      Grubber Fortis 6.4       18,00               9,00        +100 %
     *      Düngerstreuer K135       28,00              17,00         +65 %
     *      One-Pass (damals CP 42)  38,40              25,60         +50 %
     *      Pflanzmaschine C&M       64,00              56,00         +14 %
     *      Wurzelernter ROPA        53,33              60,00         −11 %
     *
     *  Rechnet man aus jedem alten Satz zurück, welche Jahresstundenzahl ihn
     *  erzeugt hätte, liegen SECHS unter der hinterlegten `refHoursPerYear` —
     *  beim Kipper 200 statt 600. Das sah nicht nach sieben Einzelirrtümern
     *  aus, sondern nach einer Flottenbemessung, die die Jahresstunden angehoben
     *  und die Sätze stehengelassen hat. NEOTERRA hat am 04.08.2026 bestätigt:
     *  die niedrigeren Formelwerte gelten, `refHoursPerYear` bleibt stehen.
     *
     *  Geprüft wird deshalb nicht „der Satz ist 5,00" — das täte der Test oben
     *  schon —, sondern dass es KEINEN Weg mehr gibt, an der Formel vorbei eine
     *  eigene Zahl zu setzen. Solange jede Maschine mit Preis, Nutzungsdauer
     *  und Referenzstunden die Formel trifft, kann die Lücke nicht wiederkommen. */
    const ohneFormel: string[] = [];
    for (const m of SEED.machineCatalog) {
      if (!m.refHoursPerYear || !m.nutzungYears || !m.unitPriceKey) continue;
      const preis = resolveScalar(SEED, m.unitPriceKey, SZ);
      if (!preis) continue;
      const soll = Math.round(Math.max(0, netto(SEED, m) - restwert(SEED, m)) / (m.nutzungYears * m.refHoursPerYear));
      const ist = machineRatesPerHour(SEED, m, SZ).afaCent;
      if (ist !== soll) ohneFormel.push(`${m.id}: ${ist} statt ${soll}`);
    }
    expect(ohneFormel).toEqual([]);
  });

  it("nimmt für Stundensatz und Bilanz DENSELBEN Rabatt", () => {
    /* DAS WAR DIE EIGENTLICHE INKONSISTENZ, und sie stand jahrelang als
     *  bewusste Entscheidung im Kommentar: CAPEX, AfA und Bilanz rechneten auf
     *  Liste × (1 − Rabatt), der Stundensatz auf die volle Liste. Begründet war
     *  das mit „kalkulatorisch geht es um die Wiederbeschaffung" — eine
     *  vertretbare Lehrmeinung, aber im selben Modell zwei Anschaffungswerte
     *  für dieselbe Maschine. Bei den realen JD-Angeboten (24,9 bis 35,0 %
     *  Rabatt) kostete derselbe Traktor in der Ergebnisrechnung 341 k€ und im
     *  Stundensatz 524 k€.
     *
     *  NEOTERRA hat am 04.08.2026 entschieden: netto, auch die Maschinenstunden.
     *  Geprüft wird die Kopplung — nicht ein Rabattsatz, sondern dass beide
     *  Seiten aus derselben Quelle lesen. Ein maschinenspezifischer Rabatt aus
     *  einem echten Angebot schlägt dabei den globalen Default, und zwar hier
     *  wie dort. */
    const d = klon(SEED);
    const m = maschine(d, "roder_ropa");
    const vorher = machineRatesPerHour(d, m, SZ).afaCent;
    // Rabatt von 20 auf 40 % → der Netto-Einkauf halbiert sich beinahe, die AfA folgt.
    setScenarioConst(d, "tco.discount", SZ, 0.4);
    const nachher = machineRatesPerHour(d, maschine(d, "roder_ropa"), SZ).afaCent;
    expect(nachher).toBeLessThan(vorher);
    // Und der maschinenspezifische Rabatt schlägt den globalen — wie in deriveCapex.
    const eigen = klon(d);
    maschine(eigen, "roder_ropa").discountPct = 0;
    expect(machineRatesPerHour(eigen, maschine(eigen, "roder_ropa"), SZ).afaCent).toBeGreaterThan(nachher);
  });

  it("lässt Versicherung, Reparatur und Schmierstoff AM NEUWERT — die eine Ausnahme", () => {
    /* Eine Kaskoprämie richtet sich nach dem Wiederbeschaffungswert des
     *  Gerätes, und ein Getriebeschaden kostet dasselbe, ob beim Kauf 20 % oder
     *  35 % Rabatt herausgehandelt wurden. Diese drei Sätze am Rabatt zu senken
     *  hieße zu behaupten, gut verhandelte Maschinen gingen seltener kaputt.
     *
     *  Der Test hält die Ausnahme fest, damit sie eine ENTSCHEIDUNG bleibt und
     *  nicht als Flüchtigkeitsfehler gelesen wird: ändert man den Rabatt, darf
     *  sich der Betriebskostenteil des Stundensatzes NICHT bewegen. */
    const d = klon(SEED);
    const vorher = machineRatesPerHour(d, maschine(d, "roder_ropa"), SZ);
    setScenarioConst(d, "tco.discount", SZ, 0.4);
    const nachher = machineRatesPerHour(d, maschine(d, "roder_ropa"), SZ);
    expect(nachher.versCent).toBe(vorher.versCent);
    expect(nachher.repCent).toBe(vorher.repCent);
    expect(nachher.lubeCent).toBe(vorher.lubeCent);
    // Der Kapitalteil bewegt sich dagegen sehr wohl — sonst wäre nichts umgestellt.
    expect(nachher.afaCent).toBeLessThan(vorher.afaCent);
    expect(nachher.zinsCent).toBeLessThan(vorher.zinsCent);
  });

  it("hält den Zug JD 8R 410 — bestätigt am 04.08.2026 gegen die 340-PS-Klasse", () => {
    /* Der auslegende Arbeitsgang ist der Grubber HORSCH Fortis 6.4 LT auf 30 cm
     *  im schweren Süd-Dolj-Boden; HORSCH gibt für ihn bis 435 PS an. Geprüft
     *  wird das, was das Modell davon weiß: der Zug hängt an diesem Gerät, und
     *  sein Listenpreis steht auf dem realen JD-Angebot vom 23.07.2026
     *  (523.813 €). Wer die Klasse tauscht, ändert diesen Preis — und dann
     *  gehört die Zuordnung neu begründet. */
    expect(resolveScalar(SEED, "mprice.zug_9r", SZ)).toBe(52381300);
    const grubber = maschine(SEED, "pflug");
    expect(grubber.tractorId).toBe("zug_9r");
    expect(SEED.machineCatalog.some((m) => m.id === "zug_8rx")).toBe(false);  // Verfahren C
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
    /* Zins auf das DURCHSCHNITTLICH gebundene Kapital: der Buchwert sinkt vom
     *  NETTO-Einkauf auf den Restwert, im Mittel also (netto + restwert) / 2.
     *  Zinsen auf einen Rabatt zahlt niemand. */
    const soll = Math.round((((netto(SEED, m) + restwert(SEED, m)) / 2) * i) / m.refHoursPerYear!);
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
    /* Die Schwelle war eine absolute Zahl (16,2 Mio) und hat deshalb bei JEDER
     *  fremden Änderung angeschlagen — zuletzt bei der produktscharfen Düngung,
     *  die mit dem Roder nichts zu tun hat. Ein Test, der aus fremdem Grund rot
     *  wird, wird irgendwann ignoriert.
     *
     *  Geprüft wird jetzt die AUSSAGE statt der Zahl: die Behebung der doppelten
     *  Buchung muss das Ergebnis um mindestens 200 k€/a heben (der doppelt
     *  gebuchte Betrag lag bei rund 250 k€/a beim Roder), und Mieten muss trotzdem
     *  teurer bleiben als Kaufen. Beides gilt unabhängig vom Niveau. */
    const d = klon(SEED);
    setMachineRented(d, GEMIETET, true);
    const z = letztesJahr(d);
    /* Die doppelte Buchung lag im Mietsatz: Versicherung, Reparatur und
     *  Schmierstoff liefen als COGS mit UND steckten in der Miete. Beim Roder
     *  waren das rund 250 k€/a. Geprüft wird der Abstand zum Kauf — er muss
     *  kleiner sein als vorher, aber grösser als null. */
    const abstand = letztesJahr(SEED).ebitda - z.ebitda;
    expect(abstand).toBeGreaterThan(0);                 // Mieten bleibt teurer
    expect(abstand / 1e6).toBeLessThan(2.0);            // aber nicht mehr doppelt
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
     *  ZWEITE BEWEGUNG AM SELBEN TAG: die produktscharfe Düngung aus dem
     *  Kompendium löst die Nährstoff-Mischpreise ab. Sie kostet mehr, weil der
     *  Mischpreis zu niedrig war — Pommes 743 → 1.676 €/ha, betriebsweit
     *  5,86 Mio € Düngung 2035. Auch hier: der Umsatz bleibt stehen.
     *
     *  DRITTE BEWEGUNG, 04.08.2026 nachmittags: die Pflanzgutmenge fällt auf
     *  den Kompendiumswert (Pommes 2,8 → 2,3 t/ha, Chips 3,0 → 2,5). Der
     *  Betrieb hat entschieden; das Kompendium führte die Zahl seit jeher als
     *  BELEGT. Weniger Pflanzgut heisst weniger Direktkosten — und wieder darf
     *  der Umsatz sich nicht rühren.
     *
     *  Ausgangsstand   16,75 EBITDA · 10,08 Ergebnis
     *  nach Verfahren C   17,01 · 10,98   (weniger Maschinen)
     *  nach Produktpreis  15,17 ·  9,43   (ehrlichere Düngung)
     *  VIERTE BEWEGUNG, ebenfalls 04.08.2026: die Beregnung folgt der NETTO-
     *  Norm des Kompendiums statt eigener Zahlen („alles muss netto kalkuliert
     *  sein"). FX lag darunter — bei der Süßkartoffel um 51 % —, also kostet
     *  die Umstellung. Und wieder: der Umsatz bleibt stehen.
     *
     *  Ausgangsstand   16,75 EBITDA · 10,08 Ergebnis
     *  nach Verfahren C   17,01 · 10,98   (weniger Maschinen)
     *  nach Produktpreis  15,17 ·  9,43   (ehrlichere Düngung)
     *  nach Pflanzgut     15,78 ·  9,95   (Kompendiumsmenge)
     *  nach Netto-Norm    15,66 ·  9,84   (Beregnung aus dem Kompendium)
     *  Umsatz durchgehend 46,44 Mio — in ALLEN fünf Ständen
     *
     *  DIE UMSTELLUNG DER STUNDENSÄTZE AUF NETTO-EINKAUF (04.08.2026, abends)
     *  bewegt diese Zeile NICHT, und das ist kein Zufall, sondern die
     *  Drei-Statement-Logik: Abschreibung und Zins einer Maschine stehen in der
     *  GuV genau EINMAL — über `deriveCapex` und die Finanzierung. Der
     *  Stundensatz verteilt dieselben Beträge auf Hektar, damit man sie je
     *  Kultur sieht; er darf sie nicht ein zweites Mal buchen. Die Umstellung
     *  wirkt deshalb auf die ANALYTIK — Maßnahmenkette €/ha, Deckungsbeitrag,
     *  kaufen ↔ mieten ↔ Lohn, Mietsatz — und nicht auf das Ergebnis. Wer sie
     *  im EBITDA sucht, hat die Buchung zweimal. */
    const z = letztesJahr(SEED);
    expect(Math.round(z.umsatz / 1e4)).toBe(4644);     // 46,44 Mio — UNVERÄNDERT
    expect(Math.round(z.ebitda / 1e4)).toBe(1566);     // 15,66 Mio
    expect(Math.round(z.ergebnis / 1e4)).toBe(984);    // 9,84 Mio
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

describe("Die Maschine heißt, was sie rechnet", () => {
  it("nennt in Beschriftung, Produktname und Kinematik dieselbe Arbeitsbreite", () => {
    /* DER FUND, DER DIESEN TEST AUSGELÖST HAT — im eigenen Screenshot-Review am
     *  04.08.2026, nicht gemeldet und nicht gesucht. Die Maßnahmenkette zeigte:
     *
     *      Saatbettbereitung
     *      × Saatbettkombination 9,0 m (passiv, …)
     *      12,0 m · 7,5 km/h · 80 % → 7,20 ha/h
     *
     *  Drei Zeilen übereinander, zwei verschiedene Breiten. Die Beschriftung
     *  sagte 9,0 m, gerechnet wurde mit 12,0 m, und der hinterlegte Produktname
     *  war ein Väderstad NZ Extreme 1250 — dessen Typnummer IST die Breite:
     *  12,5 m. Die Beschriftung war der Ausreißer und ist korrigiert.
     *
     *  Warum das mehr als Kosmetik ist: `cEff` — die Flächenleistung — treibt
     *  Stückzahl, CAPEX und Feldtage. Wer die Beschriftung liest und 9 m glaubt,
     *  hält 7,20 ha/h für eine hohe Leistung und die Flotte für knapp bemessen;
     *  wer 12,5 m rechnet, sieht dieselbe Zahl als normal an. Dieselbe Kennzahl,
     *  zwei entgegengesetzte Schlüsse — je nachdem, welche Zeile man glaubt.
     *
     *  Geprüft wird die ganze Klasse, nicht der Einzelfall: steht in
     *  Beschriftung oder Produktname eine Meterzahl, muss sie die der Kinematik
     *  sein. Wer eine Maschine tauscht und nur eine Stelle nachzieht, wird hier
     *  rot — und das ist genau der Moment, in dem es auffallen soll. */
    const breiten = (t: string) =>
      [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*m\b/g)].map((m) => parseFloat(m[1].replace(",", ".")));
    const streit: string[] = [];
    for (const m of SEED.machineCatalog) {
      if (!m.widthM) continue;
      for (const [feld, text] of [["Beschriftung", m.label], ["Produktname", m.productName ?? ""]]) {
        const gefunden = breiten(text);
        if (gefunden.length && !gefunden.some((b) => Math.abs(b - m.widthM!) < 0.05)) {
          streit.push(`${m.id} ${feld}: ${gefunden.join("/")} m gegen Kinematik ${m.widthM} m`);
        }
      }
    }
    expect(streit).toEqual([]);
  });

  it("hält Breite, Geschwindigkeit, Feldeffizienz und Flächenleistung zusammen", () => {
    /* cEff = Breite × Geschwindigkeit × Feldeffizienz ÷ 10. Die Oberfläche
     *  zeigt alle vier Zahlen nebeneinander — dann müssen sie auch aufgehen,
     *  sonst rechnet der Leser mit und findet einen Fehler, der keiner ist. */
    for (const m of SEED.machineCatalog) {
      if (!m.widthM || !m.speedKmh || !m.fieldEff || !m.cEff) continue;
      /* 0,5 % Toleranz statt zwei Nachkommastellen: einige cEff sind von Hand
       *  auf eine Stelle gerundet eingetragen (Spritze 24,1 gegen 24,111). Das
       *  ist Rundung, kein Widerspruch — bei mehr als einem halben Prozent
       *  stimmt dagegen eine der vier Zahlen nicht. */
      const gerechnet = (m.widthM * m.speedKmh * m.fieldEff) / 10;
      expect(Math.abs(gerechnet - m.cEff) / m.cEff, `${m.id}: ${gerechnet.toFixed(3)} gegen ${m.cEff}`).toBeLessThan(0.005);
    }
  });
});
