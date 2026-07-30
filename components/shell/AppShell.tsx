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
import { HoldingView } from "../inputs/HoldingView";
import { GesellschaftenView } from "../inputs/GesellschaftenView";
import { FinanzierungView } from "../inputs/FinanzierungView";
import { SubventionenView } from "../inputs/SubventionenView";
import { EroeffnungsbilanzView } from "../inputs/EroeffnungsbilanzView";
import { ArbeitszeitkontoView } from "../inputs/ArbeitszeitkontoView";
import { SensitivitaetView } from "../inputs/SensitivitaetView";
import { ScenarioStudioView } from "../inputs/ScenarioStudioView";
import { BewertungView } from "../inputs/BewertungView";
import { ShareholderView } from "../inputs/ShareholderView";
import { PachtView } from "../inputs/PachtView";
import { AnbaustrategieView } from "../inputs/AnbaustrategieView";
import { WertkulturenHebelView } from "../inputs/WertkulturenHebelView";
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
import { StageSemanticsCard } from "../inputs/StageSemanticsCard";
import { useModelStore, selectComputed, selectComputedAnnual } from "../../store/modelStore";
import { deriveMassnahmenChecks } from "../../store/model";
import { autoLoadLatest, autoSave, getMyMaxRole } from "../../store/persistence";

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
    withTimeout(autoLoadLatest(), 8000)
      .then((d) => {
        if (!alive) return;
        // Nur anwenden, wenn der Nutzer zwischenzeitlich NICHTS geändert hat (kein Überschreiben).
        if (d && useModelStore.getState().recalcTick === tickAtStart) useModelStore.getState().loadDomain(d);
        readyRef.current = true;
        setCloud("saved");
      })
      .catch(() => { if (alive) { readyRef.current = true; setCloud("error"); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    if (!readyRef.current) return;
    setCloud("saving");
    const t = setTimeout(() => {
      Promise.race([
        autoSave(useModelStore.getState().domain),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000)),
      ])
        .then(() => setCloud("saved"))
        .catch(() => setCloud("error"));
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recalcTick]);
  const annualLabel = annual.timeline.periods[annual.timeline.periods.length - 1]?.label;
  // Verwaltungs-/Governance-Module: keine Kennzahlen-KPIs (kein Finanz-Kontext nötig).
  const ADMIN_VIEWS: ViewId[] = ["annahmen", "kommentare", "gesellschaften", "team", "verwaltung"];
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
        {view === "dashboard" && (
          <div className="px-6 pt-4 pb-1">
            <StageSemanticsCard floating />
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
                : view === "hebel" ? <WertkulturenHebelView />
                : view === "capexScenarien" ? <CapexScenarienView />
                : view === "maschinen" ? <MaschinenHub />
                : view === "investitionen" ? <InvestitionenView />
                : view === "leistung" ? <LeistungsparameterView />
                : view === "personal" ? <PersonalView />
                : view === "overhead" ? <OverheadView />
                : view === "holding" ? <HoldingView />
                : view === "gesellschaften" ? <GesellschaftenView />
                : view === "finanzierung" ? <FinanzierungView />
                : view === "subventionen" ? <SubventionenView />
                : view === "mehrjahr" ? <MehrjahresplanView />
                : view === "ersatz" ? <ErsatzView />
                : view === "liquiditaet" ? <LiquiditaetView />
                : view === "eroeffnung" ? <EroeffnungsbilanzView />
                : view === "arbeitszeit" ? <ArbeitszeitkontoView />
                : view === "einsatz" ? <EinsatzView />
                : view === "studio" ? <ScenarioStudioView />
                : view === "sensitivitaet" ? <SensitivitaetView />
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
