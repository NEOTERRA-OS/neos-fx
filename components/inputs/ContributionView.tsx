"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { deriveContribution, CROP_COLOR, VALUE_CROP_IDS } from "../../store/model";
import { Segmented } from "../primitives/Segmented";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";

/** Margen-Ampel (3 positive Stufen): <0 rot (Verlust) · 0–20 % neutral (dünn) ·
 *  20–40 % amber (solide) · ≥40 % grün (stark). Reserviert Grün für die echten Top-Kulturen. */
function marginColor(m: number): string {
  if (m < 0) return "var(--nx-error)";
  if (m >= 0.4) return "var(--nx-success)";
  if (m >= 0.2) return "var(--nx-warning)";
  return "var(--nx-text)";
}

/** Contribution-Chart: Ergebnisbeitrag je Kultur, gruppiert Wertkulturen vs. Rotation.
 *  Umschaltbar: Deckungsbeitrag (über Direktkosten) oder Vollkosten-Betriebsergebnis (reconciled auf §3). */
export function ContributionView() {
  const domain = useModelStore((s) => s.domain);
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);
  const [mode, setMode] = React.useState<"db" | "be">("db");
  // Gescopte Domäne → bei STUFE 1 (Cash-only) konsistent zur GuV/KpiBand (keine Wertkulturen).
  const full = React.useMemo(() => deriveContribution(domain, sc), [domain, sc, tick]);
  // NUR WERTKULTUREN: Rotations-/Trockenkulturen können nur noch aus gespeicherten Altständen
  //  kommen — sie gehören nicht in den Ergebnisbeitrag des Wertkultur-Modells. Die Summen werden
  //  auf die dargestellten Zeilen neu gebildet, damit Balken, Σ und Marge zusammenpassen.
  const res = React.useMemo(() => {
    const crops = full.crops.filter((c) => VALUE_CROP_IDS.includes(c.cropId));
    const sum = (f: (c: typeof crops[number]) => number) => crops.reduce((s, c) => s + f(c), 0);
    return { ...full, crops,
      totals: { ...full.totals,
        valueCent: sum((c) => c.contributionCent), breakCent: 0,
        valueBeCent: sum((c) => c.betriebsergebnisCent), breakBeCent: 0 } };
  }, [full]);

  const val = (c: any) => (mode === "be" ? c.betriebsergebnisCent : c.contributionCent);
  const perHa = (c: any) => (mode === "be" ? c.bePerHaCent : c.contribPerHaCent);
  const T = res.totals as any;
  const totalValue = mode === "be" ? T.valueBeCent : T.valueCent;
  const totalBreak = mode === "be" ? T.breakBeCent : T.breakCent;
  const totalAll = mode === "be" ? T.totalBeCent : T.totalCent;
  const breakShare = mode === "be" ? (res as any).breakShareBe : res.breakShare;
  const valueShare = totalAll > 0 ? totalValue / totalAll : 0;
  const label = mode === "be" ? t("Betriebsergebnis (Vollkosten)") : t("Deckungsbeitrag (Direktkosten)");
  const maxAbs = Math.max(1, ...res.crops.map((c) => Math.abs(val(c))));

  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Ergebnisbeitrag je Kultur")}</h2>
          <div className="flex items-center gap-4">
            <Segmented ariaLabel={t("Sicht")} value={mode} onChange={(v) => setMode(v as "db" | "be")}
              options={[{ value: "db", label: t("Deckungsbeitrag") }, { value: "be", label: t("Vollkosten-BE") }]} />
            <span className="num text-[12px]">{t("Rotation-Anteil")} <b style={{ color: breakShare < 0.05 ? "var(--nx-success)" : "var(--nx-warning)" }}>{fmtNumber(breakShare * 100, 1)} %</b></span>
          </div>
        </div>

        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border-divider)" }}>
          <div className="mb-1 flex items-center justify-between text-[11px] text-nx-text-muted">
            <span>{label} · Σ {fmtMoney(totalAll)} €</span>
            {(() => { const trev = res.crops.reduce((s, c) => s + c.revenueCent + c.subsidyCent, 0); const m = trev > 0 ? totalAll / trev : 0;
              return <span className="num">{t("Ø Marge")} <b style={{ color: m >= 0.4 ? "var(--nx-success)" : "var(--nx-text)" }}>{fmtNumber(m * 100, 1)} %</b></span>; })()}
          </div>
          <div className="flex h-6 w-full overflow-hidden rounded-control" style={{ background: "var(--nx-surface-sunken)" }}>
            <div style={{ width: `${Math.max(0, valueShare) * 100}%`, background: "var(--nx-success)" }} title={`${t("Wertkulturen")} ${fmtMoney(totalValue)} €`} />
            <div style={{ width: `${Math.max(0, breakShare) * 100}%`, background: "var(--nx-warning)" }} title={`${t("Rotation")} ${fmtMoney(totalBreak)} €`} />
          </div>
          <div className="mt-1 flex justify-between text-[11px]">
            <span className="num" style={{ color: "var(--nx-success)" }}>{t("Wertkulturen")} {fmtMoney(totalValue)} € · {fmtNumber(valueShare * 100, 1)} %</span>
            <span className="num" style={{ color: "var(--nx-warning)" }}>{t("Rotation/Break")} {fmtMoney(totalBreak)} €</span>
          </div>
        </div>

        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12.5px]">
            <thead><tr className="caption text-[10.5px] text-nx-text-muted">
              <th className="px-2 py-1.5 text-left">{t("Kultur")}</th><th className="px-2 py-1.5 text-left">{t("Gruppe")}</th>
              <th className="px-2 py-1.5 text-right">{t("Fläche ha")}</th><th className="px-2 py-1.5 text-right">{t("Erlös+Förd.")}</th>
              <th className="px-2 py-1.5 text-right">{t("Kosten")}</th><th className="px-2 py-1.5 text-right">{mode === "be" ? t("BE") : t("DB")}</th>
              <th className="px-2 py-1.5 text-right">{mode === "be" ? t("BE") : t("DB")} €/ha</th>
              <th className="px-2 py-1.5 text-right">{t("Marge %")}</th><th className="px-2 py-1.5" style={{ width: 140 }}></th></tr></thead>
            <tbody>
              {res.crops.map((c) => {
                const v = val(c); const ph = perHa(c);
                const rev = c.revenueCent + c.subsidyCent;
                const cost = rev - v;
                const w = (Math.abs(v) / maxAbs) * 100;
                const neg = v < 0;
                const margin = rev > 0 ? v / rev : 0;
                return (
                  <tr key={c.cropId} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                    <td className="px-2 py-1.5"><span className="inline-flex items-center gap-2"><span style={{ width: 9, height: 9, borderRadius: 3, background: CROP_COLOR[c.cropId] ?? "var(--nx-border)", flex: "0 0 auto" }} />{t(c.name)}</span></td>
                    <td className="px-2 py-1.5 text-[11px]" style={{ color: c.group === "value" ? "var(--nx-success)" : "var(--nx-warning)" }}>{c.group === "value" ? t("Wertkultur") : t("Rotation")}</td>
                    <td className="num px-2 py-1.5 text-right text-nx-text-secondary">{fmtNumber(c.areaHa, 0)}</td>
                    <td className="num px-2 py-1.5 text-right">{fmtMoney(rev)}</td>
                    <td className="num px-2 py-1.5 text-right text-nx-text-secondary">{fmtMoney(cost)}</td>
                    <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: neg ? "var(--nx-error)" : "var(--nx-text)" }}>{neg ? "(" + fmtMoney(-v) + ")" : fmtMoney(v)}</td>
                    <td className="num px-2 py-1.5 text-right" style={{ color: ph < 0 ? "var(--nx-error)" : "var(--nx-text-secondary)" }}>{ph < 0 ? "(" + fmtMoney(-ph) + ")" : fmtMoney(ph)}</td>
                    <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: marginColor(margin) }}>{fmtNumber(margin * 100, 1)} %</td>
                    <td className="px-2 py-1.5"><div className="h-3 rounded-sm" style={{ width: `${w}%`, background: neg ? "var(--nx-error)" : c.group === "value" ? "var(--nx-success)" : "var(--nx-warning)" }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          <b>{t("Deckungsbeitrag")}</b>{t(" = Erlös + Förderung − Direktkosten (Agronomie + Maschinen-Betrieb). ")}<b>{t("Vollkosten-BE")}</b>{t(" zusätzlich − Maschinen-AfA/Zins − Personal − Fixkosten (Pacht/Overhead/Beregnung) — deckt sich mit §3 (Weizen ≈ −168, Tomate ≈ +5.001 €/ha). Immer über die volle Rotation gerechnet. Auf Vollkosten-Basis trägt die Rotation nur ~1 % — starkes Argument fürs Outsourcing.")}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
            <span className="font-semibold text-nx-text-secondary">{t("Margen-Ampel:")}</span>
            <span className="inline-flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--nx-error)", display: "inline-block" }} />{t("Verlust")}</span>
            <span className="inline-flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--nx-text)", display: "inline-block" }} />{t("< 20 % (dünn)")}</span>
            <span className="inline-flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--nx-warning)", display: "inline-block" }} />{t("20–40 % (solide)")}</span>
            <span className="inline-flex items-center gap-1"><span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--nx-success)", display: "inline-block" }} />{t("≥ 40 % (stark)")}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
