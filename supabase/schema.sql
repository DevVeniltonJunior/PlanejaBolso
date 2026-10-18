-- PlanejaBolso — prototype schema.
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query) on a new project.
-- Databases created from an earlier version: apply the files in supabase/migrations/ instead.
-- Every table is owned by auth.users and protected by Row Level Security:
-- an authenticated user can only read and write their own rows.

-- ------------------------------------------------------------------ tables

create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  fixed_salary numeric(12, 2) check (fixed_salary is null or fixed_salary >= 0),
  -- Day the user normally pays regular expenses. Never applies to credit card statements.
  default_payment_day smallint not null default 5 check (default_payment_day between 1 and 31),
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
  -- Payment day when it differs from profiles.default_payment_day; null = use the default
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
      when 'INSTALLMENT' then payment_day_override is null and installments_count is not null and purchase_date is not null and payment_method is not null
        and ((payment_method = 'CREDIT_CARD' and card_id is not null) or (payment_method <> 'CREDIT_CARD' and first_payment_date is not null))
      when 'OCCASIONAL' then payment_day_override is null and purchase_date is not null and payment_method is not null
        and (payment_method <> 'CREDIT_CARD' or card_id is not null)
    end
  )
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

-- ------------------------------------------------------------------ row level security

alter table public.profiles enable row level security;
alter table public.salary_history enable row level security;
alter table public.income_sources enable row level security;
alter table public.credit_cards enable row level security;
alter table public.expenses enable row level security;

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
