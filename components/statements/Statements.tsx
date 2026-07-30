"use client";
import React from "react";
import type { ComputedModel } from "../../core/types";
import { PeriodGrid, GridRow } from "../grid/PeriodGrid";
import { t } from "../../lib/i18n";

export type StatementViewId = "pnl" | "balance" | "cashflow";

function pnlRows(c: ComputedModel): GridRow[] {
  const p = c.pnl;
  return [
    { item: p.revenue }, { item: p.subsidies }, { item: p.cogs },
    { item: p.grossProfit, emphasis: true },
    { item: p.opex },
    ...(p.coverPurchase ? [{ item: p.coverPurchase }] : []), { item: p.ebitda, emphasis: true },
    { item: p.depreciation }, { item: p.ebit, emphasis: true },
    { item: p.interest }, { item: p.pbt, emphasis: true },
    { item: p.currentTax, level: 1 }, { item: p.deferredTax, level: 1 }, { item: p.tax },
    { item: p.netIncome, emphasis: true },
  ];
}
function balanceRows(c: ComputedModel): GridRow[] {
  const b = c.balanceSheet;
  return [
    { item: b.cash }, { item: b.receivables }, { item: b.inventory },
    ...(b.vatReceivable ? [{ item: b.vatReceivable }] : []),
    { item: b.biologicalAssets }, { item: b.land }, { item: b.ppeNet },
    { item: b.totalAssets, emphasis: true },
    { item: b.payables },
    ...(b.customerAdvances ? [{ item: b.customerAdvances }] : []),
    { item: b.debt }, { item: b.revolver }, { item: b.deferredTaxLiability },
    ...(b.vatPayable ? [{ item: b.vatPayable }] : []),
    { item: b.totalLiabilities, emphasis: true },
    { item: b.shareCapital }, { item: b.retainedEarnings },
    { item: b.totalEquity, emphasis: true },
    { item: b.liabilitiesAndEquity, emphasis: true },
  ];
}
function cashflowRows(c: ComputedModel): GridRow[] {
  const cf = c.cashFlow;
  return [
    { item: cf.netIncome }, { item: cf.addBackDepreciation }, { item: cf.addBackFvBio },
    { item: cf.changeInWorkingCapital },
    ...(cf.customerAdvanceMovement ? [{ item: cf.customerAdvanceMovement }] : []),
    ...(cf.bioAssetMovement ? [{ item: cf.bioAssetMovement }] : []),
    { item: cf.cfo, emphasis: true },
    { item: cf.capex }, { item: cf.cfi, emphasis: true },
    { item: cf.debtDrawdowns }, { item: cf.debtRepayments }, { item: cf.revolverMovement },
    { item: cf.equityMovement }, { item: cf.interestPaid }, { item: cf.cff, emphasis: true },
    ...(cf.vatCashFlow ? [{ item: cf.vatCashFlow }] : []),
    { item: cf.netCashFlow, emphasis: true }, { item: cf.closingCash, emphasis: true },
  ];
}

const MAP: Record<StatementViewId, { title: string; rows: (c: ComputedModel) => GridRow[] }> = {
  pnl: { title: "Gewinn- und Verlustrechnung", rows: pnlRows },
  balance: { title: "Bilanz", rows: balanceRows },
  cashflow: { title: "Cashflow", rows: cashflowRows },
};

export function StatementView({
  view, computed, currency,
}: { view: StatementViewId; computed: ComputedModel; currency: "EUR" | "RON" }) {
  const def = MAP[view];
  // EINE Tabelle, die dem ZEIT-Schalter folgt: Jahr → Jahresspalten, Quartal → Quartale, Monat → alle Monate.
  const g = computed.timeline.periods[0]?.granularity;
  const gLabel = g === "year" ? t("Jahre") : g === "quarter" ? t("Quartale") : t("Monate");
  return (
    <PeriodGrid title={`${t(def.title)} (${gLabel} · ${t("ZEIT-Schalter")})`} timeline={computed.timeline} rows={def.rows(computed)} currency={currency} />
  );
}
