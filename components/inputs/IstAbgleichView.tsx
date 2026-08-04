"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import {
  deriveIstAbgleich, schlaegeOf, flaechenMemo, sortenVerteilung, CROP_NAME, START_YEAR,
  type IstAbgleichRow,
} from "../../store/model";
import { fmtMoney, fmtNumber } from "../../design/format";

/** Kulturname zu einer id, die zur Laufzeit auch unbekannt sein darf —
 *  `CROP_NAME` ist auf `CropId` getippt, `IstAbgleichRow.cropId` ist es nicht
 *  (eine Ist-Maßnahme ohne Plan kann jede Kultur nennen). */
const kultur = (id: string) => (CROP_NAME as Record<string, string>)[id] ?? id;
import { t } from "../../lib/i18n";
import { JahrWahl } from "./JahrWahl";
import { Segmented } from "../primitives/Segmented";
import {
  AnsichtKopf, Kennzahl, Leer, TextFeld, Auswahl, Aktion, TH, TH_STYLE, TD, TD_STYLE,
} from "../primitives/Control";
import { GitCompare, MapPin, CircleAlert, CircleCheck, TriangleAlert, Download, Layers } from "lucide-react";

/**
 * PLAN ↔ IST — was geplant war und was zurückgemeldet wurde.
 *
 * DIE ZAHL, DIE ZÄHLT, IST NICHT DER HEKTAR. „450 von 500 ha gespritzt“ klingt
 * nach 90 % und verdeckt, dass drei Schläge komplett ausgelassen wurden. Deshalb
 * wertet `deriveIstAbgleich` gegen die ZIELE der Maßnahme aus — Felder bei
 * Bodenbearbeitung, Düngung, Pflanzenschutz und Bewässerung, Schläge bei Aussaat,
 * Ernte, Transport, Material und Handarbeit. Die Leitgröße dieser Ansicht ist
 * „Flächen ohne Rückmeldung“, nicht „fehlende Hektar“.
 *
 * DIE ZWEITE ZEILE IST DIE INTERESSANTERE. Eine ausgeführte Maßnahme, die im Plan
 * nicht vorkommt, zeigt, was der Plan nicht weiß. Sie steht deshalb nicht am Ende
 * der Liste, sondern trägt eine eigene Kennzeichnung.
 *
 * WO DIE DATEN HERKOMMEN. Ist-Maßnahmen entstehen in NEOS Farm und kommen über den
 * FMS-Import — nicht über Handeingabe hier. NEOS Farm steht zum 04.08.2026 noch
 * nicht; bis dahin ist diese Ansicht leer, und das ist der ehrliche Zustand. Was
 * sie heute schon leistet: sie zeigt die Zielmenge. 988 Arbeitsaufträge im Jahr
 * 2032 sind die Zahl, gegen die zurückgemeldet werden muss.
 */

type Sicht = "massnahmen" | "flaechen";
type Filter = "alle" | "offen" | "ungeplant" | "erledigt";

export function IstAbgleichView() {
  const domain = useModelStore((s) => s.domain);
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);
  const jahre = Math.max(1, domain.growth?.years ?? 1);

  const [jy, setJy] = React.useState(0);
  const [sicht, setSicht] = React.useState<Sicht>("massnahmen");
  const [filter, setFilter] = React.useState<Filter>("alle");
  const [crop, setCrop] = React.useState("alle");
  const [suche, setSuche] = React.useState("");

  const alle = React.useMemo(
    () => deriveIstAbgleich(domain, sc, jy),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [domain, sc, jy, tick],
  );

  const kulturen = React.useMemo(
    () => ["alle", ...[...new Set(alle.map((r) => r.cropId))].sort()],
    [alle],
  );

  const zustand = (r: IstAbgleichRow): Filter =>
    r.ungeplant ? "ungeplant" : r.offeneZiele > 0 ? "offen" : "erledigt";

  const zaehler = React.useMemo(() => ({
    offen: alle.filter((r) => zustand(r) === "offen").length,
    ungeplant: alle.filter((r) => r.ungeplant).length,
    erledigt: alle.filter((r) => zustand(r) === "erledigt").length,
  }), [alle]);

  const zeilen = React.useMemo(() => {
    const q = suche.trim().toLowerCase();
    return alle.filter((r) =>
      (filter === "alle" || zustand(r) === filter)
      && (crop === "alle" || r.cropId === crop)
      && (!q || r.massnahme.toLowerCase().includes(q) || r.measureId.toLowerCase().includes(q)));
  }, [alle, filter, crop, suche]);

  /* Rückmeldegrad über die ZIELE, nicht über die Hektar — siehe Kopfkommentar. */
  const zieleGesamt = React.useMemo(() => {
    let n = 0;
    for (const cropId of [...new Set(domain.anbauplan.map((a) => a.cropId))]) {
      const s = schlaegeOf(domain, cropId, jy);
      const felder = new Set(s.map((x) => x.feldId)).size;
      for (const r of alle.filter((x) => x.cropId === cropId && !x.ungeplant)) {
        n += r.bezug === "feld" ? felder : s.length;
      }
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alle, domain, jy]);
  const offeneZiele = alle.reduce((s, r) => s + r.offeneZiele, 0);
  const rueckPct = zieleGesamt > 0 ? ((zieleGesamt - offeneZiele) / zieleGesamt) * 100 : 0;

  /* Die Flächensicht: Schläge des Jahres mit Sorte. Sie beantwortet die Frage,
   *  die vor jeder Rückmeldung steht — WO wird eigentlich gearbeitet. */
  const flaechen = React.useMemo(() => {
    const bild = flaechenMemo(domain);
    const jahrSchlaege = bild.schlaege.filter((s) => s.jahr === jy)
      .filter((s) => crop === "alle" || s.cropId === crop)
      .filter((s) => {
        const q = suche.trim().toLowerCase();
        return !q || s.feldId.toLowerCase().includes(q) || (s.sorte ?? "").toLowerCase().includes(q)
          || (kultur(s.cropId)).toLowerCase().includes(q);
      })
      .sort((a, b) => a.feldId.localeCompare(b.feldId));
    return {
      schlaege: jahrSchlaege,
      felder: bild.felder.length,
      beregnung: bild.beregnungseinheiten.length,
      verstoesse: bild.verstoesse.filter((v) => v.jahr === jy).length,
      sorten: [...new Set(domain.anbauplan.map((a) => a.cropId))]
        .flatMap((c) => sortenVerteilung(domain, c, jy).map((v) => ({ ...v, cropId: c })))
        .filter((v) => crop === "alle" || v.cropId === crop),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, jy, crop, suche, tick]);

  const csv = () => {
    const kopf = ["measureId", "kultur", "massnahme", "fachbereich", "bezug", "planUeberfahrten",
      "planFlaecheHa", "planKostenEur", "istAnzahl", "istFlaecheHa", "istKostenEur", "offeneZiele", "ungeplant"];
    const zeile = (r: IstAbgleichRow) => [r.measureId, kultur(r.cropId), r.massnahme,
      r.fachbereich ?? "", r.bezug, r.planUeberfahrten, r.planFlaecheHa, (r.planKostenCent / 100).toFixed(2),
      r.istAnzahl, r.istFlaecheHa, (r.istKostenCent / 100).toFixed(2), r.offeneZiele, r.ungeplant ? "ja" : "nein"]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";");
    const blob = new Blob(["﻿" + [kopf.join(";"), ...zeilen.map(zeile)].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `neosfx-plan-ist-${START_YEAR + jy}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const keineRueckmeldung = alle.every((r) => r.istAnzahl === 0);

  return (
    <div className="space-y-3">
      <AnsichtKopf
        titel={t("Plan ↔ Ist")}
        satz={t("Je Maßnahme: was geplant war, was zurückgemeldet wurde, und wie viele Flächen gar keine Rückmeldung tragen. Gezählt werden Ziele — Felder oder Schläge —, nicht Hektar: „450 von 500 ha“ verdeckt drei ausgelassene Schläge.")}
        rechts={
          <>
            <JahrWahl jahre={jahre} wert={jy} onChange={setJy} />
            <TextFeld wert={suche} onChange={setSuche} platzhalter={t("Maßnahme, Feld, Sorte …")} breite={210} />
            <Auswahl wert={crop} onChange={setCrop} breite={180} ariaLabel={t("Kultur")}
              optionen={kulturen.map((c) => ({ wert: c, label: c === "alle" ? t("alle Kulturen") : (kultur(c)) }))} />
            <Aktion kind="haupt" Icon={Download} onClick={csv}>{t("Abgleich exportieren")}</Aktion>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kennzahl label={t("Rückmeldegrad")} wert={`${fmtNumber(rueckPct, 0)} %`} Icon={GitCompare}
          ton={rueckPct >= 95 ? "gut" : "warn"}
          zusatz={`${zieleGesamt - offeneZiele} ${t("von")} ${zieleGesamt} ${t("Zielen")}`} />
        <Kennzahl label={t("Flächen ohne Rückmeldung")} wert={fmtNumber(offeneZiele, 0)} Icon={CircleAlert}
          ton={offeneZiele > 0 ? "warn" : "gut"}
          zusatz={`${zaehler.offen} ${t("Maßnahmen betroffen")}`} />
        <Kennzahl label={t("ausgeführt ohne Plan")} wert={String(zaehler.ungeplant)} Icon={TriangleAlert}
          ton={zaehler.ungeplant > 0 ? "warn" : "neutral"}
          zusatz={t("zeigt, was der Plan nicht weiß")} />
        <Kennzahl label={t("Arbeitsaufträge im Jahr")} wert={fmtNumber(zieleGesamt, 0)} Icon={Layers}
          zusatz={`${flaechen.schlaege.length} ${t("Schläge")} · ${flaechen.felder} ${t("Felder")}`} />
      </div>

      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
          <Segmented<Sicht> ariaLabel={t("Sicht")} value={sicht} onChange={setSicht}
            options={[
              { value: "massnahmen", label: t("Maßnahmen"), count: alle.length },
              { value: "flaechen", label: t("Flächen & Sorten"), count: flaechen.schlaege.length },
            ]} />
          {sicht === "massnahmen" && (
            <Segmented<Filter> ariaLabel={t("Zustand")} value={filter} onChange={setFilter}
              options={[
                { value: "offen", label: t("offen"), count: zaehler.offen, tone: "warning" },
                { value: "ungeplant", label: t("ohne Plan"), count: zaehler.ungeplant, tone: "warning" },
                { value: "erledigt", label: t("erledigt"), count: zaehler.erledigt },
                { value: "alle", label: t("alle"), count: alle.length, divider: true },
              ]} />
          )}
          <span className="num ml-auto text-[11px] text-nx-text-muted">
            {sicht === "massnahmen" ? `${zeilen.length} ${t("Zeilen")}` : `${flaechen.beregnung} ${t("Beregnungseinheiten")}`}
          </span>
        </div>

        {keineRueckmeldung && sicht === "massnahmen" && (
          <div className="flex items-start gap-2 border-b px-3 py-2.5 text-[11.5px] leading-relaxed"
               style={{ borderColor: "var(--nx-border)", background: "var(--nx-warning-bg)", color: "var(--nx-warning-text)" }}>
            <CircleAlert size={15} strokeWidth={2.3} aria-hidden className="mt-[1px] shrink-0" />
            <span>
              <b>{t("Noch keine Ist-Maßnahme zurückgemeldet.")}</b>{" "}
              {t("Ist-Maßnahmen entstehen in NEOS Farm und kommen über den FMS-Import; NEOS Farm steht zum Stand dieses Modells noch nicht. Was diese Ansicht heute leistet, ist die Zielmenge: die Spalte „offen“ zeigt, gegen wie viele Flächen zurückgemeldet werden muss.")}
            </span>
          </div>
        )}

        {sicht === "massnahmen" ? (
          zeilen.length === 0 ? (
            <div className="p-3">
              <Leer Icon={GitCompare} titel={t("Nichts in dieser Auswahl")}
                satz={t("Keine Maßnahme trägt diesen Zustand — oder Suche und Kultur schließen alles aus.")} />
            </div>
          ) : (
            <div className="max-h-[calc(100vh-380px)] overflow-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={TH} style={{ ...TH_STYLE, minWidth: 260 }}>{t("Maßnahme")}</th>
                    <th className={TH} style={TH_STYLE}>{t("Kultur")}</th>
                    <th className={TH} style={TH_STYLE}>{t("Bezug")}</th>
                    <th className={TH + " text-right"} style={TH_STYLE}>{t("Plan ha")}</th>
                    <th className={TH + " text-right"} style={TH_STYLE}>{t("Ist ha")}</th>
                    <th className={TH + " text-right"} style={TH_STYLE}>{t("Plan €")}</th>
                    <th className={TH + " text-right"} style={TH_STYLE}>{t("Ist €")}</th>
                    <th className={TH + " text-right"} style={TH_STYLE}>{t("Rückmeldungen")}</th>
                    <th className={TH + " text-right"} style={TH_STYLE}>{t("offen")}</th>
                  </tr>
                </thead>
                <tbody>
                  {zeilen.map((r) => (
                    <tr key={r.measureId} className="hover:brightness-[1.03]">
                      <td className={TD} style={TD_STYLE}>
                        <div className="flex items-center gap-1.5">
                          {r.ungeplant && (
                            <span className="inline-flex items-center gap-1 rounded-pill px-1.5 py-[1px] text-[9px] font-bold"
                              style={{ background: "var(--nx-warning-bg)", color: "var(--nx-warning-text)" }}>
                              <TriangleAlert size={9} strokeWidth={2.6} aria-hidden />{t("ohne Plan")}
                            </span>
                          )}
                          <span className="font-medium text-nx-text">{r.massnahme}</span>
                        </div>
                        <div className="num text-[9.5px] text-nx-text-muted">{r.measureId}</div>
                      </td>
                      <td className={TD + " text-nx-text-secondary"} style={TD_STYLE}>{kultur(r.cropId)}</td>
                      <td className={TD} style={TD_STYLE}>
                        <span className="inline-flex items-center gap-1 text-[10.5px] text-nx-text-secondary">
                          <MapPin size={11} strokeWidth={2.3} aria-hidden />
                          {r.bezug === "feld" ? t("Feld") : t("Schlag")}
                        </span>
                      </td>
                      <td className={TD + " num text-right"} style={TD_STYLE}>{fmtNumber(r.planFlaecheHa, 1)}</td>
                      <td className={TD + " num text-right"} style={TD_STYLE}>
                        {r.istAnzahl ? fmtNumber(r.istFlaecheHa, 1) : <span className="text-nx-text-muted">—</span>}
                      </td>
                      <td className={TD + " num text-right text-nx-text-secondary"} style={TD_STYLE}>{fmtMoney(r.planKostenCent)}</td>
                      <td className={TD + " num text-right text-nx-text-secondary"} style={TD_STYLE}>
                        {r.istAnzahl ? fmtMoney(r.istKostenCent) : <span className="text-nx-text-muted">—</span>}
                      </td>
                      <td className={TD + " num text-right text-nx-text-muted"} style={TD_STYLE}>{r.istAnzahl || "—"}</td>
                      <td className={TD + " num text-right font-semibold"} style={TD_STYLE}>
                        {r.ungeplant ? <span className="font-normal text-nx-text-muted">—</span>
                          : r.offeneZiele === 0
                            ? <span className="inline-flex items-center gap-1" style={{ color: "var(--nx-success)" }}>
                                <CircleCheck size={12} strokeWidth={2.5} aria-hidden />0</span>
                            : <span style={{ color: "var(--nx-warning-text)" }}>{r.offeneZiele}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="space-y-3 p-3">
            {flaechen.verstoesse > 0 && (
              <div className="flex items-start gap-2 rounded-tile px-3 py-2 text-[11.5px]"
                   style={{ background: "var(--nx-error-bg)", color: "var(--nx-error)" }}>
                <TriangleAlert size={15} strokeWidth={2.3} aria-hidden className="mt-[1px] shrink-0" />
                <span>{flaechen.verstoesse} {t("Verstöße gegen die Anbaupause in diesem Jahr — die Zuteilung konnte sie nicht auflösen. Das heißt: die Fruchtfolge ist nicht nur rechnerisch, sondern tatsächlich zu eng.")}</span>
              </div>
            )}

            {flaechen.sorten.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold text-nx-text">{t("Sortenanteile — Soll gegen zugeteilt")}</div>
                <div className="overflow-x-auto rounded-tile border" style={{ borderColor: "var(--nx-border)" }}>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th className={TH} style={TH_STYLE}>{t("Kultur")}</th>
                        <th className={TH} style={TH_STYLE}>{t("Sorte")}</th>
                        <th className={TH} style={TH_STYLE}>{t("Rolle")}</th>
                        <th className={TH + " text-right"} style={TH_STYLE}>{t("Soll")}</th>
                        <th className={TH + " text-right"} style={TH_STYLE}>{t("zugeteilt")}</th>
                        <th className={TH + " text-right"} style={TH_STYLE}>{t("ha")}</th>
                        <th className={TH + " text-right"} style={TH_STYLE}>{t("Schläge")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flaechen.sorten.map((v) => (
                        <tr key={`${v.cropId}-${v.sorte}`}>
                          <td className={TD + " text-nx-text-secondary"} style={TD_STYLE}>{kultur(v.cropId)}</td>
                          <td className={TD + " font-medium"} style={TD_STYLE}>{v.sorte}</td>
                          <td className={TD + " text-[10.5px] text-nx-text-muted"} style={TD_STYLE}>{v.rolle ?? "—"}</td>
                          <td className={TD + " num text-right text-nx-text-secondary"} style={TD_STYLE}>{fmtNumber(v.sollPct, 1)} %</td>
                          <td className={TD + " num text-right font-semibold"} style={TD_STYLE}>{fmtNumber(v.istPct, 1)} %</td>
                          <td className={TD + " num text-right"} style={TD_STYLE}>{fmtNumber(v.istHa, 1)}</td>
                          <td className={TD + " num text-right text-nx-text-muted"} style={TD_STYLE}>{v.schlaege}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-[10.5px] text-nx-text-muted">
                  {t("Soll und zugeteilt weichen voneinander ab, weil ganze Felder verteilt werden. Die Anteile selbst stehen in der Anbauplanung.")}
                </p>
              </div>
            )}

            <div>
              <div className="mb-1.5 text-[11px] font-semibold text-nx-text">
                {t("Schläge")} {START_YEAR + jy} — {t("die Flächen hinter den Arbeitsaufträgen")}
              </div>
              <div className="max-h-[420px] overflow-auto rounded-tile border" style={{ borderColor: "var(--nx-border)" }}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={TH} style={TH_STYLE}>{t("Schlag")}</th>
                      <th className={TH} style={TH_STYLE}>{t("Feld")}</th>
                      <th className={TH} style={TH_STYLE}>{t("Kultur")}</th>
                      <th className={TH} style={TH_STYLE}>{t("Sorte")}</th>
                      <th className={TH + " text-right"} style={TH_STYLE}>{t("ha")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flaechen.schlaege.map((s) => (
                      <tr key={s.id}>
                        <td className={TD + " num text-[10.5px] text-nx-text-muted"} style={TD_STYLE}>{s.id}</td>
                        <td className={TD + " num font-medium"} style={TD_STYLE}>{s.feldId}</td>
                        <td className={TD + " text-nx-text-secondary"} style={TD_STYLE}>{kultur(s.cropId)}</td>
                        <td className={TD} style={TD_STYLE}>{s.sorte ?? <span className="text-nx-text-muted">{t("ohne Sorte")}</span>}</td>
                        <td className={TD + " num text-right"} style={TD_STYLE}>{fmtNumber(s.areaHa, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <div className="border-t px-3 py-2 text-[10.5px] leading-relaxed text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Bodenbearbeitung, Düngung, Pflanzenschutz und Bewässerung melden auf das FELD zurück — eine Überfahrt erledigt beide Sorten. Aussaat, Ernte, Transport, Material und Handarbeit melden auf den SCHLAG, weil der Termin sortenabhängig ist. Wer die Ernte aufs Feld bucht, verliert die Sortentrennung; wer die Spritzung auf den Schlag bucht, zählt die Überfahrt doppelt.")}
        </div>
      </section>
    </div>
  );
}
