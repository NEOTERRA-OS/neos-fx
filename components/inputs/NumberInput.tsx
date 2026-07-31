"use client";
import React from "react";
import { fmtEditable, parseDe } from "../../design/format";
import { FeldRoh } from "./Feld";
import type { Unit } from "../../core/types";

/** NumberInput — Alt-Einstieg, der jetzt AUF DEM Feld-Baustein aufsetzt.
 *
 *  Wird eine `unit` (oder das Alt-Flag `moneyCent`) angegeben, rendert das Feld über
 *  `FeldRoh`: Umrechnung, feste Nachkommastellen und das Kurzzeichen kommen dann aus
 *  `design/units.ts`, und der Aufrufer entscheidet nichts davon mehr selbst. Genau daran ist
 *  die App vorher auseinandergelaufen — jeder Aufrufer setzte sein eigenes Suffix und seine
 *  eigenen Stellen, und derselbe Anteil erschien einmal als „0,08 ×" und einmal als „8,00 %".
 *
 *  Der Pfad ohne `unit` bleibt für die wenigen Felder ohne sinnvolle Einheit (Jahreszahlen,
 *  freie Mengen mit eigener Einheitenspalte). Neue Aufrufe sollten `FeldRoh` direkt benutzen. */
export function NumberInput({
  value, onCommit, moneyCent, width = 110, suffix, decimals, unit, hervor, titel,
}: {
  value: number; onCommit: (n: number) => void; moneyCent?: boolean; width?: number;
  suffix?: string; decimals?: number; unit?: Unit | string; hervor?: boolean; titel?: string;
}) {
  const u = unit ?? (moneyCent ? "money" : undefined);
  if (u) {
    return <FeldRoh wert={value} unit={u} onCommit={onCommit} breite={width}
      einheitZeigen={suffix !== ""} hervor={hervor} titel={titel} />;
  }
  return <RohOhneEinheit value={value} onCommit={onCommit} width={width} suffix={suffix} decimals={decimals} />;
}

function RohOhneEinheit({ value, onCommit, width, suffix, decimals }: {
  value: number; onCommit: (n: number) => void; width: number; suffix?: string; decimals?: number;
}) {
  const anzeige = fmtEditable(value, decimals ?? 2, decimals ?? 0);
  const [t, setT] = React.useState(anzeige);
  React.useEffect(() => setT(anzeige), [anzeige]);
  // Die Anzeige ist gerundet — ein blosses Verlassen des Feldes darf den gerundeten Wert
  //  NICHT festschreiben. Nur eine echte Texteingabe wird uebernommen.
  const commit = (s: string) => { if (s === anzeige) return; const n = parseDe(s); if (n !== null) onCommit(n); };
  const fitWidth = Math.max(width, t.length * 8 + 26);
  return (
    <span className="inline-flex items-center gap-1">
      <input
        className="num rounded-control border px-2 text-right text-[12.5px]"
        style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600, height: 34, width: fitWidth }}
        value={t}
        inputMode="decimal"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setT(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      {suffix && <span className="text-[11px] text-nx-text-muted">{suffix}</span>}
    </span>
  );
}

export function TextInput({ value, onCommit, width = 200 }: { value: string; onCommit: (s: string) => void; width?: number }) {
  const [t, setT] = React.useState(value);
  React.useEffect(() => setT(value), [value]);
  return (
    <input
      className="rounded-control border px-2 text-[12.5px]"
      style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)", height: 34, width }}
      value={t}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => onCommit(t)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}
