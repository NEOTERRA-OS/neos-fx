"use client";
import React from "react";
import type { LucideIcon } from "lucide-react";

/**
 * NEOS-Bedienelemente — Text, Auswahl, Aktion.
 *
 * WARUM DIESE DATEI EXISTIERT. Bis 04.08.2026 baute jede Ansicht ihre Eingaben
 * selbst: `<input className="rounded-control border …" style={{ height: 26 }}>`
 * an der einen Stelle, 28 an der nächsten, 30 in der übernächsten. Das ist kein
 * Schönheitsfehler. Eine Bedienleiste, in der vier Elemente vier Höhen haben,
 * liest sich als vier verschiedene Dinge — und der Nutzer sucht die Bedeutung
 * hinter einem Unterschied, den niemand gemeint hat.
 *
 * Die Höhe kommt jetzt aus `--nx-h-control` (38 px, NEOS-Kontrakt) und steht an
 * genau einer Stelle. `dicht` senkt sie auf 30 px — die eine erlaubte Ausnahme,
 * für Elemente INNERHALB einer Tabellenzeile, wo 38 px die Zeile sprengen würde.
 *
 * Was hier bewusst NICHT drin ist: Gelb. Das Akzent-Gelb ist der EINEN Aktion je
 * Kontext vorbehalten; deshalb trägt nur `Aktion` mit `haupt` es, und je Ansicht
 * darf es das genau einmal geben.
 */

export const H_CONTROL = "var(--nx-h-control)";
export const H_DICHT = 30;

const rahmen = (dicht?: boolean): React.CSSProperties => ({
  height: dicht ? H_DICHT : H_CONTROL,
  background: "var(--nx-app-bg)",
  borderColor: "var(--nx-border)",
  color: "var(--nx-text)",
});

/** Freitext. `zahl` schaltet auf Mono und rechtsbündig — Ziffern gehören in die
 *  Mono-Laufweite, sonst springen die Stellen von Zeile zu Zeile. */
export function TextFeld({
  wert, onChange, onEnter, platzhalter, breite = 160, zahl, dicht, titel, ariaLabel,
}: {
  wert: string; onChange: (s: string) => void; onEnter?: () => void;
  platzhalter?: string; breite?: number | string; zahl?: boolean; dicht?: boolean;
  titel?: string; ariaLabel?: string;
}) {
  return (
    <input
      value={wert}
      title={titel}
      aria-label={ariaLabel ?? platzhalter ?? titel}
      placeholder={platzhalter}
      inputMode={zahl ? "decimal" : undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { onEnter?.(); (e.target as HTMLInputElement).blur(); } }}
      className={(zahl ? "num text-right " : "") + "rounded-control border px-2 text-[12.5px]"}
      style={{ ...rahmen(dicht), width: breite }}
    />
  );
}

/** Auswahl. Bewusst ein natives `<select>`: es ist tastaturbedienbar, es
 *  funktioniert auf dem Touchgerät, und es braucht keinen Portal-Layer. */
export function Auswahl<T extends string>({
  wert, onChange, optionen, breite = 160, dicht, titel, ariaLabel,
}: {
  wert: T; onChange: (v: T) => void; optionen: { wert: T; label: string }[];
  breite?: number | string; dicht?: boolean; titel?: string; ariaLabel?: string;
}) {
  return (
    <select
      value={wert}
      title={titel}
      aria-label={ariaLabel ?? titel}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded-control border px-2 text-[12px]"
      style={{ ...rahmen(dicht), width: breite }}
    >
      {optionen.map((o) => <option key={o.wert} value={o.wert}>{o.label}</option>)}
    </select>
  );
}

/**
 * Aktion.
 *   haupt   das eine Akzent-Gelb. Genau EINE je Kontext — mehr macht keine
 *           davon zur Hauptaktion.
 *   still   Rahmen ohne Fläche, für alles andere.
 *   warn    für Aktionen mit Folgen. Trägt IMMER ein Icon: Farbe darf nie
 *           alleiniger Bedeutungsträger sein.
 */
export function Aktion({
  kind = "still", onClick, children, Icon, dicht, disabled, titel,
}: {
  kind?: "haupt" | "still" | "warn"; onClick: () => void; children: React.ReactNode;
  Icon?: LucideIcon; dicht?: boolean; disabled?: boolean; titel?: string;
}) {
  const stil: React.CSSProperties =
    kind === "haupt" ? { background: "var(--nx-yellow)", borderColor: "var(--nx-yellow)", color: "#2C3C2B", fontWeight: 700 }
    : kind === "warn" ? { background: "var(--nx-warning-bg)", borderColor: "var(--nx-warning)", color: "var(--nx-warning-text)", fontWeight: 600 }
    : { background: "var(--nx-surface)", borderColor: "var(--nx-border)", color: "var(--nx-text)", fontWeight: 600 };
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={titel}
      className="inline-flex items-center gap-1.5 rounded-control border px-3 text-[12px] transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
      style={{ height: dicht ? H_DICHT : H_CONTROL, ...stil }}
    >
      {Icon && <Icon size={14} strokeWidth={2.4} aria-hidden />}
      {children}
    </button>
  );
}

/** Beschriftung über oder neben einem Bedienelement. */
export function Marke({ children }: { children: React.ReactNode }) {
  return <span className="caption text-[9.5px] font-bold uppercase tracking-wide text-nx-text-muted">{children}</span>;
}

/** Kopf einer Ansicht: Titel, ein Satz Einordnung, rechts die Bedienleiste.
 *  Der Satz ist Pflicht — eine Tabelle ohne Aussage ist eine Zumutung. */
export function AnsichtKopf({ titel, satz, rechts }: {
  titel: string; satz: React.ReactNode; rechts?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-[280px] max-w-3xl">
        <h2 className="text-[15px] font-bold text-nx-text">{titel}</h2>
        <p className="mt-1 text-[11.5px] leading-relaxed text-nx-text-secondary">{satz}</p>
      </div>
      {rechts && <div className="flex flex-wrap items-center gap-2">{rechts}</div>}
    </div>
  );
}

/** Kachel mit Zahl und Beschriftung. `ton` färbt die Zahl, das Icon trägt die
 *  Bedeutung mit — Farbe allein sagt nichts. */
export function Kennzahl({ label, wert, zusatz, ton, Icon }: {
  label: string; wert: string; zusatz?: string; ton?: "warn" | "gut" | "neutral"; Icon?: LucideIcon;
}) {
  const farbe = ton === "warn" ? "var(--nx-warning-text)" : ton === "gut" ? "var(--nx-success)" : "var(--nx-text)";
  return (
    <div className="rounded-tile border px-3 py-2" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon size={13} strokeWidth={2.4} aria-hidden style={{ color: farbe }} />}
        <Marke>{label}</Marke>
      </div>
      <div className="num mt-0.5 text-[18px] font-bold leading-none" style={{ color: farbe }}>{wert}</div>
      {zusatz && <div className="mt-1 text-[10.5px] text-nx-text-muted">{zusatz}</div>}
    </div>
  );
}

/** Leerzustand. Sagt, WARUM nichts da ist und was es füllen würde — „keine
 *  Daten" ist keine Auskunft. */
export function Leer({ titel, satz, Icon }: { titel: string; satz: string; Icon?: LucideIcon }) {
  return (
    <div className="rounded-tile border px-6 py-10 text-center" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      {Icon && <Icon size={26} strokeWidth={1.6} aria-hidden className="mx-auto mb-2 text-nx-text-muted" />}
      <div className="text-[13px] font-semibold text-nx-text">{titel}</div>
      <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-nx-text-secondary">{satz}</p>
    </div>
  );
}

/** Tabellenrahmen — eine Kopfzeile, klebend, Zebra über `tr:nth-child`. */
export const TH = "caption sticky top-0 z-[1] border-b px-2.5 py-2 text-left text-[9.5px] font-bold uppercase tracking-wide";
export const TH_STYLE: React.CSSProperties = { background: "var(--nx-surface-alt)", borderColor: "var(--nx-border)", color: "var(--nx-text-muted)" };
export const TD = "border-b px-2.5 py-1.5 text-[12px] align-middle";
export const TD_STYLE: React.CSSProperties = { borderColor: "var(--nx-border-divider)" };
