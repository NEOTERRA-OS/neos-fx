"use client";
import React from "react";
import { NeoterraLogo } from "./NeoterraLogo";
import { t } from "../../lib/i18n";
import {
  LayoutDashboard, Sprout, Route, BookOpen, ClipboardList, Tractor, Gauge, CalendarRange, RefreshCw,
  TrendingUp, Users, Briefcase, Clock, Landmark, BadgeEuro, Building2, Workflow, Tornado, ScrollText,
  SlidersHorizontal, LineChart, Scale, Activity, Wallet, Percent, PieChart, GitCompare, Calculator,
  CircleDollarSign, Save, Circle, Coins, ArrowUpFromDot, Network, FlaskConical, ClipboardCheck, MessageSquare, UserCog, type LucideIcon,
} from "lucide-react";

/** NEOS Sidebar — pixelgenau nach NEOS Sidebar DS (extrahiert aus NEOS Snap/Index).
 *  Klassen aus design/neos-sidebar.css (.nsb / .nsb-brand / .nsb-grp / .nsb-item …).
 *  Chrome immer Marke (Light #2C3C2B / Dark #080C08), Aktiv-Kachel flaches Gelb. */

export type ViewId =
  | "dashboard" | "preise" | "anbauplan" | "maschinen" | "leistung"
  | "personal" | "arbeitszeit" | "finanzierung" | "subventionen" | "holding" | "eroeffnung" | "kulturkalk" | "investitionen"
  | "einsatz" | "sensitivitaet" | "bewertung" | "contribution" | "overhead" | "verwaltung"
  | "mehrjahr" | "ersatz" | "liquiditaet" | "shareholder" | "pacht" | "anbaustrategie" | "hebel"
  | "gesellschaften" | "capexScenarien" | "pnl" | "balance" | "cashflow" | "produktkatalog" | "annahmen" | "kommentare" | "team";

type Item = { id: string; label: string; view?: ViewId };
type Group = { title: string; items: Item[] };

const IA: Group[] = [
  { title: "Steuerung", items: [
    { id: "dashboard", label: "Executive Dashboard", view: "dashboard" },
  ]},
  { title: "Annahmen & Kulturen", items: [
    { id: "anbauplan", label: "Anbauplan & Erträge", view: "anbauplan" },
    { id: "kulturkalk", label: "Kultur-Kalkulation (Maßnahmen + Katalog)", view: "kulturkalk" },
    { id: "produktkatalog", label: "Produktkatalog (Dünger · PSM · Sorten)", view: "produktkatalog" },
    { id: "anbaustrategie", label: "Anbaustrategie & Fruchtfolge", view: "anbaustrategie" },
    { id: "hebel", label: "Wertkulturen-Hebel (Gesellschafter)", view: "hebel" },
  ]},
  { title: "Maschinen & Flotte", items: [
    { id: "leistung", label: "Performance Review", view: "leistung" },
    { id: "investitionen", label: "Investitionen (Bedarf & Vorschlag)", view: "investitionen" },
    { id: "maschinen", label: "Maschinenbestand (Anlagenregister)", view: "maschinen" },
    { id: "capexScenarien", label: "CAPEX Szenarien", view: "capexScenarien" },
    { id: "einsatz", label: "Einsatzplanung", view: "einsatz" },
    { id: "ersatz", label: "Ersatzinvestitionen", view: "ersatz" },
  ]},
  { title: "Wachstum", items: [
    { id: "mehrjahr", label: "Wachstum & Mehrjahresplan", view: "mehrjahr" },
  ]},
  { title: "Personal", items: [
    { id: "personal", label: "Personalplanung", view: "personal" },
    { id: "overhead", label: "Overhead / SG&A", view: "overhead" },
    { id: "arbeitszeit", label: "Arbeitszeitkonto", view: "arbeitszeit" },
  ]},
  { title: "Financials", items: [
    { id: "finanzierung", label: "Finanzierung", view: "finanzierung" },
    { id: "subventionen", label: "Subventionen", view: "subventionen" },
    { id: "holding", label: "Holding (Zypern)", view: "holding" },
    { id: "eroeffnung", label: "Eröffnungsbilanz", view: "eroeffnung" },
    { id: "pacht", label: "Pacht-Simulator", view: "pacht" },
    { id: "preise", label: "Makro & Finanzen", view: "preise" },
    { id: "pnl", label: "GuV", view: "pnl" },
    { id: "balance", label: "Bilanz", view: "balance" },
    { id: "cashflow", label: "Cashflow", view: "cashflow" },
    { id: "liquiditaet", label: "Liquidität & USt/TVA", view: "liquiditaet" },
  ]},
  { title: "Analyse", items: [
    { id: "contribution", label: "Contribution", view: "contribution" },
    { id: "sens", label: "Sensitivität", view: "sensitivitaet" },
    { id: "val", label: "Bewertung (DCF)", view: "bewertung" },
    { id: "shareholder", label: "Equity & Ausschüttung", view: "shareholder" },
  ]},
  { title: "Verwaltung", items: [
    { id: "annahmen", label: "Annahmen-Register (Team-Review)", view: "annahmen" },
    { id: "kommentare", label: "Kommentare", view: "kommentare" },
    { id: "gesellschaften", label: "Gesellschaften-Register", view: "gesellschaften" },
    { id: "team", label: "Team & Zugriff", view: "team" },
    { id: "verwaltung", label: "Speichern & Versionen", view: "verwaltung" },
  ]},
];

/** Sidebar-Icons — echte Lucide-Icons (konsistent, currentColor). */
const ICON: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, anbauplan: Sprout, kulturkalk: ClipboardList, produktkatalog: FlaskConical, anbaustrategie: Route, hebel: ArrowUpFromDot,
  maschinen: Tractor, investitionen: Coins, leistung: Gauge, einsatz: CalendarRange,
  capexScenarien: GitCompare,
  ersatz: RefreshCw, mehrjahr: TrendingUp, personal: Users, overhead: Briefcase, arbeitszeit: Clock,
  finanzierung: Landmark, subventionen: BadgeEuro, gesellschaften: Network, holding: Building2, eroeffnung: BookOpen,
  pacht: ScrollText, preise: SlidersHorizontal, pnl: LineChart, balance: Scale, cashflow: Activity,
  liquiditaet: Wallet, contribution: PieChart, sens: Tornado, val: Calculator,
  shareholder: CircleDollarSign, verwaltung: Save, annahmen: ClipboardCheck, kommentare: MessageSquare, team: UserCog,
};

const Ic = ({ id }: { id: string }) => {
  const Comp = ICON[id] ?? Circle;
  return <Comp size={18} strokeWidth={2} aria-hidden />;
};

export function Sidebar({
  active, onSelect, theme, onToggleTheme, readOnly, onToggleReadOnly,
}: { active: ViewId; onSelect: (v: ViewId) => void; theme?: "light" | "dark"; onToggleTheme?: () => void; readOnly?: boolean; onToggleReadOnly?: () => void }) {
  return (
    <aside className="nsb" aria-label={t("Hauptnavigation")}>
      <button type="button" className="nsb-brand" onClick={() => onSelect("dashboard")} title={t("Zum Dashboard")}>
        <span className="nsb-logo" style={{ width: 28, height: 28, background: "var(--nsb-accent)", borderRadius: "22%", display: "grid", placeItems: "center", color: "#2C3C2B" }}>
          <svg width="56%" height="56%" viewBox="0 0 30.88 30.86" fill="currentColor" aria-hidden>
            <path d="M0,9.78c0-1.36.26-2.64.77-3.83.51-1.19,1.21-2.22,2.1-3.11s1.92-1.58,3.11-2.08c1.19-.51,2.46-.76,3.8-.76v9.78H0ZM0,20.29v-9.78h9.78v9.78H0ZM0,30.86v-9.78h9.78v9.78H0ZM10.54,9.78V0h9.78v9.78h-9.78ZM10.54,20.29v-9.78h9.78v9.78h-9.78ZM30.11,3.8c-.51,1.19-1.22,2.22-2.11,3.11-.89.88-1.93,1.58-3.12,2.1-1.19.51-2.46.77-3.83.77V0h9.83c0,1.35-.26,2.62-.77,3.8ZM21.05,20.29v-9.78h9.83v9.78h-9.83Z" />
          </svg>
        </span>
        <span><b>NEOS</b> <span className="sub">FX</span></span>
      </button>

      {IA.map((g) => (
        <React.Fragment key={g.title}>
          <div className="nsb-grp">{t(g.title)}</div>
          {g.items.map((it) => (
            <button
              key={it.id}
              className={"nsb-item" + (it.view && it.view === active ? " is-active" : "")}
              onClick={() => it.view && onSelect(it.view)}
            >
              <span className="nsb-ic"><Ic id={it.id} /></span>
              <span>{t(it.label)}</span>
            </button>
          ))}
        </React.Fragment>
      ))}

      <div className="nsb-spacer" />

      <div className="nsb-user" style={{ marginTop: 18 }}>
        <span className="nsb-av">BF</span>
        <div className="nsb-id">
          <div className="nm">Benedikt Förtig</div>
          <div className="ml">bf@neoterra.ag</div>
        </div>
        {onToggleReadOnly && (
          <button className="nsb-iconbtn" onClick={onToggleReadOnly} title={readOnly ? t("Bearbeiten aktivieren") : t("Betrachter-Modus (schreibgeschützt)")} aria-label={t("Betrachter-Modus")}
            style={{ color: readOnly ? "var(--nsb-accent)" : undefined }}>
            {readOnly
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></svg>}
          </button>
        )}
        {onToggleTheme && (
          <button className="nsb-iconbtn" onClick={onToggleTheme} title={theme === "dark" ? t("Hell") : t("Dunkel")} aria-label={t("Theme umschalten")}>
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
            )}
          </button>
        )}
      </div>

      {/* Footer — Zugehörigkeit zur Marke: NEOS FX ist das Planungsmodell von neoterra. */}
      <div
        className="flex flex-col gap-1.5 px-4 pb-4"
        style={{ marginTop: 14, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,.08)" }}
      >
        <span style={{ fontSize: 10, lineHeight: 1.2, color: "rgba(255,255,255,.42)", letterSpacing: ".01em" }}>
          {t("NEOS FX · powered by")}
        </span>
        <NeoterraLogo height={13} style={{ color: "rgba(255,255,255,.72)" }} />
      </div>
    </aside>
  );
}
