import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Lazy Supabase-Client. Env (Next.js) überschreibt; sonst fest verdrahtetes Team-Projekt
 *  „neos-fx" (eu-central-1) — damit funktioniert Auto-Save/Auto-Load auch im Single-File-Build.
 *  persistSession: true → Team-Login bleibt bestehen (gehostet: localStorage; Sandbox: In-Memory-
 *  Fallback, damit nichts crasht). */
const TEAM_URL = "https://gmuhuuggvdqckszbxnfu.supabase.co";
const TEAM_KEY = "sb_publishable__xwqtp8wClu51ZT7v1fXug_CvztwXeR";
const env = (k: string): string | undefined => {
  try { return (process as any)?.env?.[k]; } catch { return undefined; }
};

/** Sandbox-sicherer Session-Speicher: localStorage, wenn nutzbar, sonst In-Memory (kein Crash). */
const memStore = (() => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; })();
function safeStorage() {
  try {
    if (typeof window === "undefined") return memStore;
    const k = "__nfx_ls_test"; window.localStorage.setItem(k, "1"); window.localStorage.removeItem(k);
    return window.localStorage;
  } catch { return memStore; }
}

let _client: SupabaseClient | null | undefined;

export function supabaseConfigured(): boolean {
  return !!((env("NEXT_PUBLIC_SUPABASE_URL") && env("NEXT_PUBLIC_SUPABASE_ANON_KEY")) || (TEAM_URL && TEAM_KEY));
}

/** Projekt-Basis-URL (ohne Pfad). Für Diagnose-Pings (z. B. Auth-Health-Check im Login). */
export function supabaseBaseUrl(): string {
  return env("NEXT_PUBLIC_SUPABASE_URL") ?? TEAM_URL;
}

/** Basis-URL der Edge Functions (…/functions/v1). Für direkte fetch-Aufrufe (z. B. ANAF-Proxy). */
export function supabaseFnBase(): string {
  return (env("NEXT_PUBLIC_SUPABASE_URL") ?? TEAM_URL) + "/functions/v1";
}
/** Publishable/Anon-Key für den apikey/Authorization-Header. */
export function supabaseAnonKey(): string {
  return env("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? TEAM_KEY;
}

export function getSupabase(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  const url = env("NEXT_PUBLIC_SUPABASE_URL") ?? TEAM_URL;
  const key = env("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? TEAM_KEY;
  _client = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storage: safeStorage() } }) : null;
  return _client;
}
