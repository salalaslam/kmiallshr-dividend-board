# Capital Gains & Total Return — Design Spec

**Date:** 2026-04-27  
**Status:** Approved  
**Feature:** New `/capital-gains` page for the KMIALLSHR Dividend Board

---

## Overview

A dedicated Capital Gains page that shows total return (price appreciation + dividend yield) for every KMIALLSHR constituent, plus a personal holdings section where users can enter their own buy price and share count to see their actual P&L. Targeting both personal portfolio tracking and universe-wide research.

---

## Goals

1. Show capital gain % vs a reference date (FY start price) for all KMIALLSHR stocks.
2. Combine capital gain with net dividend yield into a single **Total Return %** metric, ranked across the universe.
3. Allow users to enter personal holdings (stock + buy price + shares) and see their actual rupee P&L and percentage return.
4. Keep the design visually consistent with the existing dividend dashboard (same light theme, fonts, CSS classes).

---

## Architecture

### New files

```
src/
  app/
    capital-gains/
      page.tsx                      ← new Next.js route
  components/
    capital-gains-dashboard.tsx     ← main page component
    nav.tsx                         ← shared top nav (links both pages)

convex/
  priceSnapshots.ts                 ← new query functions
  schema.ts                         ← add priceSnapshots table (updated)

scripts/
  fetch-price-history.mjs           ← new data import script
```

### Existing files changed

| File | Change |
|---|---|
| `convex/schema.ts` | Add `priceSnapshots` table |
| `src/app/layout.tsx` | Add `<Nav />` component |

---

## Data Model

### `priceSnapshots` Convex table

```ts
priceSnapshots: defineTable({
  symbol:        string,   // e.g. "POL"
  date:          string,   // ISO date of the reference snapshot, e.g. "2025-07-01"
  label:         string,   // e.g. "FY26 start"
  price:         number,   // price at that date in PKR
  sourceAsOf:    string,   // date the import ran
}).index("by_symbol", ["symbol"])
  .index("by_date",   ["date"])
```

### Personal holdings — `localStorage` only

```ts
type Holding = {
  symbol:    string;
  buyPrice:  number;
  shares:    number;
};
// Stored as JSON under key: "kmiallshr_holdings"
```

Holdings are never sent to Convex. They persist across browser sessions on the same device but do not sync across devices — appropriate since there is no user authentication.

---

## New Script: `fetch-price-history.mjs`

Fetches the closing price for each KMIALLSHR constituent at a set of reference dates (FY starts) from PSX and upserts into the `priceSnapshots` Convex table.

**Reference dates to fetch:**
- FY26 start: 2025-07-01
- FY25 start: 2024-07-01

**Source:** PSX historical price data endpoint (same domain as existing script: `dps.psx.com.pk`). Reuses the same `fetchText` + retry pattern from `fetch-psx-data.mjs`.

**Run independently** of the existing `fetch-psx-data.mjs` — both scripts are run manually as needed.

---

## Page Layout

### Top Nav (`nav.tsx`)

Sticky header (44px height) with two links:
- **Dividend Board** → `/`
- **Capital Gains** → `/capital-gains` (active state: accent underline)

Shared across both pages via `src/app/layout.tsx`.

### Section 1 — My Holdings (top of page)

**Add holding form** (inline band above the table):
- Stock symbol input
- Buy price (Rs) input
- Shares held input
- "Add holding" button

**Holdings table columns:**
- Stock (symbol + name + FY end)
- Shares
- Buy price
- Current price (from `stocks` Convex table)
- Capital gain (Rs) = (current − buy) × shares
- Capital gain %
- Dividend income (net) = dividend/share × shares × (1 − WHT − Zakat)
- Total P&L (Rs)
- Delete row button

**Holdings summary strip** (below table, 4 cells):
- Total invested
- Capital gain (Rs + %)
- Dividend income net
- Total P&L (Rs + % on cost) — highlighted green

### Section 2 — KMIALLSHR Universe Table (below holdings)

**Control band** (4 columns):
- Reference date selector (FY26 start / FY25 start)
- WHT %
- Zakat %
- Symbol/company search

**Universe table columns:**
- Rank (#)
- Stock (symbol + name + FY end)
- Ref price (from `priceSnapshots`)
- Current price (from `stocks`)
- Capital gain % — green if positive, red if negative
- Div yield net % (from `stocks.summary`)
- **Total return %** — accent color, sorted descending

All KMIALLSHR constituents with a price snapshot are shown. Stocks missing a reference price snapshot show "—" in the ref price and capital gain columns and are ranked last.

---

## Calculations

```
capitalGainPct   = (currentPrice − refPrice) / refPrice × 100
netDivYield      = (totalDividendPerShare / currentPrice) × (1 − wht − zakat) × 100
totalReturn      = capitalGainPct + netDivYield

// Holdings
capitalGainRs    = (currentPrice − buyPrice) × shares
divIncomeNet     = dividendPerShare × shares × (1 − wht − zakat)
totalPnL         = capitalGainRs + divIncomeNet
totalPnLPct      = totalPnL / (buyPrice × shares) × 100
```

WHT and Zakat values come from the control band inputs in Section 2. These inputs apply to **both** the universe table and the holdings P&L — there is a single shared state for WHT % and Zakat %, not separate inputs per section. All values recalculate live as the user changes them.

---

## Design Consistency

Matches the existing dividend dashboard exactly:
- **Theme:** Light, `--background: #eef1f3`, grid pattern background
- **Fonts:** Manrope (body) + IBM Plex Mono (numbers, labels, eyebrows)
- **Components:** Reuse `.shell`, `.market-header`, `.ticker-strip`, `.control-band`, `.table-panel`, `.market-surface`, `.eyebrow`, `.field`, `.stock-cell`, `.metric-stack`
- **Colors:** `--accent: #0f4c81` (links, active nav), `--positive: #067647` (gains), `--negative: #9b1c1c` (losses)
- **No new design tokens** — extend existing CSS only

---

## Out of Scope

- Authentication or multi-device sync for holdings
- Real-time price polling
- Price history charts
- Sector grouping
- Export to CSV

---

## Open Questions — Resolved

| Question | Decision |
|---|---|
| Where are holdings stored? | `localStorage` — no auth, personal data |
| Where does reference price come from? | New `fetch-price-history.mjs` script → Convex |
| Separate page or tab on existing page? | Separate Next.js route `/capital-gains` |
| Holdings on top or bottom? | Holdings on top, universe table below |
| Which reference dates? | FY26 start (1 Jul 2025) and FY25 start (1 Jul 2024) |
