import { supabaseFnBase, supabaseAnonKey } from "./supabaseClient";

/** Ergebnis des ANAF-CUI-Lookups (via Supabase Edge Function „anaf-cui", CORS-Proxy). */
export type AnafResult = {
  found: boolean;
  cui?: string;
  denumire?: string;      // Firmenname
  adresa?: string;        // Sitz-Adresse
  nrRegCom?: string;      // Handelsregister-Nr.
  scpTVA?: boolean;       // USt-/TVA-pflichtig
  stareInregistrare?: string;
  data?: string;
  error?: string;
};

/** Fragt eine rumänische CUI/CIF über die öffentliche ANAF-API ab (kostenlos, kein Key).
 *  Der Aufruf läuft über die Supabase Edge Function, weil ANAF im Browser an CORS scheitert. */
export async function lookupCui(cui: string, signal?: AbortSignal): Promise<AnafResult> {
  const digits = String(cui ?? "").replace(/\D/g, "");
  if (!digits) return { found: false, error: "CUI fehlt" };
  try {
    const key = supabaseAnonKey();
    const res = await fetch(`${supabaseFnBase()}/anaf-cui`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ cui: digits }),
      signal,
    });
    const body = await res.json().catch(() => ({} as AnafResult));
    if (!res.ok) return { found: false, error: (body as AnafResult)?.error ?? `HTTP ${res.status}` };
    return body as AnafResult;
  } catch (e) {
    return { found: false, error: (e as Error)?.message ?? "Netzwerkfehler" };
  }
}
