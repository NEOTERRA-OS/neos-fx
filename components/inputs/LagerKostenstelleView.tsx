"use client";
import React from "react";
import { useModelStore, selectModelState } from "../../store/modelStore";
import { resolveScalar, STORAGE_CROP_IDS, CROP_CAL } from "../../store/model";
import { computeStorage } from "../../core/engine";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import { AlertTriangle } from "lucide-react";
import { CapexPositionen } from "./CapexPositionen";

/** Kostenstelle Lager & Packhaus — Mengengerüst, Belegung, Deckungsbeitrag.
 *
 *  Seit dem Dienstleistungsmodell ist das Lager ein Profit Center mit EXTERNEM Erlös:
 *  die Ware wird bei der Ernte verkauft, das Eigentum geht über, die Einlagerung wird
 *  separat berechnet. Diese Ansicht stellt gegenüber, was das kostet und was es bringt.
 *
 *  Die entscheidende Größe ist die GLEICHZEITIGE Spitzenbelegung, nicht der Jahres-
 *  durchsatz: gebaut werden muss, was zur gleichen Zeit im Lager liegt. */

const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/* SZENARIO-ZIEL. Bis 04.08.2026 schrieben die Felder dieser Ansicht IMMER nach
 *  `baseScenarioId`, egal welches Szenario oben in der Leiste stand. Das ist
 *  stiller Datenverlust: `store.active` kann je Szenario verschieden stehen. Wer auf
 *  "Best" schaltet, 10 eintippt und Enter drueckt, aendert BASE — und das Feld
 *  springt vor seinen Augen auf 7 zurueck, weil es weiter Best liest. Dieselbe
 *  Zahl im Annahmen-Register getippt wirkt korrekt.
 *
 *  Geschrieben wird jetzt in das AKTIVE Szenario, wie es der gemeinsame
 *  Feld-Baustein (`components/inputs/Feld.tsx`) seit jeher tut. */
export function LagerKostenstelleView() {
  const { domain, patch } = useModelStore();
  const sc = useModelStore((s) => s.view.scenarioId);
  const currency = useModelStore((s) => s.view.currency);
  const ms = useModelStore(selectModelState);

  const st = React.useMemo(() => computeStorage(ms, sc), [ms, sc]);
  const lagerAktiv = !domain.assumptions["store.active"] || resolveScalar(domain, "store.active", sc) >= 0.5;
  const ppy = 12;
  const years = Math.max(1, Math.floor(st.balanceT.length / ppy));
  const [year, setYear] = React.useState(0);   // Regel 01.08.2026: jede Jahresauswahl startet im ersten Planjahr
  const y = Math.min(year, years - 1);

  const months = Math.round(resolveScalar(domain, "store.months", sc) || 0);
  const cropName = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of domain.catalog) m[c.cropId] = c.name;
    return m;
  }, [domain.catalog]);

  /** Mengengerüst je Lagerkultur im GEWÄHLTEN Jahr — damit es zur Belegungskurve passt.
   *  Grundlage sind die mehrjährig expandierten Anbaupläne, nicht der Basis-Anbauplan. */
  const rows = React.useMemo(() => {
    const agg = new Map<string, { ha: number; tons: number }>();
    for (const plan of ms.cropPlans) {
      if (!STORAGE_CROP_IDS.includes(plan.cropId)) continue;
      if (!plan.harvestPeriods.some((h) => Math.floor(h / ppy) === y)) continue;
      const cat = domain.catalog.find((c) => c.cropId === plan.cropId);
      if (!cat) continue;
      const yld = resolveScalar(domain, cat.yieldKey, sc);
      const loss = resolveScalar(domain, cat.lossKey, sc) || 0;
      const cur = agg.get(plan.cropId) ?? { ha: 0, tons: 0 };
      cur.ha += plan.areaHa;
      cur.tons += plan.areaHa * yld * (1 - loss);
      agg.set(plan.cropId, cur);
    }
    const out: { cropId: string; ha: number; tons: number; share: number; stored: number; harvest: number[] }[] = [];
    for (const [cropId, v] of agg) {
      if (v.ha <= 0) continue;
      const k = `store.share.${cropId}`;
      const share = domain.assumptions[k] ? Math.max(0, Math.min(1, resolveScalar(domain, k, sc))) : 0;
      const harvest = ((CROP_CAL as Record<string, { harvest: number[] }>)[cropId]?.harvest ?? []).slice();
      out.push({ cropId, ha: v.ha, tons: v.tons, share, stored: v.tons * share, harvest });
    }
    return out.sort((a, b) => b.stored - a.stored);
  }, [ms, domain, sc, y]);

  const totalTons = rows.reduce((a, r) => a + r.tons, 0);
  const totalStored = rows.reduce((a, r) => a + r.stored, 0);

  const capex = ms.capex.filter((c) => c.id.startsWith("cx-store") || c.id.startsWith("cx-plan-lg-") || c.id.startsWith("cx-plan-pk-"));
  const capexTotal = capex.reduce((a, c) => a + c.amount, 0);
  const capexPerT = st.peakT > 0 ? capexTotal / st.peakT : 0;

  const yr = (arr: number[]) => {
    let s = 0;
    for (let p = y * ppy; p < Math.min(arr.length, (y + 1) * ppy); p++) s += arr[p];
    return s;
  };
  const occ = st.balanceT.slice(y * ppy, (y + 1) * ppy);
  const occMax = Math.max(1, ...occ);
  /** Spitzenbelegung DIESES Jahres — vergleichbar mit dem Mengengerüst darüber. */
  const peakYear = Math.max(...occ, 0);
  /** Ersparnis durch gemeinsame Lagerung: Jahresmenge gegen gleichzeitige Spitze. */
  const sharingSaving = totalStored > 0 ? Math.max(0, 1 - peakYear / totalStored) : 0;

  const feeShort = st.breakEvenFee > st.feePerTonneMonth;
  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted text-left";
  const card = { borderColor: "var(--nx-border)", background: "var(--nx-surface)" };

  return (
    <div className="space-y-4">
      {/* --- Kopf + Kennzahlen ---------------------------------------------- */}
      <div className="rounded-tile border" style={card}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[14px] font-semibold">{t("Lager & Packhaus — Kostenstelle")}</h2>
            <label className="inline-flex items-center gap-2 text-[11px] font-semibold"
                   style={{ color: lagerAktiv ? "var(--nx-brand-lift)" : "var(--nx-text-muted)" }}>
              <input type="checkbox" checked={lagerAktiv}
                onChange={(e) => patch((d) => {
                  const a = d.assumptions["store.active"]; if (!a) return;
                  const prof = a.scenarioProfiles[sc];
                  if (prof && prof.kind === "constant") prof.value = e.target.checked ? 1 : 0;
                })} />
              {lagerAktiv ? t("Lagerbau aktiv") : t("Lagerbau ausgesetzt")}
            </label>
          </div>
          {lagerAktiv && (
            <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] text-nx-text-secondary">
              <span className="caption text-[10px] text-nx-text-muted">{t("Einzeln entscheiden:")}</span>
              {([["store.capex_shell", "Hülle & Bau selbst investieren"], ["store.capex_tech", "Technik selbst investieren"]] as const).map(([key, lbl]) => {
                const on = !domain.assumptions[key] || resolveScalar(domain, key, sc) >= 0.5;
                return (
                  <label key={key} className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={on}
                      onChange={(e) => patch((d) => {
                        const a2 = d.assumptions[key]; if (!a2) return;
                        const prof = a2.scenarioProfiles[sc];
                        if (prof && prof.kind === "constant") prof.value = e.target.checked ? 1 : 0;
                      })} />
                    {t(lbl)}
                  </label>
                );
              })}
              <span className="text-[10.5px] text-nx-text-muted">
                {t("Abgewählt heißt: keine eigene Investition (Miete/Dienstleister). Steuerlich relevant — die Reinvestitionsbefreiung greift auf Technik, nicht auf Gebäude.")}
              </span>
            </div>
          )}
          <p className="caption mt-0.5 text-[10.5px] text-nx-text-muted">
            {t("Die Ware wird bei der Ernte verkauft, das Eigentum geht auf den Abnehmer über, die Einlagerung wird als Dienstleistung berechnet. Gebaut werden muss die gleichzeitige Spitzenbelegung, nicht der Jahresdurchsatz.")}
          </p>
        </div>
        {!lagerAktiv && (
          <div className="flex items-start gap-2 border-b px-4 py-2.5 text-[11px]"
               style={{ borderColor: "var(--nx-border)", color: "var(--nx-warning)" }}>
            <AlertTriangle size={14} className="mt-px shrink-0" />
            <span>
              <b>{t("Der Lagerbau ist aus dem Modell genommen.")}</b>{" "}
              {t("Keine Einlagerung, keine Lagererlöse, keine Lagerkosten und keine Lager-CAPEX — die gesamte Ernte wird direkt ab Feld verkauft. Die Rechenlogik unten bleibt vollständig erhalten und zeigt, was ein Lager brächte; scharf wird sie erst mit dem Schalter oben.")}
            </span>
          </div>
        )}
        <div className="grid gap-px" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", background: "var(--nx-border)" }}>
          <Kpi label={t("Spitzenbelegung")} value={`${fmtNumber(peakYear, 0)} t`} hint={`${t("Kapazität Jahr")} ${y + 1} · ${t("Horizont-Spitze")} ${fmtNumber(st.peakT, 0)} t`} />
          <Kpi label={t("Lager-CAPEX")} value={fmtMoney(capexTotal, currency)} hint={`${fmtNumber(capexPerT / 100, 0)} €/t ${t("Kapazität")}`} />
          <Kpi label={t("Lagergebühr")} value={`${fmtNumber(st.feePerTonneMonth / 100, 2)} €/t·${t("Mon.")}`} hint={`${t("Break-even")} ${fmtNumber(st.breakEvenFee / 100, 2)}`} warn={feeShort} />
          <Kpi label={t("Break-even-Belegung")} value={`${fmtNumber(st.breakEvenOccupancy * 100, 1)} %`} hint={t("der geplanten Menge")} warn={st.breakEvenOccupancy > 1} />
          <Kpi label={t("Ergebnis Kostenstelle")} value={fmtMoney(yr(st.result), currency)} hint={`${t("Jahr")} ${y + 1}`} warn={yr(st.result) < 0} />
        </div>
        {feeShort && (
          <div className="mx-4 my-3 flex items-start gap-2 rounded-control border px-3 py-2 text-[11.5px]"
            style={{ borderColor: "var(--nx-warn, #C9A227)", background: "color-mix(in srgb, var(--nx-warn, #C9A227) 12%, transparent)", color: "var(--nx-warn, #C9A227)" }}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              <b>{t("Die Gebühr deckt die Anlage nicht.")}</b>{t(" Angesetzt sind ")}
              <b>{fmtNumber(st.feePerTonneMonth / 100, 2)} €/t·{t("Mon.")}</b>
              {t(", nötig wären ")}<b>{fmtNumber(st.breakEvenFee / 100, 2)}</b>
              {t(". Entweder die Gebühr verhandeln, die Lagerdauer verkürzen, weniger einlagern — oder billiger bauen: nicht jede Kultur braucht Kühlung, belüftetes Schüttlager kostet ein Drittel eines CA-Lagers.")}
            </span>
          </div>
        )}
      </div>

      {/* --- Mengengerüst je Kultur ----------------------------------------- */}
      <div className="rounded-tile border" style={card}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold">{t("Mengengerüst je Kultur")}</h3>
          <p className="caption mt-0.5 text-[10.5px] text-nx-text-muted">{t("Erstes Planjahr im aktiven Szenario. Die Einlagerungsquote ist unter Preise & Treiber und im Szenario-Studio verstellbar.")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead><tr className="border-b" style={{ borderColor: "var(--nx-border)" }}>
              <th className={th}>{t("Kultur")}</th>
              <th className={th}>{t("Fläche")}</th>
              <th className={th}>{t("Produktion")}</th>
              <th className={th}>{t("Einlagerungsquote")}</th>
              <th className={th}>{t("eingelagert")}</th>
              <th className={th}>{t("Ernte")}</th>
              <th className={th}>{t("belegt")}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cropId} className="border-b" style={{ borderColor: "var(--nx-border)" }}>
                  <td className="px-2 py-1.5 font-medium">{cropName[r.cropId] ?? r.cropId}</td>
                  <td className="px-2 py-1.5 num">{fmtNumber(r.ha, 0)} ha</td>
                  <td className="px-2 py-1.5 num">{fmtNumber(r.tons, 0)} t</td>
                  <td className="px-2 py-1.5 num">{fmtNumber(r.share * 100, 0)} %</td>
                  <td className="px-2 py-1.5 num font-semibold">{fmtNumber(r.stored, 0)} t</td>
                  <td className="px-2 py-1.5 caption text-[10.5px] text-nx-text-muted">{r.harvest.map((h) => MON[h % 12]).join(", ") || "—"}</td>
                  <td className="px-2 py-1.5 caption text-[10.5px] text-nx-text-muted">
                    {r.stored > 0 && r.harvest.length ? `${MON[r.harvest[0] % 12]}–${MON[(r.harvest[0] + Math.max(0, months - 1)) % 12]}` : "—"}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="px-2 py-1.5 font-semibold">{t("Summe")}</td>
                <td className="px-2 py-1.5 num font-semibold">{fmtNumber(rows.reduce((a, r) => a + r.ha, 0), 0)} ha</td>
                <td className="px-2 py-1.5 num font-semibold">{fmtNumber(totalTons, 0)} t</td>
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5 num font-semibold">{fmtNumber(totalStored, 0)} t</td>
                <td className="px-2 py-1.5" colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2.5 text-[11.5px] text-nx-text-secondary" style={{ borderColor: "var(--nx-border)" }}>
          {sharingSaving > 0.02 ? (
            <>
              {t("Gemeinsame Lagerung spart Kapazität: ")}<b>{fmtNumber(totalStored, 0)} t</b>{t(" Jahresmenge gegen ")}
              <b>{fmtNumber(st.peakT, 0)} t</b>{t(" Spitzenbelegung — ")}<b>{(sharingSaving * 100).toFixed(0)} %</b>
              {t(" weniger zu bauen, weil sich die Ernten zeitlich staffeln.")}
            </>
          ) : (
            <>
              <b>{t("Gemeinsame Lagerung spart hier praktisch nichts.")}</b>
              {t(" Die Lagerkulturen ernten fast alle im September und Oktober — die Belegung addiert sich, statt sich zu staffeln. Kapazitätsersparnis: ")}
              <b>{(Math.max(0, sharingSaving) * 100).toFixed(0)} %</b>
              {t(". Eine echte Ersparnis entstünde nur über zeitlich versetzte Ernten oder kürzere Lagerdauern je Kultur.")}
            </>
          )}
        </div>
      </div>

      {/* --- Belegungskurve -------------------------------------------------- */}
      <div className="rounded-tile border" style={card}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <div>
            <h3 className="text-[13px] font-semibold">{t("Belegungskurve")}</h3>
            <p className="caption mt-0.5 text-[10.5px] text-nx-text-muted">{t("Bestand zum Monatsende. Der höchste Balken ist die zu bauende Kapazität.")}</p>
          </div>
          <select className="rounded-control border px-2 text-[11.5px]" value={y}
            style={{ height: 30, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }}
            onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: years }, (_, i) => <option key={i} value={i}>{t("Jahr")} {i + 1}</option>)}
          </select>
        </div>
        <div className="px-4 py-4">
          <div className="flex items-end gap-1" style={{ height: 150 }}>
            {occ.map((v, i) => (
              <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1" style={{ height: "100%" }}>
                <span className="caption text-[9px] text-nx-text-muted">{v > occMax * 0.04 ? fmtNumber(v / 1000, 0) + "k" : ""}</span>
                <div style={{
                  width: "100%", height: `${(v / occMax) * 100}%`, minHeight: v > 0 ? 2 : 0,
                  background: v >= occMax * 0.999 ? "var(--nx-warn, #C9A227)" : "var(--nx-accent, var(--nx-locate))",
                  borderRadius: "2px 2px 0 0",
                }} />
                <span className="caption text-[9.5px] text-nx-text-muted">{MON[i]}</span>
              </div>
            ))}
          </div>
          <p className="caption mt-3 text-[10.5px] text-nx-text-muted">
            {t("Spitze ")}<b>{fmtNumber(occMax, 0)} t</b>{t(" · Lagerdauer ")}{months}{t(" Monate · Kapazitätskosten ")}
            <b>{fmtNumber(capexPerT / 100, 0)} €/t</b>
          </p>
        </div>
      </div>

      {/* --- Deckungsbeitrag -------------------------------------------------- */}
      <div className="rounded-tile border" style={card}>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold">{t("Deckungsbeitrag der Kostenstelle")}</h3>
          <p className="caption mt-0.5 text-[10.5px] text-nx-text-muted">{t("Jahr")} {y + 1}</p>
        </div>
        <table className="w-full text-[12px]">
          <tbody>
            <Row label={t("Lagergebühr (Erlös)")} v={yr(st.feeRevenue)} currency={currency} bold />
            <Row label={t("− Energie")} v={-yr(st.energyCost)} currency={currency} />
            <Row label={t("− Ein-/Auslagerung")} v={-yr(st.handlingCost)} currency={currency} />
            <Row label={t("− Lagerverluste (Ersatzpflicht)")} v={-yr(st.lossCost)} currency={currency} />
            <Row label={t("− Abschreibung Lager-CAPEX")} v={-yr(st.depreciation)} currency={currency} />
            <Row label={t("= Ergebnis")} v={yr(st.result)} currency={currency} bold top />
          </tbody>
        </table>
        <div className="border-t px-4 py-2.5 text-[11.5px] text-nx-text-secondary" style={{ borderColor: "var(--nx-border)" }}>
          {t("Nicht enthalten: die Kapitalbindung der Ware. Im Dienstleistungsmodell trägt sie der Abnehmer — das ist der eigentliche Vorteil dieser Struktur gegenüber dem Eigenlager. Die Lagerverluste stehen ungedeckelt; eine Schwundtoleranz im Verwahrvertrag würde sie begrenzen.")}
        </div>
      </div>

      {/* --- Investition ------------------------------------------------------
          NEU AM 04.08.2026. Neun Positionen — Schüttlager, Kühl-/CA-Lager,
          Curing, Gebäudehülle und fünf Packhauslinien, zusammen rund 27 Mio € —
          standen im Modell, trieben die Abschreibung dieser Kostenstelle und
          waren von keiner Ansicht aus änderbar. Sie gehören HIERHIN: an die
          Rechnung, deren Abschreibung sie sind. */}
      <div className="px-1 pt-2">
        <h3 className="text-[13px] font-semibold">{t("Investition der Kostenstelle")}</h3>
        <p className="caption mt-0.5 mb-2 text-[10.5px] text-nx-text-muted">
          {t("Bauabschnitte entschieden am 04.08.2026 und am Mengenhochlauf bemessen: Hülle und Schüttlager 2029, Curing 2031, Kühllager 2032, Packhaus 2033/34. Das ist eine Reihenfolge, kein Bauzeitenplan — Genehmigung, Ausschreibung und Bauzeit können sie verschieben, und mit ihnen den Revolverbedarf. FK-Quote, Zins und Laufzeit stehen in der Finanzierung.")}
        </p>
      </div>
      <CapexPositionen blocks={["lager", "packhaus"]} />
    </div>
  );
}

function Kpi({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="px-4 py-3" style={{ background: "var(--nx-surface)" }}>
      <div className="caption text-[10px] text-nx-text-muted">{label}</div>
      <div className="num mt-0.5 text-[16px] font-semibold" style={{ color: warn ? "var(--nx-warn, #C9A227)" : "var(--nx-text)" }}>{value}</div>
      {hint && <div className="caption mt-0.5 text-[10px] text-nx-text-muted">{hint}</div>}
    </div>
  );
}

function Row({ label, v, currency, bold, top }: { label: string; v: number; currency: "EUR" | "RON"; bold?: boolean; top?: boolean }) {
  return (
    <tr style={top ? { borderTop: "1px solid var(--nx-border)" } : undefined}>
      <td className={`px-4 py-1.5 ${bold ? "font-semibold" : ""}`}>{label}</td>
      <td className={`px-4 py-1.5 num text-right ${bold ? "font-semibold" : ""}`}
        style={{ color: v < 0 && bold ? "var(--nx-error)" : undefined }}>{fmtMoney(v, currency)}</td>
    </tr>
  );
}
