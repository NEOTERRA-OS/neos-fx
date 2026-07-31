"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { PRICE_GROUPS, readScenarioConst, setScenarioConst } from "../../store/model";
import { ScenarioStudioView } from "./ScenarioStudioView";
import { NumberInput } from "./NumberInput";
import { fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import { ChevronDown, ChevronRight, Search, RotateCcw } from "lucide-react";

/** ANNAHMEN-SHEET — das zentrale Steuerungsinstrument.
 *
 *  Der Kern: jede Annahme EINE Zeile, Base · Best · Worst als drei editierbare Spalten
 *  nebeneinander. Damit sind Szenarien keine eigene Ansicht mehr, sondern die Spalten des
 *  Sheets — man steuert sie dort, wo der Treiber steht. Vorher zeigte das Register immer nur
 *  das oben gewählte Szenario; wer das Band pflegen wollte, musste dreimal umschalten und
 *  konnte nie sehen, wie weit Best und Worst auseinanderliegen.
 *
 *  LEER heißt "erbt von Base". Eine Zahl heißt "bewusst abweichend". Diese Unterscheidung ist
 *  wichtig: nur so ist erkennbar, welche Treiber überhaupt ein Szenario-Band tragen — und
 *  welche stillschweigend in allen drei Fällen gleich sind.
 *
 *  Aufbau: Cockpit (die tatsächlich gesteuerten Treiber) → vollständiges Sheet nach Gruppen →
 *  Szenario-Studio mit Reglern, Sensitivität und gespeicherten Szenarien, einklappbar.
 */

/** Die Treiber, an denen im Gespräch wirklich gedreht wird — angeheftet über dem Sheet. */
const COCKPIT: { key: string; label: string }[] = [
  { key: "price.kartoffel_pommes", label: "Preis Kartoffel Pommes" },
  { key: "price.kartoffel_chips", label: "Preis Kartoffel Chips" },
  { key: "price.tomate", label: "Preis Industrietomate" },
  { key: "yield.kartoffel_pommes", label: "Ertrag Kartoffel Pommes" },
  { key: "yield.tomate", label: "Ertrag Industrietomate" },
  { key: "wc.dso", label: "Zahlungsziel (Tage)" },
  { key: "advance.rate", label: "Anzahlungsquote" },
  { key: "lohn.factor", label: "Lohnarbeit — Satz-Faktor" },
  { key: "irrig.capex_from_year", label: "Beregnungs-CAPEX ab Planjahr" },
  { key: "store.active", label: "Lager/Packhaus aktiv" },
  { key: "macro.euribor", label: "Euribor" },
  { key: "infl.input", label: "Inflation Inputkosten" },
];

const SC = [
  { id: "sc-base", label: "Base", color: "var(--nx-text)" },
  { id: "sc-best", label: "Best", color: "var(--nx-success)" },
  { id: "sc-worst", label: "Worst", color: "var(--nx-error)" },
] as const;

/** Anzeige-Faktor je Einheit: Raten als %, Geld in €. */
function scale(unit: string): { f: number; suffix: string; dec: number } {
  if (unit === "rate") return { f: 100, suffix: "%", dec: 2 };
  if (unit === "money" || unit === "money_per_ha" || unit === "money_per_tonne") return { f: 0.01, suffix: "€", dec: 2 };
  return { f: 1, suffix: "", dec: 2 };
}

function BandZelle({ keyName, scenarioId, unit }: { keyName: string; scenarioId: string; unit: string }) {
  const { domain, patch } = useModelStore();
  const eigen = readScenarioConst(domain, keyName, scenarioId);
  const basis = readScenarioConst(domain, keyName, domain.baseScenarioId);
  const istBase = scenarioId === domain.baseScenarioId;
  const s = scale(unit);
  const wert = eigen ?? basis;
  const erbt = !istBase && eigen === null;

  if (wert === null) return <span className="num text-[11px] text-nx-text-muted">{t("Kurve")}</span>;

  return (
    <span className="inline-flex items-center gap-1">
      <NumberInput
        value={Number((wert * s.f).toFixed(s.dec))}
        width={78}
        decimals={s.dec}
        suffix={s.suffix || undefined}
        onCommit={(v) => patch((d) => setScenarioConst(d, keyName, scenarioId, v / s.f))}
      />
      {!istBase && (
        erbt
          ? <span className="text-[10px] text-nx-text-muted" title={t("erbt von Base — Zahl eingeben, um bewusst abzuweichen")}>=</span>
          : <button className="text-[10px] text-nx-text-muted hover:text-nx-error" title={t("Eigenwert entfernen — wieder von Base erben")}
              onClick={() => patch((d) => setScenarioConst(d, keyName, scenarioId, null))}>
              <RotateCcw size={11} />
            </button>
      )}
    </span>
  );
}

function Zeile({ keyName }: { keyName: string }) {
  const domain = useModelStore((s) => s.domain);
  const a = domain.assumptions[keyName];
  if (!a) return null;
  const unit = String(a.unit ?? "");
  const bandbreite = (() => {
    const b = readScenarioConst(domain, keyName, "sc-base");
    const be = readScenarioConst(domain, keyName, "sc-best") ?? b;
    const w = readScenarioConst(domain, keyName, "sc-worst") ?? b;
    if (b === null || be === null || w === null || b === 0) return null;
    return Math.abs(be - w) / Math.abs(b);
  })();
  return (
    <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
      <td className="px-3 py-1.5">
        <span>{t(a.label)}</span>
        <span className="ml-2 text-[10px] text-nx-text-muted">{keyName}</span>
      </td>
      {SC.map((s) => (
        <td key={s.id} className="px-2 py-1.5 text-right">
          <BandZelle keyName={keyName} scenarioId={s.id} unit={unit} />
        </td>
      ))}
      <td className="num px-3 py-1.5 text-right text-[11px]"
          style={{ color: bandbreite == null ? "var(--nx-text-muted)" : bandbreite > 0.3 ? "var(--nx-warning)" : "var(--nx-text-muted)" }}
          title={t("Spannweite Best↔Worst, relativ zu Base — wie viel Unsicherheit steckt in diesem Treiber")}>
        {bandbreite == null ? "–" : `± ${fmtNumber(bandbreite * 100, 0)} %`}
      </td>
    </tr>
  );
}

export function AnnahmenSheetView() {
  const domain = useModelStore((s) => s.domain);
  const [suche, setSuche] = React.useState("");
  const [offen, setOffen] = React.useState<Record<string, boolean>>({});
  const [studioAuf, setStudioAuf] = React.useState(false);

  const q = suche.trim().toLowerCase();
  const gruppen = React.useMemo(() => PRICE_GROUPS.map((g) => ({
    group: g.group,
    keys: g.keys.filter((k) => {
      const a = domain.assumptions[k];
      if (!a) return false;
      if (!q) return true;
      return k.toLowerCase().includes(q) || String(a.label).toLowerCase().includes(q);
    }),
  })).filter((g) => g.keys.length), [domain, q]);

  const th = "px-3 py-2 caption text-[10px] text-nx-text-muted";
  const card: React.CSSProperties = { borderColor: "var(--nx-border)", background: "var(--nx-surface)" };
  const treffer = gruppen.reduce((s, g) => s + g.keys.length, 0);

  return (
    <div className="space-y-4">
      {/* ---- Kopf + Cockpit ------------------------------------------------ */}
      <section className="rounded-tile border" style={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--nx-border)" }}>
          <div>
            <h2 className="text-[14px] font-semibold">{t("Annahmen — zentrales Steuerungsinstrument")}</h2>
            <p className="mt-0.5 text-[11px] text-nx-text-muted">
              {t("Jede Annahme eine Zeile, Base · Best · Worst nebeneinander. Ein leeres Feld heißt „erbt von Base\" — eine Zahl heißt „bewusst abweichend\". Szenarien werden hier gesteuert, nicht in einer eigenen Ansicht.")}
            </p>
          </div>
          <label className="inline-flex items-center gap-2 rounded-control border px-2" style={{ height: 30, borderColor: "var(--nx-border)" }}>
            <Search size={13} className="text-nx-text-muted" />
            <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder={t("Treiber suchen …")}
              className="border-0 bg-transparent text-[12px] outline-none" style={{ width: 190, color: "var(--nx-text)" }} />
          </label>
        </div>

        <div className="px-4 py-3">
          <div className="caption mb-2 text-[10px] font-semibold text-nx-text-muted">{t("Cockpit — die Treiber, an denen wirklich gedreht wird")}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr>
                  <th className={th + " text-left"}>{t("Treiber")}</th>
                  {SC.map((s) => <th key={s.id} className={th + " text-right"} style={{ color: s.color }}>{s.label}</th>)}
                  <th className={th + " text-right"}>{t("Spannweite")}</th>
                </tr>
              </thead>
              <tbody>
                {COCKPIT.filter((c) => domain.assumptions[c.key]).map((c) => <Zeile key={c.key} keyName={c.key} />)}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---- Vollständiges Sheet ------------------------------------------- */}
      <section className="rounded-tile border" style={card}>
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Alle Treiber nach Gruppen")}</h3>
          <span className="caption text-[10px] text-nx-text-muted">{treffer} {t("Treiber")}</span>
        </div>
        {gruppen.map((g) => {
          const auf = q ? true : (offen[g.group] ?? false);
          return (
            <div key={g.group}>
              <button className="flex w-full items-center gap-2 border-b px-4 py-2 text-left text-[12px] font-semibold"
                style={{ borderColor: "var(--nx-border-divider)", color: "var(--nx-text-secondary)", background: "var(--nx-app-bg)" }}
                onClick={() => setOffen((o) => ({ ...o, [g.group]: !auf }))}>
                {auf ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {t(g.group)}
                <span className="ml-auto caption text-[10px] text-nx-text-muted">{g.keys.length}</span>
              </button>
              {auf && (
                <div className="overflow-x-auto px-2 py-1">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr>
                        <th className={th + " text-left"}>{t("Treiber")}</th>
                        {SC.map((s) => <th key={s.id} className={th + " text-right"} style={{ color: s.color }}>{s.label}</th>)}
                        <th className={th + " text-right"}>{t("Spannweite")}</th>
                      </tr>
                    </thead>
                    <tbody>{g.keys.map((k) => <Zeile key={k} keyName={k} />)}</tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {!gruppen.length && (
          <div className="px-4 py-6 text-center text-[12px] text-nx-text-muted">{t("Kein Treiber passt zur Suche.")}</div>
        )}
      </section>

      {/* ---- Szenario-Studio: Regler, Sensitivität, gespeicherte Szenarien --- */}
      <section className="rounded-tile border" style={card}>
        <button className="flex w-full items-center gap-2 px-4 py-3 text-left"
          onClick={() => setStudioAuf((v) => !v)}>
          {studioAuf ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[13px] font-semibold">{t("Szenario-Studio — Regler, Sensitivität, gespeicherte Szenarien")}</span>
          <span className="ml-auto text-[11px] text-nx-text-muted">
            {t("Risiko- und Marktregler, Tornado-Analyse und benannte Varianten des ganzen Annahmensatzes")}
          </span>
        </button>
        {studioAuf && (
          <div className="border-t px-1 py-2" style={{ borderColor: "var(--nx-border)" }}>
            <ScenarioStudioView />
          </div>
        )}
      </section>
    </div>
  );
}
