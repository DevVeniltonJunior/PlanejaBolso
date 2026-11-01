-- Active financial cycle per user and the history of closed cycles.
-- Safe to run more than once. Existing data is not changed: users start with no persisted
-- active cycle, which the app reads as the current calendar month.

-- One active cycle per user: a single column on the user's profile (first day of the cycle's month).
alter table public.profiles
  add column if not exists active_cycle date
  check (active_cycle is null or extract(day from active_cycle) = 1);

-- Closed cycles. Rows are only written by close_financial_cycle(); users can read their own
-- history but cannot insert, change or delete it, so a closed cycle is never reopened.
create table if not exists public.closed_cycles (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cycle_month date not null check (extract(day from cycle_month) = 1),
  closed_at timestamptz not null default now(),
  primary key (user_id, cycle_month)
);

revoke all on public.closed_cycles from anon, authenticated;
grant select on public.closed_cycles to authenticated;

alter table public.closed_cycles enable row level security;
drop policy if exists "own rows" on public.closed_cycles;
create policy "own rows" on public.closed_cycles for select to authenticated
  using (user_id = (select auth.uid()));

-- Closes p_cycle and makes the next cycle active, atomically. Returns the active cycle.
-- p_cycle is the cycle the app shows as active: the persisted one, or a later calendar month
-- (cycles skipped by the calendar are not marked as closed).
-- Closing a cycle that is no longer active (repeated click, second tab, stale session) changes
-- nothing, so the active cycle advances at most once per cycle.
create or replace function public.close_financial_cycle(p_cycle date)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_active date;
  v_next date := (p_cycle + interval '1 month')::date;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_cycle is null or extract(day from p_cycle) <> 1 then
    raise exception 'invalid cycle: %', p_cycle using errcode = '22023';
  end if;

  insert into public.profiles (user_id) values (v_user) on conflict (user_id) do nothing;
  -- Row lock: concurrent closings for the same user run one after the other.
  select active_cycle into v_active from public.profiles where user_id = v_user for update;

  if v_active is not null and p_cycle < v_active then
    return v_active;
  end if;

  insert into public.closed_cycles (user_id, cycle_month) values (v_user, p_cycle) on conflict do nothing;
  update public.profiles set active_cycle = v_next, updated_at = now() where user_id = v_user;
  return v_next;
end
$$;

revoke all on function public.close_financial_cycle(date) from public, anon;
grant execute on function public.close_financial_cycle(date) to authenticated;
