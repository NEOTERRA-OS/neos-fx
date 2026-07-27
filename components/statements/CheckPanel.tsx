"use client";
import React from "react";
import type { CheckResult } from "../../core/types";
import { fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";

/** Engine-Check-Labels übersetzen: statische Labels via t(); dynamische (mit Zahlen/Keys)
 *  über bekannte Teilphrasen. In DE ist t(x)===x → alles No-op, Label bleibt deutsch. */
const CHECK_FRAGMENTS = [
  "(Mindest-Kapitaldienstdeckung, p.a.)",
  "(Verschuldungsgrenze, p.a.)",
  "Fehlende Assumption-Keys (still → 0): ",
  "Doldenblütler-Anbaupause OK (Apiaceae max. ",
  " % ≤ 20 % — Sellerie + ½ Möhre)",
  "Doldenblütler-Anbaupause verletzt: ",
  " % Apiaceae (Jahr ",
  "Maßnahmen ↔ Arbeitsgänge: ",
];
function trCheck(label: string): string {
  const ex = t(label);
  if (ex !== label) return ex; // exakter (statischer) Treffer
  let s = label;
  for (const frag of CHECK_FRAGMENTS) { const en = t(frag); if (en !== frag) s = s.split(frag).join(en); }
  return s;
}

/** Abweichung lesbar: Geldbeträge (Cent) groß → in € gerundet; Ratios (klein) mit 2 Dez. */
function fmtDev(id: string, v: number): string {
  const covenant = id === "dscr_covenant" || id === "leverage_covenant";
  if (covenant) return fmtNumber(v, 2) + "×";
  if (Math.abs(v) >= 1000) return fmtNumber(Math.round(v / 100), 0) + " €";
  return fmtNumber(v, 2);
}

/** Always reachable. Balance check (A = L + E) first, then the rest. Colour never
 *  alone — each row carries icon + label + deviation. */
export function CheckPanel({ checks }: { checks: CheckResult[] }) {
  const ordered = [...checks].sort((a, b) => (a.id === "balance_zero" ? -1 : b.id === "balance_zero" ? 1 : 0));
  return (
    <section
      className="rounded-tile border p-4"
      style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}
    >
      <h2 className="mb-3 text-[14px] font-semibold">{t("Check-Panel")}</h2>
      <ul className="space-y-1.5">
        {ordered.map((c) => {
          const tone = c.passed ? "var(--nx-success)" : c.severity === "warning" ? "var(--nx-warning)" : "var(--nx-error)";
          const icon = c.passed ? "✓" : c.severity === "warning" ? "!" : "✕";
          return (
            <li key={c.id} className="flex items-center gap-2 text-[12.5px]">
              <span className="num inline-flex h-5 w-5 items-center justify-center rounded-pill text-[11px] font-bold"
                style={{ color: tone, background: c.passed ? "var(--nx-success-bg)" : c.severity === "warning" ? "var(--nx-warning-bg)" : "var(--nx-error-bg)" }}
                aria-hidden>{icon}</span>
              <span className="flex-1">{trCheck(c.label)}</span>
              <span className="num text-[11px] text-nx-text-muted">
                {c.passed ? "OK" : `Δ ${fmtDev(c.id, c.maxDeviation)} · M${c.offendingPeriods.join(",")}`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
