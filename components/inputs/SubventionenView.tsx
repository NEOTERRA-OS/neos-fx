"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { NumberInput, TextInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import type { Subsidy } from "../../core/types";

/** Subventionen — EU-CAP 2023–2027 (RO). Volle Struktur: Säule 1 (Direktzahlungen, inkl.
 *  kulturspezifischer VCP / gekoppelter Stützung) + Säule 2. Je Programm: Satz €/ha, Anspruch
 *  (alle/Kulturen), Cap (erste ha), Auszahlungsprofil (Vorschuss ab Okt + Rest Dez → Cashflow-Timing),
 *  aktiv/inaktiv, editierbar & erweiterbar. Fließt strukturiert in GuV + operativen Cashflow. */
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const CROP_LABEL: Record<string, string> = {
  weizen: "Weizen", gerste_zw: "Gerste", soja_luzerne: "Soja/Luzerne", winterraps: "Raps", mais: "Mais",
  tomate: "Tomate", kartoffel_pommes: "Kart. Pommes", kartoffel_chips: "Kart. Chips", zwiebel_moehre: "Zwiebel/Möhre",
};
const PILLARS: { key: 1 | 2; label: string }[] = [
  { key: 1, label: "Säule 1 — Direktzahlungen" },
  { key: 2, label: "Säule 2 — Ländliche Entwicklung" },
];

export function SubventionenView() {
  const { domain, patch } = useModelStore();
  const subs = domain.subsidies;
  const areaByCrop = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const a of domain.anbauplan) m.set(a.cropId, (m.get(a.cropId) ?? 0) + a.areaHa);
    return m;
  }, [domain.anbauplan]);
  const totalArea = domain.anbauplan.reduce((s, a) => s + a.areaHa, 0);

  const eligibleHa = (s: Subsidy) => {
    let ha = s.cropIds && s.cropIds.length ? s.cropIds.reduce((x, c) => x + (areaByCrop.get(c) ?? 0), 0) : totalArea;
    if (s.firstHaCap != null && s.firstHaCap > 0) ha = Math.min(ha, s.firstHaCap);
    return ha;
  };
  const annualCent = (s: Subsidy) => {
    if (s.active === false) return 0;
    return s.basis === "per_ha" ? Math.round((s.ratePerHaCent ?? 0) * eligibleHa(s)) : (s.lumpSumCent ?? 0);
  };
  const grandAnnual = subs.reduce((a, s) => a + annualCent(s), 0);

  const upd = (i: number, fn: (s: Subsidy) => void) => patch((d) => { fn(d.subsidies[i]); });
  const setAdvance = (i: number, sharePct: number) => upd(i, (s) => {
    const adv = Math.max(0, Math.min(100, sharePct)) / 100;
    const p0 = s.payout?.[0]?.period ?? 9, p1 = s.payout?.[1]?.period ?? 11;
    s.payout = [{ period: p0, share: adv }, { period: p1, share: 1 - adv }];
  });
  const setMonth = (i: number, which: 0 | 1, period: number) => upd(i, (s) => {
    const p0 = s.payout?.[0] ?? { period: 9, share: 0.7 }, p1 = s.payout?.[1] ?? { period: 11, share: 0.3 };
    s.payout = which === 0 ? [{ ...p0, period }, p1] : [p0, { ...p1, period }];
  });
  const addSub = (pillar: 1 | 2) => patch((d) => {
    let n = 1; while (d.subsidies.some((s) => s.id === `sub-custom-${n}`)) n++;
    d.subsidies.push({ id: `sub-custom-${n}`, name: t("Neues Programm"), basis: "per_ha", ratePerHaCent: 0,
      pillar, category: "other", receiptPeriods: [11], payout: [{ period: 9, share: 0.7 }, { period: 11, share: 0.3 }], active: true });
  });

  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";
  const monSel = (i: number, which: 0 | 1, val: number) => (
    <select className="rounded-control border px-1 text-[11px]" style={{ height: 30, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }}
      value={val} onChange={(e) => setMonth(i, which, Number(e.target.value))}>
      {MONTHS.map((m, mi) => <option key={mi} value={mi}>{t(m)}</option>)}
    </select>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Subventionen — EU-CAP 2023–2027 (RO)")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">Σ {fmtMoney(grandAnnual)}{t(" €/Jahr · Auszahlung Vorschuss (Okt) + Rest (Dez) → Cashflow")}</span>
        </div>
        <div className="px-4 py-2 text-[12px] text-nx-text-secondary">
          {t("Volle CAP-Struktur, editierbar & erweiterbar. Die ")}<b>{t("VCP / gekoppelte Stützung")}</b>{t(" ist kulturspezifisch aufgeschlüsselt. Sätze sind belastbare Defaults (PNS/APIA) — je Programm anpassbar. Das ")}<b>{t("Auszahlungsprofil")}</b>{t(" (Vorschuss %/Monat + Rest) steuert das Cashflow-Timing. Die ")}<b>{t("Investitionsförderung (AFIR/PNS ~40 %)")}</b>{t(" ist als CAPEX-Zuschuss modelliert (Maschinen/Beregnung/Lager) — nicht hier, um Doppelzählung zu vermeiden.")}
        </div>
      </div>

      {PILLARS.map((pil) => {
        const rows = subs.map((s, i) => ({ s, i })).filter((x) => (x.s.pillar ?? 1) === pil.key);
        if (!rows.length) return null;
        const pillarSum = rows.reduce((a, x) => a + annualCent(x.s), 0);
        return (
          <section key={pil.key} className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)", boxShadow: "var(--nx-el-card)" }}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
              <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t(pil.label)}</h3>
              <span className="num text-[10.5px] text-nx-text-muted">{fmtMoney(pillarSum)}{t(" €/Jahr")}</span>
            </div>
            <div className="overflow-x-auto px-2 py-1.5">
              <table className="w-full text-[12px]">
                <thead>
                  <tr>
                    <th className={th}>{t("Aktiv")}</th>
                    <th className={th + " text-left"}>{t("Programm")}</th>
                    <th className={th + " text-left"}>{t("Anspruch")}</th>
                    <th className={th + " text-right"}>{t("Satz €/ha")}</th>
                    <th className={th + " text-right"}>{t("erste ha")}</th>
                    <th className={th + " text-right"}>{t("Vorschuss %")}</th>
                    <th className={th + " text-left"}>{t("Vorsch. / Rest")}</th>
                    <th className={th + " text-right"}>{t("Σ €/Jahr")}</th>
                    <th className={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ s, i }) => {
                    const adv = Math.round((s.payout?.[0]?.share ?? 0.7) * 100);
                    const elig = s.cropIds && s.cropIds.length ? s.cropIds.map((c) => t(CROP_LABEL[c] ?? c)).join(", ") : t("alle Flächen");
                    return (
                      <tr key={s.id} style={{ borderTop: "1px solid var(--nx-border-divider)", opacity: s.active === false ? 0.55 : 1 }}>
                        <td className="px-2 py-1.5 text-center">
                          <input type="checkbox" checked={s.active !== false} onChange={(e) => upd(i, (x) => { x.active = e.target.checked; })} />
                        </td>
                        <td className="px-2 py-1.5"><TextInput value={s.name} width={250} onCommit={(v) => upd(i, (x) => { x.name = v; })} /></td>
                        <td className="px-2 py-1.5 text-[11px] text-nx-text-muted" style={{ maxWidth: 150 }}>{elig}</td>
                        <td className="px-2 py-1.5 text-right">
                          <NumberInput value={s.ratePerHaCent ?? 0} moneyCent width={92} onCommit={(n) => upd(i, (x) => { x.ratePerHaCent = n; })} />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <NumberInput value={s.firstHaCap ?? 0} width={56} onCommit={(n) => upd(i, (x) => { x.firstHaCap = n > 0 ? Math.round(n) : undefined; })} />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <NumberInput value={adv} width={52} onCommit={(n) => setAdvance(i, n)} />
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="inline-flex items-center gap-1">{monSel(i, 0, s.payout?.[0]?.period ?? 9)}<span className="text-nx-text-muted">/</span>{monSel(i, 1, s.payout?.[1]?.period ?? 11)}</span>
                        </td>
                        <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(annualCent(s))}</td>
                        <td className="px-2 py-1.5 text-right">
                          <button className="text-[12px] text-nx-error" title={t("Programm entfernen")} onClick={() => patch((d) => { d.subsidies.splice(i, 1); })}>✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t px-4 py-1.5" style={{ borderColor: "var(--nx-border-divider)" }}>
              <button className="rounded-control border px-3 text-[11.5px] font-semibold"
                style={{ height: 30, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }}
                onClick={() => addSub(pil.key)}>{t("+ Programm")}</button>
            </div>
          </section>
        );
      })}

      <div className="rounded-tile border px-4 py-3" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Σ Subventionen (Jahr)")}</span>
          <span className="num text-[14px] font-bold">{fmtMoney(grandAnnual)} €</span>
        </div>
        <div className="mt-1 text-[11px] text-nx-text-muted">
          ≈ {fmtNumber(totalArea > 0 ? grandAnnual / 100 / totalArea : 0, 0)}{t(" €/ha im Schnitt · Zufluss im operativen Cashflow gemäß Auszahlungsprofil (Vorschuss ab Okt, Rest Dez).")}
        </div>
      </div>
    </div>
  );
}
