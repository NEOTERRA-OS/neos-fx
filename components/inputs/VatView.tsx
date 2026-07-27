"use client";
import React from "react";
import { useModelStore, selectComputed } from "../../store/modelStore";
import { NumberInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import type { VatTreatment } from "../../core/types";

/** USt / TVA (RO) — Ausgangs-/Vorsteuer, Reverse-Charge (Getreide/Ölsaaten), CAPEX-Vorsteuer-
 *  Erstattung (rambursare), Zahllast-/Erstattungs-Timing → Cashflow + Bilanz (USt-Forderung/
 *  -Verbindlichkeit). USt ist durchlaufend (P&L netto); Wirkung nur über Cash-Timing + Saldo. */

const CROP_LABEL: Record<string, string> = {
  weizen: "Winterweizen", gerste_zw: "Wintergerste + Doppel-Soja", soja_luzerne: "Soja / Luzerne",
  winterraps: "Winterraps", mais: "Körnermais", tomate: "Industrietomate",
  kartoffel_pommes: "Kartoffel (Pommes)", kartoffel_chips: "Kartoffel (Chips)", zwiebel_moehre: "Zwiebel / Möhre",
  suesskartoffel: "Süßkartoffel", knoblauch: "Knoblauch", knollensellerie: "Knollensellerie",
};
const TREAT_LABEL: Record<VatTreatment, string> = {
  standard: "Regelsatz 21 %", reduced: "ermäßigt 11 %", reverse_charge: "Reverse-Charge (0 %)",
  export: "Export / i.g. (0 %)", zero: "befreit (0 %)",
};
const TREATS: VatTreatment[] = ["standard", "reduced", "reverse_charge", "export", "zero"];
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export function VatView() {
  const { domain, patch } = useModelStore();
  const computed = useModelStore(selectComputed);
  const v = domain.vat;
  const bs = computed.balanceSheet;
  const cf = computed.cashFlow;

  const rec = bs.vatReceivable?.values ?? [];
  const pay = bs.vatPayable?.values ?? [];
  const cash = cf.vatCashFlow?.values ?? [];
  const peakRec = rec.length ? Math.max(...rec) : 0;
  const peakPay = pay.length ? Math.max(...pay) : 0;
  const endNet = (rec[rec.length - 1] ?? 0) - (pay[pay.length - 1] ?? 0);
  const maxAbs = Math.max(1, ...rec, ...pay);

  const setV = (fn: (d: any) => void) => patch((d) => { fn(d.vat); });
  const cropsInPlan = Array.from(new Set(domain.anbauplan.map((a) => a.cropId)));

  return (
    <div className="space-y-4">
      {/* Kopf */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("USt / TVA — Rumänien (Cod Fiscal 2026)")}</h2>
          <label className="inline-flex items-center gap-1.5 text-[11.5px]">
            <input type="checkbox" checked={v.enabled} onChange={(e) => setV((d) => { d.enabled = e.target.checked; })} />
            {t("USt-Mechanik aktiv")}
          </label>
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)" }}>
          {[
            [t("Peak USt-Forderung (CAPEX-Vorfinanz.)"), fmtMoney(peakRec) + " €"],
            [t("Peak USt-Verbindlichkeit (Ernte)"), fmtMoney(peakPay) + " €"],
            [t("Netto-Position Jahresende"), (endNet >= 0 ? t("Forderung ") : t("Verbindl. ")) + fmtMoney(Math.abs(endNet)) + " €"],
            [t("Regelsatz / ermäßigt"), fmtNumber(v.standardRate * 100, 0) + " % / " + fmtNumber(v.reducedRate * 100, 0) + " %"],
          ].map(([k, val], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[13px] font-semibold" style={{ color: "var(--nx-text)" }}>{val}</div>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 text-[11.5px] text-nx-text-muted">
          {t("Getreide & technische Pflanzen inkl. Ölsaaten fallen unter ")}<b>Reverse-Charge (taxare inversă, Art. 331)</b>{t(" — keine Ausgangs-USt. Wertkulturen (Nahrungsmittel) mit 11 %. Maschinen/Inputs mit 21 % Vorsteuer, voll abziehbar → NEOTERRA ist strukturell ")}
          <b>{t(" Vorsteuer-Überhänger")}</b>{t("; die CAPEX-USt (~")}{fmtMoney(peakRec)}{t(" €) wird vorfinanziert und mit ~")}{v.refundLagMonths}{t(" M Lag erstattet. USt wirkt ")}<b>{t("durchlaufend")}</b>{t(" (GuV netto), nur Cash-Timing + Bilanz-Saldo.")}
        </div>
      </section>

      {/* Mittelblock: Sätze/Timing + Ausgangs-USt nebeneinander (füllt Breite, reduziert Weißraum) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Sätze & Vorsteuer-Parameter */}
        <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
          <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
            <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Sätze, Vorsteuer & Timing")}</h3>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3">
            <Field label={t("Regelsatz %")}><NumberInput value={v.standardRate * 100} width={64} suffix="%" onCommit={(n) => setV((d) => { d.standardRate = n / 100; })} /></Field>
            <Field label={t("Ermäßigter Satz %")}><NumberInput value={v.reducedRate * 100} width={64} suffix="%" onCommit={(n) => setV((d) => { d.reducedRate = n / 100; })} /></Field>
            <Field label={t("Vorsteuer CAPEX %")}><NumberInput value={v.inputRateCapex * 100} width={64} suffix="%" onCommit={(n) => setV((d) => { d.inputRateCapex = n / 100; })} /></Field>
            <Field label={t("Vorsteuer Inputs %")}><NumberInput value={v.inputRateCost * 100} width={64} suffix="%" onCommit={(n) => setV((d) => { d.inputRateCost = n / 100; })} /></Field>
            <Field label={t("abziehbar COGS-Anteil %")}><NumberInput value={v.recoverableCogsShare * 100} width={64} suffix="%" onCommit={(n) => setV((d) => { d.recoverableCogsShare = n / 100; })} /></Field>
            <Field label={t("abziehbar OpEx-Anteil %")}><NumberInput value={v.recoverableOpexShare * 100} width={64} suffix="%" onCommit={(n) => setV((d) => { d.recoverableOpexShare = n / 100; })} /></Field>
            <Field label={t("Zahllast-Lag (Monate)")}><NumberInput value={v.settlementLagMonths} width={56} onCommit={(n) => setV((d) => { d.settlementLagMonths = Math.max(0, Math.round(n)); })} /></Field>
            <Field label={t("Erstattungs-Lag (Monate)")}><NumberInput value={v.refundLagMonths} width={56} onCommit={(n) => setV((d) => { d.refundLagMonths = Math.max(0, Math.round(n)); })} /></Field>
          </div>
        </section>

        {/* Ausgangs-USt je Kultur */}
        <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
          <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
            <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Ausgangs-USt je Kultur (TVA colectată)")}</h3>
          </div>
          <div className="overflow-x-auto px-2 py-1.5">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="caption text-[10px] text-nx-text-muted">
                  <th className="px-2 py-1.5 text-left">{t("Kultur")}</th>
                  <th className="px-2 py-1.5 text-right">{t("Fläche ha")}</th>
                  <th className="px-2 py-1.5 text-left">{t("USt-Behandlung")}</th>
                </tr>
              </thead>
              <tbody>
                {cropsInPlan.map((cid) => {
                  const treat = v.outputByCrop?.[cid] ?? "standard";
                  const area = domain.anbauplan.filter((a) => a.cropId === cid).reduce((s, a) => s + a.areaHa, 0);
                  const rc = treat === "reverse_charge";
                  return (
                    <tr key={cid} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                      <td className="px-2 py-1.5">
                        {t(CROP_LABEL[cid] ?? cid)}
                        <div className="text-[10px] text-nx-text-muted">{rc ? t("Getreide/Ölsaat → RC, Kunde schuldet") : treat === "reduced" ? t("Nahrungsmittel 11 %") : ""}</div>
                      </td>
                      <td className="num px-2 py-1.5 text-right align-top">{fmtNumber(area, 0)}</td>
                      <td className="px-2 py-1.5 align-top">
                        <select className="rounded-control border px-2 text-[11.5px]" style={{ height: 30, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)", width: 190 }}
                          value={treat} onChange={(e) => setV((d) => { d.outputByCrop = { ...(d.outputByCrop ?? {}), [cid]: e.target.value as VatTreatment }; })}>
                          {TREATS.map((k) => <option key={k} value={k}>{t(TREAT_LABEL[k])}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Verlauf USt-Saldo & Cashflow */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("USt-Saldo & Cash-Timing über die Saison (Monatsraster)")}</h3>
        </div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="caption text-[10px] text-nx-text-muted">
                <th className="px-2 py-1.5 text-left">{t("Position")}</th>
                {rec.map((_, i) => <th key={i} className="px-1.5 py-1.5 text-right">{t(MONTHS[i % 12])}</th>)}
              </tr>
            </thead>
            <tbody>
              <Row label={t("USt-Forderung (recuperat)")} vals={rec} color="var(--nx-brand-lift)" maxAbs={maxAbs} />
              <Row label={t("USt-Verbindl. (de plată)")} vals={pay} color="var(--nx-error)" maxAbs={maxAbs} />
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-nx-text-secondary">{t("USt-Cashflow (Timing)")}</td>
                {cash.map((val, i) => (
                  <td key={i} className="num px-1.5 py-1.5 text-right" style={{ color: val < 0 ? "var(--nx-error)" : "var(--nx-text)" }}>{fmtMoney(val)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-[11px] text-nx-text-muted">
          {t("USt-Cashflow < 0 = Vorsteuer-Auszahlung/CAPEX-USt (bindet Kasse), > 0 = Erstattung/Vereinnahmung. Der operative Cashflow und der Revolver reagieren live auf dieses Timing — die CAPEX-USt-Spitze im 1. Quartal ist ein echter Finanzierungsbedarf.")}
        </div>
      </section>
    </div>
  );
}

function Row({ label, vals, color, maxAbs }: { label: string; vals: number[]; color: string; maxAbs: number }) {
  return (
    <tr>
      <td className="px-2 py-1.5 text-nx-text-secondary">{label}</td>
      {vals.map((val, i) => (
        <td key={i} className="px-1.5 py-1.5 text-right align-bottom">
          <div className="num text-[10.5px]" style={{ color: val > 0 ? color : "var(--nx-text-muted)" }}>{val > 0 ? fmtMoney(val) : "–"}</div>
          <div className="mt-0.5 ml-auto rounded-sm" style={{ height: 4, width: Math.max(2, Math.round((val / maxAbs) * 40)), background: color, opacity: val > 0 ? 0.7 : 0 }} />
        </td>
      ))}
    </tr>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="caption text-[10px] text-nx-text-muted">{label}</span>
      <span className="flex items-center gap-1">{children}</span>
    </div>
  );
}
