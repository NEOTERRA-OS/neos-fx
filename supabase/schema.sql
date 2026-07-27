-- NEOS FX — Supabase-Schema (Persistenz), namespaced mit Präfix neos_fx_
-- Ansatz (Architekturplan §6): typisierte Domäne als JSONB + Snapshots + Audit + RLS-Rollen.
-- In der Supabase-SQL-Konsole ausführen (oder via MCP als Migration).

create extension if not exists "pgcrypto";

create table if not exists public.neos_fx_models (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  reporting_currency text not null default 'EUR',
  domain             jsonb not null,
  owner              uuid not null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.neos_fx_snapshots (
  id         uuid primary key default gen_random_uuid(),
  model_id   uuid not null references public.neos_fx_models(id) on delete cascade,
  label      text not null,
  domain     jsonb not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_neos_fx_snap on public.neos_fx_snapshots(model_id, created_at desc);

create table if not exists public.neos_fx_audit (
  id       uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.neos_fx_models(id) on delete cascade,
  action   text not null,
  detail   jsonb not null default '{}',
  actor    uuid default auth.uid(),
  at       timestamptz not null default now()
);
create index if not exists idx_neos_fx_audit on public.neos_fx_audit(model_id, at desc);

create table if not exists public.neos_fx_members (
  model_id uuid not null references public.neos_fx_models(id) on delete cascade,
  user_id  uuid not null default auth.uid(),
  role     text not null check (role in ('owner','editor','viewer')),
  primary key (model_id, user_id)
);

create or replace function public.neos_fx_add_owner() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.neos_fx_members(model_id, user_id, role) values (new.id, new.owner, 'owner')
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_neos_fx_owner on public.neos_fx_models;
create trigger trg_neos_fx_owner after insert on public.neos_fx_models
  for each row execute function public.neos_fx_add_owner();

create or replace function public.neos_fx_touch() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_neos_fx_touch on public.neos_fx_models;
create trigger trg_neos_fx_touch before update on public.neos_fx_models
  for each row execute function public.neos_fx_touch();

alter table public.neos_fx_models    enable row level security;
alter table public.neos_fx_snapshots enable row level security;
alter table public.neos_fx_audit     enable row level security;
alter table public.neos_fx_members   enable row level security;

create or replace function public.neos_fx_is_member(m uuid, min_role text default 'viewer')
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.neos_fx_members mm
    where mm.model_id = m and mm.user_id = auth.uid()
      and case min_role
        when 'viewer' then true
        when 'editor' then mm.role in ('editor','owner')
        when 'owner'  then mm.role = 'owner'
        else false end
  );
$$;

drop policy if exists nfx_models_select on public.neos_fx_models;
drop policy if exists nfx_models_insert on public.neos_fx_models;
drop policy if exists nfx_models_update on public.neos_fx_models;
drop policy if exists nfx_models_delete on public.neos_fx_models;
create policy nfx_models_select on public.neos_fx_models for select using (public.neos_fx_is_member(id));
create policy nfx_models_insert on public.neos_fx_models for insert with check (owner = auth.uid());
create policy nfx_models_update on public.neos_fx_models for update using (public.neos_fx_is_member(id,'editor'));
create policy nfx_models_delete on public.neos_fx_models for delete using (public.neos_fx_is_member(id,'owner'));

drop policy if exists nfx_snap_select on public.neos_fx_snapshots;
drop policy if exists nfx_snap_insert on public.neos_fx_snapshots;
create policy nfx_snap_select on public.neos_fx_snapshots for select using (public.neos_fx_is_member(model_id));
create policy nfx_snap_insert on public.neos_fx_snapshots for insert with check (public.neos_fx_is_member(model_id,'editor'));

drop policy if exists nfx_audit_select on public.neos_fx_audit;
drop policy if exists nfx_audit_insert on public.neos_fx_audit;
create policy nfx_audit_select on public.neos_fx_audit for select using (public.neos_fx_is_member(model_id));
create policy nfx_audit_insert on public.neos_fx_audit for insert with check (public.neos_fx_is_member(model_id,'editor'));

drop policy if exists nfx_mem_select on public.neos_fx_members;
drop policy if exists nfx_mem_all on public.neos_fx_members;
create policy nfx_mem_select on public.neos_fx_members for select using (public.neos_fx_is_member(model_id));
create policy nfx_mem_all    on public.neos_fx_members for all    using (public.neos_fx_is_member(model_id,'owner')) with check (public.neos_fx_is_member(model_id,'owner'));
