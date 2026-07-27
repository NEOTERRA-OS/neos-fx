"use client";
import React from "react";
import { Segmented } from "../primitives/Segmented";
import { MaschinenView } from "./MaschinenView";
import { MaschinenTcoView } from "./MaschinenTcoView";
import { EffektivkostenView } from "./EffektivkostenView";
import { AssumptionGroupCards } from "./AssumptionGroupCards";
import { t } from "../../lib/i18n";

/** Maschinen-Hub — BESTAND & KOSTEN (Investitionen sind eine eigene Sidebar-Sicht):
 *  Register/Bestand · Einzelkosten (€/h) · Effektivkosten & TCO-Sätze · CAPEX-Szenarien.
 *  (Neupreise werden im Register je Maschine editiert — der frühere Doppel-Tab entfällt.) */
type Tab = "register" | "einzel" | "effektiv";
export function MaschinenHub() {
  const [tab, setTab] = React.useState<Tab>("register");
  return (
    <div className="space-y-4">
      <div className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Maschinenbestand & Kosten")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">{t("Bedarf & Neuanschaffungen → Sidebar „Investitionen\"")}</span>
        </div>
        <div className="overflow-x-auto px-4 py-3">
          <Segmented ariaLabel={t("Maschinen-Ansicht")} value={tab} onChange={(v) => setTab(v as Tab)}
            options={[
              { value: "register", label: t("Register / Bestand") },
              { value: "einzel", label: t("Einzelkosten €/h") },
              { value: "effektiv", label: t("Effektivkosten & TCO-Sätze") },
            ]} />
        </div>
      </div>
      {tab === "register" ? <MaschinenView />
        : tab === "einzel" ? <MaschinenTcoView />
        : (
          <div className="space-y-4">
            <EffektivkostenView />
            <AssumptionGroupCards groups={["TCO Maschinenkosten"]} />
          </div>
        )}
    </div>
  );
}
