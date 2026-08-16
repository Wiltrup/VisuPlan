-- VisuPlanner v38: kunder, abonnementer, prøveperioder og flere tavler pr. betaler.
-- Kør hele filen én gang i Supabase SQL Editor EFTER v31.
-- Migrationen sletter ingen eksisterende tavler eller planer.

begin;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  legal_name text,
  municipality text,
  contact_name text,
  contact_email text not null,
  billing_email text,
  phone text,
  cvr text,
  ean text,
  invoice_reference text,
  plan_code text not null default 'trial',
  board_limit integer not null default 1 check (board_limit between 1 and 500),
  intro_price_dkk numeric(12,2),
  renewal_price_dkk numeric(12,2),
  subscription_status text not null default 'trial'
    check (subscription_status in ('trial','contracted','invoice_sent','active','overdue','read_only','cancelled')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  subscription_started_at timestamptz,
  subscription_renews_at timestamptz,
  invoice_number text,
  invoice_sent_at timestamptz,
  invoice_due_at date,
  invoice_period_end timestamptz,
  paid_at timestamptz,
  payment_method text check (payment_method is null or payment_method in ('ean','card','mobilepay','bank','other')),
  subscription_interest_at timestamptz,
  internal_notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.teams_registry add column if not exists customer_id uuid;
alter table public.team_invitations add column if not exists customer_id uuid;
alter table public.team_invitations add column if not exists purpose text not null default 'activation';

do $$ begin
  if not exists (select 1 from pg_constraint where conname='teams_registry_customer_id_fkey') then
    alter table public.teams_registry add constraint teams_registry_customer_id_fkey
      foreign key (customer_id) references public.customers(id) on update cascade on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='team_invitations_customer_id_fkey') then
    alter table public.team_invitations add constraint team_invitations_customer_id_fkey
      foreign key (customer_id) references public.customers(id) on update cascade on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='team_invitations_purpose_check') then
    alter table public.team_invitations add constraint team_invitations_purpose_check
      check (purpose in ('activation','password_reset'));
  end if;
end $$;

create index if not exists teams_registry_customer_id_idx on public.teams_registry(customer_id);
create index if not exists customers_renewal_idx on public.customers(subscription_renews_at)
  where archived_at is null;
create index if not exists customers_trial_idx on public.customers(trial_ends_at)
  where subscription_status='trial' and archived_at is null;

create table if not exists public.customer_acceptances (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  team_slug text references public.teams_registry(slug) on update cascade on delete set null,
  accepted_by_name text not null,
  accepted_by_email text not null,
  terms_version text not null,
  privacy_version text not null,
  dpa_version text not null,
  user_agent text,
  accepted_at timestamptz not null default now()
);
create index if not exists customer_acceptances_customer_idx on public.customer_acceptances(customer_id,accepted_at desc);

create table if not exists public.customer_notifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  notification_type text not null,
  period_date date not null,
  sent_at timestamptz not null default now(),
  unique(customer_id,notification_type,period_date)
);

-- Eksisterende tavler får hver sin aktive kundepost. De påvirkes derfor ikke
-- af prøveperioden og kan senere samles manuelt i administrationen.
do $$
declare
  team_row record;
  new_customer_id uuid;
begin
  for team_row in
    select * from public.teams_registry where customer_id is null
  loop
    insert into public.customers (
      display_name, legal_name, municipality, contact_email, billing_email,
      plan_code, board_limit, subscription_status, subscription_started_at,
      internal_notes
    ) values (
      coalesce(nullif(team_row.workplace,''),team_row.name),
      coalesce(nullif(team_row.workplace,''),team_row.name),
      team_row.municipality,
      team_row.recovery_email,
      team_row.recovery_email,
      'legacy', 1, 'active', coalesce(team_row.activated_at,team_row.created_at,now()),
      'Automatisk oprettet ved v38-migration. Fastlæg pakke og fornyelsesdato i administrationen.'
    ) returning id into new_customer_id;

    update public.teams_registry set customer_id=new_customer_id, updated_at=now()
      where slug=team_row.slug;
  end loop;
end $$;

update public.team_invitations invitation
set customer_id=team.customer_id
from public.teams_registry team
where invitation.team_slug=team.slug and invitation.customer_id is null;

alter table public.onboarding_requests add column if not exists requested_plan text;

alter table public.customers enable row level security;
alter table public.customer_acceptances enable row level security;
alter table public.customer_notifications enable row level security;
revoke all on public.customers, public.customer_acceptances, public.customer_notifications from anon;
revoke all on public.customers, public.customer_acceptances, public.customer_notifications from authenticated;
grant select on public.customers, public.customer_acceptances, public.customer_notifications to authenticated;

drop policy if exists customers_admin_read on public.customers;
drop policy if exists customer_acceptances_admin_read on public.customer_acceptances;
drop policy if exists customer_notifications_admin_read on public.customer_notifications;
create policy customers_admin_read on public.customers for select to authenticated
  using(public.is_visuplanner_admin());
create policy customer_acceptances_admin_read on public.customer_acceptances for select to authenticated
  using(public.is_visuplanner_admin());
create policy customer_notifications_admin_read on public.customer_notifications for select to authenticated
  using(public.is_visuplanner_admin());

-- Et aktivt abonnement, en indgået aftale eller en gyldig prøveperiode giver
-- skriveret. En aktiveringsanmodning inden for prøveforløbet forlænger
-- skriveretten til dag 25 fra prøvens start. Derefter stopper read_only eller
-- en udløbet frist skrivning, mens den gemte tavle fortsat kan læses.
create or replace function public.can_edit_team(team_slug text)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.is_visuplanner_admin() or exists(
    select 1
    from public.teams_registry team
    left join public.customers customer on customer.id=team.customer_id
    where team.slug=$1
      and team.editor_user_id=auth.uid()
      and team.archived_at is null
      and (
        customer.id is null
        or customer.subscription_status in ('contracted','invoice_sent','active','overdue')
        or (
          customer.subscription_status='trial'
          and (
            (customer.trial_ends_at is not null and now() < customer.trial_ends_at)
            or (
              customer.subscription_interest_at is not null
              and customer.trial_started_at is not null
              and now() < customer.trial_started_at + interval '25 days'
            )
          )
        )
      )
  )
$$;

commit;
