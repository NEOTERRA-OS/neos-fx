"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { TextInput } from "./NumberInput";
import * as P from "../../store/persistence";
import { getSupabase } from "../../lib/supabaseClient";
import { StatusPill } from "../primitives/StatusPill";
import { VersionsVergleich } from "./VersionsVergleich";
import { t } from "../../lib/i18n";

/** Verwaltung — Modelle speichern/laden (Supabase), Snapshots, Audit-Log; JSON-Export/Import
 *  als immer verfügbarer Offline-Fallback. */
export function VerwaltungView() {
  const domain = useModelStore((s) => s.domain);
  const loadDomain = useModelStore((s) => s.loadDomain);
  const patch = useModelStore((s) => s.patch);
  const configured = P.supabaseConfigured();

  const [modelId, setModelId] = React.useState<string | null>(null);
  const [models, setModels] = React.useState<P.ModelRow[]>([]);
  const [snaps, setSnaps] = React.useState<P.SnapshotRow[]>([]);
  const [audit, setAudit] = React.useState<P.AuditRow[]>([]);
  const [snapLabel, setSnapLabel] = React.useState("");
  const [msg, setMsg] = React.useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // ── Auth-Status (Login selbst läuft über das globale Login-Gate + Modul „Team & Zugriff") ──
  const [userEmail, setUserEmail] = React.useState<string | null>(null);
  React.useEffect(() => {
    const sb = getSupabase(); if (!sb) return;
    sb.auth.getSession().then(({ data }) => setUserEmail(data.session?.user?.email ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => setUserEmail(session?.user?.email ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  const signedIn = !!userEmail;
  const auth = (fn: () => Promise<{ error: any }>, ok: string) => run(async () => { const { error } = await fn(); if (error) throw error; setMsg({ tone: "success", text: ok }); });

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (ok) setMsg({ tone: "success", text: ok }); }
    catch (e: any) { setMsg({ tone: "error", text: e?.message ?? String(e) }); }
    finally { setBusy(false); }
  };

  const refreshModels = () => run(async () => setModels(await P.listModels()));
  const refreshFor = (id: string) => run(async () => { setSnaps(await P.listSnapshots(id)); setAudit(await P.listAudit(id)); });

  React.useEffect(() => { if (configured && signedIn) refreshModels(); /* eslint-disable-next-line */ }, [configured, signedIn]);

  const btn = "rounded-control border px-3 text-[12px] font-semibold disabled:opacity-50";
  const btnStyle = { height: 34, borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", background: "var(--nx-surface)" } as const;
  const cta = "rounded-control px-3 text-[13px] font-bold disabled:opacity-50";
  const ctaStyle = { height: 34, background: "var(--nx-yellow)", color: "var(--nx-green)" } as const;

  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <h2 className="text-[14px] font-semibold">{t("Verwaltung — Speichern & Versionen")}</h2>
          <div className="flex items-center gap-2">
            {configured ? <StatusPill tone="success" label={signedIn ? `${t("Angemeldet:")} ${userEmail}` : t("Supabase verbunden")} /> : <StatusPill tone="warning" label={t("Offline (JSON)")} />}
            {signedIn && <button className={btn} style={btnStyle} onClick={() => auth(() => getSupabase()!.auth.signOut(), t("Abgemeldet."))}>{t("Abmelden")}</button>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border-divider)" }}>
          <span className="text-[12px] text-nx-text-secondary">{t("Modellname")}</span>
          <TextInput value={domain.meta.name} width={260} onCommit={(v) => patch((d) => { d.meta.name = v; })} />
          {/* JSON immer verfügbar */}
          <button className={btn} style={btnStyle} onClick={() => P.downloadDomain(domain)}>{t("JSON exportieren")}</button>
          <button className={btn} style={btnStyle} onClick={() => fileRef.current?.click()}>{t("JSON importieren")}</button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              try { loadDomain(P.jsonToDomain(await f.text())); setMsg({ tone: "success", text: t("Modell aus JSON geladen.") }); }
              catch (err: any) { setMsg({ tone: "error", text: err?.message ?? t("Ungültige Datei.") }); }
              e.target.value = "";
            }} />
        </div>

        {msg && <div className="px-4 py-2"><StatusPill tone={msg.tone} label={msg.text} /></div>}

        {configured && !signedIn && (
          <div className="px-4 py-3 border-t text-[12px] text-nx-text-secondary" style={{ borderColor: "var(--nx-border-divider)" }}>
            {t("Nicht angemeldet — im Betrachter-Modus. Zum Speichern in der Cloud bitte über das Login anmelden; Mitglieder und Rollen verwaltest du im Modul »Team & Zugriff«.")}
          </div>
        )}

        {configured && signedIn && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <button className={cta} style={ctaStyle} disabled={busy}
              onClick={() => run(async () => { const id = await P.saveModel(domain, modelId ?? undefined); setModelId(id); await refreshModels(); await refreshFor(id); }, t("Modell gespeichert."))}>
              {modelId ? t("Speichern") : t("Als neues Modell speichern")}
            </button>
            <span className="text-[11px] text-nx-text-muted">{modelId ? `${t("aktiv:")} ${modelId.slice(0, 8)}…` : t("noch nicht gespeichert")}</span>
          </div>
        )}
      </section>

      {configured && signedIn && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
            <div className="px-4 py-3 border-b text-[13px] font-semibold" style={{ borderColor: "var(--nx-border)" }}>{t("Gespeicherte Modelle")}</div>
            <div className="px-2 py-2">
              {models.length === 0 && <div className="px-2 py-2 text-[12px] text-nx-text-muted">{t("Noch keine Modelle.")}</div>}
              {models.map((m) => (
                <div key={m.id} className="flex items-center justify-between border-b px-2 py-1.5 text-[12.5px]" style={{ borderColor: "var(--nx-border-divider)" }}>
                  <span>{m.name} <span className="num text-[10.5px] text-nx-text-muted">· {new Date(m.updated_at).toLocaleString("de-DE")}</span></span>
                  <button className={btn} style={btnStyle} disabled={busy}
                    onClick={() => run(async () => { const { domain: d } = await P.loadModel(m.id); loadDomain(d); setModelId(m.id); await refreshFor(m.id); }, t("Modell geladen."))}>{t("Laden")}</button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
              <span className="text-[13px] font-semibold">{t("Snapshots")}</span>
              <input className="rounded-control border px-2 text-[12px]" style={{ height: 30, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)" }}
                placeholder={t("Label")} value={snapLabel} onChange={(e) => setSnapLabel(e.target.value)} />
              <button className={btn} style={btnStyle} disabled={busy || !modelId || !snapLabel}
                onClick={() => run(async () => { await P.createSnapshot(modelId!, snapLabel, domain); setSnapLabel(""); await refreshFor(modelId!); }, t("Snapshot erstellt."))}>{t("+ Snapshot")}</button>
            </div>
            <div className="px-2 py-2">
              {!modelId && <div className="px-2 py-2 text-[12px] text-nx-text-muted">{t("Erst ein Modell speichern/laden.")}</div>}
              {snaps.map((s) => (
                <div key={s.id} className="flex items-center justify-between border-b px-2 py-1.5 text-[12.5px]" style={{ borderColor: "var(--nx-border-divider)" }}>
                  <span>{s.label} <span className="num text-[10.5px] text-nx-text-muted">· {new Date(s.created_at).toLocaleString("de-DE")}</span></span>
                  <button className={btn} style={btnStyle} disabled={busy}
                    onClick={() => run(async () => { loadDomain(await P.restoreSnapshot(s.id)); }, t("Snapshot wiederhergestellt."))}>{t("Wiederherstellen")}</button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-tile border lg:col-span-2" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
            <div className="px-4 py-3 border-b text-[13px] font-semibold" style={{ borderColor: "var(--nx-border)" }}>{t("Audit-Log")}</div>
            <div className="px-4 py-2">
              {audit.length === 0 && <div className="py-1 text-[12px] text-nx-text-muted">—</div>}
              {audit.map((a) => (
                <div key={a.id} className="flex items-center gap-3 border-b py-1 text-[12px]" style={{ borderColor: "var(--nx-border-divider)" }}>
                  <span className="num w-[150px] text-nx-text-muted">{new Date(a.at).toLocaleString("de-DE")}</span>
                  <span className="font-semibold">{a.action}</span>
                  <span className="text-nx-text-secondary">{a.detail && Object.keys(a.detail).length ? JSON.stringify(a.detail) : ""}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      <VersionsVergleich snapshots={snaps.map((s) => ({ id: s.id, label: s.label }))} loadSnapshotDomain={P.fetchSnapshotDomain} />

      {!configured && (
        <div className="rounded-tile border px-4 py-3 text-[12px] text-nx-text-secondary" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
          {t("Supabase ist nicht konfiguriert — Speichern/Snapshots/Audit sind inaktiv, JSON-Export/Import funktioniert. Zum Aktivieren:")}{" "}<span className="num">supabase/schema.sql</span> {t("in der Supabase-SQL-Konsole ausführen und")}{" "}
          <span className="num"> NEXT_PUBLIC_SUPABASE_URL</span>/<span className="num">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> {t("in")} <span className="num">.env.local</span> {t("setzen (Vorlage:")}{" "}<span className="num">.env.local.example</span>).
        </div>
      )}
    </div>
  );
}
