"use client";
import React from "react";
import { useModelStore, readAssumption, selectScopedDomain } from "../../store/modelStore";
import { deriveEinsatzplan, deriveMachineTCO } from "../../store/model";
import { fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";

/** Einsatzplanung — komplett neu (lesbar):
 *  1) Auslastung JE MASCHINE aus dem Register (Std/J vs. Kapazität),
 *  2) Saison-Auslastung je Klasse als Monatsraster (12 statt 52 Spalten, große Zellen, %-Text),
 *  3) nummerierte Arbeitsschritte je Kultur, 4) Personal je Monat, 5) Engpässe. */

const MONTHS: [string, number, number][] = [
  ["Jan", 1, 4], ["Feb", 5, 8], ["Mär", 9, 13], ["Apr", 14, 17], ["Mai", 18, 22], ["Jun", 23, 26],
  ["Jul", 27, 30], ["Aug", 31, 35], ["Sep", 36, 39], ["Okt", 40, 44], ["Nov", 45, 48], ["Dez", 49, 52],
];
const monthIdx = (w: number) => MONTHS.findIndex(([, s, e]) => w >= s && w <= e);
const monthLabel = (w: number) => (MONTHS[monthIdx(w)]?.[0] ?? "");

/** Auslastungs-Skala THEME-FÄHIG via color-mix (vorher Light-only-Pastell — im Dark unlesbar). */
function utilColor(u: number): string {
  if (u > 1.0) return "color-mix(in srgb, var(--nx-error) 55%, var(--nx-surface))";
  if (u > 0.85) return "color-mix(in srgb, var(--nx-warning) 50%, var(--nx-surface))";
  if (u > 0.6) return "color-mix(in srgb, var(--nx-success) 45%, var(--nx-surface))";
  if (u > 0.3) return "color-mix(in srgb, var(--nx-success) 25%, var(--nx-surface))";
  if (u > 0) return "color-mix(in srgb, var(--nx-success) 10%, var(--nx-surface))";
  return "var(--nx-surface-sunken)";
}
function utilText(u: number): string { return u > 0 ? `${Math.round(u * 100)}` : ""; }

function Kpi({ cap, val, tone }: { cap: string; val: string; tone?: "ok" | "err" | "warn" }) {
  const color = tone === "ok" ? "var(--nx-success)" : tone === "err" ? "var(--nx-error)" : tone === "warn" ? "var(--nx-warning)" : "var(--nx-text)";
  return (
    <div className="px-4 py-3" style={{ borderRight: "1px solid var(--nx-border-divider)" }}>
      <div className="caption text-[10.5px] font-bold text-nx-text-muted">{cap}</div>
      <div className="num text-[20px] font-bold leading-tight" style={{ color }}>{val}</div>
    </div>
  );
}

/** Horizontaler Auslastungsbalken mit %-Label (0..>100 %). */
function UtilBar({ u }: { u: number }) {
  const pct = Math.round(u * 100);
  const w = Math.min(100, u * 100);
  const over = u > 1.0;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-[16px] flex-1 rounded-sm" style={{ background: "var(--nx-surface-sunken)", minWidth: 90 }}>
        <div className="absolute left-0 top-0 h-full rounded-sm" style={{ width: `${w}%`, background: utilColor(u) }} />
        {over && <div className="absolute right-0 top-0 h-full" style={{ width: 3, background: "var(--nx-error)" }} />}
      </div>
      <span className="num w-[42px] shrink-0 text-right text-[12px] font-semibold" style={{ color: over ? "var(--nx-error)" : "var(--nx-text)" }}>{pct} %</span>
    </div>
  );
}

export function EinsatzView() {
  const domain = useModelStore((s) => s.domain);
  // Einsatzplan folgt der aktiven Stufe/Scope (Stufe 1 = nur Ackerbau → keine Wertkultur-Maschinen).
  const sdomain = useModelStore(selectScopedDomain);
  const scenarioId = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);
  const plan = React.useMemo(() => deriveEinsatzplan(sdomain, scenarioId), [sdomain, scenarioId, tick]);
  const tco = React.useMemo(() => deriveMachineTCO(sdomain, scenarioId), [sdomain, scenarioId, tick]);
  const availH = readAssumption(domain, "en.avail_h_year", scenarioId) || 2000;
  const border = { borderColor: "var(--nx-border)" } as const;

  // 1) Auslastung je Register-Maschine (nur Maschinen mit Stundenbezug)
  const machines = tco
    .filter((t) => t.hoursPerYear != null && t.count > 0 && (t.hoursPerYear as number) > 0)
    .map((t) => { const cap = t.count * availH; const h = t.hoursPerYear as number; return { ...t, cap, hoursY: h, util: cap > 0 ? h / cap : 0 }; })
    .sort((a, b) => b.util - a.util);

  // 2) Saison-Auslastung je Klasse — Monatspeak / Flotte
  const classMonthly = plan.classes
    .map((c) => {
      const months = MONTHS.map(([, s, e]) => { let peak = 0; for (let w = s; w <= e; w++) peak = Math.max(peak, plan.demand[c.key]?.[w] ?? 0); return peak; });
      return { ...c, months, maxUtil: Math.max(0, ...months.map((m) => (c.units ? m / c.units : 0))) };
    })
    .filter((c) => c.months.some((m) => m > 0))
    .sort((a, b) => b.maxUtil - a.maxUtil);

  // 4) Personal je Monat (Peak)
  const laborMonthly = MONTHS.map(([, s, e]) => { let peak = 0; for (let w = s; w <= e; w++) peak = Math.max(peak, plan.labor[w] ?? 0); return Math.round(peak); });
  const maxLabor = Math.max(plan.kpis.staff, ...laborMonthly) * 1.1 || 1;

  // 3) nummerierte Arbeitsschritte, gruppiert je Kultur (Reihenfolge nach Startwoche)
  // Kulturen aus dem ANBAUPLAN statt aus einer festen Liste. Die alte Liste fuehrte fuenf
  //  geloeschte Ackerbaukulturen und liess dafuer Knollensellerie, Suesskartoffel und
  //  Knoblauch weg — drei aktive Kulturen konnten ihre Arbeitsschritte nicht anzeigen.
  const cropOrder = [...new Set(domain.anbauplan.map((a) => a.cropId))];
  const cropName: Record<string, string> = {
    weizen: t("Winterweizen"), gerste_zw: t("Wintergerste + Soja"), soja_luzerne: t("Soja / Luzerne"), winterraps: t("Winterraps"),
    mais: t("Körnermais"), tomate: t("Industrietomate"), kartoffel_pommes: t("Kartoffel Pommes"), kartoffel_chips: t("Kartoffel Chips"), zwiebel_moehre: t("Zwiebel / Möhre"),
  };
  const opsByCrop = cropOrder
    .map((cid) => ({ cid, name: cropName[cid] ?? cid, ops: plan.ops.filter((o) => o.cropId === cid).sort((a, b) => a.kwS - b.kwS) }))
    .filter((g) => g.ops.length);

  const th = "px-3 py-2 caption text-[10px] text-nx-text-muted";
  const cell = { border: "1px solid var(--nx-border-divider)" } as const;

  return (
    <div className="space-y-4">
      {/* Kontext + KPIs */}
      <div className="rounded-tile border px-4 py-3 text-[12px] text-nx-text-secondary" style={border}>
        <b>{t("Einsatzplanung — gekoppelt ans Modell.")}</b> {t("Auslastung je Maschine aus dem")} <b>{t("Maschinen-Register")}</b> {t("(Betriebsstunden ÷ Kapazität), Saison-Nachfrage aus dem Anbauplan/Bottom-up.")} <b>{plan.kpis.shifts}{t("-Schicht")}</b> {t("(Durchsatz ×")}{fmtNumber(plan.kpis.shiftFactor, 1)}{t("), verfügbare Feldstunden")} {fmtNumber(availH, 0)} {t("h/Maschine·J (editierbar unter Leistungsparameter → Maschinen-Einsatz).")}
      </div>

      <div className="rounded-tile border grid grid-cols-2 md:grid-cols-4" style={{ ...border, background: "var(--nx-surface)", overflow: "hidden" }}>
        <Kpi cap={t("Engpass-Zeiträume")} val={String(plan.kpis.conflictCount)} tone={plan.kpis.conflictCount ? "err" : "ok"} />
        <Kpi cap={t("höchste Auslastung (Maschine)")} val={machines.length ? `${Math.round(machines[0].util * 100)} %` : "–"} tone={machines.length && machines[0].util > 1 ? "err" : "ok"} />
        <Kpi cap={t("Spitzen-Klasse · KW")} val={`${plan.kpis.peakClass.split(" ")[0]} · ${t("KW")}${plan.kpis.peakWeek}`} tone={plan.kpis.peakUtilPct > 100 ? "err" : "warn"} />
        <Kpi cap={`${t("Personal-Spitze (Kap")} ${fmtNumber(plan.kpis.staff, 0)})`} val={`${plan.kpis.peakLabor} P`} tone={plan.kpis.peakLabor > plan.kpis.staff ? "err" : "ok"} />
      </div>

      {/* 1) Auslastung je Maschine */}
      <section className="rounded-tile border" style={{ ...border, background: "var(--nx-surface)" }}>
        <div className="px-4 py-2.5 border-b text-[13px] font-semibold" style={{ ...border, color: "var(--nx-brand-lift)" }}>{t("Auslastung je Maschine (aus dem Register)")}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr style={{ background: "var(--nx-surface-sunken)" }}>
              <th className={th + " text-left"} style={{ width: 34 }}>{t("Nr")}</th>
              <th className={th + " text-left"}>{t("Maschine")}</th>
              <th className={th + " text-right"}>{t("Anzahl")}</th>
              <th className={th + " text-right"}>{t("Std/J (Ist)")}</th>
              <th className={th + " text-right"}>{t("Kapazität Std/J")}</th>
              <th className={th + " text-left"} style={{ minWidth: 170 }}>{t("Auslastung")}</th>
              <th className={th + " text-left"}>{t("Bewertung")}</th>
            </tr></thead>
            <tbody>
              {machines.map((m, i) => {
                const rating = m.util > 1.0 ? [t("Engpass"), "var(--nx-error)"] : m.util > 0.85 ? [t("hoch"), "var(--nx-warning)"] : m.util > 0.4 ? [t("gut"), "var(--nx-success)"] : [t("frei"), "var(--nx-text-muted)"];
                return (
                  <tr key={m.machineId} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                    <td className="num px-3 py-1.5 text-nx-text-muted">{i + 1}</td>
                    <td className="px-3 py-1.5">{m.label}</td>
                    <td className="num px-3 py-1.5 text-right">{fmtNumber(m.count, 0)}</td>
                    <td className="num px-3 py-1.5 text-right">{fmtNumber(m.hoursY, 0)}</td>
                    <td className="num px-3 py-1.5 text-right text-nx-text-secondary">{fmtNumber(m.cap, 0)}</td>
                    <td className="px-3 py-1.5"><UtilBar u={m.util} /></td>
                    <td className="px-3 py-1.5 text-[11.5px] font-semibold" style={{ color: rating[1] }}>{rating[0]}</td>
                  </tr>
                );
              })}
              {machines.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-[12px] text-nx-text-muted">{t("Keine Maschinen mit Stundenbezug — Anbauplan/Arbeitsgänge prüfen.")}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={border}>{t("Auslastung = Ist-Betriebsstunden ÷ (Anzahl × verfügbare Feldstunden). Traktoren erscheinen als eigene Positionen im Register; die Arbeitsgang-Stunden laufen über die Anbaugeräte.")}</div>
      </section>

      {/* 2) Saison-Auslastung je Klasse (Monatsraster) */}
      <section className="rounded-tile border" style={{ ...border, background: "var(--nx-surface)" }}>
        <div className="px-4 py-2.5 border-b text-[13px] font-semibold" style={{ ...border, color: "var(--nx-brand-lift)" }}>{t("Saison-Auslastung je Klasse — Monatsspitze in % der Flotte")}</div>
        <div className="overflow-x-auto px-2 py-2">
          <table style={{ borderCollapse: "separate", borderSpacing: 2, width: "100%" }}>
            <thead>
              <tr>
                <th className="text-left" style={{ padding: "2px 8px", fontSize: 10, color: "var(--nx-text-muted)", minWidth: 150 }}>{t("Klasse (Flotte)")}</th>
                {MONTHS.map((m) => <th key={m[0]} style={{ fontSize: 10.5, color: "var(--nx-text-secondary)", padding: "2px 0" }}>{t(m[0])}</th>)}
              </tr>
            </thead>
            <tbody>
              {classMonthly.map((c) => (
                <tr key={c.key}>
                  <td className="text-left" style={{ padding: "2px 8px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{c.label} <span className="text-nx-text-muted">({c.units})</span></td>
                  {c.months.map((d, mi) => {
                    const u = c.units ? d / c.units : 0;
                    return (
                      <td key={mi} title={`${c.label} ${t(MONTHS[mi][0])}: ${d}/${c.units} = ${Math.round(u * 100)} %`}
                        style={{ ...cell, height: 30, textAlign: "center", verticalAlign: "middle", background: utilColor(u), borderRadius: 4, fontSize: 11, fontWeight: 700, color: u > 0.85 ? "#5a2020" : "var(--nx-text-secondary)" }}>
                        {utilText(u)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-3 px-4 pb-3 text-[11px] text-nx-text-muted">
          {[["≤30", utilColor(0.2)], ["30–60", utilColor(0.5)], ["60–85", utilColor(0.7)], ["85–100", utilColor(0.9)], [t(">100 % Engpass"), utilColor(1.1)]].map(([l, col]) => (
            <span key={l}><span style={{ display: "inline-block", width: 12, height: 12, background: col as string, borderRadius: 3, verticalAlign: "middle" }} /> {l}</span>
          ))}
        </div>
      </section>

      {/* 3) Arbeitsschritte nummeriert je Kultur */}
      <section className="rounded-tile border" style={{ ...border, background: "var(--nx-surface)" }}>
        <div className="px-4 py-2.5 border-b text-[13px] font-semibold" style={{ ...border, color: "var(--nx-brand-lift)" }}>{t("Arbeitsschritte je Kultur (nummeriert, mit Zeitfenster)")}</div>
        <div className="grid grid-cols-1 gap-x-8 px-4 py-3 lg:grid-cols-2">
          {opsByCrop.map((g) => (
            <div key={g.cid} className="mb-3">
              <div className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold">
                <span style={{ width: 10, height: 10, borderRadius: 2, background: g.ops[0]?.color ?? "var(--nx-text-muted)", display: "inline-block" }} />
                {g.name}
              </div>
              <table className="w-full text-[12px]">
                <tbody>
                  {g.ops.map((o, i) => (
                    <tr key={i} style={{ borderTop: i ? "1px solid var(--nx-border-divider)" : "none" }}>
                      <td className="num py-1 pr-2 text-nx-text-muted" style={{ width: 22 }}>{i + 1}</td>
                      <td className="py-1 pr-2">{o.label.replace(/\s*\([^)]*\)\s*$/, "")}</td>
                      <td className="num py-1 pr-2 text-right text-nx-text-secondary" style={{ whiteSpace: "nowrap" }}>{t(monthLabel(o.kwS))}{monthLabel(o.kwS) !== monthLabel(o.kwE) ? `–${t(monthLabel(o.kwE))}` : ""}</td>
                      <td className="num py-1 text-right text-nx-text-muted" style={{ whiteSpace: "nowrap" }} title={t("Klasse · benötigte Einheiten")}>{o.cls} · {o.units}×</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>

      {/* 4) Personal je Monat */}
      <section className="rounded-tile border" style={{ ...border, background: "var(--nx-surface)" }}>
        <div className="px-4 py-2.5 border-b text-[13px] font-semibold" style={{ ...border, color: "var(--nx-brand-lift)" }}>{t("Personalbedarf je Monat (Spitze) — Kapazität")} {fmtNumber(plan.kpis.staff, 0)}</div>
        <div className="flex items-end gap-2 px-4 py-4" style={{ height: 130 }}>
          {laborMonthly.map((L, mi) => {
            const ov = L > plan.kpis.staff;
            return (
              <div key={mi} className="flex flex-1 flex-col items-center gap-1">
                <div className="num text-[10px]" style={{ color: ov ? "var(--nx-error)" : "var(--nx-text-muted)" }}>{L || ""}</div>
                <div className="w-full rounded-sm" style={{ height: Math.max(2, Math.round(80 * L / maxLabor)), background: ov ? "var(--nx-error)" : "var(--nx-series-b)" }} title={`${t(MONTHS[mi][0])}: ${L} ${t("Personen")}`} />
                <div className="text-[10px] text-nx-text-muted">{t(MONTHS[mi][0])}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 5) Konflikte */}
      <section className="rounded-tile border px-4 py-3" style={{ ...border, background: "var(--nx-surface)" }}>
        <div className="pb-2 text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Engpässe & Konflikte")}</div>
        {plan.conflicts.length === 0 ? (
          <div className="rounded-control px-3 py-2 text-[12.5px]" style={{ background: "var(--nx-success-bg)", color: "var(--nx-success)" }}>
            {t("Keine Überlast bei aktueller Flotte/Schicht — alle Maßnahmen passen in ihre Fenster.")}
          </div>
        ) : (
          plan.conflicts.map((c, i) => (
            <div key={i} className="my-1 rounded-control px-3 py-1.5 text-[12.5px]" style={{ background: "var(--nx-error-bg)", color: "var(--nx-error)" }}>
              <b>{c.clsLabel}</b> · {t(monthLabel(c.kwS))}–{t(monthLabel(c.kwE))} ({t("KW")} {c.kwS}–{c.kwE}): {t("Bedarf bis")} <b>{c.peak}</b>, {t("Flotte")} {c.units} → {Math.round((c.peak / c.units) * 100)} %. {t("Kollidierende Kulturen:")} {c.crops.join(", ")}.
            </div>
          ))
        )}
      </section>
    </div>
  );
}
