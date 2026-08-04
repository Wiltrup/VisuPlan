-- VisuPlanner version 21: onboarding, adgangshjælp, måltider og vagtstruktur.
-- Kør hele scriptet én gang i Supabase SQL Editor.
-- Det sletter ikke eksisterende planer, medarbejdere, billeder eller brugere.

alter table public.day_plans add column if not exists breakfast_name text;
alter table public.day_plans add column if not exists breakfast_photo_url text;
alter table public.day_plans add column if not exists lunch_name text;
alter table public.day_plans add column if not exists lunch_photo_url text;

alter table public.team_settings add column if not exists show_breakfast boolean not null default false;
alter table public.team_settings add column if not exists show_lunch boolean not null default false;
alter table public.team_settings add column if not exists shift_mode integer not null default 3 check (shift_mode between 1 and 3);
alter table public.team_settings add column if not exists night_enabled boolean not null default true;

create table if not exists public.onboarding_requests (
  id uuid primary key default gen_random_uuid(), contact_name text not null,
  contact_email text not null, phone text, municipality text not null,
  workplace text not null, team_name text not null, resident_count integer not null,
  notes text, status text not null default 'new', created_at timestamptz not null default now()
);

create table if not exists public.access_help_requests (
  id uuid primary key default gen_random_uuid(), team_slug text not null,
  contact_name text not null, contact_email text not null,
  status text not null default 'new', created_at timestamptz not null default now()
);

alter table public.onboarding_requests enable row level security;
alter table public.access_help_requests enable row level security;
revoke all on public.onboarding_requests, public.access_help_requests from anon, authenticated;
grant select, update on public.onboarding_requests, public.access_help_requests to authenticated;
drop policy if exists onboarding_admin_read on public.onboarding_requests;
drop policy if exists onboarding_admin_update on public.onboarding_requests;
drop policy if exists access_help_admin_read on public.access_help_requests;
drop policy if exists access_help_admin_update on public.access_help_requests;
create policy onboarding_admin_read on public.onboarding_requests for select to authenticated using (public.is_visuplanner_admin());
create policy onboarding_admin_update on public.onboarding_requests for update to authenticated using (public.is_visuplanner_admin()) with check (public.is_visuplanner_admin());
create policy access_help_admin_read on public.access_help_requests for select to authenticated using (public.is_visuplanner_admin());
create policy access_help_admin_update on public.access_help_requests for update to authenticated using (public.is_visuplanner_admin()) with check (public.is_visuplanner_admin());
