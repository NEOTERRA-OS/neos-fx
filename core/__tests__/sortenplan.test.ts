/**
 * Sortenanteile und die Schläge, die daraus fallen.
 *
 * Bis 04.08.2026 verteilte `buildSchlaege` die Sorten REIHUM über die Felder.
 * Das trifft den geplanten Anteil genau dann, wenn alle Sorten denselben Anteil
 * haben und alle Felder gleich groß sind — und sonst nie. Bei 40/35/25 auf 55
 * Feldern lag die reihum verteilte Menge zweistellig neben dem Plan, ohne dass
 * irgendwo eine Warnung entstanden wäre. Das ist die Fehlerklasse, die dieser
 * Test abdeckt: nicht ein Absturz, sondern eine still falsche Zahl.
 *
 * Vier Zusicherungen:
 *   · der ANTEIL wird getroffen, nicht nur die Reihenfolge
 *   · die SUMME der Schlagflächen bleibt die Kulturfläche — Sorten teilen sie,
 *     sie vermehren sie nicht
 *   · die Schlag-ID ist positionsfrei und stabil (dieselbe Regel wie bei
 *     `measureId` und den CAPEX-Jahrgängen)
 *   · ohne Sortenplan verhält sich die Zuteilung wie vorher
 */
import { describe, it, expect } from "vitest";
import {
  SEED, schlaegeOf, sortenAnteileOf, sortenVerteilung, sortenplanOf,
  exportMassnahmenplan, flaechenMemo, type Domain,
} from "../../store/model";
import { normSortenanteile, sortenSlug, MIN_SCHLAG_HA } from "../../store/schlaege";

const SZ = SEED.baseScenarioId;
const JAHRE = Math.max(1, SEED.growth?.years ?? 1);
const klon = (d: Domain): Domain => JSON.parse(JSON.stringify(d));
const MIT_SORTEN = ["kartoffel_pommes", "kartoffel_chips"];

describe("Anteile normieren", () => {
  it("nimmt Prozentzahlen und Quoten gleichermaßen an", () => {
    const a = normSortenanteile([{ sorte: "A", anteil: 40 }, { sorte: "B", anteil: 60 }]);
    const b = normSortenanteile([{ sorte: "A", anteil: 0.4 }, { sorte: "B", anteil: 0.6 }]);
    expect(a).toEqual(b);
    expect(a.reduce((s, x) => s + x.anteil, 0)).toBeCloseTo(1, 12);
  });

  it("wirft Sorten mit Anteil 0 heraus — ein Prüfglied ohne Fläche ist kein Schlag", () => {
    const a = normSortenanteile([{ sorte: "A", anteil: 1 }, { sorte: "Prüfglied", anteil: 0 }]);
    expect(a.map((x) => x.sorte)).toEqual(["A"]);
  });

  it("liefert ohne verwertbare Eingabe genau einen sortenlosen Eintrag", () => {
    for (const ein of [undefined, [], [{ sorte: "", anteil: 1 }], [{ sorte: "A", anteil: 0 }]]) {
      const a = normSortenanteile(ein as never);
      expect(a).toEqual([{ sorte: undefined, anteil: 1 }]);
    }
  });
});

describe("Sorten-Slug in der Schlag-ID", () => {
  it("macht aus Anzeigenamen ID-taugliche Bestandteile", () => {
    expect(sortenSlug("Lady Avalon")).toBe("LADY_AVALON");
    expect(sortenSlug("Königin Anna")).toBe("KONIGIN_ANNA");
    expect(sortenSlug("SH C 2030")).toBe("SH_C_2030");
    expect(sortenSlug("")).toBe("SORTE");
  });

  it("hängt NICHT an der Position im Sortenplan", () => {
    /* Dieselbe Fehlerklasse, die `measureId` und die CAPEX-Jahrgänge getroffen
     *  hat: eine ID aus einem Array-Index ist als Schnittstelle wertlos. Wer die
     *  Reihenfolge im Sortenplan umstellt, darf keinen einzigen Arbeitsauftrag
     *  verlieren. */
    const d = klon(SEED);
    const vorher = schlaegeOf(d, "kartoffel_pommes", 0).map((s) => s.id).sort();
    const gedreht = klon(SEED);
    gedreht.sortenplan = { kartoffel_pommes: [...sortenAnteileOf(SEED, "kartoffel_pommes")].reverse() };
    const nachher = schlaegeOf(gedreht, "kartoffel_pommes", 0).map((s) => s.id).sort();
    expect(nachher).toEqual(vorher);
  });
});

describe("Zuteilung trifft den Anteil", () => {
  it("hält Soll und Ist über alle Jahre innerhalb von 3 Prozentpunkten", () => {
    for (const cropId of MIT_SORTEN) {
      for (let y = 0; y < JAHRE; y++) {
        const v = sortenVerteilung(SEED, cropId, y);
        if (!v.length) continue;
        const ha = schlaegeOf(SEED, cropId, y).reduce((s, x) => s + x.areaHa, 0);
        if (ha <= 0) continue;
        for (const r of v) {
          expect(Math.abs(r.istPct - r.sollPct), `${cropId} ${y} ${r.sorte}: soll ${r.sollPct.toFixed(1)} ist ${r.istPct.toFixed(1)}`)
            .toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it("trifft auch eine schiefe Aufteilung", () => {
    const d = klon(SEED);
    d.sortenplan = { kartoffel_pommes: [
      { sorte: "Alpha", anteil: 0.7 }, { sorte: "Beta", anteil: 0.2 }, { sorte: "Gamma", anteil: 0.1 },
    ] };
    const y = JAHRE - 1;
    for (const r of sortenVerteilung(d, "kartoffel_pommes", y)) {
      expect(Math.abs(r.istPct - r.sollPct), `${r.sorte}`).toBeLessThanOrEqual(3);
    }
  });

  it("erzeugt keine Schlag-Zipfel unter der Mindestgröße", () => {
    /* Ausnahme: das LETZTE Feld einer Kultur kann kleiner ausfallen, weil die
     *  Restfläche kleiner ist als ein Feld. Das ist Fläche, kein Zipfel. */
    const y = JAHRE - 1;
    for (const cropId of MIT_SORTEN) {
      const s = schlaegeOf(SEED, cropId, y);
      const jeFeld = new Map<string, number>();
      for (const x of s) jeFeld.set(x.feldId, (jeFeld.get(x.feldId) ?? 0) + 1);
      for (const x of s) {
        if ((jeFeld.get(x.feldId) ?? 1) < 2) continue;   // ungeteiltes Feld
        expect(x.areaHa, `${x.id}`).toBeGreaterThanOrEqual(MIN_SCHLAG_HA - 0.05);
      }
    }
  });
});

describe("Die Fläche bleibt die Fläche", () => {
  it("Sorten teilen die Kulturfläche, sie vermehren sie nicht", () => {
    /* DIE eigentliche Zusicherung. Wäre sie verletzt, hätte der Sortenplan nicht
     *  die Zuteilung verfeinert, sondern die Betriebsfläche verändert — und das
     *  wäre eine Aussage, die niemand getroffen hat. */
    const ohne = klon(SEED);
    ohne.sortenplan = Object.fromEntries(MIT_SORTEN.map((c) => [c, []]));
    for (const cropId of MIT_SORTEN) {
      for (let y = 0; y < JAHRE; y++) {
        const mit = schlaegeOf(SEED, cropId, y).reduce((s, x) => s + x.areaHa, 0);
        const roh = schlaegeOf(ohne, cropId, y).reduce((s, x) => s + x.areaHa, 0);
        expect(mit, `${cropId} Jahr ${y}`).toBeCloseTo(roh, 1);
      }
    }
  });

  it("belegt kein Feld doppelt mit verschiedenen Kulturen", () => {
    for (let y = 0; y < JAHRE; y++) {
      const haupt = flaechenMemo(SEED).schlaege.filter((s) => s.jahr === y)
        .filter((s) => !SEED.anbauplan.find((a) => a.cropId === s.cropId)?.zweitnutzung);
      const jeFeld = new Map<string, Set<string>>();
      for (const s of haupt) {
        const set = jeFeld.get(s.feldId) ?? new Set<string>();
        set.add(s.cropId); jeFeld.set(s.feldId, set);
      }
      for (const [feldId, kulturen] of jeFeld) {
        expect(kulturen.size, `${feldId} Jahr ${y}: ${[...kulturen].join(", ")}`).toBe(1);
      }
    }
  });
});

describe("Ohne Sortenplan bleibt alles wie vorher", () => {
  it("erzeugt genau einen sortenlosen Schlag je belegtem Feld", () => {
    const d = klon(SEED);
    d.sortenplan = Object.fromEntries([...new Set(SEED.anbauplan.map((a) => a.cropId))].map((c) => [c, []]));
    expect(Object.keys(sortenplanOf(d))).toHaveLength(0);
    const s = schlaegeOf(d, "kartoffel_pommes", JAHRE - 1);
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((x) => x.sorte === undefined)).toBe(true);
    expect(new Set(s.map((x) => x.feldId)).size).toBe(s.length);
  });
});

describe("Der Maßnahmenplan wird sortenscharf", () => {
  it("führt die Sorte am Arbeitsauftrag mit, wo der Bezug der Schlag ist", () => {
    const ex = exportMassnahmenplan(SEED, SZ, { jahr: JAHRE - 1, aufloesung: "schlag" }) as unknown as
      { auftraege: { bezug: string; cropId: string; sorte: string | null; schlagId: string | null }[] };
    const schlagbezug = ex.auftraege.filter((a) => a.bezug === "schlag" && MIT_SORTEN.includes(a.cropId));
    expect(schlagbezug.length).toBeGreaterThan(0);
    // Jeder Schlag-Auftrag einer Kultur MIT Sortenplan trägt eine Sorte. Fehlte sie,
    //  wäre der Rodetermin wieder sortenlos — genau das, wofür die Ebene gebaut ist.
    expect(schlagbezug.every((a) => !!a.sorte)).toBe(true);
    expect(schlagbezug.every((a) => a.schlagId?.includes(sortenSlug(a.sorte!)))).toBe(true);
  });

  it("lässt Feld-Maßnahmen sortenlos — eine Überfahrt erledigt beide Sorten", () => {
    const ex = exportMassnahmenplan(SEED, SZ, { jahr: JAHRE - 1, aufloesung: "schlag" }) as unknown as
      { auftraege: { bezug: string; sorte: string | null; schlagId: string | null }[] };
    const feldbezug = ex.auftraege.filter((a) => a.bezug === "feld");
    expect(feldbezug.length).toBeGreaterThan(0);
    expect(feldbezug.every((a) => a.sorte === null && a.schlagId === null)).toBe(true);
  });
});
