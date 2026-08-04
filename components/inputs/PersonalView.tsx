"use client";
import React from "react";
import { useModelStore, readAssumption } from "../../store/modelStore";
import {
  PERSONAL_POSITIONEN, personalFteOfYear, personalRatioOf, setPersonalRatio,
  setPersonalOverride, hasPersonalOverride, selfOperatedFieldHoursOfYear,
  machineCapPerUnitHours, machineDemandHoursOfYear, deriveCropAreasMY, START_YEAR,
} from "../../store/model";
import { personalMonatsgewichte, CROP_CAL } from "../../store/model";

import { Feld, FeldRoh } from "./Feld";
import { JahrWahl } from "./JahrWahl";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t } from "../../lib/i18n";
import { RotateCcw, CalendarRange, Info } from "lucide-react";
import { Marke } from "../primitives/Control";

/** PERSONALPLANUNG — eine Tabelle, ein Treiber je Zeile.
 *
 *  Vorher zeigte dieser Screen für dieselbe Größe drei verschiedene Zahlen nebeneinander:
 *  ein editierbares Feld (das in Wahrheit die Kalibrierungsbasis für den Endausbau war,
 *  nicht die Mannschaft), die Kurve, die die Engine daraus rechnete, und die Vorschläge
 *  eines „Personalplaners", der seinerseits aus den Zahlen des STARTJAHRES rechnete und
 *  deshalb 2 Fahrer empfahl, wo die Kurve auf 9 lief. Keine der drei war beschriftet, und
 *  bei den Maschinenführern steuerte das Feld seit der Umstellung auf gefahrene Stunden
 *  überhaupt nichts mehr. Daher Σ 41,7 unten gegen Σ 38,7 oben und zwei verschiedene
 *  AG-Kosten auf demselben Bildschirm.
 *
 *  Jetzt: jede Position hat EINEN benannten Treiber und EIN Verhältnis — wie viele Hektar
 *  betreut eine Kraft, wie viele Stunden fährt ein Fahrer, wie viele Maschinen betreut ein
 *  Techniker. Daraus fällt die Kopfzahl je Planjahr, und sie reagiert automatisch, wenn
 *  Fläche wächst oder Arbeit fremdvergeben wird: was im Lohn läuft, fährt der
 *  Lohnunternehmer, was gemietet ist, wartet der Vermieter.
 *
 *  Der Treiber ist ein Vorschlag, keine Vorschrift. Jede Jahreszelle lässt sich
 *  überschreiben; der Rücksetz-Pfeil gibt sie der Rechnung zurück. So bleibt sichtbar, wo
 *  der Plan der Formel folgt und wo einer bewussten Entscheidung.
 */
export function PersonalView() {
  const { domain, patch } = useModelStore();
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);
  const readOnly = useModelStore((s) => s.readOnly);
  const years = Math.max(1, domain.growth?.years ?? 1);
  const Y = Array.from({ length: years }, (_, y) => y);

  const daten = React.useMemo(() => {
    const areas = deriveCropAreasMY(domain).areas;
    const haOf = (y: number) => domain.anbauplan.reduce((s, a) => {
      const c = areas[a.cropId];
      return s + (c ? (c[Math.min(y, c.length - 1)] ?? 0) : a.areaHa);
    }, 0);
    const eigeneMaschinen = (y: number) => {
      let n = 0;
      for (const m of domain.machineCatalog) {
        if (!m.cEff || (m.rentedUnits ?? 0) > 0) continue;
        const cap = machineCapPerUnitHours(domain, m.id, sc);
        if (cap > 0) n += Math.ceil(machineDemandHoursOfYear(domain, m.id, y) / cap);
      }
      return n;
    };
    return {
      ha: Y.map(haOf),
      stunden: Y.map((y) => selfOperatedFieldHoursOfYear(domain, y)),
      maschinen: Y.map(eigeneMaschinen),
      zeilen: PERSONAL_POSITIONEN.map((p) => ({
        pos: p,
        fte: Y.map((y) => personalFteOfYear(domain, p.key, y, sc)),
        brutto: readAssumption(domain, p.grossKey, sc) ?? 0,          // CENT / Monat
        overrides: domain.personalOverride?.[p.key] ?? [],
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, sc, tick, years]);

  const cam = domain.personnel?.rates?.cam ?? 0.0225;
  const agKostenJahr = (y: number) => daten.zeilen.reduce((s, z) => s + z.fte[y] * z.brutto * 12 * (1 + cam), 0);
  const fteJahr = (y: number) => daten.zeilen.reduce((s, z) => s + z.fte[y], 0);

  const th = "px-2 py-2 caption text-[10px] text-nx-text-muted";
  const card: React.CSSProperties = { borderColor: "var(--nx-border)", background: "var(--nx-surface)" };

  return (
    <div className="space-y-3">
      <section className="rounded-tile border" style={card}>
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Personalplanung")}</h2>
          <span className="text-[11px] text-nx-text-muted">
            {t("Je Position ein Treiber und ein Verhältnis — daraus fällt die Kopfzahl je Planjahr. Jede Zelle lässt sich überschreiben.")}
          </span>
          <span className="caption ml-auto text-[10px] text-nx-text-muted">
            {t("Σ FTE")} {fmtNumber(fteJahr(0), 1)} → {fmtNumber(fteJahr(years - 1), 1)} · {t("AG-Kosten")} {fmtMoney(agKostenJahr(years - 1))} €
          </span>
        </div>

        {/* Treibergrößen — die Basis, auf der alles darunter rechnet. Sie stehen sichtbar
            oben, damit die Kopfzahl nachvollziehbar bleibt und nicht aus dem Nichts kommt. */}
        <div className="overflow-x-auto border-b px-2 py-1" style={{ borderColor: "var(--nx-border)" }}>
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                <th className={th + " text-left"} style={{ minWidth: 300 }}>{t("Treibergröße")}</th>
                {Y.map((y) => <th key={y} className={th + " text-right"}>{START_YEAR + y}</th>)}
              </tr>
            </thead>
            <tbody>
              {([
                [t("Betriebsfläche (ha)"), daten.ha],
                [t("selbst gefahrene Feldstunden (h)"), daten.stunden],
                [t("eigene Maschinen (Stk)"), daten.maschinen],
              ] as [string, number[]][]).map(([label, reihe]) => (
                <tr key={label} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1 text-nx-text-secondary">{label}</td>
                  {Y.map((y) => <td key={y} className="num px-2 py-1 text-right text-nx-text-muted">{fmtNumber(reihe[y], 0)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto px-2 py-1">
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                <th className={th + " text-left"} style={{ minWidth: 300 }}>{t("Position / Treiber")}</th>
                <th className={th + " text-right"}>{t("Verhältnis")}</th>
                <th className={th + " text-right"}>{t("Brutto/Monat")}</th>
                {Y.map((y) => <th key={y} className={th + " text-right"}>{START_YEAR + y}</th>)}
              </tr>
            </thead>
            <tbody>
              {daten.zeilen.map((z) => (
                <tr key={z.pos.key} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">
                      {t(z.pos.label)}
                      {hasPersonalOverride(domain, z.pos.key) && (
                        <span className="ml-1.5 rounded px-1 text-[9px] font-bold"
                          style={{ color: "var(--nx-locate)", background: "var(--nx-app-bg)" }}>{t("Hand")}</span>
                      )}
                    </div>
                    <div className="text-[9.5px] text-nx-text-muted">{t(z.pos.treiberLabel)}</div>
                  </td>
                  <td className="px-1 py-1.5 text-right">
                    <FeldRoh wert={personalRatioOf(domain, z.pos.key)} unit={z.pos.einheitId} breite={64}
                      onCommit={(v) => patch((d) => setPersonalRatio(d, z.pos.key, v))} titel={t(z.pos.treiberLabel)} />
                  </td>
                  <td className="px-1 py-1.5 text-right"><Feld akey={z.pos.grossKey} breite={96} einheitZeigen={false} /></td>
                  {Y.map((y) => {
                    const hand = z.overrides[y];
                    const manuell = hand != null && isFinite(hand as number);
                    return (
                      <td key={y} className="px-1 py-1.5 text-right"
                          style={{ background: manuell ? "color-mix(in srgb, var(--nx-locate) 10%, transparent)" : undefined }}>
                        <FeldRoh wert={z.fte[y]} unit="fte" breite={62} einheitZeigen={false} hervor={manuell}
                          onCommit={(v) => patch((d) => setPersonalOverride(d, z.pos.key, y, v))}
                          marker={manuell && !readOnly ? (
                            <button className="text-[10px] text-nx-text-muted hover:text-nx-error"
                              title={t("Handeingabe entfernen — wieder dem Treiber folgen")}
                              onClick={() => patch((d) => setPersonalOverride(d, z.pos.key, y, null))}>
                              <RotateCcw size={10} />
                            </button>
                          ) : null} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                <td className="px-2 py-2 font-semibold" colSpan={3}>{t("Σ FTE")}</td>
                {Y.map((y) => <td key={y} className="num px-2 py-2 text-right font-semibold">{fmtNumber(fteJahr(y), 1)}</td>)}
              </tr>
              <tr>
                <td className="px-2 py-2 font-semibold" colSpan={3}>{t("AG-Personalaufwand p. a. (Brutto + CAM)")}</td>
                {Y.map((y) => <td key={y} className="num px-2 py-2 text-right font-semibold" style={{ color: "var(--nx-locate)" }}>{fmtMoney(agKostenJahr(y))}</td>)}
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Kopfzahl = Treibergröße ÷ Verhältnis. Leitung und Werkstatt sind gedämpft (Sockel 45 % + 55 % flächenproportional) — ein achtmal so großer Betrieb braucht keine achtfache Leitung. Die Maschinenführer folgen den SELBST gefahrenen Feldstunden: was im Lohn vergeben wird, fährt der Lohnunternehmer, was gemietet ist, wartet der Vermieter — beides senkt die Kopfzahl automatisch.")}
          <br />
          {t("Eine Zahl in eine Jahresspalte zu schreiben überschreibt den Treiber für dieses Jahr (blau markiert); der Rücksetz-Pfeil gibt die Zelle wieder der Rechnung zurück. Nicht enthalten: Erntehandarbeit — sie ist als Direktkosten je Kultur verbucht — und LKW-Fahrer, die in der Transportkalkulation stecken.")}
        </div>
      </section>

      <SaisonKurve />
    </div>
  );
}

/**
 * SAISONKURVE — wann die Kopfzahl tatsächlich am Hof steht.
 *
 * `pers.saison.n` steht ausdrücklich als FTE-ÄQUIVALENT da: 11,7 Vollzeitäquivalente
 * heißen nicht elf Leute das ganze Jahr, sondern die Jahresarbeitszeit von elf
 * Leuten — geleistet in wenigen Wochen von entsprechend vielen. Bis zum 04.08.2026
 * verteilte der Composer diese Zahl flach auf zwölf Monate. Der Jahresbetrag stimmte,
 * die Kasse nicht: das Modell bezahlte Erntehelfer im Januar.
 *
 * Seither kommen die Monatsgewichte aus den ERNTEMONATEN des Anbauplans, gewichtet
 * mit der Fläche. Nur: sichtbar war das nirgends. Diese Tabelle ist der Ort — und
 * zugleich die Probe, denn zwei Dinge müssen ihr anzusehen sein:
 *
 *   · Festangestellte bleiben FLACH. Ein unbefristeter Vertrag ist flach.
 *   · Die Summe je Zeile bleibt der Jahresbetrag. Die Saisonalisierung verschiebt
 *     den Zeitpunkt, sie verändert die Kosten nicht.
 *
 * DIE ZWISCHENFRUCHT IST AUSGENOMMEN. Ihr „Erntemonat" im Anbauplan ist die
 * Einarbeitung im November. Mit 3.017 ha ist sie die größte Fläche des Plans und
 * hätte 44 % der Saisonarbeit in einen Monat gezogen, in dem niemand erntet.
 */
function SaisonKurve() {
  const domain = useModelStore((s) => s.domain);
  const sc = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);
  const jahre = Math.max(1, domain.growth?.years ?? 1);
  const [jy, setJy] = React.useState(jahre - 1);

  const MONAT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

  const zeilen = React.useMemo(() => PERSONAL_POSITIONEN.map((p) => {
    const fte = personalFteOfYear(domain, p.key, Math.min(jy, jahre - 1), sc);
    const w = personalMonatsgewichte(domain, p.key, Math.min(jy, jahre - 1), sc);
    return { pos: p, fte, w, kopf: w.map((x) => x * fte * 12) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [domain, sc, jy, jahre, tick]);

  // Erntemonate des Plans — die Herkunft der Gewichte, damit sie nicht aus dem Nichts kommen.
  const erntemonate = React.useMemo(() => {
    const m = new Set<number>();
    for (const a of domain.anbauplan) {
      if (a.zweitnutzung) continue;
      const e = a.harvestPeriods?.length ? a.harvestPeriods
        : ((CROP_CAL as Record<string, { harvest: number[] }>)[a.cropId]?.harvest ?? []);
      for (const x of e) m.add(((x % 12) + 12) % 12);
    }
    return [...m].sort((x, y) => x - y);
  }, [domain]);

  const summe = (i: number) => zeilen.reduce((s, z) => s + z.kopf[i], 0);
  const spitze = Math.max(...Array.from({ length: 12 }, (_, i) => summe(i)), 1);

  const th = "px-2 py-2 caption text-[10px] text-nx-text-muted";
  const card: React.CSSProperties = { borderColor: "var(--nx-border)", background: "var(--nx-surface)" };

  return (
    <section className="rounded-tile border" style={card}>
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
        <CalendarRange size={15} strokeWidth={2.3} aria-hidden className="text-nx-text-secondary" />
        <h2 className="text-[14px] font-semibold">{t("Saisonkurve — Kopfzahl je Monat")}</h2>
        <span className="text-[11px] text-nx-text-muted">
          {t("FTE sind Jahresarbeitszeit, keine Anwesenheit. Diese Zeile zeigt, wie viele Leute tatsächlich im Monat am Hof stehen.")}
        </span>
        <span className="ml-auto"><JahrWahl jahre={jahre} wert={Math.min(jy, jahre - 1)} onChange={setJy} /></span>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-b px-4 py-2" style={{ borderColor: "var(--nx-border)" }}>
        <span className="inline-flex items-center gap-2">
          <Marke>{t("Kampagnendauer")}</Marke>
          <Feld akey="pers.kampagne_monate" breite={78} />
        </span>
        <span className="text-[10.5px] text-nx-text-muted">
          {t("Monate, über die eine Erntekampagne läuft. Ohne diese Größe fiele die gesamte Saisonarbeit in genau einen Kalendermonat — 11,7 FTE wären dann 140 Köpfe im September.")}
        </span>
        <span className="ml-auto text-[10.5px] text-nx-text-muted">
          {t("Erntemonate im Plan")}:{" "}
          <b className="num text-nx-text-secondary">{erntemonate.map((m) => MONAT[m]).join(" · ") || "—"}</b>
        </span>
      </div>

      <div className="overflow-x-auto px-2 py-1">
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <th className={th + " text-left"} style={{ minWidth: 240 }}>{t("Position")}</th>
              <th className={th + " text-right"}>{t("FTE/Jahr")}</th>
              {MONAT.map((m, i) => (
                <th key={m} className={th + " text-right"}
                    style={{ color: erntemonate.includes(i) ? "var(--nx-locate)" : undefined }}>{t(m)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => {
              const flach = z.w.every((x) => Math.abs(x - 1 / 12) < 1e-9);
              return (
                <tr key={z.pos.key} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5 font-medium">
                      {t(z.pos.label)}
                      {/* Farbe trägt die Bedeutung nie allein — das Wort steht daneben. */}
                      <span className="rounded-pill px-1.5 py-[1px] text-[9px] font-bold"
                        style={flach
                          ? { background: "var(--nx-surface-sunken)", color: "var(--nx-text-muted)" }
                          : { background: "var(--nx-warning-bg)", color: "var(--nx-warning-text)" }}>
                        {flach ? t("flach") : t("saisonal")}
                      </span>
                    </div>
                  </td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-secondary">{fmtNumber(z.fte, 1)}</td>
                  {z.kopf.map((k, i) => (
                    <td key={i} className="num px-2 py-1.5 text-right"
                        style={{ color: k > z.fte * 1.5 ? "var(--nx-locate)" : k < 0.01 ? "var(--nx-text-muted)" : undefined,
                                 fontWeight: k > z.fte * 1.5 ? 700 : 400 }}>
                      {k < 0.005 ? "—" : fmtNumber(k, 1)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-2 py-2 font-semibold" colSpan={2}>{t("Σ Köpfe im Monat")}</td>
              {Array.from({ length: 12 }, (_, i) => (
                <td key={i} className="num px-2 py-2 text-right font-semibold">{fmtNumber(summe(i), 1)}</td>
              ))}
            </tr>
            <tr>
              <td className="px-2 py-1 text-[10px] text-nx-text-muted" colSpan={2}>{t("Auslastung ggü. der Spitze")}</td>
              {Array.from({ length: 12 }, (_, i) => (
                <td key={i} className="px-2 py-1">
                  {/* Balken statt Zahl: die Spitze soll man sehen, nicht ausrechnen. */}
                  <div className="ml-auto h-[5px] rounded-pill" style={{ width: "100%", background: "var(--nx-surface-sunken)" }}>
                    <div className="h-[5px] rounded-pill"
                      style={{ width: `${(summe(i) / spitze) * 100}%`, background: "var(--nx-brand-lift)" }} />
                  </div>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-start gap-2 border-t px-4 py-2 text-[10.5px] leading-relaxed text-nx-text-muted"
           style={{ borderColor: "var(--nx-border)" }}>
        <Info size={13} strokeWidth={2.2} aria-hidden className="mt-[2px] shrink-0" />
        <span>
          {t("Die Gewichte kommen aus den Erntemonaten des Anbauplans, gewichtet mit der Fläche, und laufen über die eingestellte Kampagnendauer weiter. Der JAHRESBETRAG bleibt unangetastet — die Saisonalisierung verschiebt den Zeitpunkt, nicht die Kosten; sichtbar wird sie in Revolverzins und Kassentiefstand. Die Zwischenfrucht ist ausgenommen: ihr „Erntemonat“ im Plan ist die Einarbeitung, und mit 3.017 ha hätte sie 44 % der Saisonarbeit in den November gezogen. Liegt der echte Kampagnenplan vor, gehört er in `personalSaison` und schlägt diese Ableitung.")}
        </span>
      </div>
    </section>
  );
}
