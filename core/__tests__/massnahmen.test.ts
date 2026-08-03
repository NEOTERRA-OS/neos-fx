/**
 * Maßnahmen: positionsfreie IDs, Flächenbezug, Ist-Daten.
 *
 * Der Anlass ist ein wiederkehrendes Muster, das in dieser Codebasis schon dreimal
 * Schaden gemacht hat: `measureId` aus dem Seed-Index, CAPEX-Vintages aus
 * `capexMY.length`, Parzellen aus der Anbauplanzeile. Eine ID, die von einer
 * Array-Position abhängt, sieht stabil aus, solange niemand etwas einfügt — und
 * genau das tut jeder Nutzer als Erstes.
 *
 * Der entscheidende Test ist deshalb nicht „sind die IDs schön", sondern:
 * BLEIBEN SIE GLEICH, wenn eine Maßnahme VOR ihnen eingefügt oder gelöscht wird.
 * Das ist der Fall, der die alte Fassung gebrochen hat.
 */
import { describe, it, expect } from "vitest";
import {
  SEED, VALUE_CROP_IDS, deriveCropMassnahmen, exportMassnahmenplan, migrateDomain,
  flaechenMemo, schlaegeOf, deriveWiedervorlage, deriveIstAbgleich, type Domain,
} from "../../store/model";
import { parseMeasureId, istAltId, BEZUG_JE_FACH } from "../../store/measureId";

const SZ = SEED.baseScenarioId;
const klon = (d: Domain): Domain => JSON.parse(JSON.stringify(d));

/** Alle Maßnahmen aller Kulturen eines Standes, Jahr 0. */
function alleMassnahmen(d: Domain, jahr = 0) {
  return VALUE_CROP_IDS.flatMap((cid) => deriveCropMassnahmen(d, cid, SZ, jahr).rows);
}

describe("Maßnahmen-IDs · positionsfrei und sprechend", () => {
  const rows = alleMassnahmen(SEED);

  it("erzeugt überhaupt Maßnahmen", () => {
    expect(rows.length).toBeGreaterThan(50);
  });

  it("vergibt jede ID genau einmal", () => {
    const ids = rows.map((r) => r.measureId);
    const doppelt = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(doppelt).toEqual([]);
  });

  it("folgt dem Schema <cropId>.<FACHBEREICH>.<SLUG> und trägt keine Altform", () => {
    for (const r of rows) {
      expect(istAltId(r.measureId), r.measureId).toBe(false);
      const p = parseMeasureId(r.measureId);
      expect(p, r.measureId).not.toBeNull();
      expect(p!.fach).toBe(r.fachbereich);
      expect(r.bezug).toBe(BEZUG_JE_FACH[r.fachbereich]);
      // Die ID darf keinen Index tragen — kein Segment, das nur aus Ziffern besteht.
      expect(p!.slug.split("_").every((t) => !/^\d+$/.test(t)), r.measureId).toBe(true);
    }
  });

  it("trägt die Kultur-ID als erstes Segment", () => {
    for (const cid of VALUE_CROP_IDS) {
      for (const r of deriveCropMassnahmen(SEED, cid, SZ, 0).rows) {
        expect(parseMeasureId(r.measureId)!.cropId).toBe(cid);
      }
    }
  });

  /* DER EIGENTLICHE TEST. Vorher verschob eine eingefügte Zeile jede folgende ID. */
  it("hält alle IDs, wenn eine PSM-Anwendung VORNE eingefügt wird", () => {
    const vorher = deriveCropMassnahmen(SEED, "kartoffel_pommes", SZ, 0).rows.map((r) => r.measureId);
    const d = klon(SEED);
    const op = d.catalog.find((c) => c.cropId === "kartoffel_pommes")!.ops.find((o) => o.code === "OP-PSM")!;
    op.lines.unshift({ label: "Zusatz Beizung (Rhizoctonia)", costType: "crop_protection",
      quantityPerHa: 25, unitCostKey: "psm.per_euro", unit: "€/ha (Mittel)", passes: 1,
      mid: "kartoffel_pommes.PFLANZENSCHUTZ.ZUSATZ_BEIZUNG" });
    const nachher = deriveCropMassnahmen(d, "kartoffel_pommes", SZ, 0).rows.map((r) => r.measureId);
    for (const id of vorher) expect(nachher, id).toContain(id);
    expect(nachher).toContain("kartoffel_pommes.PFLANZENSCHUTZ.ZUSATZ_BEIZUNG");
  });

  it("hält alle übrigen IDs, wenn die erste Düngegabe gelöscht wird", () => {
    const d = klon(SEED);
    const op = d.catalog.find((c) => c.cropId === "kartoffel_chips")!.ops.find((o) => o.code === "OP-DUENG")!;
    const weg = op.lines[0].mid;
    op.lines = op.lines.filter((l) => l.mid !== weg);
    const nachher = deriveCropMassnahmen(d, "kartoffel_chips", SZ, 0).rows.map((r) => r.measureId);
    const vorher = deriveCropMassnahmen(SEED, "kartoffel_chips", SZ, 0).rows.map((r) => r.measureId);
    for (const id of vorher) {
      if (id === weg) expect(nachher).not.toContain(id);
      else expect(nachher, id).toContain(id);
    }
  });

  it("gruppiert die Nährstoffzeilen EINER Gabe auf EINE ID", () => {
    const dueng = SEED.catalog.find((c) => c.cropId === "kartoffel_pommes")!.ops.find((o) => o.code === "OP-DUENG")!;
    const proGabe = new Map<string, number>();
    for (const l of dueng.lines) proGabe.set(l.mid!, (proGabe.get(l.mid!) ?? 0) + 1);
    // Grund P/K + Start-N sind drei Nährstoffzeilen, aber EINE Streuer-Überfahrt.
    expect([...proGabe.values()].some((n) => n > 1)).toBe(true);
    // Und genau so viele Maßnahmenzeilen, wie es Gaben gibt — nicht so viele wie Nährstoffe.
    const gaben = deriveCropMassnahmen(SEED, "kartoffel_pommes", SZ, 0).rows
      .filter((r) => r.opCode === "OP-DUENG");
    expect(gaben.length).toBe(proGabe.size);
    expect(gaben.every((g) => g.bm.length >= 1)).toBe(true);
  });
});

describe("Maßnahmen-IDs · Migration gespeicherter Stände", () => {
  /** Ein Stand in der ALTEN Form, wie ihn Supabase noch ausliefert. */
  function altstand(): Domain {
    const d = klon(SEED);
    for (const c of d.catalog) {
      for (const op of c.ops) {
        op.lines.forEach((l, i) => {
          const kurz = op.code.replace("OP-", "").toLowerCase();
          l.mid = `${c.cropId}::${kurz}::${i}`;
        });
      }
    }
    for (const cid of Object.keys(d.arbeitsgaenge)) {
      for (const g of d.arbeitsgaenge[cid]) g.mid = `${cid}::mach::${g.m}`;
    }
    return d;
  }

  it("übersetzt Altform in die neue ID — ohne abzuzählen", () => {
    const m = migrateDomain(altstand());
    for (const c of m.catalog) for (const op of c.ops) for (const l of op.lines) {
      expect(istAltId(l.mid), `${c.cropId} ${op.code} ${l.label}`).toBe(false);
      expect(parseMeasureId(l.mid!)).not.toBeNull();
    }
    for (const cid of Object.keys(m.arbeitsgaenge)) {
      for (const g of m.arbeitsgaenge[cid]) expect(istAltId(g.mid)).toBe(false);
    }
  });

  it("kommt mit umsortierten und ergänzten Zeilen zurecht", () => {
    const alt = altstand();
    const op = alt.catalog.find((c) => c.cropId === "kartoffel_pommes")!.ops.find((o) => o.code === "OP-PSM")!;
    op.lines.reverse();
    const m = migrateDomain(alt);
    const neu = m.catalog.find((c) => c.cropId === "kartoffel_pommes")!.ops.find((o) => o.code === "OP-PSM")!;
    // Die Krautfäule-Serie behält ihre Identität, egal an welcher Stelle sie steht.
    expect(neu.lines.map((l) => l.mid)).toContain("kartoffel_pommes.PFLANZENSCHUTZ.F_KRAUTFAEULE_SERIE");
  });

  it("zieht erfasste Ist-Maßnahmen auf die neue ID mit", () => {
    const alt = altstand();
    const psm = alt.catalog.find((c) => c.cropId === "kartoffel_pommes")!.ops.find((o) => o.code === "OP-PSM")!;
    const altId = psm.lines.find((l) => /Krautf/i.test(l.label))!.mid!;
    alt.istMassnahmen = [{ id: "ist-1", measureId: altId, feldId: "F-075", ueberfahrten: 12, areaHa: 45 }];
    const m = migrateDomain(alt);
    expect(m.istMassnahmen![0].measureId).toBe("kartoffel_pommes.PFLANZENSCHUTZ.F_KRAUTFAEULE_SERIE");
  });

  it("lässt frei vergebene IDs unangetastet — sie hingen nie an einer Position", () => {
    const alt = altstand();
    const op = alt.catalog.find((c) => c.cropId === "tomate")!.ops.find((o) => o.code === "OP-PSM")!;
    op.lines[0].mid = "tomate.PFLANZENSCHUTZ.EIGENE_ANWENDUNG_A1B2C3";
    const m = migrateDomain(alt);
    const neu = m.catalog.find((c) => c.cropId === "tomate")!.ops.find((o) => o.code === "OP-PSM")!;
    expect(neu.lines[0].mid).toBe("tomate.PFLANZENSCHUTZ.EIGENE_ANWENDUNG_A1B2C3");
  });
});

describe("Flächenbezug · Feld und Schlag", () => {
  const JAHR = 5;
  const e = exportMassnahmenplan(SEED, SZ, { jahr: JAHR });

  it("liefert Schema v2 mit Flächenregister", () => {
    expect(e.schema).toBe("neosfx.massnahmenplan/v2");
    expect(e.flaechen.felder.length).toBeGreaterThan(100);
    expect(e.flaechen.beregnungseinheiten.length).toBeGreaterThan(100);
    expect(e.flaechen.schlaege.every((s) => s.jahr === JAHR)).toBe(true);
  });

  it("gibt jeder Maßnahme einen Ort", () => {
    for (const m of e.measures) {
      expect(m.ziele.length, m.measureId).toBeGreaterThan(0);
      for (const z of m.ziele) expect(z.feldId).toMatch(/^F-\d+$/);
    }
  });

  it("bucht die Rodung auf den Schlag und die Spritzung auf das Feld", () => {
    const rodung = e.measures.find((m) => m.measureId === "kartoffel_pommes.ERNTE.RODUNG")!;
    const psm = e.measures.find((m) => m.measureId === "kartoffel_pommes.PFLANZENSCHUTZ.F_KRAUTFAEULE_SERIE")!;
    expect(rodung.bezug).toBe("schlag");
    expect(rodung.ziele.every((z) => !!z.schlagId)).toBe(true);
    expect(psm.bezug).toBe("feld");
    expect(psm.ziele.every((z) => z.schlagId === null)).toBe(true);
  });

  it("zählt bei Feldbezug jedes Feld genau einmal", () => {
    for (const m of e.measures.filter((x) => x.bezug === "feld")) {
      const ids = m.ziele.map((z) => z.feldId);
      expect(new Set(ids).size, m.measureId).toBe(ids.length);
    }
  });

  it("teilt Feld- und Schlagbezug dieselbe Fläche zu", () => {
    for (const cid of [...new Set(SEED.anbauplan.map((a) => a.cropId))]) {
      const ha = schlaegeOf(SEED, cid, JAHR).reduce((s, x) => s + x.areaHa, 0);
      for (const m of e.measures.filter((x) => x.cropId === cid)) {
        expect(m.flaeche.zugeteiltHa, `${m.measureId} (${m.bezug})`).toBeCloseTo(Math.round(ha * 10) / 10, 1);
      }
    }
  });

  it("löst auf Wunsch bis auf den einzelnen Auftrag auf", () => {
    const s = exportMassnahmenplan(SEED, SZ, { jahr: JAHR, aufloesung: "schlag" });
    expect(s.auftragCount).toBe(s.measures.reduce((a, m) => a + m.ziele.length, 0));
    expect(new Set(s.auftraege!.map((a) => a.auftragId)).size).toBe(s.auftragCount);
  });

  it("hält die Anbaupause über den ganzen Horizont ein", () => {
    expect(flaechenMemo(SEED).verstoesse).toEqual([]);
  });
});

describe("Ist-Daten", () => {
  it("führt jede Annahme ohne Messung als Wiedervorlage", () => {
    const w = deriveWiedervorlage(SEED, SZ);
    expect(w.length).toBe(Object.keys(SEED.assumptions).length);
    expect(w.every((r) => r.istAnzahl === 0)).toBe(true);
    expect(w[0].handlung).toBe("belegen");   // Dringendstes zuerst
  });

  it("bestätigt eine Annahme, die die Messung trifft — und meldet, wenn nicht", () => {
    const key = "yield.kartoffel_pommes";
    const plan = deriveWiedervorlage(SEED, SZ).find((r) => r.key === key)!.planwert!;
    const mit = (wert: number) => {
      const d = klon(SEED);
      d.istWerte = [{ id: "i1", key, wert, erntejahr: 2031, feldId: "F-075", quelle: "waage" }];
      return deriveWiedervorlage(d, SZ).find((r) => r.key === key)!;
    };
    expect(mit(plan).handlung).toBe("bestaetigt");
    expect(mit(plan * 0.6).handlung).toBe("abweichung");
    expect(mit(plan * 0.6).abweichung).toBeCloseTo(-0.4, 2);
  });

  it("zählt die Flächen ohne Rückmeldung, nicht die fehlenden Hektar", () => {
    const JAHR = 5;
    const d = klon(SEED);
    const mid = "kartoffel_pommes.ERNTE.RODUNG";
    const schlaege = schlaegeOf(SEED, "kartoffel_pommes", JAHR);
    d.istMassnahmen = schlaege.slice(0, 3).map((s, i) => ({
      id: `ist-${i}`, measureId: mid, schlagId: s.id, feldId: s.feldId,
      erntejahr: 2032, areaHa: s.areaHa, ueberfahrten: 1, quelle: "fms" as const,
    }));
    const row = deriveIstAbgleich(d, SZ, JAHR).find((r) => r.measureId === mid)!;
    expect(row.istAnzahl).toBe(3);
    expect(row.offeneZiele).toBe(schlaege.length - 3);
  });

  it("wirft eine ausgeführte Maßnahme ohne Plan nicht weg", () => {
    const d = klon(SEED);
    d.istMassnahmen = [{
      id: "ist-x", measureId: "kartoffel_pommes.PFLANZENSCHUTZ.NOTSPRITZUNG_NACH_REGEN",
      feldId: "F-075", erntejahr: 2032, areaHa: 45, ueberfahrten: 1, ungeplant: true,
    }];
    const rows = deriveIstAbgleich(d, SZ, 5);
    const x = rows.find((r) => r.ungeplant)!;
    expect(x).toBeTruthy();
    expect(x.fachbereich).toBe("PFLANZENSCHUTZ");
    expect(x.planFlaecheHa).toBe(0);
  });

  it("verändert die Rechnung nicht — Ist-Daten belegen, sie ersetzen nicht", () => {
    const d = klon(SEED);
    d.istWerte = [{ id: "i1", key: "yield.kartoffel_pommes", wert: 1, erntejahr: 2031 }];
    const ohne = deriveCropMassnahmen(SEED, "kartoffel_pommes", SZ, 0).totals.totalCent;
    const mit = deriveCropMassnahmen(d, "kartoffel_pommes", SZ, 0).totals.totalCent;
    expect(mit).toBe(ohne);
  });
});
