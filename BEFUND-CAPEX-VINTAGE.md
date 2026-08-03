# Geschlossen: der CAPEX-Sturz beim Wechsel der Kulturzusammensetzung

Stand 03.08.2026 · aufgeloest

## Was passiert war

Der erste Entwurf der Rotationsaenderung hat die Bruchkulturen in
`domain.anbauplan` und in den `CATALOG` aufgenommen. Der Anbauplan treibt aber
die Maschinenbemessung, den CAPEX, die Parzellen und die Kulturplaene — die
Bruchkulturen zogen damit eine eigene Technikausstattung nach sich und
verschoben zugleich die Bemessungsbasis der Vintage-Ketten.

Ergebnis: 670 statt 728 Vintage-Positionen und 16.569 statt 28.185 kEUR, obwohl
die Flotte mit 26 Einheiten identisch blieb und die Wertkulturflaechen je Jahr
sich nicht geaendert hatten.

## Warum es kein Modellfehler war

Vorgabe Betrieb 03.08.2026: **NEOTERRA baut nur Wertkulturen und
Zwischenfruechte.** Die Bruchkulturen der Rotation bewirtschaftet ein anderer
Betrieb; die Rotation wird zwischen beiden eng abgestimmt.

Damit gehoeren die Bruchkulturen ueberhaupt nicht in den Anbauplan. Die
Rotationsflaeche ist eine **Nebenbedingung, keine Kostenposition**.

## Was jetzt gilt

- `SKALIERUNG_TOTAL_HA` = Wertkulturen (300 -> 2.334 ha). Pacht, Personal,
  Maschinen und CAPEX haengen daran — unveraendert.
- `ROTATION_TOTAL_HA` = 4 x Kartoffelflaeche (1.200 -> 4.000 ha). Ausschliesslich
  Bezugsgroesse der Fruchtfolgepruefung, ueber `ModelState.rotationAreaHa`.
- `BREAK_TOTAL_HA` = Flaeche des Partnerbetriebs. Planungsgroesse fuer die
  Abstimmung, keine NEOTERRA-Zahl.

**CAPEX exakt 28.739 kEUR in 735 Positionen — identisch mit main.** Alle 28 Tests
gruen, Golden Files unveraendert. Das ist der Beleg: die Aenderung ist
finanziell wirkungslos und rein struktureller Natur.

Die frueher gerechnete Belastung von -0,90 Mio EUR/a entfaellt. Sie unterstellte,
NEOTERRA trage die 1.666 ha Bruchkultur selbst.
