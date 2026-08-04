"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { CapexPositionen } from "./CapexPositionen";
import { fmtMoney } from "../../design/format";
import { START_YEAR } from "../../store/model";
import { t } from "../../lib/i18n";

/**
 * BAU & INFRASTRUKTUR — der Investitionsplan neben der Feldtechnik.
 *
 * Bis 04.08.2026 gab es diese Ansicht nicht, und deshalb gab es für Bewässerung
 * (8 Positionen) und Gebäude (8 Positionen) überhaupt keinen Editor. Die Zeilen
 * standen im Modell — mit Menge, Einheitspreis, Anschaffungsjahr, AfA und
 * Benchmark-Spanne — und niemand konnte sie ändern, obwohl der Elektrifizierungs-
 * posten im Kommentar als „größter Unsicherheitsposten, mit Angebot kalibrieren"
 * ausgewiesen ist. Kalibrieren konnte man ihn nur im Quelltext.
 *
 * Lager und Packhaus stehen bewusst NICHT hier, sondern bei der Kostenstelle
 * Lager & Packhaus: dort hängen Personal, Durchsatz und Deckungsbeitrag daran.
 * Eine Investition gehört zu der Rechnung, die sie trägt.
 */
export function BauInvestView() {
  const { domain } = useModelStore();
  const plan = domain.capexPlan ?? [];
  const aktiv = domain.capexPlanActive ?? {};
  const BLOCKS = ["maschinen", "bewaesserung", "gebaeude"] as const;

  const netto = (b: string) => plan.filter((p) => p.block === b && !p.bestand)
    .reduce((s, p) => s + Math.round(p.menge * p.eurProEinheitCent * (1 - Math.max(0, Math.min(1, p.subventionPct)))), 0);
  const zaehltSumme = BLOCKS.filter((b) => aktiv[b]).reduce((s, b) => s + netto(b), 0);
  const planSumme = BLOCKS.reduce((s, b) => s + netto(b), 0);

  /* Phasing über die Planjahre — die Frage, die man an einen Investitionsplan
     zuerst stellt: wann trifft es die Kasse? Nur scharfgeschaltete Blöcke. */
  const years = Math.max(1, domain.growth?.years ?? 1);
  const phasing = Array.from({ length: years }, (_, y) =>
    plan.filter((p) => BLOCKS.includes(p.block as typeof BLOCKS[number]) && aktiv[p.block] && !p.bestand && p.jahr === y)
      .reduce((s, p) => s + Math.round(p.menge * p.eurProEinheitCent * (1 - Math.max(0, Math.min(1, p.subventionPct)))), 0));
  const maxPh = Math.max(1, ...phasing);

  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Bau & Infrastruktur — Investitionsplan")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">
            {t("Lager & Packhaus stehen bei der Kostenstelle Nachernte")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-3" style={{ background: "var(--nx-border-divider)" }}>
          {[
            [t("Im Modell wirksam"), fmtMoney(zaehltSumme) + " €", t("scharfgeschaltete Blöcke")],
            [t("Gesamter Plan"), fmtMoney(planSumme) + " €", t("einschließlich reiner Planung")],
            [t("Spitzenjahr"), fmtMoney(maxPh) + " €", `${START_YEAR + phasing.indexOf(maxPh)}`],
          ].map(([k, v, s], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[13px] font-semibold">{v}</div>
              <div className="caption text-[9.5px] text-nx-text-muted">{s}</div>
            </div>
          ))}
        </div>
        {/* Phasing als Balken: eine Investition, die in einem Jahr zusammenfällt,
            zieht den Revolver durch — das sieht man hier, nicht in der Tabelle. */}
        <div className="flex items-end gap-1 px-4 py-3" style={{ height: 92 }}>
          {phasing.map((v, y) => (
            <div key={y} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${START_YEAR + y}: ${fmtMoney(v)} €`}>
              {/* Cent → Tausend Euro. Die erste Fassung rechnete durch drei Divisionen
                  und zeigte fuer 400.000 EUR die Zahl „4k" — beim Screenshot-Review
                  aufgefallen, nicht beim Schreiben. */}
              <span className="num text-[8.5px] text-nx-text-muted">{v ? Math.round(v / 100_000) + "k" : ""}</span>
              <div style={{ width: "72%", height: Math.max(2, (v / maxPh) * 46), background: v ? "var(--nx-brand-lift)" : "var(--nx-border)", borderRadius: 2 }} />
              <span className="num text-[9px] text-nx-text-muted">{START_YEAR + y}</span>
            </div>
          ))}
        </div>
      </section>

      <CapexPositionen
        blocks={[...BLOCKS]}
        hinweise={{
          maschinen: "Alles ohne Flächenleistung — Wetterstation, RTK-Basis, Vermessungsfahrzeug, Werkstattausrüstung, Sensorik/FMS. Feldmaschinen leitet der Maschinenpark aus den Arbeitsgängen ab; sie gehören NICHT hierher, sonst zählt dieselbe Maschine zweimal.",
          bewaesserung: "Nur relevant, wenn UNBEREGNETE Fläche zugepachtet wird — die heutige Pacht enthält die Pivots (750 €/ha). Der Block ist deshalb im Basisfall reine Planung. Elektrifizierung/MS-Anschluss ist der größte Unsicherheitsposten und mit einem Angebot zu kalibrieren.",
          gebaeude: "Hof, Halle, Werkstatt, Waage, Tankanlage, PV, Zaun. Die Preise tragen Benchmark-Spannen aus der Recherche — ein Warndreieck heißt: der Einheitspreis liegt außerhalb.",
        }}
      />
    </div>
  );
}
