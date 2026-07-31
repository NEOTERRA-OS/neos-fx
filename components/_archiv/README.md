# Archiv — nicht eingebunden

Ansichten, die aus der App genommen wurden, aber als Referenz erhalten bleiben.
Die Dateiendung `.archiv` haelt sie aus dem TypeScript-Build heraus.

## AnbaustrategieView.tsx.archiv (31.07.2026)
Szenarien-Simulator fuer Fruchtfolgen. Verglich urspruenglich Wertkultur-, Cash-Crop- und
Mischrotation auf der Gesamtflaeche. Nach der Solo-Umstellung blieb nur die Wertkultur-
Rotation uebrig, und die Flaechenbasis (Gesamtflaeche/Beregnungsgrad) gehoert zum
Kombimodell — die Ansicht hatte damit keine eigene Aussage mehr. Die Anbaupausen-Waechter
(Kartoffel 25 %, Doldenbluetler 20 %) laufen unabhaengig davon in der Pruefliste weiter.

## AnbauAnalysePanel.tsx.archiv · AnbauWhatIfPanel.tsx.archiv (31.07.2026)
Agronomie-Advisor und Was-waere-wenn-Panel aus dem Anbauplan. Gehoerten zur Sektion
Anbaustrategie und bewerteten Fruchtfolge-Alternativen gegen eine Baseline. Mit dem
festen Skalierungspfad je Kultur gibt es diese Alternativen im Modell nicht mehr.
Quelle: store/anbauAdvisor.ts (bleibt im Repo, aktuell ohne Aufrufer).
