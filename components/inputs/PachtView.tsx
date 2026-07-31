"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { pachtIndexFactor, annuityPV, START_YEAR } from "../../store/model";
import { NumberInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import { Check, X } from "lucide-react";

const N_YEARS = 8;
const BASIS_LABEL: Record<string, string> = {
  cpi: "Verbraucherpreisindex (HICP/VPI)", landvalue: "Bodenwert-gekoppelt (% p.a.)", fixed: "Fixe Staffel",
};

/** Pacht-Simulator — OpCo pachtet ~2.500 ha Eigentum von der Besitzgesellschaft (asset-light OpCo).
 *  Index-Stufe alle N Jahre. Bilanzierung als fixe Betriebskosten (indirekt, nicht COGS). */
export function PachtView() {
  const { domain, patch } = useModelStore();
  const p = domain.pacht;
  if (!p) return <div className="text-[12px] text-nx-text-muted">{t("Keine Pacht konfiguriert.")}</div>;

  const setP = (fn: (pp: any) => void) => patch((d) => { if (d.pacht) fn(d.pacht); });
  const steps = p.indexSteps ?? [];
  const rate = (y: number) => p.baseRentPerHaCent * pachtIndexFactor(p, y);
  const total = (y: number) => p.ownedHa * rate(y);
  const isStep = (y: number) => steps.length ? steps.some((s) => s.atYear === y) : (y > 0 && Math.floor(y / p.intervalYears) !== Math.floor((y - 1) / p.intervalYears));
  const genSteps = () => setP((pp) => { const out: { atYear: number; pct: number }[] = []; for (let yy = pp.intervalYears; yy <= 20; yy += pp.intervalYears) out.push({ atYear: yy, pct: pp.indexPct }); pp.indexSteps = out; });
  const sumHorizon = Array.from({ length: N_YEARS }, (_, y) => total(y)).reduce((a, b) => a + b, 0);
  const nextStep = (() => { for (let y = 1; y < N_YEARS; y++) if (isStep(y)) return START_YEAR + y; return null; })();

  return (
    <div className="space-y-4">
      {/* Kopf + Inputs */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Pacht-Simulator — Besitzgesellschaft → OpCo")}</h2>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border-divider)" }}>
          <label className="flex flex-col gap-1"><span className="caption text-[10px] text-nx-text-muted">{t("Eigentumsfläche (Besitzges.)")}</span>
            <NumberInput value={p.ownedHa} width={80} suffix="ha" onCommit={(n) => setP((pp) => { pp.ownedHa = Math.max(0, Math.round(n)); })} /></label>
          <label className="flex flex-col gap-1"><span className="caption text-[10px] text-nx-text-muted">{t("Basis-Pacht €/ha")}</span>
            <NumberInput value={p.baseRentPerHaCent} moneyCent width={80} onCommit={(n) => setP((pp) => { pp.baseRentPerHaCent = Math.max(0, Math.round(n)); })} /></label>
          <label className="flex flex-col gap-1"><span className="caption text-[10px] text-nx-text-muted">{t("Index je Stufe")}</span>
            <NumberInput value={p.indexPct * 100} width={64} suffix="%" onCommit={(n) => setP((pp) => { pp.indexPct = Math.max(0, n / 100); })} /></label>
          <label className="flex flex-col gap-1"><span className="caption text-[10px] text-nx-text-muted">{t("Intervall")}</span>
            <NumberInput value={p.intervalYears} width={56} suffix="J" onCommit={(n) => setP((pp) => { pp.intervalYears = Math.max(1, Math.round(n)); })} /></label>
          <label className="flex flex-col gap-1"><span className="caption text-[10px] text-nx-text-muted">{t("Indexmechanismus")}</span>
            <select className="rounded-control border px-2 text-[12px]" style={{ height: 34, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }}
              value={p.indexBasis} onChange={(e) => setP((pp) => { pp.indexBasis = e.target.value; })}>
              <option value="cpi">{t("CPI (HICP/VPI)")}</option><option value="landvalue">{t("Bodenwert-gekoppelt")}</option><option value="fixed">{t("Fixe Staffel")}</option>
            </select></label>
          <label className="flex flex-col gap-1"><span className="caption text-[10px] text-nx-text-muted">{t("Bilanzierung")}</span>
            <span className="inline-flex items-center gap-1.5" style={{ height: 34 }}>
              <input type="checkbox" checked={!!p.ifrs16} onChange={(e) => setP((pp) => { pp.ifrs16 = e.target.checked; })} />
              <span className="text-[12px]">{t("IFRS 16 (ROU + Verbindl.)")}</span>
            </span></label>
          {p.ifrs16 && <label className="flex flex-col gap-1"><span className="caption text-[10px] text-nx-text-muted">{t("Leasinglaufzeit")}</span>
            <NumberInput value={p.leaseTermYears ?? 15} width={56} suffix="J" onCommit={(n) => setP((pp) => { pp.leaseTermYears = Math.max(1, Math.round(n)); })} /></label>}
          {p.ifrs16 && <label className="flex flex-col gap-1"><span className="caption text-[10px] text-nx-text-muted">{t("Diskontsatz")}</span>
            <NumberInput value={(p.discountRate ?? 0.05) * 100} width={60} suffix="%" onCommit={(n) => setP((pp) => { pp.discountRate = Math.max(0.001, n / 100); })} /></label>}
        </div>
        {p.ifrs16 && (() => {
          const T = p.leaseTermYears ?? 15, r = p.discountRate ?? 0.05;
          const rou0 = p.ownedHa * p.baseRentPerHaCent * (T > 0 && r > 0 ? (1 - Math.pow(1 + r, -T)) / r : T);
          const dep = T > 0 ? rou0 / T : 0, int1 = rou0 * r;
          return (
            <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)" }}>
              {[
                [t("ROU-Asset (Ersterfassung)"), fmtMoney(rou0) + " €", `PV, ${T} J @ ${fmtNumber(r * 100, 1)} %`, "var(--nx-locate)"],
                [t("Leasingverbindlichkeit"), fmtMoney(rou0) + " €", t("= ROU (Barwert)"), "var(--nx-locate)"],
                [t("AfA ROU / Jahr"), fmtMoney(dep) + " €", t("linear über Laufzeit")],
                [t("Zinsaufwand Jahr 1"), fmtMoney(int1) + " €", t("unter EBIT")],
              ].map(([k, v, s, c], i) => (
                <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
                  <div className="caption text-[10px] text-nx-text-muted">{k}</div>
                  <div className="num text-[14px] font-semibold" style={{ color: (c as string) ?? "var(--nx-text)" }}>{v}</div>
                  <div className="caption text-[9.5px] text-nx-text-muted">{s}</div>
                </div>
              ))}
            </div>
          );
        })()}
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)" }}>
          {[
            [t("Basis-Pacht (Jahr 1)"), fmtMoney(total(0)) + " €", `${fmtMoney(p.baseRentPerHaCent)} €/ha`],
            [`${t("Pacht")} ${START_YEAR + N_YEARS - 1}`, fmtMoney(total(N_YEARS - 1)) + " €", `${fmtMoney(rate(N_YEARS - 1))} €/ha`],
            [t("Σ Pacht über Horizont"), fmtMoney(sumHorizon) + " €", `${N_YEARS} ${t("Jahre")}`],
            [t("Nächste Index-Stufe"), nextStep ? String(nextStep) : "–", `+${fmtNumber(p.indexPct * 100, 0)} % · ${t(BASIS_LABEL[p.indexBasis])}`],
          ].map(([k, v, s], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[15px] font-semibold" style={{ color: i === 2 ? "var(--nx-brand-lift)" : "var(--nx-text)" }}>{v}</div>
              <div className="caption text-[9.5px] text-nx-text-muted">{s}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Trajektorie */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}><h2 className="text-[14px] font-semibold">{t("Pacht-Verlauf (Index-Stufen alle")} {p.intervalYears} {t("Jahre)")}</h2></div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead><tr><th className="px-2 py-1.5 text-left caption text-[10px] text-nx-text-muted">{t("Position")}</th>
              {Array.from({ length: N_YEARS }, (_, y) => <th key={y} className="px-2 py-1.5 text-right caption text-[10px]" style={{ color: isStep(y) ? "var(--nx-locate)" : "var(--nx-text-muted)" }}>{START_YEAR + y}{isStep(y) ? " ▲" : ""}</th>)}</tr></thead>
            <tbody>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-nx-text-secondary">{t("Pacht €/ha")}</td>
                {Array.from({ length: N_YEARS }, (_, y) => <td key={y} className="num px-2 py-1.5 text-right" style={{ fontWeight: isStep(y) ? 700 : 400, color: isStep(y) ? "var(--nx-locate)" : "var(--nx-text)" }}>{fmtMoney(rate(y))}</td>)}
              </tr>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Pacht gesamt")} ({fmtNumber(p.ownedHa, 0)} ha)</td>
                {Array.from({ length: N_YEARS }, (_, y) => <td key={y} className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(total(y))}</td>)}
              </tr>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-nx-text-muted">{t("Index (Basis = 100)")}</td>
                {Array.from({ length: N_YEARS }, (_, y) => <td key={y} className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtNumber(Math.pow(1 + p.indexPct, Math.floor(y / Math.max(1, p.intervalYears))) * 100, 0)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Auszahlungstranchen */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Auszahlungstranchen (Cash-Timing)")}</h3>
          <button className="rounded-control border px-2 text-[11px] font-semibold" style={{ height: 30, borderColor: "var(--nx-brand-lift)", color: "var(--nx-brand-lift)", background: "var(--nx-surface)" }}
            onClick={() => setP((pp) => { const tr = pp.payMonths ?? []; pp.payMonths = [...tr, { month: 8, share: 0.2 }]; })}>{t("+ Tranche")}</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {(p.payMonths ?? []).map((tr, i) => (
            <div key={i} className="inline-flex items-center gap-1.5 rounded-pill border px-2 py-1" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface-sunken)" }}>
              <select className="rounded-control border px-1 text-[11px]" style={{ height: 28, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }}
                value={tr.month} onChange={(e) => setP((pp) => { pp.payMonths[i].month = Number(e.target.value); })}>
                {["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"].map((mn, mi) => <option key={mi} value={mi + 1}>{t(mn)}</option>)}
              </select>
              <NumberInput value={tr.share * 100} width={54} suffix="%" onCommit={(n) => setP((pp) => { pp.payMonths[i].share = Math.max(0, n / 100); })} />
              <button className="text-[11px] text-nx-error" onClick={() => setP((pp) => { pp.payMonths = pp.payMonths.filter((_: any, j: number) => j !== i); })}><X size={12} strokeWidth={2.5} aria-hidden /></button>
            </div>
          ))}
          {(() => { const sum = (p.payMonths ?? []).reduce((a, x) => a + x.share, 0); return (
            <span className="text-[11px]" style={{ color: Math.abs(sum - 1) < 0.005 ? "var(--nx-success)" : "var(--nx-warning)" }}>Σ {t("Anteile")} {fmtNumber(sum * 100, 0)} %{Math.abs(sum - 1) > 0.005 ? t(" (sollte 100 % sein)") : <> <Check size={11} strokeWidth={2.5} className="inline align-[-1px]" aria-hidden /></>}</span>
          ); })()}
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Die Jahres-Pacht wird auf diese Monate verteilt (Standard:")} <b>{t("Aug 60 % / Okt 40 %")}</b>{t(") — steuert das Cash-Timing in der Liquiditätsplanung. Bei IFRS 16 fallen die Leasingzahlungen (Tilgung + Zins) ebenfalls in diesen Monaten an (saisonaler Kapitaldienst).")}
        </div>
      </section>

      {/* Anpassbarer Indexfahrplan */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-brand-lift)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Indexfahrplan — je Stufe frei anpassbar")}</h3>
          <div className="flex items-center gap-2">
            <button className="rounded-control border px-2 text-[11px]" style={{ height: 30, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }} title={`${t("Stufen aus Intervall (")}${p.intervalYears}${t(" J) × ")}${fmtNumber(p.indexPct * 100, 0)}${t(" % erzeugen")}`} onClick={genSteps}>{t("↻ aus Intervall erzeugen")}</button>
            <button className="rounded-control border px-2 text-[11px] font-semibold" style={{ height: 30, borderColor: "var(--nx-brand-lift)", color: "var(--nx-brand-lift)", background: "var(--nx-surface)" }} onClick={() => setP((pp) => { const s = pp.indexSteps ?? []; const nextY = (s.length ? Math.max(...s.map((x: any) => x.atYear)) : 0) + (pp.intervalYears || 5); pp.indexSteps = [...s, { atYear: nextY, pct: pp.indexPct }]; })}>{t("+ Stufe")}</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {steps.length === 0 && <span className="text-[11.5px] text-nx-text-muted">{t("Kein Fahrplan — es gilt der gleichmäßige Fallback (")}{fmtNumber(p.indexPct * 100, 0)}{t(" % alle ")}{p.intervalYears}{t(" J). „+ Stufe\" für individuelle Anhebungen.")}</span>}
          {steps.map((s, i) => (
            <div key={i} className="inline-flex items-center gap-1.5 rounded-pill border px-2 py-1" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface-sunken)" }}>
              <span className="text-[10.5px] text-nx-text-muted">{t("Jahr")}</span>
              <NumberInput value={s.atYear} width={44} onCommit={(n) => setP((pp) => { pp.indexSteps[i].atYear = Math.max(1, Math.round(n)); })} />
              <NumberInput value={s.pct * 100} width={54} suffix="%" onCommit={(n) => setP((pp) => { pp.indexSteps[i].pct = Math.max(0, n / 100); })} />
              <button className="text-[11px] text-nx-error" onClick={() => setP((pp) => { pp.indexSteps = pp.indexSteps.filter((_: any, j: number) => j !== i); })}><X size={12} strokeWidth={2.5} aria-hidden /></button>
            </div>
          ))}
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Jede Stufe hebt die Pacht ab dem angegebenen Jahr kumulativ um den %-Satz an — beliebig viele Stufen, ungleiche Abstände und Sätze möglich (z. B. CPI-Schätzung je Review-Termin). Ohne Fahrplan greift der gleichmäßige Intervall/%-Fallback.")}
        </div>
      </section>

      {/* Indexierung + Bilanzierung (Research) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
          <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}><h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Indexierungs-Mechanismen (europäische Praxis)")}</h3></div>
          <div className="px-4 py-3 text-[11.5px] text-nx-text-secondary space-y-1.5">
            <div><b>{t("CPI-/Wertsicherung:")}</b> {t("Pacht an Verbraucherpreisindex (HICP/VPI) gekoppelt, Anpassung in Stufen. In DE Preisklauselgesetz beachten.")}</div>
            <div><b>{t("Fermage-Index (FR):")}</b> {t("gesetzlich gedeckelt, jährlicher „indice national des fermages\" (Betriebseinkommen + Preisniveau).")}</div>
            <div><b>{t("Bodenwert-gekoppelt:")}</b> {t("Pacht als Rendite-% auf den aktuellen Bodenwert (z. B. 2–3 %), periodisch neu bewertet.")}</div>
            <div><b>{t("Fixe Staffel / Review:")}</b> {t("vereinbarte Stufen (z. B. +8 % alle 5 J.) oder Marktmiet-Review (UK 3-jährlich).")}</div>
            <div className="text-nx-text-muted pt-1">{t("Hier gewählt:")} <b>{t(BASIS_LABEL[p.indexBasis])}</b>, +{fmtNumber(p.indexPct * 100, 0)} {t("% alle")} {p.intervalYears} {t("Jahre.")}</div>
          </div>
        </section>
        <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
          <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}><h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Bilanzierung — COGS oder indirekt?")}</h3></div>
          <div className="px-4 py-3 text-[11.5px] text-nx-text-secondary space-y-1.5">
            <div><b>{t("Kostenrechnung (Agrar EU):")}</b> {t("Pacht ist")} <b>{t("Fixkosten")}</b> {t("(Flächenkosten),")} <b>{t("nicht")}</b> {t("im Deckungsbeitrag (der nur variable Direktkosten abzieht) — also indirekte/Periodenkosten, erst im Betriebsergebnis. So auch KTBL/DLG-Schema.")}</div>
            <div><b>{t("GuV:")}</b> {t("üblich als eigene Zeile „Pacht & Mieten\" bzw. sonstige betriebliche Aufwendungen — über dem EBIT, kein COGS.")}</div>
            <div><b>{t("IFRS 16:")}</b> {t("Landpacht > 12 Monate wird als Right-of-Use-Asset + Leasingverbindlichkeit aktiviert (AfA + Zins statt Pauschal-Miete); Kurzläufer (≤ 12 M) & Low-Value bleiben Aufwand.")}</div>
            <div className="text-nx-text-muted pt-1">{t("Im Modell: als")} <b>{t("fixe Betriebskosten (opex.pacht)")}</b> {t("geführt — reduziert EBIT, kein COGS. Die 2.500 ha Eigentum zahlen die (indexierte) Intercompany-Pacht, die übrige Fläche die Dritt-Pacht.")}</div>
          </div>
        </section>
      </div>
    </div>
  );
}
