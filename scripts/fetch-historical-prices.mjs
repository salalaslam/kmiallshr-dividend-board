/**
 * Fetches closing prices for a specific date from Yahoo Finance (.KA suffix)
 * and seeds them as price snapshots into Convex.
 *
 * Usage:
 *   node scripts/fetch-historical-prices.mjs --date 2025-07-01
 *   node scripts/fetch-historical-prices.mjs --date 2024-07-01
 *
 * If the target date is a weekend or PSX holiday the nearest prior trading
 * day's close is used instead.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const CONCURRENCY = 5;
const DELAY_MS = 120; // stay well under Yahoo rate limits

function parseArgs() {
  const args = process.argv.slice(2);
  const dateIdx = args.indexOf("--date");
  if (dateIdx === -1 || !args[dateIdx + 1]) {
    console.error("Usage: node scripts/fetch-historical-prices.mjs --date YYYY-MM-DD");
    process.exit(1);
  }
  return { date: args[dateIdx + 1] };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function dateLabel(date) {
  if (date === "2025-07-01") return "FY26 start";
  if (date === "2024-07-01") return "FY25 start";
  return `Snapshot ${date}`;
}

/** Returns Unix timestamp (seconds) for midnight UTC on the given YYYY-MM-DD. */
function toUnix(dateStr) {
  return Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
}

/**
 * Fetches the closing price nearest to targetDate for a Yahoo Finance symbol.
 * Looks in a ±4-day window to handle weekends and holidays.
 * Returns null if no data found.
 */
async function fetchClose(yahooSymbol, targetDate) {
  const targetUnix = toUnix(targetDate);
  const from = targetUnix - 4 * 86400;
  const to = targetUnix + 86400; // +1 day buffer

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}` +
    `?interval=1d&period1=${from}&period2=${to}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];

    // Find the entry on or before the target date
    let bestTs = -Infinity;
    let bestClose = null;
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const close = closes[i];
      if (ts <= targetUnix + 86400 && ts > bestTs && close != null) {
        bestTs = ts;
        bestClose = close;
      }
    }
    return bestClose !== null ? Math.round(bestClose * 100) / 100 : null;
  } catch {
    return null;
  }
}

async function runBatch(tasks) {
  return Promise.all(tasks.map((t) => t()));
}

async function main() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

  const { date } = parseArgs();
  const label = dateLabel(date);
  const stocksFile = path.join(process.cwd(), "data", "stocks.json");
  const stocks = JSON.parse(await readFile(stocksFile, "utf8"));

  process.stdout.write(
    `\nFetching historical prices for ${date} (${label}) from Yahoo Finance...\n` +
    `Symbols: ${stocks.length}  Concurrency: ${CONCURRENCY}\n\n`,
  );

  const client = new ConvexHttpClient(convexUrl);
  const sourceAsOf = new Date().toISOString().slice(0, 10);

  let saved = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < stocks.length; i += CONCURRENCY) {
    const batch = stocks.slice(i, i + CONCURRENCY);
    const tasks = batch.map((stock) => async () => {
      const yahooSymbol = `${stock.symbol}.KA`;
      const price = await fetchClose(yahooSymbol, date);
      if (price === null || price <= 0) {
        process.stdout.write(`  ✗ ${stock.symbol.padEnd(10)} — no data\n`);
        failed++;
        return;
      }
      await client.mutation(api.priceSnapshots.upsert, {
        symbol: stock.symbol,
        date,
        label,
        price,
        sourceAsOf,
      });
      process.stdout.write(`  ✓ ${stock.symbol.padEnd(10)} Rs ${price}\n`);
      saved++;
    });

    await runBatch(tasks);
    if (i + CONCURRENCY < stocks.length) await sleep(DELAY_MS);
  }

  process.stdout.write(
    `\nDone. Saved: ${saved}  No data: ${failed}  Date: ${date} (${label})\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
