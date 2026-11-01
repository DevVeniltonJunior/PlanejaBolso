-- Pix/Cash installments store their monthly due day in payment_day_override.
-- Safe to run more than once; existing rows keep null (= the day of first_payment_date).

alter table public.expenses drop constraint if exists expenses_type_fields_check;
alter table public.expenses add constraint expenses_type_fields_check check (
  case type
    when 'FIXED' then recurrence is not null and category is not null and start_date is not null
      and (recurrence = 'MONTHLY' or charge_month is not null)
    when 'SUBSCRIPTION' then recurrence is not null and start_date is not null
      and (recurrence = 'MONTHLY' or charge_month is not null)
    when 'INSTALLMENT' then installments_count is not null and purchase_date is not null and payment_method is not null
      and ((payment_method = 'CREDIT_CARD' and card_id is not null and payment_day_override is null)
        or (payment_method <> 'CREDIT_CARD' and first_payment_date is not null))
    when 'OCCASIONAL' then payment_day_override is null and purchase_date is not null and payment_method is not null
      and (payment_method <> 'CREDIT_CARD' or card_id is not null)
  end
);
