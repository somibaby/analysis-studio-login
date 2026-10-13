-- Analysis Studio database. Paste into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.

-- Projects: one row per project per user; the worksheet lives in `cols` (JSON).
create table if not exists public.projects (
  user_id  uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id       text   not null,
  name     text   not null default '',
  color    text   not null default '#6D4AFF',
  cols     jsonb  not null default '[]'::jsonb,
  updated  bigint not null default 0,          -- ms since epoch, set by the app (last change wins)
  primary key (user_id, id)
);

-- Pinned results: used for the scheduled PDF reports.
create table if not exists public.pins (
  user_id      uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  id           text   not null,
  project_id   text   not null,
  project_name text   not null default '',
  title        text   not null,
  cat          text   not null default '',
  verdict      text   not null default '',
  vcls         text   not null default 'info',
  tables       jsonb  not null default '[]'::jsonb,
  notes        jsonb  not null default '[]'::jsonb,
  created      bigint not null default 0,
  primary key (user_id, id)
);

-- One row per user: where and how often to email the report.
create table if not exists public.report_settings (
  user_id   uuid   primary key default auth.uid() references auth.users (id) on delete cascade,
  email     text   not null default '',
  frequency text   not null default 'off' check (frequency in ('off', 'weekly', 'monthly')),
  last_sent bigint not null default 0
);

-- Row-level security: every user can only ever see and change their own rows.
alter table public.projects        enable row level security;
alter table public.pins            enable row level security;
alter table public.report_settings enable row level security;

drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own pins" on public.pins;
create policy "own pins" on public.pins for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "own report settings" on public.report_settings;
create policy "own report settings" on public.report_settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Live updates between devices.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects') then
    alter publication supabase_realtime add table public.projects;
  end if;
end $$;
