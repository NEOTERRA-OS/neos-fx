"use client";
import React from "react";
import { START_YEAR } from "../../store/model";
import { t } from "../../lib/i18n";

/** PLANJAHR-AUSWAHL — ein Baustein für alle Ansichten.
 *
 *  Jede Tabelle, die eine Summe über den Betrieb zeigt, braucht ein Bezugsjahr: der Plan läuft
 *  von 300 auf 2.334 Hektar, eine Summe ohne genanntes Jahr ist nicht interpretierbar. Vorher
 *  wählte jede Ansicht ihr Bezugsjahr selbst — mal das Startjahr, mal den Endausbau, mal gar
 *  keins — und nannte es nirgends.
 *
 *  REGEL (Entscheidung Benedikt, 01.08.2026): Der Default ist IMMER das erste Planjahr.
 *  Wer eine Zahl ohne bewusste Auswahl sieht, sieht 2027 — das Jahr, das als Nächstes kommt,
 *  nicht den Endausbau in acht Jahren. */
export function JahrWahl({ jahre, wert, onChange, label }: {
  jahre: number; wert: number; onChange: (y: number) => void; label?: string;
}) {
  if (jahre <= 1) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {label !== "" && (
        <span className="caption text-[10px] text-nx-text-muted">{label ?? t("Planjahr")}</span>
      )}
      <span className="inline-flex items-center gap-1">
        {Array.from({ length: jahre }, (_, y) => {
          const an = y === wert;
          return (
            <button key={y} onClick={() => onChange(y)} type="button"
              className="num rounded-control border px-2 text-[11px] font-semibold"
              style={{
                height: 24, borderColor: an ? "var(--nx-brand-lift)" : "var(--nx-border)",
                color: an ? "var(--nx-app-bg)" : "var(--nx-text-secondary)",
                background: an ? "var(--nx-brand-lift)" : "var(--nx-surface)",
              }}>{START_YEAR + y}</button>
          );
        })}
      </span>
    </span>
  );
}

/** Erstes Planjahr — der verbindliche Default jeder Jahresauswahl. */
export const JAHR_DEFAULT = 0;
