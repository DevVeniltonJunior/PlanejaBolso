# PlanejaBolso

Prototype of a personal financial **planning and projection** app: how much income to expect, how much of it is already committed, and what a new purchase would do to the coming months.

- React + TypeScript (Vite), hosted on GitHub Pages
- Supabase (Postgres + Auth + Data API) accessed directly from the browser, protected by Row Level Security
- UI in pt-BR, values in BRL

## Project layout

```
src/domain/        Pure projection engine (no React, no Supabase) + tests
  dates.ts         Timezone-safe calendar helpers
  billing.ts       Credit card statement / closing-date logic
  salary.ts        Net salary average and salary used per month
  projection.ts    Monthly projection — single source of truth
  simulation.ts    Purchase simulator (adds a temporary expense, reuses the engine)
src/data/          Supabase client, row mappers, auth and data contexts
src/pages/         Dashboard, Expenses, Income, Cards, Simulator, Login
supabase/schema.sql  Tables, constraints, grants and RLS policies (fresh install)
supabase/migrations/ Upgrades for databases created from an earlier schema
.github/workflows/deploy.yml  Test → build → publish to GitHub Pages
```

## Projection rules

All rules live in `src/domain/billing.ts` and `src/domain/projection.ts` and are shared by the dashboard, expense list, card previews, expense form hints and the simulator.

| Item | When it is paid / which month it counts in |
| --- | --- |
| Salary | Net salary recorded for that month; otherwise the average of the latest 6 entries (once there are ≥ 3 entries, or no fixed salary); otherwise the fixed salary |
| Other income | Monthly: every month from the expected date · Annual: same month every year · Occasional: only that month |
| Fixed expenses / subscriptions | On the expense's `paymentDayOverride`, or the user's `defaultPaymentDay` (default 5). Counted every month (or in the configured month, if annual) whose payment date is on/after the start date |
| Occasional expense | Cash/Pix: purchase date · Credit card: the card's statement due date |
| Installments | Credit card: from the statement of the purchase date, then consecutive statements · Otherwise: monthly from the first payment date |

**Payment days.** `defaultPaymentDay` (user profile) is the day the user normally pays regular bills. A fixed expense or subscription paid on another day (e.g. car financing on the 17th) sets `paymentDayOverride`. Days are clamped to the month length (31 → Feb 28/29). Payment days never affect credit card purchases or Cash/Pix purchases.

**Credit card statements.** A statement is identified by its due month; due date = card due day (clamped), closing date = due date − *N* days. A purchase belongs to the first statement whose closing date is after it — purchase **before** closing → the upcoming statement, even when it is due in the purchase month (e.g. due 25, closing 18: a purchase on the 10th is paid on the 25th of the same month); **on or after** closing → the following statement.

Income commitment = expected expenses ÷ expected income × 100 (undefined when there is no expected income).

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
