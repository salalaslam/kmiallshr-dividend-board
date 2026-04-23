# KMIALLSHR Dividend Board

Next.js + Convex app for current dividend-paying KMIALLSHR constituents on PSX.

It shows:
- FY24, FY25, and FY26 dividend snapshots with filter tabs
- payout interval labels such as `Single`, `Biannual`, `Triannual`, and `Quarterly`
- yearly cash return on a Rs 1,000,000 holding per stock
- configurable withholding tax, zakat, and face-value assumption

## Data source

The importer pulls from official PSX endpoints:
- current KMIALLSHR constituent list: `https://dps.psx.com.pk/indices/KMIALLSHR`
- per-symbol payout feed: `https://dps.psx.com.pk/company/<SYMBOL>` and `POST https://dps.psx.com.pk/company/payouts`

`data/stocks.json` is a generated snapshot for the latest import date included in the repo.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Configure Convex:

```bash
npx convex dev
```

3. Refresh the PSX dataset if needed:

```bash
npm run data:fetch
npm run seed:dev
```

4. Start the app:

```bash
npm run dev
```

## Scripts

```bash
npm run data:fetch   # scrape PSX and write data/stocks.json
npm run seed:dev     # import data/stocks.json into the Convex dev deployment
npm run seed:prod    # import data/stocks.json into the Convex prod deployment
npm run lint
npm run build
```

## Notes

- FY26 is year-to-date and reflects cash dividends already published on PSX as of the import date.
- PSX payout rows are published as dividend percentages. The app converts them to rupees per share using a configurable face value assumption, defaulting to Rs 10.
