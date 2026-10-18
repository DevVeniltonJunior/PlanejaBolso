# PlanejaBolso

Prototype of a personal financial **planning and projection** app: how much income to expect, how much of it is already committed, and what a new purchase would do to the coming financial cycles.

- React + TypeScript (Vite), hosted on GitHub Pages
- Supabase (Postgres + Auth + Data API) accessed directly from the browser, protected by Row Level Security
- UI in pt-BR, values in BRL

## Project layout

```
src/domain/        Pure projection engine (no React, no Supabase) + tests
  dates.ts         Timezone-safe calendar helpers
  billing.ts       Credit card statements (billing date): closing and due dates
  cycle.ts         Financial cycles and placement of dates/statements into cycles
  salary.ts        Net salary average and salary used per month
  projection.ts    Per-cycle projection — single source of truth
  simulation.ts    Purchase simulator (adds a temporary expense, reuses the engine)
src/data/          Supabase client, row mappers, auth and data contexts
src/pages/         Dashboard, Expenses, Income, Cards, Simulator, Login
supabase/schema.sql  Tables, constraints, grants and RLS policies (fresh install)
supabase/migrations/ Upgrades for databases created from an earlier schema
.github/workflows/deploy.yml  Test → build → publish to GitHub Pages
```

## Financial-cycle model

The dashboard, projections and simulator work in **financial cycles**, not calendar months.

### Cycles

The user's `defaultPaymentDay` (*D*, default 5, set on the Expenses page) is the boundary between cycles. A cycle is named after the month whose income funds it:

- With *D* = 5, the **October cycle** runs from **05/10 to 04/11**, and the bills due on **05/11** are its closing payments.
- The current cycle is the one in progress today. With *D* = 5, on 03/11 you are still in the October cycle.
- *D* is clamped to the month length (31 → 28/29 in February).

Two placement rules, in `src/domain/cycle.ts`:

| Kind of item | Rule | Examples with D = 5 |
| --- | --- | --- |
| **Money spent or received on a date** (Cash/Pix purchases, income) | The cycle in progress on that date: `[D of M, D of M+1)` | Pix on 12/10 → Oct · Pix on 04/11 → Oct · Pix on 05/11 → Nov |
| **Obligations due on a date** (card statements, regular bills, non-card installments) | Due after *D* → that month's cycle; due on or before *D* → closes the previous month's cycle | Due 17/10 → Oct · due 03/11 → Oct · due 05/11 → Oct · due 10/11 → Nov |

Obligations are compared on their nominal day, so a monthly bill lands in exactly one cycle per cycle, including across February and leap years. Every obligation's date falls between the cycle's first day and its closing payment day.

### Billing date vs. financial cycle

These are separate concepts:

1. **Billing date** (`src/domain/billing.ts`). The card's statement is computed only from the purchase date and the card's closing and due days. A statement is identified by its due month. Closing date = due date − *N* days. A purchase **before** closing goes on the upcoming statement, even when that statement is due in the purchase month. A purchase **on or after** closing goes on the following statement. `defaultPaymentDay` never affects this.
2. **Financial cycle** (`placeCardPurchase` in `src/domain/cycle.ts`). The statement's due date is then placed with the obligation rule.

Example with *D* = 5 and a card due on the 5th that closes on 29/10:

| Purchase | Statement (billing) | Cycle that pays it |
| --- | --- | --- |
| 20/10 | due 05/11 | **October** |
| 29/10 (closing day) | due 05/12 | November |
| 30/10 | due 05/12 | **November** |

This is not a "purchase month + 1" rule. A card due on the 25th that closes on the 18th puts a purchase made on 10/10 on the statement due 25/10, which is paid by the October cycle.

### What each item contributes to a cycle

| Item | Date shown | Cycle |
| --- | --- | --- |
| Salary | — | The cycle of its reference month: the net salary recorded for that month, otherwise the average of the latest 6 entries (once there are ≥ 3, or when no fixed salary is set), otherwise the fixed salary |
| Other income | Expected date (monthly / annual / once) | Cycle in progress on that date |
| Fixed expenses / subscriptions | `paymentDayOverride` (e.g. car on day 17) or `defaultPaymentDay` | Obligation rule. Counted only from the start date. Annual expenses use their configured calendar month |
| Card purchase | Statement due date | Obligation rule applied to the statement |
| Card installments | Due date of each consecutive statement | Consecutive cycles from the first statement's cycle |
| Non-card installments | Monthly from the first payment date | Obligation rule |
| Cash / Pix purchase | Purchase date | Cycle in progress on the purchase date |

Future cycles include only registered items. Future occasional spending is not estimated. Income commitment = expected expenses ÷ expected income × 100 (undefined when no income is expected).

All of this is centralized in `src/domain/`: `billing.ts` (statements), `cycle.ts` (cycles), `projection.ts` (per-cycle projection) and `simulation.ts` (adds a temporary purchase and reuses the projection). The dashboard, expense list, card previews, expense form hints and simulator all call these functions. Tests: `billing.test.ts`, `cycle.test.ts`, `projection.test.ts`.

## Running locally

1. Create a free Supabase project.
2. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql). If your database was created from an earlier version, run the files in [`supabase/migrations/`](supabase/migrations/) in order instead (they are safe to re-run).
3. In **Authentication → URL Configuration**, set the **Site URL** to `http://localhost:5173/PlanejaBolso/` for development (and add your GitHub Pages URL to **Redirect URLs**). Optionally disable "Confirm email" under **Authentication → Providers → Email** to skip confirmation during testing.
4. Copy `.env.example` to `.env.local` and fill in the project URL and the **anon / publishable** key (Project Settings → API).
5. Run:

```bash
npm install
npm run dev     # http://localhost:5173/PlanejaBolso/
npm test        # projection engine + page smoke tests
npm run build
```

## Deploying to GitHub Pages

1. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. In **Settings → Secrets and variables → Actions**, add the secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Push to `main`. The workflow installs dependencies, runs the tests, builds with the repository subpath as base, and publishes `dist/`.

The app will be available at `https://<username>.github.io/PlanejaBolso/`. Add that URL to Supabase's Site URL / Redirect URLs.

## Security notes

- The anon/publishable key is embedded in the static build by design; it is **not** a secret. All access control is done by RLS: every table has an `own rows` policy (`user_id = auth.uid()`), `anon` has no table privileges, and `user_id` defaults to `auth.uid()`.
- An expense can only reference a credit card owned by the same user (composite foreign key).
- Never put the `service_role` key in `.env*`, in the workflow, or anywhere in the frontend.
- Cards store only a nickname, due day and closing offset — no number, CVV, expiration or holder data.
- Hash-based routing (`#/despesas`) is used so deep links work on GitHub Pages; auth uses the PKCE flow so the auth callback (`?code=`) does not clash with it.
