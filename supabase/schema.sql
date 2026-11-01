-- PlanejaBolso — prototype schema.
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query) on a new project.
-- Databases created from an earlier version: apply the files in supabase/migrations/ instead.
-- Every table is owned by auth.users and protected by Row Level Security:
-- an authenticated user can only read and write their own rows.

-- ------------------------------------------------------------------ tables

create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  fixed_salary numeric(12, 2) check (fixed_salary is null or fixed_salary >= 0),
  -- Day the user normally pays regular expenses. It is also the boundary of the user's
  -- financial cycles (day 5: the October cycle runs 05/10 → 04/11). It never changes a card
  -- statement's due date; it only decides which cycle pays that statement.
  default_payment_day smallint not null default 5 check (default_payment_day between 1 and 31),
  -- Active financial cycle (first day of its month). Only one per user; advanced by
  -- close_financial_cycle(). Null = the current calendar month.
  active_cycle date check (active_cycle is null or extract(day from active_cycle) = 1),
  updated_at timestamptz not null default now()
);

create table if not exists public.salary_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reference_month date not null check (extract(day from reference_month) = 1),
  net_amount numeric(12, 2) not null check (net_amount >= 0),
  receipt_date date,
  created_at timestamptz not null default now(),
  unique (user_id, reference_month)
);

create table if not exists public.income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  amount numeric(12, 2) not null check (amount >= 0),
  type text not null check (type in ('RENT', 'FREELANCE', 'INVESTMENT', 'OTHER')),
  recurrence text not null check (recurrence in ('MONTHLY', 'ANNUAL', 'OCCASIONAL')),
  expected_date date not null,
  created_at timestamptz not null default now()
);

-- Only projection data. No card number, CVV, expiration or holder information.
create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nickname text not null check (length(nickname) between 1 and 60),
  due_day smallint not null check (due_day between 1 and 31),
  closing_days_before smallint not null check (closing_days_before between 1 and 28),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

-- Single expense table with type-specific columns.
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null check (type in ('FIXED', 'INSTALLMENT', 'SUBSCRIPTION', 'OCCASIONAL')),
  name text not null check (length(name) between 1 and 120),
  -- FIXED / SUBSCRIPTION / OCCASIONAL: amount; INSTALLMENT: installment amount
  amount numeric(12, 2) not null check (amount >= 0),
  -- FIXED / SUBSCRIPTION
  recurrence text check (recurrence in ('MONTHLY', 'ANNUAL')),
  category text check (category in ('BILL', 'TAX', 'OTHER')),
  -- Day of month the expense is paid.
  -- FIXED / SUBSCRIPTION: when it differs from profiles.default_payment_day (e.g. a car payment
  -- on day 17); null = use the default.
  -- Pix/Cash INSTALLMENT: monthly due day; null = the day of first_payment_date.
  payment_day_override smallint check (payment_day_override between 1 and 31),
  charge_month smallint check (charge_month between 1 and 12),
  start_date date,
  -- INSTALLMENT
  installments_count smallint check (installments_count between 1 and 120),
  first_payment_date date,
  -- INSTALLMENT / OCCASIONAL
  purchase_date date,
  payment_method text check (payment_method in ('CASH', 'PIX', 'CREDIT_CARD')),
  card_id uuid,
  created_at timestamptz not null default now(),
  -- The referenced card must belong to the same user; cards in use cannot be deleted.
  foreign key (card_id, user_id) references public.credit_cards (id, user_id) on delete restrict,
  constraint expenses_type_fields_check check (
    case type
      when 'FIXED' then recurrence is not null and category is not null and start_date is not null
        and (recurrence = 'MONTHLY' or charge_month is not null)
      when 'SUBSCRIPTION' then recurrence is not null and start_date is not null
        and (recurrence = 'MONTHLY' or charge_month is not null)
      -- Card purchases follow the card's due date; payment_day_override does not apply.
      when 'INSTALLMENT' then installments_count is not null and purchase_date is not null and payment_method is not null
        and ((payment_method = 'CREDIT_CARD' and card_id is not null and payment_day_override is null)
          or (payment_method <> 'CREDIT_CARD' and first_payment_date is not null))
      when 'OCCASIONAL' then payment_day_override is null and purchase_date is not null and payment_method is not null
        and (payment_method <> 'CREDIT_CARD' or card_id is not null)
    end
  )
);

-- Closed financial cycles. Written only by close_financial_cycle(); read-only for users, so a
-- closed cycle is never reopened.
create table if not exists public.closed_cycles (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cycle_month date not null check (extract(day from cycle_month) = 1),
  closed_at timestamptz not null default now(),
  primary key (user_id, cycle_month)
);

create index if not exists salary_history_user_idx on public.salary_history (user_id);
create index if not exists income_sources_user_idx on public.income_sources (user_id);
create index if not exists credit_cards_user_idx on public.credit_cards (user_id);
create index if not exists expenses_user_idx on public.expenses (user_id);

-- ------------------------------------------------------------------ privileges

revoke all on public.profiles, public.salary_history, public.income_sources, public.credit_cards, public.expenses from anon;
grant select, insert, update, delete
  on public.profiles, public.salary_history, public.income_sources, public.credit_cards, public.expenses
  to authenticated;
revoke all on public.closed_cycles from anon, authenticated;
grant select on public.closed_cycles to authenticated;

-- ------------------------------------------------------------------ row level security

alter table public.profiles enable row level security;
alter table public.salary_history enable row level security;
alter table public.income_sources enable row level security;
alter table public.credit_cards enable row level security;
alter table public.expenses enable row level security;
alter table public.closed_cycles enable row level security;

drop policy if exists "own rows" on public.profiles;
create policy "own rows" on public.profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own rows" on public.salary_history;
create policy "own rows" on public.salary_history for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own rows" on public.income_sources;
create policy "own rows" on public.income_sources for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own rows" on public.credit_cards;
create policy "own rows" on public.credit_cards for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own rows" on public.expenses;
create policy "own rows" on public.expenses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "own rows" on public.closed_cycles;
create policy "own rows" on public.closed_cycles for select to authenticated
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------------ functions

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
