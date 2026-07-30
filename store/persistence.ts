import { getSupabase, supabaseConfigured } from "../lib/supabaseClient";
import { migrateDomain, type Domain } from "./model";

/** Persistenz: Domäne als JSONB in Supabase (models/model_snapshots/audit_log, RLS),
 *  plus JSON-Export/Import als immer-verfügbarer Offline-Fallback. */

export type ModelRow = { id: string; name: string; updated_at: string };
export type SnapshotRow = { id: string; label: string; created_at: string };
export type AuditRow = { id: string; action: string; detail: any; at: string };

function client() {
  const c = getSupabase();
  if (!c) throw new Error("Supabase nicht konfiguriert — NEXT_PUBLIC_SUPABASE_URL/ANON_KEY in .env.local setzen.");
  return c;
}
export { supabaseConfigured };

/** Stärkste Rolle des eingeloggten Nutzers über alle Modelle (owner > editor > viewer).
 *  viewer → App schaltet in den Betrachter-Modus (Schreibzugriffe blockiert die RLS ohnehin). */
export async function getMyMaxRole(): Promise<"owner" | "editor" | "viewer" | null> {
  const c = getSupabase(); if (!c) return null;
  const { data: u } = await c.auth.getUser();
  const uid = u.user?.id; if (!uid) return null;
  const { data, error } = await c.from("neos_fx_members").select("role").eq("user_id", uid);
  if (error || !data) return null;
  const roles = data.map((r) => r.role as string);
  return roles.includes("owner") ? "owner" : roles.includes("editor") ? "editor" : roles.includes("viewer") ? "viewer" : null;
}

/* ---- Supabase CRUD ---- */
export async function listModels(): Promise<ModelRow[]> {
  const { data, error } = await client().from("neos_fx_models").select("id,name,updated_at").order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function saveModel(domain: Domain, id?: string): Promise<string> {
  const row = { name: domain.meta.name, reporting_currency: domain.meta.reportingCurrency, domain };
  const c = client();
  if (id) {
    const { error } = await c.from("neos_fx_models").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    await logAudit(id, "save", { name: domain.meta.name });
    return id;
  }
  const { data, error } = await c.from("neos_fx_models").insert(row).select("id").single();
  if (error) throw error;
  await logAudit(data.id, "create", { name: domain.meta.name });
  return data.id as string;
}

export async function loadModel(id: string): Promise<{ name: string; domain: Domain }> {
  const { data, error } = await client().from("neos_fx_models").select("name,domain").eq("id", id).single();
  if (error) throw error;
  return { name: data.name, domain: migrateDomain(data.domain as Domain) };
}

export async function createSnapshot(modelId: string, label: string, domain: Domain): Promise<void> {
  const { error } = await client().from("neos_fx_snapshots").insert({ model_id: modelId, label, domain });
  if (error) throw error;
  await logAudit(modelId, "snapshot", { label });
}

export async function listSnapshots(modelId: string): Promise<SnapshotRow[]> {
  const { data, error } = await client().from("neos_fx_snapshots").select("id,label,created_at").eq("model_id", modelId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Snapshot-Domäne NUR lesen (ohne Audit-Eintrag) — für den Versions-Vergleich. */
export async function fetchSnapshotDomain(snapshotId: string): Promise<Domain> {
  const { data, error } = await client().from("neos_fx_snapshots").select("domain").eq("id", snapshotId).single();
  if (error) throw error;
  return data.domain as Domain;
}

export async function restoreSnapshot(snapshotId: string): Promise<Domain> {
  const { data, error } = await client().from("neos_fx_snapshots").select("domain,model_id").eq("id", snapshotId).single();
  if (error) throw error;
  await logAudit(data.model_id, "restore", { snapshotId });
  return migrateDomain(data.domain as Domain);
}

export async function listAudit(modelId: string): Promise<AuditRow[]> {
  const { data, error } = await client().from("neos_fx_audit").select("id,action,detail,at").eq("model_id", modelId).order("at", { ascending: false }).limit(50);
  if (error) throw error;
  return data ?? [];
}

export async function logAudit(modelId: string, action: string, detail?: any): Promise<void> {
  const c = getSupabase();
  if (!c) return;
  await c.from("neos_fx_audit").insert({ model_id: modelId, action, detail: detail ?? {} });
}

/* ---- Auto-Save / Auto-Load (fester Team-Slot, kein localStorage nötig) ----
 *  Slot = Modellzeile mit name 'AUTOSAVE'. Beim Start lädt die App den jüngsten Stand,
 *  danach schreibt sie jede Änderung entprellt zurück → Eingaben überleben App-Updates. */
const AUTOSAVE_NAME = "AUTOSAVE";
let _autoId: string | null = null;

export async function autoLoadLatest(): Promise<Domain | null> {
  const c = getSupabase();
  if (!c) return null;
  const { data, error } = await c.from("neos_fx_models")
    .select("id,domain").eq("name", AUTOSAVE_NAME)
    .order("updated_at", { ascending: false }).limit(1);
  if (error || !data?.length) return null;
  _autoId = data[0].id as string;
  const d = data[0].domain as Domain;
  return d && (d as any).catalog && (d as any).anbauplan ? migrateDomain(d) : null;
}

export async function autoSave(domain: Domain): Promise<void> {
  const c = getSupabase();
  if (!c) return;
  const row = { name: AUTOSAVE_NAME, reporting_currency: domain.meta.reportingCurrency, domain, updated_at: new Date().toISOString() };
  if (_autoId) {
    const { error } = await c.from("neos_fx_models").update(row).eq("id", _autoId);
    if (!error) return;
    _autoId = null; // Zeile weg? → neu anlegen
  }
  const { data, error } = await c.from("neos_fx_models").insert(row).select("id").single();
  if (error) throw error;
  _autoId = (data?.id as string) ?? null;
}

/* ---- Lokaler Auto-Save (Browser-Speicher, ohne Anmeldung/Cloud) ----
 *  Zweck: Das Modell lässt sich vollständig lokal nutzen (Einzeldatei, Betrachter-/Offline-Modus).
 *  Der Stand überlebt Reload und Browser-Neustart auf DIESEM Rechner in DIESEM Browser.
 *  Kein Ersatz für die Team-Cloud: keine Freigabe, keine Historie, kein Audit-Trail. */
const LOCAL_KEY = "neos_fx_autosave_v1";
const LOCAL_AT = "neos_fx_autosave_at";

function ls(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const k = "__nfx_ls_probe"; window.localStorage.setItem(k, "1"); window.localStorage.removeItem(k);
    return window.localStorage;
  } catch { return null; }
}

/** Lokal sichern. true = geschrieben, false = nicht verfügbar/Speicher voll. */
export function localSave(domain: Domain): boolean {
  const s = ls();
  if (!s) return false;
  try {
    s.setItem(LOCAL_KEY, JSON.stringify(domain));
    s.setItem(LOCAL_AT, new Date().toISOString());
    return true;
  } catch { return false; }
}

/** Zuletzt lokal gesicherten Stand laden (null, wenn keiner/ungültig). */
export function localLoad(): Domain | null {
  const s = ls();
  if (!s) return null;
  try {
    const raw = s.getItem(LOCAL_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !d.catalog || !d.anbauplan || !d.assumptions) return null;
    return migrateDomain(d as Domain);
  } catch { return null; }
}

/** Zeitstempel des lokalen Stands (ISO) oder null. */
export function localSavedAt(): string | null {
  try { return ls()?.getItem(LOCAL_AT) ?? null; } catch { return null; }
}

/** Lokalen Stand verwerfen. */
export function localClear(): void {
  try { const s = ls(); s?.removeItem(LOCAL_KEY); s?.removeItem(LOCAL_AT); } catch { /* egal */ }
}

/* ---- JSON-Fallback (immer verfügbar) ---- */
export function domainToJson(domain: Domain): string {
  return JSON.stringify(domain, null, 2);
}
export function jsonToDomain(text: string): Domain {
  const d = JSON.parse(text);
  if (!d || !d.catalog || !d.anbauplan || !d.assumptions) throw new Error("Kein gültiges NEOS-FX-Modell (Domain).");
  return migrateDomain(d as Domain);
}
export function downloadDomain(domain: Domain) {
  const blob = new Blob([domainToJson(domain)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(domain.meta.name || "neos-fx-modell").replace(/\s+/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
