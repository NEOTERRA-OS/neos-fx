"use client";
import React from "react";
import { getSupabase, supabaseConfigured } from "../../lib/supabaseClient";
import { t } from "../../lib/i18n";

/** Team & Zugriff — In-App-Verwaltung der Mitglieder/Rollen (nur für den Owner).
 *  Ruft die Edge-Function `nfx-admin` (Service-Rolle) auf: E-Mail → Nutzer auflösen/einladen,
 *  Rolle setzen, entfernen. Der Browser darf `auth.users` nicht direkt lesen — daher serverseitig. */

type Member = { user_id: string; role: string; email: string; self: boolean };
const ROLE_LABEL: Record<string, string> = { owner: "Owner (Admin)", editor: "Editor (bearbeiten)", viewer: "Betrachter (nur lesen)" };
const ROLE_COLOR: Record<string, string> = { owner: "var(--nx-locate)", editor: "var(--nx-green)", viewer: "var(--nx-text-muted)" };

export function TeamAdminView() {
  const configured = supabaseConfigured();
  const [signedIn, setSignedIn] = React.useState<boolean | null>(null);
  const [me, setMe] = React.useState<{ email?: string; ownedModelId: string | null; roles: { model_id: string; role: string }[] } | null>(null);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("editor");
  const [sessionEmail, setSessionEmail] = React.useState<string | null>(null);

  const call = async (action: string, extra: Record<string, unknown> = {}) => {
    const sb = getSupabase(); if (!sb) throw new Error("Supabase nicht konfiguriert.");
    const { data, error } = await sb.functions.invoke("nfx-admin", { body: { action, ...extra } });
    if (error) {
      // Fehlertext aus der Funktions-Antwort holen, falls vorhanden.
      let detail = error.message;
      try { const ctx = (error as { context?: Response }).context; if (ctx) { const j = await ctx.json(); detail = j.message ?? j.error ?? detail; } } catch { /* ignore */ }
      throw new Error(detail);
    }
    if (data?.error) throw new Error(data.message ?? data.error);
    return data;
  };

  const refresh = React.useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      const who = await call("whoami");
      setMe(who);
      if (who.ownedModelId) { const r = await call("list"); setMembers(r.members ?? []); }
      else setMembers([]);
    } catch (e) { setMsg({ tone: "err", text: (e as Error).message }); }
    finally { setBusy(false); }
  }, []);

  React.useEffect(() => {
    const sb = getSupabase(); if (!sb) { setSignedIn(false); return; }
    sb.auth.getSession().then(({ data }) => { const on = !!data.session; setSignedIn(on); setSessionEmail(data.session?.user?.email ?? null); if (on) refresh(); });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => { const on = !!s; setSignedIn(on); setSessionEmail(s?.user?.email ?? null); if (on) refresh(); else { setMe(null); setMembers([]); } });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ tone: "ok", text: ok }); await refresh(); }
    catch (e) { setMsg({ tone: "err", text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const invite = () => run(() => call("invite", { email: email.trim(), role, redirectTo: typeof window !== "undefined" ? window.location.origin : undefined }).then(() => setEmail("")), t("Eingeladen / hinzugefügt."));
  const setMemberRole = (m: Member, r: string) => run(() => call("setRole", { user_id: m.user_id, role: r }), t("Rolle aktualisiert."));
  const removeMember = (m: Member) => run(() => call("remove", { user_id: m.user_id }), t("Mitglied entfernt."));

  const isOwner = !!me?.ownedModelId;
  const border = { borderColor: "var(--nx-border)" } as const;

  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={{ ...border, background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={border}>
          <div>
            <h2 className="text-[14px] font-semibold">{t("Team & Zugriff")}</h2>
            <div className="text-[11px] text-nx-text-muted">{t("Mitglieder einladen und Rollen vergeben — ohne SQL. Nur der Owner kann verwalten.")}</div>
          </div>
          {(me?.email ?? sessionEmail) && <span className="text-[11px] text-nx-text-muted">{t("angemeldet als")} <b className="text-nx-text-secondary">{me?.email ?? sessionEmail}</b></span>}
        </div>

        {!configured && <Note>{t("Supabase ist nicht konfiguriert — Team-Verwaltung inaktiv.")}</Note>}
        {configured && signedIn === false && <Note>{t("Bitte zuerst anmelden. Danach erscheint hier die Team-Verwaltung.")}</Note>}

        {configured && signedIn && !isOwner && (
          <Note>{me?.roles?.length
            ? `${t("Nur der Owner des geteilten Modells kann Mitglieder verwalten.")} ${t("Deine Rolle")}: ${me.roles.map((r) => ROLE_LABEL[r.role] ?? r.role).join(", ")}.`
            : t("Noch kein geteiltes Modell vorhanden. So wirst du zum Owner: einmal unter »Speichern & Versionen« speichern (oder einen Wert ändern) — das legt das Team-Modell an und macht dich automatisch zum Owner. Danach Seite neu laden, dann erscheint hier die Verwaltung.")}</Note>
        )}

        {configured && signedIn && isOwner && (
          <>
            {/* Einladen */}
            <div className="flex flex-wrap items-end gap-2 px-4 py-3 border-b" style={border}>
              <label className="flex flex-col gap-0.5">
                <span className="caption text-[10px] text-nx-text-muted">{t("E-Mail einladen")}</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kollege@neoterra.ag" type="email"
                  className="rounded-control border px-2 text-[12.5px]" style={{ height: 34, width: 240, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="caption text-[10px] text-nx-text-muted">{t("Rolle")}</span>
                <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-control border px-2 text-[12.5px]" style={{ height: 34, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }}>
                  <option value="editor">{t("Editor (bearbeiten)")}</option>
                  <option value="viewer">{t("Betrachter (nur lesen)")}</option>
                  <option value="owner">{t("Owner (Admin)")}</option>
                </select>
              </label>
              <button onClick={invite} disabled={busy || !email.includes("@")} className="rounded-control px-3 text-[13px] font-bold disabled:opacity-50" style={{ height: 34, background: "var(--nx-locate)", color: "#fff" }}>{t("Einladen")}</button>
              <span className="text-[10.5px] text-nx-text-muted">{t("Bereits registrierte Personen werden direkt hinzugefügt; neue bekommen eine Einladung per E-Mail (sofern E-Mail-Versand konfiguriert ist).")}</span>
            </div>

            {/* Mitglieder */}
            <div className="overflow-x-auto px-2 py-2">
              <table className="w-full text-[12.5px]">
                <thead><tr className="caption text-[10px] text-nx-text-muted">
                  <th className="px-2 py-1.5 text-left">{t("Mitglied")}</th>
                  <th className="px-2 py-1.5 text-left">{t("Rolle")}</th>
                  <th className="px-2 py-1.5"></th>
                </tr></thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.user_id} style={{ borderTop: "1px solid var(--nx-border-divider)" }}>
                      <td className="px-2 py-1.5">{m.email}{m.self && <span className="ml-1 text-[10px] text-nx-text-muted">({t("du")})</span>}</td>
                      <td className="px-2 py-1.5">
                        <select value={m.role} disabled={m.self} onChange={(e) => setMemberRole(m, e.target.value)}
                          className="rounded-control border px-2 text-[12px] font-semibold" style={{ height: 30, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: ROLE_COLOR[m.role] ?? "var(--nx-text)" }}>
                          <option value="owner">{t("Owner (Admin)")}</option>
                          <option value="editor">{t("Editor (bearbeiten)")}</option>
                          <option value="viewer">{t("Betrachter (nur lesen)")}</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-right">{!m.self && <button className="text-[11px] text-nx-error hover:opacity-70" onClick={() => removeMember(m)}>{t("entfernen")}</button>}</td>
                    </tr>
                  ))}
                  {members.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-[12px] text-nx-text-muted">{busy ? "…" : t("Noch keine weiteren Mitglieder.")}</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="border-t px-4 py-2 text-[10.5px] text-nx-text-muted" style={border}>
              <b>{t("Owner")}</b> {t("= volle Verwaltung · ")}<b>{t("Editor")}</b> {t("= darf das Modell ändern · ")}<b>{t("Betrachter")}</b> {t("= nur lesen & kommentieren (App startet automatisch im Betrachter-Modus).")}
            </div>
          </>
        )}

        {msg && <div className="mx-4 mb-3 rounded-control border px-3 py-2 text-[11.5px]" style={{ borderColor: msg.tone === "ok" ? "var(--nx-green)" : "var(--nx-error)", color: msg.tone === "ok" ? "var(--nx-green)" : "var(--nx-error)" }}>{msg.text}</div>}
      </section>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-4 text-[12px] text-nx-text-secondary">{children}</div>;
}
