-- VisuPlanner v53 – kundeopdelte adresser til team- og klubtavler.
-- Eksempel: /cfbb/team-2 og /cfbb/solsikken.
-- Additiv migration: eksisterende interne slugs og gamle links bevares.

begin;

alter table public.customers
  add column if not exists club_module_enabled boolean not null default false;

alter table public.shared_offers
  add column if not exists onboarding_status text not null default 'active'
    check (onboarding_status in ('invited','active'));

alter table public.shared_offers
  alter column registration_module_enabled set default true;

update public.shared_offers set registration_module_enabled=true
where registration_module_enabled=false;

create table if not exists public.shared_offer_invitations (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.shared_offers(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  purpose text not null default 'activation' check (purpose in ('activation','password_reset')),
  token_hash text not null unique,
  contact_email text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists shared_offer_invitations_lookup_idx
  on public.shared_offer_invitations(token_hash, used_at, expires_at);

alter table public.shared_offer_invitations enable row level security;
revoke all on public.shared_offer_invitations from anon, authenticated;

update public.customers
set url_slug = 'kunde-' || left(id::text, 8), updated_at = now()
where url_slug is null or btrim(url_slug) = '';

with duplicates as (
  select id, url_slug,
    row_number() over (partition by url_slug order by created_at, id) as duplicate_number
  from public.customers
)
update public.customers customer
set url_slug = left(duplicates.url_slug, 68) || '-' || left(customer.id::text, 8),
    updated_at = now()
from duplicates
where customer.id = duplicates.id and duplicates.duplicate_number > 1;

create unique index if not exists customers_url_slug_global_unique_idx
  on public.customers(url_slug);

create table if not exists public.board_routes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on update cascade on delete cascade,
  customer_slug text not null,
  board_slug text not null,
  board_kind text not null check (board_kind in ('team','offer')),
  team_slug text references public.teams_registry(slug) on update cascade on delete cascade,
  offer_id uuid references public.shared_offers(id) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (board_kind = 'team' and team_slug is not null and offer_id is null)
    or
    (board_kind = 'offer' and offer_id is not null and team_slug is null)
  ),
  unique(customer_id, board_slug),
  unique(customer_slug, board_slug),
  unique(team_slug),
  unique(offer_id)
);

create index if not exists board_routes_customer_idx
  on public.board_routes(customer_id, board_kind, board_slug);

do $$
declare
  item record;
  base_slug text;
  candidate text;
  suffix integer;
begin
  for item in
    select team.slug as target_slug, customer.id as customer_id, customer.url_slug as customer_slug
    from public.teams_registry team
    join public.customers customer on customer.id = team.customer_id
    where not exists (select 1 from public.board_routes route where route.team_slug = team.slug)
    order by team.created_at, team.slug
  loop
    base_slug := item.target_slug;
    if base_slug like item.customer_slug || '-%' then
      base_slug := substring(base_slug from char_length(item.customer_slug) + 2);
    end if;
    if base_slug is null or base_slug = '' then base_slug := 'tavle'; end if;
    candidate := left(base_slug, 80);
    suffix := 2;
    while exists (
      select 1 from public.board_routes route
      where route.customer_id = item.customer_id and route.board_slug = candidate
    ) loop
      candidate := left(base_slug, 74) || '-' || suffix::text;
      suffix := suffix + 1;
    end loop;
    insert into public.board_routes(customer_id, customer_slug, board_slug, board_kind, team_slug)
    values(item.customer_id, item.customer_slug, candidate, 'team', item.target_slug);
  end loop;

  for item in
    select offer.id as offer_id, offer.slug as target_slug,
      customer.id as customer_id, customer.url_slug as customer_slug
    from public.shared_offers offer
    join public.customers customer on customer.id = offer.customer_id
    where not exists (select 1 from public.board_routes route where route.offer_id = offer.id)
    order by offer.created_at, offer.slug
  loop
    base_slug := item.target_slug;
    if base_slug like item.customer_slug || '-%' then
      base_slug := substring(base_slug from char_length(item.customer_slug) + 2);
    end if;
    if base_slug is null or base_slug = '' then base_slug := 'klub'; end if;
    candidate := left(base_slug, 80);
    suffix := 2;
    while exists (
      select 1 from public.board_routes route
      where route.customer_id = item.customer_id and route.board_slug = candidate
    ) loop
      candidate := left(base_slug, 74) || '-' || suffix::text;
      suffix := suffix + 1;
    end loop;
    insert into public.board_routes(customer_id, customer_slug, board_slug, board_kind, offer_id)
    values(item.customer_id, item.customer_slug, candidate, 'offer', item.offer_id);
  end loop;
end $$;

alter table public.board_routes enable row level security;
revoke all on public.board_routes from anon, authenticated;

commit;
