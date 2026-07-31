"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import { NumberInput, TextInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import { X } from "lucide-react";
import { machineCapexAmounts, deriveFinancing, START_YEAR } from "../../store/model";
import { Segmented } from "../primitives/Segmented";
import type { LeasingContract, ContractKind, PaymentFrequency, RateBasis, RepaymentProfile } from "../../core/types";

/** Finanzierung — je CAPEX-Position finanzierbar + Pakete + volle Vertragsmaske + IFRS 16
 *  (Right-of-Use). Seed = indikative NEOS-Platzhalterpakete (markttypische RO-Konditionen,
 *  editierbar); Lessor/Vertragsnr. bei Abschluss eintragen. Die Verträge speisen über den
 *  Composer die 3-Statement-Engine (Tilgung/Zins/Ballon/Cashflow). */

const KIND_LABEL: Record<ContractKind, string> = {
  lease_fin: "Finanzierungsleasing", lease_op: "Operating-Leasing", loan: "Investitionskredit",
};
const FREQ_LABEL: Record<PaymentFrequency, string> = { monthly: "monatlich", quarterly: "quartal", seasonal: "saisonal" };
const REPAY_LABEL: Record<RepaymentProfile, string> = { annuity: "Annuität", linear: "linear", bullet: "endfällig" };
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function selCls(w?: number): React.CSSProperties {
  return { height: 30, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)", width: w };
}

export function FinanzierungView() {
  const store = useModelStore();
  const { domain, patch } = store;
  const scenarioId = store.view.scenarioId;
  const [finTab, setFinTab] = React.useState<"maschinen" | "wc">("maschinen");

  const amounts = React.useMemo(() => machineCapexAmounts(domain, scenarioId), [domain, scenarioId]);
  const financing = React.useMemo(() => deriveFinancing(domain, scenarioId), [domain, scenarioId]);
  const euribor = readAssumption(domain, "macro.euribor", scenarioId) ?? 0.03;

  // Zuordnung Objekt → Vertrag (ein Objekt hängt an höchstens einem Vertrag).
  const contractOf = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of domain.financingContracts ?? []) for (const o of c.objectIds) m.set(o, c.id);
    return m;
  }, [domain.financingContracts]);

  const assign = (machineId: string, contractId: string | null) => patch((d) => {
    for (const c of d.financingContracts) c.objectIds = c.objectIds.filter((o) => o !== machineId);
    if (contractId) { const c = d.financingContracts.find((x) => x.id === contractId); if (c && !c.objectIds.includes(machineId)) c.objectIds.push(machineId); }
  });
  const updC = (id: string, fn: (c: LeasingContract) => void) => patch((d) => { const c = d.financingContracts.find((x) => x.id === id); if (c) fn(c); });
  const removeC = (id: string) => patch((d) => { d.financingContracts = d.financingContracts.filter((x) => x.id !== id); });
  const addC = () => patch((d) => {
    let n = 1; while (d.financingContracts.some((c) => c.id === `fc-custom-${n}`)) n++;
    d.financingContracts.push({
      id: `fc-custom-${n}`, name: t("Neuer Finanzierungsvertrag"), lessor: t("Leasinggeber"), kind: "lease_fin",
      objectIds: [], drawPeriod: 0, avansRate: 0.2, residualRate: 0.01, termMonths: 60,
      rateBasis: "floating", referenceRateKey: "macro.euribor", floatingSpread: 0.034,
      frequency: "monthly", repayment: "annuity", currency: "RON", vatRate: 0.19,
      ifrs16RightOfUse: true, active: true,
    });
  });

  // Portfolio-Summen.
  const totEntry = financing.reduce((s, f) => s + f.entryValueCent, 0);
  const totAvans = financing.reduce((s, f) => s + f.avansCent, 0);
  const totFinanced = financing.reduce((s, f) => s + f.financedCent, 0);
  const totResidual = financing.reduce((s, f) => s + f.residualCent, 0);
  const totFees = financing.reduce((s, f) => s + f.feesUpfrontCent, 0);
  const totRoU = financing.filter((f) => f.contract.ifrs16RightOfUse !== false).reduce((s, f) => s + f.entryValueCent, 0);
  const totCapex = Array.from(amounts.values()).reduce((s, a) => s + a.amountCent, 0);
  const financedShare = totCapex > 0 ? totEntry / totCapex : 0;

  const contracts = domain.financingContracts ?? [];
  const machineList = Array.from(amounts.entries()).map(([id, a]) => ({ id, ...a }));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <Segmented ariaLabel={t("Finanzierung")}
          value={finTab} onChange={(v) => setFinTab(v as "maschinen" | "wc")}
          options={[{ value: "maschinen", label: t("Maschinen- & CAPEX-Finanzierung") }, { value: "wc", label: "Working Capital & Revolver" }]} />
      </div>

      {finTab === "maschinen" && (<>
      {/* ---- Portfolio-Kopf ---- */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Finanzierung — Verträge & CAPEX-Zuordnung")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">{t("je Position finanzierbar · Pakete · volle Vertragsmaske · IFRS 16")}</span>
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-3 xl:grid-cols-6" style={{ background: "var(--nx-border-divider)" }}>
          {[
            [t("CAPEX gesamt"), fmtMoney(totCapex) + " €"],
            [t("davon finanziert"), fmtMoney(totEntry) + " € · " + fmtNumber(financedShare * 100, 0) + " %"],
            [t("Anzahlung (Avans)"), fmtMoney(totAvans) + " €"],
            [t("Finanzierter Betrag"), fmtMoney(totFinanced) + " €"],
            [t("Restwert-Ballons"), fmtMoney(totResidual) + " €"],
            [t("RoU-Aktiva (IFRS 16)"), fmtMoney(totRoU) + " €"],
          ].map(([k, v], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[13px] font-semibold" style={{ color: "var(--nx-text)" }}>{v}</div>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 text-[11.5px] text-nx-text-muted">
          {t("Einmalgebühren (Analyse/Registrierung/Verwaltung/Abschluss) gesamt: ")}<b className="num" style={{ color: "var(--nx-text-secondary)" }}>{fmtMoney(totFees)} €</b>{t(" — als anfängliche direkte Kosten in den Right-of-Use-Asset aktiviert (IFRS 16) und über die kürzeste Laufzeit abgeschrieben.")}
        </div>
      </section>

      {/* ---- CAPEX-Positionen & Zuordnung ---- */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("CAPEX-Positionen — Finanzierung je Objekt")}</h3>
        </div>
        <div className="overflow-x-auto px-2 py-1.5">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="caption text-[10px] text-nx-text-muted">
                <th className="px-2 py-1.5 text-left">{t("Objekt (Maschine/Anlage)")}</th>
                <th className="px-2 py-1.5 text-right">{t("Objektwert netto")}</th>
                <th className="px-2 py-1.5 text-left">{t("Finanzierung")}</th>
                <th className="px-2 py-1.5 text-left">{t("Modus")}</th>
              </tr>
            </thead>
            <tbody>
              {machineList.map((m) => {
                const cid = contractOf.get(m.id) ?? "";
                const c = contracts.find((x) => x.id === cid);
                return (
                  <tr key={m.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                    <td className="px-2 py-1.5">{m.label}</td>
                    <td className="num px-2 py-1.5 text-right">{fmtMoney(m.amountCent)} €</td>
                    <td className="px-2 py-1.5">
                      <select className="rounded-control border px-2 text-[11.5px]" style={selCls(230)}
                        value={cid} onChange={(e) => assign(m.id, e.target.value || null)}>
                        <option value="">{t("Bar / Eigenmittel")}</option>
                        {contracts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-[11px] text-nx-text-muted">{c ? t(KIND_LABEL[c.kind]) : "—"}</td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                <td className="px-2 py-1.5 text-[11px] font-semibold">{t("Σ CAPEX (Jahr 0 · Register/Auto-Anlagen)")}</td>
                <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(totCapex)} €</td>
                <td className="px-2 py-1.5 text-[11px] text-nx-text-muted" colSpan={2}>{t("finanziert ")}{fmtMoney(totEntry)}{t(" € · bar ")}{fmtMoney(totCapex - totEntry)} €</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Geplante Investitionen (Detailplan, inkl. spätere Jahre) — je Position finanziert ---- */}
      <PlanFinanzierung domain={domain} patch={patch} />

      {/* ---- Verträge (volle Maske) ---- */}
      {financing.map((f) => {
        const c = f.contract;
        const perYr = c.frequency === "monthly" ? 12 : c.frequency === "quarterly" ? 4 : (c.seasonMonths?.length ?? 2);
        const nPay = Math.max(1, Math.round((c.termMonths / 12) * perYr));
        const annual = c.rateBasis === "fixed" ? (c.fixedRate ?? 0) : euribor + (c.floatingSpread ?? 0);
        const r = annual / perYr;
        const disc = Math.pow(1 + r, -nPay);
        const pmt = r > 0 ? (f.financedCent - f.residualCent * disc) * r / (1 - disc) : (f.financedCent - f.residualCent) / nPay;
        const totalPaid = f.avansCent + pmt * nPay + f.residualCent;
        const totalInterest = totalPaid - f.entryValueCent;
        return (
          <section key={c.id} className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)", boxShadow: "var(--nx-el-card)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
              <div className="flex items-center gap-2">
                <TextInput value={c.name} width={260} onCommit={(v) => updC(c.id, (x) => { x.name = v; })} />
                <span className="rounded-control px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--nx-brand-tint,#f2f7e3)", color: "var(--nx-brand-lift)" }}>{t(KIND_LABEL[c.kind])}</span>
              </div>
              <button className="inline-flex items-center gap-1 text-[12px] text-nx-error" title={t("Vertrag entfernen")} onClick={() => removeC(c.id)}><X size={13} strokeWidth={2.5} aria-hidden />{t("entfernen")}</button>
            </div>

            {/* Identität */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 md:grid-cols-3">
              <Field label={t("Finanzierer (Lessor)")}><TextInput value={c.lessor} width={220} onCommit={(v) => updC(c.id, (x) => { x.lessor = v; })} /></Field>
              <Field label={t("Vertragsnummer")}><TextInput value={c.contractNo ?? ""} width={160} onCommit={(v) => updC(c.id, (x) => { x.contractNo = v; })} /></Field>
              <Field label={t("Finanzierungsart")}>
                <select className="rounded-control border px-2 text-[11.5px]" style={selCls(180)} value={c.kind} onChange={(e) => updC(c.id, (x) => { x.kind = e.target.value as ContractKind; })}>
                  {(Object.keys(KIND_LABEL) as ContractKind[]).map((k) => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}
                </select>
              </Field>
              <Field label={t("Lieferant (Furnizor)")}><TextInput value={c.supplier ?? ""} width={220} onCommit={(v) => updC(c.id, (x) => { x.supplier = v; })} /></Field>
              <Field label={t("Bürge (Fideiusor)")}><TextInput value={c.guarantor ?? ""} width={220} onCommit={(v) => updC(c.id, (x) => { x.guarantor = v; })} /></Field>
              <Field label={t("Ziehung (Periode)")}><NumberInput value={c.drawPeriod} width={64} onCommit={(n) => updC(c.id, (x) => { x.drawPeriod = Math.max(0, Math.round(n)); })} /></Field>
            </div>

            {/* Objekte / Paket */}
            <div className="px-4 pb-2">
              <div className="caption text-[10px] text-nx-text-muted mb-1">{t("Objekte im Paket (")}{f.objects.length}{t(") — Objektwert wird live aus dem CAPEX gerechnet")}</div>
              <div className="flex flex-wrap gap-1.5">
                {f.objects.length === 0 && <span className="text-[11px] text-nx-text-muted italic">{t("Keine Objekte zugeordnet — oben in der CAPEX-Tabelle zuweisen.")}</span>}
                {f.objects.map((o) => (
                  <span key={o.id} className="inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-[11px]" style={{ background: "var(--nx-app-bg)", border: "1px solid var(--nx-border)" }}>
                    {o.label} <span className="num text-nx-text-muted">{fmtMoney(o.amountCent)} €</span>
                    <button className="text-nx-error" title={t("aus Paket entfernen")} onClick={() => assign(o.id, null)}><X size={12} strokeWidth={2.5} aria-hidden /></button>
                  </span>
                ))}
              </div>
            </div>

            {/* Kommerzielle Konditionen */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 md:grid-cols-4" style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
              <Field label={t("Objektwert netto")}>
                <NumberInput value={c.entryValueCent ?? 0} moneyCent width={120} onCommit={(n) => updC(c.id, (x) => { x.entryValueCent = n > 0 ? n : undefined; })} />
                <span className="caption text-[9.5px] text-nx-text-muted"> {c.entryValueCent ? "Override" : "= " + fmtMoney(f.entryValueCent) + " € (Σ)"}</span>
              </Field>
              <Field label="Avans %"><NumberInput value={(c.avansRate ?? 0) * 100} width={64} suffix="%" onCommit={(n) => updC(c.id, (x) => { x.avansRate = n / 100; })} /></Field>
              <Field label={t("Restwert %")}><NumberInput value={(c.residualRate ?? 0) * 100} width={64} suffix="%" onCommit={(n) => updC(c.id, (x) => { x.residualRate = n / 100; })} /></Field>
              <Field label={t("Laufzeit (Monate)")}><NumberInput value={c.termMonths} width={64} onCommit={(n) => updC(c.id, (x) => { x.termMonths = Math.max(1, Math.round(n)); })} /></Field>
              <Field label={t("Zinstyp")}>
                <select className="rounded-control border px-2 text-[11.5px]" style={selCls(130)} value={c.rateBasis} onChange={(e) => updC(c.id, (x) => { x.rateBasis = e.target.value as RateBasis; })}>
                  <option value="floating">{t("variabel")}</option><option value="fixed">{t("fest")}</option>
                </select>
              </Field>
              {c.rateBasis === "fixed"
                ? <Field label={t("Fester Satz %")}><NumberInput value={(c.fixedRate ?? 0) * 100} width={72} suffix="%" onCommit={(n) => updC(c.id, (x) => { x.fixedRate = n / 100; })} /></Field>
                : <Field label={`${t("Marge % (+ EURIBOR ")}${fmtNumber(euribor * 100, 2)}%)`}><NumberInput value={(c.floatingSpread ?? 0) * 100} width={72} suffix="%" onCommit={(n) => updC(c.id, (x) => { x.floatingSpread = n / 100; })} /></Field>}
              <Field label={t("Zahlfrequenz")}>
                <select className="rounded-control border px-2 text-[11.5px]" style={selCls(130)} value={c.frequency} onChange={(e) => updC(c.id, (x) => { x.frequency = e.target.value as PaymentFrequency; })}>
                  {(Object.keys(FREQ_LABEL) as PaymentFrequency[]).map((k) => <option key={k} value={k}>{t(FREQ_LABEL[k])}</option>)}
                </select>
              </Field>
              <Field label={t("Tilgungsart")}>
                <select className="rounded-control border px-2 text-[11.5px]" style={selCls(130)} value={c.repayment} onChange={(e) => updC(c.id, (x) => { x.repayment = e.target.value as RepaymentProfile; })}>
                  {(Object.keys(REPAY_LABEL) as RepaymentProfile[]).map((k) => <option key={k} value={k}>{t(REPAY_LABEL[k])}</option>)}
                </select>
              </Field>
              {c.frequency === "seasonal" && (
                <Field label={t("Saison-Monate")}>
                  <div className="flex flex-wrap gap-0.5">
                    {MONTHS.map((mn, mi) => {
                      const on = (c.seasonMonths ?? []).includes(mi + 1);
                      return (
                        <button key={mi} className="rounded-control px-1.5 text-[10.5px]" style={{ height: 24, minWidth: 30, border: "1px solid " + (on ? "var(--nx-green)" : "var(--nx-border)"), background: on ? "var(--nx-green)" : "var(--nx-surface)", color: on ? "#fff" : "var(--nx-text-secondary)", fontWeight: on ? 700 : 500 }}
                          onClick={() => updC(c.id, (x) => { const s = new Set(x.seasonMonths ?? []); s.has(mi + 1) ? s.delete(mi + 1) : s.add(mi + 1); x.seasonMonths = Array.from(s).sort((a, b) => a - b); })}>{t(mn)}</button>
                      );
                    })}
                  </div>
                </Field>
              )}
            </div>

            {/* Gebühren & Zahlung */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 md:grid-cols-4" style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
              <Field label={t("Analysegebühr €")}><NumberInput value={c.feeAnalysisCent ?? 0} moneyCent width={92} onCommit={(n) => updC(c.id, (x) => { x.feeAnalysisCent = n; })} /></Field>
              <Field label={t("Registrierung (RNPM) €")}><NumberInput value={c.feeRegistrationCent ?? 0} moneyCent width={92} onCommit={(n) => updC(c.id, (x) => { x.feeRegistrationCent = n; })} /></Field>
              <Field label={t("Verwaltung %")}><NumberInput value={(c.feeAdminRate ?? 0) * 100} width={64} suffix="%" onCommit={(n) => updC(c.id, (x) => { x.feeAdminRate = n / 100; })} /></Field>
              <Field label={t("Abschlussgebühr €")}><NumberInput value={c.feeClosingCent ?? 0} moneyCent width={92} onCommit={(n) => updC(c.id, (x) => { x.feeClosingCent = n; })} /></Field>
              <Field label={t("Vorfälligkeit %")}><NumberInput value={(c.prepaymentRate ?? 0) * 100} width={64} suffix="%" onCommit={(n) => updC(c.id, (x) => { x.prepaymentRate = n / 100; })} /></Field>
              <Field label={t("Verzugszins %/Tag")}><NumberInput value={(c.lateInterestDaily ?? 0) * 100} width={72} suffix="%" onCommit={(n) => updC(c.id, (x) => { x.lateInterestDaily = n / 100; })} /></Field>
              <Field label={t("Zahlungswährung")}>
                <select className="rounded-control border px-2 text-[11.5px]" style={selCls(90)} value={c.currency ?? "RON"} onChange={(e) => updC(c.id, (x) => { x.currency = e.target.value; })}>
                  <option value="RON">RON</option><option value="EUR">EUR</option>
                </select>
              </Field>
              <Field label={t("TVA / MwSt %")}><NumberInput value={(c.vatRate ?? 0) * 100} width={64} suffix="%" onCommit={(n) => updC(c.id, (x) => { x.vatRate = n / 100; })} /></Field>
              <Field label={t("Umrechnungskurs (Quelle)")}><TextInput value={c.fxSource ?? ""} width={180} onCommit={(v) => updC(c.id, (x) => { x.fxSource = v; })} /></Field>
              <Field label="IFRS 16 — Right-of-Use">
                <label className="inline-flex items-center gap-1.5 text-[11.5px]">
                  <input type="checkbox" checked={c.ifrs16RightOfUse !== false} onChange={(e) => updC(c.id, (x) => { x.ifrs16RightOfUse = e.target.checked; })} />
                  {c.ifrs16RightOfUse !== false ? t("aktiviert") : t("nicht aktiviert")}
                </label>
              </Field>
            </div>

            {/* Abgeleiteter Zahlungsplan (Vorschau) */}
            <div className="grid grid-cols-2 gap-px sm:grid-cols-4 xl:grid-cols-7" style={{ background: "var(--nx-border-divider)", borderTop: "1px solid var(--nx-border-divider)" }}>
              {[
                [t("Objektwert"), fmtMoney(f.entryValueCent) + " €"],
                [t("Anzahlung"), fmtMoney(f.avansCent) + " €"],
                [t("Finanziert"), fmtMoney(f.financedCent) + " €"],
                [t("Effektivsatz p.a."), fmtNumber(annual * 100, 2) + " %"],
                [`Rate (${t(FREQ_LABEL[c.frequency])}, ×${nPay})`, fmtMoney(Math.round(pmt)) + " €"],
                [t("Restwert-Ballon"), fmtMoney(f.residualCent) + " €"],
                [t("Σ Zins (Laufzeit)"), fmtMoney(Math.round(totalInterest)) + " €"],
              ].map(([k, v], i) => (
                <div key={i} className="px-3 py-2" style={{ background: "var(--nx-surface)" }}>
                  <div className="caption text-[9.5px] text-nx-text-muted">{k}</div>
                  <div className="num text-[12px] font-semibold" style={{ color: "var(--nx-text)" }}>{v}</div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <div>
        <button className="rounded-control border px-3 text-[12px] font-semibold" style={{ height: 34, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }} onClick={addC}>{t("+ Finanzierungsvertrag")}</button>
      </div>
      </>)}

      {finTab === "wc" && (<>
      {/* ---- Revolver (Betriebsmittellinie) ---- */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}><h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Revolver (Betriebsmittellinie)")}</h3></div>
        <div className="flex flex-wrap gap-x-8 gap-y-2 px-4 py-3">
          <Field label={t("Rahmen €")}><NumberInput value={domain.revolver.limit} moneyCent width={130} onCommit={(n) => patch((d) => { d.revolver.limit = n; })} /></Field>
          <Field label="Spread %"><NumberInput value={(domain.revolver.floatingSpread ?? 0) * 100} width={72} suffix="%" onCommit={(n) => patch((d) => { d.revolver.floatingSpread = n / 100; })} /></Field>
          <Field label={t("Mindest-Kasse €")}><NumberInput value={domain.revolver.minCashTarget} moneyCent width={110} onCommit={(n) => patch((d) => { d.revolver.minCashTarget = n; })} /></Field>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border-divider)" }}>
          {t("Der Revolver gleicht Liquiditätslücken bis zum Rahmen automatisch aus (Saison-Swing, CAPEX-/Avans-/USt-Spitzen) — siehe Liquiditätsplanung.")}
        </div>
      </section>

      {/* ---- Working Capital ---- */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}><h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Working Capital (Netto-Umlaufvermögen)")}</h3></div>
        <div className="flex flex-wrap gap-x-8 gap-y-3 px-4 py-3">
          <Field label={t("DSO — Forderungslaufzeit (Tage)")}>
            <NumberInput value={readAssumption(domain, domain.workingCapital.dsoAssumptionKey, scenarioId) ?? 0} width={72} suffix="d"
              onCommit={(n) => patch((d) => { const b = d.assumptions[d.workingCapital.dsoAssumptionKey]; if (b) b.scenarioProfiles[d.baseScenarioId] = { kind: "constant", value: n }; })} /></Field>
          <Field label={t("DPO — Verbindlichkeitslaufzeit (Tage)")}>
            <NumberInput value={readAssumption(domain, domain.workingCapital.dpoAssumptionKey, scenarioId) ?? 0} width={72} suffix="d"
              onCommit={(n) => patch((d) => { const b = d.assumptions[d.workingCapital.dpoAssumptionKey]; if (b) b.scenarioProfiles[d.baseScenarioId] = { kind: "constant", value: n }; })} /></Field>
          <Field label={t("Vorrats-Reichweite (Tage)")}>
            <NumberInput value={readAssumption(domain, domain.workingCapital.inventoryDaysAssumptionKey, scenarioId) ?? 0} width={72} suffix="d"
              onCommit={(n) => patch((d) => { const b = d.assumptions[d.workingCapital.inventoryDaysAssumptionKey]; if (b) b.scenarioProfiles[d.baseScenarioId] = { kind: "constant", value: n }; })} /></Field>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border-divider)" }}>
          {t("DSO/DPO und Vorrats-Reichweite treiben Forderungen, Verbindlichkeiten und Vorräte in der Bilanz; die Δ-Veränderung fließt in den operativen Cashflow.")}
        </div>
      </section>
      </>)}
    </div>
  );
}

/** Detailplan-Positionen (Investitionen-Editor) — VERZAHNT: jede aktive Position fließt mit
 *  Anschaffungsjahr, FK-Quote, Zins & Laufzeit als eigener Investitionskredit (Annuität) in die
 *  3-Statement-Engine (auch spätere Jahre, inkl. CAPEX-Inflationsindex). Hier editierbar. */
function PlanFinanzierung({ domain, patch }: { domain: any; patch: (fn: (d: any) => void) => void }) {
  const active = domain.capexPlanActive ?? {};
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const items = (domain.capexPlan ?? []).filter((it: any) => active[it.block] && !it.bestand);
  const net = (it: any) => Math.round((it.menge || 0) * (it.eurProEinheitCent || 0) * (1 - clamp01(it.subventionPct || 0)));
  const tot = items.reduce((s: number, it: any) => s + net(it), 0);
  const totFk = items.reduce((s: number, it: any) => s + Math.round(net(it) * clamp01(it.fkQuote || 0)), 0);
  const upd = (id: string, fn: (it: any) => void) => patch((d) => { const it = (d.capexPlan ?? []).find((x: any) => x.id === id); if (it) fn(it); });
  const BLOCK_LABEL: Record<string, string> = { maschinen: t("Maschinen"), bewaesserung: t("Bewässerung"), lager: t("Lager/Packhaus"), gebaeude: t("Gebäude/Infra") };
  if (!items.length) return null;
  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Geplante Investitionen (Detailplan) — Finanzierung je Position")}</h3>
        <span className="caption text-[10.5px] text-nx-text-muted">{t("inkl. spätere Jahre · fließt live als Investitionskredit-Annuität in Bilanz/CF")}</span>
      </div>
      <div className="overflow-x-auto px-2 py-1.5">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="caption text-[10px] text-nx-text-muted">
              <th className="px-2 py-1.5 text-left">{t("Position")}</th>
              <th className="px-2 py-1.5 text-left">Block</th>
              <th className="px-2 py-1.5 text-right">{t("Jahr")}</th>
              <th className="px-2 py-1.5 text-right">{t("Netto-CAPEX")}</th>
              <th className="px-2 py-1.5 text-right">{t("FK-Quote %")}</th>
              <th className="px-2 py-1.5 text-right">{t("Zins %")}</th>
              <th className="px-2 py-1.5 text-right">{t("Laufzeit J")}</th>
              <th className="px-2 py-1.5 text-left">{t("Modus")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: any) => {
              const n0 = net(it), fk = clamp01(it.fkQuote || 0);
              return (
                <tr key={it.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5">{it.bezeichnung}</td>
                  <td className="px-2 py-1.5 text-[11px] text-nx-text-muted">{t(BLOCK_LABEL[it.block] ?? it.block)}</td>
                  <td className="num px-2 py-1.5 text-right">
                    <NumberInput value={START_YEAR + (it.jahr || 0)} width={70}
                      onCommit={(n) => upd(it.id, (x) => { x.jahr = Math.max(0, Math.round(n - START_YEAR)); })} />
                  </td>
                  <td className="num px-2 py-1.5 text-right">{fmtMoney(n0)} €</td>
                  <td className="num px-2 py-1.5 text-right">
                    <NumberInput value={fk * 100} width={58} suffix="%" onCommit={(n) => upd(it.id, (x) => { x.fkQuote = clamp01(n / 100); })} />
                  </td>
                  <td className="num px-2 py-1.5 text-right">
                    <NumberInput value={(it.zins ?? 0.05) * 100} width={58} suffix="%" onCommit={(n) => upd(it.id, (x) => { x.zins = Math.max(0, n / 100); })} />
                  </td>
                  <td className="num px-2 py-1.5 text-right">
                    <NumberInput value={it.laufzeitJahre ?? 12} width={52} onCommit={(n) => upd(it.id, (x) => { x.laufzeitJahre = Math.max(1, Math.round(n)); })} />
                  </td>
                  <td className="px-2 py-1.5 text-[11px] text-nx-text-muted">{fk > 0 ? `${t("Investitionskredit ")}${fmtNumber(fk * 100, 0)}${t(" % · Rest bar")}` : t("Bar / Eigenmittel")}</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-2 py-1.5 text-[11px] font-semibold" colSpan={3}>{t("Σ Detailplan (aktive Blöcke)")}</td>
              <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(tot)} €</td>
              <td className="px-2 py-1.5 text-[11px] text-nx-text-muted" colSpan={4}>{t("finanziert ")}{fmtMoney(totFk)}{t(" € · bar ")}{fmtMoney(tot - totFk)} €</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 text-[11px] text-nx-text-muted">
        {t("Jede Zeile wird in ihrem Anschaffungsjahr aktiviert (CAPEX-Inflationsindex), über die Nutzungsdauer abgeschrieben und mit ihrer FK-Quote als eigener Investitionskredit (Annuität, Zins & Laufzeit wie hier) finanziert — Änderungen wirken sofort auf GuV, Bilanz, Cashflow und Liquidität. Positionen pflegen: Investitionen (Neuanschaffungen).")}
      </div>
    </section>
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
