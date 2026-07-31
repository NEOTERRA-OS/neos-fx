"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import { NumberInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import { Check } from "lucide-react";
import type { OpeningBalance } from "../../core/types";
import { parseRomanianBalance, machineUnitPriceCent, type OBField, type MachineType } from "../../store/model";

const ASSETS: [keyof OpeningBalance, string][] = [
  ["cash", "Kasse/Bank"], ["receivables", "Forderungen"], ["inventory", "Vorräte"],
  ["ppeNet", "Anlagevermögen (netto)"], ["land", "Grund & Boden"],
];
const LIAB: [keyof OpeningBalance, string][] = [
  ["payables", "Verbindlichkeiten L+L"], ["debt", "Langfr. Finanzverb."],
  ["shareCapital", "Eigenkapital"], ["retainedEarnings", "Gewinnvortrag"],
];
const FIELD_LABEL: Record<OBField, string> = {
  cash: "Kasse/Bank", receivables: "Forderungen", inventory: "Vorräte", ppeNet: "Anlagevermögen (netto)",
  land: "Grund & Boden", payables: "Verbindlichkeiten L+L", debt: "Langfr. Finanzverb.",
  shareCapital: "Eigenkapital", retainedEarnings: "Gewinnvortrag",
};
const SAMPLE = `2131\tEchipamente\t4.250.000,00\t0,00
211\tTerenuri\t3.800.000,00\t0,00
371\tMărfuri/Stocuri\t640.000,00\t0,00
4111\tClienți\t420.000,00\t0,00
5121\tConturi la bănci\t510.000,00\t0,00
4424\tTVA de recuperat\t180.000,00\t0,00
401\tFurnizori\t0,00\t690.000,00
1621\tCredite bancare TL\t0,00\t3.100.000,00
1012\tCapital subscris vărsat\t0,00\t4.900.000,00
117\tRezultat reportat\t0,00\t1.290.000,00`;

/** Eröffnungsbilanz (Modellstart) + Import-Engine (RO Accounting / ANAF). */
export function EroeffnungsbilanzView() {
  const { domain, patch } = useModelStore();
  const scenarioId = useModelStore((s) => s.view.scenarioId);
  const ob = domain.openingBalance;
  const sumA = ASSETS.reduce((a, [k]) => a + (ob[k] as number), 0);
  const sumL = LIAB.reduce((a, [k]) => a + (ob[k] as number), 0);
  const diff = sumA - sumL;

  // Verprobung: Restbuchwert des Maschinen-Bestands (linear bis Restwert-Floor über Alter/Nutzung).
  const gDisc = readAssumption(domain, "tco.discount", scenarioId) ?? 0;
  const gResT = readAssumption(domain, "tco.res_trail", scenarioId) ?? 0;
  const gResS = readAssumption(domain, "tco.res_self", scenarioId) ?? 0;
  const rbw = (m: MachineType) => {
    const netto = machineUnitPriceCent(domain, m, scenarioId) * (1 - (m.discountPct ?? gDisc));
    const nutz = m.nutzungYears ?? m.afaCommercialYears ?? 10;
    const floor = m.residualPctList ?? (m.cat === "gezogen" ? gResT : gResS);
    const age = Math.max(0, m.ownedAgeYears ?? 0);
    const f = Math.max(floor, 1 - (1 - floor) * Math.min(1, nutz > 0 ? age / nutz : 1));
    return Math.round((m.ownedUnits ?? 0) * netto * f);
  };
  const machRbwByClass = (cls: string) => domain.machineCatalog.filter((m) => m.assetClass === cls).reduce((a, m) => a + rbw(m), 0);
  const rbwMachines = machRbwByClass("machinery");
  const rbwIrrig = machRbwByClass("irrigation");
  const rbwBuild = machRbwByClass("buildings");
  const rbwTotal = rbwMachines + rbwIrrig + rbwBuild;
  const ppeDelta = (ob.ppeNet as number) - rbwTotal;
  const ownedUnits = domain.machineCatalog.reduce((a, m) => a + (m.ownedUnits ?? 0), 0);

  const [showImport, setShowImport] = React.useState(false);
  const [text, setText] = React.useState("");
  const [fx, setFx] = React.useState(4.97);
  const parsed = React.useMemo(() => parseRomanianBalance(text, fx), [text, fx]);
  const mappedCount = parsed.rows.filter((r) => r.field).length;
  const impDiff = parsed.sumA - parsed.sumL;

  const applyImport = () => patch((d) => {
    const b = parsed.buckets;
    (Object.keys(b) as OBField[]).forEach((f) => { (d.openingBalance as any)[f] = Math.round(b[f]); });
  });

  const col = (title: string, rows: [keyof OpeningBalance, string][], sum: number) => (
    <div className="flex-1">
      <div className="caption py-1 text-[10.5px] font-bold text-nx-text-muted">{title}</div>
      {rows.map(([k, label]) => (
        <div key={k} className="flex items-center justify-between gap-3 border-b py-1.5" style={{ borderColor: "var(--nx-border-divider)" }}>
          <span className="text-[12.5px]">{t(label)}</span>
          <NumberInput value={ob[k] as number} unit="money" width={130} onCommit={(n) => patch((d) => { (d.openingBalance as any)[k] = n; })} />
        </div>
      ))}
      <div className="flex items-center justify-between py-2 text-[12.5px] font-semibold">
        <span>Σ {title}</span><span className="num">{fmtMoney(sum)} €</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Verprobung: Anlagevermögen ↔ Restbuchwert Maschinen-Bestand */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold">{t("Verprobung Anlagevermögen ↔ Bestand-Restbuchwert")}</h3>
          <span className="rounded px-2 py-0.5 text-[11px] font-semibold" style={{ color: ppeDelta >= 0 ? "#067647" : "#B42318", background: "var(--nx-app-bg)" }}>
            {ppeDelta >= 0 ? t("gedeckt") : t("Anlagevermögen < Bestand-RBW")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)" }}>
          {([
            [t("Anlagevermögen (Eröffnungsbilanz)"), fmtMoney(ob.ppeNet as number) + " €", "var(--nx-locate)"],
            [t("davon Maschinen-Bestand (RBW)"), fmtMoney(rbwMachines) + " €", "var(--nx-brand-lift)"],
            [t("davon übrige Anlagen (Δ)"), fmtMoney(ppeDelta) + " €"],
            [t("Bestand-Maschinen"), `${fmtNumber(ownedUnits, 0)} ${t("Einh.")}`],
          ] as [string, string, string?][]).map(([k, v, c], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[13px] font-semibold" style={{ color: c ?? "var(--nx-text)" }}>{v}</div>
            </div>
          ))}
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          <b>{t("Maschinen-Restbuchwert")}</b>{t(" = Netto-Neupreis linear über Alter/Nutzungsdauer bis Restwert-Floor (aus dem Register: Bestand × Alter je Maschine). Der Rest des Anlagevermögens (")}<b>Δ {fmtMoney(ppeDelta)} €</b>{t(") entfällt auf Beregnung/Pivots, Gebäude/Lager und übrige Anlagen (im Register als Bestand mit 0 geführt). Zur sauberen Verprobung das ")}<b>{t("Alter je Bestandsmaschine")}</b>{t(" im Register pflegen und ggf. Pivots/Lager als Bestand mit Alter erfassen; dann muss Maschinen-RBW + übrige Anlagen = Anlagevermögen ergeben.")}
        </div>
      </section>

      {/* Import-Engine */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-brand-lift)", background: "var(--nx-surface)" }}>
        <button className="flex w-full items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }} onClick={() => setShowImport((s) => !s)}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Import aus RO-Buchhaltung / ANAF (Balanță de verificare → Eröffnungsbilanz)")}</h3>
          <span className="text-[12px] text-nx-text-muted">{showImport ? t("▲ einklappen") : t("▼ öffnen")}</span>
        </button>
        {showImport && (
          <div className="space-y-3 px-4 py-3">
            <div className="text-[11.5px] text-nx-text-muted">
              {t("Kontensaldenliste (balanța de verificare) oder ANAF-Positionen einfügen — Format ")}<code>{t("Konto ⇥ Bezeichnung ⇥ Sold debitor ⇥ Sold creditor")}</code>{t(" (Tab/Semikolon/Spalten). Die Engine ordnet nach ")}<b>Plan de conturi</b>{t("-Präfix zu (211→Terenuri, 21x→Anlagen, 3xx→Vorräte, 41x→Clienți, 40x→Furnizori, 512/531→Bank/Kasse, 16x→Kredite TL, 10x→Kapital, 117/12x→Ergebnis, 4424/4426↔4423/4427→TVA).")}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-[11.5px] text-nx-text-muted">{t("Kurs RON→EUR (÷)")}
                <NumberInput value={fx} unit="factor" suffix="" width={70} onCommit={(n) => setFx(n > 0 ? n : 1)} /></label>
              <span className="text-[11px] text-nx-text-muted">{t("1 = Werte bereits in EUR")}</span>
              <button className="text-[11px] underline text-nx-text-muted" onClick={() => setText(SAMPLE)}>{t("Beispiel einfügen")}</button>
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} spellCheck={false}
              placeholder={"2131\tEchipamente\t4.250.000,00\t0,00\n401\tFurnizori\t0,00\t690.000,00\n..."}
              className="w-full rounded-control border px-3 py-2 text-[12px] num" style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)", fontFamily: "ui-monospace, monospace" }} />

            {text.trim() && (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {/* Zuordnung */}
                <div className="rounded-tile border" style={{ borderColor: "var(--nx-border)" }}>
                  <div className="px-3 py-2 border-b caption text-[10px] text-nx-text-muted" style={{ borderColor: "var(--nx-border-divider)" }}>
                    {t("Zuordnung — ")}{mappedCount}/{parsed.rows.length}{t(" Konten · ")}{parsed.unmapped.length}{t(" ohne Zuordnung")}
                  </div>
                  <table className="w-full text-[12px]">
                    <tbody>
                      {(Object.keys(FIELD_LABEL) as OBField[]).map((f) => {
                        const isAsset = ["cash", "receivables", "inventory", "ppeNet", "land"].includes(f);
                        return (
                          <tr key={f} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                            <td className="px-3 py-1.5">{t(FIELD_LABEL[f])}</td>
                            <td className="px-2 py-1.5 text-[10px] text-nx-text-muted">{isAsset ? t("Aktiv") : t("Passiv")}</td>
                            <td className="num px-3 py-1.5 text-right font-semibold">{fmtMoney(parsed.buckets[f])} €</td>
                          </tr>
                        );
                      })}
                      <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                        <td className="px-3 py-2 font-semibold">{t("Aktiva / Passiva")}</td><td />
                        <td className="num px-3 py-2 text-right font-semibold">{fmtMoney(parsed.sumA)} / {fmtMoney(parsed.sumL)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {/* Nicht zugeordnet + Übernahme */}
                <div className="rounded-tile border flex flex-col" style={{ borderColor: "var(--nx-border)" }}>
                  <div className="px-3 py-2 border-b caption text-[10px] text-nx-text-muted" style={{ borderColor: "var(--nx-border-divider)" }}>{t("Nicht zugeordnete Konten")}</div>
                  <div className="flex-1 overflow-auto px-3 py-1.5 text-[11.5px]" style={{ maxHeight: 160 }}>
                    {parsed.unmapped.length === 0 ? <span className="inline-flex items-center gap-1 text-nx-text-muted">{t("Alle Konten zugeordnet")}<Check size={11} strokeWidth={2.5} aria-hidden /></span> :
                      parsed.unmapped.map((r, i) => <div key={i} className="flex justify-between gap-2 py-0.5"><span className="num text-nx-text-muted">{r.account}</span><span className="flex-1 truncate">{r.label}</span><span className="num text-nx-text-muted">{fmtMoney(r.debit - r.credit)}</span></div>)}
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t px-3 py-2" style={{ borderColor: "var(--nx-border-divider)" }}>
                    <span className="num text-[11.5px] font-semibold" style={{ color: Math.abs(impDiff) < 100 ? "var(--nx-success)" : "var(--nx-warning)" }}>
                      {Math.abs(impDiff) < 100 ? <span className="inline-flex items-center gap-1"><Check size={11} strokeWidth={2.5} aria-hidden />{t("ausgeglichen")}</span> : `Δ ${fmtMoney(impDiff)} €`}
                    </span>
                    <button className="rounded-control border px-3 text-[12px] font-semibold" style={{ height: 32, borderColor: "var(--nx-brand-lift)", color: "var(--nx-brand-lift)", background: "var(--nx-surface)" }} onClick={applyImport}>
                      {t("In Eröffnungsbilanz übernehmen")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Manuelle Eröffnungsbilanz */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Eröffnungsbilanz (Modellstart)")}</h2>
          <span className="num text-[12px] font-semibold" style={{ color: diff === 0 ? "var(--nx-success)" : "var(--nx-error)" }}>
            {diff === 0 ? <span className="inline-flex items-center gap-1"><Check size={11} strokeWidth={2.5} aria-hidden />{t("ausgeglichen")}</span> : `Δ ${fmtMoney(diff)} €`}
          </span>
        </div>
        <div className="flex flex-col gap-6 px-4 py-3 md:flex-row">
          {col(t("Aktiva"), ASSETS, sumA)}
          {col(t("Passiva"), LIAB, sumL)}
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Hinweis: Der Rechenkern führt einen Alt-Schuldenstock (openingBalance.debt) derzeit nicht im Bilanz-Rollforward (bs.debt kommt nur aus dem Tilgungsplan). Im Seed ist die Alt-Schuld daher ins Eröffnungs-Eigenkapital gefaltet, damit die Bilanz aufgeht — echte Alt-Verschuldung braucht eine Engine-Erweiterung.")}
        </div>
      </section>
    </div>
  );
}
