# Capital Gains & Total Return — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/capital-gains` page showing price appreciation + net dividend yield (total return) for all KMIALLSHR stocks, with a personal holdings tracker backed by localStorage.

**Architecture:** New Next.js route at `/capital-gains` backed by a new `priceSnapshots` Convex table populated by a new `fetch-price-history.mjs` script. A shared `Nav` component links the two pages. Holdings are stored in localStorage only.

**Tech Stack:** Next.js 16 (App Router), Convex 1.36, React 19, TypeScript, cheerio (scraping), Tailwind CSS v4, IBM Plex Mono + Manrope fonts.

---

## File Map

| Status | File | Purpose |
|--------|------|---------|
| Modify | `convex/schema.ts` | Add `priceSnapshots` table |
| Create | `convex/priceSnapshots.ts` | Convex query: list snapshots by date |
| Create | `scripts/fetch-price-history.mjs` | Scrape PSX historical prices → Convex |
| Modify | `src/app/globals.css` | Add `--negative` token + nav CSS |
| Create | `src/components/nav.tsx` | Shared top nav (client component) |
| Modify | `src/app/layout.tsx` | Mount `<Nav />` above children |
| Create | `src/components/capital-gains-dashboard.tsx` | Full page component |
| Create | `src/app/capital-gains/page.tsx` | Next.js route shell |
| Modify | `package.json` | Add `data:prices` script |

---

## Task 1 — Extend Convex Schema

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Open schema and add priceSnapshots table**

Replace the contents of `convex/schema.ts` with:

```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const fySummary = v.object({
  payoutCount: v.number(),
  intervalLabel: v.string(),
  totalDividendPercent: v.number(),
  totalDividendPerShare: v.number(),
});

export default defineSchema({
  stocks: defineTable({
    symbol: v.string(),
    name: v.string(),
    latestPrice: v.number(),
    fiscalYearEndLabel: v.string(),
    fiscalYearEndMonth: v.number(),
    sourceAsOf: v.string(),
    companyUrl: v.string(),
    indexUrl: v.string(),
    faceValueAssumption: v.number(),
    summary: v.object({
      fy24: fySummary,
      fy25: fySummary,
      fy26: fySummary,
    }),
    payouts: v.array(
      v.object({
        announcedAt: v.string(),
        periodLabel: v.string(),
        periodEnd: v.string(),
        detail: v.string(),
        bookClosure: v.string(),
        fiscalYear: v.number(),
        dividendPercent: v.number(),
        dividendPerShare: v.number(),
      }),
    ),
  }).index("by_symbol", ["symbol"]),

  priceSnapshots: defineTable({
    symbol: v.string(),
    date: v.string(),
    label: v.string(),
    price: v.number(),
    sourceAsOf: v.string(),
  })
    .index("by_symbol", ["symbol"])
    .index("by_date", ["date"]),
});
```

- [ ] **Step 2: Verify Convex dev server picks up schema change**

Run in a terminal (if not already running):
```bash
npx convex dev
```
Expected: Convex prints schema sync success. No errors about unknown tables.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat: add priceSnapshots table to Convex schema"
```

---

## Task 2 — Convex Query for Price Snapshots

**Files:**
- Create: `convex/priceSnapshots.ts`

- [ ] **Step 1: Create the query file**

Create `convex/priceSnapshots.ts`:

```ts
import { query } from "./_generated/server";
import { v } from "convex/values";

export const listByDate = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    return ctx.db
      .query("priceSnapshots")
      .withIndex("by_date", (q) => q.eq("date", date))
      .collect();
  },
});
```

- [ ] **Step 2: Verify Convex regenerates API types**

After saving, Convex dev server regenerates `convex/_generated/api.d.ts`.
Check it includes `priceSnapshots` namespace — run:
```bash
grep -n "priceSnapshots" convex/_generated/api.d.ts
```
Expected: at least one line mentioning `priceSnapshots`.

- [ ] **Step 3: Commit**

```bash
git add convex/priceSnapshots.ts
git commit -m "feat: add priceSnapshots Convex query"
```

---

## Task 3 — Price History Fetch Script

**Files:**
- Create: `scripts/fetch-price-history.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create the script**

Create `scripts/fetch-price-history.mjs`:

```js
import process from "node:process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const INDEX_URL = "https://dps.psx.com.pk/indices/KMIALLSHR";

const REFERENCE_DATES = [
  { date: "2025-07-01", label: "FY26 start" },
  { date: "2024-07-01", label: "FY25 start" },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, options = {}, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          "user-agent": "kmiallshr-data-import/1.0",
          ...(options.headers ?? {}),
        },
      });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      await sleep(500 * attempt);
    }
  }
  throw lastError;
}

async function fetchHistoricalClose(symbol, isoDate) {
  const dayStart = Math.floor(new Date(`${isoDate}T00:00:00Z`).getTime() / 1000);
  const dayEnd = dayStart + 86400;
  const url = `https://dps.psx.com.pk/timeseries?type=ohlcv&format=json&symbol=${encodeURIComponent(symbol)}&from=${dayStart}&to=${dayEnd}`;

  try {
    const text = await fetchText(url);
    const json = JSON.parse(text);
    // PSX returns { data: [[timestamp, open, high, low, close, volume], ...] }
    const rows = json?.data ?? [];
    if (rows.length === 0) return null;
    // Use the last row's close price (index 4)
    const close = rows[rows.length - 1][4];
    return typeof close === "number" ? close : null;
  } catch {
    return null;
  }
}

async function fetchCurrentConstituents() {
  const { load } = await import("cheerio");
  const html = await fetchText(INDEX_URL);
  const $ = load(html);
  const symbols = [];
  $('h2:contains("KMIALLSHR Constituents")')
    .nextAll("div.tbl__wrapper")
    .first()
    .find("tbody tr")
    .each((_, row) => {
      const symbol = $(row).find("td").first().attr("data-order");
      if (symbol) symbols.push(symbol);
    });
  return symbols;
}

async function main() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set in environment");

  const client = new ConvexHttpClient(convexUrl);
  const sourceAsOf = new Date().toISOString().slice(0, 10);

  process.stdout.write("Fetching KMIALLSHR constituents...\n");
  const symbols = await fetchCurrentConstituents();
  process.stdout.write(`Found ${symbols.length} constituents.\n`);

  for (const refDate of REFERENCE_DATES) {
    process.stdout.write(`\nFetching prices for ${refDate.label} (${refDate.date})...\n`);
    let saved = 0;
    let missing = 0;

    for (const symbol of symbols) {
      const price = await fetchHistoricalClose(symbol, refDate.date);
      if (price === null) {
        process.stdout.write(`  ${symbol}: no data — skipped\n`);
        missing++;
        continue;
      }
      await client.mutation(api.priceSnapshots.upsert, {
        symbol,
        date: refDate.date,
        label: refDate.label,
        price,
        sourceAsOf,
      });
      process.stdout.write(`  ${symbol}: Rs ${price}\n`);
      saved++;
      await sleep(120);
    }
    process.stdout.write(`  Saved ${saved}, skipped ${missing}\n`);
  }

  process.stdout.write("\nDone.\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add upsert mutation to `convex/priceSnapshots.ts`**

Replace `convex/priceSnapshots.ts` with:

```ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listByDate = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    return ctx.db
      .query("priceSnapshots")
      .withIndex("by_date", (q) => q.eq("date", date))
      .collect();
  },
});

export const upsert = mutation({
  args: {
    symbol: v.string(),
    date: v.string(),
    label: v.string(),
    price: v.number(),
    sourceAsOf: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("priceSnapshots")
      .withIndex("by_symbol", (q) => q.eq("symbol", args.symbol))
      .filter((q) => q.eq(q.field("date"), args.date))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { price: args.price, sourceAsOf: args.sourceAsOf });
    } else {
      await ctx.db.insert("priceSnapshots", args);
    }
  },
});
```

- [ ] **Step 3: Add script to `package.json`**

In `package.json`, add to `"scripts"`:
```json
"data:prices": "node scripts/fetch-price-history.mjs"
```

The full scripts block becomes:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "data:fetch": "node scripts/fetch-psx-data.mjs",
  "data:prices": "node scripts/fetch-price-history.mjs",
  "seed:dev": "npx convex import --table stocks --replace --yes data/stocks.json",
  "seed:prod": "npx convex import --prod --table stocks --replace --yes data/stocks.json"
}
```

- [ ] **Step 4: Load .env and run the script**

```bash
source .env.local && npm run data:prices
```

Expected: terminal shows each symbol with a price or "skipped". At least some symbols should have prices. If PSX historical API returns no data (market holidays, old dates), many will be skipped — that is acceptable; the UI shows "—" for missing snapshots.

- [ ] **Step 5: Commit**

```bash
git add convex/priceSnapshots.ts scripts/fetch-price-history.mjs package.json
git commit -m "feat: add price history fetch script and upsert mutation"
```

---

## Task 4 — Global CSS: Nav Styles + Negative Color Token

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add `--negative` token and nav styles**

In `src/app/globals.css`, add the `--negative` and `--negative-soft` CSS variables inside `:root`:

```css
--negative: #9b1c1c;
--negative-soft: #fef2f2;
```

Then append the following at the end of the file:

```css
/* ── Top Nav ── */
.top-nav {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 1.2rem;
  background: rgba(248, 250, 251, 0.97);
  border-bottom: 1px solid var(--line-strong);
  backdrop-filter: blur(8px);
  box-shadow: 0 1px 4px rgba(17, 24, 32, 0.06);
}

.top-nav .brand {
  margin-right: 2rem;
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.top-nav a {
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 1rem;
  border-bottom: 2px solid transparent;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-decoration: none;
  text-transform: uppercase;
  transition: color 0.15s, border-color 0.15s;
}

.top-nav a:hover {
  color: var(--foreground);
}

.top-nav a.active {
  border-bottom-color: var(--accent);
  color: var(--accent);
  font-weight: 700;
}

/* ── Capital gains color helpers ── */
.gain-pos {
  color: var(--positive);
  font-weight: 700;
}

.gain-neg {
  color: var(--negative);
  font-weight: 700;
}

.total-ret-cell {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 0.92rem;
  font-weight: 800;
}

/* ── Holdings add band ── */
.add-holding-band {
  display: grid;
  grid-template-columns: minmax(180px, 1.4fr) minmax(130px, 0.6fr) minmax(130px, 0.6fr) auto;
  border-top: 1px solid var(--line);
  background: #f2f5f7;
}

.add-holding-band .field {
  padding: 0.65rem 0.82rem;
  border-right: 1px solid var(--line);
}

.add-btn-cell {
  display: flex;
  align-items: flex-end;
  padding: 0.65rem 0.82rem;
}

.add-btn {
  height: 42px;
  padding: 0 1.1rem;
  border: 0;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 700;
  transition: background 0.15s;
  white-space: nowrap;
}

.add-btn:hover {
  background: #0a3460;
}

.add-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ── Holdings delete button ── */
.holding-delete {
  padding: 0.3rem 0.5rem;
  border: 0;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
  font-size: 0.9rem;
  transition: color 0.15s;
}

.holding-delete:hover {
  color: var(--negative);
}

@media (max-width: 820px) {
  .add-holding-band {
    grid-template-columns: 1fr 1fr;
  }
}
```

- [ ] **Step 2: Verify dev server compiles without error**

```bash
npm run dev
```
Expected: compiles clean, no CSS errors in terminal.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: add nav and capital gains CSS tokens"
```

---

## Task 5 — Nav Component + Layout Update

**Files:**
- Create: `src/components/nav.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create `src/components/nav.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="top-nav">
      <span className="brand">PSX Board</span>
      <Link href="/" className={pathname === "/" ? "active" : ""}>
        Dividend Board
      </Link>
      <Link
        href="/capital-gains"
        className={pathname === "/capital-gains" ? "active" : ""}
      >
        Capital Gains
      </Link>
    </nav>
  );
}
```

- [ ] **Step 2: Update `src/app/layout.tsx` to mount Nav**

Replace `src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { siteMetadata } from "@/lib/metadata";
import { ConvexClientProvider } from "./convex-client-provider";
import { Nav } from "@/components/nav";

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: siteMetadata.title,
  description: siteMetadata.description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${manrope.variable} ${plexMono.variable} h-full`}
    >
      <body className="min-h-full">
        <ConvexClientProvider>
          <Nav />
          {children}
        </ConvexClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Open browser at http://localhost:3000**

Expected: both pages now show the sticky top nav with "Dividend Board" and "Capital Gains" links. The active link has an accent underline. Existing dividend dashboard still renders correctly below the nav.

- [ ] **Step 4: Commit**

```bash
git add src/components/nav.tsx src/app/layout.tsx
git commit -m "feat: add shared Nav component to root layout"
```

---

## Task 6 — Capital Gains Dashboard Component

**Files:**
- Create: `src/components/capital-gains-dashboard.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/capital-gains-dashboard.tsx`:

```tsx
"use client";

import { useQuery } from "convex/react";
import { useState, useEffect, useCallback } from "react";
import { api } from "../../convex/_generated/api";

type Holding = {
  symbol: string;
  buyPrice: number;
  shares: number;
};

const REFERENCE_OPTIONS = [
  { date: "2025-07-01", label: "FY26 start — 1 Jul 2025" },
  { date: "2024-07-01", label: "FY25 start — 1 Jul 2024" },
];

const HOLDINGS_KEY = "kmiallshr_holdings";

function formatCurrency(value: number, digits = 2) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number, digits = 2) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function loadHoldings(): Holding[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(HOLDINGS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveHoldings(holdings: Holding[]) {
  localStorage.setItem(HOLDINGS_KEY, JSON.stringify(holdings));
}

export function CapitalGainsDashboard() {
  const [refDateIndex, setRefDateIndex] = useState(0);
  const [wht, setWht] = useState("15");
  const [zakat, setZakat] = useState("0");
  const [search, setSearch] = useState("");

  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [newSymbol, setNewSymbol] = useState("");
  const [newBuyPrice, setNewBuyPrice] = useState("");
  const [newShares, setNewShares] = useState("");

  useEffect(() => {
    setHoldings(loadHoldings());
  }, []);

  const refDate = REFERENCE_OPTIONS[refDateIndex];
  const stocks = useQuery(api.stocks.list);
  const snapshots = useQuery(api.priceSnapshots.listByDate, { date: refDate.date });

  const snapshotMap = new Map(snapshots?.map((s) => [s.symbol, s.price]) ?? []);
  const stockMap = new Map(stocks?.map((s) => [s.symbol, s]) ?? []);

  const whtRate = Math.max(toNumber(wht), 0) / 100;
  const zakatRate = Math.max(toNumber(zakat), 0) / 100;
  const deduction = Math.min(whtRate + zakatRate, 1);

  // ── Universe rows ──
  const term = search.trim().toLowerCase();
  const universeRows = (stocks ?? [])
    .map((stock) => {
      const refPrice = snapshotMap.get(stock.symbol) ?? null;
      const currentPrice = stock.latestPrice;
      const capitalGainPct =
        refPrice !== null && refPrice > 0
          ? ((currentPrice - refPrice) / refPrice) * 100
          : null;
      const divPerShare = stock.summary.fy26.totalDividendPerShare;
      const netDivYield =
        currentPrice > 0
          ? (divPerShare / currentPrice) * (1 - deduction) * 100
          : 0;
      const totalReturn =
        capitalGainPct !== null ? capitalGainPct + netDivYield : null;

      return {
        id: stock._id,
        symbol: stock.symbol,
        name: stock.name,
        fiscalYearEndLabel: stock.fiscalYearEndLabel,
        companyUrl: stock.companyUrl,
        refPrice,
        currentPrice,
        capitalGainPct,
        netDivYield,
        totalReturn,
      };
    })
    .filter((row) => {
      if (!term) return true;
      return (
        row.symbol.toLowerCase().includes(term) ||
        row.name.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => {
      // Stocks with no snapshot go last
      if (a.totalReturn === null && b.totalReturn === null) return 0;
      if (a.totalReturn === null) return 1;
      if (b.totalReturn === null) return -1;
      return b.totalReturn - a.totalReturn;
    });

  // ── Holdings rows ──
  const holdingRows = holdings.map((h) => {
    const stock = stockMap.get(h.symbol);
    const currentPrice = stock?.latestPrice ?? 0;
    const divPerShare = stock?.summary.fy26.totalDividendPerShare ?? 0;
    const capitalGainRs = (currentPrice - h.buyPrice) * h.shares;
    const capitalGainPct =
      h.buyPrice > 0 ? ((currentPrice - h.buyPrice) / h.buyPrice) * 100 : 0;
    const divIncomeNet = divPerShare * h.shares * (1 - deduction);
    const totalPnL = capitalGainRs + divIncomeNet;
    const costBasis = h.buyPrice * h.shares;
    const totalPnLPct = costBasis > 0 ? (totalPnL / costBasis) * 100 : 0;

    return {
      ...h,
      stockName: stock?.name ?? h.symbol,
      fiscalYearEndLabel: stock?.fiscalYearEndLabel ?? "—",
      companyUrl: stock?.companyUrl ?? "#",
      currentPrice,
      capitalGainRs,
      capitalGainPct,
      divIncomeNet,
      totalPnL,
      costBasis,
      totalPnLPct,
    };
  });

  const totalInvested = holdingRows.reduce((s, r) => s + r.costBasis, 0);
  const totalCapGain = holdingRows.reduce((s, r) => s + r.capitalGainRs, 0);
  const totalDivIncome = holdingRows.reduce((s, r) => s + r.divIncomeNet, 0);
  const totalPnL = holdingRows.reduce((s, r) => s + r.totalPnL, 0);
  const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
  const totalCapGainPct =
    totalInvested > 0 ? (totalCapGain / totalInvested) * 100 : 0;

  const addHolding = useCallback(() => {
    const sym = newSymbol.trim().toUpperCase();
    const bp = toNumber(newBuyPrice);
    const sh = toNumber(newShares);
    if (!sym || bp <= 0 || sh <= 0) return;
    const updated = [...holdings, { symbol: sym, buyPrice: bp, shares: sh }];
    setHoldings(updated);
    saveHoldings(updated);
    setNewSymbol("");
    setNewBuyPrice("");
    setNewShares("");
  }, [holdings, newSymbol, newBuyPrice, newShares]);

  const removeHolding = useCallback(
    (index: number) => {
      const updated = holdings.filter((_, i) => i !== index);
      setHoldings(updated);
      saveHoldings(updated);
    },
    [holdings],
  );

  if (!stocks || !snapshots) {
    return (
      <div className="shell">
        <div className="loading-panel market-surface">
          <p className="eyebrow">Loading dataset</p>
          <h1>Pulling KMIALLSHR data from Convex.</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      {/* ── Page Header ── */}
      <header className="market-header">
        <div className="market-title">
          <p className="eyebrow text-xs">PSX · KMIALLSHR</p>
          <h1>Capital Gains Monitor</h1>
          <p className="lede text-sm">
            Track price appreciation alongside dividend income for every
            KMIALLSHR constituent. Enter your personal holdings above the
            universe table to see your actual P&amp;L.
          </p>
        </div>
        <div className="market-meta">
          <div>
            <span className="stat-label">Reference date</span>
            <strong>{refDate.date}</strong>
          </div>
          <div>
            <span className="stat-label">Universe</span>
            <strong>KMIALLSHR</strong>
          </div>
        </div>
      </header>

      {/* ── Section 1: My Holdings ── */}
      <section className="table-panel market-surface" style={{ marginTop: "0.85rem" }}>
        <div className="table-header">
          <div>
            <p className="eyebrow text-xs">Personal</p>
            <h2>My Holdings &amp; P&amp;L</h2>
          </div>
          <p className="methodology text-xs">
            Enter your buy price and share count. Saved locally in your browser
            — never sent to any server.
          </p>
        </div>

        {/* Add holding band */}
        <div className="add-holding-band">
          <div className="field">
            <span className="text-xs">Stock symbol</span>
            <input
              className="text-sm"
              placeholder="e.g. POL"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addHolding()}
            />
          </div>
          <div className="field" style={{ padding: "0.65rem 0.82rem", borderRight: "1px solid var(--line)" }}>
            <span className="text-xs">Buy price (Rs)</span>
            <input
              className="text-sm"
              inputMode="decimal"
              placeholder="520.00"
              value={newBuyPrice}
              onChange={(e) => setNewBuyPrice(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addHolding()}
            />
          </div>
          <div className="field" style={{ padding: "0.65rem 0.82rem", borderRight: "1px solid var(--line)" }}>
            <span className="text-xs">Shares held</span>
            <input
              className="text-sm"
              inputMode="numeric"
              placeholder="500"
              value={newShares}
              onChange={(e) => setNewShares(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addHolding()}
            />
          </div>
          <div className="add-btn-cell">
            <button
              type="button"
              className="add-btn"
              onClick={addHolding}
              disabled={!newSymbol.trim() || toNumber(newBuyPrice) <= 0 || toNumber(newShares) <= 0}
            >
              + Add holding
            </button>
          </div>
        </div>

        {holdings.length === 0 ? (
          <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--ink-muted)", fontSize: "0.86rem" }}>
            No holdings yet. Enter a symbol, buy price, and share count above.
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="text-sm">
                <thead>
                  <tr>
                    <th>Stock</th>
                    <th>Shares</th>
                    <th>Buy price</th>
                    <th>Current price</th>
                    <th>Capital gain (Rs)</th>
                    <th>Capital gain %</th>
                    <th>Dividend income (net)</th>
                    <th>Total P&amp;L</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {holdingRows.map((row, i) => (
                    <tr key={`${row.symbol}-${i}`}>
                      <td>
                        <div className="stock-cell text-sm">
                          <a href={row.companyUrl} target="_blank" rel="noreferrer">
                            {row.symbol}
                          </a>
                          <div className="text-xs">
                            <strong>{row.stockName}</strong>
                            <span>FY end: {row.fiscalYearEndLabel}</span>
                          </div>
                        </div>
                      </td>
                      <td>{row.shares.toLocaleString("en-PK")}</td>
                      <td>{formatCurrency(row.buyPrice)}</td>
                      <td>{formatCurrency(row.currentPrice)}</td>
                      <td className={row.capitalGainRs >= 0 ? "gain-pos" : "gain-neg"}>
                        {formatCurrency(row.capitalGainRs, 0)}
                      </td>
                      <td className={row.capitalGainPct >= 0 ? "gain-pos" : "gain-neg"}>
                        {formatPercent(row.capitalGainPct)}
                      </td>
                      <td>{formatCurrency(row.divIncomeNet, 0)}</td>
                      <td>
                        <div className="metric-stack text-sm">
                          <strong className={row.totalPnL >= 0 ? "gain-pos" : "gain-neg"}>
                            {formatCurrency(row.totalPnL, 0)}
                          </strong>
                          <span className="text-xs">{formatPercent(row.totalPnLPct)} on cost</span>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="holding-delete"
                          onClick={() => removeHolding(i)}
                          aria-label={`Remove ${row.symbol}`}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Holdings summary strip */}
            <div className="ticker-strip" style={{ borderTop: "1px solid var(--line-strong)" }}>
              <div className="ticker-item">
                <span className="stat-label">Total invested</span>
                <strong>{formatCurrency(totalInvested, 0)}</strong>
                <span className="text-xs">{holdings.length} holding{holdings.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="ticker-item">
                <span className="stat-label">Capital gain</span>
                <strong style={{ color: totalCapGain >= 0 ? "var(--positive)" : "var(--negative)" }}>
                  {formatCurrency(totalCapGain, 0)}
                </strong>
                <span className="text-xs">{formatPercent(totalCapGainPct)} on cost</span>
              </div>
              <div className="ticker-item">
                <span className="stat-label">Dividend income (net)</span>
                <strong>{formatCurrency(totalDivIncome, 0)}</strong>
                <span className="text-xs">After WHT &amp; Zakat</span>
              </div>
              <div className="ticker-item is-primary">
                <span className="stat-label">Total P&amp;L</span>
                <strong>{formatCurrency(totalPnL, 0)}</strong>
                <span className="text-xs">{formatPercent(totalPnLPct)} on cost</span>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── Section 2: Universe Table ── */}
      <div className="control-band" style={{ marginTop: "0.85rem" }}>
        <div className="control-group fiscal-group">
          <div className="control-heading">
            <p className="eyebrow text-xs">Reference date</p>
            <h2>Price baseline</h2>
          </div>
          <div className="tab-row" role="tablist" aria-label="Reference date tabs" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {REFERENCE_OPTIONS.map((opt, i) => (
              <button
                key={opt.date}
                type="button"
                role="tab"
                aria-selected={refDateIndex === i}
                className={refDateIndex === i ? "tab text-sm is-active" : "tab text-sm"}
                onClick={() => setRefDateIndex(i)}
              >
                <span>{opt.date}</span>
                <small className="text-xs">{i === 0 ? "FY26 start" : "FY25 start"}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="control-group search-group">
          <div className="control-heading">
            <p className="eyebrow text-xs">Search</p>
            <h2>Symbol or company</h2>
          </div>
          <label className="field">
            <span className="text-xs">Ticker lookup</span>
            <input
              className="text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="POL, MEBL, ENGRO…"
            />
          </label>
        </div>

        <div className="control-group assumption-group">
          <div className="control-heading">
            <p className="eyebrow text-xs">Deductions</p>
            <h2>WHT &amp; Zakat</h2>
          </div>
          <div className="field-grid">
            <label className="field">
              <span className="text-xs">WHT (%)</span>
              <input
                className="text-sm"
                inputMode="decimal"
                value={wht}
                onChange={(e) => setWht(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="text-xs">Zakat (%)</span>
              <input
                className="text-sm"
                inputMode="decimal"
                value={zakat}
                onChange={(e) => setZakat(e.target.value)}
              />
            </label>
          </div>
        </div>
      </div>

      <section className="table-panel market-surface">
        <div className="table-header">
          <div>
            <p className="eyebrow text-xs">Full universe · ranked by total return</p>
            <h2>KMIALLSHR — All constituents</h2>
          </div>
          <p className="methodology text-xs">
            Total return = capital gain % (vs {refDate.date}) + net dividend
            yield (FY26 YTD). Stocks without a price snapshot are ranked last
            and show — in gain columns.
          </p>
        </div>

        <div className="table-wrap">
          <table className="text-sm">
            <thead>
              <tr>
                <th>#</th>
                <th>Stock</th>
                <th>Ref price</th>
                <th>Current price</th>
                <th>Capital gain %</th>
                <th>Div yield (net)</th>
                <th>Total return %</th>
              </tr>
            </thead>
            <tbody>
              {universeRows.map((row, i) => (
                <tr key={row.id}>
                  <td style={{ color: "var(--ink-muted)" }}>{i + 1}</td>
                  <td>
                    <div className="stock-cell text-sm">
                      <a href={row.companyUrl} target="_blank" rel="noreferrer">
                        {row.symbol}
                      </a>
                      <div className="text-xs">
                        <strong>{row.name}</strong>
                        <span>FY end: {row.fiscalYearEndLabel}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    {row.refPrice !== null ? formatCurrency(row.refPrice) : "—"}
                  </td>
                  <td>{formatCurrency(row.currentPrice)}</td>
                  <td>
                    {row.capitalGainPct !== null ? (
                      <span className={row.capitalGainPct >= 0 ? "gain-pos" : "gain-neg"}>
                        {formatPercent(row.capitalGainPct)}
                      </span>
                    ) : (
                      <span style={{ color: "var(--ink-muted)" }}>—</span>
                    )}
                  </td>
                  <td style={{ color: "var(--accent)", fontWeight: 600 }}>
                    {formatPercent(row.netDivYield)}
                  </td>
                  <td>
                    {row.totalReturn !== null ? (
                      <span className="total-ret-cell">
                        {formatPercent(row.totalReturn)}
                      </span>
                    ) : (
                      <span style={{ color: "var(--ink-muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/capital-gains-dashboard.tsx
git commit -m "feat: add CapitalGainsDashboard component"
```

---

## Task 7 — Next.js Route

**Files:**
- Create: `src/app/capital-gains/page.tsx`

- [ ] **Step 1: Create the route**

Create `src/app/capital-gains/page.tsx`:

```tsx
import { CapitalGainsDashboard } from "@/components/capital-gains-dashboard";

export default function CapitalGainsPage() {
  return <CapitalGainsDashboard />;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/capital-gains/page.tsx
git commit -m "feat: add /capital-gains Next.js route"
```

---

## Task 8 — Browser Verification

No automated test framework exists in this project. Verification is manual.

- [ ] **Step 1: Ensure dev server is running**

```bash
npm run dev
```
Expected: `✓ Ready on http://localhost:3000`

- [ ] **Step 2: Verify nav appears on dividend board**

Open http://localhost:3000

Check:
- Sticky nav visible with "PSX Board" brand + "Dividend Board" (active, accent underline) + "Capital Gains"
- Existing dividend dashboard renders correctly below nav — no layout shift

- [ ] **Step 3: Verify capital gains page loads**

Open http://localhost:3000/capital-gains

Check:
- Page header shows "Capital Gains Monitor"
- My Holdings section is empty with placeholder text
- Universe table shows all KMIALLSHR stocks
- Stocks with price snapshots show ref price and capital gain %
- Stocks without snapshots show "—" in those columns and appear last

- [ ] **Step 4: Test adding a holding**

In the My Holdings form:
- Type `POL` in symbol, `520` in buy price, `500` in shares → click "Add holding"
- Holding row appears with capital gain, dividend income, total P&L calculated
- Summary strip updates (Total invested, Capital gain, Dividend income, Total P&L)

- [ ] **Step 5: Test persistence**

- Add another holding (e.g. `MEBL`, `295`, `1000`)
- Refresh the page
- Both holdings should still be present (loaded from localStorage)

- [ ] **Step 6: Test remove holding**

- Click ✕ on one holding
- Row disappears, summary strip recalculates
- Refresh — removed holding stays gone

- [ ] **Step 7: Test WHT / Zakat controls**

- Change WHT from 15 to 25
- Holdings P&L and universe div yield column should update live

- [ ] **Step 8: Test reference date toggle**

- Switch between FY26 start and FY25 start tabs
- Ref price column, capital gain %, and total return % should update

- [ ] **Step 9: Test search**

- Type `pol` in the search box
- Universe table filters to matching stocks only

- [ ] **Step 10: Verify nav active state on both pages**

- On `/`: "Dividend Board" link has accent underline, "Capital Gains" is muted
- On `/capital-gains`: "Capital Gains" link has accent underline, "Dividend Board" is muted

- [ ] **Step 11: Final commit**

```bash
git add .
git commit -m "feat: complete capital gains page implementation"
```
