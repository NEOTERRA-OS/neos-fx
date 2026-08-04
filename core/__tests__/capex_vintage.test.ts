/**
 * CAPEX-Jahrgänge: die letzte der drei Positions-IDs.
 *
 * Die ID hieß `cx-roder_ropa-c5-4-217`. Das letzte Segment war `capexMY.length`
 * — die Länge des Zielarrays im Moment des Einfügens. Sie stand dort aus einem
 * echten Grund: ohne sie kollidieren zwei Ketten, sobald ein Ausbau-Jahrgang in
 * genau dem Jahr beginnt, in dem eine Basiskohorte ihren Ersatz kauft. Nur löst
 * ein Zähler das an der falschen Stelle. Er beschreibt nicht die Anlage, sondern
 * die Reihenfolge, in der sie zufällig entstanden ist.
 *
 * Anders als bei den Maßnahmen-IDs hängt hier eine Zahl in der Bilanz daran.
 * Deshalb prüft diese Datei beides: dass die IDs stabil sind UND dass sich am
 * CAPEX nichts geändert hat.
 */
import { describe, it, expect } from "vitest";
import { SEED, buildModelState, setMachineOutsourced, deriveCropAreasMY, START_YEAR, type Domain } from "../../store/model";
import { capexVintageId, parseCapexId, capexBasisId, machineIdOfCapex, istAlteCapexId } from "../../store/capexId";

const SZENARIEN = SEED.scenarios.map((s) => s.id);
const klon = (d: Domain): Domain => JSON.parse(JSON.stringify(d));
const capexOf = (d: Domain, sc: string) => buildModelState(d, sc).capex;

describe("CAPEX-Jahrgänge · IDs", () => {
  it.each(SZENARIEN)("vergibt in %s jede ID genau einmal", (sc) => {
    const ids = capexOf(SEED, sc).map((c) => c.id);
    const doppelt = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    expect(doppelt).toEqual([]);
  });

  it("trägt keine Altform mehr", () => {
    for (const c of capexOf(SEED, SEED.baseScenarioId)) {
      expect(istAlteCapexId(c.id), c.id).toBe(false);
    }
  });

  it("nennt Jahrgang, Kohorte und Glied — und keinen Zähler", () => {
    const maschinen = capexOf(SEED, SEED.baseScenarioId)
      .filter((c) => c.assetClass === "machinery")
      /* Detail-CAPEX-Positionen (`cx-plan-…`) tragen BEWUSST keinen Jahrgang.
       *  Ihr Anschaffungsjahr ist ein editierbares Feld — steckte es in der ID,
       *  hinge die Identität wieder an etwas, das sich ändert. Eine Planzeile ist
       *  ein Einzelstück und keine Kette. */
      .filter((c) => !c.id.startsWith("cx-plan-"));
    expect(maschinen.length).toBeGreaterThan(50);
    for (const c of maschinen) {
      const p = parseCapexId(c.id);
      expect(p.basisId.startsWith("cx-"), c.id).toBe(true);
      // Der Jahrgang ist das Kalenderjahr des KETTENURSPRUNGS, nicht der Kaufmonat
      //  des einzelnen Glieds — sonst hätte jeder Ersatzkauf eine neue Identität.
      expect(p.jahr, c.id).toBeGreaterThanOrEqual(2027);
      expect(p.jahr, c.id).toBeLessThan(2027 + 40);
      expect(p.glied, c.id).not.toBeUndefined();
    }
  });

  it("bleibt beim Zerlegen bei der Anlage stehen", () => {
    expect(capexBasisId("cx-roder_ropa.J2029.K2.G1")).toBe("cx-roder_ropa");
    expect(machineIdOfCapex("cx-roder_ropa.J2029.K2.G1")).toBe("roder_ropa");
    // Maschinen-IDs mit Ziffern am Ende dürfen dabei nicht angeschnitten werden.
    expect(machineIdOfCapex("cx-spritze14.J2027.K0.G0")).toBe("spritze14");
    expect(machineIdOfCapex("cx-store")).toBe("store");
  });

  it("setzt weggelassene Segmente nicht als Null ein", () => {
    expect(capexVintageId("cx-irrig", 2031)).toBe("cx-irrig.J2031");
    expect(capexVintageId("cx-soil", 2031, undefined, 2)).toBe("cx-soil.J2031.G2");
    expect(parseCapexId("cx-irrig.J2031").kohorte).toBeUndefined();
  });

  /* DER EIGENTLICHE TEST. Vorher verschob jede zusätzliche Position im Array die
   *  IDs aller danach erzeugten — auch die von Anlagen, die damit nichts zu tun haben. */
  it("hält alle IDs, wenn eine Anlage VOR den anderen dazukommt", () => {
    const vorher = capexOf(SEED, SEED.baseScenarioId).map((c) => c.id);
    const d = klon(SEED);
    /* Eine zusätzliche Detail-CAPEX-Position ganz vorne — sie landet im selben
     *  Array und hätte früher jeden folgenden Zähler um eins verschoben. */
    d.capexPlanActive = { ...(d.capexPlanActive ?? {}), gebaeude: true };
    d.capexPlan = [
      { id: "zz-test", block: "gebaeude", bezeichnung: "Testposition", anlagenklasse: "elektronik",
        driver: "fix", menge: 1, einheit: "pauschal", eurProEinheitCent: 100_000, afaYears: 5,
        restwertPct: 0, jahr: 1, fkQuote: 0, zins: 0, laufzeitJahre: 5, subventionPct: 0, bestand: false },
      ...(d.capexPlan ?? []),
    ];
    const nachher = capexOf(d, SEED.baseScenarioId).map((c) => c.id);
    for (const id of vorher) expect(nachher, id).toContain(id);
    expect(nachher).toContain("cx-plan-zz-test");
  });

  it("hält die IDs einer Maschine, wenn eine ANDERE fremdvergeben wird", () => {
    const betroffen = (ids: string[]) => ids.filter((i) => i.startsWith("cx-roder_ropa."));
    const vorher = betroffen(capexOf(SEED, SEED.baseScenarioId).map((c) => c.id));
    expect(vorher.length).toBeGreaterThan(0);
    const d = klon(SEED);
    // Mähdrusch fremdvergeben: eine ganze Vintage-Kette fällt weg.
    setMachineOutsourced(d, "maehdr", true);
    const nachher = betroffen(capexOf(d, SEED.baseScenarioId).map((c) => c.id));
    expect(nachher).toEqual(vorher);
  });
});

describe("CAPEX-Jahrgänge · die Rechnung bleibt stehen", () => {
  it.each(SZENARIEN)("bucht in %s denselben CAPEX je Jahr wie vor der Umstellung", (sc) => {
    /* Szenario-weise Summe und Positionszahl. Eine ID-Änderung, die den CAPEX
     *  bewegt, ist keine ID-Änderung — sie ist ein Fehler, und genau den soll
     *  dieser Test finden.
     *
     *  NEU GESETZT AM 04.08.2026 mit Verfahren C (Entscheidung 02.08.2026). Der
     *  alte Stand war { n: 1198, sum: 5614784367 } für sc-base. Was sich bewegt
     *  hat und warum:
     *    · Dewulf CP 42 → Grimme PRIOS 440 PRO (80.000 → 145.000 € je Stück)
     *    · Frontfräse SC 360 entfällt vollständig — sie stand 1:1 zum Leger
     *    · JD 8RX 410 entfällt vollständig — er war nur von der Fräse erzwungen
     *    · Flächenleistung Legen 0,50 → 1,26 ha/h ⇒ deutlich weniger Leger
     *    · Kurzscheibenegge 6 m neu, Saatbettkombination auf 9 m korrigiert
     *  Summe über den Neunjahrespfad: 56,15 → 48,02 Mio €, also −8,13 Mio €.
     *  Das Entscheidungsdokument nennt −2,65 Mio bei 3.000 ha; es vergleicht
     *  Ausbaustufen, dieser Test den ganzen Pfad einschliesslich Ersatzkäufe. */
    const REF: Record<string, { n: number; sum: number }> = {
      "sc-base":  { n: 1138, sum: 4801675347 },
      "sc-best":  { n: 1138, sum: 4799597231 },
      "sc-worst": { n: 1138, sum: 4801816596 },
    };
    const capex = capexOf(SEED, sc);
    expect(capex.length).toBe(REF[sc].n);
    expect(capex.reduce((s, c) => s + c.amount, 0)).toBe(REF[sc].sum);
  });

  it("summiert die Kohorten einer Maschine auf ihren Katalogwert", () => {
    /* Die Kohortenaufteilung `amount / C` darf nichts verlieren. Geprüft an der
     *  Erstanschaffung (Glied 0) des Bedarfsjahres — die Ersatzkäufe kommen später
     *  und tragen die CAPEX-Inflation. */
    const capex = capexOf(SEED, SEED.baseScenarioId);
    const erst = capex.filter((c) => {
      const p = parseCapexId(c.id);
      return p.basisId === "cx-roder_ropa" && p.glied === 0;
    });
    expect(erst.length).toBeGreaterThan(1);           // mehrere Kohorten
    const jahre = new Set(erst.map((c) => parseCapexId(c.id).jahr));
    expect(jahre.size).toBeGreaterThanOrEqual(1);
    // Kohortennummern lückenlos ab 0 je Jahrgang.
    for (const j of jahre) {
      const ks = erst.filter((c) => parseCapexId(c.id).jahr === j)
        .map((c) => parseCapexId(c.id).kohorte!).sort((a, b) => a - b);
      expect(ks).toEqual(ks.map((_, i) => i));
    }
  });
});

describe("Bauzeitenplan Lager & Packhaus — Entscheidung 04.08.2026", () => {
  /* WARUM DAS EIN TEST IST UND KEIN KOMMENTAR. Die Bauabschnitte sind seit dem
   *  04.08.2026 in der Oberflaeche editierbar (Kostenstelle Lager & Packhaus).
   *  Das ist richtig so — aber es heisst auch, dass der Seed-Stand jederzeit
   *  unbemerkt wegdriften kann, und der Seed ist es, gegen den jeder neue
   *  Nutzer und jede Golden-Datei rechnet.
   *
   *  Die Staffelung ist keine Kosmetik: ohne sie faellt das gesamte Programm —
   *  rund 27 Mio EUR — in EINEM Jahr an, in dem der Betrieb 670 ha
   *  bewirtschaftet. Danach steht die Kasse sieben Jahre auf null und der
   *  Revolver ist durchgezogen. Wer den Plan aendert, aendert den
   *  Finanzierungsbedarf; das soll auffallen. */
  const jahrVon = (id: string) =>
    (SEED.capexPlan ?? []).find((p) => p.id === id)?.jahr;

  it("baut in der entschiedenen Reihenfolge, nicht alles auf einmal", () => {
    const PLAN: Record<string, number> = {
      "lg-shell": 2, "lg-bulk": 2,          // 2029 Huelle + Schuettlager
      "lg-cure": 4,                          // 2031 Curing
      "lg-cool": 5,                          // 2032 Kuehl-/CA-Lager
      "pk-line": 6, "pk-optic": 6, "pk-wash": 6,   // 2033 Packhaus Kern
      "pk-pal": 7, "pk-onion": 7,            // 2034 Palettierung + Zwiebellinie
    };
    for (const [id, jahr] of Object.entries(PLAN)) {
      expect(jahrVon(id), `${id} (${START_YEAR + jahr})`).toBe(jahr);
    }
  });

  it("verteilt das Programm auf mindestens vier Planjahre", () => {
    /* Die EIGENSCHAFT hinter der Entscheidung, unabhaengig von den konkreten
     *  Jahren: wenn jemand den Plan umbaut, darf er nicht wieder in einem Jahr
     *  zusammenfallen. */
    const jahre = new Set((SEED.capexPlan ?? [])
      .filter((p) => p.block === "lager" || p.block === "packhaus")
      .map((p) => p.jahr));
    expect(jahre.size).toBeGreaterThanOrEqual(4);
  });

  it("baut das Lager NICHT vor dem ersten nennenswerten Kartoffeljahr", () => {
    /* Ein Lager, das vor der Ware steht, ist Leerstand mit AfA. Geprueft wird
     *  gegen den Anbauplan, nicht gegen eine Jahreszahl — so bleibt der Test
     *  richtig, wenn der Hochlauf sich verschiebt. */
    const erstesLagerjahr = Math.min(...(SEED.capexPlan ?? [])
      .filter((p) => p.block === "lager").map((p) => p.jahr));
    const flaechen = deriveCropAreasMY(SEED).areas;
    const kartoffelHa = (jahr: number) => Object.keys(flaechen)
      .filter((c) => c.startsWith("kartoffel"))
      .reduce((s, c) => s + (flaechen[c][jahr] ?? 0), 0);
    expect(kartoffelHa(erstesLagerjahr)).toBeGreaterThan(300);
  });
});
