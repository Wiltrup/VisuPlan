-- VisuPlanner v55 – ensret prøveperiode og aktiveringsfrist.
-- Kør én gang i Supabase SQL Editor, efter at v52 er installeret.
-- Rører ikke kunde-, tavle- eller tilmeldingsdata.
-- Aktiv prøveperiode: frem til customers.trial_ends_at.
-- Hvis kunden har anmodet om aktivering: yderligere 7 dages redigering efter udløb.
begin;

create or replace function public.can_edit_team(team_slug text)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.is_visuplanner_admin() or exists (
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
          and customer.trial_ends_at is not null
          and (
            now()<customer.trial_ends_at
            or (
              customer.subscription_interest_at is not null
              and now()<customer.trial_ends_at+interval '7 days'
            )
          )
        )
      )
  )
$$;

create or replace function public.can_edit_shared_offer(wanted uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.is_visuplanner_admin()
    or exists (
      select 1 from public.shared_offers offer
      left join public.customers customer on customer.id=offer.customer_id
      where offer.id=wanted
        and offer.archived_at is null
        and offer.editor_user_id=auth.uid()
        and (
          customer.id is null
          or customer.subscription_status in ('contracted','invoice_sent','active','overdue','legacy')
          or (
            customer.subscription_status='trial'
            and customer.trial_ends_at is not null
            and (
              now()<customer.trial_ends_at
              or (
                customer.subscription_interest_at is not null
                and now()<customer.trial_ends_at+interval '7 days'
              )
            )
          )
        )
    )
$$;

create or replace function public.team_subscription_allows_registration(wanted_team text)
returns boolean language sql stable security definer set search_path=public
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
          and customer.trial_ends_at is not null
          and (
            now()<customer.trial_ends_at
            or (
              customer.subscription_interest_at is not null
              and now()<customer.trial_ends_at+interval '7 days'
            )
          )
        )
      )
  )
$$;

commit;
