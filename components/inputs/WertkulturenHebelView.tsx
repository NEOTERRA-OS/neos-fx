"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { buildModelState, deriveCapex } from "../../store/model";
import { StageSemanticsCard } from "./StageSemanticsCard";
import { computeModel } from "../../core/engine";
import { fmtMoney, fmtNumber, fmtPct } from "../../design/format";
import { NumberInput } from "./NumberInput";
import { t } from "../../lib/i18n";

/** Gesellschafter-Analyse — der Hebel der Wertkulturen.
 *  Vergleicht den reinen Ackerbaubetrieb (Stufe 1, nur Cash Crops) mit dem Gemüsebau-Betrieb
 *  (Stufe 1a, mit Wertkulturen) — plus editierbaren Ist-Stand des jetzigen Gesellschafters als
 *  Benchmark. Interpretation der Ergebniseffekte über alle Kategorien. */

type Metrics = { umsatz: number; sub: number; erloes: number; ebitda: number; ni: number; marge: number; machCapex: number; totalHa: number; ebitdaHa: number };

function metricsFor(domain: any, scenarioId: string, gStage: string): Metrics {
  const d = structuredClone(domain);
  if (d.growth) d.growth.stage = gStage;
  const c = computeModel(buildModelState(d, scenarioId), scenarioId);
  const yr0 = (li: { values: number[] }) => li.values.slice(0, 12).reduce((a, b) => a + b, 0);
  const umsatz = yr0(c.pnl.revenue), sub = yr0(c.pnl.subsidies), ebitda = yr0(c.pnl.ebitda), ni = yr0(c.pnl.netIncome);
  const erloes = umsatz + sub;
  const machCapex = deriveCapex(d, scenarioId).filter((x: any) => x.assetClass === "machinery").reduce((s: number, x: any) => s + x.amount, 0);
  const totalHa = d.growth?.startTotalHa ?? d.anbauplan.reduce((s: number, a: any) => s + a.areaHa, 0);
  return { umsatz, sub, erloes, ebitda, ni, marge: erloes > 0 ? ebitda / erloes : 0, machCapex, totalHa, ebitdaHa: totalHa > 0 ? ebitda / totalHa : 0 };
}

export function WertkulturenHebelView() {
  const domain = useModelStore((s) => s.domain);
  const scenarioId = useModelStore((s) => s.view.scenarioId);
  const currency = useModelStore((s) => s.view.currency);
  const tick = useModelStore((s) => s.recalcTick);
  const patch = useModelStore((s) => s.patch);
  const ist = domain.gesellschafterIst ?? { umsatzCent: 0, ebitdaCent: 0, netIncomeCent: 0, flaecheHa: 10000 };
  const setIst = (p: Partial<typeof ist>) => patch((d) => { d.gesellschafterIst = { ...(d.gesellschafterIst ?? ist), ...p }; });

  const { a, b } = React.useMemo(() => ({
    a: metricsFor(domain, scenarioId, "s1a"),
    b: metricsFor(domain, scenarioId, "s1"),
  }), [domain, scenarioId, tick]);

  const M = (c: number) => fmtMoney(c, currency);
  const istErloes = ist.umsatzCent; // Ist-Umsatz (inkl. evtl. Förderung, wie eingegeben)
  const istEbHa = ist.flaecheHa > 0 ? ist.ebitdaCent / ist.flaecheHa : 0;
  const hasIst = ist.umsatzCent > 0 || ist.ebitdaCent > 0;
  const istUnterBenchmark = hasIst && ist.ebitdaCent < a.ebitda;

  const facEbitda = a.ebitda > 0 ? b.ebitda / a.ebitda : 0;
  const facUmsatz = a.umsatz > 0 ? b.umsatz / a.umsatz : 0;

  // Balkenchart: Umsatz · EBITDA · JÜ je Szenario (M€).
  const groups = [
    { key: "Umsatz", ist: ist.umsatzCent, a: a.umsatz, b: b.umsatz },
    { key: "EBITDA", ist: ist.ebitdaCent, a: a.ebitda, b: b.ebitda },
    { key: "Jahresüberschuss", ist: ist.netIncomeCent, a: a.ni, b: b.ni },
  ];
  const maxV = Math.max(1, ...groups.flatMap((g) => [g.ist, g.a, g.b]));
  const COL_IST = "var(--nx-text-muted)", COL_A = "var(--nx-warning)", COL_B = "var(--nx-brand-lift)";
  const Mio = (c: number) => `${fmtNumber(c / 1e8, 1)} M`;

  const rows: { label: string; ist: string | null; a: string; b: string; delta: string; hint?: string }[] = [
    { label: t("Umsatz p.a."), ist: hasIst ? M(ist.umsatzCent) : null, a: M(a.umsatz), b: M(b.umsatz), delta: `× ${fmtNumber(facUmsatz, 1)}`, hint: t("Gemüse/Kartoffel erzielen je ha ein Vielfaches des Ackerbau-Erlöses.") },
    { label: t("Subventionen"), ist: null, a: M(a.sub), b: M(b.sub), delta: `+ ${M(b.sub - a.sub)}`, hint: t("Gekoppelte Freiland-Gemüse-Stützung (VCP) zusätzlich zur Basisprämie.") },
    { label: t("EBITDA"), ist: hasIst ? M(ist.ebitdaCent) : null, a: M(a.ebitda), b: M(b.ebitda), delta: `× ${fmtNumber(facEbitda, 1)} · +${M(b.ebitda - a.ebitda)}`, hint: t("Der zentrale Hebel — operative Ertragskraft.") },
    { label: t("EBITDA-Marge"), ist: null, a: fmtPct(a.marge), b: fmtPct(b.marge), delta: `+${fmtNumber((b.marge - a.marge) * 100, 1)} pp`, hint: t("Wertschöpfung je Umsatz-Euro steigt deutlich.") },
    { label: t("Jahresüberschuss"), ist: hasIst ? M(ist.netIncomeCent) : null, a: M(a.ni), b: M(b.ni), delta: `+ ${M(b.ni - a.ni)}`, hint: t("Nach Abschreibung, Zins & Steuer.") },
    { label: t("EBITDA je ha"), ist: hasIst ? M(istEbHa) : null, a: M(a.ebitdaHa), b: M(b.ebitdaHa), delta: `+ ${M(b.ebitdaHa - a.ebitdaHa)}/ha`, hint: t("Flächenproduktivität — der eigentliche Treiber des Hebels.") },
    { label: t("Maschinen-CAPEX"), ist: null, a: M(a.machCapex), b: M(b.machCapex), delta: `+ ${M(b.machCapex - a.machCapex)}`, hint: t("Wertkulturen erfordern Spezialtechnik (Ernter/Roder/Pflanz/Lager) — höhere Investition, die der Ertragshebel trägt.") },
  ];

  return (
    <div className="space-y-4">
      {/* Kopf */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Gesellschafter-Analyse — der Hebel der Wertkulturen")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">{t("Stufe 1 (nur Ackerbau) → 1a (mit Wertkulturen) · Jahr 1 · Szenario")} {scenarioId.replace("sc-", "")}</span>
        </div>
        <p className="px-4 py-2.5 text-[11.5px] text-nx-text-secondary leading-relaxed">
          {t("Dieselbe Fläche, dieselbe Region — einmal als reiner Ackerbaubetrieb (Cash Crops), einmal mit dem geplanten Gemüsebau. Die Differenz ist der Hebel der Wertkulturen. Tragen Sie unten den Ist-Stand des heutigen Betriebs ein: Er dient als Benchmark — liegt er sogar unter dem effizienten Ackerbau (Stufe 1), besteht unabhängig vom Gemüse dringender Handlungsbedarf.")}
        </p>
      </section>

      {/* Nur der hier relevante Vergleich 1 → 1a (volle Stufen-Erklärung steht im Dashboard). */}
      <StageSemanticsCard onlySels={["1", "1a"]} title={t("Dieser Vergleich · 1 (nur Ackerbau) → 1a (mit Wertkulturen)")} />

      {/* Verdikt-Band */}
      <div className="grid grid-cols-2 gap-px rounded-tile border sm:grid-cols-4" style={{ background: "var(--nx-border-divider)", borderColor: "var(--nx-border)", overflow: "hidden" }}>
        {[
          [t("EBITDA-Hebel 1 → 1a"), `× ${fmtNumber(facEbitda, 1)}`, COL_B],
          [t("Mehr-EBITDA p.a."), `+ ${M(b.ebitda - a.ebitda)}`, COL_B],
          [t("Umsatz-Hebel"), `× ${fmtNumber(facUmsatz, 1)}`, "var(--nx-text)"],
          [t("Marge 1 → 1a"), `${fmtPct(a.marge)} → ${fmtPct(b.marge)}`, "var(--nx-text)"],
        ].map(([k, v, c], i) => (
          <div key={i} className="px-4 py-3" style={{ background: "var(--nx-surface)" }}>
            <div className="caption text-[10px] font-bold text-nx-text-muted">{k}</div>
            <div className="num text-[19px] font-bold leading-tight" style={{ color: c as string }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)", boxShadow: "var(--nx-el-card)" }}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold">{t("Ergebnis-Vergleich (M€, Jahr 1)")}</h3>
          <div className="flex flex-wrap gap-3 caption text-[10px] text-nx-text-muted">
            {hasIst && <span className="inline-flex items-center gap-1"><span style={{ width: 10, height: 8, background: COL_IST, display: "inline-block", borderRadius: 2 }} /> {t("Ist heute")}</span>}
            <span className="inline-flex items-center gap-1"><span style={{ width: 10, height: 8, background: COL_A, display: "inline-block", borderRadius: 2 }} /> {t("1 · nur Ackerbau")}</span>
            <span className="inline-flex items-center gap-1"><span style={{ width: 10, height: 8, background: COL_B, display: "inline-block", borderRadius: 2 }} /> {t("1a · mit Wertkulturen")}</span>
          </div>
        </div>
        <div className="px-4 py-4 grid gap-6 sm:grid-cols-3">
          {groups.map((g) => {
            const bars = ([[COL_IST, g.ist, hasIst], [COL_A, g.a, true], [COL_B, g.b, true]] as [string, number, boolean][]).filter((x) => x[2]);
            return (
              <div key={g.key}>
                <div className="caption text-[10px] font-bold text-nx-text-muted mb-2">{t(g.key)}</div>
                <div className="flex items-end gap-2" style={{ height: 130 }}>
                  {bars.map(([col, val], i) => (
                    <div key={i} className="flex flex-1 flex-col items-center justify-end" style={{ height: "100%" }}>
                      <div className="num text-[10.5px] font-semibold mb-1" style={{ color: val < 0 ? "var(--nx-error)" : "var(--nx-text)" }}>{Mio(val)}</div>
                      <div style={{ width: "100%", maxWidth: 42, height: `${Math.max(2, (Math.abs(val) / maxV) * 100)}%`, background: val < 0 ? "var(--nx-error)" : col, borderRadius: "3px 3px 0 0" }} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Ist-Stand editierbar */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-2.5 border-b caption text-[10.5px] font-semibold uppercase tracking-wide" style={{ borderColor: "var(--nx-border)", color: "var(--nx-locate)" }}>{t("Ist-Stand heutiger Betrieb (Benchmark, editierbar)")}</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-4">
          {([
            [t("Umsatz p.a. (€)"), ist.umsatzCent, (n: number) => setIst({ umsatzCent: n })],
            [t("EBITDA p.a. (€)"), ist.ebitdaCent, (n: number) => setIst({ ebitdaCent: n })],
            [t("Jahresüberschuss (€)"), ist.netIncomeCent, (n: number) => setIst({ netIncomeCent: n })],
          ] as [string, number, (n: number) => void][]).map(([label, val, on]) => (
            <label key={label} className="flex flex-col gap-1">
              <span className="caption text-[10px] text-nx-text-muted">{label}</span>
              <NumberInput value={val} moneyCent width={120} onCommit={on} />
            </label>
          ))}
          <label className="flex flex-col gap-1">
            <span className="caption text-[10px] text-nx-text-muted">{t("Fläche (ha)")}</span>
            <NumberInput value={ist.flaecheHa} width={90} onCommit={(n) => setIst({ flaecheHa: Math.max(1, Math.round(n)) })} />
          </label>
        </div>
        {istUnterBenchmark && (
          <div className="px-4 py-2.5 text-[11.5px] border-t" style={{ borderColor: "var(--nx-border)", color: "var(--nx-error)", background: "color-mix(in srgb, var(--nx-error) 8%, transparent)" }}>
            <b>{t("Handlungsdruck:")}</b> {t("Das Ist-EBITDA (")}{M(ist.ebitdaCent)} {t("€) liegt")} <b>{t("unter")}</b> {t("dem effizienten Ackerbau-Benchmark 1 (")}{M(a.ebitda)} {t("€). Schon ohne Gemüsebau besteht Optimierungsbedarf — der Wertkultur-Hebel (1a:")} {M(b.ebitda)} {t("€) kommt oben drauf.")}
          </div>
        )}
      </section>

      {/* Kategorie-Tabelle + Interpretation */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-2.5 border-b caption text-[10.5px] font-semibold uppercase tracking-wide" style={{ borderColor: "var(--nx-border)", color: "var(--nx-brand-lift)" }}>{t("Ergebniseffekte über alle Kategorien — Interpretation")}</div>
        <div className="overflow-x-auto px-2 py-1.5">
          <table className="w-full text-[12px]">
            <thead><tr className="caption text-[10px] text-nx-text-muted">
              <th className="px-2 py-1.5 text-left">{t("Kategorie")}</th>
              {hasIst && <th className="px-2 py-1.5 text-right">{t("Ist heute")}</th>}
              <th className="px-2 py-1.5 text-right">{t("1 · Ackerbau")}</th>
              <th className="px-2 py-1.5 text-right" style={{ color: "var(--nx-brand-lift)" }}>{t("1a · Wertkulturen")}</th>
              <th className="px-2 py-1.5 text-right">{t("Effekt")}</th>
              <th className="px-2 py-1.5 text-left">{t("Interpretation")}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5 font-semibold text-nx-text-secondary">{r.label}</td>
                  {hasIst && <td className="num px-2 py-1.5 text-right text-nx-text-muted">{r.ist ?? "–"}</td>}
                  <td className="num px-2 py-1.5 text-right" style={{ color: "var(--nx-warning)" }}>{r.a}</td>
                  <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{r.b}</td>
                  <td className="num px-2 py-1.5 text-right font-semibold">{r.delta}</td>
                  <td className="px-2 py-1.5 text-[11px] text-nx-text-muted">{r.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-3 text-[11.5px] text-nx-text-secondary leading-relaxed" style={{ borderColor: "var(--nx-border)" }}>
          <b>{t("Kernaussage:")}</b> {t("Auf identischer Fläche hebt der Gemüsebau das EBITDA von")} {M(a.ebitda)} {t("auf")} {M(b.ebitda)} {t("€ (Faktor")} {fmtNumber(facEbitda, 1)}, +{M(b.ebitda - a.ebitda)} {t("€/Jahr) und die Marge von")} {fmtPct(a.marge)} {t("auf")} {fmtPct(b.marge)}{t(". Der Hebel entsteht über die Flächenproduktivität (EBITDA/ha")} {M(a.ebitdaHa)} → {M(b.ebitdaHa)} {t("€/ha): Wertkulturen binden mehr Kapital (Spezialtechnik, Lager) und mehr Arbeit, erwirtschaften je Hektar aber ein Vielfaches. Der reine Ackerbau (Stufe 1) ist der faire, effiziente Vergleichsmaßstab — kein „Schlechtrechnen\", sondern der belastbare Boden, auf dem der Wertkultur-Aufschlag steht.")}
        </div>
      </section>
    </div>
  );
}
