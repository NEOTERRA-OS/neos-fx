"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { PRICE_GROUPS } from "../../store/model";
import { AssumptionField } from "./AssumptionField";
import { t } from "../../lib/i18n";

/** Rendert eine Auswahl von PRICE_GROUPS als Annahme-Karten (wiederverwendbar in
 *  Maschinen-Hub, Leistungsparameter, Anbauplan, Makro & Finanzen). */
export function AssumptionGroupCards({ groups }: { groups: string[] }) {
  const domain = useModelStore((s) => s.domain);
  const byName = new Map(PRICE_GROUPS.map((g) => [g.group, g]));
  const list = groups.map((n) => byName.get(n)).filter(Boolean) as typeof PRICE_GROUPS;
  return (
    <div className="space-y-4">
      {list.map((g) => (
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
