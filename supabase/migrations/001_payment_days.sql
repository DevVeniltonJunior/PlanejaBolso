-- Adds the user's default payment day and per-expense payment day overrides.
-- For databases created from the first version of schema.sql. Safe to run more than once.
-- RLS needs no change: the new columns live in tables already covered by the "own rows" policies.

alter table public.profiles
  add column if not exists default_payment_day smallint not null default 5
  check (default_payment_day between 1 and 31);

-- The old required charge_day becomes an optional override. Existing values are kept as
-- explicit overrides, so existing expenses keep their current payment day.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'expenses' and column_name = 'charge_day') then
    alter table public.expenses rename column charge_day to payment_day_override;
  end if;
  if exists (select 1 from pg_constraint where conname = 'expenses_charge_day_check' and conrelid = 'public.expenses'::regclass) then
    alter table public.expenses rename constraint expenses_charge_day_check to expenses_payment_day_override_check;
  end if;
end $$;

-- Card purchases always follow the card's due date.
update public.expenses set payment_day_override = null where type in ('INSTALLMENT', 'OCCASIONAL');

alter table public.expenses drop constraint if exists expenses_check;
alter table public.expenses drop constraint if exists expenses_type_fields_check;
alter table public.expenses add constraint expenses_type_fields_check check (
  case type
    when 'FIXED' then recurrence is not null and category is not null and start_date is not null
      and (recurrence = 'MONTHLY' or charge_month is not null)
    when 'SUBSCRIPTION' then recurrence is not null and start_date is not null
      and (recurrence = 'MONTHLY' or charge_month is not null)
    when 'INSTALLMENT' then payment_day_override is null and installments_count is not null and purchase_date is not null
      and payment_method is not null
      and ((payment_method = 'CREDIT_CARD' and card_id is not null) or (payment_method <> 'CREDIT_CARD' and first_payment_date is not null))
    when 'OCCASIONAL' then payment_day_override is null and purchase_date is not null and payment_method is not null
      and (payment_method <> 'CREDIT_CARD' or card_id is not null)
  end
);
