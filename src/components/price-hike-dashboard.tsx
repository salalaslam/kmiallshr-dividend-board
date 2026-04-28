"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

type YearKey = "2024" | "2025" | "2026";

type PricePoint = {
  date: string;
  price: number;
};

type HikeRow = {
  symbol: string;
  name: string;
  companyUrl: string;
  pointsCount: number;
  buyDate: string;
  buyPrice: number;
  peakDate: string;
  peakPrice: number;
  hikeRs: number;
  hikePct: number;
};

const YEAR_TABS: Array<{ key: YearKey; label: string; subtitle: string }> = [
  { key: "2024", label: "2024", subtitle: "Calendar year" },
  { key: "2025", label: "2025", subtitle: "Calendar year" },
  { key: "2026", label: "2026", subtitle: "Year to date" },
];

function formatCurrency(value: number, digits = 2) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number, digits = 2) {
  return `${value.toFixed(digits)}%`;
}

function formatDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function computeBestHike(points: PricePoint[]) {
  if (points.length < 2) return null;

  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date));

  let minPoint = ordered[0];
  let best: {
    buyDate: string;
    buyPrice: number;
    peakDate: string;
    peakPrice: number;
    hikeRs: number;
    hikePct: number;
  } | null = null;

  for (let i = 1; i < ordered.length; i++) {
    const current = ordered[i];

    if (minPoint.price > 0 && current.price > minPoint.price) {
      const hikeRs = current.price - minPoint.price;
      const hikePct = (hikeRs / minPoint.price) * 100;

      if (!best || hikePct > best.hikePct) {
        best = {
          buyDate: minPoint.date,
          buyPrice: minPoint.price,
          peakDate: current.date,
          peakPrice: current.price,
          hikeRs,
          hikePct,
        };
      }
    }

    if (current.price < minPoint.price) {
      minPoint = current;
    }
  }

  return best;
}

export function PriceHikeDashboard() {
  const [selectedYear, setSelectedYear] = useState<YearKey>("2026");
  const [search, setSearch] = useState("");

  const stocks = useQuery(api.stocks.list);
  const snapshots = useQuery(api.priceSnapshots.listAll);
  const isSnapshotsLoading = !snapshots;

  const derived = useMemo(() => {
    if (!stocks) {
      return {
        rows: [] as HikeRow[],
        sourceAsOf: "",
        top: null as HikeRow | null,
      };
    }

    const pointMap = new Map<string, PricePoint[]>();

    for (const snapshot of snapshots ?? []) {
      const year = snapshot.date.slice(0, 4);
      if (year !== selectedYear) continue;
      if (!Number.isFinite(snapshot.price) || snapshot.price <= 0) continue;

      const current = pointMap.get(snapshot.symbol) ?? [];
      current.push({ date: snapshot.date, price: snapshot.price });
      pointMap.set(snapshot.symbol, current);
    }

    // For 2026 YTD, include latest imported price as the latest possible endpoint.
    if (selectedYear === "2026") {
      for (const stock of stocks) {
        if (!stock.sourceAsOf.startsWith("2026-")) continue;
        if (!Number.isFinite(stock.latestPrice) || stock.latestPrice <= 0) continue;

        const current = pointMap.get(stock.symbol) ?? [];
        current.push({ date: stock.sourceAsOf, price: stock.latestPrice });
        pointMap.set(stock.symbol, current);
      }
    }

    const term = search.trim().toLowerCase();

    const rows: HikeRow[] = stocks
      .map((stock) => {
        const points = pointMap.get(stock.symbol) ?? [];
        const best = computeBestHike(points);
        if (!best) return null;

        return {
          symbol: stock.symbol,
          name: stock.name,
          companyUrl: stock.companyUrl,
          pointsCount: points.length,
          buyDate: best.buyDate,
          buyPrice: best.buyPrice,
          peakDate: best.peakDate,
          peakPrice: best.peakPrice,
          hikeRs: best.hikeRs,
          hikePct: best.hikePct,
        };
      })
      .filter((row): row is HikeRow => row !== null)
      .filter((row) => {
        if (!term) return true;
        return (
          row.symbol.toLowerCase().includes(term) ||
          row.name.toLowerCase().includes(term)
        );
      })
      .sort((a, b) => b.hikePct - a.hikePct);

    return {
      rows,
      sourceAsOf: stocks[0]?.sourceAsOf ?? "",
      top: rows[0] ?? null,
    };
  }, [search, selectedYear, snapshots, stocks]);

  if (!stocks) {
    return (
      <div className="shell">
        <div className="loading-panel market-surface">
          <p className="eyebrow">Loading dataset</p>
          <h1>Loading KMIALLSHR constituents.</h1>
        </div>
      </div>
    );
  }

  const activeTab = YEAR_TABS.find((tab) => tab.key === selectedYear)!;
  const avgHike =
    derived.rows.length > 0
      ? derived.rows.reduce((sum, row) => sum + row.hikePct, 0) / derived.rows.length
      : 0;

  return (
    <div className="shell">
      <header className="market-header">
        <div className="market-title">
          <p className="eyebrow text-xs">PSX · KMIALLSHR</p>
          <h1>Highest Price Hike Tracker</h1>
          <p className="lede text-sm">
            Finds each stock&apos;s strongest price run-up inside the selected year and ranks the
            index by percentage hike.
          </p>
        </div>

        <div className="market-meta">
          <div>
            <span className="stat-label">Snapshot</span>
            <strong>{derived.sourceAsOf || "N/A"}</strong>
          </div>
          <div>
            <span className="stat-label">Universe</span>
            <strong>KMIALLSHR</strong>
          </div>
        </div>
      </header>

      <section className="ticker-strip" aria-label="Hike summary">
        <div className="ticker-item">
          <span className="stat-label">Selected year</span>
          <strong>{activeTab.label}</strong>
          <span className="text-xs">{activeTab.subtitle}</span>
        </div>
        <div className="ticker-item">
          <span className="stat-label">Ranked stocks</span>
          <strong>{derived.rows.length}</strong>
          <span className="text-xs">Enough points to compute hike</span>
        </div>
        <div className="ticker-item">
          <span className="stat-label">Average hike</span>
          <strong>{formatPercent(avgHike)}</strong>
          <span className="text-xs">Across ranked stocks</span>
        </div>
        <div className="ticker-item is-primary">
          <span className="stat-label">Highest hike</span>
          <strong>{derived.top ? formatPercent(derived.top.hikePct) : "0.00%"}</strong>
          <span className="text-xs">{derived.top?.symbol ?? "No rows"}</span>
        </div>
      </section>

      <section className="control-band">
        <div className="control-group fiscal-group">
          <div className="control-heading">
            <p className="eyebrow text-xs">Year</p>
            <h2>Choose period</h2>
          </div>
          <div className="tab-row" role="tablist" aria-label="Year tabs">
            {YEAR_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selectedYear === tab.key}
                className={selectedYear === tab.key ? "tab text-sm is-active" : "tab text-sm"}
                onClick={() => setSelectedYear(tab.key)}
              >
                <span>{tab.label}</span>
                <small className="text-xs">{tab.subtitle}</small>
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
              onChange={(event) => setSearch(event.target.value)}
              placeholder="MEBL, HBL, MTL..."
            />
          </label>
        </div>

        <div className="control-group">
          <div className="control-heading">
            <p className="eyebrow text-xs">Method</p>
            <h2>How hike is calculated</h2>
          </div>
          <p className="methodology text-xs" style={{ maxWidth: "68ch" }}>
            For each stock, the app scans available price snapshots in the selected year and finds
            the best run from an earlier low to a later high. Ranking is by hike percentage.
            Results reflect currently stored snapshots; 2026 uses latest imported price as the
            potential final point.
          </p>
        </div>
      </section>

      <section className="table-panel market-surface">
        <div className="table-header">
          <div>
            <p className="eyebrow text-xs">Ranked constituents</p>
            <h2>{activeTab.label} highest hike table</h2>
          </div>
          <p className="methodology text-xs">
            Hike % = (Peak price - Buy price) / Buy price, where buy date occurs before peak date.
          </p>
        </div>

        <div className="table-wrap">
          <table className="text-sm">
            <thead>
              <tr>
                <th>Stock</th>
                <th>Buy date</th>
                <th>Buy price</th>
                <th>Peak date</th>
                <th>Peak price</th>
                <th>Hike (Rs)</th>
                <th>Hike (%)</th>
                <th>Data points</th>
              </tr>
            </thead>
            <tbody>
              {isSnapshotsLoading && (
                <tr>
                  <td colSpan={8}>Loading yearly price snapshots...</td>
                </tr>
              )}
              {derived.rows.map((row) => (
                <tr key={`${selectedYear}-${row.symbol}`}>
                  <td>
                    <div className="stock-cell text-sm">
                      <a href={row.companyUrl} target="_blank" rel="noreferrer">
                        {row.symbol}
                      </a>
                      <div className="text-xs">
                        <strong>{row.name}</strong>
                      </div>
                    </div>
                  </td>
                  <td>{formatDate(row.buyDate)}</td>
                  <td>{formatCurrency(row.buyPrice)}</td>
                  <td>{formatDate(row.peakDate)}</td>
                  <td>{formatCurrency(row.peakPrice)}</td>
                  <td>{formatCurrency(row.hikeRs)}</td>
                  <td className="yield-cell">{formatPercent(row.hikePct)}</td>
                  <td>{row.pointsCount}</td>
                </tr>
              ))}
              {!isSnapshotsLoading && derived.rows.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    No hike data available for this year with current snapshots.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
