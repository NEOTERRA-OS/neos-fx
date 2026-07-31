"use client";
import React from "react";
import { useModelStore, readAssumption, selectModelState } from "../../store/modelStore";
import { derivePersonnelProposal, deriveCropAreasMY, START_YEAR } from "../../store/model";
import { AssumptionField } from "./AssumptionField";
import { NumberInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";

/** Personalplanung (RO) — pro Position Kopf × Brutto → Netto (CAS/CASS/Impozit) & AG-Kosten (CAM).
 *  „KI"-Planer schlägt Kopfzahlen aus dem Maschinenregister & der Fläche vor (Stammfahrer aus
 *  Ist-Feldstunden). Logistik (LKW) & Daily Workers sind informativ — deren Kosten stecken bereits
 *  in Transport-OpEx bzw. Ernte-Handarbeit (COGS), daher nicht erneut im Personalaufwand. */

const CAT_LABEL: Record<string, string> = {
  leitung: "Leitung & Agronomie",
  stamm: "Maschinenführer (Stammpersonal)",
  betrieb: "Betrieb — Bewässerung · Lager · Werkstatt",
  saison: "Saison & Nachwuchs",
};
const CAT_ORDER = ["leitung", "stamm", "betrieb", "saison"];

export function PersonalView() {
  const { domain, patch } = useModelStore();
  const scenarioId = useModelStore((s) => s.view.scenarioId);
  const p = domain.personnel;
  if (!p) return <div className="rounded-tile border p-4 text-[12.5px]" style={{ borderColor: "var(--nx-border)" }}>{t("Kein Personalplan.")}</div>;

  const r = p.rates;
  const pd = r.personalDeductionMonthly ?? 0;
  // RO-Payroll je FTE/Monat (CENT), identisch zur Engine (computePersonnel).
  const payroll = (gm: number) => {
    const cas = gm * r.cas, cass = gm * r.cass;
    const taxable = Math.max(0, gm - cas - cass - pd);
    const tax = taxable * r.incomeTax;
    const net = gm - cas - cass - tax;
    const employer = gm * (1 + r.cam);
    return { net, employer };
  };

  const prop = derivePersonnelProposal(domain, scenarioId);
  const applyOne = (key: string, val: number) => patch((d) => {
    const a = d.assumptions[key]; if (a) a.scenarioProfiles[scenarioId] = { kind: "constant", value: val };
  });
  const applyAll = () => patch((d) => {
    for (const [key, val] of Object.entries(prop.recommend)) {
      const a = d.assumptions[key]; if (a) a.scenarioProfiles[scenarioId] = { kind: "constant", value: val };
    }
  });

  // Summen (Stufe-1-Basis; das Modell skaliert Kopfzahlen über die Jahre).
  let sumFte = 0, sumGrossMo = 0, sumNetMo = 0, sumEmpYr = 0;
  const rows = p.roles.map((role) => {
    const fte = readAssumption(domain, role.headcountKey, scenarioId) ?? 0;
    const gm = readAssumption(domain, role.grossMonthlyKey, scenarioId) ?? 0;
    const { net, employer } = payroll(gm);
    sumFte += fte; sumGrossMo += fte * gm; sumNetMo += fte * net; sumEmpYr += fte * employer * 12;
    const rec = prop.recommend[role.headcountKey];
    return { role, fte, gm, net, employer, rec };
  });

  const th = "px-2 py-2 caption text-[10.5px] text-nx-text-muted";
  const rateCells: [keyof typeof r, string][] = [["cas", t("CAS (AN) 25 %")], ["cass", t("CASS (AN) 10 %")], ["incomeTax", t("Impozit 10 %")], ["cam", t("CAM (AG) 2,25 %")]];

  return (
    <div className="space-y-4">
      {/* Entwicklung über die Planjahre — zuerst, weil die Frage "wie viele Leute wann" vor der
          Frage "was kostet einer" kommt. Die Kopfzahlen unten sind die Basis, hier steht der Verlauf. */}
      <PersonalEntwicklung />

      {/* Kopf + Summen */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Personalplanung (RO) — Brutto → Netto & AG-Kosten je Position")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">{t("Stufe-1-Basis · Kopfzahlen skalieren über den Ramp")}</span>
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)" }}>
          {[
            [t("Σ Kopf (FTE)"), fmtNumber(sumFte, 1)],
            [t("Σ Brutto / Monat"), fmtMoney(sumGrossMo) + " €"],
            [t("Σ Netto / Monat"), fmtMoney(sumNetMo) + " €"],
            [t("Σ AG-Personalaufwand / Jahr"), fmtMoney(sumEmpYr) + " €"],
          ].map(([k, v], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[13px] font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Beitragssätze */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Beitragssätze & Freibetrag (Cod Fiscal RO)")}</h3>
        </div>
        <div className="flex flex-wrap gap-5 px-4 py-3">
          {rateCells.map(([k, label]) => (
            <div key={k} className="flex flex-col gap-1">
              <span className="caption text-[10px] text-nx-text-muted">{label}</span>
              <NumberInput value={(r[k] as number) * 100} width={70} suffix="%" onCommit={(n) => patch((d) => { (d.personnel!.rates as any)[k] = n / 100; })} />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <span className="caption text-[10px] text-nx-text-muted">{t("Pers. Freibetrag / Monat")}</span>
            <NumberInput value={pd} moneyCent width={80} onCommit={(n) => patch((d) => { d.personnel!.rates.personalDeductionMonthly = Math.max(0, Math.round(n)); })} />
          </div>
        </div>
      </section>

      {/* KI-Planer */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-brand-lift)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Personalplaner — Vorschlag aus Maschinenregister & Fläche")}</h3>
          <button className="rounded-control border px-3 text-[12px] font-semibold" style={{ height: 32, borderColor: "var(--nx-brand-lift)", color: "var(--nx-brand-lift)", background: "var(--nx-surface)" }} onClick={applyAll}>
            {t("Vorschlag komplett übernehmen")}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4 lg:grid-cols-6" style={{ background: "var(--nx-border-divider)" }}>
          {[
            [t("Feldstunden / Jahr (Flotte)"), fmtNumber(prop.info.fieldHours, 0) + " h"],
            [t("Maschinen im Register"), fmtNumber(prop.info.machineCount, 0)],
            [t("→ empf. Stammfahrer"), fmtNumber(prop.info.drivers, 0)],
            [t("beregnete Fläche"), fmtNumber(prop.info.irrigatedHa, 0) + " ha"],
            [t("Wertkultur-Fläche"), fmtNumber(prop.info.valueCropHa, 0) + " ha"],
            [t("LKW (Logistik)"), fmtNumber(prop.info.lkwCount, 0)],
          ].map(([k, v], i) => (
            <div key={i} className="px-3 py-2" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[9.5px] text-nx-text-muted">{k}</div>
              <div className="num text-[12.5px] font-semibold">{v}</div>
            </div>
          ))}
        </div>
        <div className="px-4 py-2 text-[11px] text-nx-text-muted">
          {t("Stammfahrer aus den")} <b>{t("Ist-Feldstunden")}</b> {t("der Flotte (Arbeitsgänge ÷ verfügbare Fahrerstunden, Peak-Deckung 62 %). Betriebspositionen aus Maschinenzahl/Fläche, Saison aus Wertkultur-Fläche. Werte je Zeile übernehmen ↓ oder komplett.")}
        </div>
      </section>

      {/* Roster gruppiert */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr>
                <th className={th + " text-left"}>{t("Position")}</th>
                <th className={th + " text-right"}>{t("Kopf (FTE)")}</th>
                <th className={th + " text-right"}>{t("Brutto/Mon (je FTE)")}</th>
                <th className={th + " text-right"}>{t("Netto/Mon (je FTE)")}</th>
                <th className={th + " text-right"}>{t("Σ Brutto/Mon")}</th>
                <th className={th + " text-right"}>{t("Σ AG-Kosten/Jahr")}</th>
                <th className={th + " text-right"}>{t("Vorschlag")}</th>
              </tr>
            </thead>
            <tbody>
              {CAT_ORDER.map((cat) => {
                const grp = rows.filter((x) => (x.role.category ?? "betrieb") === cat);
                if (!grp.length) return null;
                return (
                  <React.Fragment key={cat}>
                    <tr><td colSpan={7} className="px-2 pt-3 pb-1 caption text-[10px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t(CAT_LABEL[cat])}</td></tr>
                    {grp.map(({ role, gm, net, employer, fte, rec }) => (
                      <tr key={role.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                        <td className="px-2 py-1.5">{role.title}</td>
                        <td className="px-2 py-1.5 text-right"><AssumptionField akey={role.headcountKey} compact /></td>
                        <td className="px-2 py-1.5 text-right"><AssumptionField akey={role.grossMonthlyKey} compact /></td>
                        <td className="num px-2 py-1.5 text-right" style={{ color: "var(--nx-success)" }}>{fmtMoney(net)}</td>
                        <td className="num px-2 py-1.5 text-right">{fmtMoney(fte * gm)}</td>
                        <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(fte * employer * 12)}</td>
                        <td className="px-2 py-1.5 text-right">
                          {rec != null && Math.abs(rec - fte) > 0.05 ? (
                            <button className="num rounded-pill px-2 text-[11px] font-semibold" style={{ background: "var(--nx-success-bg)", color: "var(--nx-success)" }} title={t("Vorschlag übernehmen")} onClick={() => applyOne(role.headcountKey, rec)}>
                              → {fmtNumber(rec, rec % 1 ? 1 : 0)}
                            </button>
                          ) : <span className="num text-[11px] text-nx-text-muted">{rec != null ? fmtNumber(rec, rec % 1 ? 1 : 0) : "–"}</span>}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {/* Informative Positionen (Kosten anderweitig verbucht → kein Doppelzählen) */}
              <tr><td colSpan={7} className="px-2 pt-3 pb-1 caption text-[10px] font-semibold text-nx-text-muted">{t("Weitere Kräfte (Kosten bereits an anderer Stelle verbucht)")}</td></tr>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5">{t("Logistik / LKW-Fahrer")} <span className="rounded-pill px-1.5 text-[9px]" style={{ background: "var(--nx-surface-sunken)", color: "var(--nx-text-muted)" }}>{t("in Transport-OpEx")}</span></td>
                <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtNumber(prop.info.logistik, 0)}</td>
                <td colSpan={4} className="px-2 py-1.5 text-[11px] text-nx-text-muted">{t("Fahrerkosten stecken in der Transport-/Speditionskalkulation (Make-or-Buy).")}</td>
                <td />
              </tr>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5">{t("Daily Workers / zilieri (Ernte-Peak)")} <span className="rounded-pill px-1.5 text-[9px]" style={{ background: "var(--nx-surface-sunken)", color: "var(--nx-text-muted)" }}>{t("in Ernte-COGS")}</span></td>
                <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtNumber(prop.info.dailyPeak, 0)}</td>
                <td colSpan={4} className="px-2 py-1.5 text-[11px] text-nx-text-muted">{t("Erntehandarbeit ist als variable Direktkosten (Arbeitsgang „Handarbeit\") je Kultur verbucht.")}</td>
                <td />
              </tr>
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                <td className="px-2 py-2.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Σ Stammpersonal (Payroll)")}</td>
                <td className="num px-2 py-2.5 text-right font-semibold">{fmtNumber(sumFte, 1)}</td>
                <td /><td className="num px-2 py-2.5 text-right text-nx-text-muted">{t("Netto")} {fmtMoney(sumNetMo)}</td>
                <td className="num px-2 py-2.5 text-right font-semibold">{fmtMoney(sumGrossMo)}</td>
                <td className="num px-2 py-2.5 text-right font-semibold">{fmtMoney(sumEmpYr)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("AG-Personalaufwand (Brutto + CAM) fließt in die OpEx/GuV; Netto ist die Auszahlung an die Mitarbeitenden. Kopfzahlen skalieren über den Wachstums-Ramp; Brutto folgt der Lohn-Inflation.")}
        </div>
      </section>
    </div>
  );
}


/** PERSONALENTWICKLUNG über die Planjahre.
 *
 *  Die Kopfzahlen im Planer sind eine BASIS — im Modell skalieren sie über den Wachstumspfad:
 *  Leitung und Werkstatt gedämpft (Sockel + Fläche), Stammfahrer, Bewässerung, Lager, Saison und
 *  Praktikanten linear mit der Fläche. Was der Planer zeigt, ist damit nur ein Jahr; wer wissen
 *  will, wann welche Stelle dazukommt, braucht den Verlauf. Genau den zeigt diese Tabelle —
 *  gelesen aus denselben Kurven, mit denen die Engine rechnet, nicht nachgebildet. */
function PersonalEntwicklung() {
  const domain = useModelStore((s) => s.domain);
  const scenarioId = useModelStore((s) => s.view.scenarioId);
  const ms = useModelStore(selectModelState);
  const p = domain.personnel;
  const years = Math.max(1, domain.growth?.years ?? 1);
  const areas = React.useMemo(() => deriveCropAreasMY(domain), [domain]);

  if (!p) return null;

  /** FTE einer Rolle im Planjahr y — Mittel über die zwölf Monate der Kurve. */
  const fteOf = (key: string, y: number): number => {
    const prof: any = (ms as any).assumptions?.[key]?.scenarioProfiles?.[domain.baseScenarioId];
    if (!prof) return 0;
    if (prof.kind !== "curve") return prof.value ?? 0;
    const v: number[] = prof.values ?? [];
    const seg = v.slice(y * 12, y * 12 + 12);
    return seg.length ? seg.reduce((a, b) => a + b, 0) / seg.length : (v[v.length - 1] ?? 0);
  };
  const grossOf = (key: string, y: number): number => {
    const prof: any = (ms as any).assumptions?.[key]?.scenarioProfiles?.[domain.baseScenarioId];
    if (!prof) return 0;
    if (prof.kind !== "curve") return prof.value ?? 0;
    const v: number[] = prof.values ?? [];
    const seg = v.slice(y * 12, y * 12 + 12);
    return seg.length ? seg.reduce((a, b) => a + b, 0) / seg.length : (v[v.length - 1] ?? 0);
  };

  const rows = p.roles.map((role) => ({
    title: role.title,
    fte: Array.from({ length: years }, (_, y) => fteOf(role.headcountKey, y)),
    gross: Array.from({ length: years }, (_, y) => grossOf(role.grossMonthlyKey, y)),
  }));
  const sumFte = (y: number) => rows.reduce((s, r) => s + r.fte[y], 0);
  // AG-Kosten p.a. je Jahr: Σ FTE × Brutto × 12 × (1 + CAM). Payroll-Detail steht im Planer unten.
  const cam = p.rates.cam ?? 0;
  const kostenJahr = (y: number) => rows.reduce((s, r) => s + r.fte[y] * r.gross[y] * 12 * (1 + cam), 0);
  const flaeche = (y: number) => Object.values(areas.areas).reduce((s: number, c: any) => s + (c[y] ?? 0), 0);

  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";
  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
        <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Personalentwicklung über die Planjahre")}</h3>
        <p className="mt-0.5 text-[11px] text-nx-text-muted">
          {t("Kopfzahlen (FTE) je Position und Jahr, wie die Engine sie rechnet: Leitung und Werkstatt gedämpft (Sockel + Fläche), alle übrigen linear mit der Betriebsfläche. Die Tabelle unten zeigt die Basis je Kopf — hier steht, wann welche Stelle dazukommt.")}
        </p>
      </div>
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <th className={th + " text-left"}>{t("Position")}</th>
              {Array.from({ length: years }, (_, y) => <th key={y} className={th + " text-right"}>{START_YEAR + y}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
              <td className="px-2 py-1.5 text-nx-text-muted">{t("Betriebsfläche")}</td>
              {Array.from({ length: years }, (_, y) => (
                <td key={y} className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtNumber(flaeche(y), 0)} ha</td>
              ))}
            </tr>
            {rows.map((r) => (
              <tr key={r.title} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5">{t(r.title)}</td>
                {r.fte.map((v, y) => (
                  <td key={y} className="num px-2 py-1.5 text-right">{fmtNumber(v, v < 10 ? 1 : 0)}</td>
                ))}
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-2 py-2 font-semibold">{t("Σ FTE")}</td>
              {Array.from({ length: years }, (_, y) => (
                <td key={y} className="num px-2 py-2 text-right font-semibold">{fmtNumber(sumFte(y), 1)}</td>
              ))}
            </tr>
            <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
              <td className="px-2 py-1.5 font-semibold" style={{ color: "var(--nx-locate)" }}>{t("AG-Kosten p.a.")}</td>
              {Array.from({ length: years }, (_, y) => (
                <td key={y} className="num px-2 py-1.5 text-right font-semibold" style={{ color: "var(--nx-locate)" }}>
                  {fmtMoney(kostenJahr(y))}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
        {t("AG-Kosten = Σ FTE × Brutto × 12 × (1 + CAM). Saisonkräfte sind FTE-Äquivalente der Kampagne, nicht Köpfe. Erntehandarbeit und LKW-Fahrer stehen bewusst NICHT hier — sie sind als Direktkosten bzw. in der Transportkalkulation verbucht (siehe Hinweis unten).")}
      </div>
    </section>
  );
}
