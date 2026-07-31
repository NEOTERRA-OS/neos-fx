"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import { ASSUMPTION_NOTE } from "../../store/model";
import { fmtEditable, parseDe } from "../../design/format";
import { einheit, zurAnzeige, ausAnzeige } from "../../design/units";
import type { Unit } from "../../core/types";
import { t } from "../../lib/i18n";

/* --------------------------------------------------------------------------
 * FELD — der eine Zahleneingabe-Baustein der App.
 *
 *  Vorher gab es drei Wege, dieselbe Zahl zu zeigen: `AssumptionField` (Einheit hinter dem
 *  Feld, `rate` als „×"), das Annahmen-Register (Einheit in eigener Spalte, `rate` als „%")
 *  und den rohen `NumberInput` mit frei gesetztem Suffix in einem Dutzend Ansichten. Derselbe
 *  Ernteverlust erschien dadurch als „0,08 ×" und als „8,00 %". Nachkommastellen entschied
 *  jeder Aufrufer selbst, weshalb 0,1 neben 0,08 in derselben Spalte stand.
 *
 *  Was der Baustein erzwingt — und der Aufrufer NICHT mehr entscheiden kann:
 *   · Umrechnung und Nachkommastellen kommen aus `design/units.ts`, nicht aus dem Aufrufruf.
 *   · Die Einheit steht NIE im Eingabefeld, sondern in einem Slot fester Breite dahinter.
 *     Ein Zeichen im Feld verschiebt sonst jede Zelle um seine Breite; genau daran sind die
 *     Zahlenspalten vorher auseinandergelaufen.
 *   · Marker (OVR · Hand · = · ↺) sitzen in Slots fester Breite und immer in derselben
 *     Reihenfolge, damit eine Zeile mit Marker so breit ist wie eine ohne.
 *   · Beim Fokussieren wird der Inhalt markiert: tippen ersetzt, statt anzuhängen.
 *
 *  ZWEI VARIANTEN, bewusst unterscheidbar:
 *   · <Feld akey="yield.tomate" />  — eine ANNAHME. Schreibt ins aktive Szenario, zeigt OVR,
 *     wenn Best/Worst vom Basisfall abweicht. Diese Zahl trägt ein Szenarioband.
 *   · <FeldRoh wert unit onCommit /> — eine DOMÄNENZAHL (Fläche, Stückzahl, Handeingabe).
 *     Gleiche Optik, aber kein Szenarioband: Best und Worst ändern sie nicht mit.
 * ------------------------------------------------------------------------ */

const RAHMEN: React.CSSProperties = {
  background: "var(--nx-app-bg)", borderColor: "var(--nx-border)",
  color: "var(--nx-locate)", fontWeight: 600, height: 34,
};

/** Breite des Einheiten-Slots. Fest, sonst wandert die Zahlenspalte je nach Kurzzeichen. */
const EINHEIT_BREITE = 52;

function Zahlenfeld({ anzeige, breite, onCommit, titel, hervor, ariaLabel }: {
  anzeige: string; breite: number; onCommit: (s: string) => void;
  titel?: string; hervor?: boolean; ariaLabel?: string;
}) {
  const [text, setText] = React.useState(anzeige);
  React.useEffect(() => { setText(anzeige); }, [anzeige]);
  // Nie abschneiden: Mindestbreite folgt dem Inhalt (Mono ≈ 8 px/Zeichen + Rahmen/Padding).
  const breit = Math.max(breite, text.length * 8 + 24);
  return (
    <input
      className="num rounded-control border px-2 text-right text-[12.5px]"
      style={{ ...RAHMEN, width: breit, ...(hervor ? { borderColor: "var(--nx-locate)" } : null) }}
      value={text}
      inputMode="decimal"
      aria-label={ariaLabel}
      title={titel}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

/** Einheiten-Slot fester Breite. `zeigen={false}` lässt ihn weg (Tabellen mit eigener
 *  Einheiten-SPALTE brauchen ihn nicht — dort steht die Einheit einmal je Zeile). */
function EinheitSlot({ unit, zeigen }: { unit: Unit | string | undefined; zeigen: boolean }) {
  if (!zeigen) return null;
  const e = einheit(unit);
  return (
    <span className="text-[11px] text-nx-text-muted" title={e.lang}
      style={{ width: EINHEIT_BREITE, textAlign: "left", flex: `0 0 ${EINHEIT_BREITE}px` }}>{e.kurz}</span>
  );
}

/** ANNAHME. Liest und schreibt das aktive Szenario; Umrechnung und Stellen aus der Einheit. */
export function Feld({ akey, breite = 96, einheitZeigen = true }: {
  akey: string; breite?: number; einheitZeigen?: boolean;
}) {
  const { domain, view, patch } = useModelStore();
  const a = domain.assumptions[akey];
  const scenarioId = view.scenarioId;
  const roh = readAssumption(domain, akey, scenarioId);
  const unit = (a?.unit ?? "count") as Unit;
  const spec = einheit(unit);
  const override = !!a?.scenarioProfiles[scenarioId] && scenarioId !== domain.baseScenarioId;

  if (!a) return <span className="num text-[11px] text-nx-error">?{akey}</span>;
  if (roh === null) return <span className="num text-[11px] text-nx-text-muted">{t("Kurve")}</span>;

  const anzeige = fmtEditable(zurAnzeige(unit, roh), spec.dez, spec.dez);
  // Die Anzeige ist auf feste Stellen gerundet. Ein blosses Verlassen des Feldes darf deshalb
  //  NICHT den gerundeten Wert festschreiben — nur eine echte Texteingabe wird uebernommen.
  const commit = (s: string) => {
    if (s === anzeige) return;
    const num = parseDe(s);
    if (num === null) return;
    patch((d) => { d.assumptions[akey].scenarioProfiles[scenarioId] = { kind: "constant", value: ausAnzeige(unit, num) }; });
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <Zahlenfeld anzeige={anzeige} breite={breite} onCommit={commit} ariaLabel={a.label}
        titel={[a.label, spec.lang || spec.kurz, ASSUMPTION_NOTE[akey]].filter(Boolean).join("  ·  ")} />
      <EinheitSlot unit={unit} zeigen={einheitZeigen} />
      <span style={{ width: 26, flex: "0 0 26px" }}>
        {override && (
          <span className="num rounded-pill px-1 text-[9px] font-bold"
            style={{ background: "var(--nx-warning-bg)", color: "var(--nx-warning-text)" }}
            title={t("weicht in diesem Szenario vom Basisfall ab")}>OVR</span>
        )}
      </span>
    </span>
  );
}

/** DOMÄNENZAHL. Kein Szenarioband — dieselbe Optik, aber Best/Worst ändern sie nicht. */
export function FeldRoh({ wert, unit, onCommit, breite = 96, einheitZeigen = true, hervor, marker, titel }: {
  wert: number; unit: Unit | string; onCommit: (n: number) => void;
  breite?: number; einheitZeigen?: boolean; hervor?: boolean;
  /** Optionaler Marker-Slot rechts (z. B. Rücksetz-Pfeil einer Handeingabe). */
  marker?: React.ReactNode; titel?: string;
}) {
  const spec = einheit(unit);
  const anzeige = fmtEditable(zurAnzeige(unit, wert), spec.dez, spec.dez);
  const commit = (s: string) => {
    if (s === anzeige) return;
    const n = parseDe(s);
    if (n !== null) onCommit(ausAnzeige(unit, n));
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <Zahlenfeld anzeige={anzeige} breite={breite} onCommit={commit} hervor={hervor}
        titel={titel ?? spec.lang} />
      <EinheitSlot unit={unit} zeigen={einheitZeigen} />
      {marker !== undefined && <span style={{ width: 16, flex: "0 0 16px" }}>{marker}</span>}
    </span>
  );
}
