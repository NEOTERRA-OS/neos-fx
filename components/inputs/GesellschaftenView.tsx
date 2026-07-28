"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import type { Entity, EntityRole } from "../../core/types";
import { TextInput, NumberInput } from "./NumberInput";
import { lookupCui } from "../../lib/anaf";
import { KonsolidierungPanel } from "./KonsolidierungPanel";
import { t } from "../../lib/i18n";
import { Check, X } from "lucide-react";

const ROLE_LABEL: Record<EntityRole, string> = {
  opco: "OpCo · Betrieb",
  propco: "PropCo · Besitz",
  holding: "Holding · Mutter",
  service: "Service · Dienstl.",
  other: "Sonstige",
};
const ROLE_COLOR: Record<EntityRole, string> = {
  holding: "var(--nx-brand-lift)",
  opco: "var(--nx-locate)",
  propco: "var(--nx-warning)",
  service: "var(--nx-text-secondary)",
  other: "var(--nx-text-muted)",
};
const COUNTRY_LABEL: Record<string, string> = { RO: "Rumänien", CY: "Zypern", DE: "Deutschland", other: "Anderes" };

type LookupState = { loading?: boolean; ok?: boolean; msg?: string };

const selStyle: React.CSSProperties = {
  background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)", height: 34,
};

/** Gesellschaften-Register — Multi-Entity-/Konsolidierungs-Layer.
 *  Rechtsträger (Holding CY, OpCo/PropCo RO …) mit Rolle, Land, Beteiligung% und CUI.
 *  CUI-Lookup zieht Name/Sitz/USt-Status live aus der ANAF-Datenbank (kostenlos, kein Key).
 *  Die Anbauplanung bleibt GLOBAL — die Entitäten strukturieren Eigentum, Steuer & IC. */
export function GesellschaftenView() {
  const domain = useModelStore((s) => s.domain);
  const patch = useModelStore((s) => s.patch);
  const entities = domain.entities ?? [];
  const [lk, setLk] = React.useState<Record<string, LookupState>>({});

  const upd = (id: string, fn: (e: Entity) => void) =>
    patch((d) => { const e = (d.entities ?? []).find((x) => x.id === id); if (e) fn(e); });
  const remove = (id: string) => patch((d) => { d.entities = (d.entities ?? []).filter((x) => x.id !== id); });
  const add = () => patch((d) => {
    d.entities = d.entities ?? [];
    let n = 1; while (d.entities.some((e) => e.id === `ent-custom-${n}`)) n++;
    d.entities.push({ id: `ent-custom-${n}`, name: t("Neue Gesellschaft"), role: "opco", country: "RO", ownershipPct: 100 });
  });

  const runLookup = async (e: Entity) => {
    const digits = (e.cui ?? "").replace(/\D/g, "");
    if (!digits) { setLk((s) => ({ ...s, [e.id]: { ok: false, msg: t("CUI eingeben") } })); return; }
    setLk((s) => ({ ...s, [e.id]: { loading: true } }));
    const r = await lookupCui(digits);
    if (r.error) { setLk((s) => ({ ...s, [e.id]: { ok: false, msg: r.error } })); return; }
    if (!r.found) { setLk((s) => ({ ...s, [e.id]: { ok: false, msg: t("CUI nicht in ANAF gefunden") } })); return; }
    const today = new Date().toISOString().slice(0, 10);
    upd(e.id, (x) => {
      if (r.denumire) x.name = r.denumire;
      if (r.cui) x.cui = r.cui;
      x.address = r.adresa || x.address;
      x.regCom = r.nrRegCom || x.regCom;
      x.vatActive = !!r.scpTVA;
      x.country = "RO";
      x.anafCheckedAt = today;
    });
    setLk((s) => ({ ...s, [e.id]: { ok: true, msg: `${r.denumire || t("gefunden")}${r.scpTVA ? t(" · USt-pflichtig") : t(" · nicht USt-pflichtig")}` } }));
  };

  const byRole = (r: EntityRole) => entities.filter((e) => e.role === r).length;

  return (
    <div className="space-y-4">
      <div className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Gesellschaften-Register · Multi-Entity & Konsolidierung")}</h2>
          <span className="caption text-[10.5px] text-nx-text-muted">
            {entities.length} {t("Gesellschaften")} · {byRole("holding")} Holding · {byRole("opco")} OpCo · {byRole("propco")} PropCo
          </span>
        </div>
        <div className="px-4 py-2.5 text-[12px] text-nx-text-secondary">
          {t("Rechtsträger der Gruppe mit Rolle, Land und Beteiligung. Die")} <b>{t("Anbauplanung bleibt global")}</b> {t("— die Gesellschaften strukturieren Eigentum, Steuer und Intercompany-Verrechnung. Mit")} <b>{t("CUI-Lookup")}</b> {t("ziehst du Name, Sitz und USt-Status je RO-Gesellschaft live aus der")} <b>ANAF</b>{t("-Datenbank (kostenlos, ohne API-Key).")}
        </div>
      </div>

      {entities.map((e) => {
        const st = lk[e.id] ?? {};
        return (
          <section key={e.id} className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)", boxShadow: "var(--nx-el-card)" }}>
            {/* Kopfzeile: Rollen-Punkt · Name · Land · Rolle · entfernen */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--nx-border)" }}>
              <span aria-hidden style={{ width: 9, height: 9, borderRadius: 999, background: ROLE_COLOR[e.role], flex: "0 0 auto" }} />
              <TextInput value={e.name} width={300} onCommit={(v) => upd(e.id, (x) => { x.name = v; })} />
              <select className="rounded-control border px-2 text-[12.5px]" style={selStyle}
                value={e.country} onChange={(ev) => upd(e.id, (x) => { x.country = ev.target.value as Entity["country"]; })}>
                {Object.entries(COUNTRY_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
              </select>
              <select className="rounded-control border px-2 text-[12.5px]" style={selStyle}
                value={e.role} onChange={(ev) => upd(e.id, (x) => { x.role = ev.target.value as EntityRole; })}>
                {(Object.keys(ROLE_LABEL) as EntityRole[]).map((k) => <option key={k} value={k}>{t(ROLE_LABEL[k])}</option>)}
              </select>
              <div className="ml-auto flex items-center gap-3">
                <span className="caption text-[10.5px] text-nx-text-muted">{t("Beteiligung")}</span>
                <NumberInput value={e.ownershipPct} width={72} suffix="%" onCommit={(nv) => upd(e.id, (x) => { x.ownershipPct = Math.max(0, Math.min(100, nv)); })} />
                <button className="text-[12px] text-nx-error" title={t("Gesellschaft entfernen")} onClick={() => remove(e.id)}><X size={13} strokeWidth={2.5} aria-hidden /></button>
              </div>
            </div>

            {/* CUI + ANAF-Lookup */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5" style={{ borderBottom: (e.address || e.regCom || e.anafCheckedAt) ? "1px solid var(--nx-border-divider)" : "none" }}>
              <span className="caption text-[10.5px] text-nx-text-muted" style={{ width: 34 }}>CUI</span>
              <TextInput value={e.cui ?? ""} width={160} onCommit={(v) => upd(e.id, (x) => { x.cui = v; })} />
              <button
                className="rounded-control border px-3 text-[11.5px] font-semibold"
                style={{ height: 34, borderColor: "var(--nx-border)", background: "var(--nx-surface)", color: e.country === "RO" ? "var(--nx-text)" : "var(--nx-text-muted)", opacity: st.loading ? 0.6 : 1 }}
                disabled={st.loading || e.country !== "RO"}
                title={e.country === "RO" ? t("Firmendaten aus ANAF ziehen") : t("ANAF-Lookup nur für RO-Gesellschaften")}
                onClick={() => runLookup(e)}
              >
                {st.loading ? t("prüfe …") : t("ANAF prüfen")}
              </button>
              {e.vatActive != null && (
                <span className="rounded-control px-2 py-0.5 text-[10.5px] font-semibold"
                  style={{ background: e.vatActive ? "var(--nx-brand-tint)" : "var(--nx-surface-sunken)", color: e.vatActive ? "var(--nx-brand-lift)" : "var(--nx-text-muted)" }}>
                  {e.vatActive ? t("USt-pflichtig (TVA)") : t("keine USt")}
                </span>
              )}
              {st.msg && (
                <span className="inline-flex items-center gap-1 caption text-[10.5px]" style={{ color: st.ok ? "var(--nx-brand-lift)" : "var(--nx-error)" }}>
                  {st.ok ? <Check size={12} strokeWidth={2.5} aria-hidden /> : <X size={12} strokeWidth={2.5} aria-hidden />}{st.msg}
                </span>
              )}
            </div>

            {/* ANAF-Stammdaten (nach Lookup) */}
            {(e.address || e.regCom || e.anafCheckedAt) && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 text-[11.5px] text-nx-text-secondary">
                {e.address && <span><span className="text-nx-text-muted">{t("Sitz:")}</span> {e.address}</span>}
                {e.regCom && <span><span className="text-nx-text-muted">{t("Reg.-Com:")}</span> {e.regCom}</span>}
                {e.anafCheckedAt && <span className="caption text-[10px] text-nx-text-muted">{t("ANAF-Stand:")} {e.anafCheckedAt}</span>}
              </div>
            )}

            {/* Notiz */}
            <div className="flex items-center gap-2 px-4 py-2 border-t" style={{ borderColor: "var(--nx-border-divider)" }}>
              <span className="caption text-[10.5px] text-nx-text-muted" style={{ width: 34 }}>{t("Notiz")}</span>
              <TextInput value={e.note ?? ""} width={560} onCommit={(v) => upd(e.id, (x) => { x.note = v; })} />
            </div>
          </section>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-tile border px-4 py-3" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <button className="rounded-control border px-3 text-[12px] font-semibold"
          style={{ height: 34, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" }}
          onClick={add}>{t("+ Gesellschaft anlegen")}</button>
        <span className="caption text-[10.5px] text-nx-text-muted">
          {t("CUI-Lookup via ANAF · Konzern-Konsolidierung siehe unten (aktivierbar)")}
        </span>
      </div>

      {/* Konsolidierung — direkt ans Register gekoppelt (opt-in). */}
      <KonsolidierungPanel />
    </div>
  );
}
