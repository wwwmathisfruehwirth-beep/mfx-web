-- MFX Prototyp: Datenbank einrichten
-- In Supabase: links "SQL Editor" öffnen, diesen ganzen Text einfügen und "Run" drücken.

-- 1) Persönliche Daten (Journal, Trades, Reviews). Jeder sieht nur seine eigenen Zeilen.
create table if not exists public.docs (
  path text primary key,
  parent text not null,
  owner uuid not null default auth.uid(),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists docs_parent_idx on public.docs (parent);
alter table public.docs enable row level security;

drop policy if exists "docs_select_own" on public.docs;
drop policy if exists "docs_insert_own" on public.docs;
drop policy if exists "docs_update_own" on public.docs;
drop policy if exists "docs_delete_own" on public.docs;
create policy "docs_select_own" on public.docs for select to authenticated
  using (owner = auth.uid());
create policy "docs_insert_own" on public.docs for insert to authenticated
  with check (owner = auth.uid() and path like ('data/users/' || auth.uid()::text || '/%'));
create policy "docs_update_own" on public.docs for update to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid() and path like ('data/users/' || auth.uid()::text || '/%'));
create policy "docs_delete_own" on public.docs for delete to authenticated
  using (owner = auth.uid());

-- 2) Gemeinsame Daten für alle (z. B. spätere automatische Auswertungen). Lesen ja, schreiben nur der Server.
create table if not exists public.shared_docs (
  path text primary key,
  parent text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists shared_docs_parent_idx on public.shared_docs (parent);
alter table public.shared_docs enable row level security;
drop policy if exists "shared_read" on public.shared_docs;
create policy "shared_read" on public.shared_docs for select to authenticated using (true);

-- 3) Zwischenspeicher für Kurse und Suchen (nur der Server greift darauf zu)
create table if not exists public.api_cache (
  key text primary key,
  body jsonb,
  at timestamptz not null default now()
);
alter table public.api_cache enable row level security;

-- 4) KI-Verbrauch pro Person und Tag (nur der Server)
create table if not exists public.ai_usage (
  user_id uuid not null,
  day date not null,
  calls int not null default 0,
  in_tokens bigint not null default 0,
  out_tokens bigint not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;

create or replace function public.ai_take(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into ai_usage (user_id, day, calls) values (p_user, (now() at time zone 'Europe/Berlin')::date, 1)
  on conflict (user_id, day) do update set calls = ai_usage.calls + 1
  returning calls into n;
  return n;
end $$;

create or replace function public.ai_tokens(p_user uuid, p_in int, p_out int) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into ai_usage (user_id, day, in_tokens, out_tokens) values (p_user, (now() at time zone 'Europe/Berlin')::date, p_in, p_out)
  on conflict (user_id, day) do update set in_tokens = ai_usage.in_tokens + p_in, out_tokens = ai_usage.out_tokens + p_out;
end $$;

revoke all on function public.ai_take(uuid) from public, anon, authenticated;
revoke all on function public.ai_tokens(uuid, int, int) from public, anon, authenticated;
grant execute on function public.ai_take(uuid) to service_role;
grant execute on function public.ai_tokens(uuid, int, int) to service_role;

-- Übersicht für dich: KI-Verbrauch der letzten Tage (im SQL Editor ausführen)
-- select day, count(*) as personen, sum(calls) as anfragen, sum(in_tokens) as eingabe, sum(out_tokens) as ausgabe
-- from ai_usage group by day order by day desc limit 14;
