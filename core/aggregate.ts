/* --------------------------------------------------------------------------
 * Aggregation — verdichtet das monatlich gerechnete ComputedModel auf Quartal
 * oder Jahr (horizont-agnostisch: funktioniert für 12 wie für 120 Perioden).
 *   · Flows (GuV, Cashflow)  → Summe je Gruppe
 *   · Stocks (Bilanz, Endkasse) → Periodenend-Wert (letzter der Gruppe)
 *   · KPI-Ratios → aus den verdichteten Statement-Zeilen neu gerechnet (nicht summiert!)
 * Checks bleiben auf der Basisgranularität (Modell-Validität), Labels werden neu vergeben.
 * ------------------------------------------------------------------------ */
import type { ComputedModel, LineItem, Timeline, Period, Granularity } from "./types";

/** Stock-Zeilen (Periodenend-Wert statt Summe). */
function isStock(key: string): boolean {
  return key.startsWith("bs.") || key === "cf.closing";
}

function groupIndices(n: number, size: number): number[][] {
  const groups: number[][] = [];
  for (let i = 0; i < n; i += size) {
    const g: number[] = [];
    for (let k = 0; k < size && i + k < n; k++) g.push(i + k);
    groups.push(g);
  }
  return groups;
}

function aggLine(li: LineItem, groups: number[][]): LineItem {
  const stock = isStock(li.key);
  const values = groups.map((idx) =>
    stock ? li.values[idx[idx.length - 1]] : idx.reduce((s, j) => s + (li.values[j] ?? 0), 0),
  );
  return { ...li, values };
}

function startYear(t: Timeline): number {
  const y = parseInt(t.startDate.slice(0, 4), 10);
  return isFinite(y) ? y : 2026;
}
function startMonth(t: Timeline): number {
  const m = parseInt(t.startDate.slice(5, 7), 10);
  return isFinite(m) && m >= 1 && m <= 12 ? m : 1;
}

function buildPeriods(t: Timeline, groups: number[][], target: Granularity): Period[] {
  const y0 = startYear(t), m0 = startMonth(t);
  return groups.map((idx, gi) => {
    const lastBase = idx[idx.length - 1];
    const endDate = t.periods[lastBase]?.endDate ?? t.periods[t.periods.length - 1]?.endDate ?? t.startDate;
    let label: string;
    if (target === "year") {
      label = String(y0 + gi);
    } else if (target === "quarter") {
      const absMonth = m0 - 1 + idx[0]; // 0-based month from start
      const yr = y0 + Math.floor(absMonth / 12);
      const q = Math.floor((absMonth % 12) / 3) + 1;
      label = `Q${q}'${String(yr).slice(2)}`;
    } else {
      label = t.periods[idx[0]]?.label ?? `P${gi + 1}`;
    }
    return { index: gi, endDate, label, granularity: target, isActual: false };
  });
}

/** Verdichtet ein monatliches ComputedModel auf die Zielgranularität. */
export function aggregateComputed(cm: ComputedModel, target: Granularity): ComputedModel {
  const base = cm.timeline.baseGranularity;
  if (target === base || target === "month") return cm;
  const perYear = 12; // Basis ist Monat
  const size = target === "year" ? perYear : target === "quarter" ? 3 : 1;
  const n = cm.timeline.periodCount;
  const groups = groupIndices(n, size);

  const mapObj = <T extends Record<string, any>>(obj: T): T => {
    const out: any = {};
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      out[k] = v && typeof v === "object" && Array.isArray(v.values) ? aggLine(v as LineItem, groups) : v;
    }
    return out;
  };

  const pnl = mapObj(cm.pnl);
  const balanceSheet = mapObj(cm.balanceSheet);
  const cashFlow = mapObj(cm.cashFlow);

  // KPIs aus verdichteten Zeilen NEU rechnen (Ratios dürfen nicht summiert werden).
  const G = groups.length;
  const val = (li: LineItem | undefined, i: number) => (li?.values?.[i] ?? 0);
  const div = (a: number, b: number) => (b !== 0 ? a / b : 0);
  const kpiVals = (fn: (i: number) => number) => Array.from({ length: G }, (_, i) => fn(i));

  const ebitdaMargin = kpiVals((i) => div(val(pnl.ebitda, i), val(pnl.revenue, i) + val(pnl.subsidies, i)));
  const netDebt = kpiVals((i) => val(balanceSheet.debt, i) + val(balanceSheet.revolver, i) - val(balanceSheet.cash, i));
  const ndToEbitda = kpiVals((i) => div(netDebt[i], val(pnl.ebitda, i)));
  const debtService = kpiVals((i) => Math.abs(val(cashFlow.debtRepayments, i)) + Math.abs(val(cashFlow.interestPaid, i)));
  const dscr = kpiVals((i) => div(val(cashFlow.cfo, i), debtService[i]));
  const icr = kpiVals((i) => div(val(pnl.ebit, i), Math.abs(val(pnl.interest, i))));
  const roic = kpiVals((i) => div(val(pnl.ebit, i), val(balanceSheet.totalEquity, i) + val(balanceSheet.debt, i) + val(balanceSheet.revolver, i)));
  const fcf = aggLine(cm.kpis.fcf, groups).values; // FCF ist ein Flow → Summe ok

  const kpis = {
    ebitdaMargin: { ...cm.kpis.ebitdaMargin, values: ebitdaMargin },
    netDebtToEbitda: { ...cm.kpis.netDebtToEbitda, values: ndToEbitda },
    dscr: { ...cm.kpis.dscr, values: dscr },
    icr: { ...cm.kpis.icr, values: icr },
    roic: { ...cm.kpis.roic, values: roic },
    fcf: { ...cm.kpis.fcf, values: fcf },
  };

  const timeline: Timeline = {
    ...cm.timeline,
    baseGranularity: target,
    periodCount: G,
    periods: buildPeriods(cm.timeline, groups, target),
  };

  return { ...cm, timeline, pnl, balanceSheet, cashFlow, kpis };
}
