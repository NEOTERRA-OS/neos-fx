# Offener Befund: CAPEX-Sturz beim Wechsel der Kulturzusammensetzung

Stand 03.08.2026 · Zweig `rotation-4000ha` gegen `main`

## Was gemessen ist

|  | `main` (2.334 ha) | `rotation-4000ha` (4.000 ha) | Differenz |
|---|---:|---:|---:|
| Maschinen-Vintage-Positionen | 728 | 670 | −58 |
| Maschinen-Vintage-Betrag | 28.185 kEUR | 16.569 kEUR | **−11.616 kEUR** |
| CAPEX gesamt | 28.739 kEUR | 17.072 kEUR | −11.667 kEUR |
| **Flottengroesse** | **26 Einheiten** | **26 Einheiten** | **0** |

Die Richtung ist falsch: mehr Flaeche muss mehr CAPEX bedeuten, nicht 41 % weniger.

## Was daraus folgt

Der Maschinenbedarf ist **nicht** die Ursache — `machineFleetCount` liefert auf
beiden Staenden dieselben 26 Einheiten. Dieselbe Flotte erzeugt unterschiedlich
viele Vintage-Ketten mit unterschiedlichen Betraegen.

Die Positionen fallen um 8 %, der Betrag um 41 %. Es sind also nicht nur weniger
Ersatzkaeufe, sondern auch andere Einzelbetraege.

## Wo es sitzt

`store/model.ts`, `mkChain()` in `deriveCapex` (um Zeile 6558):

```ts
capexMY.push({
  ...ci, id: `${ci.id}-c${py}-${age}-${capexMY.length}`,
  amount: Math.round(netCent * inf), ...
});
```

Zwei Dinge stehen hier zusammen, die nicht zusammengehoeren:

1. Die **ID traegt `capexMY.length`** — einen Zaehler ueber das Array, in das
   gerade geschrieben wird. Damit haengt die Identitaet einer
   Investitionsposition von der Reihenfolge und Anzahl aller anderen ab. Das ist
   dieselbe Fehlerklasse wie die `measureId`, die das Deep Review als Hindernis
   fuer die NEOS-Farm-Kopplung benannt hat.
2. `startY` (= Bedarfsjahr) und `netCent` bestimmen Kettenlaenge und Betrag.
   Beide haengen ueber `cropAreasMemo` an der Kulturzusammensetzung.

## Naechster Schritt, konkret

`mkChain` je Maschine instrumentieren und `startY`, `netCent`, `firstDispAge`,
`C`, `L` auf beiden Zweigen ausgeben und diffen. Ein Lauf genuegt, um zu
entscheiden, ob die Kettenverkuerzung sachlich richtig ist (spaeteres
Bedarfsjahr) oder ein Artefakt der positionsabhaengigen Buchfuehrung.

**Bis dahin bleiben die Golden Files rot.** Ein Ergebnis, das niemand erklaeren
kann, wird nicht zum neuen Sollwert erklaert — das ist der Zweck, zu dem sie
gebaut wurden.
