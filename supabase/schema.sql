create table if not exists public.license_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.license_state enable row level security;

-- O sistema usa a service_role key no backend do Vercel, entao nao precisa
-- criar policy publica para leitura/escrita.
