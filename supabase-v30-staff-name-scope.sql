-- VisuPlanner version 30: medarbejdernavne skal kun være unikke pr. tavle.
--
-- Tidligere kunne en gammel UNIQUE-regel på staff.name forhindre, at to
-- forskellige teams havde en medarbejder med samme navn. Scriptet bevarer
-- alle medarbejdere og ugeplaner og kan køres igen uden skade.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a
      on a.attrelid = t.oid
     and a.attname = 'name'
     and not a.attisdropped
    where n.nspname = 'public'
      and t.relname = 'staff'
      and c.contype = 'u'
      and c.conkey = array[a.attnum]::smallint[]
  loop
    execute format(
      'alter table public.staff drop constraint %I',
      constraint_name
    );
  end loop;
end
$$;

-- Samme navn kan bruges i forskellige teams, men ikke to gange i samme team.
-- lower/btrim gør kontrollen uafhængig af store bogstaver og ekstra mellemrum.
create unique index if not exists staff_team_slug_name_unique
  on public.staff (team_slug, lower(btrim(name)));
