/**
 * Saves a price snapshot for each KMIALLSHR stock into the Convex
 * priceSnapshots table. Reads prices from data/stocks.json (produced by
 * fetch-psx-data.mjs) so no extra HTTP requests are needed.
 *
 * Usage:
 *   npm run data:fetch          # refresh data/stocks.json first
 *   npm run data:prices         # then run this script
 *
 * Pass --date YYYY-MM-DD to label the snapshot with a specific date
 * (defaults to today). Useful to mark a fiscal-year start:
 *   node scripts/fetch-price-history.mjs --date 2025-07-01
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const dateIdx = args.indexOf("--date");
  const date =
    dateIdx !== -1 && args[dateIdx + 1]
      ? args[dateIdx + 1]
      : new Date().toISOString().slice(0, 10);
  return { date };
}

async function main() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

  const { date } = parseArgs();
  const label = date === new Date().toISOString().slice(0, 10)
    ? `Snapshot ${date}`
    : date === "2025-07-01"
    ? "FY26 start"
    : date === "2024-07-01"
    ? "FY25 start"
    : `Snapshot ${date}`;

  const stocksFile = path.join(process.cwd(), "data", "stocks.json");
  const stocks = JSON.parse(await readFile(stocksFile, "utf8"));

  const client = new ConvexHttpClient(convexUrl);
  const sourceAsOf = new Date().toISOString().slice(0, 10);

  process.stdout.write(
    `Saving price snapshot for ${date} (${label}) — ${stocks.length} stocks...\n`,
  );

  let saved = 0;
  for (const stock of stocks) {
    if (!stock.latestPrice || stock.latestPrice <= 0) continue;
    await client.mutation(api.priceSnapshots.upsert, {
      symbol: stock.symbol,
      date,
      label,
      price: stock.latestPrice,
      sourceAsOf,
    });
    process.stdout.write(`  ${stock.symbol}: Rs ${stock.latestPrice}\n`);
    saved++;
  }

  process.stdout.write(`\nDone. Saved ${saved} snapshots for ${date}.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
