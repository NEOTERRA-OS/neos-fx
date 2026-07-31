"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import {
  deriveMaschinenpark, setMachineOutsourced, setMachineRented, START_YEAR,
  type MaschinenPfad, type CapexPlanItem,
} from "../../store/model";
import { NumberInput, TextInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { cropColor } from "./cropCalc";
import { t } from "../../lib/i18n";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";

/** MASCHINENPARK — ein Screen für den ganzen Weg.
 *
 *  Vorher lag dieselbe Frage auf sechs Ansichten verteilt: Performance Review (Bedarf gegen
 *  Bestand), Investitionen (Vorschlag), Anlagenregister (Bestand), CAPEX-Szenarien,
 *  Ersatzinvestitionen und Lohnarbeit. Wer wissen wollte, was eine Maschine kostet und ob sie
 *  sich lohnt, musste vier davon nebeneinanderlegen.
 *
 *  Jetzt eine Zeile je Maschinenklasse und darin der ganze Gedankengang:
 *
 *    Leistung (Breite × Geschwindigkeit × Feldeffizienz → C_eff, alle drei editierbar)
 *      → Bedarfsstunden aus Überfahrten × Fläche des Planjahres
 *      → Stückzahl je Planjahr mit Zugang gegenüber Vorjahr
 *      → KAUFEN oder ZUMIETEN
 *      → Investition bzw. Lohnkosten
 *
 *  Die Kauf-/Miet-Entscheidung ist kein Etikett, sondern greift ins Modell: „zumieten"
 *  schaltet die Lohnarbeits-Zeilen dieser Maschine über alle Kulturen scharf. Die Engine
 *  bucht dann die Sätze als Direktkosten UND lässt den CAPEX weg — bedarfsJahrOf überspringt
 *  fremdvergebene Arbeitsgänge.
 *
 *  Der Vergleich ist bewusst symmetrisch: Eigenkosten je ha enthalten Diesel, also enthält
 *  auch der Lohnsatz Diesel. Und der Nenner ist die Fläche der Kulturen, die DIESE Maschine
 *  bedient — nicht die Betriebsfläche, sonst wird jeder Spezialroder künstlich billig.
 */

const CROP_LABEL: Record<string, string> = {
  kartoffel_pommes: "Kartoffel (Pommes)", kartoffel_chips: "Kartoffel (Chips)",
  tomate: "Industrietomate", zwiebel_moehre: "Zwiebel / Möhre",
  knollensellerie: "Knollensellerie", suesskartoffel: "Süßkartoffel", knoblauch: "Knoblauch",
};

export function MaschinenparkView() {
  const { domain, patch } = useModelStore();
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);
  const readOnly = useModelStore((s) => s.readOnly);
  const years = Math.max(1, domain.growth?.years ?? 1);
  const [auf, setAuf] = React.useState<string | null>(null);

  const park = React.useMemo(
    () => deriveMaschinenpark(domain, sc, years),
    [domain, sc, years, tick],
  );

  const Y = Array.from({ length: years }, (_, y) => y);
  const flaeche = (y: number) => domain.growth?.totalByYear?.[y] ?? domain.growth?.areaByYear?.[y] ?? 0;

  /** Investition = Zugänge × Preis. Gemietete Klassen investieren nichts. */
  const investOf = (m: MaschinenPfad) => {
    if (m.gemietet) return 0;
    let vor = 0, s = 0;
    for (const n of m.units) { if (n > vor) { s += (n - vor) * m.preisCent; vor = n; } }
    return s;
  };
  const capexOf = (m: MaschinenPfad, y: number) => {
    if (m.gemietet) return 0;
    const vor = y ? m.units[y - 1] : 0;
    return Math.max(0, m.units[y] - vor) * m.preisCent;
  };
  /** Laufender Aufwand der Fremdlösung im Jahr y: Lohnarbeit rechnet je Hektar (Fahrer
   *  inklusive), Maschinenmiete je Betriebsstunde (nur das Gerät). */
  const lohnOf = (m: MaschinenPfad, y: number) => {
    if (m.beschaffung === "miete") return m.rentPerHour != null ? m.rentPerHour * 100 * m.hours[y] : 0;
    if (m.beschaffung === "lohn") return m.rentPerHa != null ? m.rentPerHa * 100 * m.servedHa[y] : 0;
    return 0;
  };

  const capexJahr = Y.map((y) => park.reduce((s, m) => s + capexOf(m, y), 0));
  const lohnJahr = Y.map((y) => park.reduce((s, m) => s + lohnOf(m, y), 0));
  const investSum = park.reduce((s, m) => s + investOf(m), 0);
  const lohnSum = lohnJahr.reduce((s, v) => s + v, 0);
  const nMiete = park.filter((m) => m.gemietet).length;
  const spitze = Math.max(0, ...capexJahr);

  const setSpec = (id: string, fn: (m: any) => void) => patch((d) => {
    const m = d.machineCatalog.find((x) => x.id === id); if (!m) return;
    fn(m);
    // C_eff = Breite × Geschwindigkeit × Feldeffizienz ÷ 10. Wird beim Bearbeiten SOFORT
    // nachgezogen, sonst stünde in der Zeile eine Leistung, die zu den Parametern nicht passt.
    m.cEff = Math.round(((m.widthM ?? 0) * (m.speedKmh ?? 0) * (m.fieldEff ?? 0) / 10) * 100) / 100;
    m.haPerHour = m.cEff;
  });

  const th = "px-2 py-2 caption text-[10px] text-nx-text-muted";
  const card: React.CSSProperties = { borderColor: "var(--nx-border)", background: "var(--nx-surface)" };
  const Einheit = ({ children }: { children: React.ReactNode }) => (
    <span className="block text-[9px] font-normal" style={{ color: "var(--nx-text-muted)" }}>{children}</span>
  );

  return (
    <div className="space-y-3">
      {/* ---- Kopf: Leistungsrahmen + was daraus folgt ----------------------- */}
      <section className="rounded-tile border" style={card}>
        <div className="flex flex-wrap items-center gap-4 border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Maschinenpark")}</h2>
          <span className="text-[11px] text-nx-text-muted">
            {t("Bedarf aus Kulturen × Leistung → Stückzahl je Planjahr → kaufen oder zumieten → Investition.")}
          </span>
          <span className="caption ml-auto text-[10px] text-nx-text-muted">
            {park.length} {t("Klassen")} · {park.length - nMiete} {t("kaufen")} · {nMiete} {t("fremd")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-5" style={{ background: "var(--nx-border-divider)" }}>
          {[
            [t("Park-Investition"), `${fmtMoney(investSum)} €`, "var(--nx-brand-lift)"],
            [`CAPEX ${START_YEAR}`, `${fmtMoney(capexJahr[0] ?? 0)} €`, undefined],
            [t("Spitzen-CAPEX"), `${fmtMoney(spitze)} € · ${START_YEAR + capexJahr.indexOf(spitze)}`, "var(--nx-warning)"],
            [t("Lohn & Miete über den Horizont"), `${fmtMoney(lohnSum)} €`, "var(--nx-locate)"],
            [t("Einheiten im Endausbau"), `${park.reduce((s, m) => s + (m.gemietet ? 0 : m.units[years - 1] ?? 0), 0)} Stk`, undefined],
          ].map(([l, v, c], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{l as string}</div>
              <div className="num mt-0.5 text-[15px] font-semibold" style={{ color: (c as string) ?? "var(--nx-text)" }}>{v as string}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Die Tabelle ---------------------------------------------------- */}
      <section className="rounded-tile border" style={card}>
        <div className="flex items-center justify-between border-b px-4 py-2" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Klassen, Bedarf und Beschaffung")}</h3>
          <span className="caption text-[10px] text-nx-text-muted">{t("Zeile anklicken für Kostenaufriss, Auslastung und Ersatzzyklus")}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ minWidth: 1500 }}>
            <thead>
              <tr>
                <th className={th + " text-left"} style={{ minWidth: 200 }}>{t("Maschine")}</th>
                <th className={th + " text-left"} style={{ minWidth: 150 }}>{t("Kulturen")}</th>
                <th className={th + " text-right"}>{t("Breite")}<Einheit>m</Einheit></th>
                <th className={th + " text-right"}>{t("Geschw.")}<Einheit>km/h</Einheit></th>
                <th className={th + " text-right"}>{t("Feldeff.")}<Einheit>%</Einheit></th>
                <th className={th + " text-right"}>C_eff<Einheit>ha/h</Einheit></th>
                <th className={th + " text-right"}>{t("Feldtage")}<Einheit>d</Einheit></th>
                <th className={th + " text-left"}>{t("Beschaffung")}</th>
                {Y.map((y) => (
                  <th key={y} className={th + " text-right"}>{START_YEAR + y}<Einheit>{fmtNumber(flaeche(y), 0)} ha</Einheit></th>
                ))}
                <th className={th + " text-right"}>{t("eigen")}<Einheit>€/ha</Einheit></th>
                <th className={th + " text-right"}>{t("mieten")}<Einheit>€/ha</Einheit></th>
                <th className={th + " text-right"}>{t("Lohn")}<Einheit>€/ha</Einheit></th>
                <th className={th + " text-right"}>{t("günstigster Weg")}<Einheit>€/ha</Einheit></th>
                <th className={th + " text-right"}>{t("Investition")}<Einheit>€</Einheit></th>
              </tr>
            </thead>
            <tbody>
              {park.map((m) => {
                const offen = auf === m.machineId;
                const eigen = m.ownPerHa[years - 1] ?? m.ownPerHa.find((v) => v != null) ?? 0;
                const miete = m.mietePerHa;
                const lohn = m.rentPerHa;
                // Der günstigste Weg ist die eigentliche Aussage der Zeile — nicht die Differenz
                // zu EINER Alternative. Bei drei Wegen sagt ein Delta gegen nur einen nichts.
                const kandidaten: [string, number | null][] = [["kaufen", eigen], ["mieten", miete], ["Lohn", lohn]];
                const gueltig = kandidaten.filter(([, v]) => v != null && v > 0) as [string, number][];
                const best = gueltig.length ? gueltig.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
                const zweit = gueltig.length > 1
                  ? gueltig.filter((k) => k !== best).reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
                const knapp = best && zweit ? (zweit[1] - best[1]) / best[1] < 0.12 : false;
                const empfFarbe = !best ? "var(--nx-text-muted)"
                  : knapp ? "var(--nx-warning)"
                  : best[0] === "kaufen" ? "var(--nx-success)"
                  : best[0] === "mieten" ? "var(--nx-warning)" : "var(--nx-locate)";
                return (
                  <React.Fragment key={m.machineId}>
                    <tr style={{ borderTop: "1px solid var(--nx-border-divider)", background: offen ? "var(--nx-surface-sunken)" : undefined }}>
                      <td className="px-2 py-1.5">
                        <button className="flex items-start gap-1 text-left" onClick={() => setAuf(offen ? null : m.machineId)}>
                          {offen ? <ChevronDown size={12} className="mt-0.5 shrink-0" /> : <ChevronRight size={12} className="mt-0.5 shrink-0" />}
                          <span>
                            <span className="text-[12px] font-medium">{m.label}</span>
                            <span className="num block text-[9.5px] text-nx-text-muted">{m.manufacturer} · {m.category}</span>
                          </span>
                        </button>
                      </td>
                      {/* Kulturzuordnung als EIGENE Spalte — unter der Maschinenbezeichnung
                          drängten die Chips den Namen auf drei Zeilen. */}
                      <td className="px-2 py-1.5">
                        <span className="inline-flex flex-wrap gap-1">
                          {m.crops.map((c) => (
                            <span key={c} className="inline-flex items-center gap-1 rounded px-1 text-[9.5px]"
                              style={{ background: "var(--nx-app-bg)", border: "1px solid var(--nx-border-divider)" }}>
                              <span style={{ width: 6, height: 6, borderRadius: 2, background: cropColor(c), display: "inline-block" }} />
                              {t(CROP_LABEL[c] ?? c)}
                            </span>
                          ))}
                        </span>
                      </td>
                      {m.istZug ? (
                        // Gepoolte Zugklasse: keine eigene Flächenleistung. Breite, Geschwindigkeit
                        // und C_eff sind hier keine Eingabe, sondern eine Kategorienverwechslung —
                        // der Bedarf kommt aus den Stunden der Anbaugeräte.
                        <td colSpan={4} className="px-2 py-1.5 text-right text-[10.5px] text-nx-text-muted">
                          {t("gepoolt — Bedarf aus den Anbaugeräten")}
                        </td>
                      ) : (
                        <>
                          <td className="px-1 py-1.5 text-right">
                            <NumberInput value={m.widthM} width={46} onCommit={(v) => setSpec(m.machineId, (x) => { x.widthM = v; })} />
                          </td>
                          <td className="px-1 py-1.5 text-right">
                            <NumberInput value={m.speedKmh} width={46} onCommit={(v) => setSpec(m.machineId, (x) => { x.speedKmh = v; })} />
                          </td>
                          <td className="px-1 py-1.5 text-right">
                            <NumberInput value={Math.round(m.fieldEff * 100)} width={42} onCommit={(v) => setSpec(m.machineId, (x) => { x.fieldEff = v / 100; })} />
                          </td>
                          <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{fmtNumber(m.cEff, 2)}</td>
                        </>
                      )}
                      <td className="num px-2 py-1.5 text-right text-nx-text-muted">{m.feldTage}</td>
                      {/* DREI WEGE, drei Wörter — der Unterschied liegt darin, wer den Fahrer
                          stellt und wie abgerechnet wird:
                            kaufen  eigene Maschine, eigener Fahrer, Investition und AfA
                            mieten  Maschinenmiete OHNE Fahrer, je Betriebsstunde; Fahrer und
                                    Diesel stellt der Betrieb — gilt auch für einen Roder
                            Lohn    Lohnunternehmer MIT Fahrer, je Hektar, exklusive Diesel
                          Eine Zugmaschine kennt kein „Lohn": einen Schlepper vergibt man nicht
                          als Arbeitsgang, man mietet ihn. */}
                      <td className="px-2 py-1.5">
                        <span className="inline-flex overflow-hidden rounded-control border" style={{ borderColor: "var(--nx-border)" }}>
                          {(m.istZug
                            ? [["kauf", t("kaufen")], ["miete", t("mieten")]]
                            : [["kauf", t("kaufen")], ["miete", t("mieten")], ["lohn", t("Lohn")]]
                          ).map(([wahl, label]) => (
                            <button key={wahl} disabled={readOnly}
                              title={wahl === "kauf" ? t("Eigenmechanisierung: Investition, Abschreibung, eigener Fahrer.")
                                : wahl === "miete" ? t("Maschinenmiete: nur das Gerät, je Betriebsstunde. Fahrer und Diesel stellt der Betrieb.")
                                : t("Lohnarbeit: Maschine UND Fahrer des Lohnunternehmers, je Hektar, exklusive Diesel.")}
                              className="px-2 text-[10.5px] font-semibold"
                              style={{
                                height: 24,
                                background: m.beschaffung === wahl
                                  ? (wahl === "kauf" ? "var(--nx-green)" : wahl === "miete" ? "var(--nx-warning)" : "var(--nx-locate)")
                                  : "var(--nx-surface)",
                                color: m.beschaffung === wahl ? "#fff" : "var(--nx-text-secondary)",
                              }}
                              onClick={() => patch((d) => {
                                // Die Wege schliessen sich aus: erst beide Flaggen loeschen, dann setzen.
                                setMachineOutsourced(d, m.machineId, wahl === "lohn");
                                setMachineRented(d, m.machineId, wahl === "miete");
                              })}>
                              {label}
                            </button>
                          ))}
                        </span>
                      </td>
                      {Y.map((y) => {
                        const n = m.units[y] ?? 0;
                        const zu = n - (y ? m.units[y - 1] ?? 0 : 0);
                        return (
                          <td key={y} className="num px-2 py-1.5 text-right">
                            {m.gemietet ? <span className="text-[10px] text-nx-text-muted">{m.beschaffung === "miete" ? t("Miete") : t("Lohn")}</span>
                              : n ? <>{n}{zu > 0 && <span className="ml-0.5 text-[10px]" style={{ color: "var(--nx-brand-lift)" }}>+{zu}</span>}</>
                              : <span className="text-nx-text-muted">–</span>}
                          </td>
                        );
                      })}
                      {([["kaufen", eigen], ["mieten", miete], ["Lohn", lohn]] as [string, number | null][]).map(([k, v]) => (
                        <td key={k} className="num px-2 py-1.5 text-right"
                            style={{ color: best && best[0] === k ? "var(--nx-text)" : "var(--nx-text-muted)",
                                     fontWeight: best && best[0] === k ? 600 : 400 }}>
                          {v == null || v <= 0 ? "–" : fmtMoney(v * 100)}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right">
                        {best && (
                          <span className="rounded px-1.5 py-0.5 text-[9.5px] font-bold"
                                style={{ color: empfFarbe, background: "var(--nx-app-bg)" }}
                                title={knapp ? t("Differenz zum zweitbesten Weg unter 12 % — hier entscheidet Verfügbarkeit und Termintreue, nicht die Rechnung.") : undefined}>
                            {t(best[0])}{knapp ? ` · ${t("knapp")}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: m.gemietet ? "var(--nx-text-muted)" : "var(--nx-brand-lift)" }}>
                        {m.gemietet ? "—" : fmtMoney(investOf(m))}
                      </td>
                    </tr>

                    {offen && (
                      <tr style={{ background: "var(--nx-surface-sunken)" }}>
                        <td colSpan={12 + years} className="px-4 py-3">
                          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
                            <Box titel={t("Kostenaufriss je Einheit")}>
                              <Zeile k={t("Neupreis (netto)")} v={`${fmtMoney(m.preisCent)} €`} />
                              <Zeile k={t("Fixkosten p. a. (AfA + Zins + Vers.)")} v={`${fmtMoney(m.fixPerYear * 100)} €`} />
                              <Zeile k={t("variabel je Stunde (Rep + Schmier + Diesel)")} v={`${fmtNumber(m.varPerHour, 2)} €`} />
                              <Zeile k={t("Kapazität je Einheit und Saison")} v={`${fmtNumber(m.capPerUnitHours, 0)} h`} />
                              {m.rentPerHour != null && (
                                <Zeile k={t("Mietsatz je Betriebsstunde")} v={`${fmtMoney(m.rentPerHour * 100)} €`} farbe="var(--nx-locate)" />
                              )}
                            </Box>
                            <Box titel={t("Auslastung je Planjahr")}>
                              {Y.map((y) => (
                                <div key={y} className="flex items-center gap-2 py-0.5 text-[11px]">
                                  <span className="w-[92px] text-nx-text-muted">{START_YEAR + y} · {fmtNumber(m.servedHa[y], 0)} ha</span>
                                  <span className="num w-[38px] text-right">{m.units[y] ? `${fmtNumber(m.utilPct[y], 0)} %` : "–"}</span>
                                  <span className="flex-1 overflow-hidden rounded-pill" style={{ height: 4, background: "var(--nx-border-divider)" }}>
                                    <span style={{
                                      display: "block", height: "100%", width: `${m.utilPct[y]}%`,
                                      background: m.utilPct[y] > 90 ? "var(--nx-error)" : m.utilPct[y] > 55 ? "var(--nx-green)" : "var(--nx-warning)",
                                    }} />
                                  </span>
                                </div>
                              ))}
                            </Box>
                            <Box titel={t("Eigenkosten €/ha im Zeitverlauf")}>
                              {Y.map((y) => {
                                const v = m.ownPerHa[y];
                                const guenstigste = Math.min(...[miete, lohn].filter((x): x is number => x != null && x > 0));
                                const teuer = isFinite(guenstigste) && v != null && v > guenstigste;
                                return (
                                  <Zeile key={y} k={String(START_YEAR + y)}
                                    v={v == null ? "–" : `${fmtMoney(v * 100)} €`}
                                    farbe={v == null ? undefined : teuer ? "var(--nx-error)" : "var(--nx-success)"} />
                                );
                              })}
                              <div className="mt-1 border-t pt-1" style={{ borderColor: "var(--nx-border-divider)" }}>
                                <Zeile k={t("Maschinenmiete inkl. Diesel + Fahrer")} v={miete == null ? "–" : `${fmtMoney(miete * 100)} €`} farbe="var(--nx-warning)" />
                                <Zeile k={t("Lohnarbeit inkl. Diesel")} v={lohn == null ? "–" : `${fmtMoney(lohn * 100)} €`} farbe="var(--nx-locate)" />
                              </div>
                            </Box>
                            <Box titel={t("Bestand & Ersatz")}>
                              <Zeile k={t("Bestand heute")} v={`${Math.round((domain.machineCatalog.find((x) => x.id === m.machineId) as any)?.ownedUnits ?? 0)} Stk`} />
                              <Zeile k={t("Nutzungsdauer")} v={`${(domain.machineCatalog.find((x) => x.id === m.machineId) as any)?.nutzungYears ?? "–"} J`} />
                              <Zeile k={t("Erste Ersatzwelle")} v={(() => {
                                const nd = (domain.machineCatalog.find((x) => x.id === m.machineId) as any)?.nutzungYears ?? 0;
                                const erst = m.units.findIndex((n) => n > 0);
                                return erst < 0 || !nd ? "–" : String(START_YEAR + erst + nd);
                              })()} />
                              <Zeile k={t("Bedarfsstunden im Endausbau")} v={`${fmtNumber(m.hours[years - 1], 0)} h`} />
                            </Box>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                <td className="px-2 py-2 font-semibold" colSpan={8}>{t("CAPEX je Planjahr (gekaufte Klassen)")}</td>
                {Y.map((y) => <td key={y} className="num px-2 py-2 text-right font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{capexJahr[y] ? fmtMoney(capexJahr[y]) : "–"}</td>)}
                <td colSpan={3} />
                <td className="num px-2 py-2 text-right font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{fmtMoney(investSum)}</td>
              </tr>
              <tr>
                <td className="px-2 py-2 font-semibold" colSpan={8}>{t("Lohn & Miete p. a. (fremd bezogene Klassen)")}</td>
                {Y.map((y) => <td key={y} className="num px-2 py-2 text-right font-semibold" style={{ color: "var(--nx-locate)" }}>{lohnJahr[y] ? fmtMoney(lohnJahr[y]) : "–"}</td>)}
                <td colSpan={3} />
                <td className="num px-2 py-2 text-right font-semibold" style={{ color: "var(--nx-locate)" }}>{fmtMoney(lohnSum)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          <b>C_eff</b> {t("= Breite × Geschwindigkeit × Feldeffizienz ÷ 10 — alle drei editierbar, C_eff fällt live.")}
          <b> {t("Bedarf")}</b> {t("= Σ Überfahrten × Fläche des Planjahres ÷ C_eff, nur für Arbeitsgänge in Eigenmechanisierung.")}
          <b> {t("Stückzahl")}</b> {t("= ⌈Bedarf ÷ Kapazität je Einheit⌉.")}
          <b> {t("eigen €/ha")}</b> {t("= (Fixkosten je Einheit und Jahr + variable Kosten je Stunde) ÷ Fläche der bedienten Kulturen — nicht der Betriebsfläche.")}
          <b> {t("Lohn €/ha")}</b> {t("enthält Diesel, damit beide Seiten dasselbe enthalten.")}
          <br />
          {t("„Im Lohn\" schaltet die Lohnarbeits-Zeilen des Gerätes über alle Kulturen scharf — der Lohnunternehmer bringt Maschine UND Fahrer, abgerechnet je Hektar. „Mieten\" gilt für Zugmaschinen: man bekommt nur das Gerät zum Stundensatz (Stundenkosten + Vermietermarge), Fahrer und Diesel stellt der Betrieb. Beides lässt den CAPEX entfallen und bucht stattdessen laufenden Aufwand — Geld wandert von der Bilanz in die Ergebnisrechnung.")}
        </div>
      </section>

      <WeitereInvestitionen />
    </div>
  );
}

/** WEITERE ANSCHAFFUNGEN — alles, was keine Feldmaschine mit Flächenleistung ist.
 *
 *  Die Tabelle oben leitet sich aus den Arbeitsgängen ab: eine Klasse taucht nur auf, wenn
 *  eine Kultur sie fährt. Eine Wetterstation fährt nichts, ein Polaris Ranger mit
 *  RTK-Vermessung und Bodenprobennahme auch nicht — beide haben trotzdem CAPEX, AfA und
 *  Finanzierung. Sie gehören deshalb als freie Positionen daneben, nicht in die Bedarfs-
 *  ableitung hinein.
 *
 *  Die Zeilen laufen über domain.capexPlan und zählen nur, wenn ihr Block scharfgeschaltet
 *  ist (capexPlanActive). Das ist die Hybrid-Logik des Modells: entweder der pauschale
 *  Auto-Block oder die Detailzeilen — nie beides, sonst wird doppelt gezählt.
 */
function WeitereInvestitionen() {
  const { domain, patch } = useModelStore();
  const readOnly = useModelStore((s) => s.readOnly);
  const years = Math.max(1, domain.growth?.years ?? 1);
  const zeilen = (domain.capexPlan ?? []).filter((it) => it.block === "maschinen");
  const aktiv = domain.capexPlanActive?.maschinen ?? false;

  const upd = (id: string, fn: (it: CapexPlanItem) => void) => patch((d) => {
    const it = (d.capexPlan ?? []).find((x) => x.id === id); if (it) fn(it);
  });
  const add = () => patch((d) => {
    d.capexPlan = d.capexPlan ?? [];
    d.capexPlan.push({
      id: "cx-" + Math.max(0, ...d.capexPlan.map((x) => Number(/(\d+)$/.exec(x.id)?.[1] ?? 0))) + 1,
      block: "maschinen", bezeichnung: "Neue Anschaffung", anlagenklasse: "technik",
      driver: "perStueck", menge: 1, einheit: "Stk", eurProEinheitCent: 0,
      afaYears: 8, restwertPct: 0.1, jahr: 0, fkQuote: 0.5, zins: 0.06, laufzeitJahre: 7,
      subventionPct: 0, bestand: false, kategorie: "maschinen",
    });
  });
  const del = (id: string) => patch((d) => { d.capexPlan = (d.capexPlan ?? []).filter((x) => x.id !== id); });

  const netOf = (it: CapexPlanItem) =>
    it.bestand ? 0 : Math.round(it.menge * it.eurProEinheitCent * (1 - Math.max(0, Math.min(1, it.subventionPct))));
  const summe = zeilen.reduce((s, it) => s + netOf(it), 0);
  const th = "px-2 py-2 caption text-[10px] text-nx-text-muted";

  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
        <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Weitere Anschaffungen")}</h3>
        <span className="text-[11px] text-nx-text-muted">
          {t("Alles ohne Flächenleistung — Wetterstation, RTK-Basis, Vermessungsfahrzeug, Werkstatt, IoT. Freie Positionen mit eigenem Anschaffungsjahr, AfA und Finanzierung.")}
        </span>
        <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold"
          style={{ color: aktiv ? "var(--nx-green)" : "var(--nx-text-muted)" }}
          title={t("Nur scharfgeschaltete Zeilen fließen in CAPEX, Bilanz und Finanzierung. Ausgeschaltet sind sie reine Planung.")}>
          <input type="checkbox" checked={aktiv} disabled={readOnly}
            onChange={(e) => patch((d) => { d.capexPlanActive = { ...(d.capexPlanActive ?? {}), maschinen: e.target.checked }; })} />
          {aktiv ? t("zählt im Modell") : t("nur Planung")}
        </label>
        <span className="num text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{fmtMoney(summe)} €</span>
      </div>
      <div className="overflow-x-auto px-2 py-1">
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <th className={th + " text-left"} style={{ minWidth: 220 }}>{t("Position")}</th>
              <th className={th + " text-right"}>{t("Menge")}</th>
              <th className={th + " text-left"}>{t("Einheit")}</th>
              <th className={th + " text-right"}>{t("€/Einheit")}</th>
              <th className={th + " text-right"}>{t("Jahr")}</th>
              <th className={th + " text-right"}>{t("AfA")}</th>
              <th className={th + " text-right"}>{t("Zuschuss")}</th>
              <th className={th + " text-right"}>{t("FK-Quote")}</th>
              <th className={th + " text-center"}>{t("Bestand")}</th>
              <th className={th + " text-right"}>{t("netto")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {zeilen.map((it) => (
              <tr key={it.id} style={{ borderTop: "1px solid var(--nx-border-divider)", opacity: it.bestand ? 0.55 : 1 }}>
                <td className="px-2 py-1.5"><TextInput value={it.bezeichnung} width={210} onCommit={(v) => upd(it.id, (x) => { x.bezeichnung = v; })} /></td>
                <td className="px-1 py-1.5 text-right"><NumberInput value={it.menge} width={48} onCommit={(v) => upd(it.id, (x) => { x.menge = v; })} /></td>
                <td className="px-1 py-1.5"><TextInput value={it.einheit} width={52} onCommit={(v) => upd(it.id, (x) => { x.einheit = v; })} /></td>
                <td className="px-1 py-1.5 text-right"><NumberInput value={it.eurProEinheitCent} moneyCent width={86} onCommit={(v) => upd(it.id, (x) => { x.eurProEinheitCent = v; })} /></td>
                <td className="px-1 py-1.5 text-right">
                  <select value={it.jahr} disabled={readOnly}
                    className="rounded-control border px-1 text-[11.5px]"
                    style={{ height: 28, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)" }}
                    onChange={(e) => upd(it.id, (x) => { x.jahr = parseInt(e.target.value, 10); })}>
                    {Array.from({ length: years }, (_, y) => <option key={y} value={y}>{START_YEAR + y}</option>)}
                  </select>
                </td>
                <td className="px-1 py-1.5 text-right"><NumberInput value={it.afaYears} width={40} onCommit={(v) => upd(it.id, (x) => { x.afaYears = Math.max(1, Math.round(v)); })} /></td>
                <td className="px-1 py-1.5 text-right"><NumberInput value={Math.round(it.subventionPct * 100)} width={40} suffix="%" onCommit={(v) => upd(it.id, (x) => { x.subventionPct = v / 100; })} /></td>
                <td className="px-1 py-1.5 text-right"><NumberInput value={Math.round(it.fkQuote * 100)} width={40} suffix="%" onCommit={(v) => upd(it.id, (x) => { x.fkQuote = v / 100; })} /></td>
                <td className="px-2 py-1.5 text-center">
                  <input type="checkbox" checked={it.bestand} disabled={readOnly}
                    title={t("bereits vorhanden — kein Neu-CAPEX")}
                    onChange={(e) => upd(it.id, (x) => { x.bestand = e.target.checked; })} />
                </td>
                <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(netOf(it))}</td>
                <td className="px-1 py-1.5 text-right">
                  {!readOnly && <button title={t("Position entfernen")} className="text-nx-text-muted hover:text-nx-error" onClick={() => del(it.id)}><X size={12} /></button>}
                </td>
              </tr>
            ))}
            {!zeilen.length && (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-[12px] text-nx-text-muted">{t("Noch keine freie Position angelegt.")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 border-t px-4 py-2" style={{ borderColor: "var(--nx-border)" }}>
        {!readOnly && (
          <button className="inline-flex items-center gap-1.5 rounded-control border px-3 text-[11.5px] font-semibold"
            style={{ height: 28, borderColor: "var(--nx-brand-lift)", color: "var(--nx-brand-lift)" }} onClick={add}>
            <Plus size={12} strokeWidth={2.5} aria-hidden />{t("Position hinzufügen")}
          </button>
        )}
        <span className="text-[10.5px] text-nx-text-muted">
          {t("Anschaffungsjahr steuert das Phasing, AfA die Abschreibung, FK-Quote die Finanzierung (Rest bar). „Bestand\" heißt: schon da, kein Neu-CAPEX.")}
        </span>
      </div>
    </section>
  );
}

function Box({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <div className="rounded-tile border px-3 py-2" style={{ borderColor: "var(--nx-border-divider)", background: "var(--nx-surface)" }}>
      <div className="caption mb-1 text-[9.5px] font-bold uppercase tracking-wide text-nx-text-muted">{titel}</div>
      {children}
    </div>
  );
}
function Zeile({ k, v, farbe }: { k: string; v: string; farbe?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 text-[11px]">
      <span className="text-nx-text-muted">{k}</span>
      <span className="num font-semibold" style={{ color: farbe ?? "var(--nx-text)" }}>{v}</span>
    </div>
  );
}
