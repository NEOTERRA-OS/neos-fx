"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { getProductCatalog, CROP_NAME, VALUE_CROP_IDS } from "../../store/model";
import {
  DEFAULT_PRODUCTS, exportProductCatalog, PRODUCT_CATEGORY_LABEL, PSM_TYPE_LABEL,
  type CatalogProduct, type ProductCategory, type RoAuth,
} from "../../store/productCatalog";
import { t } from "../../lib/i18n";
import { TriangleAlert, Trash2, Check, X, HelpCircle } from "lucide-react";

const CATS: ProductCategory[] = ["fertilizer", "foliar", "biostimulant", "psm", "seed_treatment", "seed_variety"];
const RO_OPTS: { v: RoAuth; label: string }[] = [
  { v: "yes", label: "RO ✓" }, { v: "unknown", label: "RO ?" }, { v: "no", label: t("nicht zugel.") },
];

/** Produktkatalog — Pflege-/Admin-Panel: durchsuchen, filtern, editieren, hinzufügen, löschen.
 *  Sync-ready (id/source/updatedAt) für den Abgleich mit der NEOS Web App (Export JSON). */
export function ProduktkatalogView() {
  const { domain, patch } = useModelStore();
  // Produkte, die AUSSCHLIESSLICH Kulturen bedienen, die der Betrieb nicht mehr anbaut
  //  (Getreide-/Raps-Sorten, Beizungen dafür), werden nicht angezeigt. Sie bleiben als
  //  Stammdaten im Katalog erhalten und tauchen wieder auf, sobald eine solche Kultur
  //  in den Anbauplan zurückkehrt.
  const products = React.useMemo(
    () => getProductCatalog(domain).filter((p) => p.crops.includes("*") || p.crops.some((c) => VALUE_CROP_IDS.includes(c))),
    [domain],
  );
  const [cat, setCat] = React.useState<ProductCategory | "all">("all");
  const [cropF, setCropF] = React.useState<string>("all");
  const [q, setQ] = React.useState("");
  const [editId, setEditId] = React.useState<string | null>(null);

  // Nur Wertkulturen anbieten/anzeigen — die Produkte selbst bleiben als Stammdaten vollständig,
  //  auch wenn sie in ihren Kulturlisten noch Ackerbau-Kulturen führen.
  const cropIds = [...new Set(products.flatMap((p) => p.crops).filter((c) => c !== "*" && VALUE_CROP_IDS.includes(c)))].sort();
  const zeigeCrops = (cs: string[]) => cs.filter((c) => VALUE_CROP_IDS.includes(c));

  const patchCatalog = (fn: (list: CatalogProduct[]) => void) => patch((d) => {
    if (!d.productCatalog || !d.productCatalog.length) d.productCatalog = JSON.parse(JSON.stringify(DEFAULT_PRODUCTS));
    fn(d.productCatalog!);
  });
  const upd = (id: string, k: keyof CatalogProduct, v: unknown) => patchCatalog((list) => {
    const p = list.find((x) => x.id === id); if (p) { (p as Record<string, unknown>)[k] = v; p.updatedAt = new Date().toISOString().slice(0, 10); p.source = p.source === "neosfx" ? "neosfx" : "user"; }
  });
  const del = (id: string) => patchCatalog((list) => { const i = list.findIndex((x) => x.id === id); if (i >= 0) list.splice(i, 1); });
  const add = () => {
    const id = `user-${Date.now()}`;
    patchCatalog((list) => list.unshift({ id, source: "user", category: cat === "all" ? "psm" : cat, name: t("Neues Produkt"), manufacturer: "", crops: cropF === "all" ? ["*"] : [cropF], roAuthorized: "unknown", updatedAt: new Date().toISOString().slice(0, 10) }));
    setEditId(id);
  };
  const exportJson = () => {
    const blob = new Blob([exportProductCatalog(products)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "neosfx-produktkatalog.json"; a.click();
    URL.revokeObjectURL(url);
  };
  const resetSeed = () => patch((d) => { d.productCatalog = JSON.parse(JSON.stringify(DEFAULT_PRODUCTS)); });

  let list = products;
  if (cat !== "all") list = list.filter((p) => p.category === cat);
  if (cropF !== "all") list = list.filter((p) => p.crops.includes(cropF) || p.crops.includes("*"));
  if (q.trim()) { const s = q.toLowerCase(); list = list.filter((p) => p.name.toLowerCase().includes(s) || p.manufacturer.toLowerCase().includes(s) || (p.activeIngredients ?? []).some((a) => a.name.toLowerCase().includes(s)) || (p.targets ?? []).some((tg) => tg.toLowerCase().includes(s))); }

  const counts = CATS.map((c) => [c, products.filter((p) => p.category === c).length] as const);
  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";

  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <div>
            <h2 className="text-[14px] font-semibold">{t("Produktkatalog")}</h2>
            <div className="text-[11px] text-nx-text-muted">{t("Entscheidungshilfe je Maßnahme (Dünger, PSM, Blattdünger, Beizung, Sorten) — pflegbar & sync-ready für die NEOS Web App.")}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="num text-[12px] font-semibold">{products.length} {t("Produkte")}</span>
            <button className="rounded-control border px-2.5 py-1 text-[12px] font-semibold" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }} onClick={exportJson}>{t("Export JSON")}</button>
            <button className="rounded-control px-2.5 py-1 text-[12px] font-semibold" style={{ background: "var(--nx-locate)", color: "#fff" }} onClick={add}>{t("+ Produkt")}</button>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-tile border px-3 py-2 text-[11px]" style={{ borderColor: "var(--nx-warn, #C9A227)", background: "color-mix(in srgb, var(--nx-warn, #C9A227) 12%, transparent)" }}>
          <span className="shrink-0 font-semibold" style={{ color: "var(--nx-warn, #C9A227)" }}><TriangleAlert size={13} strokeWidth={2.5} aria-hidden /></span>
          <span className="text-nx-text-secondary">{t("Zulassungen ändern sich. Vor Einsatz jedes Produkt gegen das aktuelle rumänische Register prüfen — PSM/Beizung: MADR/PMDR (produse omologate); Sorten: ISTIS Catalog oficial. Als verboten/ausgelaufen markierte Produkte (rot) nicht einsetzen.")}</span>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <div className="flex flex-wrap gap-1">
            <FilterChip on={cat === "all"} onClick={() => setCat("all")}>{t("Alle")} · {products.length}</FilterChip>
            {counts.map(([c, n]) => <FilterChip key={c} on={cat === c} onClick={() => setCat(c)}>{t(PRODUCT_CATEGORY_LABEL[c])} · {n}</FilterChip>)}
          </div>
          <select value={cropF} onChange={(e) => setCropF(e.target.value)} className="rounded-control border px-2 text-[12px]" style={{ height: 30, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }}>
            <option value="all">{t("Alle Kulturen")}</option>
            {cropIds.map((c) => <option key={c} value={c}>{(CROP_NAME as Record<string, string>)[c] ?? c}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Suche …")} className="min-w-[160px] flex-1 rounded-control border px-2 text-[12.5px]" style={{ height: 30, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />
        </div>

        {/* Table */}
        <div className="overflow-x-auto px-2 pb-2">
          <table className="w-full text-[12px]" style={{ minWidth: 860 }}>
            <thead><tr>
              <th className={th + " text-left"}>{t("Produkt")}</th>
              <th className={th + " text-left"}>{t("Hersteller")}</th>
              <th className={th + " text-left"}>{t("Typ")}</th>
              <th className={th + " text-left"}>{t("Wirkstoff / Nährstoffe")}</th>
              <th className={th + " text-left"}>{t("Kulturen")}</th>
              <th className={th + " text-center"}>RO</th>
              <th className={th + " text-right"}>{t("Aufwand")}</th>
              <th className={th}></th>
            </tr></thead>
            <tbody>
              {list.map((p) => (
                <React.Fragment key={p.id}>
                  <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                    <td className="px-2 py-1.5 font-semibold" style={{ color: p.roAuthorized === "no" ? "var(--nx-error)" : "var(--nx-text)" }}>{p.name}</td>
                    <td className="px-2 py-1.5 text-nx-text-secondary">{p.manufacturer}</td>
                    <td className="px-2 py-1.5 text-nx-text-muted">{p.psmType ? t(PSM_TYPE_LABEL[p.psmType]) : t(PRODUCT_CATEGORY_LABEL[p.category])}</td>
                    <td className="px-2 py-1.5 text-nx-text-muted" style={{ maxWidth: 220 }}>
                      <div className="truncate" title={ingredientText(p)}>{ingredientText(p)}</div>
                    </td>
                    <td className="px-2 py-1.5 text-nx-text-muted">{p.crops.includes("*") ? t("alle") : (zeigeCrops(p.crops).map((c) => (CROP_NAME as Record<string, string>)[c] ?? c).join(", ") || "—")}</td>
                    <td className="px-2 py-1.5 text-center"><RoDot ro={p.roAuthorized} /></td>
                    <td className="num px-2 py-1.5 text-right text-nx-text-muted">{p.rateMin != null ? `${p.rateMin}${p.rateMax != null && p.rateMax !== p.rateMin ? "–" + p.rateMax : ""} ${p.rateUnit ?? ""}` : "–"}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <button className="text-[12px] text-nx-locate hover:opacity-70" title={t("Bearbeiten")} onClick={() => setEditId(editId === p.id ? null : p.id)}>✎</button>
                      <button className="ml-2 text-[12px] text-nx-error hover:opacity-70" title={t("Löschen")} onClick={() => del(p.id)}><Trash2 size={13} strokeWidth={2.5} aria-hidden /></button>
                    </td>
                  </tr>
                  {editId === p.id && (
                    <tr style={{ background: "var(--nx-app-bg)" }}>
                      <td colSpan={8} className="px-3 py-3">
                        <Editor p={p} upd={upd} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {list.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-[12px] text-nx-text-muted">{t("Keine Produkte für diesen Filter.")}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t px-4 py-2 text-[10.5px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          <span>{t("Quelle: Herstellerlabel & RO-Register-Recherche (2026-07). Änderungen werden im Modell gespeichert.")}</span>
          <button className="text-nx-text-muted underline hover:opacity-70" onClick={resetSeed} title={t("Auf recherchierten Seed-Katalog zurücksetzen")}>{t("Katalog zurücksetzen")}</button>
        </div>
      </section>
    </div>
  );
}

function ingredientText(p: CatalogProduct): string {
  if (p.activeIngredients?.length) return p.activeIngredients.map((a) => `${a.name} ${a.content}`).join(" + ");
  if (p.nutrients) return Object.entries(p.nutrients).map(([k, v]) => `${k} ${v}`).join(" · ");
  return "—";
}

function RoDot({ ro }: { ro: RoAuth }) {
  const c = ro === "yes" ? "var(--nx-green)" : ro === "no" ? "var(--nx-error)" : "var(--nx-border)";
  const tx = ro === "yes" ? <Check size={12} strokeWidth={3} aria-hidden /> : ro === "no" ? <X size={12} strokeWidth={3} aria-hidden /> : <HelpCircle size={12} strokeWidth={2.5} aria-hidden />;
  return <span className="inline-grid place-items-center rounded-control text-[10px] font-bold" style={{ width: 20, height: 18, background: c, color: ro === "unknown" ? "var(--nx-text-secondary)" : "#fff" }}>{tx}</span>;
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-control border px-2 text-[11px] font-semibold" style={{ height: 30, borderColor: on ? "var(--nx-locate)" : "var(--nx-border)", background: on ? "color-mix(in srgb, var(--nx-locate) 12%, transparent)" : "var(--nx-surface)", color: on ? "var(--nx-locate)" : "var(--nx-text-secondary)" }}>{children}</button>
  );
}

/** Inline-Editor für die wichtigsten Felder. */
function Editor({ p, upd }: { p: CatalogProduct; upd: (id: string, k: keyof CatalogProduct, v: unknown) => void }) {
  const F = ({ label, k, w = 160 }: { label: string; k: keyof CatalogProduct; w?: number }) => (
    <label className="flex flex-col gap-0.5">
      <span className="caption text-[9.5px] text-nx-text-muted">{label}</span>
      <TextField value={(p[k] as string) ?? ""} onCommit={(v) => upd(p.id, k, v)} width={w} />
    </label>
  );
  const Num = ({ label, k }: { label: string; k: keyof CatalogProduct }) => (
    <label className="flex flex-col gap-0.5">
      <span className="caption text-[9.5px] text-nx-text-muted">{label}</span>
      <TextField value={p[k] == null ? "" : String(p[k])} onCommit={(v) => upd(p.id, k, v === "" ? null : Number(v.replace(",", ".")))} width={70} />
    </label>
  );
  return (
    <div className="flex flex-wrap items-end gap-3">
      <F label={t("Produkt")} k="name" w={200} />
      <F label={t("Hersteller")} k="manufacturer" w={160} />
      <label className="flex flex-col gap-0.5">
        <span className="caption text-[9.5px] text-nx-text-muted">RO</span>
        <select value={p.roAuthorized} onChange={(e) => upd(p.id, "roAuthorized", e.target.value)} className="rounded-control border px-2 text-[12.5px]" style={{ height: 34, background: "var(--nx-surface)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }}>
          {RO_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
      </label>
      <Num label={t("Aufwand min")} k="rateMin" />
      <Num label={t("Aufwand max")} k="rateMax" />
      <F label={t("Einheit")} k="rateUnit" w={80} />
      <Num label="PHI (Tage)" k="phiDays" />
      <F label={t("Zulassungsnr.")} k="authNumber" w={130} />
      <label className="flex flex-1 flex-col gap-0.5" style={{ minWidth: 240 }}>
        <span className="caption text-[9.5px] text-nx-text-muted">{t("Kulturen (Komma, * = alle)")}</span>
        <TextField value={p.crops.join(", ")} onCommit={(v) => upd(p.id, "crops", v.split(",").map((s) => s.trim()).filter(Boolean))} width={0} full />
      </label>
      <label className="flex flex-1 flex-col gap-0.5" style={{ minWidth: 240 }}>
        <span className="caption text-[9.5px] text-nx-text-muted">{t("Indikationen / Ziele (Komma)")}</span>
        <TextField value={(p.targets ?? []).join(", ")} onCommit={(v) => upd(p.id, "targets", v.split(",").map((s) => s.trim()).filter(Boolean))} width={0} full />
      </label>
      <label className="flex w-full flex-col gap-0.5">
        <span className="caption text-[9.5px] text-nx-text-muted">{t("Hinweis")}</span>
        <TextField value={p.note ?? ""} onCommit={(v) => upd(p.id, "note", v)} width={0} full />
      </label>
    </div>
  );
}

function TextField({ value, onCommit, width = 160, full }: { value: string; onCommit: (v: string) => void; width?: number; full?: boolean }) {
  const [t2, setT2] = React.useState(value);
  React.useEffect(() => setT2(value), [value]);
  return (
    <input value={t2} onChange={(e) => setT2(e.target.value)} onBlur={() => onCommit(t2)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="rounded-control border px-2 text-[12.5px]" style={{ height: 34, width: full ? "100%" : width, background: "var(--nx-surface)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />
  );
}
