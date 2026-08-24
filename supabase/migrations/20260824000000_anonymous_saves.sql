create table public.crm_anonymous_saves (
  id uuid primary key,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  state jsonb not null,
  revision bigint not null check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_anonymous_saves enable row level security;

revoke all on table public.crm_anonymous_saves from anon, authenticated;

create index crm_anonymous_saves_updated_at_idx
  on public.crm_anonymous_saves (updated_at);