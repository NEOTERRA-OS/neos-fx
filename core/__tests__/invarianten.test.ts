/**
 * Die vier Zusicherungen.
 *
 * Diese Datei ist der Grund, warum die Fehler vom 03.08.2026 aufgefallen sind —
 * und der Grund, warum sie nicht wiederkommen. Der Dateikopf von engine.ts sagt
 * seit jeher "Diese Datei ist voll unit-testbar". Sie ist es auch; es hatte nur
 * niemand getan, und deshalb konnte die Kapitalflussrechnung monatelang um das
 * USt-Timing danebenliegen, ohne dass es jemand bemerkte.
 *
 * Geprüft wird gegen das ECHTE Produktionsmodell (SEED-Domain über
 * buildModelState), nicht gegen ein Spielzeug. Eine Zusicherung, die nur auf
 * einem konstruierten Minimalfall gilt, sichert nichts.
 *
 *   1  Bilanzschluss          Aktiva = Passiva in jeder Periode
 *   2  Kapitalfluss           CFO + CFI + CFF + Anfangsbestand = Endbestand
 *   3  Determinismus          zweimal derselbe Input, identisches Ergebnis
 *   4  Konvergenz             die Revolver-Fixpunktiteration konvergiert
 */
import { describe, it, expect } from "vitest";
import { computeModel } from "../engine";
import { SEED, buildModelState } from "../../store/model";
import type { ComputedModel, ModelState } from "../types";

const SZENARIEN = SEED.scenarios.map((s) => ({ id: s.id, name: s.name }));

/** Ein Modellzustand je Szenario — einmal gebaut, von allen Tests genutzt. */
function zustand(scenarioId: string): ModelState {
  return buildModelState(SEED, scenarioId);
}
function rechne(scenarioId: string): ComputedModel {
  return computeModel(zustand(scenarioId), scenarioId);
}

/** Toleranz: ein Cent. Das Modell rechnet in ganzen Cent; alles darüber ist ein Fehler. */
const EPS = 1;

describe.each(SZENARIEN)("Zusicherungen · Szenario $name", ({ id, name }) => {
  const m = rechne(id);
  const n = m.pnl.revenue.values.length;

  it("1 · Die Bilanz geht in jeder Periode auf", () => {
    const check = m.checks.find((c) => c.id === "balance_zero");
    expect(check, "Der Check balance_zero muss existieren").toBeDefined();
    expect(
      check!.passed,
      `Bilanz reißt in ${check!.offendingPeriods.length} Perioden, `
      + `größte Abweichung ${check!.maxDeviation} Cent`,
    ).toBe(true);
  });

  it("2 · CFO + CFI + CFF + Anfangsbestand = Endbestand", () => {
    const cfo = m.cashFlow.cfo.values;
    const cfi = m.cashFlow.cfi.values;
    const cff = m.cashFlow.cff.values;
    const cash = m.cashFlow.closingCash.values;
    // Anfangsbestand der ersten Periode aus der Rückrechnung: Endbestand − Netto-Cashflow.
    const opening = cash[0] - m.cashFlow.netCashFlow.values[0];

    let schlimmste = 0;
    let periode = -1;
    for (let p = 0; p < n; p++) {
      const vorher = p === 0 ? opening : cash[p - 1];
      const abw = Math.abs(cash[p] - (vorher + cfo[p] + cfi[p] + cff[p]));
      if (abw > schlimmste) { schlimmste = abw; periode = p; }
    }
    expect(
      schlimmste,
      `Die drei Cashflow-Blöcke summieren sich in Periode ${periode} nicht auf die `
      + `Kassenveränderung — Differenz ${schlimmste} Cent. Genau diese Probe rechnet `
      + `ein Finanzierer als erste nach.`,
    ).toBeLessThanOrEqual(EPS);

    // Und derselbe Sachverhalt aus Sicht der Engine:
    const check = m.checks.find((c) => c.id === "cashflow_ties");
    expect(check?.passed, "Der Check cashflow_ties muss grün sein").toBe(true);
  });

  it("3 · Zwei Läufe liefern bitgleiche Ergebnisse", () => {
    const a = rechne(id);
    const b = rechne(id);
    expect(JSON.stringify(a.pnl)).toBe(JSON.stringify(b.pnl));
    expect(JSON.stringify(a.balanceSheet)).toBe(JSON.stringify(b.balanceSheet));
    expect(JSON.stringify(a.cashFlow)).toBe(JSON.stringify(b.cashFlow));
  });

  it("4 · Die Revolver-Iteration konvergiert", () => {
    expect(
      m.meta.converged,
      `Nicht konvergiert nach ${m.meta.revolverIterations} Iterationen. Die ausgewiesenen `
      + `Abschlüsse sind dann nicht belastbar — Szenario ${name}.`,
    ).toBe(true);
    expect(m.meta.revolverIterations).toBeLessThan(50);
  });

  /** STRUKTURELLE Checks muessen in jedem Szenario halten — sie beschreiben, ob
   *  die Rechnung in sich stimmt. `no_negative_cash` gehoert ausdruecklich NICHT
   *  dazu: dass ein Worst Case durch das Revolverlimit bricht, ist kein Rechen-
   *  fehler, sondern das Ergebnis. Es zu uebertoenen waere der eigentliche Fehler. */
  const STRUKTURELL = ["balance_zero", "cashflow_ties", "re_rollforward"];
  it("Zusatz · die strukturellen Checks halten", () => {
    const kaputt = m.checks.filter((c) => STRUKTURELL.includes(c.id) && !c.passed);
    expect(
      kaputt.map((c) => `${c.id} (max ${c.maxDeviation})`).join(", "),
    ).toBe("");
  });

  it("Zusatz · keine Reihe enthält NaN oder Infinity", () => {
    const gruppen: Record<string, unknown> = {
      pnl: m.pnl, balanceSheet: m.balanceSheet, cashFlow: m.cashFlow, kpis: m.kpis,
    };
    const schlecht: string[] = [];
    for (const [gname, g] of Object.entries(gruppen)) {
      for (const [lname, line] of Object.entries(g as Record<string, { values?: number[] }>)) {
        const v = line?.values;
        if (!Array.isArray(v)) continue;
        // KPIs dürfen bei Nenner 0 leer bleiben — dort ist 0 der vereinbarte Ersatzwert,
        // NaN/Infinity aber auch dort nicht.
        v.forEach((x, i) => {
          if (!Number.isFinite(x)) schlecht.push(`${gname}.${lname}[${i}] = ${x}`);
        });
      }
    }
    expect(schlecht.slice(0, 10).join("\n")).toBe("");
  });
});
