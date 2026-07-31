"use client";
import React from "react";
import { fmtEditable, parseDe } from "../../design/format";

/** Generic inline editor for a plain domain number (not an assumption). Money is
 *  stored in Minor-Units (Cent) → edited in € when moneyCent is set.
 *  Anzeige de-DE (Tausenderpunkt, Dezimalkomma); Eingabe wird de-DE geparst. */
export function NumberInput({
  value, onCommit, moneyCent, width = 110, suffix,
  decimals,
}: { value: number; onCommit: (n: number) => void; moneyCent?: boolean; width?: number; suffix?: string; decimals?: number }) {
  const toDisp = (v: number) => (moneyCent ? v / 100 : v);
  const fromDisp = (v: number) => (moneyCent ? Math.round(v * 100) : v);
  // decimals erzwingt FESTE Nachkommastellen (Annahmen-Register: durchgehend zwei, damit die
  // Spalte eine gemeinsame Kommaachse hat). Ohne die Angabe bleibt es bei „höchstens zwei".
  const anzeige = fmtEditable(toDisp(value), decimals ?? 2, decimals ?? 0);
  const [t, setT] = React.useState(anzeige);
  React.useEffect(() => setT(anzeige), [value]); // eslint-disable-line
  // Kappen wir die Anzeige auf zwei Nachkommastellen, darf ein blosses Verlassen des
  // Feldes den Wert NICHT auf die gerundete Zahl festschreiben. Deshalb: nur committen,
  // wenn der Text sich gegenueber der gerenderten Darstellung tatsaechlich geaendert hat.
  const commit = (s: string) => { if (s === anzeige) return; const n = parseDe(s); if (n !== null) onCommit(fromDisp(n)); };
  // Nie abschneiden: Mindestbreite folgt dem Inhalt (Mono ~7,5 px/Zeichen + Padding/Border).
  const fitWidth = Math.max(width, t.length * 8 + 26);
  return (
    <span className="inline-flex items-center gap-1">
      <input
        className="num rounded-control border px-2 text-right text-[12.5px]"
        style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600, height: 34, width: fitWidth }}
        value={t}
        inputMode="decimal"
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
