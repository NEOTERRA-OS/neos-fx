"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { NumberInput } from "./NumberInput";
import { fmtMoney, fmtNumber } from "../../design/format";
import { cropStructure, type CropRow } from "./cropCalc";
import { effectiveGrowth, deriveCropAreasMY, START_YEAR } from "../../store/model";
import { t } from "../../lib/i18n";
import { X } from "lucide-react";


/** Wachstum — EINE konsolidierte Sicht (über ha, keine Stufen):
 *  Akquiseprofil (Deals) → Flächen-Ramp (editierbar) → Wachstums-CAPEX (Beregnungsausbau + Zukauf
 *  je Deal, mit Finanzierung FK/EK). Alles fließt verdrahtet in Bilanz/Cashflow/Covenants. */
export function MehrjahresplanView() {
  const { domain, patch, view } = useModelStore();
  const sc = view.scenarioId;
  const g = domain.growth;
  if (!g) return <div className="text-[12px] text-nx-text-muted">{t("Kein Wachstumsplan konfiguriert.")}</div>;

  // SOLO-MODELL: keine Wachstumsstufen und kein Akquiseprofil mehr. Die Flächenkurve IST der
  //  Kultur-Skalierungspfad und bleibt hier editierbar; Wachstums-CAPEX = Beregnungsausbau.
  const eg = effectiveGrowth(g) ?? g;
  const years = g.years;
  const irr = (y: number) => eg.areaByYear[y] ?? 0;
  const tot = (y: number) => eg.totalByYear?.[y] ?? irr(y);
  const irrCapex = g.irrigEurPerHaCent ?? 0;
  const startTot = g.startTotalHa ?? tot(0);
  const startIrr = g.startIrrigatedHa ?? irr(0);
  const dIrr = (y: number) => Math.max(0, irr(y) - (y > 0 ? irr(y - 1) : startIrr));

  const setIrr = (y: number, v: number) => patch((d) => { if (d.growth) d.growth.areaByYear[y] = Math.max(0, Math.round(v)); });
  const setTot = (y: number, v: number) => patch((d) => { if (d.growth) { const t = d.growth.totalByYear ?? d.growth.areaByYear.slice(); t[y] = Math.max(0, Math.round(v)); d.growth.totalByYear = t; } });
  const setG = (fn: (gp: any) => void) => patch((d) => { if (d.growth) fn(d.growth); });

  const beregY = (y: number) => dIrr(y) * irrCapex;
  const sum = (f: (y: number) => number) => { let s = 0; for (let y = 0; y < years; y++) s += f(y); return s; };
  const sumBereg = sum(beregY);

  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";
  const Y = Array.from({ length: years }, (_, y) => y);
  const kpi: [string, string, string?][] = [
    [t("Start") + " " + START_YEAR, `${fmtNumber(startIrr, 0)} ha`],
    [`${t("Ziel")} ${START_YEAR + years - 1}`, `${fmtNumber(irr(years - 1), 0)} ha`],
    [t("Σ Beregnungsausbau"), `${fmtMoney(sumBereg)} €`, "var(--nx-brand-lift)"],
  ];

  return (
    <div className="space-y-4">
      {/* ENTFERNT 31.07.2026: Wachstumsstufen-Auswahl und Akquiseprofil (Betriebsübernahmen,
          Pachtpakete, Land-CAPEX). Es gibt eine Stufe, und gewachsen wird über Pachtfläche. */}
      {/* Flächen-Ramp — in s3b editierbar, sonst aus der Stufe abgeleitet */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Flächen-Ramp (ha je Jahr — editierbar)")}</h3>
        </div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead><tr><th className={th + " text-left"}>{t("Position")}</th>{Y.map((y) => <th key={y} className={th + " text-right"}>{START_YEAR + y}</th>)}</tr></thead>
            <tbody>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5 text-nx-text-secondary font-semibold">{t("Gesamtfläche")}</td>
                {Y.map((y) => <td key={y} className="px-2 py-1.5 text-right"><NumberInput value={tot(y)} width={66} onCommit={(v) => setTot(y, v)} /></td>)}
              </tr>
              <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                <td className="px-2 py-1.5" style={{ color: "var(--nx-brand-lift)" }}>{t("· davon beregnet")}</td>
                {Y.map((y) => <td key={y} className="px-2 py-1.5 text-right"><NumberInput value={irr(y)} width={66} onCommit={(v) => setIrr(y, v)} /></td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Wachstums-CAPEX — Beregnungsausbau + Akquiseprofil, mit Finanzierung */}
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Wachstums-CAPEX (Investitionsbedarf je Jahr)")}</h3>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-nx-text-muted">{t("Beregnung €/ha")}
            <NumberInput value={irrCapex} moneyCent width={84} onCommit={(v) => setG((gp) => { gp.irrigEurPerHaCent = Math.max(0, Math.round(v)); })} /></label>
        </div>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full text-[12px]">
            <thead><tr><th className={th + " text-left"}>{t("Position")}</th>{Y.map((y) => <th key={y} className={th + " text-right"}>{START_YEAR + y}</th>)}<th className={th + " text-right"}>Σ</th></tr></thead>
            <tbody>
              <Row label={t("Δ beregnet (ha)")} y={Y} f={dIrr} muted num0 />
              <Row label={t("Beregnungsausbau (Pivot)")} y={Y} f={beregY} sum={sumBereg} color="var(--nx-brand-lift)" />
              <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                <td className="px-2 py-2 font-semibold">{t("Σ Wachstums-CAPEX")}</td>
                {Y.map((y) => <td key={y} className="num px-2 py-2 text-right font-semibold">{beregY(y) ? fmtMoney(beregY(y)) : "–"}</td>)}
                <td className="num px-2 py-2 text-right font-semibold">{fmtMoney(sumBereg)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Beregnungsausbau → Pivot-Asset (AfA, 15 J.), finanziert zu 40 % über einen Investitionskredit. Greift erst ab dem in den Annahmen gesetzten Startjahr — davor wird bereits beregnete Fläche gepachtet.")}
        </div>
      </section>

      {/* Anbaustruktur & Produktion — Flächenentwicklung → Kulturen (ha) & Erntemenge (t) */}
      <AnbauMatrix Y={Y} irrByYear={Y.map(irr)} dryByYear={Y.map(() => 0)} domain={domain} sc={sc} />
    </div>
  );
}

/** Anbaustruktur (ha) & Produktion (t) je Kultur über die Wachstumsjahre.
 *  Beregneter Block skaliert mit der Beregnungsfläche (Anbauplan-Anteile),
 *  (nur Wertkulturen — eine unberegnete Rotation gibt es nicht mehr). */
function AnbauMatrix({ Y, irrByYear, dryByYear, domain, sc }: { Y: number[]; irrByYear: number[]; dryByYear: number[]; domain: any; sc: string }) {
  const [mode, setMode] = React.useState<"ha" | "t">("ha");
  // Flächen je Jahr aus der KULTUR-SKALIERUNGSPOLITIK (Skalierungspfad/ramp/fix/Markt-Caps),
  //  nicht mehr als proportionale Streckung des Anbauplans — sonst zeigt die Matrix jedes Jahr
  //  dieselbe Struktur, obwohl Kartoffel 300 → 1.000 ha läuft.
  const myAreas = React.useMemo(() => deriveCropAreasMY(domain).areas, [domain]);
  const structByYear = Y.map((y) => {
    const over: Record<string, number> = {};
    for (const [cid, curve] of Object.entries(myAreas)) over[cid] = curve[Math.min(y, curve.length - 1)] ?? 0;
    return cropStructure(domain, sc, irrByYear[y], dryByYear[y], over);
  });
  const keyOf = (r: CropRow) => r.cropId + "|" + (r.dry ? 1 : 0);
  // stabile Zeilenliste aus dem letzten Jahr (alle Kulturen sicher vorhanden)
  const last = structByYear[structByYear.length - 1];
  const keys = last.map((r) => ({ key: keyOf(r), name: r.name, color: r.color, dry: r.dry }));
  const cell = (y: number, key: string) => structByYear[y].find((r) => keyOf(r) === key);
  const val = (r?: CropRow) => !r ? 0 : mode === "ha" ? r.ha : r.tonnes;
  const fmt = (v: number) => v ? fmtNumber(v, 0) : "–";
  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";
  const sumRow = (dry: boolean, y: number) => structByYear[y].filter((r) => r.dry === dry).reduce((s, r) => s + val(r), 0);
  const grand = (y: number) => structByYear[y].reduce((s, r) => s + val(r), 0);

  const Block = ({ dry, label }: { dry: boolean; label: string }) => (
    <>
      <tr style={{ background: "var(--nx-app-bg)" }}>
        <td className="px-2 py-1 caption text-[10px] font-semibold" style={{ color: dry ? "var(--nx-text-muted)" : "var(--nx-brand-lift)" }} colSpan={Y.length + 2}>{label}</td>
      </tr>
      {keys.filter((k) => k.dry === dry).map((k) => (
        <tr key={k.key} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
          <td className="px-2 py-1.5">
            <span className="inline-flex items-center gap-2">
              <span style={{ width: 9, height: 9, borderRadius: 2, background: k.color, display: "inline-block" }} />
              {k.name}{dry ? t(" ·  unber.") : ""}
            </span>
          </td>
          {Y.map((y) => <td key={y} className="num px-2 py-1.5 text-right" style={{ color: "var(--nx-text)" }}>{fmt(val(cell(y, k.key)))}</td>)}
          <td className="num px-2 py-1.5 text-right font-semibold">{fmt(val(cell(Y.length - 1, k.key)))}</td>
        </tr>
      ))}
      <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
        <td className="px-2 py-1.5 text-[11px] font-semibold" style={{ color: dry ? "var(--nx-text-muted)" : "var(--nx-brand-lift)" }}>Σ {dry ? t("unberegnet") : t("beregnet")}</td>
        {Y.map((y) => <td key={y} className="num px-2 py-1.5 text-right font-semibold" style={{ color: dry ? "var(--nx-text-muted)" : "var(--nx-brand-lift)" }}>{fmt(sumRow(dry, y))}</td>)}
        <td className="num px-2 py-1.5 text-right font-semibold">{fmt(sumRow(dry, Y.length - 1))}</td>
      </tr>
    </>
  );

  return (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h3 className="text-[13px] font-semibold">{t("Anbaustruktur & Produktion je Jahr")}</h3>
        <div className="inline-flex rounded-control border overflow-hidden" style={{ borderColor: "var(--nx-border)" }}>
          {(["ha", "t"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className="px-3 text-[11px] font-semibold"
              style={{ height: 30, background: mode === m ? "var(--nx-green)" : "var(--nx-surface)", color: mode === m ? "#fff" : "var(--nx-text-secondary)" }}>
              {m === "ha" ? t("Fläche (ha)") : t("Produktion (t)")}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full text-[12px]">
          <thead><tr><th className={th + " text-left"}>{t("Kultur")}</th>{Y.map((y) => <th key={y} className={th + " text-right"}>{START_YEAR + y}</th>)}<th className={th + " text-right"}>{t("Ziel")}</th></tr></thead>
          <tbody>
            <Block dry={false} label={t("Wertkulturen")} />
            <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
              <td className="px-2 py-2 font-semibold">{t("Gesamt")} ({mode === "ha" ? "ha" : "t"})</td>
              {Y.map((y) => <td key={y} className="num px-2 py-2 text-right font-semibold">{fmt(grand(y))}</td>)}
              <td className="num px-2 py-2 text-right font-semibold">{fmt(grand(Y.length - 1))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
        {t("Fläche je Kultur und Jahr aus der Kultur-Skalierungspolitik. Produktion (t) = Fläche × Ertrag × (1 − Verlust).")}
      </div>
    </section>
  );
}

/** Zeile der CAPEX-Tabelle: Wert je Jahr (Geld) + Σ; num0 = Ganzzahl statt Geld. */
function Row({ label, y, f, sum, color, muted, num0 }: { label: string; y: number[]; f: (yy: number) => number; sum?: number; color?: string; muted?: boolean; num0?: boolean }) {
  const fmt = (v: number) => num0 ? fmtNumber(v, 0) : fmtMoney(v);
  return (
    <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
      <td className="px-2 py-1.5" style={{ color: muted ? "var(--nx-text-muted)" : (color ?? "var(--nx-text)") }}>{label}</td>
      {y.map((yy) => <td key={yy} className="num px-2 py-1.5 text-right" style={{ color: muted ? "var(--nx-text-muted)" : "var(--nx-text)" }}>{f(yy) ? fmt(f(yy)) : "–"}</td>)}
      <td className="num px-2 py-1.5 text-right font-semibold" style={{ color: color ?? "var(--nx-text)" }}>{sum != null ? fmtMoney(sum) : ""}</td>
    </tr>
  );
}
