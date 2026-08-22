-- VisuPlanner v51 – sikker kundeadministration og krypterede fælleskoder.
-- Additiv migration: eksisterende kunder, tavler, login og ugeplaner bevares.

begin;

create table if not exists public.customer_admins (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  active boolean not null default true,
  invited_at timestamptz,
  activated_at timestamptz not null default now(),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id,email)
);

create table if not exists public.customer_admin_invitations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  admin_user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  purpose text not null default 'activation'
    check (purpose in ('activation','password_reset')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.team_credentials (
  team_slug text primary key references public.teams_registry(slug) on update cascade on delete cascade,
  editor_code_ciphertext text,
  viewer_code_ciphertext text,
  editor_changed_at timestamptz,
  viewer_changed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  admin_user_id uuid references auth.users(id) on delete set null,
  admin_name text,
  admin_email text,
  team_slug text references public.teams_registry(slug) on update cascade on delete set null,
  action text not null,
  target_kind text,
  created_at timestamptz not null default now()
);

create index if not exists customer_admins_customer_idx
  on public.customer_admins(customer_id) where active;
create index if not exists customer_admin_invitations_lookup_idx
  on public.customer_admin_invitations(token_hash,expires_at) where used_at is null;
create index if not exists customer_admin_invitations_customer_idx
  on public.customer_admin_invitations(customer_id,created_at desc);
create index if not exists customer_admin_audit_customer_idx
  on public.customer_admin_audit_log(customer_id,created_at desc);

alter table public.customer_admins enable row level security;
alter table public.customer_admin_invitations enable row level security;
alter table public.team_credentials enable row level security;
alter table public.customer_admin_audit_log enable row level security;

revoke all on public.customer_admins from anon, authenticated;
revoke all on public.customer_admin_invitations from anon, authenticated;
revoke all on public.team_credentials from anon, authenticated;
revoke all on public.customer_admin_audit_log from anon, authenticated;

commit;
