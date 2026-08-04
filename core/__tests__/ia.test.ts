/**
 * DIE NAVIGATION MUSS VOLLSTÄNDIG UND DOPPELUNGSFREI SEIN.
 *
 * Der Befund vom 04.08.2026, der diese Datei ausgelöst hat: von 39 ViewIds
 * hatten ZWÖLF keinen Menüeintrag, und SECHS der übrigen zeigten alle dieselbe
 * `MaschinenparkView` — „Maschinenpark", „Leistung", „Investitionen",
 * „CAPEX-Szenarien", „Ersatz", „Lohnarbeit". Wer im Menü zwischen ihnen wechselte,
 * sah viermal denselben Bildschirm und schloss daraus, das Modell sei doppelt
 * gepflegt. Dieselbe Lage bei „Annahmen" (drei IDs, eine Ansicht).
 *
 * Das ist keine Kosmetik. Eine Ansicht unter mehreren Namen heißt: der Nutzer
 * kann nicht wissen, wo er etwas eingibt, und ein Reviewer kann nicht wissen,
 * ob eine Zahl zweimal im Modell steht. Beides kostet Vertrauen in ALLE Zahlen.
 *
 * Geprüft wird deshalb die STRUKTUR, nicht das Aussehen:
 *   1. jede ViewId hat genau einen Menüeintrag,
 *   2. keine zwei Einträge zeigen auf dieselbe Ansicht,
 *   3. die Reihenfolge folgt der Arbeitsreihenfolge (Eingaben vor Abschlüssen).
 *
 * `ia.ts` ist bewusst frei von React, damit dieser Test ohne DOM läuft.
 */
import { describe, it, expect } from "vitest";
import { IA, IA_VIEWS, VIEW_LABEL, type ViewId } from "../../components/shell/ia";

/* Die vollständige Liste — von Hand, damit ein Tippfehler in `ViewId` nicht
 *  einfach durchrutscht, weil beide Seiten aus derselben Quelle kämen. */
const ALLE: ViewId[] = [
  "dashboard", "annahmenSheet", "wiedervorlage", "anbauplan", "kulturkalk", "produktkatalog",
  "maschinen", "maschinenBestand", "bauInvest", "einsatz", "personal", "overhead", "lagerkst",
  "finanzierung", "subventionen", "holding", "eroeffnung", "pacht", "vat",
  "pnl", "balance", "cashflow", "liquiditaet", "istabgleich",
  "studio", "bewertung", "shareholder", "kommentare", "team", "verwaltung",
];

describe("Menü und Ansichten decken sich", () => {
  it("führt jede Ansicht genau einmal", () => {
    expect([...IA_VIEWS].sort()).toEqual([...ALLE].sort());
  });

  it("zeigt keine zwei Einträge auf dieselbe Ansicht", () => {
    expect(new Set(IA_VIEWS).size).toBe(IA_VIEWS.length);
  });

  it("gibt jedem Eintrag einen eigenen Namen", () => {
    const labels = IA.flatMap((g) => g.items.map((i) => i.label));
    expect(new Set(labels).size, labels.join(" | ")).toBe(labels.length);
    for (const v of ALLE) expect(VIEW_LABEL[v], v).toBeTruthy();
  });

  it("benennt jede Gruppe genau einmal", () => {
    const t = IA.map((g) => g.title);
    expect(new Set(t).size).toBe(t.length);
    expect(IA.every((g) => g.items.length > 0)).toBe(true);
  });
});

describe("Die Reihenfolge folgt der Arbeitsreihenfolge", () => {
  it("stellt die Eingaben einer Gruppe vor deren Ausgaben", () => {
    /* Innerhalb einer Gruppe darf keine Eingabe NACH einer Ausgabe kommen —
     *  mit einer bewussten Ausnahme: die Wiedervorlage steht direkt hinter dem
     *  Annahmen-Register, weil sie dessen Filter „was ist noch offen" ist und
     *  man beim Belegen zwischen beiden hin- und herspringt. */
    for (const g of IA) {
      const items = g.items.filter((i) => i.view !== "wiedervorlage");
      const ersteAusgabe = items.findIndex((i) => i.ausgabe);
      if (ersteAusgabe < 0) continue;
      const spaeterEingabe = items.slice(ersteAusgabe).filter((i) => !i.ausgabe);
      expect(spaeterEingabe.map((i) => i.label), g.title).toEqual([]);
    }
  });

  it("stellt die drei Abschlüsse unter eine eigene Zwischenüberschrift", () => {
    const fin = IA.find((g) => g.title === "Financials")!;
    const guv = fin.items.find((i) => i.view === "pnl")!;
    expect(guv.trenner).toBeTruthy();
    for (const v of ["pnl", "balance", "cashflow", "liquiditaet"] as ViewId[]) {
      expect(fin.items.find((i) => i.view === v)!.ausgabe, v).toBe(true);
    }
  });

  it("markiert genau die Ansichten als Ausgabe, in denen nichts eingegeben wird", () => {
    /* Nicht die Zahl ist die Aussage, sondern die MENGE: wer eine Ansicht mit
     *  Eingabefeldern als „Ausgabe" markiert, dämpft sie im Menü und der Nutzer
     *  findet das Feld nicht mehr. Umgekehrt sucht er in GuV und Bilanz nach
     *  Feldern, die es nie gab. */
    const ausgaben = IA.flatMap((g) => g.items).filter((i) => i.ausgabe).map((i) => i.view).sort();
    expect(ausgaben).toEqual([
      "balance", "cashflow", "dashboard", "einsatz", "istabgleich",
      "liquiditaet", "pnl", "wiedervorlage", "bewertung",
    ].sort());
  });
});
