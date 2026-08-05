-- VisuPlanner v25: sikker kundeaktivering via engangslink.
-- Kør hele scriptet én gang. Det sletter ingen eksisterende data eller brugere.
alter table public.teams_registry add column if not exists onboarding_status text not null default 'active';
alter table public.teams_registry add column if not exists activated_at timestamptz;
create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(), team_slug text not null references public.teams_registry(slug) on delete cascade,
  token_hash text not null unique, contact_email text not null, expires_at timestamptz not null,
  used_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists team_invitations_team_slug_idx on public.team_invitations(team_slug);
alter table public.team_invitations enable row level security;
revoke all on public.team_invitations from anon, authenticated;
grant select on public.team_invitations to authenticated;
drop policy if exists team_invitations_admin_read on public.team_invitations;
create policy team_invitations_admin_read on public.team_invitations for select to authenticated using (public.is_visuplanner_admin());
