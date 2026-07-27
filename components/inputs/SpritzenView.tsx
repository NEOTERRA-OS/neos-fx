"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { deriveSprayFleet, spraySizing, SPRAY_WINDOWS } from "../../store/model";
import { readAssumption } from "../../store/modelStore";
import { fmtMoney, fmtNumber } from "../../design/format";
import { t as tr } from "../../lib/i18n";

/** Spritzstrategie & Mischpark (Delta 21.07.). Die Spritzenzahl ist der Mehrkultur-Sommerpeak
 *  (max. gleichzeitiger PSM-Bedarf ALLER Kulturen), nicht pauschal. Fließt in TCO/CAPEX/Bilanz.
 *  Deep-Dive: Pivot-Anpassung, Standardisierung, Tank-Optimierung (36 vs 48 m). */
function Kpi({ cap, val, unit, tone }: { cap: string; val: string; unit?: string; tone?: "ok" | "warn" | "acc" }) {
  const color = tone === "ok" ? "var(--nx-success)" : tone === "warn" ? "var(--nx-warning)" : tone === "acc" ? "var(--nx-warning)" : "var(--nx-text)";
  return (
    <div className="px-4 py-3" style={{ borderRight: "1px solid var(--nx-border-divider)" }}>
      <div className="caption text-[10.5px] font-bold text-nx-text-muted">{cap}</div>
      <div className="num text-[22px] font-bold leading-tight" style={{ color }}>
        {val}{unit && <span className="ml-1 text-[12px] font-normal text-nx-text-muted">{unit}</span>}
      </div>
    </div>
  );
}

export function SpritzenView() {
  const domain = useModelStore((s) => s.domain);
  const scenarioId = useModelStore((s) => s.view.scenarioId);
  const tick = useModelStore((s) => s.recalcTick);

  const { fleet, potatoArea, pivotHa, appl, tankGz, boom, speed, weekLabel } = React.useMemo(() => {
    const fleet = deriveSprayFleet(domain, scenarioId);
    const potatoArea = domain.anbauplan
      .filter((a) => a.cropId === "kartoffel_pommes" || a.cropId === "kartoffel_chips")
      .reduce((s, a) => s + a.areaHa, 0);
    const rd = (k: string) => readAssumption(domain, k, scenarioId) ?? 0;
    return {
      fleet, potatoArea,
      pivotHa: rd("spray.pivot_ha"), appl: rd("spray.appl_lha"), tankGz: rd("spray.tank_gz_l"),
      boom: rd("spray.boom_m"), speed: rd("spray.speed_kmh"),
      weekLabel: fleet.peakWeek ? `${tr("KW")} ${fleet.peakWeek}` : "–",
    };
  }, [domain, scenarioId, tick]);

  const pGz = readAssumption(domain, "mprice.spray_gz", scenarioId) ?? 0;
  const pSf = readAssumption(domain, "mprice.spray_sf", scenarioId) ?? 0;

  const border = { borderColor: "var(--nx-border)" } as const;
  const th = "px-3 py-2 text-right caption text-[10.5px] text-nx-text-muted";
  const td = "num px-3 py-1.5 text-right";
  const sectionHead = "px-1 pt-1 pb-2 text-[13px] font-semibold";

  // 1 · Pivot-Anpassung — deckt ein Tank einen Pivot?
  const tanks = [10000, 12000, 14000, 16000, 18000, 20000];

  // 3 · Tank-Optimierung sweep (36 vs 48 m)
  const sweep = (cat: "gezogen" | "selbstf", speedKmh: number, tset: number[]) =>
    tset.map((t) => ({
      tank: t,
      r36: spraySizing(domain, scenarioId, { cat, tankL: t, boomM: 36, speedKmh, areaHa: potatoArea }),
      r48: spraySizing(domain, scenarioId, { cat, tankL: t, boomM: 48, speedKmh, areaHa: potatoArea }),
    }));
  const trailSweep = sweep("gezogen", speed, [10000, 12000, 14000, 16000, 18000, 20000]);
  const selfSweep = sweep("selbstf", 15, [8000, 10000, 12000, 14000]);
  const min36Trail = Math.min(...trailSweep.map((r) => r.r36.need));
  const min48Trail = Math.min(...trailSweep.map((r) => r.r48.need));
  const min36Self = Math.min(...selfSweep.map((r) => r.r36.need));
  const min48Self = Math.min(...selfSweep.map((r) => r.r48.need));

  const A12 = spraySizing(domain, scenarioId, { cat: "gezogen", tankL: 12000, boomM: boom, speedKmh: speed, areaHa: potatoArea });
  const B14 = spraySizing(domain, scenarioId, { cat: "gezogen", tankL: tankGz, boomM: boom, speedKmh: speed, areaHa: potatoArea });

  return (
    <div className="space-y-4">
      <div className="rounded-tile border px-4 py-3 text-[12px] text-nx-text-secondary" style={border}>
        <b>{tr("Fenstergetriebene Flotte.")}</b> {tr("Die Spritzenzahl ist der Mehrkultur-Sommerpeak — der maximale gleichzeitige PSM-Bedarf")} <b>{tr("aller")}</b> {tr("Kulturen (Kartoffel-Blight + Tomate/Gemüse + Getreide/Ölsaaten), nicht nur das Kartoffel-Fenster. Mischpark")} <b>{tr("gezogen (Dammann 14.000 l)")}</b> + <b>{tr("Selbstfahrer (12.000 l)")}</b>{tr(". Die Flotte fließt über den TCO-Pfad in CAPEX/Bilanz. Alle operativen Größen unter „Preise & Treiber → Spritzstrategie\".")}
      </div>

      <div className="rounded-tile border grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6" style={{ ...border, background: "var(--nx-surface)", overflow: "hidden" }}>
        <Kpi cap={tr("Spritzen (Peak)")} val={fmtNumber(fleet.total, 0)} unit={weekLabel} tone="acc" />
        <Kpi cap={tr("gezogen / SF")} val={`${fleet.gz} / ${fleet.sf}`} />
        <Kpi cap={tr("Fläche/Tag je Sp.")} val={fmtNumber(fleet.haPerDayGz, 0)} unit="ha" />
        <Kpi cap={tr("ha je Füllung gez.")} val={fmtNumber(fleet.haPerFillGz, 0)} unit="ha" />
        <Kpi cap={`${tr("deckt")} ${fmtNumber(pivotHa, 0)}${tr("-ha-Pivot")}`} val={fleet.coversPivot ? tr("ja") : tr("nein")} tone={fleet.coversPivot ? "ok" : "warn"} />
        <Kpi cap={tr("TCO Spritzen/Jahr")} val={fmtMoney(fleet.perYearCent)} unit="€" tone="acc" />
      </div>

      {/* 1 · Pivot-Anpassung */}
      <section className="rounded-tile border px-4 py-3" style={{ ...border, background: "var(--nx-surface)" }}>
        <div className={sectionHead} style={{ color: "var(--nx-brand-lift)" }}>{tr("1 · Pivot-Anpassung — deckt ein Tank einen Pivot?")}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr>
              <th className={th + " text-left"}>{tr("Tank gezogen")}</th><th className={th}>{tr("ha je Füllung")}</th>
              <th className={th}>{tr("Füllungen je Pivot")}</th><th className={th}>{tr("deckt Pivot?")}</th><th className={th}>{tr("max l/ha 1-Füllung")}</th>
            </tr></thead>
            <tbody>
              {tanks.map((t) => {
                const haF = appl > 0 ? t / appl : 0;
                const ok = haF >= pivotHa;
                const active = t === tankGz;
                return (
                  <tr key={t} style={{ borderTop: "1px solid var(--nx-border-divider)", background: active ? "var(--nx-surface-alt)" : undefined, fontWeight: active ? 700 : 400 }}>
                    <td className="num px-3 py-1.5 text-left">{fmtNumber(t / 1000, 0)}k l</td>
                    <td className={td}>{fmtNumber(haF, 0)} ha</td>
                    <td className={td}>{fmtNumber(pivotHa > 0 ? haF / pivotHa : 0, 1)}</td>
                    <td className={td} style={{ color: ok ? "var(--nx-success)" : "var(--nx-warning)" }}>{ok ? tr("ja") : tr("nein")}</td>
                    <td className={td}>{fmtNumber(pivotHa > 0 ? t / pivotHa : 0, 0)} l/ha</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2 · Standardisierung */}
      <section className="rounded-tile border px-4 py-3" style={{ ...border, background: "var(--nx-surface)" }}>
        <div className={sectionHead} style={{ color: "var(--nx-brand-lift)" }}>{tr("2 · Standardisierung — alle 12.000 l vs. 14k gezogen / 12k SF")}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr>
              <th className={th + " text-left"}>{tr("Kennzahl")}</th><th className={th}>{tr("Alle 12.000 l")}</th><th className={th}>{tr("14k gez. / 12k SF")}</th>
            </tr></thead>
            <tbody>
              {[
                [tr("ha je Füllung gezogen"), `${fmtNumber(appl > 0 ? 12000 / appl : 0, 0)} ha`, `${fmtNumber(appl > 0 ? tankGz / appl : 0, 0)} ha`],
                [tr("Spritzen nötig (Kartoffel)"), String(A12.need), String(B14.need)],
                [tr("Standardisierung"), tr("maximal (1 Tankgröße)"), tr("2 Tankgrößen")],
                [tr("TCO/Jahr gezogen"), `${fmtMoney(A12.tcoYearCent)} €`, `${fmtMoney(B14.tcoYearCent)} €`],
              ].map((r, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--nx-border-divider)", fontWeight: i === 3 ? 700 : 400 }}>
                  <td className="px-3 py-1.5 text-left">{r[0]}</td>
                  <td className={td}>{r[1]}</td><td className={td}>{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3 · Tank-Optimierung 36 vs 48 m */}
      <section className="rounded-tile border px-4 py-3" style={{ ...border, background: "var(--nx-surface)" }}>
        <div className={sectionHead} style={{ color: "var(--nx-brand-lift)" }}>{tr("3 · Tank-Optimierung (36 vs 48 m) — ab wann sinkt die Flotte?")}</div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[
            { title: `${tr("Gezogen")} (${fmtNumber(speed, 0)} km/h)`, rows: trailSweep, m36: min36Trail, m48: min48Trail },
            { title: tr("Selbstfahrer (15 km/h)"), rows: selfSweep, m36: min36Self, m48: min48Self },
          ].map((tbl) => (
            <div key={tbl.title} className="overflow-x-auto">
              <div className="num pb-1 text-[12px] font-bold" style={{ color: "var(--nx-brand-lift)" }}>{tbl.title}</div>
              <table className="w-full text-[12px]">
                <thead><tr>
                  <th className={th + " text-left"}>{tr("Tank")}</th><th className={th}>{tr("Sp 36")}</th><th className={th}>TCO/J 36</th><th className={th}>{tr("Sp 48")}</th><th className={th}>TCO/J 48</th>
                </tr></thead>
                <tbody>
                  {tbl.rows.map((r) => (
                    <tr key={r.tank} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                      <td className="num px-3 py-1.5 text-left">{fmtNumber(r.tank / 1000, 0)}k l</td>
                      <td className={td} style={r.r36.need === tbl.m36 ? { color: "var(--nx-success)", fontWeight: 700 } : undefined}>{r.r36.need}</td>
                      <td className={td}>{fmtMoney(r.r36.tcoYearCent)}</td>
                      <td className={td} style={r.r48.need === tbl.m48 ? { color: "var(--nx-success)", fontWeight: 700 } : undefined}>{r.r48.need}</td>
                      <td className={td}>{fmtMoney(r.r48.tcoYearCent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>

      <div className="rounded-tile border px-4 py-3 text-[12px] text-nx-text-secondary" style={border}>
        <b>{tr("Flotte am Mehrkultur-Sommerpeak dimensioniert.")}</b> {fleet.total} {tr("Spritzen (")}{fleet.gz} {tr("gezogen +")} {fleet.sf} {tr("Selbstfahrer) = maximaler gleichzeitiger PSM-Bedarf aller Kulturen im Sommer (")}{weekLabel}{tr("). Wasseraufwand")} {fmtNumber(appl, 0)} {tr("l/ha (Kartoffel-Blight-Label 200–400).")} {fleet.coversPivot
          ? `${tr("Der")} ${fmtNumber(tankGz / 1000, 0)}${tr("k-Tank deckt einen")} ${fmtNumber(pivotHa, 0)}${tr("-ha-Pivot in einer Füllung.")}`
          : `${tr("⚠️ Der")} ${fmtNumber(tankGz / 1000, 0)}${tr("k-Tank deckt bei")} ${fmtNumber(appl, 0)} ${tr("l/ha keinen")} ${fmtNumber(pivotHa, 0)}${tr("-ha-Pivot.")}`}
        {" "}{tr("Grün = kleinste Tankgröße mit minimaler Flotte. Preise: gezogen")} {fmtMoney(pGz)} € · {tr("Selbstfahrer")} {fmtMoney(pSf)} €.
        {" "}{tr("Fenster je Kultur (KW):")} {Object.entries(SPRAY_WINDOWS).map(([, w], i) => `${i ? " · " : ""}${w.kwS}–${w.kwE}`).join("")}.
      </div>
    </div>
  );
}
