"use client";
import React from "react";
import { useModelStore, selectComputed } from "../../store/modelStore";
import { Segmented } from "../primitives/Segmented";
import { StatusPill } from "../primitives/StatusPill";
import { t } from "../../lib/i18n";
import { Circle } from "lucide-react";
import type { Granularity } from "../../core/types";

/** Global controls, always visible. Scenario switch tints the bar subtly (NO yellow —
 *  yellow stays the single CTA). Balance-check + convergence are always shown. */
export function TopBar({ theme, onToggleTheme }: { theme: "light" | "dark"; onToggleTheme: () => void }) {
  const { view, setScenario, setGranularity, setCurrency, setLang, recalcTick } = useModelStore();
  const computed = useModelStore(selectComputed);
  const balance = computed.checks.find((c) => c.id === "balance_zero");
  const converged = computed.meta.converged;

  const [pulse, setPulse] = React.useState(false);
  React.useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 180);
    return () => clearTimeout(t);
  }, [recalcTick, view.scenarioId, view.granularity]);

  return (
    <header
      className="flex h-[58px] shrink-0 items-center gap-3 border-b px-6"
      style={{ background: "var(--nx-surface)", borderColor: "var(--nx-border)" }}
    >
      <div className="flex items-center gap-2">
        <span className="caption text-[10.5px] font-bold text-nx-text-muted">{t("Szenario")}</span>
        <Segmented
          ariaLabel={t("Szenario")}
          value={view.scenarioId}
          onChange={setScenario}
          options={[
            { value: "sc-base", label: "Base" },
            { value: "sc-best", label: "Best" },
            { value: "sc-worst", label: "Worst" },
          ]}
        />
      </div>

      {/* ENTFERNT 30.07.2026 (Solo-Modell): Stufen-, Entity- und Umfang-Umschalter.
          · Stufe: 3 der 4 Optionen haben das Modell zerstört — "1" baute den Anbauplan auf
            Cash Crops um, "1a"/"2b" haben die Flächenkurve auf 300 ha flachgedrückt und damit
            den gesamten Skalierungspfad gelöscht. Es gibt nur noch eine Stufe.
          · Entity: eine Gesellschaft, "Kombiniert"/"NEOTERRA" waren rechnerisch identisch,
            "Isolde" zeigte auf eine nicht mehr existierende Entity.
          · Umfang: "Nur Wertkulturen" ist der Normalzustand — der Schalter war wirkungslos. */}

      <div className="flex items-center gap-2">
        <span className="caption text-[10.5px] font-bold text-nx-text-muted">{t("Zeit")}</span>
        <Segmented
          ariaLabel={t("Granularität")}
          value={view.granularity}
          onChange={(g) => setGranularity(g as Granularity)}
          options={[
            { value: "month", label: t("Monat") },
            { value: "quarter", label: t("Quartal") },
            { value: "year", label: t("Jahr") },
          ]}
        />
      </div>

      <div className="flex items-center gap-2">
        {/* Sprache DE/EN */}
        <Segmented
          ariaLabel="Language"
          value={view.lang}
          onChange={(l) => setLang(l as "de" | "en")}
          options={[{ value: "de", label: "DE" }, { value: "en", label: "EN" }]}
        />
        <Segmented
          ariaLabel={t("Währung")}
          value={view.currency}
          onChange={(c) => setCurrency(c as "EUR" | "RON")}
          options={[{ value: "EUR", label: "€" }, { value: "RON", label: "RON" }]}
        />
        {/* Hell/Dunkel-Toggle (DS-Muster: Aktiv-Pille Surface, Aktiv-Schrift Soft-Grün) */}
        <div role="tablist" aria-label="Theme" className="inline-flex items-center gap-1 rounded-control border border-nx-border p-[3px]" style={{ background: "var(--nx-surface-sunken)" }}>
          {([["light", t("Hell")], ["dark", t("Dunkel")]] as const).map(([th, label]) => {
            const active = theme === th;
            return (
              <button key={th} role="tab" aria-selected={active} onClick={() => { if (!active) onToggleTheme(); }}
                className="num inline-flex h-[26px] items-center gap-1.5 px-2.5 text-[12px] font-semibold transition-colors"
                style={{ borderRadius: 7, background: active ? "var(--nx-surface)" : "transparent",
                  color: active ? "var(--nx-green-ink)" : "var(--nx-text-secondary)",
                  boxShadow: active ? "var(--nx-el-segment)" : "none" }}>
                {th === "light" ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                )}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* Cloud-Autosave-Status (Supabase) */}
        <CloudBadge />
        <span
          className="num text-[11px]"
          style={{ color: pulse ? "var(--nx-success)" : "var(--nx-text-muted)", transition: "color 180ms" }}
        >
          {pulse ? <span className="inline-flex items-center gap-1"><Circle size={8} fill="currentColor" strokeWidth={0} aria-hidden />{t("Neu berechnet")}</span> : t("Aktuell")}
        </span>
        {!converged && <StatusPill tone="warning" label={t("Nicht konvergiert")} />}
        {balance && (
          <StatusPill
            tone={balance.passed ? "success" : "error"}
            label={balance.passed ? t("Bilanz = 0") : `${t("Bilanz Δ")} ${balance.maxDeviation}`}
          />
        )}
      </div>
    </header>
  );
}

/** Cloud-Autosave-Status: lädt/speichert/gespeichert/offline (Supabase-Slot AUTOSAVE). */
function CloudBadge() {
  const cloud = useModelStore((s) => s.cloud);
  if (cloud === "off") return null;
  const map: Record<string, { label: string; color: string }> = {
    load: { label: "Cloud: lädt …", color: "var(--nx-text-muted)" },
    saving: { label: "Cloud: speichert …", color: "var(--nx-text-muted)" },
    saved: { label: "Cloud: gespeichert", color: "var(--nx-success)" },
    local: { label: "Lokal gespeichert (dieser Browser)", color: "var(--nx-text-secondary)" },
    error: { label: "Nicht gespeichert — JSON-Export nutzen", color: "var(--nx-warning)" },
  };
  const m = map[cloud];
  return (
    <span className="num inline-flex items-center gap-1.5 text-[11px]" style={{ color: m.color }} title={t("Automatisches Speichern in der Team-Cloud (Supabase). Ist die Cloud nicht erreichbar, sichert die App lokal in diesem Browser — der Stand überlebt einen Reload, wird aber nicht mit dem Team geteilt.")}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M17.5 19a4.5 4.5 0 1 0-.9-8.9 6 6 0 1 0-11.1 3.4" /><path d="M12 13v8" /><path d="m8.5 17 3.5-4 3.5 4" />
      </svg>
      {t(m.label)}
    </span>
  );
}
