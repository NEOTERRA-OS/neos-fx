"use client";
import React from "react";
import { useModelStore, selectComputed } from "../../store/modelStore";
import { Segmented } from "../primitives/Segmented";
import { StatusPill } from "../primitives/StatusPill";
import { t } from "../../lib/i18n";
import type { Granularity } from "../../core/types";

/** Global controls, always visible. Scenario switch tints the bar subtly (NO yellow —
 *  yellow stays the single CTA). Balance-check + convergence are always shown. */
export function TopBar({ theme, onToggleTheme }: { theme: "light" | "dark"; onToggleTheme: () => void }) {
  const { view, setScenario, setGranularity, setCurrency, setLang, setStage, setScope, recalcTick } = useModelStore();
  // Stufen-Anzeige aus dem WACHSTUMSPLAN — 1 (nur Ackerbau) · 1a (+ Wertkulturen) · 2b (+ Beregnung) · 3c (+ Fläche&Beregnung).
  const growthStage = useModelStore((s) => s.domain.growth?.stage ?? "s1");
  const stage: string = growthStage === "s3b" ? "3c" : growthStage === "s2" ? "2b" : growthStage === "s1a" ? "1" : "1a";
  const scope = useModelStore((s) => (s.domain as any).scope ?? "full");
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
          ariaLabel="Szenario"
          value={view.scenarioId}
          onChange={setScenario}
          options={[
            { value: "sc-base", label: "Base" },
            { value: "sc-best", label: "Best" },
            { value: "sc-worst", label: "Worst" },
          ]}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="caption text-[10.5px] font-bold text-nx-text-muted" title={t("1 = nur Ackerbau (Benchmark) · 1a = + Wertkulturen · 2b = + Vollberegnung · 3c = + Fläche & Beregnung")}>{t("Stufe")}</span>
        {/* 1 (nur Ackerbau · Benchmark) durch Trenner abgesetzt von den Value-Szenarien 1a/2b/3c.
            Buchstabe = zusätzliche Stellschraube: a Wertkulturen · b Beregnung · c Fläche+Beregnung. */}
        <Segmented
          ariaLabel="Skalierungsstufe"
          value={stage}
          onChange={(v) => setStage(v as any)}
          options={[
            { value: "1", label: "1", tone: "warning" },
            { value: "1a", label: "1a", divider: true, tone: "brand" },
            { value: "2b", label: "2b", tone: "brand" },
            { value: "3c", label: "3c", tone: "brand" },
          ]}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="caption text-[10.5px] font-bold text-nx-text-muted">{t("Umfang")}</span>
        <Segmented
          ariaLabel="Umfang"
          value={scope}
          onChange={(v) => setScope(v as "full" | "valueOnly")}
          options={[
            { value: "full", label: t("Voll-Rotation") },
            { value: "valueOnly", label: t("Nur Wertkulturen") },
          ]}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="caption text-[10.5px] font-bold text-nx-text-muted">{t("Zeit")}</span>
        <Segmented
          ariaLabel="Granularität"
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
          ariaLabel="Währung"
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
          {pulse ? t("● Neu berechnet") : t("Aktuell")}
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
    error: { label: "Cloud: offline (JSON-Export nutzen)", color: "var(--nx-warning)" },
  };
  const m = map[cloud];
  return (
    <span className="num inline-flex items-center gap-1.5 text-[11px]" style={{ color: m.color }} title={t("Automatisches Speichern in der Team-Cloud (Supabase). Beim Start wird der letzte Stand geladen.")}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M17.5 19a4.5 4.5 0 1 0-.9-8.9 6 6 0 1 0-11.1 3.4" /><path d="M12 13v8" /><path d="m8.5 17 3.5-4 3.5 4" />
      </svg>
      {t(m.label)}
    </span>
  );
}
