"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import {
  deriveAssumptionRegister, readScenarioConst, setScenarioConst,
  type AssumptionRow, type Domain,
} from "../../store/model";
import type { AssumptionConfidence, AssumptionStatus } from "../../core/types";
import { fmtNumber } from "../../design/format";
import { NumberInput, TextInput } from "./NumberInput";
import { CommentsPanel, threadOf } from "./CommentsPanel";
import { t, getLang } from "../../lib/i18n";
import { MessageSquare, RotateCcw, ChevronDown, ChevronRight, Search, Star, Flag, X } from "lucide-react";

/** ANNAHMEN — EIN Register für alle Modell-Treiber.
 *
 *  Vorher zwei Ansichten auf denselben Datensatz: das „Annahmen-Sheet (Szenarien)" mit
 *  Base · Best · Worst und das „Annahmen-Register (Team-Review)" mit Quelle, Owner,
 *  Konfidenz, Status und Historie. Dieselben Zeilen, je die halbe Wahrheit: wer einen Wert
 *  änderte, sah nicht, ob er geprüft war; wer prüfte, konnte den Wert nicht ändern.
 *
 *  Zusammengelegt heißt hier NICHT „beide Tabellen untereinander". 208 Treiber × 12 Spalten
 *  sind kein Arbeitsblatt, sondern eine Tapete. Deshalb drei Zonen nebeneinander:
 *
 *    NAVIGATOR (links)  — wohin schaue ich: Cockpit, offene Punkte, Bereiche/Kategorien,
 *                          jeweils mit Prüfstand. Ersetzt Reiter + Kategorie-Akkordeon.
 *    TABELLE (Mitte)    — sechs Spalten, mehr nicht: Treiber · Einheit · Base · Best ·
 *                          Worst · Spannweite, dazu ein Statuspunkt. Bleibt lesbar.
 *    DETAIL (rechts)    — Quelle, Owner, Konfidenz, Status, Notiz, Historie und Kommentare
 *                          zum ANGEKLICKTEN Treiber. Review-Daten sind einen Klick entfernt
 *                          statt sechs Spalten breit.
 *
 *  LEER in Best/Worst heißt „erbt von Base". Eine Zahl heißt „bewusst abweichend". Nur so
 *  ist erkennbar, welche Treiber überhaupt ein Szenario-Band tragen.
 *
 *  Jede Änderung — Wert wie Review-Angabe — landet mit Bearbeiter und Zeitstempel in der
 *  Historie der Annahme.
 *
 *  Simuliert wird nicht hier, sondern im Szenario-Studio (Analyse → Szenario-Studio):
 *  hier werden Annahmen GESETZT, dort werden sie durchgerechnet.
 */

/* ---------------------------------------------------------------- Stammdaten */

/** Die Treiber, an denen im Gespräch wirklich gedreht wird. */
const COCKPIT: string[] = [
  "price.kartoffel_pommes", "price.kartoffel_chips", "price.tomate",
  "yield.kartoffel_pommes", "yield.tomate",
  "wc.dso", "advance.rate", "lohn.factor",
  "irrig.capex_from_year", "store.active", "macro.euribor", "infl.input",
];

const SC = [
  { id: "sc-base", label: "Base", color: "var(--nx-text)" },
  { id: "sc-best", label: "Best", color: "var(--nx-success)" },
  { id: "sc-worst", label: "Worst", color: "var(--nx-error)" },
] as const;

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

/** Bereiche — bündeln die ~30 Kategorien zu sechs Blöcken im Navigator. */
const BEREICHE: { id: string; label: string; cats: string[] }[] = [
  { id: "agronomie", label: "Agronomie", cats: ["Erträge", "Qualität", "Verluste", "Saatgut/Pflanzgut", "Düngerpreise", "Spritzstrategie", "Bewässerung"] },
  { id: "preise", label: "Preise & Markt", cats: ["Preise (Verkauf & Input)", "Markt", "Makro", "Inflation", "Erlöse"] },
  { id: "maschinen", label: "Maschinen & Technik", cats: ["Maschinenpreise", "Maschinen-TCO", "Einsatz & Schlagkraft", "CAPEX", "Transport", "Logistik"] },
  { id: "personal", label: "Personal", cats: ["Personal"] },
  { id: "finanzen", label: "Finanzen & Steuern", cats: ["Finanzierung", "Zinsen", "Working Capital", "Steuern", "Covenants", "Subventionen", "Lager", "Betriebskosten / SG&A", "Holding", "Bewertung & Leistung"] },
  { id: "betrieb", label: "Betrieb & Sonstige", cats: ["Betrieb", "Sonstige"] },
];
const CAT_TO_BEREICH = new Map<string, string>();
for (const b of BEREICHE) for (const c of b.cats) CAT_TO_BEREICH.set(c, b.id);
const bereichOf = (cat: string) => CAT_TO_BEREICH.get(cat) ?? "betrieb";

/** Anzeige-Faktor je Einheit: Raten als %, Geld in €. */
function scale(unit: string): { f: number; suffix: string; dec: number } {
  if (unit === "rate") return { f: 100, suffix: "%", dec: 2 };
  if (unit === "money" || unit === "money_per_ha" || unit === "money_per_tonne") return { f: 0.01, suffix: "€", dec: 2 };
  return { f: 1, suffix: "", dec: 2 };
}

/** Sprechende Einheit je Zeile. Ohne sie steht bei „Ertrag Kartoffel 45" nirgends, ob das
 *  t/ha, dt/ha oder kg sind — die Zahl allein ist nicht prüfbar. Die Einheit gilt für alle
 *  drei Szenario-Spalten, deshalb steht sie einmal in einer eigenen Spalte. */
const EINHEIT: Record<string, string> = {
  rate: "%", money: "€", money_per_ha: "€/ha", money_per_tonne: "€/t",
  tonne_per_ha: "t/ha", days: "Tage", months: "Monate",
};

/** Ist der Treiber noch zu klären? Offen, strittig oder mit niedriger Konfidenz. */
const zuKlaeren = (r: AssumptionRow) => {
  const st = r.meta.status ?? "offen";
  return st === "offen" || st === "strittig" || r.meta.confidence === "niedrig";
};

/* ------------------------------------------------------------------- Audit */

/** Änderung mit Bearbeiter und Zeitstempel in der Historie der Annahme ablegen.
 *  Gilt jetzt auch für WERTE — vorher wurden nur Review-Angaben protokolliert, obwohl
 *  gerade die stille Zahlenänderung diejenige ist, die man später rekonstruieren will. */
function logMeta(d: Domain, key: string, by: string, field: string, from: string, to: string) {
  const a = d.assumptions[key]; if (!a) return;
  a.meta = a.meta ?? {};
  a.meta.updatedBy = by;
  a.meta.updatedAt = new Date().toISOString();
  a.meta.history = a.meta.history ?? [];
  a.meta.history.push({ ts: a.meta.updatedAt, by, field, from: from || undefined, to: to || undefined });
  if (a.meta.history.length > 25) a.meta.history = a.meta.history.slice(-25);
}

/* -------------------------------------------------------------------- Zellen */

function BandZelle({ keyName, scenarioId, scLabel, unit, editor }: {
  keyName: string; scenarioId: string; scLabel: string; unit: string; editor: string;
}) {
  const { domain, patch } = useModelStore();
  const eigen = readScenarioConst(domain, keyName, scenarioId);
  const basis = readScenarioConst(domain, keyName, domain.baseScenarioId);
  const istBase = scenarioId === domain.baseScenarioId;
  const s = scale(unit);
  const wert = eigen ?? basis;
  const erbt = !istBase && eigen === null;
  const zeig = (v: number | null) => (v === null ? "—" : fmtNumber(v * s.f, s.dec));

  if (wert === null) return <span className="num text-[11px] text-nx-text-muted">{t("Kurve")}</span>;

  return (
    // KEIN Suffix mehr im Feld: „€" bzw. „%" hinter der Eingabe verschob jede Zelle um die
    // Breite ihres Zeichens, weshalb die Zahlen dreier Spalten nie untereinander standen.
    // Die Einheit steht jetzt einmal in der eigenen Spalte — hier bleibt nur ein Marker-Slot
    // fester Breite, damit „erbt von Base" und „Eigenwert zurücksetzen" nichts verrücken.
    <span className="inline-flex items-center justify-end gap-1">
      <NumberInput
        value={Number((wert * s.f).toFixed(s.dec))}
        width={74}
        onCommit={(v) => patch((d) => {
          const alt = readScenarioConst(d, keyName, scenarioId);
          setScenarioConst(d, keyName, scenarioId, v / s.f);
          logMeta(d, keyName, editor, `${t("Wert")} ${scLabel}`, zeig(alt), fmtNumber(v, s.dec));
        })}
      />
      <span className="inline-flex justify-center" style={{ width: 12 }}>
      {!istBase && (
        erbt
          ? <span className="text-[10px] text-nx-text-muted" title={t("erbt von Base — Zahl eingeben, um bewusst abzuweichen")}>=</span>
          : <button className="text-[10px] text-nx-text-muted hover:text-nx-error" title={t("Eigenwert entfernen — wieder von Base erben")}
              onClick={() => patch((d) => {
                logMeta(d, keyName, editor, `${t("Wert")} ${scLabel}`, zeig(readScenarioConst(d, keyName, scenarioId)), t("erbt von Base"));
                setScenarioConst(d, keyName, scenarioId, null);
              })}>
              <RotateCcw size={11} />
            </button>
      )}
      </span>
    </span>
  );
}

/** Spannweite Best↔Worst relativ zu Base — wie viel Unsicherheit im Treiber steckt. */
function spannweiteOf(domain: Domain, key: string): number | null {
  const b = readScenarioConst(domain, key, "sc-base");
  const be = readScenarioConst(domain, key, "sc-best") ?? b;
  const w = readScenarioConst(domain, key, "sc-worst") ?? b;
  if (b === null || be === null || w === null || b === 0) return null;
  return Math.abs(be - w) / Math.abs(b);
}

function Zeile({ r, editor, aktiv, onSelect }: {
  r: AssumptionRow; editor: string; aktiv: boolean; onSelect: () => void;
}) {
  const domain = useModelStore((s) => s.domain);
  const sp = spannweiteOf(domain, r.key);
  const scfg = statusCfg(r.meta.status);
  const nCmt = threadOf(domain.comments, `assumption:${r.key}`)?.messages.length ?? 0;

  return (
    <tr style={{
      borderTop: "1px solid var(--nx-border-divider)",
      background: aktiv ? "color-mix(in srgb, var(--nx-locate) 10%, transparent)" : undefined,
    }}>
      <td className="px-3 py-1.5">
        <button className="text-left" onClick={onSelect}>
          <span className="font-medium" style={{ color: aktiv ? "var(--nx-locate)" : undefined }}>{t(r.label)}</span>
          <span className="num ml-2 text-[9.5px] text-nx-text-muted">{r.key}</span>
          {nCmt > 0 && (
            <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9.5px]" style={{ color: "var(--nx-locate)" }}>
              <MessageSquare size={9} strokeWidth={2.5} aria-hidden />{nCmt}
            </span>
          )}
        </button>
      </td>
      <td className="num px-2 py-1.5 text-left text-[11px] text-nx-text-muted whitespace-nowrap">{EINHEIT[r.unit] ?? "–"}</td>
      {SC.map((s) => (
        <td key={s.id} className="px-2 py-1.5 text-right">
          <BandZelle keyName={r.key} scenarioId={s.id} scLabel={s.label} unit={r.unit} editor={editor} />
        </td>
      ))}
      <td className="num px-2 py-1.5 text-right text-[11px]"
          style={{ color: sp == null ? "var(--nx-text-muted)" : sp > 0.3 ? "var(--nx-warning)" : "var(--nx-text-muted)" }}
          title={t("Spannweite Best↔Worst, relativ zu Base")}>
        {sp == null ? "–" : `± ${fmtNumber(sp * 100, 0)} %`}
      </td>
      <td className="px-2 py-1.5 text-center">
        <button onClick={onSelect} title={`${t("Status")}: ${t(scfg.label)}${r.meta.owner ? ` · ${r.meta.owner}` : ""}`}>
          <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 999, background: scfg.color }} />
        </button>
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------- Detail-Panel */

function Detail({ r, editor, onClose, onComment }: {
  r: AssumptionRow; editor: string; onClose: () => void; onComment: () => void;
}) {
  const { domain, patch } = useModelStore();
  const locale = getLang() === "en" ? "en-US" : "de-DE";
  const hist = r.meta.history ?? [];
  const scfg = statusCfg(r.meta.status);
  const sp = spannweiteOf(domain, r.key);
  const setMeta = (field: string, label: string, from: string, to: string) =>
    patch((d) => {
      const a = d.assumptions[r.key]; if (!a) return;
      a.meta = a.meta ?? {};
      (a.meta as Record<string, unknown>)[field] = to || undefined;
      logMeta(d, r.key, editor, label, from, to);
    });
  const feld = "caption text-[9.5px] font-bold uppercase tracking-wide text-nx-text-muted";

  return (
    <aside className="rounded-tile border self-start sticky top-2" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
      <div className="flex items-start justify-between gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold leading-tight">{t(r.label)}</div>
          <div className="num truncate text-[9.5px] text-nx-text-muted">{r.key}</div>
        </div>
        <button onClick={onClose} title={t("Schließen")} className="text-nx-text-muted hover:text-nx-text"><X size={13} /></button>
      </div>

      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--nx-border-divider)" }}>
        <div className="px-3 py-2" style={{ background: "var(--nx-surface)" }}>
          <div className={feld}>{t("Kategorie")}</div>
          <div className="text-[11.5px]">{t(r.category)}</div>
        </div>
        <div className="px-3 py-2" style={{ background: "var(--nx-surface)" }}>
          <div className={feld}>{t("Spannweite")}</div>
          <div className="num text-[11.5px]" style={{ color: sp != null && sp > 0.3 ? "var(--nx-warning)" : undefined }}>
            {sp == null ? "–" : `± ${fmtNumber(sp * 100, 0)} %`}
          </div>
        </div>
      </div>

      <div className="space-y-2.5 border-t px-3 py-3" style={{ borderColor: "var(--nx-border)" }}>
        <div>
          <div className={feld}>{t("Status")}</div>
          <select value={r.meta.status ?? "offen"} className="mt-1 w-full rounded-control border px-1.5 text-[11.5px] font-semibold"
            style={{ height: 28, background: scfg.bg, borderColor: "var(--nx-border)", color: scfg.color }}
            onChange={(e) => setMeta("status", t("Status"), t(statusCfg(r.meta.status).label), t(statusCfg(e.target.value as AssumptionStatus).label))}>
            {STATUS_OPTS.map((o) => <option key={o.v} value={o.v}>{t(o.label)}</option>)}
          </select>
        </div>
        <div>
          <div className={feld}>{t("Konfidenz")}</div>
          <select value={r.meta.confidence ?? ""} className="mt-1 w-full rounded-control border px-1.5 text-[11.5px] font-semibold"
            style={{ height: 28, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: confCfg(r.meta.confidence)?.color ?? "var(--nx-text-muted)" }}
            onChange={(e) => setMeta("confidence", t("Konfidenz"), r.meta.confidence ?? "", e.target.value)}>
            <option value="">—</option>
            {CONF_OPTS.map((o) => <option key={o.v} value={o.v}>{t(o.label)}</option>)}
          </select>
        </div>
        <div>
          <div className={feld}>{t("Quelle")}</div>
          <div className="mt-1"><TextInput value={r.meta.source ?? ""} width={276} onCommit={(v) => setMeta("source", t("Quelle"), r.meta.source ?? "", v)} /></div>
        </div>
        <div>
          <div className={feld}>{t("Owner")}</div>
          <div className="mt-1"><TextInput value={r.meta.owner ?? ""} width={276} onCommit={(v) => setMeta("owner", t("Owner"), r.meta.owner ?? "", v)} /></div>
        </div>
        <div>
          <div className={feld}>{t("Notiz")}</div>
          <div className="mt-1"><TextInput value={r.meta.note ?? ""} width={276} onCommit={(v) => setMeta("note", t("Notiz"), r.meta.note ?? "", v)} /></div>
        </div>
        <button className="inline-flex w-full items-center justify-center gap-1.5 rounded-control border px-2 text-[11.5px] font-semibold"
          style={{ height: 28, borderColor: "var(--nx-border)", color: "var(--nx-locate)" }} onClick={onComment}>
          <MessageSquare size={12} strokeWidth={2.5} aria-hidden />{t("Kommentare")}
        </button>
      </div>

      <div className="border-t px-3 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
        <div className={feld}>{t("Änderungshistorie")}</div>
        {hist.length === 0
          ? <div className="mt-1 text-[10.5px] text-nx-text-muted">{t("noch keine Änderung protokolliert")}</div>
          : (
            <div className="mt-1 max-h-[220px] space-y-1 overflow-y-auto">
              {[...hist].reverse().map((h, i) => (
                <div key={i} className="text-[10.5px] text-nx-text-muted">
                  <span className="num">{new Date(h.ts).toLocaleString(locale)}</span> · <b className="text-nx-text-secondary">{h.by}</b>
                  <div>{h.field}: <span>{h.from || "—"}</span> → <span style={{ color: "var(--nx-locate)" }}>{h.to || "—"}</span></div>
                </div>
              ))}
            </div>
          )}
      </div>
    </aside>
  );
}

/* --------------------------------------------------------------------- View */

type Auswahl = { kind: "cockpit" } | { kind: "klaeren" } | { kind: "cat"; cat: string };

export function AnnahmenView() {
  const { domain, editor, setEditor } = useModelStore();
  const rows = deriveAssumptionRegister(domain, domain.baseScenarioId);

  const [auswahl, setAuswahl] = React.useState<Auswahl>({ kind: "cockpit" });
  const [offen, setOffen] = React.useState<Record<string, boolean>>({ agronomie: true });
  const [q, setQ] = React.useState("");
  const [aktiv, setAktiv] = React.useState<string | null>(null);
  const [cmt, setCmt] = React.useState<{ target: string; label: string; area?: string } | null>(null);

  const suchend = q.trim().length > 0;
  const s = q.trim().toLowerCase();

  const cockpitRows = React.useMemo(() => {
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return COCKPIT.map((k) => byKey.get(k)).filter(Boolean) as AssumptionRow[];
  }, [rows]);

  /** Was die Tabelle zeigt — Suche schlägt die Navigator-Auswahl. */
  const liste = React.useMemo(() => {
    if (suchend) {
      return rows.filter((r) => r.label.toLowerCase().includes(s) || r.key.toLowerCase().includes(s)
        || (r.meta.source ?? "").toLowerCase().includes(s) || (r.meta.owner ?? "").toLowerCase().includes(s)
        || (r.meta.note ?? "").toLowerCase().includes(s));
    }
    if (auswahl.kind === "cockpit") return cockpitRows;
    if (auswahl.kind === "klaeren") return rows.filter(zuKlaeren);
    return rows.filter((r) => r.category === auswahl.cat);
  }, [rows, suchend, s, auswahl, cockpitRows]);

  const titel = suchend ? `${t("Suchergebnis")} „${q.trim()}"`
    : auswahl.kind === "cockpit" ? t("Cockpit — die Treiber, an denen wirklich gedreht wird")
    : auswahl.kind === "klaeren" ? t("Zu klären — offen, strittig oder niedrige Konfidenz")
    : t(auswahl.cat);

  const aktivRow = aktiv ? rows.find((r) => r.key === aktiv) ?? null : null;

  // Prüfstand
  const total = rows.length;
  const geprueft = rows.filter((r) => r.meta.status === "geprueft").length;
  const nKlaeren = rows.filter(zuKlaeren).length;
  const pct = total ? Math.round((geprueft / total) * 100) : 0;

  const catsOf = (bid: string) => {
    const m = new Map<string, { n: number; ok: number }>();
    for (const r of rows) {
      if (bereichOf(r.category) !== bid) continue;
      const e = m.get(r.category) ?? { n: 0, ok: 0 };
      e.n++; if (r.meta.status === "geprueft") e.ok++;
      m.set(r.category, e);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const bereichStat = (bid: string) => {
    const rs = rows.filter((r) => bereichOf(r.category) === bid);
    return { n: rs.length, ok: rs.filter((r) => r.meta.status === "geprueft").length };
  };

  const th = "px-3 py-2 caption text-[10px] text-nx-text-muted";
  const card: React.CSSProperties = { borderColor: "var(--nx-border)", background: "var(--nx-surface)" };
  const navBtn = (on: boolean): React.CSSProperties => ({
    background: on ? "color-mix(in srgb, var(--nx-locate) 12%, transparent)" : "transparent",
    color: on ? "var(--nx-locate)" : "var(--nx-text-secondary)",
  });

  return (
    <div className="space-y-3">
      {/* ---- Kopf: Identität, Suche, Prüfstand in EINER Zeile --------------- */}
      <section className="rounded-tile border" style={card}>
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
          <h2 className="text-[14px] font-semibold">{t("Annahmen")}</h2>
          <label className="inline-flex items-center gap-1.5 rounded-control border px-2" style={{ height: 30, borderColor: "var(--nx-border)" }}>
            <Search size={13} className="text-nx-text-muted" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Treiber, Quelle, Owner …")}
              className="border-0 bg-transparent text-[12px] outline-none" style={{ width: 210, color: "var(--nx-text)" }} />
            {suchend && <button onClick={() => setQ("")} className="text-nx-text-muted hover:text-nx-text"><X size={12} /></button>}
          </label>

          {/* Prüfstand als Balken statt vier Kacheln — dieselbe Information, ein Achtel Fläche. */}
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="caption text-[10px] text-nx-text-muted">{t("geprüft")}</span>
              <div className="h-1.5 w-28 overflow-hidden rounded-pill" style={{ background: "var(--nx-border-divider)" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "var(--nx-green)" }} />
              </div>
              <span className="num text-[11px] font-semibold">{geprueft}/{total}</span>
            </div>
            <button onClick={() => { setQ(""); setAuswahl({ kind: "klaeren" }); }}
              className="inline-flex items-center gap-1.5 rounded-control border px-2 text-[11px] font-semibold"
              style={{ height: 26, borderColor: "var(--nx-border)", color: nKlaeren ? "var(--nx-warn, #C9A227)" : "var(--nx-text-muted)" }}>
              <Flag size={11} strokeWidth={2.5} aria-hidden />{nKlaeren} {t("zu klären")}
            </button>
            <label className="inline-flex items-center gap-1.5 text-[11px] text-nx-text-secondary">
              {t("Bearbeiter")}:
              <input value={editor} onChange={(e) => setEditor(e.target.value)}
                className="rounded-control border px-2 text-[12px] font-semibold"
                style={{ height: 28, width: 130, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-locate)" }} />
            </label>
          </div>
        </div>
      </section>

      {/* ---- Navigator · Tabelle · Detail ---------------------------------- */}
      <div className="grid gap-3" style={{ gridTemplateColumns: aktivRow ? "232px minmax(0,1fr) 316px" : "232px minmax(0,1fr)" }}>
        {/* NAVIGATOR */}
        <nav className="rounded-tile border self-start overflow-hidden" style={card}>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold"
            style={navBtn(!suchend && auswahl.kind === "cockpit")}
            onClick={() => { setQ(""); setAuswahl({ kind: "cockpit" }); }}>
            <Star size={12} strokeWidth={2.5} aria-hidden />{t("Cockpit")}
            <span className="num ml-auto text-[10px] text-nx-text-muted">{cockpitRows.length}</span>
          </button>
          <button className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-[12px] font-semibold"
            style={{ ...navBtn(!suchend && auswahl.kind === "klaeren"), borderColor: "var(--nx-border)" }}
            onClick={() => { setQ(""); setAuswahl({ kind: "klaeren" }); }}>
            <Flag size={12} strokeWidth={2.5} aria-hidden />{t("Zu klären")}
            <span className="num ml-auto text-[10px]" style={{ color: nKlaeren ? "var(--nx-warn, #C9A227)" : "var(--nx-text-muted)" }}>{nKlaeren}</span>
          </button>

          {BEREICHE.map((b) => {
            const st = bereichStat(b.id);
            if (!st.n) return null;
            const auf = offen[b.id] ?? false;
            return (
              <div key={b.id} className="border-b" style={{ borderColor: "var(--nx-border-divider)" }}>
                <button className="flex w-full items-center gap-1.5 px-3 py-2 text-left"
                  onClick={() => setOffen((o) => ({ ...o, [b.id]: !auf }))}>
                  {auf ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span className="text-[11.5px] font-semibold" style={{ color: "var(--nx-text-secondary)" }}>{t(b.label)}</span>
                  <span className="num ml-auto text-[9.5px]" style={{ color: st.ok === st.n ? "var(--nx-green)" : "var(--nx-text-muted)" }}>{st.ok}/{st.n}</span>
                </button>
                {auf && catsOf(b.id).map(([cat, e]) => {
                  const on = !suchend && auswahl.kind === "cat" && auswahl.cat === cat;
                  return (
                    <button key={cat} className="flex w-full items-center gap-1.5 py-1.5 pl-8 pr-3 text-left text-[11.5px]"
                      style={navBtn(on)} onClick={() => { setQ(""); setAuswahl({ kind: "cat", cat }); }}>
                      {t(cat)}
                      <span className="num ml-auto text-[9.5px]" style={{ color: e.ok === e.n ? "var(--nx-green)" : "var(--nx-text-muted)" }}>{e.ok}/{e.n}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* TABELLE */}
        <section className="rounded-tile border self-start" style={card}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5" style={{ borderColor: "var(--nx-border)" }}>
            <h3 className="text-[13px] font-semibold" style={{ color: "var(--nx-brand-lift)" }}>{titel}</h3>
            <span className="caption text-[10px] text-nx-text-muted">
              {liste.length} {t("Treiber")} · {t("Zeile anklicken für Quelle, Owner, Status und Historie")}
            </span>
          </div>
          <div className="overflow-x-auto px-2 py-1">
            <table className="w-full text-[12px]">
              <thead>
                <tr>
                  <th className={th + " text-left"}>{t("Treiber")}</th>
                  <th className={th + " text-left"}>{t("Einheit")}</th>
                  {SC.map((sc) => <th key={sc.id} className={th + " text-right"} style={{ color: sc.color }}>{sc.label}</th>)}
                  <th className={th + " text-right"}>{t("Spannweite")}</th>
                  <th className={th + " text-center"} title={t("Review-Status")}>●</th>
                </tr>
              </thead>
              <tbody>
                {liste.map((r) => (
                  <Zeile key={r.key} r={r} editor={editor} aktiv={aktiv === r.key}
                    onSelect={() => setAktiv(aktiv === r.key ? null : r.key)} />
                ))}
                {!liste.length && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-[12px] text-nx-text-muted">{t("Kein Treiber für diese Auswahl.")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t px-4 py-2 text-[10.5px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>
            {t("Leeres Best/Worst heißt „erbt von Base\". Werte und Review-Angaben liegen im gemeinsamen Cloud-Stand und werden mit Bearbeiter und Zeitstempel protokolliert. Simulieren: Analyse → Szenario-Studio.")}
          </div>
        </section>

        {/* DETAIL */}
        {aktivRow && (
          <Detail r={aktivRow} editor={editor} onClose={() => setAktiv(null)}
            onComment={() => setCmt({ target: `assumption:${aktivRow.key}`, label: aktivRow.label, area: aktivRow.category })} />
        )}
      </div>

      {cmt && <CommentsPanel target={cmt.target} targetLabel={cmt.label} area={cmt.area} onClose={() => setCmt(null)} />}
    </div>
  );
}
