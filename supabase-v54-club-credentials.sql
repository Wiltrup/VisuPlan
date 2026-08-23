-- VisuPlanner v54 – krypteret visning og administration af klubkoder.
-- Eksisterende klubkoder kan ikke genskabes fra Supabase Auth; vælg dem på ny én gang.

begin;

create table if not exists public.shared_offer_credentials (
  offer_id uuid primary key references public.shared_offers(id) on update cascade on delete cascade,
  editor_code_ciphertext text,
  viewer_code_ciphertext text,
  editor_changed_at timestamptz,
  viewer_changed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.shared_offer_credentials enable row level security;
revoke all on public.shared_offer_credentials from anon, authenticated;

commit;
