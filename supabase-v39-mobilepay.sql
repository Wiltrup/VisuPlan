-- VisuPlanner v39 – tilføj MobilePay som betalingsform
-- Sikker migration: eksisterende kunde-, tavle- og betalingsdata bevares.

begin;

alter table public.customers
  drop constraint if exists customers_payment_method_check;

alter table public.customers
  add constraint customers_payment_method_check
  check (payment_method is null or payment_method in ('ean', 'card', 'mobilepay', 'bank', 'other'));

commit;
