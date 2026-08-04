"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { deriveWiedervorlage, IST_TOLERANZ, type WiedervorlageRow } from "../../store/model";
import { fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import { Segmented } from "../primitives/Segmented";
import {
  AnsichtKopf, Kennzahl, Leer, TextFeld, Auswahl, Aktion, TH, TH_STYLE, TD, TD_STYLE,
} from "../primitives/Control";
import { ClipboardCheck, CircleAlert, CircleCheck, CircleHelp, TriangleAlert, Download } from "lucide-react";

/**
 * WIEDERVORLAGE — die Liste, die die Annahmen abarbeitet.
 *
 * Von den 244 Ertragswirkungsfaktoren tragen 165 den Belegstatus ANNAHME: zwei
 * Drittel des Modells sind gesetzt, nicht gemessen. Das ist für einen Plan völlig
 * in Ordnung — nicht in Ordnung ist, dass man es dem Modell bisher nicht ansehen
 * konnte. `deriveWiedervorlage` rechnet die Liste seit dem 03.08.2026; sie hatte
 * nur keinen Ort, an dem sie erscheint. Das ist dieser.
 *
 * VIER HANDLUNGEN, und die Reihenfolge ist die Aussage:
 *
 *   belegen      ungeprüft und ungemessen. Die eigentliche Wiedervorlage.
 *   Abweichung   gemessen, und die Messung liegt mehr als 10 % neben dem Plan.
 *                Das ist der teuerste Zustand: der Plan rechnet weiter mit einer
 *                Zahl, von der jemand schon weiß, dass sie nicht stimmt.
 *   prüfen       als geprüft markiert, aber ohne Messung dahinter.
 *   bestätigt    gemessen und innerhalb der Toleranz.
 *
 * Was diese Ansicht ausdrücklich NICHT tut: den Planwert überschreiben. Ein
 * Ertrag von 38 t/ha aus einem Hageljahr ist ein Datum, keine Planungsgrundlage.
 * Ob daraus ein neuer Planwert wird, entscheidet der Bearbeiter in den Annahmen,
 * mit Audit-Eintrag. Hier steht nur, dass die Frage offen ist.
 */

type Filter = "alle" | "belegen" | "abweichung" | "pruefen" | "bestaetigt";

const HANDLUNG: Record<WiedervorlageRow["handlung"], { label: string; farbe: string; Icon: typeof CircleAlert }> = {
  belegen: { label: "belegen", farbe: "var(--nx-warning-text)", Icon: CircleAlert },
  abweichung: { label: "Abweichung", farbe: "var(--nx-error)", Icon: TriangleAlert },
  pruefen: { label: "prüfen", farbe: "var(--nx-text-secondary)", Icon: CircleHelp },
  bestaetigt: { label: "bestätigt", farbe: "var(--nx-success)", Icon: CircleCheck },
};

export function WiedervorlageView() {
  const domain = useModelStore((s) => s.domain);
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);

  const [filter, setFilter] = React.useState<Filter>("belegen");
  const [suche, setSuche] = React.useState("");
  const [kategorie, setKategorie] = React.useState("alle");

  const alle = React.useMemo(
    () => deriveWiedervorlage(domain, sc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [domain, sc, tick],
  );

  const kategorien = React.useMemo(
    () => ["alle", ...[...new Set(alle.map((r) => r.category))].sort()],
    [alle],
  );

  const zaehler = React.useMemo(() => ({
    belegen: alle.filter((r) => r.handlung === "belegen").length,
    abweichung: alle.filter((r) => r.handlung === "abweichung").length,
    pruefen: alle.filter((r) => r.handlung === "pruefen").length,
    bestaetigt: alle.filter((r) => r.handlung === "bestaetigt").length,
  }), [alle]);

  const zeilen = React.useMemo(() => {
    const q = suche.trim().toLowerCase();
    return alle.filter((r) =>
      (filter === "alle" || r.handlung === filter)
      && (kategorie === "alle" || r.category === kategorie)
      && (!q || r.label.toLowerCase().includes(q) || r.key.toLowerCase().includes(q)
          || (r.owner ?? "").toLowerCase().includes(q) || (r.quelle ?? "").toLowerCase().includes(q)));
  }, [alle, filter, kategorie, suche]);

  /* Beleggrad: der Anteil der Annahmen, hinter denen wirklich eine Messung steht.
   *  Bewusst NICHT „geprüft markiert“ — ein Haken ist keine Messung. */
  const belegt = alle.filter((r) => r.istAnzahl > 0).length;
  const belegPct = alle.length ? (belegt / alle.length) * 100 : 0;

  const csv = () => {
    const kopf = ["key", "label", "kategorie", "einheit", "planwert", "status", "handlung",
      "istAnzahl", "istMittel", "istMin", "istMax", "abweichungPct", "owner", "quelle", "letzteMessung"];
    const zeile = (r: WiedervorlageRow) => [r.key, r.label, r.category, r.unit,
      r.planwert ?? "", r.status, r.handlung, r.istAnzahl, r.istMittel ?? "", r.istMin ?? "", r.istMax ?? "",
      r.abweichung == null ? "" : (r.abweichung * 100).toFixed(1), r.owner ?? "", r.quelle ?? "", r.letzteMessung ?? ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";");
    const blob = new Blob(["﻿" + [kopf.join(";"), ...zeilen.map(zeile)].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `neosfx-wiedervorlage-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-3">
      <AnsichtKopf
        titel={t("Wiedervorlage")}
        satz={t("Jede Annahme des Modells mit dem, was inzwischen dazu gemessen wurde. Oben steht, was nichts trägt. Ein Messwert ersetzt hier keinen Planwert — er sagt nur, dass die Frage offen ist.")}
        rechts={
          <>
            <TextFeld wert={suche} onChange={setSuche} platzhalter={t("Treiber, Schlüssel, Owner, Quelle …")} breite={230} />
            <Auswahl wert={kategorie} onChange={setKategorie} breite={170}
              ariaLabel={t("Kategorie")}
              optionen={kategorien.map((k) => ({ wert: k, label: k === "alle" ? t("alle Kategorien") : k }))} />
            <Aktion kind="haupt" Icon={Download} onClick={csv}>{t("Liste exportieren")}</Aktion>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kennzahl label={t("zu belegen")} wert={String(zaehler.belegen)} Icon={CircleAlert}
          ton={zaehler.belegen > 0 ? "warn" : "gut"}
          zusatz={t("ungeprüft und ohne Messung")} />
        <Kennzahl label={t("Abweichung")} wert={String(zaehler.abweichung)} Icon={TriangleAlert}
          ton={zaehler.abweichung > 0 ? "warn" : "gut"}
          zusatz={`${t("Messung mehr als")} ${fmtNumber(IST_TOLERANZ * 100, 0)} % ${t("neben dem Plan")}`} />
        <Kennzahl label={t("mit Messung hinterlegt")} wert={`${fmtNumber(belegPct, 1)} %`} Icon={ClipboardCheck}
          zusatz={`${belegt} ${t("von")} ${alle.length} ${t("Annahmen")}`} />
        <Kennzahl label={t("bestätigt")} wert={String(zaehler.bestaetigt)} Icon={CircleCheck} ton="gut"
          zusatz={t("gemessen und innerhalb der Toleranz")} />
      </div>

      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
          <Segmented<Filter>
            ariaLabel={t("Handlung")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "belegen", label: t("belegen"), count: zaehler.belegen, tone: "warning" },
              { value: "abweichung", label: t("Abweichung"), count: zaehler.abweichung, tone: "warning" },
              { value: "pruefen", label: t("prüfen"), count: zaehler.pruefen },
              { value: "bestaetigt", label: t("bestätigt"), count: zaehler.bestaetigt },
              { value: "alle", label: t("alle"), count: alle.length, divider: true },
            ]}
          />
          <span className="num ml-auto text-[11px] text-nx-text-muted">
            {zeilen.length} {t("Zeilen")}
          </span>
        </div>

        {zeilen.length === 0 ? (
          <div className="p-3">
            <Leer Icon={ClipboardCheck} titel={t("Nichts in dieser Auswahl")}
              satz={t("Kein Treiber trägt diese Handlung — oder Suche und Kategorie schließen alles aus. Messungen werden in der Ansicht „Annahmen“ am jeweiligen Treiber erfasst.")} />
          </div>
        ) : (
          <div className="max-h-[calc(100vh-330px)] overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH} style={{ ...TH_STYLE, minWidth: 260 }}>{t("Treiber")}</th>
                  <th className={TH} style={TH_STYLE}>{t("Kategorie")}</th>
                  <th className={TH + " text-right"} style={TH_STYLE}>{t("Plan")}</th>
                  <th className={TH + " text-right"} style={TH_STYLE}>{t("Ist Ø")}</th>
                  <th className={TH + " text-right"} style={TH_STYLE}>{t("Spanne")}</th>
                  <th className={TH + " text-right"} style={TH_STYLE}>{t("n")}</th>
                  <th className={TH + " text-right"} style={TH_STYLE}>{t("Abw.")}</th>
                  <th className={TH} style={TH_STYLE}>{t("Handlung")}</th>
                  <th className={TH} style={TH_STYLE}>{t("Owner / Quelle")}</th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((r) => {
                  const h = HANDLUNG[r.handlung];
                  return (
                    <tr key={r.key} className="hover:brightness-[1.03]">
                      <td className={TD} style={TD_STYLE}>
                        <div className="font-medium text-nx-text">{r.label}</div>
                        <div className="num text-[9.5px] text-nx-text-muted">{r.key}</div>
                      </td>
                      <td className={TD + " text-nx-text-secondary"} style={TD_STYLE}>{r.category}</td>
                      <td className={TD + " num text-right"} style={TD_STYLE}>
                        {r.planwert == null ? "—" : fmtNumber(r.planwert, 2)}
                        {r.unit ? <span className="ml-1 text-[9.5px] text-nx-text-muted">{r.unit}</span> : null}
                      </td>
                      <td className={TD + " num text-right"} style={TD_STYLE}>
                        {r.istMittel == null ? <span className="text-nx-text-muted">—</span> : fmtNumber(r.istMittel, 2)}
                      </td>
                      <td className={TD + " num text-right text-[10.5px] text-nx-text-muted"} style={TD_STYLE}>
                        {r.istMin == null ? "—" : `${fmtNumber(r.istMin, 1)} … ${fmtNumber(r.istMax!, 1)}`}
                      </td>
                      <td className={TD + " num text-right text-nx-text-muted"} style={TD_STYLE}>{r.istAnzahl || "—"}</td>
                      <td className={TD + " num text-right font-semibold"} style={TD_STYLE}>
                        {r.abweichung == null ? <span className="font-normal text-nx-text-muted">—</span> : (
                          <span style={{ color: Math.abs(r.abweichung) > IST_TOLERANZ ? "var(--nx-error)" : "var(--nx-success)" }}>
                            {r.abweichung > 0 ? "+" : ""}{fmtNumber(r.abweichung * 100, 0)} %
                          </span>
                        )}
                      </td>
                      <td className={TD} style={TD_STYLE}>
                        {/* Farbe trägt die Bedeutung NIE allein — Icon und Wort stehen daneben. */}
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: h.farbe }}>
                          <h.Icon size={13} strokeWidth={2.4} aria-hidden />
                          {t(h.label)}
                        </span>
                      </td>
                      <td className={TD + " text-[10.5px] text-nx-text-muted"} style={TD_STYLE}>
                        {r.owner || "—"}
                        {r.quelle ? <div className="truncate" style={{ maxWidth: 220 }}>{r.quelle}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t px-3 py-2 text-[10.5px] leading-relaxed text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Der Ist-Wert ist das ungewichtete Mittel aller Messungen zu diesem Treiber. Eine flächengewichtete Zahl bräuchte an jeder Messung den Schlagbezug; solange der fehlt, wäre die Gewichtung eine Scheingenauigkeit.")}
          {" "}
          {t("Erfasst werden Messungen in der Ansicht „Annahmen“ am jeweiligen Treiber — mit Feldbezug, denn ohne ihn ist ein Messwert ein Betriebsdurchschnitt und belegt keinen Faktor.")}
        </div>
      </section>
    </div>
  );
}
