"use client";
import React from "react";
import {type CatalogProduct, PRODUCT_CATEGORY_LABEL, PSM_TYPE_LABEL, suggestProducts, categoriesForOp} from "../../store/productCatalog";
import { t } from "../../lib/i18n";
import { Check, X } from "lucide-react";

/** Produkt-Auswahl-Overlay: schlägt je Maßnahme passende Produkte aus dem Katalog vor
 *  (RO-zugelassen zuerst) und übernimmt die Auswahl in die Betriebsmittel-Zeile. */
export function ProductPicker({
  open, onClose, products, cropId, cropName, opCode, label, currentId, onPick,
}: {
  open: boolean; onClose: () => void; products: CatalogProduct[];
  cropId: string; cropName?: string; opCode?: string; label?: string;
  currentId?: string; onPick: (p: CatalogProduct) => void;
}) {
  const [q, setQ] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);
  React.useEffect(() => { if (open) { setQ(""); setShowAll(false); } }, [open, label]);
  if (!open) return null;

  const cats = categoriesForOp(opCode);
  const matches = suggestProducts(products, { cropId, opCode, label, limit: 40 });
  const cropOK = (p: CatalogProduct) => p.crops.includes(cropId) || p.crops.includes("*");
  const all = products.filter((p) => cats.includes(p.category) && cropOK(p));
  let list = showAll ? all : matches;
  if (q.trim()) {
    const s = q.toLowerCase();
    list = (showAll ? all : products.filter((p) => cats.includes(p.category)))
      .filter((p) => p.name.toLowerCase().includes(s) || p.manufacturer.toLowerCase().includes(s)
        || (p.activeIngredients ?? []).some((a) => a.name.toLowerCase().includes(s))
        || (p.targets ?? []).some((tg) => tg.toLowerCase().includes(s)));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.55)" }} onClick={onClose}>
      <div className="flex max-h-[86vh] w-full max-w-[720px] flex-col rounded-tile border"
        style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--nx-border)" }}>
          <div>
            <h3 className="text-[14px] font-semibold">{t("Produkt vorschlagen")}</h3>
            <div className="text-[11px] text-nx-text-muted">
              {cropName ?? cropId}{label ? ` · ${label}` : ""}{cats.length ? ` · ${cats.map((c) => t(PRODUCT_CATEGORY_LABEL[c])).join(" / ")}` : ""}
            </div>
          </div>
          <button className="rounded-control border px-2 py-1 text-[13px]" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }} onClick={onClose}><X size={14} strokeWidth={2.5} aria-hidden /></button>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Suche: Produkt, Hersteller, Wirkstoff …")}
            className="min-w-0 flex-1 rounded-control border px-2 text-[12.5px]" style={{ height: 34, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />
          <label className="inline-flex items-center gap-1.5 text-[11px] text-nx-text-secondary">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            {t("alle passenden anzeigen")}
          </label>
        </div>

        {/* List */}
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {list.length === 0 && <div className="px-2 py-6 text-center text-[12px] text-nx-text-muted">{t("Keine passenden Produkte gefunden.")}</div>}
          <div className="space-y-1.5">
            {list.map((p) => <ProductRow key={p.id} p={p} active={p.id === currentId} onPick={() => { onPick(p); onClose(); }} />)}
          </div>
        </div>

        {/* Footer disclaimer */}
        <div className="border-t px-4 py-2 text-[10.5px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Entscheidungshilfe — vor Einsatz Zulassung & Auflagen im RO-Register prüfen (PSM/Beizung: MADR/PMDR; Sorten: ISTIS).")}
        </div>
      </div>
    </div>
  );
}

function RoBadge({ ro }: { ro: CatalogProduct["roAuthorized"] }) {
  const cfg = ro === "yes" ? { bg: "var(--nx-green)", c: "#fff", tx: <span className="inline-flex items-center gap-0.5">RO <Check size={10} strokeWidth={3} aria-hidden /></span> }
    : ro === "no" ? { bg: "var(--nx-error)", c: "#fff", tx: t("nicht zugel.") as React.ReactNode }
    : { bg: "var(--nx-border)", c: "var(--nx-text-secondary)", tx: "RO ?" as React.ReactNode };
  return <span className="rounded-control px-1.5 py-0.5 text-[9.5px] font-semibold" style={{ background: cfg.bg, color: cfg.c }}>{cfg.tx}</span>;
}

function ProductRow({ p, active, onPick }: { p: CatalogProduct; active: boolean; onPick: () => void }) {
  const nut = p.nutrients ? Object.entries(p.nutrients).map(([k, v]) => `${k} ${v}`).join(" · ") : "";
  const ws = (p.activeIngredients ?? []).map((a) => `${a.name} ${a.content}`).join(" + ");
  const rate = p.rateMin != null ? `${p.rateMin}${p.rateMax != null && p.rateMax !== p.rateMin ? `–${p.rateMax}` : ""} ${p.rateUnit ?? ""}` : "";
  const banned = p.roAuthorized === "no";
  return (
    <div className="rounded-tile border px-3 py-2" style={{ borderColor: active ? "var(--nx-locate)" : "var(--nx-border)", background: active ? "color-mix(in srgb, var(--nx-locate) 10%, transparent)" : "var(--nx-app-bg)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-semibold" style={{ color: banned ? "var(--nx-error)" : "var(--nx-text)" }}>{p.name}</span>
            <RoBadge ro={p.roAuthorized} />
            <span className="rounded-control border px-1.5 py-0.5 text-[9.5px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
              {p.psmType ? t(PSM_TYPE_LABEL[p.psmType]) : t(PRODUCT_CATEGORY_LABEL[p.category])}
            </span>
            {p.authNumber && <span className="text-[9.5px] text-nx-text-muted">Nr. {p.authNumber}</span>}
          </div>
          <div className="mt-0.5 text-[11px] text-nx-text-secondary">{p.manufacturer}{ws ? ` · ${ws}` : ""}{nut ? ` · ${nut}` : ""}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-nx-text-muted">
            {rate && <span>{t("Aufwand")}: <b className="text-nx-text-secondary">{rate}</b></span>}
            {p.phiDays != null && <span>{t("Wartezeit")}: {p.phiDays} {t("Tage")}</span>}
            {(p.bbchFrom != null || p.bbchTo != null) && <span>BBCH {p.bbchFrom ?? ""}{p.bbchTo != null ? `–${p.bbchTo}` : ""}</span>}
            {(p.targets ?? []).slice(0, 4).map((tg, i) => <span key={i} className="rounded-control px-1.5" style={{ background: "var(--nx-surface)" }}>{tg}</span>)}
          </div>
          {p.note && <div className="mt-1 text-[10.5px]" style={{ color: banned ? "var(--nx-error)" : "var(--nx-text-muted)" }}>{p.note}</div>}
        </div>
        <button className="shrink-0 rounded-control px-3 py-1.5 text-[12px] font-semibold" style={{ background: "var(--nx-locate)", color: "#fff" }} onClick={onPick}>
          {active ? t("gewählt") : t("übernehmen")}
        </button>
      </div>
    </div>
  );
}
