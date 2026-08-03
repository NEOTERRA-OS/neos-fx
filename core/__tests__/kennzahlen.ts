/**
 * Jahreskennzahlen je Szenario — die Grundlage der Golden Files.
 *
 * Bewusst eine schmale Auswahl: was ein Finanzierer zuerst ansieht. Ein Golden
 * File über alle 96 Perioden und jede Zeile wäre bei jeder Änderung rot und
 * damit wertlos; diese Auswahl reisst nur, wenn sich etwas Wesentliches bewegt.
 */
import { computeModel } from "../engine";
import { SEED, buildModelState, START_YEAR } from "../../store/model";
import type { ComputedModel } from "../types";

export interface Jahreszeile {
  jahr: number;
  umsatz: number;
  ebitda: number;
  ergebnis: number;
  steuer: number;
  cfo: number;
  cfi: number;
  cff: number;
  kasse: number;
  bilanzsumme: number;
}

/** Cent → Euro, kaufmännisch gerundet. Golden Files in Cent wären unleserlich. */
const eur = (c: number) => Math.round(c / 100);

function jahresSumme(v: number[], y: number, ppy: number) {
  let s = 0;
  for (let i = y * ppy; i < Math.min(v.length, (y + 1) * ppy); i++) s += v[i];
  return s;
}
function jahresEnde(v: number[], y: number, ppy: number) {
  return v[Math.min(v.length - 1, (y + 1) * ppy - 1)];
}

export function jahreskennzahlen(m: ComputedModel, ppy = 12): Jahreszeile[] {
  const n = m.pnl.revenue.values.length;
  const jahre = Math.ceil(n / ppy);
  const out: Jahreszeile[] = [];
  for (let y = 0; y < jahre; y++) {
    out.push({
      jahr: START_YEAR + y,
      umsatz: eur(jahresSumme(m.pnl.revenue.values, y, ppy)),
      ebitda: eur(jahresSumme(m.pnl.ebitda.values, y, ppy)),
      ergebnis: eur(jahresSumme(m.pnl.netIncome.values, y, ppy)),
      steuer: eur(jahresSumme(m.pnl.tax.values, y, ppy)),
      cfo: eur(jahresSumme(m.cashFlow.cfo.values, y, ppy)),
      cfi: eur(jahresSumme(m.cashFlow.cfi.values, y, ppy)),
      cff: eur(jahresSumme(m.cashFlow.cff.values, y, ppy)),
      kasse: eur(jahresEnde(m.cashFlow.closingCash.values, y, ppy)),
      bilanzsumme: eur(jahresEnde(m.balanceSheet.totalAssets.values, y, ppy)),
    });
  }
  return out;
}

export function rechneSzenario(scenarioId: string): ComputedModel {
  return computeModel(buildModelState(SEED, scenarioId), scenarioId);
}

export const SZENARIEN = SEED.scenarios.map((s) => ({ id: s.id, name: s.name }));
