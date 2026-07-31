"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import { fmtEditable, parseDe } from "../../design/format";
import type { Unit } from "../../core/types";
import { t } from "../../lib/i18n";

const MONEY: Unit[] = ["money", "money_per_ha", "money_per_tonne"];
export const UNIT_LABEL: Partial<Record<Unit, string>> = {
  money: "€", money_per_ha: "€/ha", money_per_tonne: "€/t", rate: "×", days: "Tage",
  tonne_per_ha: "t/ha", count: "Stk", hectare: "ha", tonne: "t", months: "Mon.",
};

function toDisplay(unit: Unit, raw: number) { return MONEY.includes(unit) ? raw / 100 : raw; }
function fromDisplay(unit: Unit, shown: number) { return MONEY.includes(unit) ? Math.round(shown * 100) : shown; }

/** E2 input cell: NEOS input field, locate-blue value = "hier tippen". Writes the
 *  assumption's constant value for the active scenario → composer → recalc. */
export function AssumptionField({ akey, compact }: { akey: string; compact?: boolean }) {
  const { domain, view, patch } = useModelStore();
  const a = domain.assumptions[akey];
  const scenarioId = view.scenarioId;
  const raw = readAssumption(domain, akey, scenarioId);
  const unit = (a?.unit ?? "count") as Unit;
  const override = !!a?.scenarioProfiles[scenarioId] && scenarioId !== domain.baseScenarioId;

  const anzeige = raw === null ? "" : fmtEditable(toDisplay(unit, raw));
  const [text, setText] = React.useState(anzeige);
  React.useEffect(() => { setText(anzeige); }, [raw, scenarioId, unit]);

  if (!a) return <span className="num text-[11px] text-nx-error">?{akey}</span>;

  // Kappen wir die Anzeige auf zwei Nachkommastellen, darf ein blosses Verlassen des
  // Feldes den Wert NICHT auf die gerundete Zahl festschreiben. Deshalb: nur committen,
  // wenn der Text sich gegenueber der gerenderten Darstellung tatsaechlich geaendert hat.
  const commit = (v: string) => {
    if (v === anzeige) return;
    const num = parseDe(v);
    if (num === null) return;
    const stored = fromDisplay(unit, num);
    patch((d) => { d.assumptions[akey].scenarioProfiles[scenarioId] = { kind: "constant", value: stored }; });
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        className="num rounded-control border px-2 text-right text-[12.5px]"
        style={{
          background: "var(--nx-app-bg)", borderColor: "var(--nx-border)",
          color: "var(--nx-locate)", fontWeight: 600, height: 34, width: compact ? 82 : 110,
        }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        inputMode="decimal"
        aria-label={a.label}
        title={t("Eingabe → Recalc")}
      />
      {!compact && <span className="w-[34px] text-[11px] text-nx-text-muted">{UNIT_LABEL[unit] ?? ""}</span>}
      {override && (
        <span className="num rounded-pill px-1 text-[9px] font-bold" style={{ background: "var(--nx-warning-bg)", color: "var(--nx-warning-text)" }} title={t("Szenario-Override")}>OVR</span>
      )}
    </span>
  );
}
