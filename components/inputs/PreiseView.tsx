"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { PRICE_GROUPS } from "../../store/model";
import { AssumptionField } from "./AssumptionField";
import { Segmented } from "../primitives/Segmented";
import { t } from "../../lib/i18n";

/** Preise & Treiber — zentrale Annahmen, nach Domänen kategorisiert. Statt einer flachen
 *  Wand: eine In-Page-Kategorienavigation (Filter-Chips) zeigt jeweils EINE Domäne;
 *  jede Gruppe ist eine eigenständige Karte mit ausgerichteten Feldzeilen. */

type Category = { id: string; label: string; hint: string; groups: string[] };
// Nur noch Makro/Finanz-Treiber — Kulturen→Anbauplan, Maschinen→Maschinen-Hub, Einsatz/Personal→Leistungsparameter.
const CATEGORIES: Category[] = [
  { id: "makro", label: "Makro & Finanzen", hint: "Zinssätze, Steuern, Inflation, Working Capital, Covenants, Finanzierung, zentrale Fixkosten & Input-Stücksätze.",
    groups: ["Makro & Steuer", "Steuer-Optimierung & Finanzierung", "Inflation (real ↔ nominal)", "Working Capital", "Covenants", "AfA & Bewertung", "Finanzierung", "Fixkosten & OpEx", "Stücksätze (Inputs)"] },
];

export function PreiseView() {
  const domain = useModelStore((s) => s.domain);
  const scenario = useModelStore((s) => s.view.scenarioId);
  const [cat, setCat] = React.useState(CATEGORIES[0].id);

  // Gruppen je Kategorie (Reihenfolge aus PRICE_GROUPS); nicht zugeordnete → „Sonstiges".
  const cats = React.useMemo(() => {
    const byName = new Map(PRICE_GROUPS.map((g) => [g.group, g]));
    const list = CATEGORIES.map((c) => ({
      ...c,
      groups: c.groups.map((n) => byName.get(n)).filter(Boolean) as typeof PRICE_GROUPS,
    }));
    return list.filter((c) => c.groups.length);
  }, []);

  const activeCat = cats.find((c) => c.id === cat) ?? cats[0];

  return (
    <div className="space-y-4">
      {/* Kopf + Kategorien-Filterchips */}
      <div className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Makro & Finanzen")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">{t("Szenario")} {scenario.replace("sc-", "")} {t("· Eingabe → Recalc")}</span>
        </div>
        <div className="overflow-x-auto px-4 py-3">
          <Segmented ariaLabel={t("Treiber-Kategorie")}
            value={activeCat.id} onChange={setCat}
            options={cats.map((c) => ({ value: c.id, label: t(c.label), count: c.groups.reduce((s, g) => s + g.keys.length, 0) }))} />
        </div>
        <div className="px-4 pb-3 text-[12px] text-nx-text-secondary">{t(activeCat.hint)}</div>
      </div>

      {/* Gruppenkarten der aktiven Kategorie */}
      {activeCat.groups.map((g) => (
        <section key={g.group} className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)", boxShadow: "var(--nx-el-card)" }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
            <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{g.group}</h3>
            <span className="num text-[10.5px] text-nx-text-muted">{g.keys.length} {t("Felder")}</span>
          </div>
          <div className="grid grid-cols-1 gap-x-10 px-4 py-1.5 lg:grid-cols-2">
            {g.keys.map((k) => {
              const a = domain.assumptions[k];
              return (
                <div key={k} className="flex items-center justify-between gap-4 border-b py-2" style={{ borderColor: "var(--nx-border-divider)" }}>
                  <span className="min-w-0 flex-1 text-[12.5px] text-nx-text-secondary" title={k}>{a?.label ?? k}</span>
                  <AssumptionField akey={k} />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
