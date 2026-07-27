"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { NumberInput } from "./NumberInput";
import { deriveAnbauAdvice, adviceSummary, type AdviceItem, type AdviceSeverity, type AdviceCategory } from "../../store/anbauAdvisor";
import type { StandortProfil } from "../../store/model";
import { t } from "../../lib/i18n";

const TONE: Record<AdviceSeverity, { c: string; bg: string; icon: string; label: string }> = {
  info:    { c: "var(--nx-success)", bg: "var(--nx-success-bg)", icon: "✓", label: "Begründung" },
  advice:  { c: "var(--nx-locate)", bg: "color-mix(in srgb, var(--nx-locate) 16%, transparent)", icon: "→", label: "Empfehlung" },
  warning: { c: "var(--nx-warning)", bg: "var(--nx-warning-bg)", icon: "!", label: "Hinweis" },
  risk:    { c: "var(--nx-error)", bg: "var(--nx-error-bg)", icon: "▲", label: "Risiko" },
};
const CAT_ORDER: AdviceCategory[] = ["Fruchtfolge", "Wasser & Beregnung", "Nährstoffe", "Markt & Preis", "Standort", "Arbeit & Maschinen", "Ökonomie"];
const RANK: Record<AdviceSeverity, number> = { risk: 0, warning: 1, advice: 2, info: 3 };

/** Anbau-Analyse — agronomisches Erklär-/Bewertungspanel (wie das Check-Panel, für die Fruchtfolge).
 *  Live aus dem Anbauplan: Begründung der Struktur + dynamische Hinweise/Risiken bei Änderungen. */
export function AnbauAnalysePanel() {
  const domain = useModelStore((s) => s.domain);
  const patch = useModelStore((s) => s.patch);
  const tick = useModelStore((s) => s.recalcTick);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const items = React.useMemo(() => deriveAnbauAdvice(domain), [domain, tick]);
  const sum = adviceSummary(items);
  const border = "var(--nx-border)";
  const site = domain.standort;
  const setSite = (p: Partial<StandortProfil>) => patch((d) => { if (d.standort) Object.assign(d.standort, p); });
  const SEL = "rounded-control border text-[11.5px] px-1";
  const selStyle = { background: "var(--nx-app-bg)", borderColor: border, height: 30 } as React.CSSProperties;

  const byCat = CAT_ORDER
    .map((cat) => ({ cat, rows: items.filter((i) => i.category === cat).sort((a, b) => RANK[a.severity] - RANK[b.severity]) }))
    .filter((g) => g.rows.length);

  const Pill = ({ s, n }: { s: AdviceSeverity; n: number }) => n > 0 ? (
    <span className="num inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10.5px] font-semibold"
      style={{ color: TONE[s].c, background: TONE[s].bg }}>{TONE[s].icon} {n}</span>
  ) : null;

  return (
    <section className="rounded-tile border" style={{ borderColor: border, background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: border }}>
        <h2 className="text-[14px] font-semibold">{t("Anbau-Analyse — warum diese Struktur? (Agronomie-Advisor)")}</h2>
        <div className="flex items-center gap-1.5">
          <Pill s="risk" n={sum.risk} /><Pill s="warning" n={sum.warning} /><Pill s="advice" n={sum.advice} /><Pill s="info" n={sum.info} />
        </div>
      </div>
      <p className="px-4 py-2 text-[11px] text-nx-text-muted">
        {t("Deterministische Bewertung der Fruchtfolge gegen verifizierte Agronomie (Anbaupause, Wasser, Nährstoffe, Markt, Standort, Arbeitsspitzen). Aktualisiert sich live bei jeder Flächenänderung. Detail je Zeile aufklappen.")}
      </p>
      {site && (
        <div className="px-4 py-2 border-t flex flex-wrap items-center gap-x-5 gap-y-2" style={{ borderColor: border, background: "var(--nx-surface-sunken)" }}>
          <span className="caption text-[10px] font-semibold uppercase tracking-wide text-nx-text-muted">{t("Standort-Profil")}</span>
          <input className="rounded-control border px-2 text-[12px]" style={{ ...selStyle, width: 240 }} value={site.name} onChange={(e) => setSite({ name: e.target.value })} />
          <label className="flex items-center gap-1.5 text-[11.5px]"><span className="text-nx-text-secondary">{t("Niederschlag")}</span><NumberInput value={site.rainfallMm} width={56} suffix="mm" onCommit={(n) => setSite({ rainfallMm: Math.max(0, Math.round(n)) })} /></label>
          <label className="flex items-center gap-1.5 text-[11.5px]"><span className="text-nx-text-secondary">{t("Boden")}</span>
            <select className={SEL} style={selStyle} value={site.soil} onChange={(e) => setSite({ soil: e.target.value as StandortProfil["soil"] })}>
              <option value="chernozem">{t("Chernozem")}</option><option value="lehm">{t("Lehm")}</option><option value="ton">{t("Ton")}</option><option value="sand">{t("Sand")}</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11.5px]"><span className="text-nx-text-secondary">{t("Sommer-Trockenstress")}</span>
            <select className={SEL} style={selStyle} value={site.summerHeat} onChange={(e) => setSite({ summerHeat: e.target.value as StandortProfil["summerHeat"] })}>
              <option value="hoch">{t("hoch")}</option><option value="mittel">{t("mittel")}</option><option value="gering">{t("gering")}</option>
            </select>
          </label>
        </div>
      )}
      <div className="px-2 pb-3">
        {byCat.map((g) => (
          <div key={g.cat} className="mt-2">
            <div className="px-2 py-1 caption text-[10px] font-semibold uppercase tracking-wide text-nx-text-muted">{t(g.cat)}</div>
            <ul className="space-y-1">
              {g.rows.map((it: AdviceItem) => {
                const t = TONE[it.severity];
                const isOpen = open[it.id] ?? (it.severity === "risk" || it.severity === "warning");
                return (
                  <li key={it.id} className="rounded-md" style={{ background: "var(--nx-surface-sunken, transparent)" }}>
                    <button className="flex w-full items-start gap-2 px-2 py-1.5 text-left" onClick={() => setOpen((o) => ({ ...o, [it.id]: !isOpen }))}>
                      <span className="num mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-pill text-[11px] font-bold" style={{ color: t.c, background: t.bg }} aria-hidden>{t.icon}</span>
                      <span className="flex-1">
                        <span className="text-[12.5px] font-medium">{it.title}</span>
                        {it.metric && <span className="num ml-2 text-[10.5px] text-nx-text-muted">{it.metric}</span>}
                        {isOpen && <span className="mt-1 block text-[11.5px] leading-relaxed text-nx-text-secondary">{it.detail}</span>}
                      </span>
                      <span className="mt-0.5 text-[10px] text-nx-text-muted">{isOpen ? "▾" : "▸"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
