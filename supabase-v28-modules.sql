-- VisuPlanner v28: administratorforbedringer, Ugeopgaver og VisuPlanner Speak.
-- Kan køres efter den rettede v26-opdatering. Eksisterende tavledata bevares.
begin;

alter table public.teams_registry add column if not exists archived_at timestamptz;
alter table public.staff add column if not exists audio_url text;
alter table public.day_plans add column if not exists breakfast_audio_url text;
alter table public.day_plans add column if not exists lunch_audio_url text;
alter table public.day_plans add column if not exists dinner_audio_url text;
alter table public.activities add column if not exists audio_url text;
alter table public.team_settings add column if not exists tasks_enabled boolean not null default false;
alter table public.team_settings add column if not exists speak_enabled boolean not null default false;
alter table public.team_settings add column if not exists task_rotation_start date;
update public.team_settings set task_rotation_start=date_trunc('week',current_date)::date where task_rotation_start is null;
create or replace function public.current_team_slug()
returns text language sql stable security definer set search_path=public
as $$ select slug from public.teams_registry where archived_at is null and (editor_user_id=auth.uid() or viewer_user_id=auth.uid()) limit 1 $$;
create or replace function public.can_edit_team(team_slug text)
returns boolean language sql stable security definer set search_path=public
as $$ select public.is_visuplanner_admin() or exists(select 1 from public.teams_registry where slug=$1 and archived_at is null and editor_user_id=auth.uid()) $$;

create table if not exists public.team_residents(
  id uuid primary key default gen_random_uuid(),
  team_slug text not null references public.teams_registry(slug) on update cascade on delete cascade,
  name text not null check(char_length(trim(name)) between 1 and 80),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(team_slug,name)
);
create table if not exists public.team_tasks(
  id uuid primary key default gen_random_uuid(),
  team_slug text not null references public.teams_registry(slug) on update cascade on delete cascade,
  name text not null check(char_length(trim(name)) between 1 and 120),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(team_slug,name)
);
create index if not exists team_residents_team_idx on public.team_residents(team_slug,sort_order);
create index if not exists team_tasks_team_idx on public.team_tasks(team_slug,sort_order);
alter table public.team_residents enable row level security;
alter table public.team_tasks enable row level security;

drop policy if exists tenant_residents_read on public.team_residents;
drop policy if exists tenant_residents_write on public.team_residents;
drop policy if exists tenant_tasks_read on public.team_tasks;
drop policy if exists tenant_tasks_write on public.team_tasks;
create policy tenant_residents_read on public.team_residents for select to authenticated using(public.can_view_team(team_slug));
create policy tenant_residents_write on public.team_residents for all to authenticated using(public.can_edit_team(team_slug)) with check(public.can_edit_team(team_slug));
create policy tenant_tasks_read on public.team_tasks for select to authenticated using(public.can_view_team(team_slug));
create policy tenant_tasks_write on public.team_tasks for all to authenticated using(public.can_edit_team(team_slug)) with check(public.can_edit_team(team_slug));
grant select,insert,update,delete on public.team_residents to authenticated;
grant select,insert,update,delete on public.team_tasks to authenticated;

commit;
