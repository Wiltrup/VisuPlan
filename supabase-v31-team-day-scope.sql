-- VisuPlanner v31: datoer og vagtpladser er unikke pr. tavle.
-- Migrationen bevarer alle eksisterende planer, vagter og aktiviteter.

begin;

-- Fjern først de gamle fremmednøgler, der kun peger på datoen.
alter table public.shifts
  drop constraint if exists shifts_plan_date_fkey;

alter table public.activities
  drop constraint if exists activities_plan_date_fkey;

-- Den gamle vagtregel gælder globalt på tværs af alle tavler.
alter table public.shifts
  drop constraint if exists shifts_plan_date_shift_type_slot_key;

-- Fjern eventuelle selvstændige indeks fra tidligere migrationsforsøg.
drop index if exists public.shifts_team_date_type_slot_uidx;
drop index if exists public.day_plans_team_date_uidx;

-- En dato må nu forekomme én gang på hver tavle.
alter table public.day_plans
  drop constraint if exists day_plans_pkey;

alter table public.day_plans
  add constraint day_plans_pkey
  primary key (team_slug, plan_date);

-- Samme vagtplads må bruges på forskellige tavler.
alter table public.shifts
  add constraint shifts_plan_date_shift_type_slot_key
  unique (team_slug, plan_date, shift_type, slot);

-- Vagt og aktivitet kobles til den korrekte tavle og dato.
alter table public.shifts
  add constraint shifts_plan_date_fkey
  foreign key (team_slug, plan_date)
  references public.day_plans (team_slug, plan_date)
  on update cascade
  on delete cascade;

alter table public.activities
  add constraint activities_plan_date_fkey
  foreign key (team_slug, plan_date)
  references public.day_plans (team_slug, plan_date)
  on update cascade
  on delete cascade;

commit;
