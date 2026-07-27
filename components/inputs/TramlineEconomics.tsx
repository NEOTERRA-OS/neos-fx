"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { NumberInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import type { TramlineConfig, TramlineCrop, TramlineCash } from "../../store/model";

const HOLD_YEARS = 10; // Amortisationshorizont Kapital (Neoterra-Annahme)

/** Rechenkern Fahrgassen-Ökonomie (Neoterra-Kartoffelplanung). Alle €-Werte in CENT.
 *  Zwei Verlustquellen: (1) Fahrgassenverlust = ausgesparte Reihen × Reihenabstand ÷ Boom;
 *  (2) Randverlust (Kreis-Fit) = randFactor × Boom ÷ Feld-⌀ (Vorgewende/Randbahnen, steigt mit Breite). */
export function computeTramline(cfg: TramlineConfig) {
  const D = 2 * Math.sqrt((Math.max(0.01, cfg.pivotHa) * 10000) / Math.PI); // Feld-⌀ (m)
  const fgFrac = (rows: number, rowM: number, W: number) => W > 0 ? (rows * rowM) / W : 0;
  const randFrac = (W: number) => D > 0 ? Math.max(0, cfg.randFactor) * W / D : 0;

  const rows = cfg.crops.map((c) => {
    const fgB = fgFrac(c.tramlineRows, c.rowM, cfg.boomBase), fgA = fgFrac(c.tramlineRows, c.rowM, cfg.boomAlt);
    const rB = randFrac(cfg.boomBase), rA = randFrac(cfg.boomAlt);
    const lossB = fgB + rB, lossA = fgA + rA;
    const valuePerHa = c.yieldT * c.priceEurTCent;                 // CENT/ha Ertragswert
    const revLossB = Math.round(c.areaHa * valuePerHa * lossB);
    const revLossA = Math.round(c.areaHa * valuePerHa * lossA);
    return {
      c, fgB, fgA, rB, rA, lossB, lossA, revLossB, revLossA,
      benefit: revLossB - revLossA,
      rowsPerBoomB: c.rowM > 0 ? cfg.boomBase / c.rowM : 0,
      rowsPerBoomA: c.rowM > 0 ? cfg.boomAlt / c.rowM : 0,
      rowsPerPivot: c.rowM > 0 ? D / c.rowM : 0,
      nutzungB: 1 - fgB, nutzungA: 1 - fgA,
    };
  });
  const benefitTotal = rows.reduce((s, r) => s + r.benefit, 0);

  // Kapital: Wertverlust/Jahr = Neupreis × (1 − Restwertquote) ÷ Haltedauer.
  const wvBase = Math.round((cfg.capPriceBaseCent * (1 - cfg.capResBasePct)) / HOLD_YEARS);
  const wvAlt = Math.round((cfg.capPriceAltCent * (1 - cfg.capResAltPct)) / HOLD_YEARS);
  const capMehr = wvAlt - wvBase;                       // Kapital-Mehrkosten/Jahr
  const mehrpreis = cfg.capPriceAltCent - cfg.capPriceBaseCent;
  const netBenefit = benefitTotal - capMehr;           // Nettovorteil/Jahr
  // Amortisation gegen den NETTO-Vorteil (inkl. Kapital-Mehrkosten) — nicht den Brutto-Flächenvorteil.
  const paybackYears = netBenefit > 0 ? mehrpreis / netBenefit : Infinity;
  const tenYear = netBenefit * HOLD_YEARS;

  // Breiten-Ranking (gültige Breiten = Vielfache der Pflanz-Arbeitsbreite) für die Leitkultur (crop[0]).
  const lead = cfg.crops[0];
  const widths: number[] = [];
  const step = Math.max(1, cfg.planterM);
  for (let w = cfg.boomBase; w <= cfg.boomBase + 6 * step + 0.001; w += step) widths.push(Math.round(w));
  const ranking = lead ? widths.map((W) => {
    const fg = fgFrac(lead.tramlineRows, lead.rowM, W), rd = randFrac(W);
    const rowsN = Math.round(W / lead.rowM);
    const lossHaCent = Math.round(lead.yieldT * lead.priceEurTCent * (fg + rd));
    const baseLossHa = lead.yieldT * lead.priceEurTCent * (fgFrac(lead.tramlineRows, lead.rowM, cfg.boomBase) + randFrac(cfg.boomBase));
    return { W, rowsN, dams: rowsN - lead.tramlineRows, nutzung: 1 - fg, fg, rd, lossHaCent, saveVsBaseHaCent: Math.round(baseLossHa - lossHaCent) };
  }) : [];

  // Cash-Crop-Schlagkraft: +Breite → +ha/h → weniger Spritzen im Peakfenster (kein Ertragseffekt).
  const ch = cfg.cash;
  const cEffBase = ch.cEffBaseHaH;
  const cEffAlt = cfg.boomBase > 0 ? cEffBase * (cfg.boomAlt / cfg.boomBase) : cEffBase;
  const capMachine = (cEff: number) => cEff * ch.windowDays * ch.hoursDay;       // ha je Maschine im Fenster
  const demandHa = ch.areaHa * ch.passes;                                        // ha-Überfahrten im Peak
  const machBase = capMachine(cEffBase) > 0 ? Math.ceil(demandHa / capMachine(cEffBase)) : 0;
  const machAlt = capMachine(cEffAlt) > 0 ? Math.ceil(demandHa / capMachine(cEffAlt)) : 0;
  const dMach = Math.max(0, machBase - machAlt);
  const cash = {
    cEffBase, cEffAlt, haDayBase: cEffBase * ch.hoursDay, haDayAlt: cEffAlt * ch.hoursDay,
    machBase, machAlt, dMach, capexSaved: dMach * ch.sprayerCapexCent, operatorSaved: dMach * ch.operatorYearCent,
  };

  return { D, rows, benefitTotal, wvBase, wvAlt, capMehr, mehrpreis, netBenefit, paybackYears, tenYear, ranking, HOLD_YEARS, cash };
}

export function TramlineEconomics() {
  const domain = useModelStore((s) => s.domain);
  const patch = useModelStore((s) => s.patch);
  const cfg = domain.tramline;
  if (!cfg) return null;

  const setCfg = (p: Partial<TramlineConfig>) => patch((d) => { if (d.tramline) Object.assign(d.tramline, p); });
  const setCrop = (key: string, p: Partial<TramlineCrop>) => patch((d) => { const c = d.tramline?.crops.find((x) => x.key === key); if (c) Object.assign(c, p); });
  const setCash = (p: Partial<TramlineCash>) => patch((d) => { if (d.tramline) d.tramline.cash = { ...d.tramline.cash, ...p }; });

  const r = computeTramline(cfg);
  const border = "var(--nx-border)", surface = "var(--nx-surface)";
  const pos = "var(--nx-pos, #2E7D32)";
  const th = "px-2 py-1.5 caption text-[9.5px] text-nx-text-muted whitespace-nowrap";
  const pct = (x: number, d = 2) => `${fmtNumber(x * 100, d)} %`;

  return (
    <section className="rounded-tile border overflow-hidden" style={{ borderColor: border, background: surface }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: border }}>
        <h3 className="text-[13px] font-semibold">{t("Fahrgassen-Ökonomie unter Pivot — Kartoffel (Neoterra-Kartoffelplanung)")}</h3>
        <span className="caption text-[10.5px] text-nx-text-muted">{t("Nettovorteil")} {cfg.boomAlt} m: <b className="num" style={{ color: pos }}>+{fmtMoney(r.netBenefit)} €/a</b> · {t("Amortisation")} {isFinite(r.paybackYears) ? (r.paybackYears < 1 ? t("< 1 Saison") : `${fmtNumber(r.paybackYears, 1)} ${t("J.")}`) : "—"}</span>
      </div>
      <p className="px-4 py-2.5 text-[11.5px] text-nx-text-secondary leading-relaxed">
        {t("Zwei Verlustquellen bei breiterem Gestänge:")} <b>{t("Fahrgassenverlust")}</b> {t("(2 ausgesparte Reihen je Spritzbreite; 75-cm-Reihen, Radstand 2,25 m = 2 Dämme zwischen den Rädern) sinkt mit der Breite;")} <b>{t("Randverlust")}</b> {t("(Kreis-Fit auf dem Pivot — Vorgewende/Randbahnen) steigt leicht mit der Breite und springt je nach Pivotgröße. Gültige Spritzbreiten = Vielfache der Pflanz-Arbeitsbreite (")}{fmtNumber(cfg.planterM, 1)} {t("m). Randverlust über")}
        <code> randFactor</code> {t("auf eure Pivot-Fit-Analyse kalibrierbar.")}
      </p>

      {/* Pivot- & System-Geometrie */}
      <div className="px-4 py-2.5 border-y flex flex-wrap items-center gap-x-6 gap-y-2" style={{ borderColor: border, background: "var(--nx-surface-sunken)" }}>
        <label className="flex items-center gap-2 text-[12px]"><span className="text-nx-text-secondary">{t("Ø Fläche/Pivot")}</span><NumberInput value={cfg.pivotHa} width={60} suffix="ha" onCommit={(n) => setCfg({ pivotHa: Math.max(1, n) })} /></label>
        <label className="flex items-center gap-2 text-[12px]"><span className="text-nx-text-secondary">{t("Pivots")}</span><NumberInput value={cfg.pivots} width={52} onCommit={(n) => setCfg({ pivots: Math.max(1, Math.round(n)) })} /></label>
        <label className="flex items-center gap-2 text-[12px]"><span className="text-nx-text-secondary">{t("Boom Basis")}</span><NumberInput value={cfg.boomBase} width={50} suffix="m" onCommit={(n) => setCfg({ boomBase: Math.max(1, n) })} /></label>
        <label className="flex items-center gap-2 text-[12px]"><span className="text-nx-text-secondary">{t("Boom Alt")}</span><NumberInput value={cfg.boomAlt} width={50} suffix="m" onCommit={(n) => setCfg({ boomAlt: Math.max(1, n) })} /></label>
        <label className="flex items-center gap-2 text-[12px]"><span className="text-nx-text-secondary">{t("Pflanzbreite")}</span><NumberInput value={cfg.planterM} width={48} suffix="m" onCommit={(n) => setCfg({ planterM: Math.max(0.5, n) })} /></label>
        <label className="flex items-center gap-2 text-[12px]"><span className="text-nx-text-secondary">randFactor</span><NumberInput value={cfg.randFactor} width={56} onCommit={(n) => setCfg({ randFactor: Math.max(0, n) })} /></label>
        <span className="text-[11.5px] text-nx-text-muted">{t("Feld-⌀")} <b className="num">{fmtNumber(r.D, 0)} m</b></span>
      </div>

      {/* Kultur-Geometrie */}
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full" style={{ minWidth: 720 }}>
          <thead><tr>
            <th className={th + " text-left"}>{t("Kultur")}</th>
            <th className={th + " text-right"}>{t("Fläche")}</th>
            <th className={th + " text-right"}>{t("Reihenabstand")}</th>
            <th className={th + " text-right"}>{t("Fahrgassen-Reihen/Boom")}</th>
            <th className={th + " text-right"}>{t("Ertrag")}</th>
            <th className={th + " text-right"}>{t("Preis")}</th>
          </tr></thead>
          <tbody>
            {cfg.crops.map((c) => (
              <tr key={c.key} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-[12px]">{c.label}</td>
                <td className="px-2 py-1.5 text-right"><NumberInput value={c.areaHa} width={72} suffix="ha" onCommit={(n) => setCrop(c.key, { areaHa: Math.max(0, n) })} /></td>
                <td className="px-2 py-1.5 text-right"><NumberInput value={c.rowM} width={62} suffix="m" onCommit={(n) => setCrop(c.key, { rowM: Math.max(0.1, n) })} /></td>
                <td className="px-2 py-1.5 text-right"><NumberInput value={c.tramlineRows} width={48} onCommit={(n) => setCrop(c.key, { tramlineRows: Math.max(0, Math.round(n)) })} /></td>
                <td className="px-2 py-1.5 text-right"><NumberInput value={c.yieldT} width={58} suffix="t/ha" onCommit={(n) => setCrop(c.key, { yieldT: Math.max(0, n) })} /></td>
                <td className="px-2 py-1.5 text-right"><NumberInput value={c.priceEurTCent} moneyCent width={72} suffix="€/t" onCommit={(n) => setCrop(c.key, { priceEurTCent: Math.max(0, n) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Verlust-Vergleich Basis vs Alt */}
      <div className="overflow-x-auto px-2 py-2 border-t" style={{ borderColor: border }}>
        <table className="w-full" style={{ minWidth: 900 }}>
          <thead><tr>
            <th className={th + " text-left"}>{t("Kultur")}</th>
            <th className={th + " text-right"}>{t("Reihen/Pivot")}</th>
            <th className={th + " text-right"}>{t("Fahrgassenverlust")} {cfg.boomBase}→{cfg.boomAlt}</th>
            <th className={th + " text-right"}>{t("Randverlust")} {cfg.boomBase}→{cfg.boomAlt}</th>
            <th className={th + " text-right"}>{t("Gesamtverlust")} {cfg.boomBase}→{cfg.boomAlt}</th>
            <th className={th + " text-right"}>{t("Ertragsverlust €/a")} {cfg.boomBase}→{cfg.boomAlt}</th>
            <th className={th + " text-right"}>{t("Vorteil")} {cfg.boomAlt}</th>
          </tr></thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.c.key} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-[12px]">{x.c.label}</td>
                <td className="px-2 py-1.5 text-right num text-[12px]">{fmtNumber(x.rowsPerPivot, 0)}</td>
                <td className="px-2 py-1.5 text-right num text-[12px]">{pct(x.fgB)} → <b>{pct(x.fgA)}</b></td>
                <td className="px-2 py-1.5 text-right num text-[12px]">{pct(x.rB)} → {pct(x.rA)}</td>
                <td className="px-2 py-1.5 text-right num text-[12px]">{pct(x.lossB)} → <b>{pct(x.lossA)}</b></td>
                <td className="px-2 py-1.5 text-right num text-[12px]">{fmtMoney(x.revLossB)} → {fmtMoney(x.revLossA)}</td>
                <td className="px-2 py-1.5 text-right num text-[12px] font-semibold" style={{ color: pos }}>+{fmtMoney(x.benefit)} €</td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-2 py-2 text-[12px] font-semibold" colSpan={6}>{t("Σ Flächen-/Fahrgassen-Vorteil")} {cfg.boomAlt} {t("m vs.")} {cfg.boomBase} m</td>
              <td className="px-2 py-2 text-right num text-[13px] font-semibold" style={{ color: pos }}>+{fmtMoney(r.benefitTotal)} €</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Breiten-Ranking (Leitkultur) */}
      <div className="overflow-x-auto px-2 py-2 border-t" style={{ borderColor: border }}>
        <div className="px-2 py-1 caption text-[10px] text-nx-text-muted uppercase tracking-wide">{t("Gültige Spritzbreiten (Vielfache")} {fmtNumber(cfg.planterM, 1)} {t("m) —")} {cfg.crops[0]?.label}</div>
        <table className="w-full" style={{ minWidth: 640 }}>
          <thead><tr>
            <th className={th + " text-right"}>{t("Breite")}</th>
            <th className={th + " text-right"}>{t("Reihen")}</th>
            <th className={th + " text-right"}>{t("Dämme")}</th>
            <th className={th + " text-right"}>{t("Flächennutzung")}</th>
            <th className={th + " text-right"}>{t("Verlust €/ha")}</th>
            <th className={th + " text-right"}>{t("Ersparnis/ha vs.")} {cfg.boomBase} m</th>
          </tr></thead>
          <tbody>
            {r.ranking.map((w) => {
              const isAlt = w.W === Math.round(cfg.boomAlt);
              return (
                <tr key={w.W} style={{ borderTop: "1px solid var(--nx-border-divider)", background: isAlt ? "color-mix(in srgb, var(--nsb-accent) 12%, transparent)" : "transparent" }}>
                  <td className="px-2 py-1.5 text-right num text-[12px] font-semibold">{w.W} m{isAlt ? " ◄" : ""}</td>
                  <td className="px-2 py-1.5 text-right num text-[12px]">{w.rowsN}</td>
                  <td className="px-2 py-1.5 text-right num text-[12px]">{w.dams}</td>
                  <td className="px-2 py-1.5 text-right num text-[12px]">{pct(w.nutzung, 1)}</td>
                  <td className="px-2 py-1.5 text-right num text-[12px]">{fmtMoney(w.lossHaCent)}</td>
                  <td className="px-2 py-1.5 text-right num text-[12px]" style={{ color: w.saveVsBaseHaCent > 0 ? pos : "inherit" }}>{w.saveVsBaseHaCent > 0 ? "+" : ""}{fmtMoney(w.saveVsBaseHaCent)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Kapital & Nettowirtschaftlichkeit */}
      <div className="px-4 py-3 border-t grid gap-4 sm:grid-cols-5" style={{ borderColor: border }}>
        <div>
          <div className="caption text-[10px] text-nx-text-muted uppercase tracking-wide">{t("Flächen-Vorteil p.a.")}</div>
          <div className="text-[16px] font-semibold num" style={{ color: pos }}>+{fmtMoney(r.benefitTotal)} €</div>
        </div>
        <div>
          <div className="caption text-[10px] text-nx-text-muted uppercase tracking-wide">{t("Kapital-Mehrkosten p.a.")}</div>
          <div className="text-[16px] font-semibold num">−{fmtMoney(r.capMehr)} €</div>
        </div>
        <div>
          <div className="caption text-[10px] text-nx-text-muted uppercase tracking-wide">{t("Nettovorteil p.a.")}</div>
          <div className="text-[16px] font-semibold num" style={{ color: pos }}>+{fmtMoney(r.netBenefit)} €</div>
        </div>
        <div>
          <div className="caption text-[10px] text-nx-text-muted uppercase tracking-wide">{t("Amortisation Mehrpreis")}</div>
          <div className="text-[16px] font-semibold num">{isFinite(r.paybackYears) ? (r.paybackYears < 1 ? t("< 1 Saison") : `${fmtNumber(r.paybackYears, 1)} ${t("J.")}`) : "—"}</div>
        </div>
        <div>
          <div className="caption text-[10px] text-nx-text-muted uppercase tracking-wide">{t("Nettovorteil")} {r.HOLD_YEARS} {t("J.")}</div>
          <div className="text-[16px] font-semibold num" style={{ color: pos }}>+{fmtMoney(r.tenYear)} €</div>
        </div>
      </div>
      <div className="px-4 pb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px]">
        <span className="text-nx-text-muted">{t("Kapital (Wertverlust/")}{r.HOLD_YEARS} {t("J.):")}</span>
        <label className="flex items-center gap-1.5"><span className="text-nx-text-secondary">{t("Spritze")} {cfg.boomBase} m</span><NumberInput value={cfg.capPriceBaseCent} moneyCent width={90} suffix="€" onCommit={(n) => setCfg({ capPriceBaseCent: Math.max(0, n) })} /></label>
        <label className="flex items-center gap-1.5"><span className="text-nx-text-secondary">{t("RW")}</span><NumberInput value={Math.round(cfg.capResBasePct * 100)} width={48} suffix="%" onCommit={(n) => setCfg({ capResBasePct: Math.max(0, Math.min(1, n / 100)) })} /></label>
        <label className="flex items-center gap-1.5"><span className="text-nx-text-secondary">{t("Spritze")} {cfg.boomAlt} m</span><NumberInput value={cfg.capPriceAltCent} moneyCent width={90} suffix="€" onCommit={(n) => setCfg({ capPriceAltCent: Math.max(0, n) })} /></label>
        <label className="flex items-center gap-1.5"><span className="text-nx-text-secondary">{t("RW")}</span><NumberInput value={Math.round(cfg.capResAltPct * 100)} width={48} suffix="%" onCommit={(n) => setCfg({ capResAltPct: Math.max(0, Math.min(1, n / 100)) })} /></label>
      </div>
      {/* Cash-Crop-Effekt: Schlagkraft → Maschinenbedarf */}
      <div className="px-4 pt-3 pb-1 border-t" style={{ borderColor: border }}>
        <h4 className="text-[12.5px] font-semibold">{t("Cash Crops — Schlagkraft statt Ertragseffekt: sinkender Maschinenbedarf")}</h4>
        <p className="text-[11.5px] text-nx-text-secondary leading-relaxed mt-1">
          {t("Getreide/Raps/Soja/Mais werden flächig gedrillt — kein nennenswerter Fahrgassen-Ertragsverlust. Hier liegt der 48-m-Wert in der")} <b>{t("Schlagkraft")}</b>: {fmtNumber(r.cash.cEffBase, 1)} → <b>{fmtNumber(r.cash.cEffAlt, 1)} ha/h</b> {t("(+33 %) → die Peak-Spritzfläche wird mit")} <b>{t("weniger Maschinen")}</b> {t("abgedeckt.")}
        </p>
      </div>
      <div className="px-4 py-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px]">
        <label className="flex items-center gap-1.5"><span className="text-nx-text-secondary">{t("Cash-Fläche")}</span><NumberInput value={cfg.cash.areaHa} width={72} suffix="ha" onCommit={(n) => setCash({ areaHa: Math.max(0, n) })} /></label>
        <label className="flex items-center gap-1.5"><span className="text-nx-text-secondary">{t("Überfahrten/Peak")}</span><NumberInput value={cfg.cash.passes} width={44} onCommit={(n) => setCash({ passes: Math.max(0, n) })} /></label>
        <label className="flex items-center gap-1.5"><span className="text-nx-text-secondary">ha/h @{cfg.boomBase} m</span><NumberInput value={cfg.cash.cEffBaseHaH} width={56} onCommit={(n) => setCash({ cEffBaseHaH: Math.max(0.1, n) })} /></label>
        <label className="flex items-center gap-1.5"><span className="text-nx-text-secondary">{t("Fenster")}</span><NumberInput value={cfg.cash.windowDays} width={44} suffix={t("Tage")} onCommit={(n) => setCash({ windowDays: Math.max(1, n) })} /></label>
        <label className="flex items-center gap-1.5"><span className="text-nx-text-secondary">{t("h/Tag")}</span><NumberInput value={cfg.cash.hoursDay} width={44} onCommit={(n) => setCash({ hoursDay: Math.max(1, n) })} /></label>
        <label className="flex items-center gap-1.5"><span className="text-nx-text-secondary">{t("CAPEX/Spritze")}</span><NumberInput value={cfg.cash.sprayerCapexCent} moneyCent width={90} suffix="€" onCommit={(n) => setCash({ sprayerCapexCent: Math.max(0, n) })} /></label>
        <label className="flex items-center gap-1.5"><span className="text-nx-text-secondary">{t("Fahrer/Jahr")}</span><NumberInput value={cfg.cash.operatorYearCent} moneyCent width={80} suffix="€" onCommit={(n) => setCash({ operatorYearCent: Math.max(0, n) })} /></label>
      </div>
      <div className="px-4 py-3 grid gap-4 sm:grid-cols-4" style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
        <div>
          <div className="caption text-[10px] text-nx-text-muted uppercase tracking-wide">{t("Leistung/Tag")} {cfg.boomBase}→{cfg.boomAlt} m</div>
          <div className="text-[15px] font-semibold num">{fmtNumber(r.cash.haDayBase, 0)} → {fmtNumber(r.cash.haDayAlt, 0)} ha</div>
        </div>
        <div>
          <div className="caption text-[10px] text-nx-text-muted uppercase tracking-wide">{t("Spritzen am Peak")} {cfg.boomBase}→{cfg.boomAlt} m</div>
          <div className="text-[15px] font-semibold num">{r.cash.machBase} → <b style={{ color: r.cash.dMach > 0 ? pos : "inherit" }}>{r.cash.machAlt}</b>{r.cash.dMach > 0 ? ` (−${r.cash.dMach})` : ""}</div>
        </div>
        <div>
          <div className="caption text-[10px] text-nx-text-muted uppercase tracking-wide">{t("CAPEX-Einsparung (einmalig)")}</div>
          <div className="text-[15px] font-semibold num" style={{ color: r.cash.capexSaved > 0 ? pos : "inherit" }}>{r.cash.capexSaved > 0 ? "+" : ""}{fmtMoney(r.cash.capexSaved)} €</div>
        </div>
        <div>
          <div className="caption text-[10px] text-nx-text-muted uppercase tracking-wide">{t("Fahrer-Einsparung p.a.")}</div>
          <div className="text-[15px] font-semibold num" style={{ color: r.cash.operatorSaved > 0 ? pos : "inherit" }}>{r.cash.operatorSaved > 0 ? "+" : ""}{fmtMoney(r.cash.operatorSaved)} €</div>
        </div>
      </div>

      <div className="px-4 py-2 border-t text-[11px] text-nx-text-muted" style={{ borderColor: border }}>
        {t("Leitkultur-Ranking auf Kartoffel; Tomate/weitere fließen über ihre Zeile in den Σ-Vorteil. Randverlust ist ein kalibrierbarer Näherungsterm (Kreis-Fit/Vorgewende) —")} <code>randFactor</code> {t("an eure Pivot-Fit-Analyse anpassen. Betriebskosten (−25 % Spritz-€/ha) stehen oben im 36/48-Vergleich. Die Cash-Crop-Maschineneinsparung ist")} <b>{t("nicht")}</b> {t("in die Fahrgassen-Amortisation eingerechnet (im Bestand bereits vorhanden; reale Neubeschaffungs-Einsparung erst bei Skalierung Stufe 2/3b — sonst Doppelzählung mit der Modell-Flotte). Der Streuer (36 m → Leeb Xeric 48 m) folgt derselben Logik.")}
      </div>
    </section>
  );
}
