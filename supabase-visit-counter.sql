-- ─────────────────────────────────────────────────────────────────────
-- /kunal visit counter — one-time setup
-- Run this once in the Supabase SQL editor (Database → SQL Editor →
-- New query → paste → Run). Safe to re-run: uses IF NOT EXISTS / ON
-- CONFLICT DO NOTHING throughout, won't reset the count if it already
-- exists.
-- ─────────────────────────────────────────────────────────────────────

-- Single-row counter table. id is always 1 — there's only ever one row.
create table if not exists kunal_card_visits (
  id         int primary key default 1,
  count      bigint not null default 301,
  updated_at timestamptz not null default now()
);

-- Seed the single row at 301. Does nothing if it already exists (so
-- re-running this file is harmless and won't reset a real count back
-- to 301 later).
insert into kunal_card_visits (id, count)
values (1, 301)
on conflict (id) do nothing;

-- Atomic increment — a plain "select then update" from the JS client
-- would race under concurrent visits (two requests could both read 301
-- and both write 302). This function does the read-modify-write as a
-- single SQL statement, so Postgres serializes it per-row automatically.
create or replace function increment_kunal_visits()
returns bigint
language plpgsql
as $$
declare
  new_count bigint;
begin
  update kunal_card_visits
  set count = count + 1, updated_at = now()
  where id = 1
  returning count into new_count;
  return new_count;
end;
$$;
