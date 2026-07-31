"use client";
import React from "react";
import { Segmented } from "../primitives/Segmented";
import { AssumptionGroupCards } from "./AssumptionGroupCards";
import { MaschinenSizingView } from "./MaschinenSizingView";
import { t } from "../../lib/i18n";

/** Performance Review — der Abgleich zwischen NOTWENDIGEM Maschinen-/Leistungsbedarf
 *  (aus Anbauplan × Performance-Treibern) und dem BESTAND → Auslastung/Reserve/Engpass und
 *  Investitions-Vorschlag (Neu = Bedarf − Bestand). Kette: Performance Review → Investitionen
 *  → Maschinenbestand. Zweiter Tab: Transport/Logistik-Treiber. */
type Tab = "maschine" | "transport";
export function LeistungsparameterView() {
  const [tab, setTab] = React.useState<Tab>("maschine");
  return (
    <div className="space-y-4">
      <div className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Performance Review — Maschinenbedarf ↔ Bestand → Investitions-Vorschlag")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">{t("Bedarf aus Kulturen × Leistung · Abgleich mit Bestand · Vorschlag Neu")}</span>
        </div>
        {tab === "maschine" && (
          <div className="px-4 py-2.5 text-[12px] text-nx-text-secondary border-b" style={{ borderColor: "var(--nx-border-divider)" }}>
            {t("Je Maschinenklasse: der notwendige Bedarf (aus Anbauplan × Performance-Treibern: Breite/Geschwindigkeit/Effizienz, Feldtage, Schichten) gegen den heutigen ")}<b>{t("Bestand")}</b>{t(" → Auslastung, Reserve/Engpass und der Vorschlag ")}<b style={{ color: "var(--nx-locate)" }}>{t("Neu = Bedarf − Bestand")}</b>{t(". Der Vorschlag fließt bepreist in die Investitionen und ergänzt den Maschinenbestand.")}
          </div>
        )}
        <div className="overflow-x-auto px-4 py-3">
          <Segmented ariaLabel={t("Leistungs-Kategorie")} value={tab} onChange={(v) => setTab(v as Tab)}
            options={[
              { value: "maschine", label: t("Maschinenbedarf ↔ Bestand") },
              { value: "transport", label: t("Transport & Logistik") },
            ]} />
        </div>
      </div>
      {tab === "maschine"
        ? <>
            <MaschinenSizingView />
            <AssumptionGroupCards groups={["Spritzstrategie (fenstergetrieben)", "Einsatzplanung & Wertkultur-Bottom-up"]} />
          </>
        : <AssumptionGroupCards groups={["Transport/Logistik"]} />}
    </div>
  );
}
