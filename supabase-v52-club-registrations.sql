-- VisuPlanner v52 – valgfrit tilmeldingsmodul til fælles klubtilbud.
-- Additiv migration: modulet er slået fra som standard, og eksisterende data bevares.

begin;

alter table public.shared_offers
  add column if not exists registration_module_enabled boolean not null default false;

alter table public.shared_offer_activities
  add column if not exists registration_enabled boolean not null default false,
  add column if not exists registration_deadline date,
  add column if not exists registration_note text;

create table if not exists public.shared_offer_registrations (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.shared_offer_activities(id) on delete cascade,
  offer_id uuid not null references public.shared_offers(id) on delete cascade,
  team_slug text not null references public.teams_registry(slug) on update cascade on delete cascade,
  participant_name text not null check (char_length(btrim(participant_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shared_offer_registrations_offer_idx
  on public.shared_offer_registrations(offer_id, activity_id, team_slug);

create unique index if not exists shared_offer_registrations_unique_name_idx
  on public.shared_offer_registrations(activity_id, team_slug, lower(btrim(participant_name)));

create or replace function public.validate_shared_offer_registration()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  new.participant_name := btrim(new.participant_name);
  new.updated_at := now();

  if not exists (
    select 1
    from public.shared_offer_activities activity
    join public.shared_offers offer on offer.id=activity.offer_id
    join public.shared_offer_team_links link
      on link.offer_id=offer.id and link.team_slug=new.team_slug
    where activity.id=new.activity_id
      and activity.offer_id=new.offer_id
      and activity.registration_enabled=true
      and offer.registration_module_enabled=true
      and offer.archived_at is null
  ) then
    raise exception 'Tilmeldingen passer ikke til et aktivt klubarrangement.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_shared_offer_registration_trigger on public.shared_offer_registrations;
create trigger validate_shared_offer_registration_trigger
before insert or update on public.shared_offer_registrations
for each row execute function public.validate_shared_offer_registration();

create or replace function public.can_manage_shared_offer_registrations(wanted_offer uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.can_edit_shared_offer(wanted_offer)
$$;

create or replace function public.can_view_all_shared_offer_registrations(wanted_offer uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.is_visuplanner_admin() or exists (
      select 1
      from public.shared_offers offer
      where offer.id=wanted_offer
        and offer.archived_at is null
        and offer.editor_user_id=auth.uid()
  )
$$;

create or replace function public.team_subscription_allows_registration(wanted_team text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1
    from public.teams_registry team
    left join public.customers customer on customer.id=team.customer_id
    where team.slug=wanted_team
      and team.archived_at is null
      and (
        customer.id is null
        or customer.subscription_status in ('contracted','invoice_sent','active','overdue','legacy')
        or (
          customer.subscription_status='trial'
          and (
            (customer.trial_ends_at is not null and now()<customer.trial_ends_at)
            or (
              customer.subscription_interest_at is not null
              and customer.trial_started_at is not null
              and now()<customer.trial_started_at+interval '25 days'
            )
          )
        )
      )
  )
$$;

create or replace function public.can_view_team_shared_offer_registration(wanted_offer uuid, wanted_team text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1
    from public.shared_offer_team_links link
    join public.teams_registry team on team.slug=link.team_slug
    join public.shared_offers offer on offer.id=link.offer_id
    where link.offer_id=wanted_offer
      and link.team_slug=wanted_team
      and link.visible_on_team=true
      and team.archived_at is null
      and offer.archived_at is null
      and auth.uid() in (team.editor_user_id, team.viewer_user_id)
  )
$$;

create or replace function public.can_edit_team_shared_offer_registration(wanted_offer uuid, wanted_team text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1
    from public.shared_offer_team_links link
    join public.teams_registry team on team.slug=link.team_slug
    join public.shared_offers offer on offer.id=link.offer_id
    where link.offer_id=wanted_offer
      and link.team_slug=wanted_team
      and team.archived_at is null
      and offer.archived_at is null
      and public.can_edit_team(wanted_team)
  )
$$;

alter table public.shared_offer_registrations enable row level security;

revoke all on public.shared_offer_registrations from anon;
grant select, insert, update, delete on public.shared_offer_registrations to authenticated;

drop policy if exists shared_offer_registrations_read on public.shared_offer_registrations;
create policy shared_offer_registrations_read
on public.shared_offer_registrations
for select to authenticated
using (
  public.can_view_all_shared_offer_registrations(offer_id)
  or public.can_view_team_shared_offer_registration(offer_id, team_slug)
);

drop policy if exists shared_offer_registrations_insert on public.shared_offer_registrations;
create policy shared_offer_registrations_insert
on public.shared_offer_registrations
for insert to authenticated
with check (
  public.can_manage_shared_offer_registrations(offer_id)
  or (
    public.can_view_team_shared_offer_registration(offer_id, team_slug)
    and public.team_subscription_allows_registration(team_slug)
    and exists (
      select 1
      from public.shared_offer_activities activity
      join public.shared_offers offer on offer.id=activity.offer_id
      where activity.id=shared_offer_registrations.activity_id
        and activity.offer_id=shared_offer_registrations.offer_id
        and activity.registration_enabled=true
        and activity.plan_date>=current_date
        and (activity.registration_deadline is null or activity.registration_deadline>=current_date)
        and offer.registration_module_enabled=true
        and offer.archived_at is null
    )
  )
);

drop policy if exists shared_offer_registrations_update on public.shared_offer_registrations;
create policy shared_offer_registrations_update
on public.shared_offer_registrations
for update to authenticated
using (
  public.can_manage_shared_offer_registrations(offer_id)
  or public.can_edit_team_shared_offer_registration(offer_id, team_slug)
)
with check (
  public.can_manage_shared_offer_registrations(offer_id)
  or public.can_edit_team_shared_offer_registration(offer_id, team_slug)
);

drop policy if exists shared_offer_registrations_delete on public.shared_offer_registrations;
create policy shared_offer_registrations_delete
on public.shared_offer_registrations
for delete to authenticated
using (
  public.can_manage_shared_offer_registrations(offer_id)
  or public.can_edit_team_shared_offer_registration(offer_id, team_slug)
);

create or replace function public.purge_expired_shared_offer_registrations()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  removed_count integer;
begin
  delete from public.shared_offer_registrations registration
  using public.shared_offer_activities activity
  where registration.activity_id=activity.id
    and activity.plan_date<=current_date-30;

  get diagnostics removed_count = row_count;
  return removed_count;
end;
$$;

revoke all on function public.purge_expired_shared_offer_registrations() from public, anon, authenticated;
grant execute on function public.purge_expired_shared_offer_registrations() to service_role;

commit;
