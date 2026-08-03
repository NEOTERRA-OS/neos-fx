/** Jahreskennzahlen auf die Konsole — fuer Abgleich und Berichte. `npm run kennzahlen` */
import { jahreskennzahlen, rechneSzenario, SZENARIEN } from "../core/__tests__/kennzahlen";

for (const sc of SZENARIEN) {
  const m = rechneSzenario(sc.id);
  console.log(`\n=== ${sc.name} · konvergiert ${m.meta.converged} nach ${m.meta.revolverIterations} Iterationen`);
  console.log("Jahr      Umsatz     EBITDA   Ergebnis     Steuer        CFO        CFI        CFF      Kasse");
  for (const r of jahreskennzahlen(m)) {
    const f = (v: number) => (Math.round(v / 1000).toLocaleString("de-DE") + "k").padStart(11);
    console.log(r.jahr, f(r.umsatz), f(r.ebitda), f(r.ergebnis), f(r.steuer), f(r.cfo), f(r.cfi), f(r.cff), f(r.kasse));
  }
  const schlecht = m.checks.filter((c) => !c.passed);
  if (schlecht.length) {
    console.log("  Checks, die reissen:");
    for (const c of schlecht) console.log(`   ${c.severity === "error" ? "FEHLER " : "Warnung"} ${c.id.padEnd(22)} max ${Math.round(c.maxDeviation / 100).toLocaleString("de-DE")} EUR`);
  } else console.log("  alle Checks gruen");
}
