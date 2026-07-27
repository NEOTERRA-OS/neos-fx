/** Kleine Finanzmathematik für die Analyse-Module (App-seitig, auf dem reinen Kern). */

export function npv(cashflows: number[], rate: number): number {
  return cashflows.reduce((a, cf, i) => a + cf / Math.pow(1 + rate, i), 0);
}

/** IRR per Bisektion; NaN ohne Vorzeichenwechsel. cashflows[0] = t0. */
export function irr(cashflows: number[]): number {
  const f = (r: number) => cashflows.reduce((a, cf, i) => a + cf / Math.pow(1 + r, i), 0);
  let lo = -0.9, hi = 2.0;
  if (f(lo) * f(hi) > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    if (f(m) > 0) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
