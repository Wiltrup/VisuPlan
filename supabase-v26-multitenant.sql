-- VisuPlanner v26: komplet teamadskillelse og specifikke teamadresser.
-- Kør én gang EFTER at v26-filerne er lagt på GitHub/Vercel.
-- Eksisterende Team 2-data bevares og flyttes til trekloeveret-team-2.

begin;

alter table public.teams_registry add column if not exists onboarding_status text not null default 'active';
alter table public.teams_registry add column if not exists activated_at timestamptz;
create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_slug text not null references public.teams_registry(slug) on delete cascade,
  token_hash text not null unique,
  contact_email text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists team_invitations_team_slug_idx on public.team_invitations(team_slug);
alter table public.team_invitations enable row level security;
revoke all on public.team_invitations from anon, authenticated;
grant select on public.team_invitations to authenticated;
drop policy if exists team_invitations_admin_read on public.team_invitations;
create policy team_invitations_admin_read on public.team_invitations for select to authenticated using(public.is_visuplanner_admin());

-- Gør Team 2's permanente adresse specifik uden at miste eksisterende data.
alter table if exists public.team_invitations drop constraint if exists team_invitations_team_slug_fkey;
update public.access_help_requests set team_slug='trekloeveret-team-2' where team_slug='team-2';
update public.team_invitations set team_slug='trekloeveret-team-2' where team_slug='team-2';
update public.teams_registry set slug='trekloeveret-team-2', updated_at=now() where slug='team-2';
alter table public.team_invitations add constraint team_invitations_team_slug_fkey foreign key(team_slug) references public.teams_registry(slug) on update cascade on delete cascade;

alter table public.staff add column if not exists team_slug text;
alter table public.day_plans add column if not exists team_slug text;
alter table public.shifts add column if not exists team_slug text;
alter table public.activities add column if not exists team_slug text;
alter table public.team_settings add column if not exists team_slug text;

update public.staff set team_slug='trekloeveret-team-2' where team_slug is null or team_slug='team-2';
update public.day_plans set team_slug='trekloeveret-team-2' where team_slug is null or team_slug='team-2';
update public.shifts set team_slug='trekloeveret-team-2' where team_slug is null or team_slug='team-2';
update public.activities set team_slug='trekloeveret-team-2' where team_slug is null or team_slug='team-2';
update public.team_settings set team_slug='trekloeveret-team-2', id='trekloeveret-team-2' where team_slug is null or team_slug='team-2';

alter table public.staff alter column team_slug set not null;
alter table public.day_plans alter column team_slug set not null;
alter table public.shifts alter column team_slug set not null;
alter table public.activities alter column team_slug set not null;
alter table public.team_settings alter column team_slug set not null;

-- En dato må gentages på tværs af teams, men kun én gang inden for samme team.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.day_plans'::regclass and contype='u'
    and pg_get_constraintdef(oid) ilike '%(plan_date)%'
  loop execute format('alter table public.day_plans drop constraint %I',c.conname); end loop;
end $$;
create unique index if not exists day_plans_team_date_uidx on public.day_plans(team_slug,plan_date);
create unique index if not exists team_settings_team_slug_uidx on public.team_settings(team_slug);
create index if not exists staff_team_slug_idx on public.staff(team_slug);
create index if not exists shifts_team_date_idx on public.shifts(team_slug,plan_date);
create index if not exists activities_team_date_idx on public.activities(team_slug,plan_date);

alter table public.staff drop constraint if exists staff_team_slug_fkey;
alter table public.day_plans drop constraint if exists day_plans_team_slug_fkey;
alter table public.shifts drop constraint if exists shifts_team_slug_fkey;
alter table public.activities drop constraint if exists activities_team_slug_fkey;
alter table public.team_settings drop constraint if exists team_settings_team_slug_fkey;
alter table public.staff add constraint staff_team_slug_fkey foreign key(team_slug) references public.teams_registry(slug) on update cascade on delete cascade;
alter table public.day_plans add constraint day_plans_team_slug_fkey foreign key(team_slug) references public.teams_registry(slug) on update cascade on delete cascade;
alter table public.shifts add constraint shifts_team_slug_fkey foreign key(team_slug) references public.teams_registry(slug) on update cascade on delete cascade;
alter table public.activities add constraint activities_team_slug_fkey foreign key(team_slug) references public.teams_registry(slug) on update cascade on delete cascade;
alter table public.team_settings add constraint team_settings_team_slug_fkey foreign key(team_slug) references public.teams_registry(slug) on update cascade on delete cascade;

create or replace function public.current_team_slug()
returns text language sql stable security definer set search_path=public
as $$ select slug from public.teams_registry where editor_user_id=auth.uid() or viewer_user_id=auth.uid() limit 1 $$;
create or replace function public.can_view_team(wanted text)
returns boolean language sql stable security definer set search_path=public
as $$ select public.is_visuplanner_admin() or wanted=public.current_team_slug() $$;
-- Behold parameternavnet fra den eksisterende v20/v21-funktion. PostgreSQL
-- tillader ikke, at CREATE OR REPLACE omdøber et inputparameter-navn.
create or replace function public.can_edit_team(team_slug text)
returns boolean language sql stable security definer set search_path=public
as $$ select public.is_visuplanner_admin() or exists(select 1 from public.teams_registry where slug=$1 and editor_user_id=auth.uid()) $$;

do $$ declare p record; begin
  for p in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in ('staff','day_plans','shifts','activities','team_settings')
  loop execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename); end loop;
end $$;

create policy tenant_staff_read on public.staff for select to authenticated using(public.can_view_team(team_slug));
create policy tenant_staff_write on public.staff for all to authenticated using(public.can_edit_team(team_slug)) with check(public.can_edit_team(team_slug));
create policy tenant_plans_read on public.day_plans for select to authenticated using(public.can_view_team(team_slug));
create policy tenant_plans_write on public.day_plans for all to authenticated using(public.can_edit_team(team_slug)) with check(public.can_edit_team(team_slug));
create policy tenant_shifts_read on public.shifts for select to authenticated using(public.can_view_team(team_slug));
create policy tenant_shifts_write on public.shifts for all to authenticated using(public.can_edit_team(team_slug)) with check(public.can_edit_team(team_slug));
create policy tenant_activities_read on public.activities for select to authenticated using(public.can_view_team(team_slug));
create policy tenant_activities_write on public.activities for all to authenticated using(public.can_edit_team(team_slug)) with check(public.can_edit_team(team_slug));
create policy tenant_settings_read on public.team_settings for select to authenticated using(public.can_view_team(team_slug));
create policy tenant_settings_write on public.team_settings for all to authenticated using(public.can_edit_team(team_slug)) with check(public.can_edit_team(team_slug));

-- Fjern kun VisuPlanners egne tidligere billedpolitikker. Andre buckets og
-- andre projekters Storage-politikker i samme Supabase-projekt bevares.
drop policy if exists visuplanner_authenticated_read_images on storage.objects;
drop policy if exists visuplanner_staff_insert_images on storage.objects;
drop policy if exists visuplanner_staff_update_images on storage.objects;
drop policy if exists visuplanner_staff_delete_images on storage.objects;
drop policy if exists visuplanner_team2_insert_images on storage.objects;
drop policy if exists visuplanner_team2_update_images on storage.objects;
drop policy if exists visuplanner_team2_delete_images on storage.objects;
drop policy if exists tenant_images_read on storage.objects;
drop policy if exists tenant_images_insert on storage.objects;
drop policy if exists tenant_images_update on storage.objects;
drop policy if exists tenant_images_delete on storage.objects;
create policy tenant_images_read on storage.objects for select to authenticated
  using(bucket_id='visuplan-images' and (public.can_view_team((storage.foldername(name))[1]) or (public.current_team_slug()='trekloeveret-team-2' and (storage.foldername(name))[1] in ('staff','meals','activities'))));
create policy tenant_images_insert on storage.objects for insert to authenticated
  with check(bucket_id='visuplan-images' and public.can_edit_team((storage.foldername(name))[1]));
create policy tenant_images_update on storage.objects for update to authenticated
  using(bucket_id='visuplan-images' and public.can_edit_team((storage.foldername(name))[1]))
  with check(bucket_id='visuplan-images' and public.can_edit_team((storage.foldername(name))[1]));
create policy tenant_images_delete on storage.objects for delete to authenticated
  using(bucket_id='visuplan-images' and public.can_edit_team((storage.foldername(name))[1]));

-- Opdatér rollerne på Team 2's to eksisterende loginbrugere.
update auth.users u set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('role','editor','team_slug','trekloeveret-team-2')
from public.teams_registry t where t.slug='trekloeveret-team-2' and u.id=t.editor_user_id;
update auth.users u set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('role','viewer','team_slug','trekloeveret-team-2')
from public.teams_registry t where t.slug='trekloeveret-team-2' and u.id=t.viewer_user_id;

commit;
