-- VisuPlanner v40 – 14 dages prøve og aktiveringsfrist til dag 25
-- Sikker migration: eksisterende kunder, tavler, ugeplaner og betalinger bevares.
-- Filen inkluderer også MobilePay-tilføjelsen fra v39 og kan derfor køres direkte
-- oven på v38, hvis v39-SQL-filen endnu ikke er kørt.

begin;

alter table public.customers
  drop constraint if exists customers_payment_method_check;

alter table public.customers
  add constraint customers_payment_method_check
  check (payment_method is null or payment_method in ('ean', 'card', 'mobilepay', 'bank', 'other'));

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
