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
