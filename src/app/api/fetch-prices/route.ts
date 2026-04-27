import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";

const CONCURRENCY = 6;
const DELAY_MS = 100;

function toUnix(dateStr: string) {
  return Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
}

async function fetchClose(yahooSymbol: string, targetDate: string): Promise<number | null> {
  const targetUnix = toUnix(targetDate);
  const from = targetUnix - 4 * 86400;
  const to = targetUnix + 86400;
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
    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    let bestTs = -Infinity;
    let bestClose: number | null = null;
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function dateLabel(date: string) {
  if (date === "2025-07-01") return "FY26 start";
  if (date === "2024-07-01") return "FY25 start";
  return `Snapshot ${date}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { date } = body as { date?: string };

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_CONVEX_URL not set" }, { status: 500 });
  }

  const stocksFile = path.join(process.cwd(), "data", "stocks.json");
  const stocks: { symbol: string }[] = JSON.parse(await readFile(stocksFile, "utf8"));

  const client = new ConvexHttpClient(convexUrl);
  const label = dateLabel(date);
  const sourceAsOf = new Date().toISOString().slice(0, 10);

  let saved = 0;
  let failed = 0;

  for (let i = 0; i < stocks.length; i += CONCURRENCY) {
    const batch = stocks.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (stock) => {
        const price = await fetchClose(`${stock.symbol}.KA`, date);
        if (!price || price <= 0) {
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
        saved++;
      }),
    );
    if (i + CONCURRENCY < stocks.length) await sleep(DELAY_MS);
  }

  return NextResponse.json({ saved, failed, date, label });
}
