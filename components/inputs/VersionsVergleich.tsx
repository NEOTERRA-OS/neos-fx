"use client";
import React from "react";
import { useModelStore, computeHeadline, type HeadlineKpis } from "../../store/modelStore";
import { diffDomains, type DiffGroup, type Domain } from "../../store/model";
import { fmtMoney, fmtPct, fmtFactor } from "../../design/format";
import { t } from "../../lib/i18n";

type Src = { kind: "current" } | { kind: "snap"; id: string; label: string } | { kind: "json"; label: string; domain: Domain };

/** Versions-Vergleich — zwei Stände (Snapshot ↔ Snapshot / ↔ aktuell / ↔ JSON) gegenüberstellen:
 *  feldgenaue Änderungen „alt → neu" nach Bereich + KPI-Delta (EBITDA/DSCR …). */
export function VersionsVergleich({ snapshots, loadSnapshotDomain }: {
  snapshots: { id: string; label: string }[];
  loadSnapshotDomain: (id: string) => Promise<Domain>;
}) {
  const domain = useModelStore((s) => s.domain);
  const sc = useModelStore((s) => s.view.scenarioId);
  const currency = useModelStore((s) => s.view.currency);
  const [aSel, setASel] = React.useState("current");
  const [bSel, setBSel] = React.useState(snapshots[0] ? `snap:${snapshots[0].id}` : "current");
  const [jsonA, setJsonA] = React.useState<Domain | null>(null);
  const [jsonB, setJsonB] = React.useState<Domain | null>(null);
  const [result, setResult] = React.useState<{ groups: DiffGroup[]; ka: HeadlineKpis; kb: HeadlineKpis } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [openGroups, setOpenGroups] = React.useState<Set<string>>(new Set());

  const resolve = async (sel: string, json: Domain | null): Promise<Domain> => {
    if (sel === "current") return domain;
    if (sel === "json") { if (!json) throw new Error(t("Bitte JSON-Datei laden.")); return json; }
    if (sel.startsWith("snap:")) return await loadSnapshotDomain(sel.slice(5));
    return domain;
  };
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const A = await resolve(aSel, jsonA), B = await resolve(bSel, jsonB);
      setResult({ groups: diffDomains(A, B), ka: computeHeadline(A, sc), kb: computeHeadline(B, sc) });
      setOpenGroups(new Set());
    } catch (e) { setErr((e as Error)?.message ?? String(e)); setResult(null); }
    finally { setBusy(false); }
  };
  const onFile = (setJson: (d: Domain) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { const j = JSON.parse(String(r.result)); setJson((j.domain ?? j) as Domain); setErr(null); } catch { setErr(t("JSON konnte nicht gelesen werden.")); } };
    r.readAsText(f);
  };

  const totalChanges = result ? result.groups.reduce((s, g) => s + g.changes.length, 0) : 0;
  const kpiRows = result ? kpiDeltaRows(result.ka, result.kb, currency) : [];

  const Picker = ({ sel, setSel, json, setJson, label }: { sel: string; setSel: (v: string) => void; json: Domain | null; setJson: (d: Domain) => void; label: string }) => (
    <div className="flex flex-1 items-center gap-2">
      <span className="w-[74px] text-[11px] font-semibold text-nx-text-secondary">{label}</span>
      <select value={sel} onChange={(e) => setSel(e.target.value)} className="min-w-0 flex-1 rounded-control border px-2 text-[12px]" style={ctrl}>
        <option value="current">{t("Aktueller Stand")}</option>
        {snapshots.map((s) => <option key={s.id} value={`snap:${s.id}`}>{s.label}</option>)}
        <option value="json">{t("JSON-Datei …")}</option>
      </select>
      {sel === "json" && <><input type="file" accept="application/json,.json" onChange={onFile(setJson)} className="text-[11px]" style={{ maxWidth: 150 }} />{json && <span className="text-[10px]" style={{ color: "var(--nx-green)" }}>✓</span>}</>}
    </div>
  );

  return (
    <section className="rounded-tile border lg:col-span-2" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
        <div>
          <h3 className="text-[13px] font-semibold">{t("Versions-Vergleich")}</h3>
          <div className="text-[11px] text-nx-text-muted">{t("Zwei Stände gegenüberstellen: was hat sich geändert (alt → neu) und was macht es mit den KPIs.")}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Picker sel={aSel} setSel={setASel} json={jsonA} setJson={setJsonA} label={t("Version A")} />
        <span className="text-[12px] text-nx-text-muted">→</span>
        <Picker sel={bSel} setSel={setBSel} json={jsonB} setJson={setJsonB} label={t("Version B")} />
        <button onClick={run} disabled={busy} className="rounded-control px-3 text-[13px] font-bold disabled:opacity-50" style={{ height: 34, background: "var(--nx-locate)", color: "#fff" }}>{busy ? t("…") : t("Vergleichen")}</button>
      </div>
      {err && <div className="mx-4 mb-2 rounded-control border px-3 py-2 text-[11.5px]" style={{ borderColor: "var(--nx-error)", color: "var(--nx-error)" }}>{err}</div>}

      {result && (
        <>
          {/* KPI-Delta */}
          <div className="grid grid-cols-2 gap-px border-t sm:grid-cols-3 lg:grid-cols-6" style={{ background: "var(--nx-border-divider)", borderColor: "var(--nx-border)" }}>
            {kpiRows.map((r) => (
              <div key={r.label} className="px-3 py-2.5" style={{ background: "var(--nx-surface)" }}>
                <div className="caption text-[9.5px] text-nx-text-muted">{r.label}</div>
                <div className="num text-[12.5px] font-semibold">{r.a} → {r.b}</div>
                <div className="num text-[11px] font-semibold" style={{ color: r.dir > 0 ? "var(--nx-green)" : r.dir < 0 ? "var(--nx-error)" : "var(--nx-text-muted)" }}>{r.delta}</div>
              </div>
            ))}
          </div>

          {/* Änderungsliste */}
          <div className="border-t px-4 py-2 text-[11px] font-semibold" style={{ borderColor: "var(--nx-border)" }}>
            {totalChanges === 0 ? <span style={{ color: "var(--nx-green)" }}>{t("Keine Unterschiede in den erfassten Treibern.")}</span> : <span>{totalChanges} {t("Änderung(en)")}</span>}
          </div>
          <div className="px-2 pb-3">
            {result.groups.map((g) => {
              const open = openGroups.has(g.area);
              return (
                <div key={g.area} className="border-t" style={{ borderColor: "var(--nx-border-divider)" }}>
                  <button className="flex w-full items-center justify-between px-2 py-2 text-left" onClick={() => setOpenGroups((s) => { const n = new Set(s); n.has(g.area) ? n.delete(g.area) : n.add(g.area); return n; })}>
                    <span className="text-[12px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{open ? "▾" : "▸"} {t(g.area)}</span>
                    <span className="num text-[11px] text-nx-text-muted">{g.changes.length}</span>
                  </button>
                  {open && (
                    <div className="pb-2">
                      {g.changes.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1 text-[11.5px]" style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                          <span className="min-w-0 flex-1 truncate text-nx-text-secondary" title={c.label}>{c.label}</span>
                          <span className="num shrink-0 text-nx-text-muted">{c.from}</span>
                          <span className="shrink-0 text-nx-text-muted">→</span>
                          <span className="num shrink-0 font-semibold" style={{ color: c.kind === "add" ? "var(--nx-green)" : c.kind === "remove" ? "var(--nx-error)" : "var(--nx-locate)" }}>{c.to}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function kpiDeltaRows(a: HeadlineKpis, b: HeadlineKpis, currency: "EUR" | "RON") {
  const money = (av: number, bv: number, label: string) => ({ label, a: fmtMoney(av, currency), b: fmtMoney(bv, currency), delta: (bv - av >= 0 ? "+" : "") + fmtMoney(bv - av, currency), dir: Math.sign(bv - av) });
  const fac = (av: number, bv: number, label: string) => ({ label, a: fmtFactor(av) + "x", b: fmtFactor(bv) + "x", delta: (bv - av >= 0 ? "+" : "") + fmtFactor(bv - av) + "x", dir: Math.sign(bv - av) });
  const pct = (av: number, bv: number, label: string) => ({ label, a: fmtPct(av), b: fmtPct(bv), delta: (bv - av >= 0 ? "+" : "") + fmtPct(bv - av), dir: Math.sign(bv - av) });
  return [
    money(a.revenue, b.revenue, t("Umsatz p.a.")),
    money(a.ebitda, b.ebitda, t("EBITDA")),
    money(a.netIncome, b.netIncome, t("Jahresüberschuss")),
    money(a.fcf, b.fcf, t("Free Cash Flow")),
    pct(a.ebitdaMargin, b.ebitdaMargin, t("EBITDA-Marge")),
    fac(a.dscr, b.dscr, t("DSCR")),
  ];
}

const ctrl: React.CSSProperties = { height: 34, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" };
