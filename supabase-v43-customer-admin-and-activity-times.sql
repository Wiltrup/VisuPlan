-- VisuPlanner v43 – kundeadministration, stabile klubadresser og sluttider.
-- Sikker, additiv migration: eksisterende kunder, tavler og indhold bevares.

begin;

alter table public.customers
  add column if not exists url_slug text;

update public.customers
set url_slug = trim(both '-' from regexp_replace(
  replace(replace(replace(lower(display_name), 'æ', 'ae'), 'ø', 'oe'), 'å', 'aa'),
  '[^a-z0-9]+', '-', 'g'
))
where url_slug is null or url_slug = '';

alter table public.shared_offers
  add column if not exists customer_slug text;

update public.shared_offers offer
set customer_slug = customer.url_slug
from public.customers customer
where customer.id = offer.customer_id
  and (offer.customer_slug is null or offer.customer_slug = '');

alter table public.activities
  add column if not exists activity_end_time time;

alter table public.shared_offer_activities
  add column if not exists activity_end_time time;

commit;
