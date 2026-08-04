"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import type { Domain, CatalogEntry } from "../../store/model";
import { fmtMoney, fmtNumber, fmtEditable, parseDe } from "../../design/format";
import { Feld } from "./Feld";
import { cropYield, cropLoss, netTonnes, cropColor, cropName } from "./cropCalc";
import { deriveCropAreasMY, setCropPathHa, rampCropPath, deriveContribution, START_YEAR,
  sortenAnteileOf, sortenVerteilung, schlaegeOf, sortenRegisterOf, sortenEintrag,
  type CropPolicy } from "../../store/model";
import { t } from "../../lib/i18n";
import { JahrWahl, JAHR_DEFAULT } from "./JahrWahl";
import { Droplets, Sun, X, ChevronDown, ChevronRight, Sprout, Plus, TriangleAlert } from "lucide-react";
import { TextFeld, Aktion } from "../primitives/Control";

/** Feldkosten €/ha einer Kultur = Σ opLine (Menge/ha × Stücksatz), aus dem KATALOG gezogen. */
function fieldCostPerHaCent(domain: Domain, entry: CatalogEntry, scenarioId: string): number {
  let c = 0;
  for (const op of entry.ops) for (const l of op.lines) {
    const unit = readAssumption(domain, l.unitCostKey, scenarioId) ?? 0;
    c += l.quantityPerHa * unit;
  }
  return c;
}

function NumCell({ value, onCommit, width = 90, suffix }: { value: number; onCommit: (n: number) => void; width?: number; suffix?: string }) {
  const anzeige = fmtEditable(value);
  const [t, setT] = React.useState(anzeige);
  React.useEffect(() => setT(anzeige), [value]);
  // Kappen wir die Anzeige auf zwei Nachkommastellen, darf ein blosses Verlassen des
  // Feldes den Wert NICHT auf die gerundete Zahl festschreiben. Deshalb: nur committen,
  // wenn der Text sich gegenueber der gerenderten Darstellung tatsaechlich geaendert hat.

  return (
    <span className="inline-flex items-center gap-1">
      <input className="num rounded-control border px-2 text-right text-[12.5px]"
        style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600, height: 34, width }}
        value={t} inputMode="decimal"
        onChange={(e) => setT(e.target.value)}
        onBlur={(e) => { if (e.target.value === anzeige) return; const n = parseDe(e.target.value); if (n !== null) onCommit(n); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      {suffix && <span className="text-[11px] text-nx-text-muted">{suffix}</span>}
    </span>
  );
}

/** Beregnungs-Badge: beregnet (💧) vs. trocken (☀) — kennzeichnet Zeilen in der Anbau-Tabelle. */
function BeregBadge({ kind }: { kind: "beregnet" | "trocken" }) {
  const beregnet = kind === "beregnet";
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style={{
        background: beregnet ? "color-mix(in srgb, var(--nx-locate) 14%, transparent)" : "color-mix(in srgb, var(--nx-warn, #C9A227) 16%, transparent)",
        color: beregnet ? "var(--nx-locate)" : "var(--nx-warn, #C9A227)",
      }}>
      {beregnet ? <Droplets size={12} strokeWidth={2} aria-hidden /> : <Sun size={12} strokeWidth={2} aria-hidden />}
      {beregnet ? t("beregnet") : t("trocken")}
    </span>
  );
}

/** Variabler Anbauplan: Kultur × Fläche × Zeitfenster. Kosten werden je Zeile aus dem
 *  Kostenkatalog gezogen und auf die Fläche skaliert (× areaHa). */
export function AnbauplanView() {
  const { domain, view, patch } = useModelStore();
  const sc = view.scenarioId;
  const planDomain = domain;
  const plan = planDomain.anbauplan;
  // ZUSAMMENGEFÜHRT 31.07.2026: der Skalierungspfad steckt jetzt in DIESER Tabelle. Eine Kultur,
  //  eine Zeile — Beregnung, Pflanz-/Erntemonat, Fläche je Planjahr, Kosten. Vorher standen die
  //  Jahresflächen im Dashboard und die Startfläche hier; wer eine Kultur plante, musste an zwei
  //  Stellen arbeiten und konnte beide auseinanderlaufen lassen.
  const jahre = React.useMemo(() => Array.from({ length: Math.max(1, domain.growth?.years ?? 1) }, (_, y) => y), [domain.growth?.years]);
  const myAreas = React.useMemo(() => deriveCropAreasMY(domain).areas, [domain]);
  const haOf = (cropId: string, y: number) => Math.round(myAreas[cropId]?.[Math.min(y, jahre.length - 1)] ?? 0);
  // Trockenrotation läuft jetzt NATIV im Anbauplan (pool:"dryland"). Aufteilung rein über das pool-Feld.
  // NULLBASIS-FALLE im Kopf und in der Summenspalte. `e.areaHa` ist die Flaeche des
  //  STARTJAHRES; fuenf der sieben Kulturen beginnen erst 2028 und stehen dort mit 0 ha.
  //  Die Kopfzeile meldete deshalb "Gesamtbetrieb Sigma 300 ha" fuer einen Plan, dessen
  //  Jahresspalten direkt daneben bis 2.334 ha laufen, und die Spalte "Sigma EUR Jahr 1"
  //  stand fuer diese Kulturen auf null. Bezug ist jetzt das ZIELJAHR.
  // BEZUGSJAHR fuer Kopfzeile und Sigma-Spalte. Default = erstes Planjahr (Regel 01.08.2026):
  //  eine Summe ohne genanntes Jahr wird als "heute" gelesen, nicht als Endausbau.
  const [bezugJ, setBezugJ] = React.useState(JAHR_DEFAULT);
  const zielJ = Math.min(Math.max(0, bezugJ), jahre.length - 1);
  const haZiel = (cropId: string) => myAreas[cropId]?.[Math.min(zielJ, (myAreas[cropId]?.length ?? 1) - 1)] ?? 0;
  const agroOf = (e: { cropId: string; areaHa: number }) => {
    const entry = planDomain.catalog.find((c) => c.cropId === e.cropId);
    return (entry ? fieldCostPerHaCent(planDomain, entry, sc) : 0) * haZiel(e.cropId);
  };
  const irrRows = plan.filter((e) => e.pool !== "dryland");
  const dryPlanRows = plan.filter((e) => e.pool === "dryland");
  const beregHa = irrRows.reduce((a, e) => a + haZiel(e.cropId), 0);
  const dryHa = dryPlanRows.reduce((a, e) => a + haZiel(e.cropId), 0);
  const totalHa = beregHa + dryHa;
  const beregAgroCent = irrRows.reduce((a, e) => a + agroOf(e), 0);
  const dryAgroCent = dryPlanRows.reduce((a, e) => a + agroOf(e), 0);
  const totalAgroCent = beregAgroCent + dryAgroCent;
  const avgPerHaCent = totalHa > 0 ? totalAgroCent / totalHa : 0;
  const showDry = dryHa > 0;

  /* AGRONOMISCHER BLOCK JE KULTUR (aufklappbar, Muster wie im Maschinenpark).
     Ertrag, Verlust, Qualitaet und Preis lagen bis 01.08.2026 in zwei eigenen Tabs und ein
     zweites Mal im Annahmen-Register — als flache Liste, in der die Zuordnung zur Kultur nur
     im NAMEN steckte ("Preis Kartoffel (Pommes)"). Wer eine Kultur plante, musste die Flaeche
     hier und ihren Ertrag zwei Tabs weiter pflegen. Jetzt steht beides in derselben Zeile, und
     darunter steht sofort, was daraus faellt: Erloes, Direktkosten und Deckungsbeitrag je Hektar.
     Der Datenort bleibt die Annahme — das Register zeigt dieselben Zeilen weiterhin mit
     Szenarioband, Status, Quelle und Historie. Ein Wert, zwei Linsen. */
  const [auf, setAuf] = React.useState<string | null>(null);
  const db = React.useMemo(() => {
    // Je-ha-Groessen sind flaechenunabhaengig; das Bezugsjahr bestimmt nur, welche Kultur
    //  ueberhaupt Flaeche hat. Deshalb auf den Flaechen des gewaehlten Jahres rechnen.
    const probe = { ...domain, anbauplan: domain.anbauplan.map((a) => ({ ...a, areaHa: haZiel(a.cropId) })) };
    const m: Record<string, { db: number; erloes: number; kosten: number; foerder: number }> = {};
    for (const c of deriveContribution(probe as Domain, sc).crops) {
      if (c.areaHa <= 0) continue;
      m[c.cropId] = {
        db: c.contribPerHaCent, erloes: c.revenueCent / c.areaHa,
        kosten: c.cogsCent / c.areaHa, foerder: c.subsidyCent / c.areaHa,
      };
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, sc, zielJ]);

  return (
    <div className="space-y-4">
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <div>
          <h2 className="text-[14px] font-semibold">{t("Anbauplan — Kulturen, Flächen & Erlös")}</h2>
          <div className="text-[10.5px] text-nx-text-muted">{t("Zeile aufklappen für Ertrag, Ernteverlust, Kontrakt-Qualität und Preis dieser Kultur — samt Deckungsbeitrag je Hektar. Dieselben Annahmen führt das Register mit Szenarioband und Review-Status.")}</div>
        </div>
        <span className="inline-flex items-center gap-3"><JahrWahl jahre={jahre.length} wert={zielJ} onChange={setBezugJ} /><span className="caption text-[10.5px] text-nx-text-muted">{t("Gesamtbetrieb · Σ")} {fmtNumber(totalHa, 0)} ha</span></span>
      </div>
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="caption text-[10.5px] text-nx-text-muted">
              <th className="px-2 py-2 text-left">{t("Kultur")}</th>
              <th className="px-2 py-2 text-left">{t("Beregnung")}</th>
              <th className="px-2 py-2 text-right">{t("Pflanzung (M)")}</th>
              <th className="px-2 py-2 text-right">{t("Ernte (M)")}</th>
              {jahre.map((y) => <th key={y} className="px-1.5 py-2 text-right">{START_YEAR + y}</th>)}
              <th className="px-2 py-2 text-right">{t("€/ha")}</th>
              <th className="px-2 py-2 text-right">{t("Σ €")} {START_YEAR + zielJ}</th>
              <th className="px-1 py-2 text-center" title={t("Linear vom Start- auf den Zielwert hochlaufen lassen")}>↗</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {plan.map((e, i) => {
              const entry = planDomain.catalog.find((c) => c.cropId === e.cropId);
              const perHa = entry ? fieldCostPerHaCent(planDomain, entry, sc) : 0;
              const cropLabel = entry ? t(entry.name) : cropName(e.cropId);
              const offen = auf === e.cropId;
              return (
                <React.Fragment key={e.id}>
                <tr style={{ borderTop: "1px solid var(--nx-border-divider)", background: offen ? "var(--nx-app-bg)" : undefined }}>
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <button type="button" title={t("Ertrag, Verlust, Qualität und Preis dieser Kultur")}
                        onClick={() => setAuf(offen ? null : e.cropId)}
                        className="text-nx-text-muted hover:text-nx-locate" style={{ lineHeight: 0 }}>
                        {offen ? <ChevronDown size={14} strokeWidth={2.5} aria-hidden /> : <ChevronRight size={14} strokeWidth={2.5} aria-hidden />}
                      </button>
                      <select className="rounded-control border px-2 text-[12.5px]" style={{ height: 34, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)", fontWeight: 600 }}
                        value={e.cropId}
                        onChange={(ev) => patch((d) => { d.anbauplan[i].cropId = ev.target.value; })}>
                        {domain.catalog.map((c) => <option key={c.cropId} value={c.cropId}>{t(c.name)}</option>)}
                      </select>
                    </span>
                  </td>
                  <td className="px-2 py-2"><BeregBadge kind={e.pool === "dryland" ? "trocken" : "beregnet"} /></td>
                  <td className="px-2 py-2 text-right">
                    <NumCell value={e.plantingPeriod} width={56} onCommit={(n) => patch((d) => { d.anbauplan[i].plantingPeriod = Math.round(n); })} />
                  </td>
                  <td className="num px-2 py-2 text-right text-nx-text-secondary">{e.harvestPeriods.join(", ")}</td>
                  {jahre.map((y) => (
                    <td key={y} className="px-1.5 py-2 text-right">
                      <NumCell value={haOf(e.cropId, y)} width={58}
                        onCommit={(n) => patch((d) => setCropPathHa(d, e.cropId, y, n, jahre.length))} />
                    </td>
                  ))}
                  <td className="num px-2 py-2 text-right">{fmtMoney(perHa)}</td>
                  <td className="num px-2 py-2 text-right font-semibold">{fmtMoney(perHa * haZiel(e.cropId))}</td>
                  <td className="px-1 py-2 text-center">
                    <button title={t("Linear vom Start- auf den Zielwert hochlaufen lassen")}
                      onClick={() => patch((d) => rampCropPath(d, e.cropId, jahre.length))}
                      className="rounded-control border px-1.5 text-[11px]"
                      style={{ height: 24, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }}>↗</button>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button className="text-[11px] text-nx-error" title={t("Zeile entfernen")}
                      onClick={() => patch((d) => { d.anbauplan.splice(i, 1); })}><X size={13} strokeWidth={2.5} aria-hidden /></button>
                  </td>
                </tr>
                {offen && (
                  <tr style={{ background: "var(--nx-app-bg)" }}>
                    <td colSpan={jahre.length + 8} className="px-4 py-3">
                      <AgroBlock cropId={e.cropId} label={cropLabel} db={db[e.cropId]} jahr={START_YEAR + zielJ} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-2 py-2.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Beregnet ·")} {irrRows.length} {t("Kulturen")}</td>
              <td className="num px-2 py-2.5 text-right font-semibold">{fmtNumber(beregHa, 0)} ha</td>
              <td className="px-2 py-2.5" colSpan={2} />
              <td className="num px-2 py-2.5 text-right text-nx-text-secondary" title={t("gewichteter Durchschnitt")}>ø {fmtMoney(avgPerHaCent)}</td>
              <td className="num px-2 py-2.5 text-right font-semibold">{fmtMoney(beregAgroCent)}</td>
              <td className="px-2 py-2.5" />
            </tr>
            {showDry && (
              <tr>
                <td className="px-2 py-1.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Trocken ·")} {dryPlanRows.length} {t("Kulturen")}</td>
                <td className="num px-2 py-1.5 text-right font-semibold">{fmtNumber(dryHa, 0)} ha</td>
                <td className="px-2 py-1.5" colSpan={2} />
                <td className="px-2 py-1.5" />
                <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(dryAgroCent)}</td>
                <td className="px-2 py-1.5" />
              </tr>
            )}
            {showDry && (
              <tr style={{ borderTop: "1px solid var(--nx-border)" }}>
                <td className="px-2 py-2 font-bold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Gesamtbetrieb")}</td>
                <td className="num px-2 py-2 text-right font-bold">{fmtNumber(totalHa, 0)} ha</td>
                <td className="px-2 py-2 text-[10px] text-nx-text-muted" colSpan={5}>{fmtNumber(beregHa, 0)} {t("beregnet")} + {fmtNumber(dryHa, 0)} {t("trocken")}</td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2" style={{ borderColor: "var(--nx-border)" }}>
        {(
          <button
            className="rounded-control border px-3 text-[12px] font-semibold"
            style={{ height: 34, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }}
            onClick={() => patch((d) => {
              const c = d.catalog[0];
              d.anbauplan.push({ id: `ab-${d.anbauplan.length + 1}-${c.cropId}`, cropId: c.cropId, areaHa: 500, plantingPeriod: c.plantingPeriod, harvestPeriods: c.harvestPeriods });
            })}
          >{t("+ Kultur hinzufügen")}</button>
        )}
        <span className="text-[11px] text-nx-text-muted">
          {t("Fläche ändern → Kosten & Maschinen rechnen automatisch nach.")}
          {showDry ? " " + t("Trockenkulturen laufen nativ mit eigener Kalkulation (☀ trocken); Maschinen über die volle Fläche.") : ""}
        </span>
      </div>
    </section>

    {/* Anbaustruktur & Produktion */}
    <ProduktionsTabelle />

    {/* Sortenanteile — die Größe, die aus einer Kulturfläche einen Arbeitsauftrag macht */}
    <SortenPlanTabelle />

    {/* ENTFERNT 31.07.2026: das Politik-Panel (scale/fix/ramp je Kultur). Die Flächen stehen
        jetzt Jahr für Jahr in der Tabelle oben — eine explizite Kurve statt einer Regel, die
        man erst im Kopf auflösen muss. Die Modi scale/fix/ramp werden nicht mehr verwendet. */}

    {/* AUSGEBLENDET 31.07.2026: Agronomie-Advisor und Was-wäre-wenn-Panel. Sie gehören zur
        Sektion Anbaustrategie, die vorerst komplett aus der App genommen ist. Der Code bleibt
        unter components/_archiv erhalten; die Anbaupausen-Wächter (Kartoffel 25 %,
        Doldenblütler 20 %) laufen unabhängig davon in der Prüfliste weiter. */}
    </div>
  );
}


/**
 * SORTENANTEILE je Kultur.
 *
 * WARUM ANTEILE UND KEINE HEKTAR. Die Kulturfläche läuft über den Skalierungspfad
 * von 300 auf 2.334 ha. Eine in Hektar hinterlegte Sortenmenge wäre ab dem zweiten
 * Planjahr falsch — und zwar still. Der Anteil skaliert mit.
 *
 * WARUM ES DIESE TABELLE ÜBERHAUPT GIBT. Ohne Sorte ist ein Schlag nur ein Feld mit
 * einer Kultur darauf, und der Maßnahmenplan kann keinen sortenscharfen Rodetermin
 * ausgeben. Markies und eine second early reifen unterschiedlich ab; „roden" ist
 * deshalb eine Schlag-Maßnahme und keine Feld-Maßnahme. Genau dafür ist die
 * Schlagebene gebaut.
 *
 * DIE WERTE SIND PLATZHALTER, und die Tabelle sagt das auch. Die Rolle kommt aus der
 * Anbauentscheidung (Markies als vorgezogene Hauptkultur, 31.07.2026), der Rang aus
 * dem Sortenranking des Kompendiums. Beide widersprechen sich hier sichtbar —
 * Markies steht im Pommes-Ranking für Nedeia auf Rang 13 von 13. Das ist kein
 * Einwand gegen die Entscheidung: das Punktmodell kennt keine Rollen und kann
 * „räumt früh genug für eine Zweitkultur" nicht ausdrücken. Es ist der Grund, warum
 * Markies hier nicht die ganze Fläche bekommt.
 */
function SortenPlanTabelle() {
  const { domain, patch } = useModelStore();
  const readOnly = useModelStore((s) => s.readOnly);
  const jahre = Math.max(1, domain.growth?.years ?? 1);
  const [jy, setJy] = React.useState(JAHR_DEFAULT);

  const kulturen = React.useMemo(
    () => [...new Set(domain.anbauplan.filter((a) => !a.zweitnutzung).map((a) => a.cropId))],
    [domain],
  );

  const setzen = (cropId: string, i: number, wert: number) => patch((d) => {
    const liste = (d.sortenplan?.[cropId] ?? sortenAnteileOf(d, cropId)).map((x) => ({ ...x }));
    if (!liste[i]) return;
    liste[i].anteil = Math.max(0, wert) / 100;
    liste[i].vorlaeufig = false;        // wer daran dreht, hat entschieden
    d.sortenplan = { ...(d.sortenplan ?? {}), [cropId]: liste };
  });

  const entfernen = (cropId: string, i: number) => patch((d) => {
    const liste = (d.sortenplan?.[cropId] ?? sortenAnteileOf(d, cropId)).filter((_, k) => k !== i);
    d.sortenplan = { ...(d.sortenplan ?? {}), [cropId]: liste };
  });

  const hinzufuegen = (cropId: string, name: string) => {
    const sorte = name.trim();
    if (!sorte) return;
    patch((d) => {
      const liste = [...(d.sortenplan?.[cropId] ?? sortenAnteileOf(d, cropId))];
      if (liste.some((x) => x.sorte.toLowerCase() === sorte.toLowerCase())) return;
      liste.push({ sorte, anteil: 0, vorlaeufig: true });
      d.sortenplan = { ...(d.sortenplan ?? {}), [cropId]: liste };
    });
  };

  const th = "px-2 py-2 caption text-[10px] text-nx-text-muted";
  const card: React.CSSProperties = { borderColor: "var(--nx-border)", background: "var(--nx-surface)" };

  return (
    <section className="rounded-tile border" style={card}>
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
        <Sprout size={15} strokeWidth={2.3} aria-hidden className="text-nx-text-secondary" />
        <h2 className="text-[14px] font-semibold">{t("Sortenanteile")}</h2>
        <span className="text-[11px] text-nx-text-muted">
          {t("Anteil, nicht Hektar — die Kulturfläche wächst, der Anteil skaliert mit. Aus den Anteilen fallen die Schläge und damit die sortenscharfen Rode- und Sikkationstermine.")}
        </span>
        <span className="ml-auto"><JahrWahl jahre={jahre} wert={jy} onChange={setJy} /></span>
      </div>

      <div className="space-y-3 p-3">
        {kulturen.map((cropId) => {
          const liste = sortenAnteileOf(domain, cropId);
          const verteilung = sortenVerteilung(domain, cropId, jy);
          const summePct = liste.reduce((s, x) => s + Math.max(0, x.anteil), 0) * 100;
          const flaeche = schlaegeOf(domain, cropId, jy).reduce((s, x) => s + x.areaHa, 0);
          return (
            <SortenKarte
              key={cropId} cropId={cropId} liste={liste} verteilung={verteilung}
              summePct={summePct} flaeche={flaeche} readOnly={readOnly} th={th}
              onSetzen={(i, v) => setzen(cropId, i, v)}
              onEntfernen={(i) => entfernen(cropId, i)}
              onHinzufuegen={(n) => hinzufuegen(cropId, n)}
            />
          );
        })}
      </div>

      <div className="border-t px-4 py-2 text-[11px] leading-relaxed text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
        {t("Die Anteile werden auf 100 % normiert — 40/35/25 und 4/3,5/2,5 ergeben dieselbe Zuteilung. „Zugeteilt“ weicht vom Soll ab, weil ganze Felder verteilt werden und ein Feld erst ab 5 ha geteilt wird; ein 2-ha-Zipfel ist kein Arbeitsauftrag. Sorten mit Anteil 0 bleiben stehen, fallen aber aus der Zuteilung — so lässt sich ein Prüfglied vorhalten, ohne ihm Fläche zu geben.")}
        {" "}
        {t("Vorschlagswerte tragen den Vermerk „gesetzt“ und stammen aus der Anbauentscheidung (Rolle) und dem Sortenranking des Kompendiums (Rang). Wer eine Zahl ändert, nimmt den Vermerk weg.")}
      </div>
    </section>
  );
}

function SortenKarte({
  cropId, liste, verteilung, summePct, flaeche, readOnly, th, onSetzen, onEntfernen, onHinzufuegen,
}: {
  cropId: string;
  liste: ReturnType<typeof sortenAnteileOf>;
  verteilung: ReturnType<typeof sortenVerteilung>;
  summePct: number; flaeche: number; readOnly: boolean; th: string;
  onSetzen: (i: number, pct: number) => void;
  onEntfernen: (i: number) => void;
  onHinzufuegen: (name: string) => void;
}) {
  const [neu, setNeu] = React.useState("");
  const register = sortenRegisterOf(cropId);
  return (
    <div className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-app-bg)" }}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--nx-border)" }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: cropColor(cropId), display: "inline-block" }} />
        <span className="text-[12.5px] font-semibold">{t(cropName(cropId))}</span>
        {/* „– ha ohne Sorten" stand bei fünf Kulturen untereinander und sah aus wie
            ein Fehler. Es ist keiner: die Kultur läuft erst später im
            Skalierungspfad an. Dann soll da auch das stehen. */}
        {flaeche > 0
          ? <span className="num text-[10.5px] text-nx-text-muted">{fmtNumber(flaeche, 0)} ha</span>
          : <span className="text-[10.5px] text-nx-text-muted">{t("keine Fläche in diesem Planjahr")}</span>}
        {liste.length === 0 && flaeche > 0 && (
          <span className="text-[10.5px] text-nx-text-muted">{t("ohne Sorten — die Schläge tragen dann keine Sortenkennung")}</span>
        )}
        {/* AUSWAHL STATT FREITEXT. Der Sortenname geht in die Schlag-ID und damit
            in den Arbeitsauftrag — ein Tippfehler erzeugte bisher still einen
            neuen Schlag statt einer Warnung. Die Liste kommt aus dem Kompendium
            (`store/sorten.generated.ts`) und nennt gleich mit, wie belegt die
            Sorte ist. Eigene Namen bleiben möglich: wer eine Sorte fährt, die
            das Kompendium nicht kennt, soll das dürfen — er sieht dann nur den
            Hinweis, dass keine Fakten dahinterstehen. */}
        <span className="ml-auto inline-flex items-center gap-2">
          <input list={`sorten-${cropId}`} value={neu} onChange={(e) => setNeu(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { onHinzufuegen(neu); setNeu(""); } }}
            placeholder={t("Sorte wählen oder eingeben …")}
            className="rounded-control border px-2 text-[12.5px]"
            style={{ height: 30, width: 210, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />
          <datalist id={`sorten-${cropId}`}>
            {register.filter((r) => !liste.some((x) => x.sorte === r.sorte)).map((r) => (
              <option key={r.sorte} value={r.sorte}>
                {r.rang?.NEDEIA ? `Rang ${r.rang.NEDEIA.rang} Nedeia · ` : ""}
                {r.faktenBelegt} {t("belegte Fakten")}
              </option>
            ))}
          </datalist>
          <Aktion kind="still" Icon={Plus} dicht disabled={readOnly || !neu.trim()}
            onClick={() => { onHinzufuegen(neu); setNeu(""); }}>{t("Sorte")}</Aktion>
        </span>
      </div>

      {liste.length > 0 && (
        <div className="overflow-x-auto px-2 py-1">
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                <th className={th + " text-left"} style={{ minWidth: 160 }}>{t("Sorte")}</th>
                <th className={th + " text-left"} style={{ minWidth: 220 }}>{t("Rolle")}</th>
                <th className={th + " text-right"}>{t("Anteil %")}</th>
                <th className={th + " text-right"}>{t("zugeteilt")}</th>
                <th className={th + " text-right"}>{t("ha")}</th>
                <th className={th + " text-right"}>{t("Schläge")}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {liste.map((s, i) => {
                const v = verteilung.find((x) => x.sorte === s.sorte);
                const abw = v ? v.istPct - v.sollPct : 0;
                return (
                  <tr key={s.sorte} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                    <td className="px-2 py-1.5">
                      <span className="font-medium">{s.sorte}</span>
                      {s.vorlaeufig && (
                        <span className="ml-1.5 rounded-pill px-1.5 py-[1px] text-[9px] font-bold"
                          style={{ background: "var(--nx-surface-sunken)", color: "var(--nx-text-muted)" }}>{t("gesetzt")}</span>
                      )}
                      {/* Der Belegstand aus dem Kompendium. Eine Sorte auf Rang 2 mit
                          34 % Datenbasis ist eine Hypothese, keine Empfehlung — und das
                          soll man sehen, wo die Fläche verteilt wird. */}
                      {(() => {
                        const reg = sortenEintrag(cropId, s.sorte);
                        if (!reg) return (
                          <span className="ml-1.5 inline-flex items-center gap-1 rounded-pill px-1.5 py-[1px] text-[9px] font-bold"
                            style={{ background: "var(--nx-warning-bg)", color: "var(--nx-warning-text)" }}
                            title={t("Diese Sorte steht nicht im Sortenregister des Kompendiums — es gibt keine belegte Aussage über sie.")}>
                            <TriangleAlert size={9} strokeWidth={2.6} aria-hidden />{t("nicht im Register")}
                          </span>
                        );
                        const r = reg.rang?.NEDEIA;
                        return (
                          <span className="num ml-1.5 text-[9.5px] text-nx-text-muted"
                            title={t("Fakten im Kompendium, davon mit Primärquelle belegt · Rang aus dem Punktmodell")}>
                            {reg.faktenBelegt}/{reg.fakten} {t("belegt")}
                            {r ? ` · Rang ${r.rang} (${r.datenbasisPct} % Datenbasis)` : ""}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-1.5 text-[10.5px] text-nx-text-muted">{s.rolle ?? "—"}</td>
                    <td className="px-1 py-1.5 text-right">
                      <NumCell value={Math.round(s.anteil * 1000) / 10} width={72} suffix="%"
                        onCommit={(v2) => onSetzen(i, v2)} />
                    </td>
                    <td className="num px-2 py-1.5 text-right font-semibold">
                      {v ? `${fmtNumber(v.istPct, 1)} %` : "—"}
                      {v && Math.abs(abw) >= 1 && (
                        <span className="ml-1 text-[9.5px] font-normal text-nx-text-muted">
                          ({abw > 0 ? "+" : ""}{fmtNumber(abw, 1)})
                        </span>
                      )}
                    </td>
                    <td className="num px-2 py-1.5 text-right">{v ? fmtNumber(v.istHa, 1) : "—"}</td>
                    <td className="num px-2 py-1.5 text-right text-nx-text-muted">{v?.schlaege ?? 0}</td>
                    <td className="px-1 py-1.5 text-right">
                      {!readOnly && (
                        <button className="text-nx-text-muted hover:text-nx-error" title={t("Sorte aus dem Plan nehmen")}
                          onClick={() => onEntfernen(i)}>
                          <X size={12} strokeWidth={2.5} aria-hidden />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                <td className="px-2 py-1.5 font-semibold" colSpan={2}>{t("Σ")}</td>
                <td className="num px-2 py-1.5 text-right font-semibold"
                    style={{ color: Math.abs(summePct - 100) > 0.5 ? "var(--nx-warning-text)" : undefined }}>
                  {fmtNumber(summePct, 1)} %
                </td>
                <td className="num px-2 py-1.5 text-right font-semibold">
                  {fmtNumber(verteilung.reduce((s, v) => s + v.istPct, 0), 1)} %
                </td>
                <td className="num px-2 py-1.5 text-right font-semibold">
                  {fmtNumber(verteilung.reduce((s, v) => s + v.istHa, 0), 1)}
                </td>
                <td className="num px-2 py-1.5 text-right font-semibold">
                  {verteilung.reduce((s, v) => s + v.schlaege, 0)}
                </td>
                <td />
              </tr>
              {Math.abs(summePct - 100) > 0.5 && (
                <tr>
                  <td colSpan={7} className="px-2 py-1 text-[10.5px]" style={{ color: "var(--nx-warning-text)" }}>
                    <span className="inline-flex items-center gap-1.5">
                      <TriangleAlert size={11} strokeWidth={2.5} aria-hidden />
                      {t("Die Anteile summieren nicht auf 100 % — sie werden normiert. Das ist zulässig, aber die zugeteilte Spalte ist dann leichter misszuverstehen als die eingegebene.")}
                    </span>
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}


/** AGRONOMISCHER BLOCK einer Kultur — Ertrag, Verlust, Qualität, Preis und was daraus fällt.
 *
 *  Die vier Felder schreiben dieselben Annahmen, die das Register führt (`yield.*`, `loss.*`,
 *  `qual.*`, `price.*`) — kein zweiter Datenort, nur ein zweiter Blickwinkel. Rechts steht die
 *  Wirkung: Erlös, Förderung, Direktkosten und Deckungsbeitrag je Hektar. Wer am Ertrag dreht,
 *  sieht den Deckungsbeitrag im selben Blick springen, statt ihn zwei Ansichten weiter zu suchen.
 */
function AgroBlock({ cropId, label, db, jahr }: {
  cropId: string; label: string;
  db?: { db: number; erloes: number; kosten: number; foerder: number }; jahr: number;
}) {
  const Zeile = ({ k, akey }: { k: string; akey: string }) => (
    <div className="flex items-center justify-between gap-3 border-b py-1.5" style={{ borderColor: "var(--nx-border-divider)" }}>
      <span className="text-[12px] text-nx-text-secondary">{k}</span>
      <Feld akey={akey} breite={92} />
    </div>
  );
  const Wert = ({ k, v, stark, farbe }: { k: string; v: string; stark?: boolean; farbe?: string }) => (
    <div className="flex items-center justify-between gap-3 border-b py-1.5" style={{ borderColor: "var(--nx-border-divider)" }}>
      <span className="text-[12px] text-nx-text-secondary">{k}</span>
      <span className={"num text-[12.5px] " + (stark ? "font-semibold" : "")} style={{ color: farbe }}>{v}</span>
    </div>
  );
  return (
    <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
      <div>
        <div className="caption mb-1 text-[10px]" style={{ color: "var(--nx-brand-lift)" }}>
          {t("Agronomie & Erlös")} · {label}
        </div>
        <Zeile k={t("Ertrag")} akey={`yield.${cropId}`} />
        <Zeile k={t("Ernteverlust")} akey={`loss.${cropId}`} />
        <Zeile k={t("Kontrakt-Qualität")} akey={`qual.${cropId}`} />
        <Zeile k={t("Preis")} akey={`price.${cropId}`} />
      </div>
      <div>
        <div className="caption mb-1 text-[10px]" style={{ color: "var(--nx-brand-lift)" }}>
          {t("Ergebnisbeitrag je Hektar")} · {jahr}
        </div>
        {db ? (<>
          <Wert k={t("Erlös (Ertrag × (1 − Verlust) × Preis)")} v={`${fmtMoney(db.erloes)} €`} />
          <Wert k={t("Förderung")} v={`${fmtMoney(db.foerder)} €`} />
          <Wert k={t("Direktkosten (Agronomie + Maschinen-Betrieb)")} v={`− ${fmtMoney(db.kosten)} €`} />
          <Wert k={t("Deckungsbeitrag")} v={`${fmtMoney(db.db)} €`} stark
            farbe={db.db >= 0 ? "var(--nx-brand-lift)" : "var(--nx-error)"} />
        </>) : (
          <div className="py-2 text-[11.5px] text-nx-text-muted">
            {t("Diese Kultur hat im gewählten Planjahr keine Fläche — der Ergebnisbeitrag erscheint, sobald sie anläuft.")}
          </div>
        )}
      </div>
    </div>
  );
}

/** Anbaustruktur (ha) & Produktion (t) je Kultur — Fläche × Ertrag × (1−Verlust).
 *  Basisjahr = aktueller Anbauplan (beregneter Kernblock). */
/* PolicyPanel entfernt 31.07.2026 — ersetzt durch die Jahresspalten im Anbauplan. */

function ProduktionsTabelle() {
  const { domain, view } = useModelStore();
  const sc = view.scenarioId;
  // Native Zeilen: beregnet + trocken kommen beide aus dem Anbauplan (pool). Die Trockenkulturen
  // (weizen_dry …) tragen ihre eigenen Rain-fed-Ertragsannahmen — kein separater Abschlag mehr.
  // Flaeche je PLANJAHR statt e.areaHa (Startjahr). Fuenf der sieben Kulturen beginnen 2028
  //  und standen hier mit 0 ha, 0 t und 0 % Anteil — die Tabelle zeigte den Betrieb von 2027
  //  und nannte ihn "Anbaustruktur & Produktion". Jahr waehlbar, Vorbelegung Endausbau.
  const my = React.useMemo(() => deriveCropAreasMY(domain), [domain]);
  const [jahrIdx, setJahrIdx] = React.useState<number>(JAHR_DEFAULT);
  const yi = Math.min(Math.max(0, jahrIdx), my.years - 1);
  const allRows = domain.anbauplan.map((e) => {
    const ha = my.areas[e.cropId]?.[Math.min(yi, (my.areas[e.cropId]?.length ?? 1) - 1)] ?? e.areaHa;
    const y = cropYield(domain, e.cropId, sc);
    const loss = cropLoss(domain, e.cropId, sc);
    const t = netTonnes(domain, e.cropId, sc, ha, false);
    const entry = domain.catalog.find((c) => c.cropId === e.cropId);
    return { id: e.id, cropId: e.cropId, name: entry?.name ?? e.cropId, ha, y, loss, t, pool: e.pool ?? "irrigated" };
  });
  const rows = allRows.filter((r) => r.pool !== "dryland");
  const dryRows = allRows.filter((r) => r.pool === "dryland");
  const beregHa = rows.reduce((a, r) => a + r.ha, 0);
  const beregT = rows.reduce((a, r) => a + r.t, 0);
  const showDry = dryRows.length > 0;
  const dryTotHa = dryRows.reduce((a, r) => a + r.ha, 0);
  const dryTotT = dryRows.reduce((a, r) => a + r.t, 0);
  const grandHa = beregHa + dryTotHa;
  const grandT = beregT + dryTotT;
  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-[14px] font-semibold">{t("Anbaustruktur & Produktion")}</h2>
          <JahrWahl jahre={my.years} wert={yi} onChange={setJahrIdx} label="" />
        </div>
        <span className="caption text-[10.5px] text-nx-text-muted">{t("Fläche × Ertrag × (1 − Verlust) → Netto-Erntemenge ·")} {fmtNumber(grandT, 0)} t</span>
      </div>
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="caption text-[10.5px] text-nx-text-muted">
              <th className="px-2 py-2 text-left">{t("Kultur")}</th>
              <th className="px-2 py-2 text-left">{t("Beregnung")}</th>
              <th className="px-2 py-2 text-right">{t("Fläche (ha)")}</th>
              <th className="px-2 py-2 text-right">{t("Anteil")}</th>
              <th className="px-2 py-2 text-right">{t("Ertrag (t/ha)")}</th>
              <th className="px-2 py-2 text-right">{t("Verlust")}</th>
              <th className="px-2 py-2 text-right">{t("Produktion netto (t)")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: cropColor(r.cropId), display: "inline-block" }} />
                    {t(r.name)}
                  </span>
                </td>
                <td className="px-2 py-2"><BeregBadge kind="beregnet" /></td>
                <td className="num px-2 py-2 text-right">{fmtNumber(r.ha, 0)}</td>
                <td className="num px-2 py-2 text-right text-nx-text-muted">{fmtNumber(grandHa > 0 ? (r.ha / grandHa) * 100 : 0, 0)}%</td>
                <td className="num px-2 py-2 text-right">{fmtNumber(r.y, 1)}</td>
                <td className="num px-2 py-2 text-right text-nx-text-muted">{fmtNumber(r.loss * 100, 0)}%</td>
                <td className="num px-2 py-2 text-right font-semibold">{fmtNumber(r.t, 0)}</td>
              </tr>
            ))}
            {showDry && dryRows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--nx-border-divider)", background: "color-mix(in srgb, var(--nx-warn, #C9A227) 5%, transparent)" }}>
                <td className="px-2 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: cropColor(r.cropId), display: "inline-block", opacity: 0.6 }} />
                    {t(r.name)}
                  </span>
                </td>
                <td className="px-2 py-2"><BeregBadge kind="trocken" /></td>
                <td className="num px-2 py-2 text-right">{fmtNumber(r.ha, 0)}</td>
                <td className="num px-2 py-2 text-right text-nx-text-muted">{fmtNumber(grandHa > 0 ? (r.ha / grandHa) * 100 : 0, 0)}%</td>
                <td className="num px-2 py-2 text-right">{fmtNumber(r.y, 1)}</td>
                <td className="num px-2 py-2 text-right text-nx-text-muted">{fmtNumber(r.loss * 100, 0)}%</td>
                <td className="num px-2 py-2 text-right font-semibold">{fmtNumber(r.t, 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-2 py-2.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Beregnet ·")} {rows.length} {t("Kulturen")}</td>
              <td className="num px-2 py-2.5 text-right font-semibold">{fmtNumber(beregHa, 0)}</td>
              <td className="px-2 py-2.5" colSpan={3} />
              <td className="num px-2 py-2.5 text-right font-semibold">{fmtNumber(beregT, 0)} t</td>
            </tr>
            {showDry && (
              <tr>
                <td className="px-2 py-1.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Trocken ·")} {dryRows.length} {t("Kulturen")}</td>
                <td className="num px-2 py-1.5 text-right font-semibold">{fmtNumber(dryTotHa, 0)}</td>
                <td className="px-2 py-1.5" colSpan={3} />
                <td className="num px-2 py-1.5 text-right font-semibold">{fmtNumber(dryTotT, 0)} t</td>
              </tr>
            )}
            {showDry && (
              <tr style={{ borderTop: "1px solid var(--nx-border)" }}>
                <td className="px-2 py-2 font-bold" style={{ color: "var(--nx-brand-lift)" }} colSpan={2}>{t("Gesamtbetrieb")}</td>
                <td className="num px-2 py-2 text-right font-bold">{fmtNumber(grandHa, 0)}</td>
                <td className="px-2 py-2" colSpan={3} />
                <td className="num px-2 py-2 text-right font-bold">{fmtNumber(grandT, 0)} t</td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
        {t("Netto-Erntemenge nach Feld-/Lagerverlust. Beregnete Kulturen: Basis für Umsatz (× Preis × Kontrakt-Qualität). Trockenkulturen (☀): Rain-fed-Ertrag mit eigener Bottom-up-Kalkulation — volle Kosten (Agronomie, Maschinen, Personal, Fixkosten) über die gesamte Fläche gerechnet, nicht als Pauschale. Flächenentwicklung über die Jahre steht im Wachstumsplan.")}
      </div>
    </section>
  );
}
