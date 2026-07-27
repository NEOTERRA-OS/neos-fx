import { readAssumption } from "../../store/modelStore";
import { CROP_NAME, CROP_COLOR } from "../../store/model";
import type { Domain } from "../../store/model";
import { t } from "../../lib/i18n";

/** Rain-fed-Ertragsabschlag ggü. beregnet (Süd-Dolj Trockenrotation, Richtwert).
 *  Bewusst konservativ — Trockenrotation liefert ~60 % des Beregnungsertrags. */
export const DRY_YIELD_FACTOR = 0.6;

export const cropYield = (d: Domain, cropId: string, sc: string) => readAssumption(d, `yield.${cropId}`, sc) ?? 0; // t/ha
export const cropLoss = (d: Domain, cropId: string, sc: string) => readAssumption(d, `loss.${cropId}`, sc) ?? 0;    // 0..1
export const cropPrice = (d: Domain, cropId: string, sc: string) => readAssumption(d, `price.${cropId}`, sc) ?? 0;  // Cent/t

/** Netto-Produktion (t) = ha × Ertrag × (1−Verlust); Trockenrotation mit Ertragsabschlag. */
export function netTonnes(d: Domain, cropId: string, sc: string, ha: number, dry = false): number {
  const y = cropYield(d, cropId, sc) * (dry ? DRY_YIELD_FACTOR : 1);
  return ha * y * (1 - cropLoss(d, cropId, sc));
}

export const cropName = (cropId: string) => t((CROP_NAME as Record<string, string>)[cropId] ?? cropId);
export const cropColor = (cropId: string) => (CROP_COLOR as Record<string, string>)[cropId] ?? "#7BB661";

export type CropRow = { cropId: string; name: string; color: string; ha: number; yieldTHa: number; lossPct: number; tonnes: number; dry: boolean };

/** Anbaustruktur einer Fläche: beregneter Block (Anbauplan-Anteile → irrHa) +
 *  unberegneter Block (Trockenrotation → dryHa). Liefert je Kultur ha & Netto-t. */
export function cropStructure(d: Domain, sc: string, irrHa: number, dryHa: number): CropRow[] {
  const rows: CropRow[] = [];
  const baseIrr = d.anbauplan.reduce((s, e) => s + e.areaHa, 0) || 1;
  const irrScale = irrHa / baseIrr;
  for (const e of d.anbauplan) {
    const ha = e.areaHa * irrScale;
    rows.push({ cropId: e.cropId, name: cropName(e.cropId), color: cropColor(e.cropId), ha,
      yieldTHa: cropYield(d, e.cropId, sc), lossPct: cropLoss(d, e.cropId, sc), tonnes: netTonnes(d, e.cropId, sc, ha, false), dry: false });
  }
  const rot = d.growth?.drylandRotation ?? [];
  for (const r of rot) {
    const ha = dryHa * r.sharePct;
    // Label-Override (z. B. Wintergerste OHNE Doppel-Soja — Soja/Mais sind nie trocken).
    rows.push({ cropId: r.cropId, name: (r as any).label ?? cropName(r.cropId), color: cropColor(r.cropId), ha,
      yieldTHa: cropYield(d, r.cropId, sc) * DRY_YIELD_FACTOR, lossPct: cropLoss(d, r.cropId, sc), tonnes: netTonnes(d, r.cropId, sc, ha, true), dry: true });
  }
  return rows;
}
