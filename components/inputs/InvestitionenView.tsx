"use client";
import React from "react";
import { useModelStore, selectDerivedCapex, readAssumption } from "../../store/modelStore";
import { fmtMoney, fmtNumber } from "../../design/format";
import { computeSoilSampling, machineUnitPriceCent, type MachineType } from "../../store/model";
import { Segmented } from "../primitives/Segmented";
import { NumberInput } from "./NumberInput";
import { CapexPlanEditor } from "./CapexPlanEditor";
import { t } from "../../lib/i18n";

/** Investitionen — NEUANSCHAFFUNGEN, sauber getrennt vom Bestand (Register):
 *  · Maschinen: Bedarf (Werkbank-Sizing) − Bestand = Neu × Netto-Stück → CAPEX, je Kategorie.
 *  · Übrige Kategorien: Bewässerung (€/ha), Gebäude/Lager (€/t), IoT/Sonstige.
 *  Wachstums-CAPEX (Land, Übernahmen, Beregnungsausbau) steht im Wachstumsplan. */
export function InvestitionenView() {
  const [tab, setTab] = React.useState<"maschinen" | "bewaesserung" | "lager" | "gebaeude">("maschinen");
  const { domain, patch } = useModelStore();
  const scenarioId = useModelStore((s) => s.view.scenarioId);
  const derived = useModelStore(selectDerivedCapex);
  const byId = new Map(domain.machineCatalog.map((m) => [m.id, m]));
  // Einkaufspreise (Liste/Discount) hier editierbar — für die Neuanschaffung; treibt die CAPEX live.
  const gDisc = readAssumption(domain, "tco.discount", scenarioId) ?? 0;
  const updM = (id: string, fn: (m: MachineType) => void) => patch((d) => { const i = d.machineCatalog.findIndex((m) => m.id === id); if (i >= 0) fn(d.machineCatalog[i]); });

  const mach = derived.filter((d) => d.assetClass === "machinery");
  const other = derived.filter((d) => d.assetClass !== "machinery" && d.amount > 0);
  const byClass = (cls: string) => derived.filter((d) => d.assetClass === cls).reduce((a, d) => a + d.amount, 0);
  const total = derived.reduce((a, d) => a + d.amount, 0);

  const CAT_ORDER = ["Zugmaschinen", "Bodenbearbeitung", "Aussaat & Pflanzung", "Düngung", "Pflanzenschutz", "Ernte", "Transport", "Logistik", "Hoftechnik", "Sonstiges"];
  const catOf = (id: string) => byId.get(id)?.category ?? "Sonstiges";
  const present = Array.from(new Set(mach.map((d) => catOf(d.machineId))));
  const cats = [...CAT_ORDER.filter((c) => present.includes(c)), ...present.filter((c) => !CAT_ORDER.includes(c))];

  // Kopfzeile beim Scrollen fixieren (sticky) — opaker Surface-Hintergrund, damit Zeilen darunter durchlaufen.
  const th = "sticky top-0 z-10 bg-[color:var(--nx-surface)] px-2 py-2 caption text-[10px] text-nx-text-muted";
  const CLS_LABEL: Record<string, string> = { irrigation: t("Bewässerung"), buildings: t("Gebäude & Infrastruktur"), other: t("IoT / Sonstige"), land: t("Land") };
  const otherIn = (classes: string[]) => other.filter((d) => classes.includes(d.assetClass));
  const renderWeitere = (list: typeof other, title: string, note?: string) => list.length === 0 ? null : (
    <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-locate)" }}>{title}</h3>
      </div>
      <div className="overflow-x-auto px-2 py-2">
        <table className="w-full text-[12px]">
          <thead><tr>
            <th className={th + " text-left"}>{t("Position")}</th>
            <th className={th + " text-left"}>{t("Kategorie")}</th>
            <th className={th + " text-right"}>{t("Treiber (Menge)")}</th>
            <th className={th + " text-right"}>{t("Stücksatz")}</th>
            <th className={th + " text-right"}>{t("Σ Investition")}</th>
          </tr></thead>
          <tbody>
            {list.map((d) => {
              const m = byId.get(d.machineId);
              const driver = m?.mode === "perHa" ? `${fmtNumber(d.count, 0)} ha` : m?.mode === "perTonne" ? `${fmtNumber(d.count, 0)} t` : fmtNumber(d.count, 0);
              return (
                <tr key={d.machineId} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                  <td className="px-2 py-1.5">{m?.productName ?? d.label}</td>
                  <td className="px-2 py-1.5 text-nx-text-muted">{CLS_LABEL[d.assetClass] ?? d.assetClass}</td>
                  <td className="num px-2 py-1.5 text-right">{driver}</td>
                  <td className="num px-2 py-1.5 text-right text-nx-text-muted">{fmtMoney(d.unitPrice)}</td>
                  <td className="num px-2 py-1.5 text-right font-semibold">{fmtMoney(d.amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {note && <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>{note}</div>}
    </section>
  );

  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Investitions-Vorschlag — Bedarf aus Kulturen & Leistungsparametern")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">{t("Bedarf (Anbauplan + Leistungsparameter) − Bestand = Vorschlag Neu")}</span>
        </div>
        <div className="grid grid-cols-2 gap-px sm:grid-cols-5" style={{ background: "var(--nx-border-divider)" }}>
          {([
            [t("Σ Investitionen"), total, "var(--nx-locate)"],
            [t("Maschinen"), byClass("machinery"), "var(--nx-brand-lift)"],
            [t("Bewässerung"), byClass("irrigation")],
            [t("Gebäude & Infrastruktur"), byClass("buildings")],
            [t("IoT / Sonstige"), byClass("other")],
          ] as [string, number, string?][]).map(([k, v, c], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[14px] font-semibold" style={{ color: c ?? "var(--nx-text)" }}>{fmtMoney(v)} €</div>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto px-4 py-3 border-t" style={{ borderColor: "var(--nx-border)" }}>
          <Segmented ariaLabel={t("Investitions-Ansicht")} value={tab} onChange={(v) => setTab(v as typeof tab)}
            options={[
              { value: "maschinen", label: t("Maschinen & Geräte") },
              { value: "bewaesserung", label: t("Bewässerung") },
              { value: "lager", label: t("Lager & Packhaus") },
              { value: "gebaeude", label: t("Gebäude & Infrastruktur") },
            ]} />
        </div>
      </section>

      {tab === "bewaesserung" ? <>
          {renderWeitere(otherIn(["irrigation"]), t("Bewässerung — automatische Position (€/ha, aktiv im Modell)"),
            t("Diese €/ha-Position fließt ins Modell, solange die Detailplanung unten inaktiv ist. Aktivierst du die Detailplanung, ersetzen die Einzelpositionen diesen Auto-Block (kein Doppelzählen)."))}
          <CapexPlanEditor blocks={["bewaesserung"]} />
        </>
        : tab === "lager" ? <>
          {renderWeitere(otherIn(["buildings"]), t("Lager / Packhaus — automatische Position (€/t, aktiv im Modell)"),
            t("Diese €/t-Position fließt ins Modell, solange die Detailplanung unten inaktiv ist. Aktivierst du die Detailplanung, ersetzen die Einzelpositionen diesen Auto-Block (kein Doppelzählen)."))}
          <CapexPlanEditor blocks={["lager", "packhaus"]} />
        </>
        : tab === "gebaeude" ? <CapexPlanEditor blocks={["gebaeude"]} />
        : <>
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        {/* Maschinen: Bedarf − Bestand = Neu — eigener Scroll-Container, damit der Kopf fixiert bleibt. */}
        <div className="px-2 py-2" style={{ maxHeight: "calc(100vh - 250px)", overflow: "auto" }}>
          <table className="w-full text-[12px]" style={{ minWidth: 1080 }}>
            <thead><tr>
              <th className={th + " text-left"}>{t("Maschine")}</th>
              <th className={th + " text-left"}>{t("Hersteller")}</th>
              <th className={th + " text-right"} style={{ color: "var(--nx-locate)" }}>{t("Bedarf (Park)")}</th>
              <th className={th + " text-right"} style={{ color: "var(--nx-brand-lift)" }}>{t("Bestand")}</th>
              <th className={th + " text-right"}>{t("Neu")}</th>
              <th className={th + " text-right"}>{t("Stückpreis (Liste)")}</th>
              <th className={th + " text-right"}>{t("Discount")}</th>
              <th className={th + " text-right"}>{t("Netto-Stück")}</th>
              <th className={th + " text-right"}>{t("Σ Investition")}</th>
            </tr></thead>
            <tbody>
              {cats.map((cat) => {
                const rows = mach.filter((d) => catOf(d.machineId) === cat);
                if (!rows.length) return null;
                const catSum = rows.reduce((a, d) => a + d.amount, 0);
                return (
                  <React.Fragment key={cat}>
                    <tr><td colSpan={9} className="px-2 pt-3 pb-1 caption text-[10px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t(cat)}</td></tr>
                    {rows.map((d) => {
                      const m = byId.get(d.machineId);
                      const neu = d.newUnits ?? 0;
                      const list = m ? machineUnitPriceCent(domain, m, scenarioId) : 0;
                      const disc = m?.discountPct ?? gDisc;
                      const netUnit = list * (1 - disc);
                      return (
                        <tr key={d.machineId} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                          <td className="px-2 py-1.5">{m?.productName ?? d.label}</td>
                          <td className="px-2 py-1.5 text-nx-text-muted">{m?.manufacturer ?? "—"}</td>
                          <td className="num px-2 py-1.5 text-right" style={{ color: "var(--nx-locate)" }}>{fmtNumber(d.count, 0)}</td>
                          <td className="num px-2 py-1.5 text-right" style={{ color: "var(--nx-brand-lift)" }}>{fmtNumber(d.ownedUnits ?? 0, 0)}</td>
                          <td className="num px-2 py-1.5 text-right font-semibold">{neu > 0 ? fmtNumber(neu, 0) : "–"}</td>
                          <td className="px-2 py-1.5 text-right">{m ? <NumberInput value={list} moneyCent width={100} onCommit={(nn) => updM(m.id, (mm) => { mm.priceCent = nn; })} /> : <span className="num text-[11px] text-nx-text-muted">–</span>}</td>
                          <td className="px-2 py-1.5 text-right">{m ? <NumberInput value={disc * 100} width={52} suffix="%" onCommit={(nn) => updM(m.id, (mm) => { mm.discountPct = Math.max(0, nn / 100); })} /> : <span className="num text-[11px] text-nx-text-muted">–</span>}</td>
                          <td className="num px-2 py-1.5 text-right text-nx-text-muted">{netUnit ? fmtMoney(netUnit) : "–"}</td>
                          <td className="num px-2 py-1.5 text-right font-semibold">{d.amount ? fmtMoney(d.amount) : "–"}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: "var(--nx-surface-sunken)" }}>
                      <td colSpan={8} className="px-2 py-1 text-right caption text-[10px] text-nx-text-muted">Σ {t(cat)}</td>
                      <td className="num px-2 py-1 text-right font-semibold">{catSum ? fmtMoney(catSum) : "–"}</td>
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--nx-border)" }}>
                <td colSpan={8} className="px-2 py-2.5 font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{t("Σ Maschinen-Investitionen")}</td>
                <td className="num px-2 py-2.5 text-right font-semibold">{fmtMoney(byClass("machinery"))} €</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* IoT/Sonstige lebt jetzt als Zeile im Jahres-Planer unten (Kategorie „IoT / Sonstige"). */}

      {/* Maschinen-Jahresplaner: diskrete Zukäufe in späteren Jahren (additiv zur Bedarf−Bestand-Rechnung) */}
      <CapexPlanEditor blocks={["maschinen"]} />

      {/* Bodenprobenahme — Make-or-Buy (CAPEX nur bei Eigen; Detailrechner unter CAPEX Szenarien) */}
      {domain.soilSampling && (() => {
        const s = computeSoilSampling(domain.soilSampling);
        const eigen = domain.soilSampling.mode === "eigen";
        const active = !!domain.soilSampling.active;
        return (
          <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)", opacity: active ? 1 : 0.6 }}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
              <h3 className="text-[13px] font-semibold flex items-center gap-2" style={{ color: "var(--nx-locate)" }}>
                {t("Bodenprobenahme —")} {eigen ? t("Eigen (UTV-Rig)") : t("Dienstleister")}
                <span className="caption text-[9.5px] font-bold rounded-pill px-1.5 py-0.5" style={{ color: active ? "var(--nx-brand-lift)" : "var(--nx-text-muted)", background: active ? "color-mix(in srgb, var(--nx-brand-lift) 16%, transparent)" : "var(--nx-surface-sunken)" }}>{active ? t("IM MODELL AKTIV") : t("NICHT AKTIV")}</span>
              </h3>
              <span className="caption text-[10.5px] text-nx-text-muted">{t("Aktiv schalten: CAPEX Szenarien → Bodenprobenahme")}</span>
            </div>
            <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)" }}>
              {[
                [t("CAPEX (Neuanschaffung)"), eigen ? fmtMoney(s.capexCent) + " €" : t("– (kein CAPEX)"), eigen ? "var(--nx-brand-lift)" : "var(--nx-text-muted)"],
                [eigen ? t("Rigs × Stückpreis") : t("Modus"), eigen ? `${fmtNumber(s.nRigs, 0)} × ${fmtMoney(s.pSoilRigCent)} €` : t("reine OPEX")],
                [t("OPEX / Jahr"), fmtMoney(eigen ? s.eigenJahrCent : s.dlJahrCent) + " €"],
                [t("Ersparnis Eigen vs. DL"), (s.ersparnisCent >= 0 ? "+" : "") + fmtMoney(s.ersparnisCent) + " €/J", "var(--nx-pos, #2E7D32)"],
              ].map(([k, v, c], i) => (
                <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
                  <div className="caption text-[10px] text-nx-text-muted">{k}</div>
                  <div className="num text-[13px] font-semibold" style={{ color: (c as string) ?? "var(--nx-text)" }}>{v}</div>
                </div>
              ))}
            </div>
            {/* Paket-Aufschlüsselung direkt im Investitionsplan (nicht nur im Rechner) */}
            {eigen && (
              <div className="border-t px-4 py-2" style={{ borderColor: "var(--nx-border)" }}>
                <div className="caption text-[10px] font-semibold uppercase tracking-wide text-nx-text-muted mb-1">{t("Paket je Rig —")} {fmtMoney(s.pSoilRigCent)} €</div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11.5px]">
                  {([
                    [t("Wintex 3000s Vollautomat"), domain.soilSampling.pSamplerCent],
                    ["Polaris Ranger Diesel (UTV)", domain.soilSampling.pUTVCent],
                    [t("IT-/Zubehör-Paket (Emlid RS3 · Tab Active4 · Zebra · Teltonika · Victron · Dometic)"), domain.soilSampling.pITCent],
                    [t("Montage + Ersatzteile + Erststock"), domain.soilSampling.pMiscCent],
                  ] as [string, number][]).map(([l, v]) => (
                    <span key={l} className="text-nx-text-secondary">{l} <b className="num" style={{ color: "var(--nx-text)" }}>{fmtMoney(v)} €</b></span>
                  ))}
                </div>
              </div>
            )}
            <div className="border-t px-4 py-2 text-[11px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
              {t("Additiver Block (nicht in")} <code>machHa</code> {t("enthalten). Bei „Eigen\"")} {fmtNumber(s.nRigs, 0)} {t("Rig(s) als Anlagenposition (Jahr 0), AfA über")} {domain.soilSampling.holdYears} {t("J; bei „Dienstleister\" nur laufende OPEX. Volle Aufschlüsselung & Parameter im Rechner (CAPEX Szenarien → Bodenprobenahme).")}
            </div>
          </section>
        );
      })()}

      </>}
    </div>
  );
}
