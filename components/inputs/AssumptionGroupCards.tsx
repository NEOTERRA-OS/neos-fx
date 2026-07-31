"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { PRICE_GROUPS, ASSUMPTION_NOTE } from "../../store/model";
import { Feld } from "./Feld";
import { einheit } from "../../design/units";
import { t } from "../../lib/i18n";

/** ANNAHME-KARTEN — Ausschnitte aus dem Annahmen-Register, gerendert im gemeinsamen
 *  Zeilenschema: Treiber · Einheit · Wert · Marker.
 *
 *  Vorher: Label und Feld in einem `justify-between`-Paar, zwei Paare je Zeile. Weil das
 *  Label beliebig breit ist, landete jedes Feld an einer anderen Stelle, und die Einheit
 *  stand als Zeichen HINTER dem Feld — was die Zahlenachse zusätzlich um ihre Breite
 *  verschob. Ergebnis: vier Spalten, von denen keine untereinander stand.
 *
 *  Jetzt trägt ein einziges Raster alle Spalten: Treiber (dehnbar), Einheit (fest),
 *  Wert (fest, rechtsbündig), Marker (fest). Auf großen Schirmen laufen zwei Blöcke
 *  nebeneinander — im SELBEN Raster, damit auch über die Blockgrenze hinweg alles fluchtet. */
export function AssumptionGroupCards({ groups }: { groups: string[] }) {
  const domain = useModelStore((s) => s.domain);
  const byName = new Map(PRICE_GROUPS.map((g) => [g.group, g]));
  const list = groups.map((n) => byName.get(n)).filter(Boolean) as typeof PRICE_GROUPS;


  return (
    <div className="space-y-4">
      {list.map((g) => (
        <section key={g.group} className="rounded-tile border"
          style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)", boxShadow: "var(--nx-el-card)" }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
            <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{g.group}</h3>
            <span className="num text-[10.5px] text-nx-text-muted">{g.keys.length} {t("Felder")}</span>
          </div>
          <div className="grid items-center gap-x-3 px-4 py-1 grid-cols-[minmax(0,1fr)_46px_auto] lg:grid-cols-[minmax(0,1fr)_46px_auto_minmax(0,1fr)_46px_auto] lg:gap-x-5">
            {g.keys.map((k) => {
              const a = domain.assumptions[k];
              const e = einheit(a?.unit);
              return (
                <React.Fragment key={k}>
                  <span className="min-w-0 truncate border-b py-2 text-[12.5px] text-nx-text-secondary"
                    style={{ borderColor: "var(--nx-border-divider)" }}
                    title={[a?.label ?? k, ASSUMPTION_NOTE[k], k].filter(Boolean).join("  ·  ")}>{a?.label ?? k}</span>
                  <span className="border-b py-2 text-[11px] text-nx-text-muted"
                    style={{ borderColor: "var(--nx-border-divider)" }} title={e.lang}>{e.kurz}</span>
                  <span className="flex justify-end border-b py-1.5" style={{ borderColor: "var(--nx-border-divider)" }}>
                    <Feld akey={k} breite={104} einheitZeigen={false} />
                  </span>
                </React.Fragment>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
