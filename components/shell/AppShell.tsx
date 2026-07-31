"use client";
import React from "react";
import { Sidebar, ViewId } from "./Sidebar";
import { TopBar } from "./TopBar";
import { StatementView } from "../statements/Statements";
import { PreiseView } from "../inputs/PreiseView";
import { AnbauplanView } from "../inputs/AnbauplanView";
import { KulturKalkulationView } from "../inputs/KulturKalkulationView";
import { ProduktkatalogView } from "../inputs/ProduktkatalogView";
import { AnnahmenRegisterView } from "../inputs/AnnahmenRegisterView";
import { KommentareView } from "../inputs/KommentareView";
import { TeamAdminView } from "../inputs/TeamAdminView";
import { getSupabase } from "../../lib/supabaseClient";
import { t } from "../../lib/i18n";
import { Lock } from "lucide-react";
import { MaschinenView } from "../inputs/MaschinenView";
import { MaschinenHub } from "../inputs/MaschinenHub";
import { InvestitionenView } from "../inputs/InvestitionenView";
import { LeistungsparameterView } from "../inputs/LeistungsparameterView";
import { PersonalView } from "../inputs/PersonalView";
import { FinanzierungView } from "../inputs/FinanzierungView";
import { SubventionenView } from "../inputs/SubventionenView";
import { EroeffnungsbilanzView } from "../inputs/EroeffnungsbilanzView";
import { ArbeitszeitkontoView } from "../inputs/ArbeitszeitkontoView";
import { ScenarioStudioView } from "../inputs/ScenarioStudioView";
import { HoldingView } from "../inputs/HoldingView";
import { GesellschaftenView } from "../inputs/GesellschaftenView";
import { BewertungView } from "../inputs/BewertungView";
import { ShareholderView } from "../inputs/ShareholderView";
import { LohnarbeitView } from "../inputs/LohnarbeitView";
import { PachtView } from "../inputs/PachtView";
import { AnbaustrategieView } from "../inputs/AnbaustrategieView";
import { AbnahmevertraegeView } from "../inputs/AbnahmevertraegeView";
import { LagerKostenstelleView } from "../inputs/LagerKostenstelleView";
import { CapexScenarienView } from "../inputs/CapexScenarienView";
import { ContributionView } from "../inputs/ContributionView";
import { OverheadView } from "../inputs/OverheadView";
import { EinsatzView } from "../inputs/EinsatzView";
import { VerwaltungView } from "../inputs/VerwaltungView";
import { MehrjahresplanView } from "../inputs/MehrjahresplanView";
import { ErsatzView } from "../inputs/ErsatzView";
import { LiquiditaetView } from "../inputs/LiquiditaetView";
import { ExecutiveDashboard } from "../dashboard/ExecutiveDashboard";
import { CheckPanel } from "../statements/CheckPanel";
import { KpiBand } from "../kpi/KpiBand";
import { useModelStore, selectComputed, selectComputedAnnual } from "../../store/modelStore";
import { deriveMassnahmenChecks, type Domain } from "../../store/model";
import { autoLoadLatest, autoSave, getMyMaxRole, localLoad, localSave } from "../../store/persistence";

export function AppShell() {
  const [theme, setTheme] = React.useState<"light" | "dark">("dark"); // Default: Dark Mode
  const [view, setView] = React.useState<ViewId>("dashboard");
  const currency = useModelStore((s) => s.view.currency);
  // Sprache abonnieren → bei Wechsel rendert der ganze Baum neu (t()/fmtMoney lesen Modul-Globals).
  const lang = useModelStore((s) => s.view.lang);
  void lang;
  const computed = useModelStore(selectComputed);
  const annual = useModelStore(selectComputedAnnual);
  const domain = useModelStore((s) => s.domain);
  const readOnly = useModelStore((s) => s.readOnly);
  const setReadOnly = useModelStore((s) => s.setReadOnly);
  const setEditor = useModelStore((s) => s.setEditor);
  // Domain-Konsistenz-Checks (Maßnahmen ↔ Arbeitsgänge) zusätzlich zu den Engine-Checks.
  const allChecks = React.useMemo(() => [...computed.checks, ...deriveMassnahmenChecks(domain)], [computed, domain]);

  // Identität aus dem Login: eingeloggte E-Mail wird zum Autor/Bearbeiter (sonst session-lokaler Name).
  React.useEffect(() => {
    const sb = getSupabase(); if (!sb) return;
    // Reviewer-Rolle → automatisch Betrachter-Modus (Schreiben blockiert die RLS ohnehin).
    const applyRole = () => getMyMaxRole().then((r) => { if (r === "viewer") setReadOnly(true); }).catch(() => {});
    sb.auth.getSession().then(({ data }) => { const e = data.session?.user?.email; if (e) { setEditor(e); applyRole(); } });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => { const e = session?.user?.email; if (e) { setEditor(e); applyRole(); } });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Cloud-Persistenz: beim Start letzten Stand laden, danach jede Änderung entprellt sichern.
  const recalcTick = useModelStore((s) => s.recalcTick);
  const setCloud = useModelStore((s) => s.setCloud);
  const readyRef = React.useRef(false);
  React.useEffect(() => {
    let alive = true;
    const tickAtStart = useModelStore.getState().recalcTick;
    setCloud("load");
    // Timeout-Guard: nie im „lädt…"-Zustand hängen bleiben (z. B. Netz blockiert).
    const withTimeout = <T,>(p: Promise<T>, ms: number) =>
      Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
    // Nur anwenden, wenn der Nutzer zwischenzeitlich NICHTS geändert hat (kein Überschreiben).
    const applyIfUntouched = (d: Domain | null) => {
      if (d && useModelStore.getState().recalcTick === tickAtStart) useModelStore.getState().loadDomain(d);
    };
    // Cloud zuerst; ist sie nicht erreichbar (offline, lokale Datei, kein Login),
    // greift der lokale Auto-Save → das Modell ist ohne Deployment voll nutzbar.
    const fallbackLocal = () => {
      if (!alive) return;
      const d = localLoad();
      applyIfUntouched(d);
      readyRef.current = true;
      setCloud(d || localSave(useModelStore.getState().domain) ? "local" : "error");
    };
    withTimeout(autoLoadLatest(), 8000)
      .then((d) => {
        if (!alive) return;
        if (d) { applyIfUntouched(d); readyRef.current = true; setCloud("saved"); }
        else fallbackLocal();  // kein Cloud-Stand → lokalen Stand nehmen
      })
      .catch(fallbackLocal);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    if (!readyRef.current) return;
    setCloud("saving");
    const t = setTimeout(() => {
      const dom = useModelStore.getState().domain;
      const localOk = localSave(dom);           // immer zuerst lokal — überlebt Reload auch ohne Netz
      Promise.race([
        autoSave(dom),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000)),
      ])
        .then(() => setCloud("saved"))
        .catch(() => setCloud(localOk ? "local" : "error"));
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recalcTick]);
  const annualLabel = annual.timeline.periods[annual.timeline.periods.length - 1]?.label;
  // Verwaltungs-/Governance-Module: keine Kennzahlen-KPIs (kein Finanz-Kontext nötig).
  // Szenario-Studio: eigenes KPI-Band mit Δ gegen die Basis → globales Band würde doppeln.
  const ADMIN_VIEWS: ViewId[] = ["annahmen", "kommentare", "gesellschaften", "team", "verwaltung", "studio"];
  const showKpi = !ADMIN_VIEWS.includes(view);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-neos-theme", theme);
  }, [theme]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar active={view} onSelect={setView} theme={theme} onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        readOnly={readOnly} onToggleReadOnly={() => setReadOnly(!readOnly)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar theme={theme} onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))} />
        {readOnly && (
          <div className="flex items-center justify-between gap-3 px-6 py-1.5 text-[11.5px] font-semibold"
            style={{ background: "color-mix(in srgb, var(--nx-warn, #C9A227) 18%, transparent)", color: "var(--nx-warn, #C9A227)", borderBottom: "1px solid var(--nx-border)" }}>
            <span className="inline-flex items-center gap-1.5"><Lock size={12} strokeWidth={2.5} aria-hidden /> {t("Betrachter-Modus — Modell schreibgeschützt. Kommentieren bleibt möglich.")}</span>
            <button className="rounded-control border px-2 py-0.5 text-[11px]" style={{ borderColor: "currentColor" }} onClick={() => setReadOnly(false)}>{t("Bearbeiten aktivieren")}</button>
          </div>
        )}
        {showKpi && (
          <div className="px-6 pt-3 pb-1">
            <KpiBand annual={annual} currency={currency} periodLabel={annualLabel} />
          </div>
        )}
        <main className="flex-1 overflow-auto px-6 py-5">
          {view === "dashboard" ? (
            <ExecutiveDashboard />
          ) : (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
              {view === "preise" ? <PreiseView />
                : view === "anbauplan" ? <AnbauplanView />
                : view === "kulturkalk" ? <KulturKalkulationView />
                : view === "produktkatalog" ? <ProduktkatalogView />
                : view === "annahmen" ? <AnnahmenRegisterView />
                : view === "kommentare" ? <KommentareView />
                : view === "team" ? <TeamAdminView />
                : view === "anbaustrategie" ? <AnbaustrategieView />
                : view === "capexScenarien" ? <CapexScenarienView />
                : view === "maschinen" ? <MaschinenHub />
                : view === "investitionen" ? <InvestitionenView />
                : view === "leistung" ? <LeistungsparameterView />
                : view === "personal" ? <PersonalView />
                : view === "overhead" ? <OverheadView />
                : view === "finanzierung" ? <FinanzierungView />
                : view === "subventionen" ? <SubventionenView />
                : view === "mehrjahr" ? <MehrjahresplanView />
                : view === "ersatz" ? <ErsatzView />
                : view === "liquiditaet" ? <LiquiditaetView />
                : view === "lohnarbeit" ? <LohnarbeitView />
                : view === "holding" ? <HoldingView />
                : view === "gesellschaften" ? <GesellschaftenView />
                : view === "eroeffnung" ? <EroeffnungsbilanzView />
                : view === "arbeitszeit" ? <ArbeitszeitkontoView />
                : view === "einsatz" ? <EinsatzView />
                : view === "studio" ? <ScenarioStudioView />
                : view === "abnahme" ? <AbnahmevertraegeView />
                : view === "lagerkst" ? <LagerKostenstelleView />
                : view === "bewertung" ? <BewertungView />
                : view === "shareholder" ? <ShareholderView />
                : view === "pacht" ? <PachtView />
                : view === "contribution" ? <ContributionView />
                : view === "verwaltung" ? <VerwaltungView />
                : <StatementView view={view} computed={computed} currency={currency} />}
              <CheckPanel checks={allChecks} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
