/**
 * ALLES NETTO — die Entscheidung vom 04.08.2026 als Prüfung, nicht als Vorsatz.
 *
 * „Netto" heißt im Modell an vier Stellen etwas anderes, und genau deshalb
 * braucht die Ansage eine Übersetzung in prüfbare Eigenschaften. Sonst nickt
 * jeder sie ab und keiner kann sagen, ob sie gilt.
 *
 *   MENGE     Erlöse rechnen mit der Netto-Ernte nach Lager- und
 *             Sortierverlust, nicht mit dem, was auf dem Feld gestanden hat.
 *   STEUER    Die Ergebnisrechnung ist umsatzsteuerfrei. Die USt läuft
 *             durch — sie bewegt Kasse und Bilanz, niemals das Ergebnis.
 *   ZUSCHUSS  CAPEX wird netto Zuschuss aktiviert, nicht brutto mit einem
 *             Ertrag daneben.
 *   WASSER    Die Beregnung rechnet mit Netto-Millimetern (was an der Pflanze
 *             ankommt), und der €-Satz trägt den Systemverlust.
 *
 * Die stärkste dieser Prüfungen ist die zweite, und sie ist es, weil sie eine
 * INVARIANTE ist: wer den Umsatzsteuersatz verdoppelt und dabei den
 * Jahresüberschuss bewegt, hat irgendwo eine Bruttogröße in die GuV gelassen.
 * Das findet kein Blick in den Quelltext, aber ein Rechenlauf.
 */
import { describe, it, expect } from "vitest";
import { SEED, buildModelState, resolveScalar, type Domain } from "../../store/model";
import { computeModel } from "../engine";

const SZ = SEED.baseScenarioId;
const klon = (d: Domain): Domain => JSON.parse(JSON.stringify(d));
const rechne = (d: Domain) => computeModel(buildModelState(d, SZ), SZ);
const summe = (v: number[]) => v.reduce((a, b) => a + b, 0);
const zeile = (d: Domain, k: string) =>
  summe(((rechne(d).pnl as unknown as Record<string, { values: number[] }>)[k]?.values) ?? []);

describe("MENGE — der Erlös rechnet mit der Netto-Ernte", () => {
  it("bewegt den Umsatz, wenn der Ernteverlust sich ändert", () => {
    /* Die Probe aufs Exempel: `loss.*` ist der Anteil, der zwischen Feld und
     *  Verkauf verschwindet. Rechnete der Umsatz mit der Bruttoernte, bliebe er
     *  hier stehen — und das Modell verspräche Erlöse für Ware, die nie einen
     *  Abnehmer erreicht. */
    const ohne = klon(SEED);
    for (const k of Object.keys(ohne.assumptions).filter((x) => x.startsWith("loss."))) {
      ohne.assumptions[k].scenarioProfiles[SZ] = { kind: "constant", value: 0 };
    }
    const mit = zeile(SEED, "revenue");
    const netto = zeile(ohne, "revenue");
    expect(netto).toBeGreaterThan(mit);
    // Der Verlust ist zweistellig prozentual — er darf nicht in der Rundung verschwinden.
    expect((netto - mit) / mit).toBeGreaterThan(0.05);
  });

  it("führt für jede Kultur des Katalogs einen Verlustsatz", () => {
    /* Eine Kultur ohne `loss.*` verkauft implizit die volle Feldernte. Das ist
     *  bei keiner Frucht richtig, die gelagert oder sortiert wird. */
    for (const e of SEED.catalog) {
      expect(SEED.assumptions[`loss.${e.cropId}`], e.cropId).toBeTruthy();
    }
  });
});

describe("STEUER — die Ergebnisrechnung ist umsatzsteuerfrei", () => {
  /* DIE INVARIANTE. Die USt ist ein durchlaufender Posten: der Betrieb zieht
   *  sie ein und führt sie ab. Sie verschiebt Zahlungszeitpunkte und steht als
   *  Forderung oder Verbindlichkeit in der Bilanz — sie ist aber weder Ertrag
   *  noch Aufwand. Wer den Satz verdoppelt und dabei das Ergebnis bewegt, hat
   *  eine Bruttogröße in der GuV. */
  const mitSatz = (satz: number) => {
    const d = klon(SEED);
    d.vat = { ...d.vat, standardRate: satz, reducedRate: satz / 2 };
    return d;
  };

  it("lässt Umsatz, EBITDA und Jahresüberschuss vom USt-Satz unberührt", () => {
    const basis = rechne(SEED).pnl as unknown as Record<string, { values: number[] }>;
    const doppelt = rechne(mitSatz(0.42)).pnl as unknown as Record<string, { values: number[] }>;
    for (const k of ["revenue", "cogs", "opex", "ebitda", "ebit"]) {
      expect(summe(doppelt[k].values), `${k} bewegt sich mit dem USt-Satz`)
        .toBeCloseTo(summe(basis[k].values), 0);
    }
  });

  it("bewegt dafür die Kasse — sonst wäre die USt gar nicht modelliert", () => {
    /* Der Gegenbeweis zur Invariante oben. Ein Test, der nur „ändert sich
     *  nicht" prüft, wäre auch dann grün, wenn die USt schlicht fehlte. */
    const kasse = (d: Domain) => {
      const cf = rechne(d).cashFlow as unknown as Record<string, { values: number[] }>;
      return summe(cf.vatCashFlow?.values ?? []);
    };
    expect(Math.abs(kasse(mitSatz(0.42)) - kasse(SEED))).toBeGreaterThan(0);
  });
});

describe("ZUSCHUSS — CAPEX wird netto aktiviert", () => {
  it("senkt die Abschreibung, wenn ein Zuschuss steigt", () => {
    /* Netto-Aktivierung heißt: der Zuschuss mindert die Anschaffungskosten,
     *  er steht nicht als Ertrag daneben. Der Unterschied ist nicht kosmetisch —
     *  brutto aktiviert schreibt der Betrieb über 22 Jahre Geld ab, das er nie
     *  ausgegeben hat, und weist im Zuschussjahr einen Ertrag aus, den es als
     *  Ergebnisbeitrag nicht gibt. */
    const d = klon(SEED);
    d.capexPlanActive = { ...(d.capexPlanActive ?? {}), lager: true };
    const mehr = klon(d);
    for (const p of mehr.capexPlan ?? []) if (p.block === "lager") p.subventionPct = 0.5;
    expect(zeile(mehr, "depreciation")).toBeLessThan(zeile(d, "depreciation"));
    // …und zwar OHNE einen Ertrag daneben: der Umsatz rührt sich nicht.
    expect(zeile(mehr, "revenue")).toBeCloseTo(zeile(d, "revenue"), 0);
  });
});

describe("WASSER — die Beregnung rechnet in Netto-Millimetern", () => {
  it("nennt den Systemverlust im Namen des Treibers", () => {
    /* Der Satz wird mit der NETTO-Norm multipliziert. Damit muss er den
     *  Pumpenverlust enthalten — bei 64 % Wirkungsgrad ist das der Unterschied
     *  zwischen 1,50 € und 2,34 € je Millimeter. Ein Treiber, dessen Einheit
     *  man raten muss, wird irgendwann falsch befüllt; der Name ist hier die
     *  einzige Stelle, an der die Bezugsgröße stehen kann. */
    const a = SEED.assumptions["irrig.eur_mm"];
    expect(a).toBeTruthy();
    expect(a.label).toMatch(/NETTO/);
    expect(resolveScalar(SEED, "irrig.eur_mm", SZ)).toBeGreaterThan(0);
  });
});
