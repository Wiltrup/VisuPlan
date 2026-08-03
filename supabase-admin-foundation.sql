-- VisuPlanner administratorfundament, version 1
-- Kør én gang efter at wiltrup@wiltrup.com er oprettet og bekræftet i Authentication.
-- Scriptet sletter ikke ugeplaner, billeder eller medarbejdere.

create table if not exists public.teams_registry (
  slug text primary key,
  name text not null,
  municipality text not null,
  workplace text not null,
  recovery_email text not null,
  editor_user_id uuid references auth.users(id) on delete set null,
  viewer_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.teams_registry (slug,name,municipality,workplace,recovery_email,editor_user_id,viewer_user_id)
select 'team-2','Team 2','Halsnæs Kommune','Center for Botilbud og Beskæftigelse – Trekløveret','wiltrup@wiltrup.com',
  (select id from auth.users where email='team2@visuplanner.invalid' limit 1),
  (select id from auth.users where email='team2-viewer@visuplanner.invalid' limit 1)
on conflict (slug) do update set recovery_email=excluded.recovery_email,
  editor_user_id=coalesce(excluded.editor_user_id,public.teams_registry.editor_user_id),
  viewer_user_id=coalesce(excluded.viewer_user_id,public.teams_registry.viewer_user_id),updated_at=now();

insert into public.platform_admins(user_id)
select id from auth.users where email='wiltrup@wiltrup.com'
on conflict (user_id) do nothing;

alter table public.teams_registry enable row level security;
alter table public.platform_admins enable row level security;
revoke all on public.teams_registry, public.platform_admins from anon;
grant select on public.teams_registry, public.platform_admins to authenticated;

create or replace function public.is_visuplanner_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.platform_admins where user_id=auth.uid()) $$;

create or replace function public.can_edit_team(team_slug text)
returns boolean language sql stable security definer set search_path=public
as $$ select public.is_visuplanner_admin() or exists(select 1 from public.teams_registry where slug=team_slug and editor_user_id=auth.uid()) $$;

drop policy if exists teams_registry_admin_read on public.teams_registry;
drop policy if exists platform_admins_self_read on public.platform_admins;
create policy teams_registry_admin_read on public.teams_registry for select to authenticated using (public.is_visuplanner_admin());
create policy platform_admins_self_read on public.platform_admins for select to authenticated using (user_id=auth.uid());

-- Udskift kun skriverettighederne; alle korrekt indloggede Team 2-enheder beholder læseretten.
do $$ declare p record; begin
  for p in select schemaname,tablename,policyname from pg_policies
    where schemaname='public' and tablename in ('staff','day_plans','shifts','activities','team_settings') and cmd<>'SELECT'
  loop execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename); end loop;
end $$;

create policy visuplanner_team2_write_staff on public.staff for all to authenticated using (public.can_edit_team('team-2')) with check (public.can_edit_team('team-2'));
create policy visuplanner_team2_write_day_plans on public.day_plans for all to authenticated using (public.can_edit_team('team-2')) with check (public.can_edit_team('team-2'));
create policy visuplanner_team2_write_shifts on public.shifts for all to authenticated using (public.can_edit_team('team-2')) with check (public.can_edit_team('team-2'));
create policy visuplanner_team2_write_activities on public.activities for all to authenticated using (public.can_edit_team('team-2')) with check (public.can_edit_team('team-2'));
create policy visuplanner_team2_write_settings on public.team_settings for all to authenticated using (public.can_edit_team('team-2')) with check (public.can_edit_team('team-2'));

drop policy if exists visuplanner_staff_insert_images on storage.objects;
drop policy if exists visuplanner_staff_update_images on storage.objects;
drop policy if exists visuplanner_staff_delete_images on storage.objects;
drop policy if exists visuplanner_team2_insert_images on storage.objects;
drop policy if exists visuplanner_team2_update_images on storage.objects;
drop policy if exists visuplanner_team2_delete_images on storage.objects;
create policy visuplanner_team2_insert_images on storage.objects for insert to authenticated with check (bucket_id='visuplan-images' and public.can_edit_team('team-2'));
create policy visuplanner_team2_update_images on storage.objects for update to authenticated using (bucket_id='visuplan-images' and public.can_edit_team('team-2')) with check (bucket_id='visuplan-images' and public.can_edit_team('team-2'));
create policy visuplanner_team2_delete_images on storage.objects for delete to authenticated using (bucket_id='visuplan-images' and public.can_edit_team('team-2'));
