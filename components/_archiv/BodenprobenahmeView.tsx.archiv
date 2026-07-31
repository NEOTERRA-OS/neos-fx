"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { NumberInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { computeSoilSampling, type SoilSamplingConfig } from "../../store/model";
import { t } from "../../lib/i18n";

const PRESETS: { id: string; label: string; grid: number; turnus: number }[] = [
  { id: "A", label: "A · Klassisch (3 ha / 4 J)", grid: 3, turnus: 4 },
  { id: "B", label: "B · Precision (1 ha / 4 J)", grid: 1, turnus: 4 },
  { id: "C", label: "C · Intensiv (1 ha / 2 J)", grid: 1, turnus: 2 },
];

export function BodenprobenahmeView() {
  const domain = useModelStore((s) => s.domain);
  const patch = useModelStore((s) => s.patch);
  const cfg = domain.soilSampling;
  if (!cfg) return null;
  const r = computeSoilSampling(cfg);
  const set = (p: Partial<SoilSamplingConfig>) => patch((d) => { if (d.soilSampling) Object.assign(d.soilSampling, p); });

  const border = "var(--nx-border)", surface = "var(--nx-surface)";
  const pos = "var(--nx-pos, #2E7D32)";
  const eigen = cfg.mode === "eigen";
  const activePreset = PRESETS.find((p) => p.grid === cfg.soilGrid && p.turnus === cfg.soilTurnus)?.id;
  const M = (c: number) => `${fmtMoney(c)} €`;
  const perHa = r.ersparnisCent / Math.max(1, cfg.flaecheHa);

  const Field = ({ label, value, onCommit, money, unit, w = 84 }: { label: string; value: number; onCommit: (n: number) => void; money?: boolean; unit?: string; w?: number }) => (
    <label className="flex flex-col gap-1">
      <span className="caption text-[10px] text-nx-text-muted">{label}</span>
      <span className="flex items-center gap-1"><NumberInput value={value} width={w} moneyCent={money} suffix={unit} onCommit={onCommit} /></span>
    </label>
  );

  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={{ borderColor: border, background: surface }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: border }}>
          <h2 className="text-[14px] font-semibold">{t("Bodenprobenahme — Make-or-Buy (eigener UTV-Rig vs. Dienstleister)")}</h2>
          {/* Aktiv-Schalter: Investition erst auf Klick ins 3-Statement-Modell übernehmen (sonst reiner Rechner). */}
          <button onClick={() => set({ active: !cfg.active })}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-colors"
            style={{ borderColor: cfg.active ? "var(--nx-brand-lift)" : border,
              background: cfg.active ? "color-mix(in srgb, var(--nx-brand-lift) 16%, transparent)" : "transparent",
              color: cfg.active ? "var(--nx-brand-lift)" : "var(--nx-text-secondary)" }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: cfg.active ? "var(--nx-brand-lift)" : "var(--nx-text-muted)", display: "inline-block" }} />
            {cfg.active ? t("Im Modell aktiv — Investition übernommen") : t("Nur Rechner — in den Investitionsplan übernehmen")}
          </button>
        </div>
        {!cfg.active && (
          <div className="px-4 py-2 text-[11.5px] border-b" style={{ borderColor: border, color: "var(--nx-warning)", background: "color-mix(in srgb, var(--nx-warning) 8%, transparent)" }}>
            {t("Diese Investition ist derzeit")} <b>{t("nicht im Modell")}</b> {t("— Szenarien lassen sich frei durchrechnen, ohne GuV/Bilanz/Cashflow zu verändern. Zum Übernehmen oben aktiv schalten.")}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="inline-flex rounded-md border overflow-hidden" style={{ borderColor: border }}>
            <button onClick={() => set({ mode: "eigen" })} className="px-3 py-1.5 text-[12px]" style={{ background: eigen ? "color-mix(in srgb, var(--nsb-accent) 22%, transparent)" : "transparent", fontWeight: eigen ? 600 : 400 }}>{t("Eigen (UTV-Rig)")}</button>
            <button onClick={() => set({ mode: "dl" })} className="px-3 py-1.5 text-[12px] border-l" style={{ borderColor: border, background: !eigen ? "color-mix(in srgb, var(--nsb-accent) 22%, transparent)" : "transparent", fontWeight: !eigen ? 600 : 400 }}>{t("Dienstleister")}</button>
          </div>
          <span className="caption text-[10.5px] text-nx-text-muted">{t("Szenario:")}</span>
          {PRESETS.map((p) => (
            <button key={p.id} onClick={() => set({ soilGrid: p.grid, soilTurnus: p.turnus })}
              className="px-2.5 py-1 rounded-md text-[12px] border" style={{ borderColor: border, background: activePreset === p.id ? "color-mix(in srgb, var(--nsb-accent) 16%, transparent)" : "transparent", fontWeight: activePreset === p.id ? 600 : 400 }}>
              {t(p.label)}
            </button>
          ))}
        </div>
      </section>

      {/* KPI-Verdikt */}
      <section className="rounded-tile border" style={{ borderColor: border, background: surface }}>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4 lg:grid-cols-6" style={{ background: "var(--nx-border-divider)" }}>
          {[
            [t("Rigs (abgeleitet)"), fmtNumber(r.nRigs, 0), eigen ? pos : "var(--nx-text-muted)"],
            [t("Proben / Jahr"), fmtNumber(r.soilN, 0)],
            [t("Feldtage / Jahr"), fmtNumber(r.feldtage, 1)],
            [t("Auslastung"), fmtNumber(r.auslastung * 100, 0) + " %"],
            [t("CAPEX (Eigen)"), M(r.capexCent), "var(--nx-brand-lift)"],
            [t("Amortisation"), isFinite(r.amortYears) ? fmtNumber(r.amortYears, 1) + " J." : "—"],
          ].map(([k, v, c], i) => (
            <div key={i} className="px-3 py-2.5" style={{ background: surface }}>
              <div className="caption text-[9.5px] text-nx-text-muted">{k}</div>
              <div className="num text-[13px] font-semibold" style={{ color: (c as string) ?? "var(--nx-text)" }}>{v}</div>
            </div>
          ))}
        </div>
        <div className="px-4 py-3 grid gap-4 sm:grid-cols-3 border-t" style={{ borderColor: border }}>
          <div>
            <div className="caption text-[10px] text-nx-text-muted uppercase tracking-wide">{t("Dienstleister €/Jahr")}</div>
            <div className="text-[16px] font-semibold num">{M(r.dlJahrCent)}</div>
          </div>
          <div>
            <div className="caption text-[10px] text-nx-text-muted uppercase tracking-wide">{t("Eigen €/Jahr (inkl. Kapital)")}</div>
            <div className="text-[16px] font-semibold num">{M(r.eigenJahrCent)}</div>
          </div>
          <div>
            <div className="caption text-[10px] text-nx-text-muted uppercase tracking-wide">{t("Ersparnis Eigen vs. DL")}</div>
            <div className="text-[16px] font-semibold num" style={{ color: r.ersparnisCent >= 0 ? pos : "var(--nx-neg, #C62828)" }}>{r.ersparnisCent >= 0 ? "+" : ""}{M(r.ersparnisCent)} <span className="text-[11px] text-nx-text-muted">({fmtNumber(perHa / 100, 2)} €/ha)</span></div>
          </div>
        </div>
      </section>

      {/* Paket- & Kosten-Aufschlüsselung */}
      <section className="rounded-tile border" style={{ borderColor: border, background: surface }}>
        <div className="px-4 py-2.5 border-b" style={{ borderColor: border }}>
          <h3 className="text-[13px] font-semibold">{t("Paket-Aufschlüsselung — was steckt in den")} {M(r.pSoilRigCent)} {t("je Rig?")}</h3>
        </div>
        <div className="grid gap-4 px-4 py-3 lg:grid-cols-2">
          {/* CAPEX-Paket */}
          <div>
            <div className="caption text-[10px] font-semibold uppercase tracking-wide text-nx-text-muted mb-1.5">{t("CAPEX je Rig")}</div>
            <table className="w-full text-[12px]">
              <tbody>
                {([
                  [t("Wintex 3000s Vollautomat (0–90 cm, 3 Schichten, GPS)"), cfg.pSamplerCent],
                  [t("Polaris Ranger Diesel (UTV, Kabine)"), cfg.pUTVCent],
                  [t("IT-/Zubehör-Paket je Fahrzeug (Stückliste →)"), cfg.pITCent],
                  [t("Montage/Adaption + Sonden-Ersatzteile + Erststock"), cfg.pMiscCent],
                ] as [string, number][]).map(([l, v]) => (
                  <tr key={l} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                    <td className="py-1 pr-2 text-nx-text-secondary">{l}</td>
                    <td className="num py-1 text-right">{M(v)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                  <td className="py-1.5 font-semibold">{t("Σ CAPEX je Rig")}</td>
                  <td className="num py-1.5 text-right font-semibold">{M(r.pSoilRigCent)}</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-2 caption text-[10px] leading-relaxed text-nx-text-muted">
              <b>{t("IT-Stückliste (Σ 8.660 €):")}</b> Emlid Reach RS3 2.500 · Samsung Tab Active4 Pro 5G 700 · RAM Tough-Dock 220 ·
              Zebra DS3678-ER Scanner 1.300 · Zebra ZQ521 Drucker+Etiketten 1.000 · Teltonika RUTX11+Poynting 500 ·
              Victron LiFePO4 100Ah 850 · Victron Orion-Tr 220 · Blue Sea Sicherung+Kabel 350 · Dometic CFX3 45 900 · Auer Euroboxen 120.
            </div>
          </div>
          {/* €/Jahr-Zerlegung */}
          <div>
            <div className="caption text-[10px] font-semibold uppercase tracking-wide text-nx-text-muted mb-1.5">{t("Eigen —")} {M(r.eigenJahrCent)} {t("/ Jahr zerlegt")}</div>
            <table className="w-full text-[12px]">
              <tbody>
                <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="py-1 pr-2 text-nx-text-secondary">{t("Kapitalkosten je Rig (AfA")} {M(r.afaRig)} {t("+ kalk. Zins")} {M(r.zinsRig)})</td>
                  <td className="num py-1 text-right">{fmtNumber(r.nRigs, 0)} × {M(r.kapitalRigCent)}</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="py-1 pr-2 text-nx-text-secondary">{t("Cash-Fix je Rig (Versicherung")} {M(cfg.fixInsurCent)} {t("· ROMPOS-RTK")} {M(cfg.fixRomposCent)} {t("· Instandhaltung")} {M(cfg.fixMaintCent)})</td>
                  <td className="num py-1 text-right">{fmtNumber(r.nRigs, 0)} × {M(r.soilFixCashCent)}</td>
                </tr>
                <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="py-1 pr-2 text-nx-text-secondary">{t("Variable je Probe (Personal")} {M(cfg.varPersCent)} {t("+ Kraftstoff")} {M(cfg.varFuelCent)} {t("+ Material")} {M(cfg.varConsCent)} {t("+ Labor")} {M(cfg.varLabCent)})</td>
                  <td className="num py-1 text-right">{fmtNumber(r.soilN, 0)} × {M(r.soilVarCent)}</td>
                </tr>
                <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                  <td className="py-1.5 font-semibold">{t("Σ Eigen / Jahr (inkl. Kapital)")}</td>
                  <td className="num py-1.5 text-right font-semibold">{M(r.eigenJahrCent)}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-2 text-nx-text-muted">{t("zum Vergleich Dienstleister (")}{fmtNumber(r.soilN, 0)} × {M(cfg.dlCent)})</td>
                  <td className="num py-1 text-right text-nx-text-muted">{M(r.dlJahrCent)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Parameter */}
      <section className="rounded-tile border" style={{ borderColor: border, background: surface }}>
        <div className="px-4 py-2.5 border-b" style={{ borderColor: border }}><h3 className="text-[13px] font-semibold">{t("Parameter (editierbar)")}</h3></div>

        <div className="px-4 py-2 caption text-[10px] font-semibold uppercase tracking-wide text-nx-text-muted">{t("Szenario-Treiber & Schlagkraft")}</div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 px-4 pb-3">
          <Field label={t("Raster ha/Probe")} value={cfg.soilGrid} unit="ha" onCommit={(n) => set({ soilGrid: Math.max(0.1, n) })} />
          <Field label={t("Turnus (Jahre)")} value={cfg.soilTurnus} unit="J" onCommit={(n) => set({ soilTurnus: Math.max(1, Math.round(n)) })} />
          <Field label={t("Ackerfläche")} value={cfg.flaecheHa} unit="ha" w={90} onCommit={(n) => set({ flaecheHa: Math.max(0, Math.round(n)) })} />
          <Field label={t("Proben/Feldtag")} value={cfg.soilPerDay} onCommit={(n) => set({ soilPerDay: Math.max(1, Math.round(n)) })} />
          <Field label={t("Feldtage/Saison")} value={cfg.soilDays} onCommit={(n) => set({ soilDays: Math.max(1, Math.round(n)) })} />
        </div>

        <div className="px-4 py-2 caption text-[10px] font-semibold uppercase tracking-wide text-nx-text-muted border-t" style={{ borderColor: border }}>{t("CAPEX je Rig — Σ")} {M(r.pSoilRigCent)}</div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 px-4 pb-3">
          <Field label={t("Sampler Wintex 3000s")} value={cfg.pSamplerCent} money w={92} onCommit={(n) => set({ pSamplerCent: Math.max(0, n) })} />
          <Field label={t("UTV Polaris Ranger")} value={cfg.pUTVCent} money w={92} onCommit={(n) => set({ pUTVCent: Math.max(0, n) })} />
          <Field label={t("IT-/Zubehör-Paket")} value={cfg.pITCent} money w={88} onCommit={(n) => set({ pITCent: Math.max(0, n) })} />
          <Field label={t("Montage/Sonstiges")} value={cfg.pMiscCent} money w={84} onCommit={(n) => set({ pMiscCent: Math.max(0, n) })} />
        </div>

        <div className="px-4 py-2 caption text-[10px] font-semibold uppercase tracking-wide text-nx-text-muted border-t" style={{ borderColor: border }}>{t("Kapital & Kosten")}</div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 px-4 pb-4">
          <Field label={t("Nutzungsdauer")} value={cfg.holdYears} unit="J" w={56} onCommit={(n) => set({ holdYears: Math.max(1, Math.round(n)) })} />
          <Field label={t("Restwert %")} value={Math.round(cfg.residPct * 100)} unit="%" w={56} onCommit={(n) => set({ residPct: Math.max(0, Math.min(1, n / 100)) })} />
          <Field label={t("kalk. Zins %")} value={Math.round(cfg.zins * 1000) / 10} unit="%" w={56} onCommit={(n) => set({ zins: Math.max(0, n / 100) })} />
          <Field label={t("Fix Versicherung")} value={cfg.fixInsurCent} money w={72} onCommit={(n) => set({ fixInsurCent: Math.max(0, n) })} />
          <Field label={t("Fix ROMPOS-RTK")} value={cfg.fixRomposCent} money w={72} onCommit={(n) => set({ fixRomposCent: Math.max(0, n) })} />
          <Field label={t("Fix Instandhaltung")} value={cfg.fixMaintCent} money w={72} onCommit={(n) => set({ fixMaintCent: Math.max(0, n) })} />
          <Field label={t("Var Personal/Probe")} value={cfg.varPersCent} money w={72} onCommit={(n) => set({ varPersCent: Math.max(0, n) })} />
          <Field label={t("Var Kraftstoff/Probe")} value={cfg.varFuelCent} money w={72} onCommit={(n) => set({ varFuelCent: Math.max(0, n) })} />
          <Field label={t("Var Material/Probe")} value={cfg.varConsCent} money w={72} onCommit={(n) => set({ varConsCent: Math.max(0, n) })} />
          <Field label={t("Labor/Probe")} value={cfg.varLabCent} money w={72} onCommit={(n) => set({ varLabCent: Math.max(0, n) })} />
          <Field label={t("Dienstleister/Probe")} value={cfg.dlCent} money w={72} onCommit={(n) => set({ dlCent: Math.max(0, n) })} />
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: border }}>
          {t("Kapital/Rig")} {M(r.kapitalRigCent)}{t("/J (AfA")} {M(r.afaRig)} {t("+ kalk. Zins")} {M(r.zinsRig)}{t(") · Cash-Fix/Rig")} {M(r.soilFixCashCent)}{t("/J · variable Eigen")} {M(r.soilVarCent)}{t("/Probe. Labor fällt bei Eigen & DL an → kürzt sich im Delta; Ersparnis-Treiber ist die Entnahme. Bei „Eigen\" fließt CAPEX (")}{M(r.capexCent)}{t(") in den Investitionsplan; „Dienstleister\" nur OPEX (")}{M(r.dlJahrCent)}{t("/J).")}
        </div>
      </section>
    </div>
  );
}
