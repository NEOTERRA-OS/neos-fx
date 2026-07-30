"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { resolveScalar } from "../../store/model";
import { NumberInput, TextInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t, getLang } from "../../lib/i18n";
import { AlertTriangle, Plus, X } from "lucide-react";
import type { OfftakeContract } from "../../core/types";

/** Abnahmeverträge (Off-take) — kontraktspezifischer Preis statt Punktwert.
 *
 *  Rechenlogik (identisch zur Engine, computeOperating):
 *   · Je Kultur und Jahr wird die Erntemenge auf die aktiven Verträge aufgeteilt.
 *   · Feste Tonnage → Anteil = Kontraktmenge / Erntemenge (auf 100 % gedeckelt).
 *   · Restmenge geht zum Kulturpreis aus den Annahmen weg (Spot).
 *   · Ohne Vertrag rechnet das Modell unverändert mit dem Kulturpreis.
 *
 *  Indexierung: Die vorliegenden Verträge sind JAHRESverträge. Im Mehrjahresplan wird
 *  jedes Jahr neu kontrahiert, deshalb wachsen die Kontraktpreise ab Jahr 2 mit derselben
 *  Output-Inflation wie der Spotpreis (Annahme `infl.output`, Makro & Finanzen). Der hier
 *  gezeigte Preis ist der Preis des ERSTEN Planjahrs — der unterschriebene Vertragspreis. */

const STORAGE_LABEL: Record<string, string> = {
  none: "kein Lager",
  atCost: "auf eigene Kosten, ohne Prämie",
  bonus: "Lagerbonus",
};

export function AbnahmevertraegeView() {
  const { domain, patch } = useModelStore();
  const sc = useModelStore((s) => s.view.scenarioId);
  const currency = useModelStore((s) => s.view.currency);
  const readOnly = useModelStore((s) => s.readOnly);
  const contracts = domain.offtake ?? [];
  /** Indexierungssatz der Kontraktpreise = Output-Inflation (identisch zum Spotpreis). */
  const inflOut = resolveScalar(domain, "infl.output", sc);

  const cropName = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of domain.catalog) m[c.cropId] = c.name;
    return m;
  }, [domain.catalog]);

  /** Netto-Erntemenge je Kultur im ERSTEN Planjahr (t) — Basis der Anteilsrechnung. */
  const tonnesByCrop = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const a of domain.anbauplan) {
      const cat = domain.catalog.find((c) => c.cropId === a.cropId);
      if (!cat) continue;
      const yld = resolveScalar(domain, cat.yieldKey, sc);
      const loss = resolveScalar(domain, cat.lossKey, sc) || 0;
      m.set(a.cropId, (m.get(a.cropId) ?? 0) + a.areaHa * yld * (1 - loss));
    }
    return m;
  }, [domain, sc]);

  /** Vertragsmix je Kultur — exakt die Formel aus der Engine. */
  const mix = React.useMemo(() => {
    const out = new Map<string, {
      total: number; share: number; price: number; blended: number; spot: number;
      dso: number; contracted: number; list: OfftakeContract[];
    }>();
    const byCrop = new Map<string, OfftakeContract[]>();
    for (const c of contracts) {
      if (!c.active) continue;
      const l = byCrop.get(c.cropId);
      if (l) l.push(c); else byCrop.set(c.cropId, [c]);
    }
    for (const [cropId, list] of byCrop) {
      const cat = domain.catalog.find((k) => k.cropId === cropId);
      const spot = cat ? resolveScalar(domain, cat.priceKey, sc) : 0;
      const total = tonnesByCrop.get(cropId) ?? 0;
      let share = 0, valued = 0, dsoW = 0;
      for (const c of list) {
        const s = c.volumeMode === "tonnes"
          ? (total > 0 ? Math.min(1, (c.tonnesPerYear ?? 0) / total) : 0)
          : Math.max(0, Math.min(1, c.share ?? 0));
        if (s <= 0) continue;
        const eff = (c.priceCentPerTonne + (c.bonusCentPerTonne ?? 0)) * (1 - (c.rejectRate ?? 0));
        share += s; valued += s * eff; dsoW += s * c.dsoDays;
      }
      if (share > 1) { valued /= share; dsoW /= share; share = 1; }
      const price = share > 0 ? valued / share : 0;
      // Restmenge wird spot bezahlt; das Zahlungsziel der Restmenge kommt aus der WC-Politik.
      const spotDso = domain.workingCapital?.dsoAssumptionKey
        ? resolveScalar(domain, domain.workingCapital.dsoAssumptionKey, sc)
        : 0;
      out.set(cropId, {
        total, share, price, spot,
        blended: share > 0 ? share * price + (1 - share) * spot : spot,
        dso: share > 0 ? dsoW + (1 - share) * spotDso : spotDso,
        contracted: total * share,
        list,
      });
    }
    return out;
  }, [contracts, domain, sc, tonnesByCrop]);

  const upd = (id: string, fn: (c: OfftakeContract) => void) => patch((d) => {
    const c = (d.offtake ?? []).find((x) => x.id === id);
    if (c) fn(c);
  });
  const del = (id: string) => patch((d) => { d.offtake = (d.offtake ?? []).filter((c) => c.id !== id); });
  const add = () => patch((d) => {
    if (!d.offtake) d.offtake = [];
    let n = 1; while (d.offtake.some((c) => c.id === `ot-neu-${n}`)) n++;
    d.offtake.push({
      id: `ot-neu-${n}`, buyer: getLang() === "en" ? "New buyer" : "Neuer Abnehmer",
      cropId: d.catalog[0]?.cropId ?? "", active: true, volumeMode: "tonnes", tonnesPerYear: 0,
      priceCentPerTonne: 0, priceConfirmed: false, bonusCentPerTonne: 0, dsoDays: 30,
      rejectRate: 0, storage: "none",
    });
  });

  const unconfirmed = contracts.filter((c) => c.active && !c.priceConfirmed);
  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted text-left";
  const sel = "rounded-control border px-1 text-[11.5px]";
  const selStyle = { height: 32, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" };

  return (
    <div className="space-y-4">
      {/* --- Kopf ---------------------------------------------------------- */}
      <div className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Abnahmeverträge (Off-taker)")}</h2>
          <button className="inline-flex items-center gap-1 rounded-control border px-2.5 py-1 text-[11.5px]" disabled={readOnly}
            style={{ borderColor: "var(--nx-border)", opacity: readOnly ? 0.5 : 1 }} onClick={add}>
            <Plus size={13} aria-hidden /> {t("Vertrag hinzufügen")}
          </button>
        </div>
        <div className="px-4 py-2 text-[12px] text-nx-text-secondary">
          {t("Je Kultur wird die Erntemenge auf die aktiven Verträge aufgeteilt; die Restmenge geht zum Kulturpreis aus den Annahmen weg (Spot). Ohne Vertrag rechnet das Modell unverändert mit dem Kulturpreis. Die unten gepflegten Preise sind die des ")}<b>{t("ersten Planjahrs")}</b>{t(" — der unterschriebene Vertragspreis.")}
        </div>
        <div className="px-4 pb-2 text-[12px] text-nx-text-secondary">
          {t("Indexierung: Es sind Jahresverträge — im Mehrjahresplan wird jedes Jahr neu kontrahiert. Die Kontraktpreise wachsen deshalb ab Jahr 2 mit ")}
          <b>{fmtNumber(inflOut * 100, 1)} %{t(" p. a. (Output-Inflation)")}</b>
          {t(", also mit demselben Satz wie der Spotpreis. Der Abstand Mischpreis ↔ Spot bleibt damit über den Horizont proportional. Satz änderbar unter Makro & Finanzen (infl.output) bzw. im Szenario-Studio.")}
        </div>
        {unconfirmed.length > 0 && (
          <div className="mx-4 mb-3 flex items-start gap-2 rounded-control border px-3 py-2 text-[11.5px]"
            style={{ borderColor: "var(--nx-warn, #C9A227)", background: "color-mix(in srgb, var(--nx-warn, #C9A227) 12%, transparent)", color: "var(--nx-warn, #C9A227)" }}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              <b>{t("Platzhalterpreis")}</b>{t(": ")}
              {unconfirmed.map((c) => c.buyer).join(", ")}
              {t(" — der Basispreis ist im Vertrag nicht befüllt. Der angesetzte Wert ist eine Annahme und muss nachgefordert werden.")}
            </span>
          </div>
        )}
      </div>

      {/* --- Mischpreis je Kultur ------------------------------------------ */}
      {mix.size > 0 && (
        <div className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
            <h3 className="text-[13px] font-semibold">{t("Mischpreis & Zahlungsziel je Kultur")}</h3>
            <p className="caption mt-0.5 text-[10.5px] text-nx-text-muted">{t("Erntemenge des ersten Planjahrs im aktuellen Szenario.")}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="border-b" style={{ borderColor: "var(--nx-border)" }}>
                <th className={th}>{t("Kultur")}</th>
                <th className={th}>{t("Erntemenge")}</th>
                <th className={th}>{t("kontrahiert")}</th>
                <th className={th}>{t("Kontraktpreis Ø")}</th>
                <th className={th}>{t("Spotpreis")}</th>
                <th className={th}>{t("Mischpreis")}</th>
                <th className={th}>{t("Δ vs. Spot")}</th>
                <th className={th}>{t("Zahlungsziel Ø")}</th>
              </tr></thead>
              <tbody>
                {Array.from(mix.entries()).map(([cropId, m]) => {
                  const d = m.blended - m.spot;
                  return (
                    <tr key={cropId} className="border-b" style={{ borderColor: "var(--nx-border)" }}>
                      <td className="px-2 py-1.5 font-medium">{cropName[cropId] ?? cropId}</td>
                      <td className="px-2 py-1.5 num">{fmtNumber(m.total, 0)} t</td>
                      <td className="px-2 py-1.5 num">{fmtNumber(m.contracted, 0)} t · {fmtNumber(m.share * 100, 1)} %</td>
                      <td className="px-2 py-1.5 num">{fmtMoney(m.price, currency)}</td>
                      <td className="px-2 py-1.5 num">{fmtMoney(m.spot, currency)}</td>
                      <td className="px-2 py-1.5 num font-semibold">{fmtMoney(m.blended, currency)}</td>
                      <td className="px-2 py-1.5 num" style={{ color: Math.abs(d) < 1 ? "var(--nx-text-muted)" : d > 0 ? "var(--nx-success)" : "var(--nx-error)" }}>
                        {Math.abs(d) < 1 ? "—" : (d > 0 ? "+" : "−") + fmtMoney(Math.abs(d), currency)}
                      </td>
                      <td className="px-2 py-1.5 num">{fmtNumber(m.dso, 0)} {t("Tage")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- Verträge ------------------------------------------------------ */}
      <div className="space-y-3">
        {contracts.length === 0 && (
          <div className="rounded-tile border px-4 py-6 text-center text-[12px] text-nx-text-muted"
            style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
            {t("Keine Abnahmeverträge hinterlegt — der Umsatz rechnet vollständig mit dem Kulturpreis.")}
          </div>
        )}
        {contracts.map((c) => {
          const m = mix.get(c.cropId);
          const shareOf = c.volumeMode === "tonnes"
            ? (m && m.total > 0 ? Math.min(1, (c.tonnesPerYear ?? 0) / m.total) : 0)
            : Math.max(0, Math.min(1, c.share ?? 0));
          const eff = (c.priceCentPerTonne + (c.bonusCentPerTonne ?? 0)) * (1 - (c.rejectRate ?? 0));
          return (
            <div key={c.id} className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)", opacity: c.active ? 1 : 0.6 }}>
              <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
                <input type="checkbox" checked={c.active} disabled={readOnly} onChange={(e) => upd(c.id, (x) => { x.active = e.target.checked; })} />
                <TextInput value={c.buyer} width={230} onCommit={(v) => upd(c.id, (x) => { x.buyer = v; })} />
                <select className={sel} style={selStyle} value={c.cropId} disabled={readOnly}
                  onChange={(e) => upd(c.id, (x) => { x.cropId = e.target.value; })}>
                  {domain.catalog.map((k) => <option key={k.cropId} value={k.cropId}>{k.name}</option>)}
                </select>
                {!c.priceConfirmed && (
                  <span className="inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-[10.5px] font-semibold"
                    style={{ background: "color-mix(in srgb, var(--nx-warn, #C9A227) 18%, transparent)", color: "var(--nx-warn, #C9A227)" }}>
                    <AlertTriangle size={11} aria-hidden /> {t("Platzhalterpreis")}
                  </span>
                )}
                <span className="ml-auto caption text-[10.5px] text-nx-text-muted">
                  {fmtNumber(shareOf * 100, 1)} % {t("der Erntemenge")} · {t("realisiert")} {fmtMoney(eff, currency)}/t
                </span>
                <button className="rounded-control border p-1" disabled={readOnly} title={t("Vertrag löschen")}
                  style={{ borderColor: "var(--nx-border)", opacity: readOnly ? 0.4 : 1 }} onClick={() => del(c.id)}>
                  <X size={13} aria-hidden />
                </button>
              </div>

              <div className="flex flex-wrap items-end gap-x-5 gap-y-3 px-4 py-3">
                <Field label={t("Mengenbindung")}>
                  <select className={sel} style={selStyle} value={c.volumeMode} disabled={readOnly}
                    onChange={(e) => upd(c.id, (x) => { x.volumeMode = e.target.value as "tonnes" | "share"; })}>
                    <option value="tonnes">{t("feste Tonnage")}</option>
                    <option value="share">{t("Anteil der Ernte")}</option>
                  </select>
                </Field>
                {c.volumeMode === "tonnes" ? (
                  <Field label={t("Kontraktmenge")}>
                    <NumberInput value={c.tonnesPerYear ?? 0} width={90} suffix={t("t/Jahr")}
                      onCommit={(v) => upd(c.id, (x) => { x.tonnesPerYear = v; })} />
                  </Field>
                ) : (
                  <Field label={t("Anteil")}>
                    <NumberInput value={(c.share ?? 0) * 100} width={70} suffix="%"
                      onCommit={(v) => upd(c.id, (x) => { x.share = v / 100; })} />
                  </Field>
                )}
                <Field label={t("Basispreis")}>
                  <NumberInput value={c.priceCentPerTonne} moneyCent width={90} suffix="€/t"
                    onCommit={(v) => upd(c.id, (x) => { x.priceCentPerTonne = v; })} />
                </Field>
                <Field label={t("Bonus/Malus")}>
                  <NumberInput value={c.bonusCentPerTonne ?? 0} moneyCent width={80} suffix="€/t"
                    onCommit={(v) => upd(c.id, (x) => { x.bonusCentPerTonne = v; })} />
                </Field>
                <Field label={t("Zahlungsziel")}>
                  <NumberInput value={c.dsoDays} width={70} suffix={t("Tage")}
                    onCommit={(v) => upd(c.id, (x) => { x.dsoDays = v; })} />
                </Field>
                <Field label={t("Zurückweisung")}>
                  <NumberInput value={(c.rejectRate ?? 0) * 100} width={70} suffix="%"
                    onCommit={(v) => upd(c.id, (x) => { x.rejectRate = v / 100; })} />
                </Field>
                <Field label={t("Lagerung")}>
                  <select className={sel} style={selStyle} value={c.storage ?? "none"} disabled={readOnly}
                    onChange={(e) => upd(c.id, (x) => { x.storage = e.target.value as "none" | "atCost" | "bonus"; })}>
                    {Object.entries(STORAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
                  </select>
                </Field>
                <Field label={t("Preis bestätigt")}>
                  <label className="inline-flex h-[34px] items-center gap-1.5 text-[12px]">
                    <input type="checkbox" checked={c.priceConfirmed} disabled={readOnly}
                      onChange={(e) => upd(c.id, (x) => { x.priceConfirmed = e.target.checked; })} />
                    {c.priceConfirmed ? t("ja") : t("Platzhalter")}
                  </label>
                </Field>
              </div>

              {(c.note || c.coverPurchase || c.assignable === false) && (
                <div className="border-t px-4 py-2 text-[11.5px] text-nx-text-secondary" style={{ borderColor: "var(--nx-border)" }}>
                  {c.coverPurchase && <b>{t("Deckungskauf zulasten NEOTERRA. ")}</b>}
                  {c.assignable === false && <b>{t("Forderung nicht abtretbar (kein Factoring). ")}</b>}
                  {c.note}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="caption text-[10px] text-nx-text-muted">{label}</span>
      {children}
    </label>
  );
}
