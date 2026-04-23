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
        <div className="loading-panel">
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
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">PSX dividend board</p>
          <h1>KMIALLSHR dividend payers, normalized for FY24 to FY26.</h1>
          <p className="lede">
            Current constituent list and latest prices come from the official{" "}
            <a
              href={derived.rows[0]?.indexUrl ?? "https://dps.psx.com.pk/indices/KMIALLSHR"}
              target="_blank"
              rel="noreferrer"
            >
              PSX KMIALLSHR constituent page
            </a>
            . Dividend rows come from each stock&apos;s PSX payout feed.
          </p>
        </div>

        <div className="hero-stats">
          <div className="stat-card">
            <span className="stat-label">Selected FY</span>
            <strong>{activeTab.label}</strong>
            <span>{activeTab.note}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Dividend payers</span>
            <strong>{derived.rows.length}</strong>
            <span>Current KMIALLSHR constituents</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Net cash if held equally</span>
            <strong>{formatCurrency(derived.totalNetCash, 0)}</strong>
            <span>{formatCurrency(derived.investment, 0)} per stock</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Top net yield</span>
            <strong>
              {derived.topStock ? formatPercent(derived.topStock.netYield) : "0.00%"}
            </strong>
            <span>{derived.topStock?.symbol ?? "No rows"}</span>
          </div>
        </div>
      </section>

      <section className="controls-grid">
        <div className="panel">
          <div className="panel-header">
            <p className="eyebrow">Filters</p>
            <h2>Choose the fiscal year view.</h2>
          </div>
          <div className="tab-row" role="tablist" aria-label="Fiscal year tabs">
            {FISCAL_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selectedYear === tab.key}
                className={selectedYear === tab.key ? "tab is-active" : "tab"}
                onClick={() => setSelectedYear(tab.key)}
              >
                <span>{tab.label}</span>
                <small>{tab.note}</small>
              </button>
            ))}
          </div>
          <label className="field">
            <span>Search symbol or company</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="POL, MEBL, ENGRO..."
            />
          </label>
        </div>

        <div className="panel">
          <div className="panel-header">
            <p className="eyebrow">Assumptions</p>
            <h2>Returns on a Rs 1,000,000 holding.</h2>
          </div>
          <div className="field-grid">
            <label className="field">
              <span>Investment per stock (Rs)</span>
              <input
                inputMode="numeric"
                value={investmentAmount}
                onChange={(event) => setInvestmentAmount(event.target.value)}
              />
            </label>
            <label className="field">
              <span>WHT (%)</span>
              <input
                inputMode="decimal"
                value={withholdingTax}
                onChange={(event) => setWithholdingTax(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Zakat (%)</span>
              <input
                inputMode="decimal"
                value={zakatRate}
                onChange={(event) => setZakatRate(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Face value assumption (Rs)</span>
              <input
                inputMode="decimal"
                value={faceValue}
                onChange={(event) => setFaceValue(event.target.value)}
              />
            </label>
          </div>
          <p className="methodology">
            PSX payout rows are published as dividend percentages. This app converts them to
            rupees per share using a default face value assumption of Rs {derived.configuredFaceValue.toFixed(2)}.
            WHT defaults to 15%; zakat defaults to 0%.
          </p>
        </div>
      </section>

      <section className="table-panel">
        <div className="panel-header table-header">
          <div>
            <p className="eyebrow">Snapshot date</p>
            <h2>{derived.sourceAsOf || "N/A"}</h2>
          </div>
          <p className="methodology">
            FY26 is year-to-date based on cash dividends already published on PSX as of{" "}
            {derived.sourceAsOf || "the latest import"}.
          </p>
        </div>

        <div className="table-wrap">
          <table>
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
                    <div className="stock-cell">
                      <a href={row.companyUrl} target="_blank" rel="noreferrer">
                        {row.symbol}
                      </a>
                      <div>
                        <strong>{row.name}</strong>
                        <span>FY end: {row.fiscalYearEndLabel}</span>
                      </div>
                    </div>
                  </td>
                  <td>{formatCurrency(row.latestPrice)}</td>
                  <td>{row.intervalLabel || "None"}</td>
                  <td>
                    <div className="metric-stack">
                      <strong>{formatCurrency(row.totalDividendPerShare)}</strong>
                      <span>{formatPercent(row.totalDividendPercent)}</span>
                    </div>
                  </td>
                  <td>{formatCurrency(row.grossDividendCash, 0)}</td>
                  <td>{formatCurrency(row.netDividendCash, 0)}</td>
                  <td>{formatPercent(row.netYield)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
