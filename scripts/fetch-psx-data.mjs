import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { load } from "cheerio";

const INDEX_URL = "https://dps.psx.com.pk/indices/KMIALLSHR";
const PAYOUTS_URL = "https://dps.psx.com.pk/company/payouts";
const COMPANY_URL = "https://dps.psx.com.pk/company";
const FACE_VALUE_ASSUMPTION = 10;
const FY_TARGETS = [2024, 2025, 2026];
const CONCURRENCY = 3;

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function clean(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, options = {}, attempts = 4) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "user-agent": "kmiallshr-data-import/1.0",
          ...(options.headers ?? {}),
        },
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${url}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      await sleep(500 * attempt);
    }
  }

  throw lastError;
}

function parseIndexConstituents(html) {
  const $ = load(html);
  const rows = [];

  $('h2:contains("KMIALLSHR Constituents")')
    .nextAll("div.tbl__wrapper")
    .first()
    .find("tbody tr")
    .each((_, row) => {
      const cells = $(row).find("td");
      const symbol = $(cells[0]).attr("data-order");
      const name = clean($(cells[1]).text());
      const latestPrice = Number(clean($(cells[2]).text()).replaceAll(",", ""));

      if (!symbol || !name || Number.isNaN(latestPrice)) {
        return;
      }

      rows.push({
        symbol,
        name,
        latestPrice,
      });
    });

  return rows;
}

function parseAnnouncementDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePeriodEnd(periodLabel, announcedAt) {
  const match = periodLabel.match(/(\d{2}\/\d{2}\/\d{4})/);

  if (match) {
    const [day, month, year] = match[1].split("/").map(Number);
    return { day, month, year, raw: match[1] };
  }

  if (announcedAt) {
    return {
      day: announcedAt.getUTCDate(),
      month: announcedAt.getUTCMonth() + 1,
      year: announcedAt.getUTCFullYear(),
      raw: announcedAt.toISOString().slice(0, 10),
    };
  }

  return null;
}

function fiscalYearFromPeriod(periodEnd, fiscalYearEndMonth) {
  return periodEnd.month <= fiscalYearEndMonth
    ? periodEnd.year
    : periodEnd.year + 1;
}

function extractDividendPercent(detail) {
  if (!detail.includes("(D)")) {
    return 0;
  }

  const match = detail.match(/([\d.]+)%/);
  return match ? Number(match[1]) : 0;
}

function intervalLabelForCount(count) {
  if (count <= 0) return "";
  if (count === 1) return "Single";
  if (count === 2) return "Biannual";
  if (count === 3) return "Triannual";
  if (count === 4) return "Quarterly";
  return `${count} payouts`;
}

function zeroSummary() {
  return {
    payoutCount: 0,
    intervalLabel: "",
    totalDividendPercent: 0,
    totalDividendPerShare: 0,
  };
}

function round(value) {
  return Number(value.toFixed(4));
}

async function fetchCompanyPayouts(symbol) {
  const html = await fetchText(PAYOUTS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `symbol=${encodeURIComponent(symbol)}`,
  });

  const $ = load(html);
  const rows = [];

  $("tbody tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((__, cell) => clean($(cell).text()))
      .get();

    if (cells.length < 4) {
      return;
    }

    rows.push({
      announcedAtLabel: cells[0],
      periodLabel: cells[1],
      detail: cells[2],
      bookClosure: cells[3],
    });
  });

  return rows;
}

async function fetchFiscalYearEnd(symbol) {
  const html = await fetchText(`${COMPANY_URL}/${symbol}`);
  const $ = load(html);
  let fiscalYearEndLabel = "June";

  $("div.item__head").each((_, head) => {
    if (clean($(head).text()) === "Fiscal Year End") {
      fiscalYearEndLabel = clean($(head).next("p").text()) || "June";
    }
  });

  const fiscalYearEndMonth = MONTHS[fiscalYearEndLabel.toLowerCase()] ?? 6;

  return {
    fiscalYearEndLabel,
    fiscalYearEndMonth,
  };
}

async function buildStockRecord(stock, sourceAsOf) {
  const payoutRows = await fetchCompanyPayouts(stock.symbol);
  const dividendRows = payoutRows.filter((row) => row.detail.includes("(D)"));

  if (dividendRows.length === 0) {
    return null;
  }

  const fiscal = await fetchFiscalYearEnd(stock.symbol);
  const summaryBuckets = {
    2024: [],
    2025: [],
    2026: [],
  };

  const payouts = [];

  for (const row of dividendRows) {
    const announcedAt = parseAnnouncementDate(row.announcedAtLabel);
    const periodEnd = parsePeriodEnd(row.periodLabel, announcedAt);

    if (!periodEnd) {
      continue;
    }

    const fiscalYear = fiscalYearFromPeriod(
      periodEnd,
      fiscal.fiscalYearEndMonth,
    );

    if (!FY_TARGETS.includes(fiscalYear)) {
      continue;
    }

    const dividendPercent = extractDividendPercent(row.detail);
    if (!dividendPercent) {
      continue;
    }

    const dividendPerShare =
      (dividendPercent / 100) * FACE_VALUE_ASSUMPTION;

    const payout = {
      announcedAt:
        announcedAt?.toISOString().slice(0, 10) ?? row.announcedAtLabel,
      periodLabel: row.periodLabel,
      periodEnd: periodEnd.raw,
      detail: row.detail,
      bookClosure: row.bookClosure,
      fiscalYear,
      dividendPercent: round(dividendPercent),
      dividendPerShare: round(dividendPerShare),
    };

    payouts.push(payout);
    summaryBuckets[fiscalYear].push(payout);
  }

  if (payouts.length === 0) {
    return null;
  }

  const summary = {
    fy24: zeroSummary(),
    fy25: zeroSummary(),
    fy26: zeroSummary(),
  };

  for (const [fy, key] of [
    [2024, "fy24"],
    [2025, "fy25"],
    [2026, "fy26"],
  ]) {
    const items = summaryBuckets[fy];
    summary[key] = {
      payoutCount: items.length,
      intervalLabel: intervalLabelForCount(items.length),
      totalDividendPercent: round(
        items.reduce((sum, item) => sum + item.dividendPercent, 0),
      ),
      totalDividendPerShare: round(
        items.reduce((sum, item) => sum + item.dividendPerShare, 0),
      ),
    };
  }

  return {
    symbol: stock.symbol,
    name: stock.name,
    latestPrice: round(stock.latestPrice),
    fiscalYearEndLabel: fiscal.fiscalYearEndLabel,
    fiscalYearEndMonth: fiscal.fiscalYearEndMonth,
    sourceAsOf,
    companyUrl: `${COMPANY_URL}/${stock.symbol}`,
    indexUrl: INDEX_URL,
    faceValueAssumption: FACE_VALUE_ASSUMPTION,
    summary,
    payouts: payouts.sort((a, b) => a.announcedAt.localeCompare(b.announcedAt)),
  };
}

async function runPool(items, task, concurrency) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      const result = await task(current);
      if (result) {
        results.push(result);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return results;
}

async function main() {
  const outputDir = path.join(process.cwd(), "data");
  const outputFile = path.join(outputDir, "stocks.json");
  const sourceAsOf = new Date().toISOString().slice(0, 10);

  const indexHtml = await fetchText(INDEX_URL);
  const constituents = parseIndexConstituents(indexHtml);

  const records = await runPool(
    constituents,
    async (stock) => {
      const record = await buildStockRecord(stock, sourceAsOf);
      if (record) {
        process.stdout.write(`processed ${record.symbol}\n`);
      }
      return record;
    },
    CONCURRENCY,
  );

  const sorted = records.sort((a, b) => a.symbol.localeCompare(b.symbol));

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(sorted, null, 2)}\n`);

  process.stdout.write(
    `wrote ${sorted.length} dividend-paying current KMIALLSHR records to ${outputFile}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
