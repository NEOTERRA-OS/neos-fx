"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { deriveAssumptionRegister, ASSUMPTION_CATEGORY, type AssumptionRow } from "../../store/model";
import type { AssumptionConfidence, AssumptionStatus } from "../../core/types";
import { fmtNumber } from "../../design/format";
import { TextInput } from "./NumberInput";
import { CommentsPanel, threadOf } from "./CommentsPanel";
import { t, getLang } from "../../lib/i18n";
import { MessageSquare } from "lucide-react";

/** Annahmen-Register — Team-Review-Blatt aller Modell-Treiber: Wert (je Szenario) editierbar,
 *  plus Quelle · Owner · Konfidenz · Status (Ampel) · Notiz und eine Änderungs-Historie
 *  (wer/wann/was). Bearbeiter-Name session-lokal → Audit-Attribution beim gemeinsamen Durchgehen. */

const STATUS_OPTS: { v: AssumptionStatus; label: string; color: string; bg: string }[] = [
  { v: "offen", label: "offen", color: "var(--nx-text-muted)", bg: "var(--nx-surface)" },
  { v: "pruefung", label: "in Prüfung", color: "var(--nx-locate)", bg: "color-mix(in srgb, var(--nx-locate) 14%, transparent)" },
  { v: "geprueft", label: "geprüft", color: "var(--nx-green)", bg: "color-mix(in srgb, var(--nx-green) 16%, transparent)" },
  { v: "strittig", label: "strittig", color: "var(--nx-warn, #C9A227)", bg: "color-mix(in srgb, var(--nx-warn, #C9A227) 16%, transparent)" },
];
const CONF_OPTS: { v: AssumptionConfidence; label: string; color: string }[] = [
  { v: "hoch", label: "hoch", color: "var(--nx-green)" },
  { v: "mittel", label: "mittel", color: "var(--nx-warn, #C9A227)" },
  { v: "niedrig", label: "niedrig", color: "var(--nx-error)" },
];
const statusCfg = (s?: AssumptionStatus) => STATUS_OPTS.find((o) => o.v === s) ?? STATUS_OPTS[0];
const confCfg = (c?: AssumptionConfidence) => CONF_OPTS.find((o) => o.v === c);

/** Domänen-Tabs — bündeln die ~30 Kategorien in wenige übersichtliche Bereiche. */
const DOMAIN_TABS: { id: string; label: string; cats: string[] }[] = [
  { id: "agronomie", label: "Agronomie", cats: ["Erträge", "Qualität", "Verluste", "Saatgut/Pflanzgut", "Düngerpreise", "Spritzstrategie", "Bewässerung"] },
  { id: "preise", label: "Preise & Markt", cats: ["Preise (Verkauf & Input)", "Markt", "Makro", "Inflation", "Erlöse"] },
  { id: "maschinen", label: "Maschinen & Technik", cats: ["Maschinenpreise", "Maschinen-TCO", "Einsatz & Schlagkraft", "CAPEX", "Transport", "Logistik"] },
  { id: "personal", label: "Personal", cats: ["Personal"] },
  { id: "finanzen", label: "Finanzen & Steuern", cats: ["Finanzierung", "Zinsen", "Working Capital", "Steuern", "Covenants", "Subventionen", "Lager", "Betriebskosten / SG&A", "Holding", "Bewertung & Leistung"] },
  { id: "betrieb", label: "Betrieb & Sonstige", cats: ["Betrieb", "Sonstige"] },
];
const CAT_TO_TAB = new Map<string, string>();
for (const tb of DOMAIN_TABS) for (const c of tb.cats) CAT_TO_TAB.set(c, tb.id);
const tabOf = (cat: string) => CAT_TO_TAB.get(cat) ?? "betrieb";

export function AnnahmenRegisterView() {
  const { domain, view, patch, editor, setEditor } = useModelStore();
  const sc = view.scenarioId;
  const scenLabel = sc === "sc-best" ? "Best" : sc === "sc-worst" ? "Worst" : "Base";
  const rows = deriveAssumptionRegister(domain, sc);
  const locale = getLang() === "en" ? "en-US" : "de-DE";
  const nowIso = () => new Date().toISOString();
  const shortDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(locale) : "—");

  const [tab, setTab] = React.useState<string>("agronomie");
  const [status, setStatus] = React.useState<string>("all");
  const [conf, setConf] = React.useState<string>("all");
  const [q, setQ] = React.useState("");
  const [reviewMode, setReviewMode] = React.useState(false);
  const [openHist, setOpenHist] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const toggleCat = (c: string) => setCollapsed((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const [cmt, setCmt] = React.useState<{ target: string; label: string; area?: string } | null>(null);

  // ---- Schreiben mit Audit-Eintrag (wer/wann/was).
  const logAndSet = (key: string, field: string, from: string, to: string, apply: (a: NonNullable<typeof domain.assumptions[string]>) => void) =>
    patch((d) => {
      const a = d.assumptions[key]; if (!a) return;
      apply(a);
      a.meta = a.meta ?? {};
      a.meta.updatedBy = editor; a.meta.updatedAt = nowIso();
      a.meta.history = a.meta.history ?? [];
      a.meta.history.push({ ts: nowIso(), by: editor, field, from: from || undefined, to: to || undefined });
      if (a.meta.history.length > 25) a.meta.history = a.meta.history.slice(-25);
    });
  const setMeta = (r: AssumptionRow, field: string, label: string, from: string, to: string) =>
    logAndSet(r.key, label, from, to, (a) => { a.meta = a.meta ?? {}; (a.meta as Record<string, unknown>)[field] = to || undefined; });

  // ---- Filter (Suche spannt über ALLE Tabs; sonst nur der aktive Bereich)
  const searching = q.trim().length > 0;
  let list = rows;
  if (searching) { const s = q.toLowerCase(); list = list.filter((r) => r.label.toLowerCase().includes(s) || r.key.toLowerCase().includes(s) || (r.meta.source ?? "").toLowerCase().includes(s) || (r.meta.owner ?? "").toLowerCase().includes(s) || (r.meta.note ?? "").toLowerCase().includes(s)); }
  else list = list.filter((r) => tabOf(r.category) === tab);
  if (status !== "all") list = list.filter((r) => (r.meta.status ?? "offen") === status);
  if (conf !== "all") list = list.filter((r) => r.meta.confidence === conf);
  if (reviewMode) list = list.filter((r) => { const st = r.meta.status ?? "offen"; return st === "offen" || st === "strittig" || r.meta.confidence === "niedrig"; });
  const tabCount = (id: string) => rows.filter((r) => tabOf(r.category) === id).length;
  const tabReviewed = (id: string) => rows.filter((r) => tabOf(r.category) === id && r.meta.status === "geprueft").length;

  // ---- Fortschritt
  const total = rows.length;
  const reviewed = rows.filter((r) => r.meta.status === "geprueft").length;
  const strittig = rows.filter((r) => r.meta.status === "strittig").length;
  const lowConf = rows.filter((r) => r.meta.confidence === "niedrig").length;
  const pct = total ? Math.round((reviewed / total) * 100) : 0;

  // ---- Gruppierung nach Kategorie
  const byCat = new Map<string, AssumptionRow[]>();
  for (const r of list) { if (!byCat.has(r.category)) byCat.set(r.category, []); byCat.get(r.category)!.push(r); }
  const th = "px-2 py-1.5 caption text-[10px] text-nx-text-muted";

  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <div>
            <h2 className="text-[14px] font-semibold">{t("Annahmen-Register")}</h2>
            <div className="text-[11px] text-nx-text-muted">{t("Team-Review aller Treiber: Quelle · Owner · Konfidenz · Status · Notiz mit Historie. Werte sind Referenz (schreibgeschützt) — Bearbeitung in der jeweiligen Fachansicht.")}</div>
          </div>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-nx-text-secondary">
            {t("Bearbeiter")}:
            <input value={editor} onChange={(e) => setEditor(e.target.value)}
              className="rounded-control border px-2 text-[12px] font-semibold" style={{ height: 30, width: 150, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)" }} />
          </label>
        </div>

        {/* Fortschritt */}
        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: "var(--nx-border-divider)" }}>
          {([[t("geprüft"), `${reviewed} / ${total}`, "var(--nx-green)"], [t("Fortschritt"), `${pct} %`, undefined], [t("strittig"), String(strittig), strittig ? "var(--nx-warn, #C9A227)" : undefined], [t("niedrige Konfidenz"), String(lowConf), lowConf ? "var(--nx-error)" : undefined]] as [string, string, string?][]).map(([k, v, c], i) => (
            <div key={i} className="px-4 py-2.5" style={{ background: "var(--nx-surface)" }}>
              <div className="caption text-[10px] text-nx-text-muted">{k}</div>
              <div className="num text-[15px] font-semibold" style={{ color: c ?? "var(--nx-text)" }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Domänen-Tabs */}
        <div className="flex flex-wrap gap-1 px-4 pt-3 border-t" style={{ borderColor: "var(--nx-border)" }}>
          {DOMAIN_TABS.map((tb) => {
            const on = !searching && tab === tb.id;
            const rev = tabReviewed(tb.id); const cnt = tabCount(tb.id);
            return (
              <button key={tb.id} onClick={() => { setQ(""); setTab(tb.id); }}
                className="inline-flex items-center gap-1.5 rounded-control border px-3 text-[12px] font-semibold"
                style={{ height: 34, borderColor: on ? "var(--nx-locate)" : "var(--nx-border)", background: on ? "color-mix(in srgb, var(--nx-locate) 12%, transparent)" : "var(--nx-surface)", color: on ? "var(--nx-locate)" : "var(--nx-text-secondary)" }}>
                {t(tb.label)}
                <span className="num text-[10px]" style={{ color: rev === cnt ? "var(--nx-green)" : "var(--nx-text-muted)" }}>{rev}/{cnt}</span>
              </button>
            );
          })}
          {searching && <span className="inline-flex items-center px-2 text-[11px] font-semibold" style={{ color: "var(--nx-locate)" }}>{t("Suche über alle Bereiche")}</span>}
        </div>

        {/* Filter */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-control border px-2 text-[12px]" style={sel}>
            <option value="all">{t("Alle Status")}</option>
            {STATUS_OPTS.map((o) => <option key={o.v} value={o.v}>{t(o.label)}</option>)}
          </select>
          <select value={conf} onChange={(e) => setConf(e.target.value)} className="rounded-control border px-2 text-[12px]" style={sel}>
            <option value="all">{t("Alle Konfidenz")}</option>
            {CONF_OPTS.map((o) => <option key={o.v} value={o.v}>{t("Konfidenz")}: {t(o.label)}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Suche: Treiber, Quelle, Owner …")} className="min-w-[160px] flex-1 rounded-control border px-2 text-[12.5px]" style={{ ...sel, width: undefined }} />
          <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: reviewMode ? "var(--nx-warn, #C9A227)" : "var(--nx-text-secondary)" }}>
            <input type="checkbox" checked={reviewMode} onChange={(e) => setReviewMode(e.target.checked)} />
            {t("Review-Modus (offen/strittig/niedrig)")}
          </label>
        </div>

        {/* Tabelle */}
        <div className="overflow-x-auto px-2 pb-2">
          <table className="w-full text-[12px]" style={{ minWidth: 1080 }}>
            <thead><tr>
              <th className={th + " text-left"}>{t("Treiber")}</th>
              <th className={th + " text-right"}>{scenLabel}</th>
              <th className={th + " text-left"}>{t("Einheit")}</th>
              <th className={th + " text-left"}>{t("Quelle")}</th>
              <th className={th + " text-left"}>{t("Owner")}</th>
              <th className={th + " text-center"}>{t("Konfidenz")}</th>
              <th className={th + " text-center"}>{t("Status")}</th>
              <th className={th + " text-left"}>{t("Notiz")}</th>
              <th className={th + " text-left"}>{t("zuletzt")}</th>
            </tr></thead>
            <tbody>
              {[...byCat.entries()].map(([c, rs]) => (
                <React.Fragment key={c}>
                  <tr>
                    <td colSpan={9} className="px-2 pt-3 pb-1">
                      <button className="inline-flex items-center gap-1.5 text-[11px] font-semibold hover:opacity-80" style={{ color: "var(--nx-brand-lift)" }} onClick={() => toggleCat(c)}>
                        <span style={{ width: 10, display: "inline-block" }}>{collapsed.has(c) ? "▸" : "▾"}</span>
                        {t(c)} <span className="text-nx-text-muted">· {rs.length}</span>
                      </button>
                    </td>
                  </tr>
                  {!collapsed.has(c) && rs.map((r) => {
                    const scfg = statusCfg(r.meta.status);
                    const ccfg = confCfg(r.meta.confidence);
                    const hist = r.meta.history ?? [];
                    return (
                      <React.Fragment key={r.key}>
                        <tr style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium">{r.label}</span>
                              {(() => { const th = threadOf(domain.comments, `assumption:${r.key}`); const n = th?.messages.length ?? 0;
                                return (
                                  <button className="inline-flex shrink-0 items-center gap-0.5 rounded-control border px-1 text-[10px] leading-none hover:opacity-80"
                                    style={{ height: 18, borderColor: n ? (th?.resolved ? "var(--nx-green)" : "var(--nx-locate)") : "var(--nx-border)", color: n ? (th?.resolved ? "var(--nx-green)" : "var(--nx-locate)") : "var(--nx-text-muted)", background: "var(--nx-app-bg)" }}
                                    title={t("Kommentare")} onClick={() => setCmt({ target: `assumption:${r.key}`, label: r.label, area: r.category })}>
                                    <MessageSquare size={11} strokeWidth={2.5} aria-hidden />{n ? <span className="num">{n}</span> : null}
                                  </button>
                                ); })()}
                            </div>
                            <div className="num text-[9.5px] text-nx-text-muted">{r.key}</div>
                          </td>
                          <td className="px-2 py-1.5 text-right num text-[12px] font-semibold" title={t("Wert wird in der Fachansicht gepflegt")}>
                            {r.value == null ? <span className="text-[11px] font-normal text-nx-text-muted">{t("abgeleitet")}</span>
                              : r.unit === "money" ? fmtNumber(r.value / 100, 2) + " €" : fmtNumber(r.value, 2)}
                          </td>
                          <td className="px-2 py-1.5 text-[11px] text-nx-text-muted">{r.unit}</td>
                          <td className="px-2 py-1.5"><TextInput value={r.meta.source ?? ""} width={150} onCommit={(v) => setMeta(r, "source", t("Quelle"), r.meta.source ?? "", v)} /></td>
                          <td className="px-2 py-1.5"><TextInput value={r.meta.owner ?? ""} width={110} onCommit={(v) => setMeta(r, "owner", t("Owner"), r.meta.owner ?? "", v)} /></td>
                          <td className="px-2 py-1.5 text-center">
                            <select value={r.meta.confidence ?? ""} onChange={(e) => setMeta(r, "confidence", t("Konfidenz"), r.meta.confidence ?? "", e.target.value)}
                              className="rounded-control border px-1 text-[11px] font-semibold" style={{ height: 28, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: ccfg?.color ?? "var(--nx-text-muted)" }}>
                              <option value="">—</option>
                              {CONF_OPTS.map((o) => <option key={o.v} value={o.v}>{t(o.label)}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <select value={r.meta.status ?? "offen"} onChange={(e) => setMeta(r, "status", t("Status"), t(statusCfg(r.meta.status).label), t(statusCfg(e.target.value as AssumptionStatus).label))}
                              className="rounded-control border px-1.5 text-[11px] font-semibold" style={{ height: 28, background: scfg.bg, borderColor: "var(--nx-border)", color: scfg.color }}>
                              {STATUS_OPTS.map((o) => <option key={o.v} value={o.v}>{t(o.label)}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5"><TextInput value={r.meta.note ?? ""} width={180} onCommit={(v) => setMeta(r, "note", t("Notiz"), r.meta.note ?? "", v)} /></td>
                          <td className="px-2 py-1.5 text-[10.5px] text-nx-text-muted">
                            {r.meta.updatedBy ? <>{r.meta.updatedBy}<div className="text-[9.5px]">{shortDate(r.meta.updatedAt)}</div></> : "—"}
                            {hist.length > 0 && <button className="ml-1 text-[10px] text-nx-locate hover:opacity-70" onClick={() => setOpenHist(openHist === r.key ? null : r.key)} title={t("Historie")}>⧉ {hist.length}</button>}
                          </td>
                        </tr>
                        {openHist === r.key && hist.length > 0 && (
                          <tr style={{ background: "var(--nx-app-bg)" }}>
                            <td colSpan={9} className="px-4 py-2">
                              <div className="text-[10.5px] font-semibold text-nx-text-secondary">{t("Änderungshistorie")}</div>
                              <div className="mt-1 space-y-0.5">
                                {[...hist].reverse().map((h, i) => (
                                  <div key={i} className="text-[10.5px] text-nx-text-muted">
                                    <span className="num">{new Date(h.ts).toLocaleString(locale)}</span> · <b className="text-nx-text-secondary">{h.by}</b> · {h.field}: <span style={{ color: "var(--nx-text-muted)" }}>{h.from || "—"}</span> → <span style={{ color: "var(--nx-locate)" }}>{h.to || "—"}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              ))}
              {list.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-[12px] text-nx-text-muted">{t("Keine Treiber für diesen Filter.")}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="border-t px-4 py-2 text-[10.5px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
          {t("Werte (schreibgeschützt) je aktivem Szenario — Bearbeitung in der jeweiligen Fachansicht. Review-Angaben liegen im gemeinsamen Cloud-Stand und werden protokolliert.")}
        </div>
      </section>
      {cmt && <CommentsPanel target={cmt.target} targetLabel={cmt.label} area={cmt.area} onClose={() => setCmt(null)} />}
    </div>
  );
}

const sel: React.CSSProperties = { height: 30, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" };
