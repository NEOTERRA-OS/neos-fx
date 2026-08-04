/**
 * Felder, Beregnungseinheiten und Schläge — die Flächenidentität des Modells.
 *
 * Warum es diese Datei gibt: NEOS FX kannte bis 03.08.2026 keine Fläche als
 * Entität. Es gab `Parcel`, aber synthetisch je Anbauplanzeile erzeugt
 * (`parcel-${a.id}`, Name „Kultur · ha"), ohne Geometrie und ohne Bestand über
 * Planänderungen hinweg. Das Modell kannte Kultur × Hektarsumme, keinen Ort.
 * Für einen Arbeitsauftrag ist das zu wenig: eine Maßnahme über 500 ha Kartoffel
 * ist keine Aufgabe, sondern eine Position.
 *
 * Drei Ebenen, weil die Wirklichkeit drei hat:
 *
 *   Feld                dauerhafte Identität der Fläche. Feldnummer und
 *                       Feldgrenze überleben jede Fruchtfolge und jeden
 *                       Pachtvertrag. Daran hängen Bodenproben, Nematoden-
 *                       befunde, Anbaupausen und Ertragshistorie.
 *
 *   Beregnungseinheit   Pivot oder Linear, eigene Nummerierung. n:m zum Feld —
 *                       ein Linear bedient regelmäßig mehrere Felder, und ein
 *                       Feld kann von mehreren Einheiten bedient werden.
 *
 *   Schlag              Feld × Jahr × Kultur × Sorte. Zwei Sorten auf einem
 *                       Feld sind zwei Schläge: Markies als vorgezogene
 *                       Hauptkultur und eine second early mit hoher TS (Sinora
 *                       oder Quintera) reifen unterschiedlich ab und brauchen
 *                       getrennte Rode- und Sikkationstermine. „Roden" zeigt
 *                       auf den Schlag, „spritzen" darf auf das Feld zeigen.
 *                       (Frieslander ist am 31.07.2026 ausgeschieden — kein
 *                       aktiver Erhalter, Pflanzgut nicht beschaffbar.)
 *
 * VORLÄUFIG heißt: Größe und Lage sind geschätzt, die IDs sind es nicht. Wenn die
 * echten Felder vorliegen, ist der Übergang eine einmalige Zuordnungstabelle
 * (`F-014 → "Nedeia Nord 3"`); alles, was daran hängt, folgt automatisch.
 * Was NICHT funktioniert: IDs aus etwas ableiten, das sich ändert.
 */
import type { Feld, Beregnungseinheit, Schlag, SortenAnteil } from "../core/types";

/** Typische Feldgröße (ha). Annahme, bis die echten Feldgrenzen vorliegen. */
export const FELDGROESSE_HA_DEFAULT = 45;

/** Anteil der Fläche, den ein Linear bedient (Rest Pivot). Annahme. */
export const LINEAR_ANTEIL_DEFAULT = 0.25;

/** Felder je Linear-Einheit — ein Linear bedient rechteckige Flächen und damit
 *  regelmäßig mehrere Felder. Pivots bedienen genau eines. */
export const FELDER_JE_LINEAR = 3;

export interface FlaechenOptionen {
  feldgroesseHa?: number;
  linearAnteil?: number;
}

/** Felder für die größte im Plan vorkommende Fläche. Bewusst EINMAL für den
 *  Endausbau erzeugt und nicht je Jahr neu: ein Feld entsteht nicht dadurch, dass
 *  es bewirtschaftet wird. In frühen Jahren liegt ein Teil schlicht brach. */
export function buildFelder(maxAreaHa: number, opt: FlaechenOptionen = {}): Feld[] {
  const groesse = opt.feldgroesseHa ?? FELDGROESSE_HA_DEFAULT;
  const n = Math.max(1, Math.ceil(maxAreaHa / groesse));
  const rest = maxAreaHa - (n - 1) * groesse;
  return Array.from({ length: n }, (_, i) => ({
    id: `F-${String(i + 1).padStart(3, "0")}`,
    nummer: `F-${String(i + 1).padStart(3, "0")}`,
    areaHa: i === n - 1 ? Math.round(rest * 10) / 10 : groesse,
    vorlaeufig: true,
  }));
}

/** Beregnungseinheiten über den Feldern. Pivots decken je ein Feld, Linears je
 *  mehrere — das ist der Grund, warum die Beziehung n:m ist und nicht 1:1. */
export function buildBeregnungseinheiten(
  felder: Feld[], opt: FlaechenOptionen = {},
): Beregnungseinheit[] {
  const linearAnteil = opt.linearAnteil ?? LINEAR_ANTEIL_DEFAULT;
  const gesamt = felder.reduce((s, f) => s + f.areaHa, 0);
  const zielLinearHa = gesamt * linearAnteil;

  const out: Beregnungseinheit[] = [];
  let i = 0, linearHa = 0, nLin = 0, nPiv = 0;
  while (i < felder.length) {
    if (linearHa < zielLinearHa) {
      const gruppe = felder.slice(i, i + FELDER_JE_LINEAR);
      const ha = gruppe.reduce((s, f) => s + f.areaHa, 0);
      nLin += 1;
      out.push({
        id: `L-${String(nLin).padStart(2, "0")}`,
        nummer: `L-${String(nLin).padStart(2, "0")}`,
        typ: "linear", areaHa: Math.round(ha * 10) / 10,
        feldIds: gruppe.map((f) => f.id), vorlaeufig: true,
      });
      linearHa += ha; i += gruppe.length;
    } else {
      const f = felder[i];
      nPiv += 1;
      out.push({
        id: `P-${String(nPiv).padStart(3, "0")}`,
        nummer: `P-${String(nPiv).padStart(3, "0")}`,
        typ: "pivot", areaHa: f.areaHa, feldIds: [f.id], vorlaeufig: true,
      });
      i += 1;
    }
  }
  return out;
}

/** Kleinster Schlag, den die Zuteilung noch erzeugt (ha). Darunter wird ein Feld
 *  nicht mehr geteilt — ein 2-ha-Zipfel ist kein Arbeitsauftrag. */
export const MIN_SCHLAG_HA = 5;

/** Sortenname → ID-tauglicher Bestandteil. Die Schlag-ID wandert in den
 *  Arbeitsauftrag und damit über Systemgrenzen; Leerzeichen und Umlaute haben
 *  dort nichts zu suchen. Der ANZEIGENAME bleibt unverändert in `Schlag.sorte`. */
export function sortenSlug(name: string): string {
  return String(name ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "SORTE";
}

/** Anteile auf Summe 1 normieren. Nimmt Prozentzahlen genauso wie Quoten an und
 *  wirft Sorten mit Anteil 0 heraus. Ohne verwertbare Eingabe bleibt ein
 *  sortenloser Eintrag übrig — dann verhält sich die Zuteilung wie vorher. */
export function normSortenanteile(list?: SortenAnteil[]): { sorte?: string; anteil: number }[] {
  const gefiltert = (list ?? []).filter((s) => s?.sorte && Number.isFinite(s.anteil) && s.anteil > 0);
  const summe = gefiltert.reduce((s, a) => s + a.anteil, 0);
  if (!gefiltert.length || summe <= 0) return [{ sorte: undefined, anteil: 1 }];
  return gefiltert.map((a) => ({ sorte: a.sorte, anteil: a.anteil / summe }));
}

/** Wirtsgruppe je Kultur — für die Anbaupause. Kulturen derselben Gruppe teilen
 *  sich die Pause; sie dürfen nicht kurz hintereinander auf dasselbe Feld. */
export type Wirtsgruppe = { id: string; pauseYears: number; cropIds: string[] };

export interface SchlagPlanEingabe {
  /** Fläche je Kultur und Planjahr: areas[cropId][jahr] in ha. */
  areas: Record<string, number[]>;
  /** Kulturen, die als Zweitnutzung laufen (Zwischenfrucht) — sie belegen kein
   *  eigenes Feld, sondern stehen auf dem der Hauptkultur. */
  zweitnutzung?: Set<string>;
  /** Sortenanteile je Kultur. Mehrere Sorten ergeben mehrere Schläge.
   *  Fehlt der Eintrag, entsteht ein sortenloser Schlag je Feld — der Zustand
   *  bis 04.08.2026. */
  sorten?: Record<string, SortenAnteil[]>;
  wirtsgruppen: Wirtsgruppe[];
  jahre: number;
}

export interface SchlagPlanErgebnis {
  schlaege: Schlag[];
  /** Verstöße gegen die Anbaupause, die die Zuteilung nicht auflösen konnte. */
  verstoesse: { feldId: string; gruppe: string; jahr: number; abstand: number }[];
}

/**
 * Weist Kulturen deterministisch auf Felder zu und hält dabei die Anbaupause je
 * Feld ein — nicht als Flächenanteil, sondern als echte Historie.
 *
 * Das ist der eigentliche Gewinn gegenüber der bisherigen Prüfung. „25 % der
 * Fläche" sagt nichts darüber, ob dieselbe physische Fläche zweimal hintereinander
 * Kartoffel trägt. Diese Zuteilung sagt es, und sie sagt zugleich, ob der Plan
 * überhaupt aufgeht: bleiben Verstöße übrig, ist die Fruchtfolge nicht nur
 * rechnerisch, sondern tatsächlich zu eng.
 *
 * Verfahren: je Jahr und Kultur werden die Felder bevorzugt, deren letzte Belegung
 * mit derselben Wirtsgruppe am längsten zurückliegt. Deterministisch, ohne Zufall —
 * zweimal derselbe Plan ergibt dieselbe Zuteilung.
 */
export function buildSchlaege(
  felder: Feld[], ein: SchlagPlanEingabe,
): SchlagPlanErgebnis {
  /* Eine Kultur kann MEHREREN Wirtsgruppen angehoeren. `zwiebel_moehre` ist eine
   *  Mischposition aus Zwiebel (Alliaceen) und Moehre (Apiaceen) und traegt beide
   *  Anbaupausen. Eine einfache Zuordnung Kultur -> Gruppe verliert genau diesen
   *  Fall — und zwar still. */
  const gruppenVon = new Map<string, Wirtsgruppe[]>();
  for (const g of ein.wirtsgruppen) for (const c of g.cropIds) {
    const a = gruppenVon.get(c) ?? []; a.push(g); gruppenVon.set(c, a);
  }

  /** letzte Belegung je Feld und Wirtsgruppe (Jahresindex). */
  const letzte = new Map<string, number>();
  const key = (feldId: string, gruppe: string) => `${feldId}::${gruppe}`;
  const schlaege: Schlag[] = [];
  const verstoesse: SchlagPlanErgebnis["verstoesse"] = [];

  for (let jahr = 0; jahr < ein.jahre; jahr++) {
    // Belegte Felder dieses Jahres — ein Feld trägt eine Hauptkultur.
    const belegt = new Set<string>();

    // Große Kulturen zuerst: sie haben die wenigsten Ausweichmöglichkeiten.
    const kulturen = Object.keys(ein.areas)
      .filter((c) => !ein.zweitnutzung?.has(c) && (ein.areas[c]?.[jahr] ?? 0) > 0)
      .sort((a, b) => (ein.areas[b][jahr] ?? 0) - (ein.areas[a][jahr] ?? 0));

    for (const cropId of kulturen) {
      let rest = ein.areas[cropId][jahr] ?? 0;
      const gruppen = gruppenVon.get(cropId) ?? [];
      // Abstand = der KNAPPSTE ueber alle Wirtsgruppen der Kultur. Wer zu zwei
      //  Familien gehoert, muss beide Pausen einhalten, nicht die bequemere.
      const engster = (feldId: string) => gruppen.length === 0
        ? jahr - (letzte.get(key(feldId, cropId)) ?? -999)
        : Math.min(...gruppen.map((g) => {
            const l = letzte.get(key(feldId, g.id));
            return l === undefined ? 999 : (jahr - l) - (g.pauseYears - 1);
          }));

      const kandidaten = felder
        .filter((f) => !belegt.has(f.id))
        .map((f) => ({ f, abstand: engster(f.id) }))
        .sort((a, b) => b.abstand - a.abstand);

      /* SORTENZUTEILUNG. Bis 04.08.2026 liefen die Sorten hier REIHUM ueber die
       *  Felder. Das ist genau dann richtig, wenn alle Sorten denselben Anteil
       *  haben und alle Felder gleich gross sind — und sonst nie. Bei 40/35/25
       *  auf 55 Feldern lag die reihum verteilte Menge bis zu 15 Prozentpunkte
       *  neben dem Plan, ohne dass irgendwo eine Warnung entstanden waere.
       *
       *  Jetzt bekommt jede Sorte ein Soll in Hektar (Anteil x Kulturflaeche des
       *  Jahres), und jedes Feld geht an die Sorte mit dem groessten Rueckstand.
       *  Ein Feld darf dabei geteilt werden — Markies und eine second early auf
       *  demselben Feld sind zwei Schlaege, weil sie zu verschiedenen Terminen
       *  gerodet werden. Unterhalb von MIN_SCHLAG_HA wird nicht geteilt: ein
       *  2-ha-Zipfel ist kein Arbeitsauftrag, sondern ein Rundungsrest. */
      const anteile = normSortenanteile(ein.sorten?.[cropId]);
      const gesamtHa = ein.areas[cropId][jahr] ?? 0;
      const soll = anteile.map((a) => a.anteil * gesamtHa);
      const ist = anteile.map(() => 0);

      for (const k of kandidaten) {
        if (rest <= 0.01) break;
        const nutz = Math.min(k.f.areaHa, rest);
        for (const g of gruppen) {
          const l = letzte.get(key(k.f.id, g.id));
          if (l !== undefined && jahr - l < g.pauseYears) {
            verstoesse.push({ feldId: k.f.id, gruppe: g.id, jahr, abstand: jahr - l });
          }
        }
        // Feld auf die Sorten aufteilen, groesster Rueckstand zuerst.
        const aufFeld = new Map<number, number>();
        let offen = nutz;
        while (offen > 0.01) {
          let bi = 0, bd = -Infinity;
          for (let i = 0; i < anteile.length; i++) {
            const d = soll[i] - ist[i];
            if (d > bd) { bd = d; bi = i; }
          }
          let nimm = Math.min(offen, Math.max(bd, MIN_SCHLAG_HA));
          if (offen - nimm < MIN_SCHLAG_HA) nimm = offen;
          aufFeld.set(bi, (aufFeld.get(bi) ?? 0) + nimm);
          ist[bi] += nimm;
          offen -= nimm;
        }
        /* RUNDUNG MIT REST. Jeder Schlag wird auf 0,1 ha gerundet; bei drei Sorten
         *  auf einem Feld summieren sich drei Rundungen. Auf 225 ha waren das
         *  0,1 ha Drift — klein, aber es heisst, dass die Summe der Schlagflaechen
         *  nicht mehr die Kulturflaeche ist. Der LETZTE Teil bekommt deshalb den
         *  Rest, nicht seinen gerundeten Eigenwert. */
        const teile = [...aufFeld.entries()];
        let vergeben = 0;
        teile.forEach(([i, ha], n) => {
          const letzter = n === teile.length - 1;
          const flaeche = letzter
            ? Math.round((nutz - vergeben) * 10) / 10
            : Math.round(ha * 10) / 10;
          vergeben += flaeche;
          const sorte = anteile[i].sorte;
          schlaege.push({
            id: `${k.f.id}-${jahr}-${cropId}${sorte ? `-${sortenSlug(sorte)}` : ""}`,
            feldId: k.f.id, jahr, cropId, sorte,
            areaHa: flaeche,
          });
        });
        belegt.add(k.f.id);
        if (gruppen.length === 0) letzte.set(key(k.f.id, cropId), jahr);
        else for (const g of gruppen) letzte.set(key(k.f.id, g.id), jahr);
        rest -= nutz;
      }
    }

    // Zweitnutzung: steht auf den Feldern der früh räumenden Hauptkulturen,
    //  belegt also kein eigenes Feld und verdrängt nichts.
    for (const cropId of Object.keys(ein.areas)) {
      if (!ein.zweitnutzung?.has(cropId)) continue;
      let rest = ein.areas[cropId][jahr] ?? 0;
      for (const f of felder) {
        if (rest <= 0.01) break;
        if (!belegt.has(f.id)) continue;
        const nutz = Math.min(f.areaHa, rest);
        schlaege.push({
          id: `${f.id}-${jahr}-${cropId}`, feldId: f.id, jahr, cropId,
          areaHa: Math.round(nutz * 10) / 10,
        });
        rest -= nutz;
      }
    }
  }
  return { schlaege, verstoesse };
}
