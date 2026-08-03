-- VisuPlanner: fælles beboerlogin + personalerettigheder
-- Kør hele filen én gang i Supabase SQL Editor EFTER den nye app er lagt på Vercel.
-- Scriptet sletter ikke ugeplaner, medarbejdere eller billeder.

alter table public.staff enable row level security;
alter table public.day_plans enable row level security;
alter table public.shifts enable row level security;
alter table public.activities enable row level security;
alter table public.team_settings enable row level security;

-- Fjern tidligere policies, så en gammel offentlig policy ikke efterlader data åbne.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('staff','day_plans','shifts','activities','team_settings')
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

revoke all on public.staff, public.day_plans, public.shifts, public.activities, public.team_settings from anon;
grant select, insert, update, delete on public.staff, public.day_plans, public.shifts, public.activities, public.team_settings to authenticated;

-- Alle korrekt indloggede Team 2-brugere må se tavlen.
create policy visuplanner_authenticated_read_staff on public.staff for select to authenticated using (true);
create policy visuplanner_authenticated_read_day_plans on public.day_plans for select to authenticated using (true);
create policy visuplanner_authenticated_read_shifts on public.shifts for select to authenticated using (true);
create policy visuplanner_authenticated_read_activities on public.activities for select to authenticated using (true);
create policy visuplanner_authenticated_read_team_settings on public.team_settings for select to authenticated using (true);

-- Kun personalekontoen må ændre noget.
create policy visuplanner_staff_write_staff on public.staff for all to authenticated
  using ((select auth.jwt()->>'email') = 'team2@visuplanner.invalid')
  with check ((select auth.jwt()->>'email') = 'team2@visuplanner.invalid');
create policy visuplanner_staff_write_day_plans on public.day_plans for all to authenticated
  using ((select auth.jwt()->>'email') = 'team2@visuplanner.invalid')
  with check ((select auth.jwt()->>'email') = 'team2@visuplanner.invalid');
create policy visuplanner_staff_write_shifts on public.shifts for all to authenticated
  using ((select auth.jwt()->>'email') = 'team2@visuplanner.invalid')
  with check ((select auth.jwt()->>'email') = 'team2@visuplanner.invalid');
create policy visuplanner_staff_write_activities on public.activities for all to authenticated
  using ((select auth.jwt()->>'email') = 'team2@visuplanner.invalid')
  with check ((select auth.jwt()->>'email') = 'team2@visuplanner.invalid');
create policy visuplanner_staff_write_team_settings on public.team_settings for all to authenticated
  using ((select auth.jwt()->>'email') = 'team2@visuplanner.invalid')
  with check ((select auth.jwt()->>'email') = 'team2@visuplanner.invalid');

-- Billeder gøres private. Appen laver tidsbegrænsede billedlinks efter login.
update storage.buckets set public = false where id = 'visuplan-images';

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
  loop
    execute format('drop policy if exists %I on storage.objects', p.policyname);
  end loop;
end $$;

create policy visuplanner_authenticated_read_images on storage.objects for select to authenticated
  using (bucket_id = 'visuplan-images');
create policy visuplanner_staff_insert_images on storage.objects for insert to authenticated
  with check (bucket_id = 'visuplan-images' and (select auth.jwt()->>'email') = 'team2@visuplanner.invalid');
create policy visuplanner_staff_update_images on storage.objects for update to authenticated
  using (bucket_id = 'visuplan-images' and (select auth.jwt()->>'email') = 'team2@visuplanner.invalid')
  with check (bucket_id = 'visuplan-images' and (select auth.jwt()->>'email') = 'team2@visuplanner.invalid');
create policy visuplanner_staff_delete_images on storage.objects for delete to authenticated
  using (bucket_id = 'visuplan-images' and (select auth.jwt()->>'email') = 'team2@visuplanner.invalid');
