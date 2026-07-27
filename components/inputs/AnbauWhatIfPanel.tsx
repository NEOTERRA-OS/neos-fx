"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { fmtMoney, fmtNumber } from "../../design/format";
import { cropName } from "./cropCalc";
import { scoreAnbau, type AdviceItem } from "../../store/anbauAdvisor";
import { t } from "../../lib/i18n";

/** What-if — bewertet die aktuelle Planänderung gegen einen Baseline-Snapshot: Flächen-Diff,
 *  ΔDeckungsbeitrag, ΔRisiko (Advisor), ΔWasserbedarf + neu entstandene / behobene Hinweise. */
export function AnbauWhatIfPanel() {
  const domain = useModelStore((s) => s.domain);
  const patch = useModelStore((s) => s.patch);
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);
  const baseline = domain.anbauBaseline;
  const border = "var(--nx-border)", surface = "var(--nx-surface)";
  const pos = "var(--nx-pos, #2E7D32)", neg = "var(--nx-neg, #C62828)";

  // Baseline je Kultur AGGREGIERT (Duplikat-Einträge derselben Kultur sonst doppelt gezählt).
  const setBaseline = () => patch((d) => {
    const agg = new Map<string, number>();
    for (const e of d.anbauplan) agg.set(e.cropId, (agg.get(e.cropId) ?? 0) + e.areaHa);
    d.anbauBaseline = [...agg].map(([cropId, areaHa]) => ({ cropId, areaHa }));
  });
  const clearBaseline = () => patch((d) => { delete d.anbauBaseline; });

  const cmp = React.useMemo(() => {
    if (!baseline?.length) return null;
    const bMap = new Map(baseline.map((b) => [b.cropId, b.areaHa]));
    // Duplikat-sicher: Baseline-Fläche je Kultur auf den ERSTEN Eintrag legen, weitere auf 0.
    const seen = new Set<string>();
    const baseDomain: any = { ...domain, anbauplan: domain.anbauplan.map((e) => {
      const first = !seen.has(e.cropId); seen.add(e.cropId);
      return { ...e, areaHa: first ? (bMap.get(e.cropId) ?? 0) : 0 };
    }) };
    const cur = scoreAnbau(domain, sc);
    const base = scoreAnbau(baseDomain, sc);
    const key = (i: AdviceItem) => i.id;
    const curBad = cur.items.filter((i) => i.severity === "warning" || i.severity === "risk");
    const baseBad = base.items.filter((i) => i.severity === "warning" || i.severity === "risk");
    const introduced = curBad.filter((i) => !baseBad.some((b) => key(b) === key(i)));
    const resolved = baseBad.filter((i) => !curBad.some((c) => key(c) === key(i)));
    const curAgg = new Map<string, number>();
    for (const e of domain.anbauplan) curAgg.set(e.cropId, (curAgg.get(e.cropId) ?? 0) + e.areaHa);
    const rows = [...curAgg].map(([cropId, cur]) => ({ cropId, base: bMap.get(cropId) ?? 0, cur }))
      .filter((r) => Math.abs(r.cur - r.base) > 0.5)
      .sort((a, b) => Math.abs(b.cur - b.base) - Math.abs(a.cur - a.base));
    return { cur, base, introduced, resolved, rows };
  }, [domain, baseline, sc, tick]);

  const Kpi = ({ label, delta, unit, goodWhenNeg, money }: { label: string; delta: number; unit?: string; goodWhenNeg?: boolean; money?: boolean }) => {
    const good = goodWhenNeg ? delta < 0 : delta > 0;
    const neutral = Math.abs(delta) < (money ? 100 : 0.01);
    const col = neutral ? "var(--nx-text)" : good ? pos : neg;
    return (
      <div>
        <div className="caption text-[10px] text-nx-text-muted uppercase tracking-wide">{label}</div>
        <div className="text-[16px] font-semibold num" style={{ color: col }}>
          {delta > 0 ? "+" : ""}{money ? fmtMoney(delta) + " €" : `${fmtNumber(delta, unit === "pp" ? 1 : 1)}${unit ? " " + unit : ""}`}
        </div>
      </div>
    );
  };

  return (
    <section className="rounded-tile border" style={{ borderColor: border, background: surface }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: border }}>
        <h2 className="text-[14px] font-semibold">{t("Was-wäre-wenn — Planänderung bewerten")}</h2>
        <div className="flex items-center gap-2">
          <button onClick={setBaseline} className="px-2.5 py-1 rounded-md text-[12px] border" style={{ borderColor: border }}>{t("Baseline = aktueller Plan")}</button>
          {baseline?.length ? <button onClick={clearBaseline} className="px-2.5 py-1 rounded-md text-[12px] border" style={{ borderColor: border, color: "var(--nx-text-muted)" }}>{t("zurücksetzen")}</button> : null}
        </div>
      </div>

      {!cmp ? (
        <p className="px-4 py-3 text-[11.5px] text-nx-text-secondary">
          {t("Setze mit „Baseline = aktueller Plan\" einen Referenzstand. Danach zeigt dieses Panel bei jeder Änderung, wie sich Deckungsbeitrag, agronomisches Risiko und Wasserbedarf verschieben — und welche Hinweise neu entstehen oder wegfallen.")}
        </p>
      ) : (
        <>
          <div className="px-4 py-3 grid gap-4 sm:grid-cols-4 border-b" style={{ borderColor: border }}>
            <Kpi label={t("Δ Deckungsbeitrag")} delta={cmp.cur.dbCent - cmp.base.dbCent} money />
            <Kpi label={t("Δ Risiko-Score (Advisor)")} delta={cmp.cur.riskWeight - cmp.base.riskWeight} goodWhenNeg />
            <Kpi label={t("Δ Wasserbedarf")} delta={cmp.cur.waterMm - cmp.base.waterMm} unit="mm" goodWhenNeg />
            <Kpi label={t("Δ Wertkultur-Anteil")} delta={(cmp.cur.valueShare - cmp.base.valueShare) * 100} unit="pp" />
          </div>

          {cmp.rows.length > 0 && (
            <div className="px-4 py-2 border-b" style={{ borderColor: border }}>
              <div className="caption text-[10px] font-semibold uppercase tracking-wide text-nx-text-muted mb-1">{t("Flächen-Änderung")}</div>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {cmp.rows.map((r) => (
                  <span key={r.cropId} className="text-[11.5px] num">
                    {cropName(r.cropId)}: {fmtNumber(r.base, 0)} → <b>{fmtNumber(r.cur, 0)}</b> ha
                    <span style={{ color: r.cur > r.base ? pos : neg }}> ({r.cur > r.base ? "+" : ""}{fmtNumber(r.cur - r.base, 0)})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="px-4 py-2.5 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="caption text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: neg }}>{t("▲ Neu entstandene Hinweise")} ({cmp.introduced.length})</div>
              {cmp.introduced.length ? (
                <ul className="space-y-1">{cmp.introduced.map((i) => <li key={i.id} className="text-[11.5px]"><b>{i.title}</b>{i.metric ? <span className="num text-nx-text-muted"> · {i.metric}</span> : null}</li>)}</ul>
              ) : <span className="text-[11.5px] text-nx-text-muted">{t("— keine —")}</span>}
            </div>
            <div>
              <div className="caption text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: pos }}>{t("✓ Behobene Hinweise")} ({cmp.resolved.length})</div>
              {cmp.resolved.length ? (
                <ul className="space-y-1">{cmp.resolved.map((i) => <li key={i.id} className="text-[11.5px]"><b>{i.title}</b></li>)}</ul>
              ) : <span className="text-[11.5px] text-nx-text-muted">{t("— keine —")}</span>}
            </div>
          </div>
          <div className="px-4 pb-3 text-[11px] text-nx-text-muted">
            {t("Δ Deckungsbeitrag aus dem Modell (Contribution je Kultur × Fläche). Risiko-Score gewichtet die Advisor-Hinweise (Risiko ×3, Warnung ×1, Empfehlung ×0,3) — niedriger ist besser. Der Baseline-Snapshot bleibt gespeichert.")}
          </div>
        </>
      )}
    </section>
  );
}
