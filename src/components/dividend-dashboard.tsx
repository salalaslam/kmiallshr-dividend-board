"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";

type FiscalYearKey = "fy24" | "fy25" | "fy26";

const FISCAL_TABS: Array<{ key: FiscalYearKey; label: string; note: string }> = [
  { key: "fy24", label: "FY24", note: "Closed-year payouts" },
  { key: "fy25", label: "FY25", note: "Closed-year payouts" },
  { key: "fy26", label: "FY26", note: "Paid to date" },
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

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function DividendDashboard() {
  const stocks = useQuery(api.stocks.list);
  const [selectedYear, setSelectedYear] = useState<FiscalYearKey>("fy26");
  const [search, setSearch] = useState("");
  const [investmentAmount, setInvestmentAmount] = useState("1000000");
  const [withholdingTax, setWithholdingTax] = useState("15");
  const [zakatRate, setZakatRate] = useState("0");
  const [faceValue, setFaceValue] = useState("10");

  if (!stocks) {
    return (
      <div className="shell">
        <div className="loading-panel market-surface">
          <p className="eyebrow">Loading dataset</p>
          <h1>Pulling the KMIALLSHR dividend snapshot from Convex.</h1>
        </div>
      </div>
    );
  }

  const investment = Math.max(toNumber(investmentAmount), 0);
  const wht = Math.max(toNumber(withholdingTax), 0);
  const zakat = Math.max(toNumber(zakatRate), 0);
  const configuredFaceValue = Math.max(toNumber(faceValue), 0);
  const combinedDeduction = Math.min((wht + zakat) / 100, 1);
  const term = search.trim().toLowerCase();
  const rows = stocks
    .map((stock) => {
      const summary = stock.summary[selectedYear];
      const faceValueScale =
        stock.faceValueAssumption > 0
          ? configuredFaceValue / stock.faceValueAssumption
          : 1;
      const adjustedDividendPerShare =
        summary.totalDividendPerShare * faceValueScale;
      const sharesHeld = stock.latestPrice > 0 ? investment / stock.latestPrice : 0;
      const grossDividendCash = sharesHeld * adjustedDividendPerShare;
      const netDividendCash = grossDividendCash * (1 - combinedDeduction);
      const netYield = investment > 0 ? (netDividendCash / investment) * 100 : 0;

      return {
        id: stock._id,
        symbol: stock.symbol,
        name: stock.name,
        latestPrice: stock.latestPrice,
        fiscalYearEndLabel: stock.fiscalYearEndLabel,
        companyUrl: stock.companyUrl,
        indexUrl: stock.indexUrl,
        sourceAsOf: stock.sourceAsOf,
        payoutCount: summary.payoutCount,
        intervalLabel: summary.intervalLabel,
        totalDividendPercent: summary.totalDividendPercent,
        totalDividendPerShare: adjustedDividendPerShare,
        grossDividendCash,
        netDividendCash,
        netYield,
      };
    })
    .filter((row) => row.payoutCount > 0)
    .filter((row) => {
      if (!term) return true;
      return (
        row.symbol.toLowerCase().includes(term) ||
        row.name.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => b.netYield - a.netYield);
  const derived = {
    rows,
    investment,
    sourceAsOf: rows[0]?.sourceAsOf ?? "",
    totalNetCash: rows.reduce((sum, row) => sum + row.netDividendCash, 0),
    topStock: rows[0] ?? null,
    configuredFaceValue,
  };
  const activeTab = FISCAL_TABS.find((tab) => tab.key === selectedYear)!;

  return (
    <div className="shell">
      <header className="market-header">
        <div className="market-title">
          <p className="eyebrow text-xs">PSX dividend board</p>
          <h1>KMIALLSHR Income Monitor</h1>
          <p className="lede text-sm">
            Constituents and latest prices are sourced from the official{" "}
            <a
              href={derived.rows[0]?.indexUrl ?? "https://dps.psx.com.pk/indices/KMIALLSHR"}
              target="_blank"
              rel="noreferrer"
            >
              PSX KMIALLSHR constituent page
            </a>
            ; dividend rows come from each stock&apos;s PSX payout feed.
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

      <section className="ticker-strip" aria-label="Portfolio summary">
        <div className="ticker-item">
          <span className="stat-label">Selected FY</span>
          <strong>{activeTab.label}</strong>
          <span className="text-xs">{activeTab.note}</span>
        </div>
        <div className="ticker-item">
          <span className="stat-label">Dividend payers</span>
          <strong>{derived.rows.length}</strong>
          <span className="text-xs">Current constituents</span>
        </div>
        <div className="ticker-item">
          <span className="stat-label">Net cash if held equally</span>
          <strong>{formatCurrency(derived.totalNetCash, 0)}</strong>
          <span className="text-xs">{formatCurrency(derived.investment, 0)} per stock</span>
        </div>
        <div className="ticker-item is-primary">
          <span className="stat-label">Top net yield</span>
          <strong>
            {derived.topStock ? formatPercent(derived.topStock.netYield) : "0.00%"}
          </strong>
          <span className="text-xs">{derived.topStock?.symbol ?? "No rows"}</span>
        </div>
      </section>

      <section className="control-band">
        <div className="control-group fiscal-group">
          <div className="control-heading">
            <p className="eyebrow text-xs">Fiscal year</p>
            <h2>Return period</h2>
          </div>
          <div className="tab-row" role="tablist" aria-label="Fiscal year tabs">
            {FISCAL_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selectedYear === tab.key}
                className={selectedYear === tab.key ? "tab text-sm is-active" : "tab text-sm"}
                onClick={() => setSelectedYear(tab.key)}
              >
                <span>{tab.label}</span>
                <small className="text-xs">{tab.note}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="control-group search-group">
          <label className="field">
            <span className="text-xs">Search symbol or company</span>
            <input
              className="text-sm"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="POL, MEBL, ENGRO..."
            />
          </label>
        </div>

        <div className="control-group assumption-group">
          <div className="control-heading">
            <p className="eyebrow text-xs">Assumptions</p>
            <h2>Holding model</h2>
          </div>
          <div className="field-grid">
            <label className="field">
              <span className="text-xs">Investment / stock (Rs)</span>
              <input
                className="text-sm"
                inputMode="numeric"
                value={investmentAmount}
                onChange={(event) => setInvestmentAmount(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="text-xs">WHT (%)</span>
              <input
                className="text-sm"
                inputMode="decimal"
                value={withholdingTax}
                onChange={(event) => setWithholdingTax(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="text-xs">Zakat (%)</span>
              <input
                className="text-sm"
                inputMode="decimal"
                value={zakatRate}
                onChange={(event) => setZakatRate(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="text-xs">Face value (Rs)</span>
              <input
                className="text-sm"
                inputMode="decimal"
                value={faceValue}
                onChange={(event) => setFaceValue(event.target.value)}
              />
            </label>
          </div>
        </div>
      </section>

      <section className="table-panel market-surface">
        <div className="table-header">
          <div>
            <p className="eyebrow text-xs">Ranked constituents</p>
            <h2>{activeTab.label} dividend yield table</h2>
          </div>
          <p className="methodology text-xs">
            PSX payout percentages are converted to rupees per share using a Rs{" "}
            {derived.configuredFaceValue.toFixed(2)} face value assumption. FY26 is
            year-to-date based on cash dividends published as of{" "}
            {derived.sourceAsOf || "the latest import"}.
          </p>
        </div>

        <div className="table-wrap">
          <table className="text-sm">
            <thead>
              <tr>
                <th>Stock</th>
                <th>Latest price</th>
                <th>Interval</th>
                <th>{activeTab.label} dividend / share</th>
                <th>Gross cash on holding</th>
                <th>Net cash after deductions</th>
                <th>Net yield</th>
              </tr>
            </thead>
            <tbody>
              {derived.rows.map((row) => (
                <tr key={row.id}>
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
                  <td>{formatCurrency(row.latestPrice)}</td>
                  <td>{row.intervalLabel || "None"}</td>
                  <td>
                    <div className="metric-stack text-sm">
                      <strong>{formatCurrency(row.totalDividendPerShare)}</strong>
                      <span className="text-xs">{formatPercent(row.totalDividendPercent)}</span>
                    </div>
                  </td>
                  <td>{formatCurrency(row.grossDividendCash, 0)}</td>
                  <td>{formatCurrency(row.netDividendCash, 0)}</td>
                  <td className="yield-cell">{formatPercent(row.netYield)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
