"use client";
import React from "react";
import { getSupabase, supabaseConfigured } from "../../lib/supabaseClient";
import { NeoterraLogo } from "./NeoterraLogo";
import { t } from "../../lib/i18n";

/** NEOS FX — Login-Gate. Pixelgenau nach NEOS-Snap-Referenz (Zwei-Panel-Split).
 *  WICHTIG: Der Login ist IMMER HELL — unabhängig vom App-Theme (feste Hex-Werte, kein CSS-Var).
 *  Gate-Logik:
 *   • #readonly-Link  → Betrachter/Investor-Schnellblick ohne Login (App direkt).
 *   • Supabase nicht konfiguriert → App direkt (Offline-Fallback, kein Aussperren).
 *   • sonst: keine Session → Login-Screen; mit Session → App.
 *  Auth via getSupabase().auth (signInWithPassword / signUp) — identisch zur Verwaltung. */

const readonlyRequested = () =>
  typeof window !== "undefined" && /(^|[#&?])readonly\b/i.test(window.location.hash + window.location.search);

// neoterra-Glyph (identisch zur Sidebar-Marke) im gelben Quadrat.
const Glyph = ({ size }: { size: number }) => (
  <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 30.88 30.86" fill="currentColor" aria-hidden>
    <path d="M0,9.78c0-1.36.26-2.64.77-3.83.51-1.19,1.21-2.22,2.1-3.11s1.92-1.58,3.11-2.08c1.19-.51,2.46-.76,3.8-.76v9.78H0ZM0,20.29v-9.78h9.78v9.78H0ZM0,30.86v-9.78h9.78v9.78H0ZM10.54,9.78V0h9.78v9.78h-9.78ZM10.54,20.29v-9.78h9.78v9.78h-9.78ZM30.11,3.8c-.51,1.19-1.22,2.22-2.11,3.11-.89.88-1.93,1.58-3.12,2.1-1.19.51-2.46.77-3.83.77V0h9.83c0,1.35-.26,2.62-.77,3.8ZM21.05,20.29v-9.78h9.83v9.78h-9.83Z" />
  </svg>
);

const CSS = `
.nfx-auth{--fx-green:#2C3C2B;--fx-yellow:#FAD201;--fx-bg:#F6F7F2;--fx-line:#E4E7DE;--fx-ink:#1B211A;--fx-muted:#5f6b62;
  min-height:100vh;display:flex;flex-direction:column;background:var(--fx-bg);
  font-family:"Google Sans Flex",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;color:var(--fx-ink)}
.nfx-auth *{box-sizing:border-box}
.nfx-hero{position:relative;overflow:hidden;text-align:center;color:#fff;padding:34px 24px 30px;background:var(--fx-green);border-radius:0 0 22px 22px}
.nfx-glow{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(ellipse 60% 45% at 28% 8%, rgba(250,210,1,.12), transparent 60%),
             radial-gradient(ellipse 55% 45% at 85% 100%, rgba(16,185,129,.12), transparent 60%)}
.nfx-hbody{position:relative;display:flex;flex-direction:column;align-items:center}
.nfx-logo{width:64px;height:64px;border-radius:22%;background:var(--fx-yellow);color:var(--fx-green);display:grid;place-items:center}
.nfx-name{position:relative;font-size:20px;font-weight:800;letter-spacing:.3px;margin-top:14px;line-height:1}
.nfx-name span{color:var(--fx-yellow)}
.nfx-tag{position:relative;font-size:13px;color:rgba(245,243,240,.6);margin-top:10px;line-height:1.5;max-width:19rem}
.nfx-foot{position:relative;font-size:12px;color:rgba(245,243,240,.42);display:none;align-items:center;gap:8px}
.nfx-cardwrap{flex:1;display:flex;justify-content:center;padding:0 20px 28px;margin-top:18px}
.nfx-card{background:#fff;border:1px solid var(--fx-line);border-radius:14px;padding:28px;width:100%;max-width:360px;box-shadow:0 16px 40px rgba(27,33,26,.12)}
.nfx-h{font-size:23px;font-weight:800;color:var(--fx-green);margin:0}
.nfx-sub{color:var(--fx-muted);font-size:14px;margin:8px 0 20px}
.nfx-field{margin-bottom:14px}
.nfx-field>label{display:block;font-size:12px;font-weight:600;color:var(--fx-muted);margin:0 2px 6px}
.nfx-inp{display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid var(--fx-line);border-radius:11px;padding:11px 12px}
.nfx-inp:focus-within{border-color:var(--fx-green)}
.nfx-inp svg{color:#9aa39a;flex:0 0 auto}
.nfx-inp input{border:0;outline:0;background:transparent;font-size:14.5px;flex:1;font-family:inherit;color:var(--fx-ink);padding:0}
.nfx-cta{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:4px;background:var(--fx-yellow);color:var(--fx-green);
  border:0;border-radius:10px;padding:13px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit}
.nfx-cta:disabled{opacity:.55;cursor:default}
.nfx-switch{font-size:13px;color:var(--fx-muted);margin-top:16px;text-align:center}
.nfx-switch button{background:none;border:0;padding:0;cursor:pointer;color:var(--fx-green);font-weight:700;font-family:inherit;font-size:13px}
.nfx-msg{margin-top:16px;border-radius:11px;padding:11px 13px;font-size:12.5px;line-height:1.45}
.nfx-msg.err{background:#FDE8E4;border:1px solid #f3c7bf;color:#8f2c1e}
.nfx-msg.ok{background:#E7F0E8;border:1px solid #c7e0cd;color:#065f46}
.nfx-view{margin-top:16px;display:flex;align-items:center;justify-content:center;gap:7px;font-size:12.5px}
.nfx-view button{background:none;border:0;padding:0;cursor:pointer;color:var(--fx-green);font-weight:700;font-family:inherit;font-size:12.5px;text-decoration:underline;text-underline-offset:2px}
.nfx-view span{color:var(--fx-muted)}
.nfx-trust{display:flex;align-items:center;justify-content:center;gap:7px;color:var(--fx-muted);font-size:12px;margin-top:16px;border-top:1px solid rgba(0,0,0,.06);padding-top:16px}
.nfx-trust svg{color:var(--fx-green)}
@media(min-width:760px){
  .nfx-auth{flex-direction:row}
  .nfx-hero{flex:0 0 44%;border-radius:0;display:flex;flex-direction:column;justify-content:space-between;align-items:center;padding:48px}
  .nfx-hbody{flex:1;justify-content:center}
  .nfx-logo{width:80px;height:80px}
  .nfx-name{font-size:36px;margin-top:28px}
  .nfx-tag{font-size:14px;margin-top:16px}
  .nfx-foot{display:flex}
  .nfx-cardwrap{flex:1;align-items:center;margin-top:0;padding:48px;background:var(--fx-bg)}
}
`;

function LoginScreen() {
  const [mode, setMode] = React.useState<"in" | "up">("in");
  const [email, setEmail] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "err" | "ok"; text: string } | null>(null);

  const submit = async () => {
    const sb = getSupabase();
    if (!sb) { setMsg({ tone: "err", text: t("Supabase ist nicht konfiguriert.") }); return; }
    setBusy(true); setMsg(null);
    try {
      if (mode === "in") {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) throw error;
        // onAuthStateChange im Gate übernimmt den Rest (Screen verschwindet).
      } else {
        const { data, error } = await sb.auth.signUp({ email: email.trim(), password: pw });
        if (error) throw error;
        if (data.session) { /* Auto-Login (Confirm aus) → Gate wechselt selbst */ }
        else setMsg({ tone: "ok", text: t("Registriert — bitte E-Mail bestätigen, dann anmelden.") });
      }
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message ?? t("Anmeldung fehlgeschlagen.") });
    } finally { setBusy(false); }
  };

  const onKey = (e: React.KeyboardEvent) => { if (e.key === "Enter" && email && pw && !busy) submit(); };
  const goReadonly = () => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.hash = "readonly";
    window.location.href = url.toString();
    window.location.reload();
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="nfx-auth">
        {/* Marken-Panel */}
        <div className="nfx-hero">
          <div className="nfx-glow" />
          <div className="nfx-hbody">
            <span className="nfx-logo"><Glyph size={80} /></span>
            <div className="nfx-name">NEOS <span>FX</span></div>
            <div className="nfx-tag">{t("Finanz-Cockpit — planen, prüfen, entscheiden.")}</div>
          </div>
          <div className="nfx-foot">
            <span>© 2026 Neoterra Tools · powered by</span>
            <NeoterraLogo height={12} style={{ color: "rgba(245,243,240,.7)" }} />
          </div>
        </div>

        {/* Karte */}
        <div className="nfx-cardwrap">
          <div className="nfx-card">
            <h1 className="nfx-h">{mode === "in" ? t("Anmelden") : t("Konto erstellen")}</h1>
            <p className="nfx-sub">{mode === "in" ? t("Melde dich an, um fortzufahren.") : t("Registriere dich mit deiner @neoterra.ag-Adresse.")}</p>

            <div className="nfx-field">
              <label>{t("E-Mail")}</label>
              <div className="nfx-inp">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" /></svg>
                <input type="email" autoComplete="email" placeholder="name@neoterra.ag" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onKey} />
              </div>
            </div>
            <div className="nfx-field">
              <label>{t("Passwort")}</label>
              <div className="nfx-inp">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                <input type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} placeholder="••••••••" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={onKey} />
              </div>
            </div>

            <button className="nfx-cta" onClick={submit} disabled={busy || !email || !pw}>
              {busy ? "…" : (mode === "in" ? "→ " + t("Anmelden") : "→ " + t("Registrieren"))}
            </button>

            <p className="nfx-switch">
              {mode === "in"
                ? <>{t("Noch kein Konto?")} <button onClick={() => { setMode("up"); setMsg(null); }}>{t("Registrieren")}</button></>
                : <>{t("Schon registriert?")} <button onClick={() => { setMode("in"); setMsg(null); }}>{t("Anmelden")}</button></>}
            </p>

            {msg && <div className={"nfx-msg " + msg.tone}>{msg.text}</div>}

            <div className="nfx-view">
              <span>{t("Nur ansehen?")}</span>
              <button onClick={goReadonly}>{t("Betrachter-Modus öffnen")}</button>
            </div>

            <div className="nfx-trust">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
              {t("GoBD-konform · Daten in der EU")}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const configured = supabaseConfigured();
  const bypass = React.useMemo(() => readonlyRequested() || !configured, [configured]);
  const [status, setStatus] = React.useState<"loading" | "in" | "out">(bypass ? "in" : "loading");

  React.useEffect(() => {
    if (bypass) return;
    const sb = getSupabase();
    if (!sb) { setStatus("in"); return; }
    let alive = true;
    // Timeout-Guard: nie ewig im „lädt…"-Splash hängen bleiben (z. B. Netz blockiert).
    const timer = setTimeout(() => { if (alive) setStatus((s) => (s === "loading" ? "out" : s)); }, 6000);
    sb.auth.getSession().then(({ data }) => { if (alive) setStatus(data.session ? "in" : "out"); }).catch(() => { if (alive) setStatus("out"); });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => { if (alive) setStatus(session ? "in" : "out"); });
    return () => { alive = false; clearTimeout(timer); sub.subscription.unsubscribe(); };
  }, [bypass]);

  if (status === "in") return <>{children}</>;
  if (status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F6F7F2", color: "#5f6b62",
        fontFamily: '"Google Sans Flex",system-ui,-apple-system,"Segoe UI",sans-serif', fontSize: 13 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <span style={{ width: 56, height: 56, borderRadius: "22%", background: "#FAD201", color: "#2C3C2B", display: "grid", placeItems: "center" }}><Glyph size={56} /></span>
          <span>{t("Lädt …")}</span>
        </div>
      </div>
    );
  }
  return <LoginScreen />;
}
