# NEOTERRA — Reale John-Deere-Angebotswerte (Maschinen-TCO)

Aus verbindlichem JD-Angebot abgeleitet (Stand 21.07.2026). Diese Werte ersetzen die pauschalen
Delta-Annahmen (Rabatt 20 % / Restwert 55–45 %) für die betroffenen Maschinen.

| Maschine | Liste € | Netto-Einkauf € | Rabatt € (%) | Rücknahme/Restwert € (% v. Liste) | Wartung €/h | zu finanz. € | €/h (fin.) | Motorstd |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Traktor 6R 250 (alt) | 315.625 | 215.400 | 100.225 (31,8 %) | 116.460 (36,9 %) | 2,13 | 111.740 | 18,62 | 6.000 |
| **Traktor 6R 260** (Liste +3 %) | 325.094 | 221.862 | 103.232 (31,8 %) | 119.954 (36,9 %) | **2,20** | 115.092 | 19,18 | 6.000 |
| Traktor 8R 410 | 523.813 | 341.400 | 182.413 (34,8 %) | 177.720 (33,9 %) | 2,85 | 180.800 | 30,13 | 6.000 |
| **Traktor 8RX 410** | 686.447 | 439.000 | 247.447 (36,0 %) | 206.330 (30,1 %) | **2,91** | 250.110 | 41,69 | 6.000 |
| Mähdrescher X9 1100 | 1.290.504 | 856.000 | 434.504 (33,7 %) | 491.950 (38,1 %) | 6,44 | 380.150 | 152,06 | 2.500 |
| Mähdrescher S785i tracks | 798.029 | 605.000 | 193.029 (24,2 %) | 346.850 (43,5 %) | 6,82 | 275.210 | 110,08 | 2.500 |

Formeln (aus dem Angebot rekonstruiert): Rabatt = Liste − Netto-Einkauf (Equipment incl. warranty/transport/Farmsight);
Rücknahme = Residual value package; **zu finanzieren = Netto-Einkauf + Wartung − Rücknahme** (verifiziert);
Wartung €/h = Maintenance ÷ Motorstunden; €/h(fin.) = zu-finanzieren ÷ Motorstunden.

Im Modell übernommen: **8RX 410 → Zug (One-Pass)** und **6R 260 → Pflege/Ernte-Schlepper** mit realen
Listenpreisen, per-Maschine-Rabatt/Restwert und der Wartung als separatem Service-€/h (→ opex.machines).
CAPEX = Netto-Einkauf (ohne Wartung); AfA auf den Restwert; Wartung getrennt als Service.
Combines X9 1100 / S785i (Mähdrescher-Klasse) sind noch nicht gemappt.

Erkenntnis: realer Rabatt 24–36 % (höher als pauschal 20 %), realer Restwert 30–43 % v. Liste
(niedriger als 45/55 %). Die globalen tco.*-Defaults bleiben als editierbarer Fallback; nur die JD-Schlepper
tragen reale Overrides — die übrigen Maschinen mit Händlerangeboten nachziehen.
