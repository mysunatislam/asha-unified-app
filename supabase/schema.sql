-- Run once in the Supabase SQL Editor. The browser never accesses this table.
create table if not exists public.asha_objects (
  path text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists asha_objects_path_prefix_idx
  on public.asha_objects (path text_pattern_ops);

alter table public.asha_objects enable row level security;
revoke all on public.asha_objects from anon, authenticated;
grant select, insert, update, delete on public.asha_objects to service_role;

comment on table public.asha_objects is
  'Private Asha demo sessions, caregiver events, receipts and rate limits. Server access only.';
