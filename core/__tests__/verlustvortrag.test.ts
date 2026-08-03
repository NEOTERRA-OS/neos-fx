/**
 * Verlustvortrag mit Fünfjahresverfall (RO Art. 31 Cod fiscal i.d.F. Legea 296/2023).
 *
 * Zwei Regeln, die zusammen gelten und vorher nur zur Hälfte umgesetzt waren:
 *   a) Verrechnung höchstens 70 % der Jahresbemessung   — war richtig
 *   b) Vortrag höchstens fünf aufeinanderfolgende Jahre — fehlte
 *
 * Ohne (b) verrechnete das Modell über den Horizont 2027–2034 im Jahr 2034 noch
 * Verluste aus 2027. Das ist zu wenig Steuer und zu viel ausgewiesene Liquidität —
 * ausgerechnet in den Jahren, in denen Darlehen endfällig werden.
 */
import { describe, it, expect } from "vitest";
import { applyLossCarryforward } from "../engine";

const RO = { enabled: true, years: 5, maxOffsetShare: 0.7 };

describe("Verlustvortrag", () => {
  it("verrechnet höchstens 70 % der Jahresbemessung", () => {
    const r = applyLossCarryforward([-100, 100], RO);
    expect(r.offsetPerYear[1]).toBeCloseTo(70);
    expect(r.baseAfterOffset[1]).toBeCloseTo(30);
    // 30 der 100 Verluste bleiben stehen und sind weiter vortragsfähig.
    expect(r.open).toBeCloseTo(30);
    expect(r.expired).toBe(0);
  });

  it("lässt den Verlust nach fünf Jahren verfallen", () => {
    //   Jahr 0 Verlust, Gewinn erst Jahr 6 → 6 > 5, also außerhalb der Frist.
    const r = applyLossCarryforward([-100, 0, 0, 0, 0, 0, 100], RO);
    expect(r.offsetPerYear[6]).toBe(0);
    expect(r.baseAfterOffset[6]).toBeCloseTo(100); // volle Bemessung zu versteuern
    expect(r.expired).toBeCloseTo(100);
    expect(r.open).toBe(0);
  });

  it("verrechnet noch im fünften Jahr — die Grenze liegt an der richtigen Stelle", () => {
    const r = applyLossCarryforward([-100, 0, 0, 0, 0, 100], RO);
    expect(r.offsetPerYear[5]).toBeCloseTo(70);
    expect(r.expired).toBe(0);
  });

  it("verrechnet FIFO — der älteste Verlust zuerst", () => {
    // Jahr 0: −100 (verfällt nach Jahr 5), Jahr 3: −100.
    // Jahr 4: Gewinn 100 → Verrechnungsraum 70. FIFO nimmt den Verlust aus Jahr 0.
    // Jahr 9: Gewinn 1000 → der Rest aus Jahr 0 (30) ist längst verfallen,
    //         der aus Jahr 3 (100) ebenfalls (9 − 3 = 6 > 5).
    const r = applyLossCarryforward([-100, 0, 0, -100, 100, 0, 0, 0, 0, 1000], RO);
    expect(r.offsetPerYear[4]).toBeCloseTo(70);
    expect(r.expired).toBeCloseTo(130); // 30 aus Jahr 0 + 100 aus Jahr 3
    expect(r.baseAfterOffset[9]).toBeCloseTo(1000);
  });

  it("verrechnet nichts, wenn der Vortrag abgeschaltet ist", () => {
    const r = applyLossCarryforward([-100, 100], { ...RO, enabled: false });
    expect(r.offsetPerYear[1]).toBe(0);
    expect(r.baseAfterOffset[1]).toBeCloseTo(100);
    expect(r.expired).toBe(0);
  });

  it("bildet mit sehr langer Frist die alte, falsche Rechnung nach", () => {
    // Gegenprobe zum Befund: mit unbegrenztem Vortrag wird auch nach sieben
    // Jahren noch verrechnet — genau das tat das Modell vorher.
    const alt = applyLossCarryforward([-100, 0, 0, 0, 0, 0, 100], { ...RO, years: 99 });
    const neu = applyLossCarryforward([-100, 0, 0, 0, 0, 0, 100], RO);
    expect(alt.baseAfterOffset[6]).toBeCloseTo(30);
    expect(neu.baseAfterOffset[6]).toBeCloseTo(100);
    expect(neu.baseAfterOffset[6]).toBeGreaterThan(alt.baseAfterOffset[6]);
  });

  it("summiert Verfall und offenen Rest vollständig", () => {
    const jahre = [-100, -50, 200, -30, 0, 0, 0, 0, 0, 0];
    const r = applyLossCarryforward(jahre, RO);
    const verlusteGesamt = jahre.filter((v) => v < 0).reduce((s, v) => s - v, 0);
    const verrechnet = r.offsetPerYear.reduce((s, v) => s + v, 0);
    // Nichts geht verloren: verrechnet + verfallen + offen == alle Verluste.
    expect(verrechnet + r.expired + r.open).toBeCloseTo(verlusteGesamt);
  });
});
