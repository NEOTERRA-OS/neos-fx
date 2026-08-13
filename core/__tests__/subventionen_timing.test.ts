/**
 * SUBVENTIONEN — ZWEI STRÖME, ZWEI ZEITACHSEN, EIN ERTRAGSJAHR.
 *
 * Bis zum 12.08.2026 führte das Modell alle Förderung als EINEN Strang mit dem
 * Profil 70 % Oktober / 30 % Dezember. Beide Hälften waren falsch:
 *
 *   DAS RESTZAHLUNGSFENSTER reicht rechtlich bis 30.06. T+1, nicht bis
 *   Dezember. In der Kampagne 2025 liefen Nachzahlungen bis Ende April 2026.
 *
 *   DIE GEKOPPELTE GEMÜSESTÜTZUNG (PD-17/18) läuft gar nicht in diesem Strang:
 *   ihr Anspruch entsteht erst mit dem Liefernachweis (Ausschlussfrist 31.03.
 *   T+1), ausgezahlt wird im Mai/Juni T+1 — rund zwölf Monate nach dem
 *   Antragsjahr. Sie stand im Modell ein volles Jahr zu früh.
 *
 * DER FEHLER, DER BEIM UMBAU SICHTBAR WURDE, ist der eigentlich lehrreiche:
 * das Modell buchte Subventionen KASSENWIRKSAM — Ertrag und Zufluss in
 * derselben Periode. Solange beide Anteile im selben Jahr lagen, fiel das nie
 * auf. Mit dem Fenster bis Juni T+1 wäre ein Drittel des Ertrags in das
 * Folgejahr gewandert und das EBITDA des Kampagnenjahres um denselben Betrag
 * gefallen — aus einem TIMING-Risiko wäre im Modell ein ERGEBNIS-Risiko
 * geworden. Net Debt / EBITDA ist ein Covenant; die Kennzahl hätte sich
 * verschlechtert, ohne dass sich am Betrag etwas ändert.
 *
 * Deshalb jetzt: Ertrag im Kampagnenjahr, Zufluss nach Profil, Differenz als
 * Forderung gegen APIA in der Bilanz.
 */
import { describe, it, expect } from "vitest";
import { SEED, buildModelState, setScenarioConst, resolveScalar, type Domain } from "../../store/model";
import { computeModel } from "../engine";

const SZ = SEED.baseScenarioId;
const klon = (d: Domain): Domain => JSON.parse(JSON.stringify(d));
const rechne = (d: Domain, sc = SZ) => computeModel(buildModelState(d, sc), sc);
const reihe = (m: ReturnType<typeof computeModel>, block: "pnl" | "cashFlow" | "balanceSheet", k: string) =>
  ((m[block] as unknown as Record<string, { values: number[] }>)[k]?.values ?? []);
const jahr = (v: number[], y: number) => v.slice(y * 12, (y + 1) * 12).reduce((a, b) => a + b, 0);

describe("Der Direktzahlungsstrom reicht bis Juni T+1", () => {
  it("verteilt über fünf Monate statt über zwei", () => {
    const s = SEED.subsidies.find((x) => x.id === "s-biss")!;
    const monate = (s.payout ?? []).map((p) => p.period).sort((a, b) => a - b);
    expect(monate).toEqual([9, 11, 13, 15, 17]);
    // Und die Anteile summieren auf genau eins — sonst verschwindet oder entsteht Geld.
    expect((s.payout ?? []).reduce((a, p) => a + p.share, 0)).toBeCloseTo(1, 6);
  });

  it("legt Anteile jenseits Dezember ins FOLGEJAHR, nicht ans Jahresende", () => {
    /* Periodenindex 13 ist Februar des Folgejahres, nicht der 13. Monat des
     *  Antragsjahres. Der Composer addiert je Planjahr zwölf — wer das anders
     *  liest, staucht das Fenster wieder auf ein Jahr zusammen. */
    const st = buildModelState(SEED, SZ);
    const biss0 = st.subsidies.find((x) => x.id === "s-biss-y0")!;
    const perioden = (biss0.payout ?? []).map((p) => p.period);
    expect(perioden).toContain(13);
    expect(Math.max(...perioden)).toBe(17);   // Juni T+1
  });
});

describe("Das Ertragsjahr bleibt das Kampagnenjahr", () => {
  it("verschiebt kein EBITDA, wenn nur der Zahlungstermin später wird", () => {
    /* DIE INVARIANTE DIESES UMBAUS, und die Probe darauf, dass die
     *  Ertragsabgrenzung wirkt: der konservative Schalter schiebt 30 % der
     *  Direktzahlungen von Dezember auf Juni T+1 — über eine Jahresgrenze.
     *  Das EBITDA darf sich dabei NICHT bewegen. Bewegt es sich doch, bucht das
     *  Modell wieder kassenwirksam, und ein später zahlender Verwaltungsakt
     *  verschlechtert eine Covenant-Kennzahl. */
    const spaet = klon(SEED);
    setScenarioConst(spaet, "cap.payout_konservativ", SZ, 1);
    const a = rechne(SEED), b = rechne(spaet);
    for (let y = 0; y < 9; y++) {
      expect(jahr(reihe(b, "pnl", "subsidies"), y), `Subventionsertrag ${2027 + y}`)
        .toBeCloseTo(jahr(reihe(a, "pnl", "subsidies"), y), 0);
      expect(jahr(reihe(b, "pnl", "ebitda"), y), `EBITDA ${2027 + y}`)
        .toBeCloseTo(jahr(reihe(a, "pnl", "ebitda"), y), 0);
    }
  });

  it("verschiebt dafür die KASSE — sonst wäre nichts umgestellt", () => {
    /* Der Gegenbeweis. Ein Test, der nur „EBITDA bleibt gleich" prüft, wäre
     *  auch grün, wenn der Schalter gar nichts täte. */
    const spaet = klon(SEED);
    setScenarioConst(spaet, "cap.payout_konservativ", SZ, 1);
    const kasse = (d: Domain) => reihe(rechne(d), "cashFlow", "closingCash");
    const a = kasse(SEED), b = kasse(spaet);
    const unterschiede = a.filter((v, i) => Math.abs(v - b[i]) > 100).length;
    expect(unterschiede, "keine einzige Periode bewegt sich").toBeGreaterThan(0);
  });

  it("stellt die noch nicht geflossene Förderung als Forderung in die Bilanz", () => {
    /* Ertrag ohne Zufluss ist eine Forderung — sonst geht die Bilanz nicht auf.
     *  Sie läuft in derselben Zeile wie die Kundenforderung: sachlich dieselbe
     *  Art Posten, und eine eigene Aktivposition müsste an drei Stellen
     *  nachgezogen werden. */
    const st = buildModelState(SEED, SZ);
    const m = computeModel(st, SZ);
    const forderung = reihe(m, "balanceSheet", "receivables");
    expect(forderung.some((v) => v > 0)).toBe(true);
    // Die Bilanz muss trotzdem aufgehen — der Engine-Check ist der Zeuge.
    const bilanz = m.checks.find((c) => c.id === "balance_check" || /Bilanz geht auf/.test(c.label));
    expect(bilanz?.passed, bilanz?.label).toBe(true);
  });
});

describe("VCP Gemüse — eigener Strom, eigene Zeitachse, binäre Bedingung", () => {
  it("fließt im Mai/Juni T+1, nicht im Antragsjahr", () => {
    const s = SEED.subsidies.find((x) => x.id === "vcp-tomate")!;
    expect((s.payout ?? []).map((p) => p.period).sort((a, b) => a - b)).toEqual([16, 17]);
  });

  it("entfällt VOLLSTÄNDIG, wenn der Nachweis reißt — nicht anteilig", () => {
    /* DER PUNKT, AUF DEN ES ANKOMMT. Der Anspruch entsteht mit dem Nachweis:
     *  Vertrag mit registriertem Verarbeiter, Mindestmenge 40 t/ha, Frist
     *  31.03. T+1. Reißt eine der drei Bedingungen, ist die ganze Position weg
     *  — auch bei tatsächlich erfolgter Lieferung.
     *
     *  Deshalb ein Schalter und keine Wahrscheinlichkeit als Faktor: 90 % des
     *  Betrags werden NIE ausgezahlt. Es gibt zwei mögliche Zuflüsse, voll oder
     *  null. Eine gemittelte Zahl ist für die Liquiditätsplanung das
     *  Schlechteste von beidem — zu niedrig zum Planen, zu hoch zum Verlassen. */
    const ohne = klon(SEED);
    setScenarioConst(ohne, "vcp.nachweis", SZ, 0);
    const stMit = buildModelState(SEED, SZ), stOhne = buildModelState(ohne, SZ);
    const vcpMit = stMit.subsidies.filter((x) => x.category === "vcp");
    const vcpOhne = stOhne.subsidies.filter((x) => x.category === "vcp");
    expect(vcpMit.length).toBeGreaterThan(0);
    expect(vcpOhne.length, "ohne Nachweis darf KEINE VCP-Zeile übrigbleiben").toBe(0);
    // Und die übrige Förderung bleibt unberührt — es ist eine Position, kein Pauschalabschlag.
    expect(stOhne.subsidies.filter((x) => x.category !== "vcp").length)
      .toBe(stMit.subsidies.filter((x) => x.category !== "vcp").length);
  });

  it("steht im Worst Case auf null, im Basisfall auf voll", () => {
    const worst = SEED.scenarios.find((s) => s.id === "sc-worst")!;
    expect(resolveScalar(SEED, "vcp.nachweis", SZ)).toBe(1);
    expect(resolveScalar(SEED, "vcp.nachweis", worst.id)).toBe(0);
    // Dasselbe Muster beim Zahlungstermin: Worst rechnet mit dem Fristende.
    expect(resolveScalar(SEED, "cap.payout_konservativ", SZ)).toBe(0);
    expect(resolveScalar(SEED, "cap.payout_konservativ", worst.id)).toBe(1);
  });
});

describe("Der Planhorizont schneidet ab — sichtbar, nicht still", () => {
  it("weist die Zahlungen jenseits des Horizonts als Hinweiszeile aus", () => {
    /* Restzahlungen der letzten Kampagne fallen in ein Jahr, das das Modell
     *  nicht mehr kennt. Das Geld wird verworfen — richtig für einen
     *  abgeschnittenen Horizont. Ohne Hinweis liest man das letzte Planjahr
     *  aber als Einbruch der Förderung, wo nur der Kalender endet. */
    const st = buildModelState(SEED, SZ);
    expect(st.subsidyBeyondHorizonCent ?? 0).toBeGreaterThan(0);
    const m = computeModel(st, SZ);
    const hinweis = m.checks.find((c) => c.id === "subsidy_beyond_horizon")!;
    expect(hinweis, "Hinweiszeile fehlt").toBeTruthy();
    expect(hinweis.passed, "ist kein Fehler, sondern eine Eigenschaft").toBe(true);
    expect(hinweis.severity).toBe("info");
  });

  it("behält den ERTRAG auch für abgeschnittene Zahlungen", () => {
    /* Der Anspruch besteht, nur das Geld kommt später als der Horizont. Wer
     *  auch den Ertrag streicht, zeigt im letzten Planjahr eine Förderlücke,
     *  die es nicht gibt — und die Bilanz verlöre die Forderung dazu. */
    const m = computeModel(buildModelState(SEED, SZ), SZ);
    const s = reihe(m, "pnl", "subsidies");
    const letztes = jahr(s, 8), vorletztes = jahr(s, 7);
    expect(letztes).toBeGreaterThan(vorletztes * 0.9);
  });
});
