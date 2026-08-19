-- VisuPlanner v42 – fælles tilbud (fx en fælles klub)
-- Sikker migration: eksisterende kunder, tavler og ugeplaner ændres eller slettes ikke.

begin;

create table if not exists public.shared_offers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,120}$'),
  name text not null,
  workplace text,
  municipality text,
  recovery_email text not null,
  editor_user_id uuid unique,
  viewer_user_id uuid unique,
  own_board_enabled boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_offer_team_links (
  offer_id uuid not null references public.shared_offers(id) on delete cascade,
  team_slug text not null references public.teams_registry(slug) on update cascade on delete cascade,
  visible_on_team boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (offer_id, team_slug)
);

create table if not exists public.shared_offer_days (
  offer_id uuid not null references public.shared_offers(id) on delete cascade,
  plan_date date not null,
  meal_name text,
  meal_photo_url text,
  message text,
  updated_at timestamptz not null default now(),
  primary key (offer_id, plan_date)
);

create table if not exists public.shared_offer_activities (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.shared_offers(id) on delete cascade,
  plan_date date not null,
  activity_time time,
  name text not null,
  photo_url text,
  sort_order integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists shared_offers_customer_idx on public.shared_offers(customer_id);
create index if not exists shared_offer_links_team_idx on public.shared_offer_team_links(team_slug);
create index if not exists shared_offer_days_date_idx on public.shared_offer_days(offer_id,plan_date);
create index if not exists shared_offer_activities_date_idx on public.shared_offer_activities(offer_id,plan_date,sort_order);

create or replace function public.can_view_shared_offer(wanted uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.is_visuplanner_admin()
    or exists(
      select 1 from public.shared_offers offer
      where offer.id=wanted and offer.archived_at is null
        and auth.uid() in (offer.editor_user_id,offer.viewer_user_id)
    )
    or exists(
      select 1
      from public.shared_offer_team_links link
      join public.teams_registry team on team.slug=link.team_slug
      where link.offer_id=wanted and team.archived_at is null
        and auth.uid() in (team.editor_user_id,team.viewer_user_id)
    )
$$;

create or replace function public.can_edit_shared_offer(wanted uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.is_visuplanner_admin()
    or exists(
      select 1 from public.shared_offers offer
      left join public.customers customer on customer.id=offer.customer_id
      where offer.id=wanted and offer.archived_at is null
        and offer.editor_user_id=auth.uid()
        and (
          customer.id is null
          or customer.subscription_status in ('contracted','invoice_sent','active','overdue','legacy')
          or (
            customer.subscription_status='trial' and (
              customer.trial_ends_at>now()
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

alter table public.shared_offers enable row level security;
alter table public.shared_offer_team_links enable row level security;
alter table public.shared_offer_days enable row level security;
alter table public.shared_offer_activities enable row level security;

revoke all on public.shared_offers, public.shared_offer_team_links, public.shared_offer_days, public.shared_offer_activities from anon;
grant select on public.shared_offers, public.shared_offer_team_links, public.shared_offer_days, public.shared_offer_activities to authenticated;
grant insert, update, delete on public.shared_offer_days, public.shared_offer_activities to authenticated;
grant update(visible_on_team,updated_at) on public.shared_offer_team_links to authenticated;

drop policy if exists shared_offers_read on public.shared_offers;
create policy shared_offers_read on public.shared_offers for select to authenticated
using(public.can_view_shared_offer(id));

drop policy if exists shared_offer_links_read on public.shared_offer_team_links;
create policy shared_offer_links_read on public.shared_offer_team_links for select to authenticated
using(public.can_view_shared_offer(offer_id));

drop policy if exists shared_offer_links_team_toggle on public.shared_offer_team_links;
create policy shared_offer_links_team_toggle on public.shared_offer_team_links for update to authenticated
using(
  public.is_visuplanner_admin() or exists(
    select 1 from public.teams_registry team
    where team.slug=shared_offer_team_links.team_slug and team.editor_user_id=auth.uid() and team.archived_at is null
  )
)
with check(
  public.is_visuplanner_admin() or exists(
    select 1 from public.teams_registry team
    where team.slug=shared_offer_team_links.team_slug and team.editor_user_id=auth.uid() and team.archived_at is null
  )
);

drop policy if exists shared_offer_days_read on public.shared_offer_days;
create policy shared_offer_days_read on public.shared_offer_days for select to authenticated
using(public.can_view_shared_offer(offer_id));
drop policy if exists shared_offer_days_write on public.shared_offer_days;
create policy shared_offer_days_write on public.shared_offer_days for all to authenticated
using(public.can_edit_shared_offer(offer_id)) with check(public.can_edit_shared_offer(offer_id));

drop policy if exists shared_offer_activities_read on public.shared_offer_activities;
create policy shared_offer_activities_read on public.shared_offer_activities for select to authenticated
using(public.can_view_shared_offer(offer_id));
drop policy if exists shared_offer_activities_write on public.shared_offer_activities;
create policy shared_offer_activities_write on public.shared_offer_activities for all to authenticated
using(public.can_edit_shared_offer(offer_id)) with check(public.can_edit_shared_offer(offer_id));

-- Medier gemmes under offers/<offer-id>/... i den eksisterende private bucket.
drop policy if exists shared_offer_media_read on storage.objects;
create policy shared_offer_media_read on storage.objects for select to authenticated
using(
  bucket_id='visuplan-images'
  and (storage.foldername(name))[1]='offers'
  and public.can_view_shared_offer(((storage.foldername(name))[2])::uuid)
);
drop policy if exists shared_offer_media_write on storage.objects;
create policy shared_offer_media_write on storage.objects for all to authenticated
using(
  bucket_id='visuplan-images'
  and (storage.foldername(name))[1]='offers'
  and public.can_edit_shared_offer(((storage.foldername(name))[2])::uuid)
)
with check(
  bucket_id='visuplan-images'
  and (storage.foldername(name))[1]='offers'
  and public.can_edit_shared_offer(((storage.foldername(name))[2])::uuid)
);

commit;
