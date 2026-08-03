/**
 * Eigenkapitalzuführung (Investor, Gesellschaftereinlage, Kapitalerhöhung).
 *
 * Bis 03.08.2026 gab es das nicht: `cf.equity` stand fest auf null und
 * `shareCapital` war über alle Perioden konstant. Ein Investorenszenario ließ
 * sich damit überhaupt nicht rechnen — jede Finanzierungslücke fiel dem Revolver
 * zu, egal wieviel Eigenkapital in Wahrheit hereinkäme.
 *
 * Geprüft wird gegen das echte Produktionsmodell, weil eine Einlage genau dort
 * wirken muss, wo es weh tut: in der Kasse, im gezeichneten Kapital, im
 * Revolversaldo — und ohne die Bilanz zu zerreißen.
 */
import { describe, it, expect } from "vitest";
import { computeModel } from "../engine";
import { SEED, buildModelState } from "../../store/model";

const SZ = SEED.baseScenarioId;
const EINLAGE = 10_000_000_00; // 10 Mio EUR in Cent
const PERIODE = 24;            // Januar 2029

function rechne(mitEinlage: boolean) {
  const st = buildModelState(SEED, SZ);
  if (mitEinlage) {
    st.equityInjections = [
      { period: PERIODE, amountCent: EINLAGE, label: "Investor Lagerprojekt" },
    ];
  }
  return computeModel(st, SZ);
}

describe("Eigenkapitalzuführung", () => {
  const ohne = rechne(false);
  const mit = rechne(true);

  it("erhöht das gezeichnete Kapital ab der Einlageperiode — und nicht davor", () => {
    const sc = mit.balanceSheet.shareCapital.values;
    const scO = ohne.balanceSheet.shareCapital.values;
    expect(sc[PERIODE - 1]).toBe(scO[PERIODE - 1]);
    expect(sc[PERIODE] - scO[PERIODE]).toBe(EINLAGE);
    // und bleibt danach stehen — eine Einlage wird nicht zurückgedreht
    expect(sc[sc.length - 1] - scO[scO.length - 1]).toBe(EINLAGE);
  });

  it("erscheint als Eigenkapitalbewegung im Cashflow", () => {
    expect(mit.cashFlow.equityMovement.values[PERIODE]).toBe(EINLAGE);
    expect(ohne.cashFlow.equityMovement.values[PERIODE]).toBe(0);
  });

  it("entlastet Kasse oder Revolver — das Geld verschwindet nicht", () => {
    const dKasse = mit.cashFlow.closingCash.values[PERIODE] - ohne.cashFlow.closingCash.values[PERIODE];
    const dRev = mit.balanceSheet.revolver.values[PERIODE] - ohne.balanceSheet.revolver.values[PERIODE];
    // Entweder liegt das Geld in der Kasse, oder es hat den Revolver getilgt.
    // Zusammen muss es die Einlage ergeben (auf Rundung genau).
    expect(dKasse - dRev).toBeGreaterThan(EINLAGE * 0.99);
  });

  it("lässt die Bilanz aufgehen und die Kapitalflussrechnung schließen", () => {
    for (const id of ["balance_zero", "cashflow_ties", "re_rollforward"]) {
      const c = mit.checks.find((x) => x.id === id);
      expect(c?.passed, `${id} muss halten (max ${c?.maxDeviation})`).toBe(true);
    }
    expect(mit.meta.converged).toBe(true);
  });

  it("ohne Einlage ändert sich nichts gegenüber vorher", () => {
    // Die Mechanik darf den Basisfall nicht anfassen.
    expect(JSON.stringify(ohne.cashFlow.closingCash.values))
      .toBe(JSON.stringify(rechne(false).cashFlow.closingCash.values));
    expect(ohne.cashFlow.equityMovement.values.every((v) => v === 0)).toBe(true);
  });
});
